-- =============================================================================
-- Edit and delete entries, with reasons and a history (Part 4)
--
-- 1. Two new permissions: entries.edit and entries.delete (owners always
--    have every permission). Both are also checked in every function below.
-- 2. entry_changes: every edit and delete is logged with who, when, the
--    entry, old values, new values and the reason (required).
-- 3. Soft delete: deleted_at / deleted_by / delete_reason on sales,
--    purchases, expenses, payments, phones bought from customers, customers
--    and suppliers. Effects are reversed (stock, IMEI units, Cash/Bank,
--    profit, balances); a delete is blocked when later entries depend on it.
-- 4. Edit functions recalculate everything that depends on the entry:
--    edit_sale, edit_purchase, edit_expense, edit_payment and
--    edit_customer_purchase. Sales with VAT (vat_rate > 0) cannot be edited or
--    deleted: use a return instead.
--
-- No existing function is replaced. Deleting a purchase uses the existing
-- cancel_purchase and deleting an expense the existing void_expense, so
-- those need their usual permission (purchases / expenses) as well.
--
-- One idempotent migration: it can be run more than once and only adds or
-- replaces objects of its own. It never removes rows.
-- It runs as one transaction: if any statement fails, nothing is changed.
-- Run it in the Supabase SQL Editor. It contains no test data.
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.cancel_purchase(jsonb)') is null
     or to_regprocedure('public.void_expense(jsonb)') is null
     or to_regprocedure('public.default_finance_account(uuid, text)') is null
     or to_regprocedure('public.finance_balance(uuid)') is null
     or to_regclass('public.customer_purchases') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'sale_items' and column_name = 'purchase_id') then
    raise exception 'Stopped: run the earlier migrations first (up to 20261123000000_unstocked_supplier.sql).';
  end if;
end;
$$;


-- 1. Permissions --------------------------------------------------------------
insert into public.permissions (key, module, description)
values ('entries.edit', 'Entries', 'Edit saved sales, purchases, expenses, payments and phones bought from customers (a reason is required)'),
       ('entries.delete', 'Entries', 'Delete saved entries, customers and suppliers (a reason is required; effects are reversed)')
on conflict (key) do nothing;


-- 2. History -------------------------------------------------------------------
create table if not exists public.entry_changes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  entity_type text not null,
  entity_id uuid not null,
  entity_label text,
  action text not null,
  reason text not null,
  old_values jsonb,
  new_values jsonb,
  changed_by uuid not null,
  changed_at timestamptz not null default now(),
  constraint entry_changes_action_check check (action in ('edit', 'delete')),
  constraint entry_changes_reason_check check (char_length(reason) between 3 and 500)
);

create index if not exists entry_changes_entity_idx on public.entry_changes (entity_type, entity_id);
create index if not exists entry_changes_date_idx on public.entry_changes (business_id, changed_at desc);

alter table public.entry_changes enable row level security;
drop policy if exists entry_changes_select on public.entry_changes;
create policy entry_changes_select on public.entry_changes for select
  using (business_id = public.my_business_id()
         and (public.has_permission('entries.edit') or public.has_permission('entries.delete')
              or public.has_permission('users.manage') or public.has_permission('settings.manage')));


-- 3. Soft delete columns ---------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['sales', 'purchases', 'expenses', 'sale_payments', 'purchase_payments',
                           'customer_purchases', 'customers', 'suppliers'] loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
    execute format('alter table public.%I add column if not exists deleted_by uuid', t);
    execute format('alter table public.%I add column if not exists delete_reason text', t);
  end loop;
end;
$$;


-- 4. Helpers ---------------------------------------------------------------------
-- Checks the permission and the reason; returns the business id and the user
create or replace function public.entry_change_start(p_permission text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
begin
  if auth.uid() is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission(p_permission) then
    raise exception 'You do not have permission to %.',
      case p_permission when 'entries.edit' then 'edit saved entries' else 'delete saved entries' end;
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 or char_length(p_reason) > 500 then
    raise exception 'Write the reason (3 to 500 characters).';
  end if;
  return v_biz;
end;
$$;

revoke all on function public.entry_change_start(text, text) from public, anon, authenticated;

create or replace function public.entry_change_log(
  p_biz uuid, p_type text, p_id uuid, p_label text, p_action text, p_reason text, p_old jsonb, p_new jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.entry_changes
    (business_id, entity_type, entity_id, entity_label, action, reason, old_values, new_values, changed_by)
  values (p_biz, p_type, p_id, p_label, p_action, trim(p_reason), p_old, p_new, auth.uid());
$$;

revoke all on function public.entry_change_log(uuid, text, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;

-- Money from a payload: 0 or more, at most 2 decimals
create or replace function public.entry_amount(p_value text, p_label text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  begin
    v := p_value::numeric;
  exception when others then
    raise exception '% is not a valid amount.', p_label;
  end;
  if v is null or v < 0 or v <> round(v, 2) or v > 999999999999 then
    raise exception '% must be 0 or more, with at most 2 decimals.', p_label;
  end if;
  return v;
end;
$$;


-- 5. Edit a sale (no VAT, no returns) ------------------------------------------------
-- payload: sale_id, reason, discount (invoice), notes,
--   items: [{ sale_item_id, unit_price, discount, unit_cost (Item not in stock only) }]
create or replace function public.edit_sale(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := p_payload ->> 'reason';
  v_biz uuid := public.entry_change_start('entries.edit', v_reason);
  s public.sales%rowtype;
  si public.sale_items%rowtype;
  it jsonb;
  v_price numeric;
  v_disc numeric;
  v_line numeric;
  v_cost numeric;
  v_old_cost numeric;
  v_sub numeric;
  v_header numeric;
  v_total numeric;
  v_old jsonb;
  v_new jsonb;
  v_ptotal numeric;
begin
  begin
    select * into s from public.sales x
    where x.id = (p_payload ->> 'sale_id')::uuid and x.business_id = v_biz
    for update;
  exception when others then
    raise exception 'Invoice not found.';
  end;
  if s.id is null or s.deleted_at is not null then
    raise exception 'Invoice not found.';
  end if;
  if s.status <> 'completed' then
    raise exception 'This invoice is cancelled and cannot be edited.';
  end if;
  if s.vat_rate > 0 then
    raise exception 'This is a tax invoice (VAT). It cannot be edited. Use a return instead.';
  end if;
  if s.returned_total > 0 then
    raise exception 'This invoice has returns, so it cannot be edited.';
  end if;

  v_old := jsonb_build_object(
    'discount', s.discount, 'total', s.total, 'notes', s.notes,
    'items', (select jsonb_agg(jsonb_build_object('id', x.id, 'description', x.description, 'unit_price', x.unit_price,
                                                  'discount', x.discount, 'line_total', x.line_total,
                                                  'unit_cost', (select c.unit_cost from public.sale_item_costs c where c.item_id = x.id))
                               order by x.description)
              from public.sale_items x where x.sale_id = s.id));

  for it in select value from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    select * into si from public.sale_items x
    where x.id = nullif(it ->> 'sale_item_id', '')::uuid and x.sale_id = s.id;
    if not found then
      raise exception 'A line does not belong to this invoice.';
    end if;
    v_price := public.entry_amount(it ->> 'unit_price', 'The price of ' || si.description);
    v_disc := public.entry_amount(coalesce(nullif(it ->> 'discount', ''), '0'), 'The discount of ' || si.description);
    if v_disc > round(v_price * si.quantity, 2) then
      raise exception 'The discount of % cannot be more than the line amount.', si.description;
    end if;
    v_line := round(v_price * si.quantity, 2) - v_disc;
    update public.sale_items set unit_price = v_price, discount = v_disc, line_total = v_line where id = si.id;

    select c.unit_cost into v_old_cost from public.sale_item_costs c where c.item_id = si.id;
    v_cost := v_old_cost;
    if si.item_type = 'unstocked' and nullif(it ->> 'unit_cost', '') is not null then
      v_cost := public.entry_amount(it ->> 'unit_cost', 'The cost of ' || si.description);
      update public.sale_item_costs set unit_cost = v_cost where item_id = si.id;
      -- Bought from a supplier: the purchase (and so the supplier balance) follows the cost
      if si.purchase_id is not null then
        v_ptotal := round(v_cost * si.quantity, 2);
        if (select p.paid_amount from public.purchases p where p.id = si.purchase_id) > v_ptotal then
          raise exception 'More than the new cost of % was already paid to the supplier. Change that payment first.', si.description;
        end if;
        update public.purchases set subtotal = v_ptotal, total = v_ptotal + extra_cost where id = si.purchase_id;
      end if;
    end if;
    if v_line < round(coalesce(v_cost, 0) * si.quantity, 2)
       and not public.has_permission('sales.override_min_price') then
      raise exception 'The price of % is below its cost. You do not have permission to sell below cost.', si.description;
    end if;
  end loop;

  select coalesce(sum(x.line_total), 0) into v_sub from public.sale_items x where x.sale_id = s.id;
  v_header := public.entry_amount(coalesce(nullif(p_payload ->> 'discount', ''), s.discount::text), 'The invoice discount');
  if v_header > v_sub then
    raise exception 'The invoice discount cannot be more than the subtotal.';
  end if;
  v_total := v_sub - v_header;
  if s.paid_amount > v_total then
    raise exception 'The customer has already paid % (including credits), more than the new total %. Change or delete a payment first.',
      public.finance_format(s.paid_amount), public.finance_format(v_total);
  end if;

  update public.sales
     set subtotal = v_sub, discount = v_header, total = v_total,
         notes = case when p_payload ? 'notes' then nullif(trim(p_payload ->> 'notes'), '') else notes end
   where id = s.id;

  v_new := jsonb_build_object(
    'discount', v_header, 'total', v_total,
    'notes', (select x.notes from public.sales x where x.id = s.id),
    'items', (select jsonb_agg(jsonb_build_object('id', x.id, 'description', x.description, 'unit_price', x.unit_price,
                                                  'discount', x.discount, 'line_total', x.line_total,
                                                  'unit_cost', (select c.unit_cost from public.sale_item_costs c where c.item_id = x.id))
                               order by x.description)
              from public.sale_items x where x.sale_id = s.id));
  perform public.entry_change_log(v_biz, 'sale', s.id, 'INV-' || lpad(s.invoice_no::text, 6, '0'),
                                  'edit', v_reason, v_old, v_new);
  return jsonb_build_object('sale_id', s.id, 'total', v_total);
end;
$$;

revoke all on function public.edit_sale(jsonb) from public, anon;
grant execute on function public.edit_sale(jsonb) to authenticated, service_role;


-- 6. Edit a purchase (line costs, date, supplier invoice no, notes) ---------------------
-- payload: purchase_id, reason, purchase_date, supplier_invoice_no, notes,
--   items: [{ purchase_item_id, unit_cost }]
-- Phones: purchase and landed cost of the phones of the line change; phones
-- already sold get the new cost on their sale line, so profit follows.
-- Accessories: the average cost of the product moves by the difference.
create or replace function public.edit_purchase(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := p_payload ->> 'reason';
  v_biz uuid := public.entry_change_start('entries.edit', v_reason);
  p public.purchases%rowtype;
  pi public.purchase_items%rowtype;
  it jsonb;
  v_cost numeric;
  v_sub numeric;
  v_total numeric;
  v_old jsonb;
  v_new jsonb;
  v_landed numeric;
  v_old_landed numeric;
  v_stock numeric;
  v_date date;
  v_landed_before jsonb;
begin
  begin
    select * into p from public.purchases x
    where x.id = (p_payload ->> 'purchase_id')::uuid and x.business_id = v_biz
    for update;
  exception when others then
    raise exception 'Purchase not found.';
  end;
  if p.id is null or p.deleted_at is not null then
    raise exception 'Purchase not found.';
  end if;
  if p.status <> 'completed' then
    raise exception 'This purchase is cancelled and cannot be edited.';
  end if;
  if p.returned_total > 0 then
    raise exception 'This purchase has returns, so it cannot be edited.';
  end if;

  v_old := jsonb_build_object(
    'purchase_date', p.purchase_date, 'supplier_invoice_no', p.supplier_invoice_no, 'notes', p.notes, 'total', p.total,
    'items', (select jsonb_agg(jsonb_build_object('id', x.id, 'description', x.description, 'unit_cost', x.unit_cost,
                                                  'quantity', x.quantity) order by x.description)
              from public.purchase_items x where x.purchase_id = p.id));

  -- Remember the landed cost of every line before the change
  select coalesce(jsonb_object_agg(x.id::text,
           round((x.line_total + case when p.subtotal > 0 then p.extra_cost * x.line_total / p.subtotal else 0 end)
                 / greatest(x.quantity, 1), 4)), '{}'::jsonb)
    into v_landed_before
  from public.purchase_items x where x.purchase_id = p.id;

  for it in select value from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    select * into pi from public.purchase_items x
    where x.id = nullif(it ->> 'purchase_item_id', '')::uuid and x.purchase_id = p.id;
    if not found then
      raise exception 'A line does not belong to this purchase.';
    end if;
    v_cost := public.entry_amount(it ->> 'unit_cost', 'The purchase price of ' || pi.description);
    update public.purchase_items
       set unit_cost = v_cost, line_total = round(v_cost * quantity, 2)
     where id = pi.id;
  end loop;

  select coalesce(sum(x.line_total), 0) into v_sub from public.purchase_items x where x.purchase_id = p.id;
  if not exists (select 1 from public.purchase_items x where x.purchase_id = p.id) then
    v_sub := p.subtotal; -- a purchase without lines ("Item not in stock"): edit its cost on the sale
  end if;
  v_total := v_sub + p.extra_cost;
  if p.paid_amount > v_total then
    raise exception 'More than the new total % was already paid to the supplier. Change or delete a payment first.',
      public.finance_format(v_total);
  end if;

  v_date := case when nullif(p_payload ->> 'purchase_date', '') is null then p.purchase_date
                 else public.finance_entry_date(p_payload ->> 'purchase_date') end;
  update public.purchases
     set subtotal = v_sub, total = v_total, purchase_date = v_date,
         supplier_invoice_no = case when p_payload ? 'supplier_invoice_no'
                                    then nullif(trim(p_payload ->> 'supplier_invoice_no'), '') else supplier_invoice_no end,
         notes = case when p_payload ? 'notes' then nullif(trim(p_payload ->> 'notes'), '') else notes end
   where id = p.id;

  -- New landed costs: phones and their sale lines, accessories' average cost
  for pi in select * from public.purchase_items x where x.purchase_id = p.id loop
    v_landed := round((pi.line_total + case when v_sub > 0 then p.extra_cost * pi.line_total / v_sub else 0 end)
                      / greatest(pi.quantity, 1), 4);
    v_old_landed := coalesce((v_landed_before ->> pi.id::text)::numeric, v_landed);
    if pi.item_type = 'phone' then
      update public.phone_unit_costs c
         set purchase_cost = pi.unit_cost, landed_cost = v_landed
        from public.phone_units u
       where c.unit_id = u.id and u.purchase_id = p.id and u.variant_id = pi.variant_id
         and u.color_id is not distinct from pi.color_id and u.condition = pi.condition;
      update public.sale_item_costs c
         set unit_cost = v_landed
        from public.sale_items si
        join public.phone_units u on u.id = si.phone_unit_id
       where c.item_id = si.id and u.purchase_id = p.id and u.variant_id = pi.variant_id
         and u.color_id is not distinct from pi.color_id and u.condition = pi.condition;
    elsif pi.item_type = 'accessory' and v_landed <> v_old_landed then
      select ps.qty into v_stock from public.product_stock ps where ps.product_id = pi.product_id;
      if coalesce(v_stock, 0) > 0 then
        update public.product_costs
           set avg_cost = greatest(round(avg_cost + (v_landed - v_old_landed) * least(pi.quantity, v_stock) / v_stock, 4), 0)
         where product_id = pi.product_id;
      end if;
      update public.stock_movements set unit_cost = v_landed
       where ref_type = 'purchase' and ref_id = p.id and product_id = pi.product_id;
    end if;
  end loop;

  select * into p from public.purchases x where x.id = p.id;
  v_new := jsonb_build_object(
    'purchase_date', p.purchase_date, 'supplier_invoice_no', p.supplier_invoice_no, 'notes', p.notes, 'total', p.total,
    'items', (select jsonb_agg(jsonb_build_object('id', x.id, 'description', x.description, 'unit_cost', x.unit_cost,
                                                  'quantity', x.quantity) order by x.description)
              from public.purchase_items x where x.purchase_id = p.id));
  perform public.entry_change_log(v_biz, 'purchase', p.id, 'Purchase #' || p.purchase_no, 'edit', v_reason, v_old, v_new);
  return jsonb_build_object('purchase_id', p.id, 'total', v_total);
end;
$$;

revoke all on function public.edit_purchase(jsonb) from public, anon;
grant execute on function public.edit_purchase(jsonb) to authenticated, service_role;


-- 7. Edit an expense (amount, date, category, description) ---------------------------
create or replace function public.edit_expense(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := p_payload ->> 'reason';
  v_biz uuid := public.entry_change_start('entries.edit', v_reason);
  e public.expenses%rowtype;
  v_amount numeric;
  v_date date;
  v_category text := nullif(regexp_replace(trim(coalesce(p_payload ->> 'category', '')), '\s+', ' ', 'g'), '');
  v_desc text := nullif(trim(coalesce(p_payload ->> 'description', '')), '');
begin
  begin
    select * into e from public.expenses x
    where x.id = (p_payload ->> 'expense_id')::uuid and x.business_id = v_biz
    for update;
  exception when others then
    raise exception 'Expense not found.';
  end;
  if e.id is null or e.deleted_at is not null or e.voided_at is not null then
    raise exception 'Expense not found or cancelled.';
  end if;
  v_amount := public.entry_amount(p_payload ->> 'amount', 'The amount');
  if v_amount <= 0 then
    raise exception 'The amount must be above zero.';
  end if;
  v_date := public.finance_entry_date(p_payload ->> 'expense_date');
  if v_category is null or char_length(v_category) > 60 then
    raise exception 'Choose a category (up to 60 characters).';
  end if;
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'The description cannot be longer than 500 characters.';
  end if;

  update public.expenses
     set amount = v_amount, expense_date = v_date, category = v_category, description = v_desc
   where id = e.id;
  -- The payment in Cash/Bank follows
  update public.cash_ledger
     set amount = v_amount, entry_date = v_date
   where business_id = v_biz and ref_type = 'expense' and ref_id = e.id and reversal_of is null;

  perform public.entry_change_log(v_biz, 'expense', e.id, e.category || ' ' || e.expense_date, 'edit', v_reason,
    jsonb_build_object('amount', e.amount, 'expense_date', e.expense_date, 'category', e.category, 'description', e.description),
    jsonb_build_object('amount', v_amount, 'expense_date', v_date, 'category', v_category, 'description', v_desc));
  return jsonb_build_object('expense_id', e.id);
end;
$$;

revoke all on function public.edit_expense(jsonb) from public, anon;
grant execute on function public.edit_expense(jsonb) to authenticated, service_role;


-- 8. Edit a customer payment or a supplier payment ---------------------------------------
-- payload: kind ('customer' | 'supplier'), payment_id, reason, amount,
--   payment_method (cash|bank), entry_date (date in Cash/Bank)
create or replace function public.edit_payment(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := p_payload ->> 'reason';
  v_biz uuid := public.entry_change_start('entries.edit', v_reason);
  v_kind text := p_payload ->> 'kind';
  v_id uuid;
  v_amount numeric;
  v_method text := p_payload ->> 'payment_method';
  v_date date;
  v_old_amount numeric;
  v_old_method text;
  v_created timestamptz;
  v_parent uuid;
  v_total numeric;
  v_paid numeric;
  v_ledger public.cash_ledger%rowtype;
  v_account uuid;
  v_label text;
begin
  begin
    v_id := (p_payload ->> 'payment_id')::uuid;
  exception when others then
    raise exception 'Payment not found.';
  end;
  v_amount := public.entry_amount(p_payload ->> 'amount', 'The amount');
  if v_amount <= 0 then
    raise exception 'The amount must be above zero.';
  end if;
  if v_method is distinct from 'cash' and v_method is distinct from 'bank' then
    raise exception 'Choose Cash or Bank.';
  end if;

  if v_kind = 'customer' then
    select sp.amount, sp.method, sp.created_at, sp.sale_id into v_old_amount, v_old_method, v_created, v_parent
    from public.sale_payments sp where sp.id = v_id and sp.business_id = v_biz and sp.deleted_at is null
    for update;
    if not found then raise exception 'Payment not found.'; end if;
    select s.total, s.paid_amount, 'Payment on INV-' || lpad(s.invoice_no::text, 6, '0') into v_total, v_paid, v_label
    from public.sales s where s.id = v_parent and s.status = 'completed' for update;
    if not found then raise exception 'The invoice of this payment is cancelled.'; end if;
    if v_paid - v_old_amount + v_amount > v_total then
      raise exception 'The new amount is more than the remaining balance of the invoice.';
    end if;
    select * into v_ledger from public.cash_ledger l
    where l.business_id = v_biz and l.ref_type = 'sale' and l.ref_id = v_parent and l.direction = 'in'
      and l.reversal_of is null and l.voided_at is null and l.created_at = v_created and l.amount = v_old_amount
    order by l.id limit 1;
    update public.sale_payments set amount = v_amount, method = v_method where id = v_id;
    update public.sales set paid_amount = paid_amount - v_old_amount + v_amount where id = v_parent;
  elsif v_kind = 'supplier' then
    select pp.amount, pp.method, pp.created_at, pp.purchase_id into v_old_amount, v_old_method, v_created, v_parent
    from public.purchase_payments pp where pp.id = v_id and pp.business_id = v_biz and pp.deleted_at is null
    for update;
    if not found then raise exception 'Payment not found.'; end if;
    select p.total, p.paid_amount, 'Payment for purchase #' || p.purchase_no into v_total, v_paid, v_label
    from public.purchases p where p.id = v_parent and p.status = 'completed' for update;
    if not found then raise exception 'The purchase of this payment is cancelled.'; end if;
    if v_paid - v_old_amount + v_amount > v_total then
      raise exception 'The new amount is more than the remaining balance of the purchase.';
    end if;
    select * into v_ledger from public.cash_ledger l
    where l.business_id = v_biz and l.ref_type = 'purchase' and l.ref_id = v_parent and l.direction = 'out'
      and l.reversal_of is null and l.voided_at is null and l.created_at = v_created and l.amount = v_old_amount
    order by l.id limit 1;
    update public.purchase_payments set amount = v_amount, method = v_method where id = v_id;
    update public.purchases set paid_amount = paid_amount - v_old_amount + v_amount where id = v_parent;
  else
    raise exception 'Unknown payment type.';
  end if;

  v_date := case when nullif(p_payload ->> 'entry_date', '') is null then coalesce(v_ledger.entry_date, current_date)
                 else public.finance_entry_date(p_payload ->> 'entry_date') end;
  if v_ledger.id is not null then
    v_account := case when v_method = v_old_method then v_ledger.account_id
                      else public.default_finance_account(v_biz, v_method) end;
    update public.cash_ledger
       set amount = v_amount, entry_date = v_date, account = v_method, account_id = v_account
     where id = v_ledger.id;
  end if;

  perform public.entry_change_log(v_biz, v_kind || '_payment', v_id, v_label, 'edit', v_reason,
    jsonb_build_object('amount', v_old_amount, 'method', v_old_method, 'entry_date', v_ledger.entry_date),
    jsonb_build_object('amount', v_amount, 'method', v_method, 'entry_date', v_date));
  return jsonb_build_object('payment_id', v_id);
end;
$$;

revoke all on function public.edit_payment(jsonb) from public, anon;
grant execute on function public.edit_payment(jsonb) to authenticated, service_role;


-- 9. Edit a phone bought from a customer / trade-in -------------------------------------
-- payload: id, reason, price, grade, condition_notes, seller_name, seller_phone, seller_id_number
create or replace function public.edit_customer_purchase(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := p_payload ->> 'reason';
  v_biz uuid := public.entry_change_start('entries.edit', v_reason);
  cp public.customer_purchases%rowtype;
  v_price numeric;
  v_grade text := coalesce(nullif(p_payload ->> 'grade', ''), '');
  v_notes text := nullif(trim(coalesce(p_payload ->> 'condition_notes', '')), '');
  v_name text := nullif(regexp_replace(trim(coalesce(p_payload ->> 'seller_name', '')), '\s+', ' ', 'g'), '');
  v_phone text := nullif(trim(coalesce(p_payload ->> 'seller_phone', '')), '');
  v_idno text := nullif(trim(coalesce(p_payload ->> 'seller_id_number', '')), '');
  v_sale public.sales%rowtype;
  v_ledger public.cash_ledger%rowtype;
  v_balance numeric;
begin
  begin
    select * into cp from public.customer_purchases x
    where x.id = (p_payload ->> 'id')::uuid and x.business_id = v_biz
    for update;
  exception when others then
    raise exception 'Not found.';
  end;
  if cp.id is null or cp.deleted_at is not null then
    raise exception 'Not found.';
  end if;
  v_price := public.entry_amount(p_payload ->> 'price', 'The price');
  if v_price <= 0 then
    raise exception 'The price must be above zero.';
  end if;
  if v_grade not in ('A', 'B', 'C') then
    raise exception 'Choose the condition grade A, B or C.';
  end if;
  if v_name is null or char_length(v_name) > 120 or v_phone is null or char_length(v_phone) > 40 then
    raise exception 'Enter the seller''s name and phone number.';
  end if;
  if v_idno is not null and (char_length(v_idno) not between 5 and 40 or v_idno !~ '^[0-9A-Za-z -]+$') then
    raise exception 'The CNIC / Emirates ID must be 5 to 40 letters, digits, spaces or dashes.';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'The condition notes cannot be longer than 500 characters.';
  end if;

  if v_price <> cp.price then
    if cp.payment_method = 'trade_in' then
      select * into v_sale from public.sales s where s.id = cp.sale_id for update;
      if v_sale.status <> 'completed' then
        raise exception 'The sale of this trade-in is cancelled.';
      end if;
      if v_sale.paid_amount - cp.price + v_price > v_sale.total then
        raise exception 'The new trade-in value plus what was paid is more than the invoice total.';
      end if;
      update public.sales
         set paid_amount = paid_amount - cp.price + v_price, trade_in_credit = trade_in_credit - cp.price + v_price
       where id = cp.sale_id;
    else
      select * into v_ledger from public.cash_ledger l
      where l.business_id = v_biz and l.ref_type = 'customer_purchase' and l.ref_id = cp.id
        and l.reversal_of is null and l.voided_at is null
      order by l.created_at limit 1;
      if v_ledger.id is not null then
        if v_price > cp.price then
          v_balance := public.finance_balance(v_ledger.account_id);
          if v_balance < v_price - cp.price then
            raise exception 'Not enough money in the account for the higher price. The balance is %.',
              public.finance_format(v_balance);
          end if;
        end if;
        update public.cash_ledger set amount = v_price where id = v_ledger.id;
      end if;
    end if;
    -- The phone's cost follows; if it is already sold, so does the profit
    update public.phone_unit_costs set purchase_cost = v_price, landed_cost = v_price where unit_id = cp.phone_unit_id;
    update public.sale_item_costs c set unit_cost = v_price
      from public.sale_items si
     where c.item_id = si.id and si.phone_unit_id = cp.phone_unit_id;
  end if;

  update public.customer_purchases
     set price = v_price, grade = v_grade, condition_notes = v_notes,
         seller_name = v_name, seller_phone = v_phone, seller_id_number = v_idno
   where id = cp.id;

  perform public.entry_change_log(v_biz, 'customer_purchase', cp.id, 'CP-' || lpad(cp.purchase_no::text, 6, '0'),
    'edit', v_reason,
    jsonb_build_object('price', cp.price, 'grade', cp.grade, 'condition_notes', cp.condition_notes,
                       'seller_name', cp.seller_name, 'seller_phone', cp.seller_phone, 'seller_id_number', cp.seller_id_number),
    jsonb_build_object('price', v_price, 'grade', v_grade, 'condition_notes', v_notes,
                       'seller_name', v_name, 'seller_phone', v_phone, 'seller_id_number', v_idno));
  return jsonb_build_object('id', cp.id);
end;
$$;

revoke all on function public.edit_customer_purchase(jsonb) from public, anon;
grant execute on function public.edit_customer_purchase(jsonb) to authenticated, service_role;


-- 10. Delete an entry (soft delete, effects reversed) --------------------------------------
-- payload: type, id, reason
--   type: sale | purchase | expense | customer_payment | supplier_payment |
--         customer_purchase | customer | supplier
create or replace function public.delete_entry(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := p_payload ->> 'reason';
  v_biz uuid := public.entry_change_start('entries.delete', v_reason);
  v_uid uuid := auth.uid();
  v_type text := p_payload ->> 'type';
  v_id uuid;
  s public.sales%rowtype;
  item public.sale_items%rowtype;
  p public.purchases%rowtype;
  e public.expenses%rowtype;
  cp public.customer_purchases%rowtype;
  v_pay record;
  v_ledger public.cash_ledger%rowtype;
  v_amount numeric;
  v_parent uuid;
  v_created timestamptz;
  v_label text;
  v_old jsonb;
  v_balance numeric;
begin
  begin
    v_id := (p_payload ->> 'id')::uuid;
  exception when others then
    raise exception 'The entry is not valid.';
  end;

  if v_type = 'sale' then
    select * into s from public.sales x where x.id = v_id and x.business_id = v_biz for update;
    if not found or s.deleted_at is not null then raise exception 'Invoice not found.'; end if;
    if s.vat_rate > 0 then
      raise exception 'This is a tax invoice (VAT). It cannot be deleted. Use a return instead.';
    end if;
    if s.returned_total > 0 then
      raise exception 'This invoice has returns, so it cannot be deleted. Return the remaining items instead.';
    end if;
    if s.trade_in_credit > 0 then
      raise exception 'This invoice has a trade-in. Delete the trade-in first (Purchases > Bought from customers).';
    end if;
    v_label := 'INV-' || lpad(s.invoice_no::text, 6, '0');
    v_old := jsonb_build_object('total', s.total, 'paid', s.paid_amount, 'status', s.status);
    if s.status = 'completed' then
      -- Same as cancelling: stock back, payments refunded
      for item in select * from public.sale_items si where si.sale_id = s.id loop
        if item.item_type = 'phone' then
          if exists (select 1 from public.phone_units u
                     where u.business_id = v_biz and u.imei = item.imei and u.status = 'in_stock') then
            raise exception 'The phone with IMEI % is in stock again under another entry. Delete that first.', item.imei;
          end if;
          update public.phone_units
            set status = 'in_stock', sale_id = null, sold_at = null
            where id = item.phone_unit_id and sale_id = s.id and status = 'sold';
        elsif item.item_type = 'accessory' then
          insert into public.product_stock (product_id, business_id, qty)
          values (item.product_id, v_biz, item.quantity)
          on conflict (product_id) do update set qty = public.product_stock.qty + excluded.qty, updated_at = now();
          insert into public.stock_movements (business_id, product_id, qty_change, reason, ref_type, ref_id, created_by)
          values (v_biz, item.product_id, item.quantity, 'return', 'sale_void', s.id, v_uid);
        end if;
      end loop;
      for v_pay in
        select sp.method, sum(sp.amount) as amount from public.sale_payments sp
        where sp.sale_id = s.id and sp.deleted_at is null group by sp.method
      loop
        insert into public.cash_ledger
          (business_id, account, direction, amount, category, party_type, party_id, ref_type, ref_id, notes, created_by)
        values
          (v_biz, v_pay.method, 'out', v_pay.amount, 'other',
           case when s.customer_id is null then null else 'customer' end, s.customer_id,
           'sale_void', s.id, 'Refund for deleted invoice', v_uid);
      end loop;
      update public.sales
        set status = 'void', voided_at = now(), voided_by = v_uid, void_reason = trim(v_reason)
        where id = s.id;
    end if;
    update public.sales set deleted_at = now(), deleted_by = v_uid, delete_reason = trim(v_reason) where id = s.id;

  elsif v_type = 'purchase' then
    select * into p from public.purchases x where x.id = v_id and x.business_id = v_biz for update;
    if not found or p.deleted_at is not null then raise exception 'Purchase not found.'; end if;
    if exists (select 1 from public.phone_units u where u.purchase_id = p.id and u.status <> 'in_stock') then
      raise exception 'Phones of this purchase are already sold or returned. Delete or return those sales first.';
    end if;
    if exists (select 1 from public.purchase_payments pp where pp.purchase_id = p.id and pp.deleted_at is null) then
      raise exception 'This purchase has supplier payments. Delete those payments first.';
    end if;
    v_label := 'Purchase #' || p.purchase_no;
    v_old := jsonb_build_object('total', p.total, 'paid', p.paid_amount, 'status', p.status);
    if p.status = 'completed' then
      -- The existing cancellation reverses stock and the payment made with the purchase
      perform public.cancel_purchase(jsonb_build_object('purchase_id', p.id, 'reason', trim(v_reason)));
    end if;
    update public.purchases set deleted_at = now(), deleted_by = v_uid, delete_reason = trim(v_reason) where id = p.id;

  elsif v_type = 'expense' then
    select * into e from public.expenses x where x.id = v_id and x.business_id = v_biz for update;
    if not found or e.deleted_at is not null then raise exception 'Expense not found.'; end if;
    v_label := e.category || ' ' || e.expense_date;
    v_old := jsonb_build_object('amount', e.amount, 'expense_date', e.expense_date, 'category', e.category);
    if e.voided_at is null then
      perform public.void_expense(jsonb_build_object('expense_id', e.id));
    end if;
    update public.expenses set deleted_at = now(), deleted_by = v_uid, delete_reason = trim(v_reason) where id = e.id;

  elsif v_type in ('customer_payment', 'supplier_payment') then
    if v_type = 'customer_payment' then
      select sp.amount, sp.created_at, sp.sale_id into v_amount, v_created, v_parent
      from public.sale_payments sp where sp.id = v_id and sp.business_id = v_biz and sp.deleted_at is null for update;
      if not found then raise exception 'Payment not found.'; end if;
      select * into s from public.sales x where x.id = v_parent for update;
      if s.status <> 'completed' then raise exception 'The invoice of this payment is cancelled.'; end if;
      v_label := 'Payment on INV-' || lpad(s.invoice_no::text, 6, '0');
      select * into v_ledger from public.cash_ledger l
      where l.business_id = v_biz and l.ref_type = 'sale' and l.ref_id = v_parent and l.direction = 'in'
        and l.reversal_of is null and l.voided_at is null and l.created_at = v_created and l.amount = v_amount
      order by l.id limit 1;
      update public.sales set paid_amount = paid_amount - v_amount where id = v_parent;
      update public.sale_payments set deleted_at = now(), deleted_by = v_uid, delete_reason = trim(v_reason) where id = v_id;
    else
      select pp.amount, pp.created_at, pp.purchase_id into v_amount, v_created, v_parent
      from public.purchase_payments pp where pp.id = v_id and pp.business_id = v_biz and pp.deleted_at is null for update;
      if not found then raise exception 'Payment not found.'; end if;
      select * into p from public.purchases x where x.id = v_parent for update;
      if p.status <> 'completed' then raise exception 'The purchase of this payment is cancelled.'; end if;
      v_label := 'Payment for purchase #' || p.purchase_no;
      select * into v_ledger from public.cash_ledger l
      where l.business_id = v_biz and l.ref_type = 'purchase' and l.ref_id = v_parent and l.direction = 'out'
        and l.reversal_of is null and l.voided_at is null and l.created_at = v_created and l.amount = v_amount
      order by l.id limit 1;
      update public.purchases set paid_amount = paid_amount - v_amount where id = v_parent;
      update public.purchase_payments set deleted_at = now(), deleted_by = v_uid, delete_reason = trim(v_reason) where id = v_id;
    end if;
    v_old := jsonb_build_object('amount', v_amount);
    -- The money movement is reversed in Cash/Bank
    if v_ledger.id is not null then
      if v_ledger.direction = 'in' then
        v_balance := public.finance_balance(v_ledger.account_id);
        if v_balance < v_amount then
          raise exception 'Not enough money in the account to reverse this payment. The balance is %.',
            public.finance_format(v_balance);
        end if;
      end if;
      update public.cash_ledger set voided_at = now(), voided_by = v_uid where id = v_ledger.id;
      insert into public.cash_ledger
        (business_id, entry_date, account, account_id, direction, amount, category, party_type, party_id,
         ref_type, ref_id, notes, created_by, reversal_of)
      values
        (v_biz, (now() at time zone 'Asia/Karachi')::date, v_ledger.account, v_ledger.account_id,
         case when v_ledger.direction = 'in' then 'out' else 'in' end, v_ledger.amount, v_ledger.category,
         v_ledger.party_type, v_ledger.party_id, v_ledger.ref_type, v_ledger.ref_id,
         'Deleted payment: ' || left(trim(v_reason), 200), v_uid, v_ledger.id);
    end if;

  elsif v_type = 'customer_purchase' then
    select * into cp from public.customer_purchases x where x.id = v_id and x.business_id = v_biz for update;
    if not found or cp.deleted_at is not null then raise exception 'Not found.'; end if;
    if not exists (select 1 from public.phone_units u where u.id = cp.phone_unit_id and u.status = 'in_stock') then
      raise exception 'This phone is no longer in stock (sold or returned). Delete or return that sale first.';
    end if;
    v_label := 'CP-' || lpad(cp.purchase_no::text, 6, '0');
    v_old := jsonb_build_object('price', cp.price, 'imei', cp.imei, 'payment_method', cp.payment_method);
    update public.phone_units set status = 'written_off' where id = cp.phone_unit_id;
    if cp.payment_method = 'trade_in' then
      select * into s from public.sales x where x.id = cp.sale_id for update;
      update public.sales
         set paid_amount = paid_amount - cp.price, trade_in_credit = trade_in_credit - cp.price
       where id = cp.sale_id;
    else
      select * into v_ledger from public.cash_ledger l
      where l.business_id = v_biz and l.ref_type = 'customer_purchase' and l.ref_id = cp.id
        and l.reversal_of is null and l.voided_at is null
      order by l.created_at limit 1;
      if v_ledger.id is not null then
        update public.cash_ledger set voided_at = now(), voided_by = v_uid where id = v_ledger.id;
        insert into public.cash_ledger
          (business_id, entry_date, account, account_id, direction, amount, category, party_type, party_id,
           ref_type, ref_id, notes, created_by, reversal_of)
        values
          (v_biz, (now() at time zone 'Asia/Karachi')::date, v_ledger.account, v_ledger.account_id, 'in',
           v_ledger.amount, v_ledger.category, v_ledger.party_type, v_ledger.party_id, v_ledger.ref_type,
           v_ledger.ref_id, 'Deleted: ' || left(trim(v_reason), 200), v_uid, v_ledger.id);
      end if;
    end if;
    update public.customer_purchases set deleted_at = now(), deleted_by = v_uid, delete_reason = trim(v_reason)
     where id = cp.id;

  elsif v_type = 'customer' then
    select coalesce(sum(x.total - x.paid_amount), 0) into v_balance
    from public.sales x where x.customer_id = v_id and x.business_id = v_biz and x.status = 'completed';
    if not exists (select 1 from public.customers c where c.id = v_id and c.business_id = v_biz and c.deleted_at is null) then
      raise exception 'Customer not found.';
    end if;
    if v_balance <> 0 then
      raise exception 'This customer still owes %. Receive or settle that first.', public.finance_format(v_balance);
    end if;
    select c.name into v_label from public.customers c where c.id = v_id;
    v_old := jsonb_build_object('name', v_label);
    update public.customers
       set is_active = false, deleted_at = now(), deleted_by = v_uid, delete_reason = trim(v_reason)
     where id = v_id;

  elsif v_type = 'supplier' then
    select coalesce(sum(x.total - x.paid_amount), 0) into v_balance
    from public.purchases x where x.supplier_id = v_id and x.business_id = v_biz and x.status = 'completed';
    if not exists (select 1 from public.suppliers c where c.id = v_id and c.business_id = v_biz and c.deleted_at is null) then
      raise exception 'Supplier not found.';
    end if;
    if v_balance <> 0 then
      raise exception 'We still owe this supplier %. Pay or settle that first.', public.finance_format(v_balance);
    end if;
    select c.name into v_label from public.suppliers c where c.id = v_id;
    v_old := jsonb_build_object('name', v_label);
    update public.suppliers
       set is_active = false, deleted_at = now(), deleted_by = v_uid, delete_reason = trim(v_reason)
     where id = v_id;

  else
    raise exception 'This kind of entry cannot be deleted.';
  end if;

  perform public.entry_change_log(v_biz, v_type, v_id, v_label, 'delete', v_reason, v_old, null);
  return jsonb_build_object('deleted', v_id);
end;
$$;

revoke all on function public.delete_entry(jsonb) from public, anon;
grant execute on function public.delete_entry(jsonb) to authenticated, service_role;

commit;
