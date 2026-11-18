-- =============================================================================
-- "Item not in stock" sale lines
--
-- A sale line for a phone, accessory or part that the shop does not have in
-- stock and buys from another shop on the spot. The line (item_type
-- 'unstocked') has a free name, a sale price, the cost the shop paid and an
-- optional IMEI or serial number for the invoice and warranty.
--
-- It never touches inventory: no phone unit, no product, no stock movement,
-- no purchase and no supplier. It counts only in sales and profit: its cost
-- is saved in sale_item_costs like every other line, so the dashboard and
-- reports already use profit = line total - cost. VAT is calculated on the
-- sale total, so it covers these lines too.
--
-- A return refunds the money and reverses the profit (line total - cost)
-- without any stock change. Cancelling an invoice changes no stock for it.
--
-- One idempotent migration: it can be run more than once and only adds or
-- replaces objects. It never deletes rows and never changes existing rows.
-- The functions below are the versions read from gwadar-test on
-- 19 Nov 2026 with only the 'unstocked' parts added.
--
-- It runs as one transaction: if any statement fails, nothing is changed.
-- Run it in the Supabase SQL Editor. It contains no test data.
-- =============================================================================

begin;

-- 0. Safety check: stop unless this is a database of this app ----------------
do $$
begin
  if to_regclass('public.sale_items') is null or to_regclass('public.sale_item_costs') is null
     or to_regclass('public.sales_returns') is null
     or to_regprocedure('public.create_sale(jsonb)') is null
     or to_regprocedure('public.cancel_sale(jsonb)') is null
     or to_regprocedure('public.sales_return_lines(uuid, uuid, jsonb)') is null
     or to_regprocedure('public.create_warranty_claim(jsonb)') is null then
    raise exception 'Stopped: this database does not have the sale functions of this app. Check that the right project is open.';
  end if;
end;
$$;


-- 1. Allow the new line type --------------------------------------------------
alter table public.sale_items drop constraint if exists sale_items_item_type_check;
alter table public.sale_items add constraint sale_items_item_type_check
  check (item_type in ('phone', 'accessory', 'unstocked'));

-- An unstocked line never points to stock
alter table public.sale_items drop constraint if exists sale_items_unstocked_check;
alter table public.sale_items add constraint sale_items_unstocked_check
  check (item_type <> 'unstocked' or (phone_unit_id is null and product_id is null));


-- 2. create_sale: accept 'unstocked' lines ------------------------------------
-- Line payload: item_type 'unstocked', description (1-200 characters),
-- quantity (1-10000), unit_price, discount, unit_cost (0 or more),
-- imei (optional IMEI or serial, up to 40 characters), warranty_days.
create or replace function public.create_sale(p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_biz uuid := public.my_business_id();
  v_uid uuid := auth.uid();
  v_items jsonb := p_payload -> 'items';
  v_item jsonb;
  v_type text;
  v_unit public.phone_units%rowtype;
  v_product public.products%rowtype;
  v_qty integer;
  v_price numeric(14,2);
  v_disc numeric(14,2);
  v_line numeric(14,2);
  v_cost numeric(14,4);
  v_warranty integer;
  v_subtotal numeric(14,2) := 0;
  v_header_disc numeric(14,2);
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_method text;
  v_customer uuid;
  v_cname text;
  v_cphone text;
  v_found_id uuid;
  v_found_name text;
  v_sale uuid;
  v_no integer;
  v_item_id uuid;
  v_desc text;
  v_terms text;
  v_stock numeric;
  v_serial text;
begin
  if v_uid is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('sales.create') then
    raise exception 'You do not have permission to create sales.';
  end if;
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Add at least one item to the sale.';
  end if;
  if jsonb_array_length(v_items) > 100 then
    raise exception 'A sale can have at most 100 lines.';
  end if;

  v_header_disc := coalesce(nullif(p_payload ->> 'discount', '')::numeric, 0);
  v_paid := coalesce(nullif(p_payload ->> 'paid_amount', '')::numeric, 0);
  v_method := nullif(p_payload ->> 'payment_method', '');
  if v_header_disc < 0 or v_paid < 0 then
    raise exception 'Amounts cannot be negative.';
  end if;
  if v_paid > 0 and v_method is distinct from 'cash' and v_method is distinct from 'bank' then
    raise exception 'Choose cash or bank for the payment.';
  end if;

  -- Pass 1: validate every line and calculate the totals
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_type := v_item ->> 'item_type';
    v_price := (v_item ->> 'unit_price')::numeric;
    v_disc := coalesce(nullif(v_item ->> 'discount', '')::numeric, 0);
    v_warranty := coalesce(nullif(v_item ->> 'warranty_days', '')::integer, 0);
    if v_price is null or v_price < 0 then
      raise exception 'Every line needs a selling price of zero or more.';
    end if;
    if v_disc < 0 then
      raise exception 'A discount cannot be negative.';
    end if;
    if v_warranty < 0 or v_warranty > 3650 then
      raise exception 'Warranty days must be between 0 and 3650.';
    end if;

    if v_type = 'phone' then
      select * into v_unit from public.phone_units u
        where u.id = (v_item ->> 'phone_unit_id')::uuid and u.business_id = v_biz;
      if not found then
        raise exception 'A phone line refers to a phone that does not exist.';
      end if;
      if v_unit.status <> 'in_stock' then
        raise exception 'The phone with IMEI % is not in stock.', v_unit.imei;
      end if;
      v_qty := 1;
      select c.landed_cost into v_cost from public.phone_unit_costs c where c.unit_id = v_unit.id;
    elsif v_type = 'accessory' then
      v_qty := (v_item ->> 'quantity')::integer;
      if v_qty is null or v_qty < 1 or v_qty > 10000 then
        raise exception 'Accessory quantity must be between 1 and 10000.';
      end if;
      select * into v_product from public.products p
        where p.id = (v_item ->> 'product_id')::uuid and p.business_id = v_biz and p.is_active;
      if not found then
        raise exception 'A line has an invalid or inactive accessory.';
      end if;
      select ps.qty into v_stock from public.product_stock ps where ps.product_id = v_product.id;
      if coalesce(v_stock, 0) < v_qty then
        raise exception 'Only % in stock for %.', coalesce(v_stock, 0)::integer, v_product.name;
      end if;
      select pc.avg_cost into v_cost from public.product_costs pc where pc.product_id = v_product.id;
    elsif v_type = 'unstocked' then
      -- Not in stock: bought from another shop on the spot. No stock is used.
      v_qty := (v_item ->> 'quantity')::integer;
      if v_qty is null or v_qty < 1 or v_qty > 10000 then
        raise exception 'Quantity must be between 1 and 10000.';
      end if;
      v_desc := nullif(trim(regexp_replace(coalesce(v_item ->> 'description', ''), '\s+', ' ', 'g')), '');
      if v_desc is null or char_length(v_desc) > 200 then
        raise exception 'Enter the item name (up to 200 characters) for every item that is not in stock.';
      end if;
      v_serial := nullif(trim(coalesce(v_item ->> 'imei', '')), '');
      if v_serial is not null and char_length(v_serial) > 40 then
        raise exception 'The IMEI or serial number cannot be longer than 40 characters.';
      end if;
      v_cost := nullif(v_item ->> 'unit_cost', '')::numeric;
      if v_cost is null or v_cost < 0 or v_cost <> round(v_cost, 2) then
        raise exception 'Enter the cost price (zero or more, up to 2 decimals) for %.', v_desc;
      end if;
    else
      raise exception 'Unknown line type.';
    end if;

    if v_disc > round(v_price * v_qty, 2) then
      raise exception 'A line discount cannot be more than the line amount.';
    end if;
    v_line := round(v_price * v_qty, 2) - v_disc;
    -- Selling below purchase cost needs a special permission
    if v_line < round(coalesce(v_cost, 0) * v_qty, 2)
       and not public.has_permission('sales.override_min_price') then
      raise exception 'The price is below the purchase cost. You do not have permission to sell below cost.';
    end if;
    v_subtotal := v_subtotal + v_line;
  end loop;

  if v_header_disc > v_subtotal then
    raise exception 'The discount cannot be more than the subtotal.';
  end if;
  v_total := v_subtotal - v_header_disc;
  if v_paid > v_total then
    raise exception 'The paid amount cannot be more than the invoice total.';
  end if;

  -- Customer: use an existing one, or find / create by phone number
  v_customer := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_cname := nullif(trim(p_payload ->> 'customer_name'), '');
  v_cphone := nullif(regexp_replace(coalesce(p_payload ->> 'customer_phone', ''), '[^0-9+]', '', 'g'), '');
  if v_customer is not null then
    select c.name, c.phone into v_cname, v_cphone
      from public.customers c where c.id = v_customer and c.business_id = v_biz and c.is_active;
    if not found then
      raise exception 'Please choose an active customer.';
    end if;
  elsif v_cphone is not null then
    select c.id, c.name into v_found_id, v_found_name
      from public.customers c where c.business_id = v_biz and c.phone = v_cphone;
    if v_found_id is not null then
      v_customer := v_found_id;
      v_cname := v_found_name;
    else
      insert into public.customers (business_id, name, phone, created_by)
      values (v_biz, coalesce(v_cname, v_cphone), v_cphone, v_uid)
      returning id, name into v_customer, v_cname;
    end if;
  end if;
  if v_total - v_paid > 0 and (v_customer is null) then
    raise exception 'Enter the customer name and phone number when part of the amount is unpaid.';
  end if;

  select b.warranty_terms into v_terms from public.businesses b where b.id = v_biz;

  v_no := public.next_doc_no(v_biz, 'invoice');
  insert into public.sales
    (business_id, invoice_no, customer_id, customer_name, customer_phone, subtotal, discount, total,
     paid_amount, payment_method, warranty_terms, notes, created_by)
  values
    (v_biz, v_no, v_customer, v_cname, v_cphone, v_subtotal, v_header_disc, v_total,
     v_paid, case when v_paid > 0 then v_method else null end, v_terms,
     nullif(trim(p_payload ->> 'notes'), ''), v_uid)
  returning id into v_sale;

  -- Pass 2: save lines, update stock, keep the cost for profit
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_type := v_item ->> 'item_type';
    v_price := (v_item ->> 'unit_price')::numeric;
    v_disc := coalesce(nullif(v_item ->> 'discount', '')::numeric, 0);
    v_warranty := coalesce(nullif(v_item ->> 'warranty_days', '')::integer, 0);

    if v_type = 'phone' then
      select * into v_unit from public.phone_units u where u.id = (v_item ->> 'phone_unit_id')::uuid;
      v_qty := 1;
      v_line := v_price - v_disc;
      v_desc := v_unit.model_name || ' ' || v_unit.storage_gb || 'GB' || coalesce(' ' || v_unit.color_name, '');
      select c.landed_cost into v_cost from public.phone_unit_costs c where c.unit_id = v_unit.id;

      update public.phone_units
        set status = 'sold', sale_id = v_sale, sold_at = now()
        where id = v_unit.id and status = 'in_stock';
      if not found then
        raise exception 'The phone with IMEI % was just sold. Please refresh and try again.', v_unit.imei;
      end if;

      insert into public.sale_items
        (business_id, sale_id, item_type, description, condition, phone_unit_id, imei, quantity,
         unit_price, discount, line_total, warranty_days)
      values (v_biz, v_sale, 'phone', v_desc, v_unit.condition, v_unit.id, v_unit.imei, 1,
              v_price, v_disc, v_line, v_warranty)
      returning id into v_item_id;
    elsif v_type = 'unstocked' then
      -- No stock change, no purchase, no supplier: only the line and its cost
      v_qty := (v_item ->> 'quantity')::integer;
      v_line := round(v_price * v_qty, 2) - v_disc;
      v_desc := trim(regexp_replace(v_item ->> 'description', '\s+', ' ', 'g'));
      v_serial := nullif(trim(coalesce(v_item ->> 'imei', '')), '');
      v_cost := (v_item ->> 'unit_cost')::numeric;

      insert into public.sale_items
        (business_id, sale_id, item_type, description, imei, quantity,
         unit_price, discount, line_total, warranty_days)
      values (v_biz, v_sale, 'unstocked', v_desc, v_serial, v_qty,
              v_price, v_disc, v_line, v_warranty)
      returning id into v_item_id;
    else
      v_qty := (v_item ->> 'quantity')::integer;
      v_line := round(v_price * v_qty, 2) - v_disc;
      select * into v_product from public.products p where p.id = (v_item ->> 'product_id')::uuid;
      select pc.avg_cost into v_cost from public.product_costs pc where pc.product_id = v_product.id;

      update public.product_stock
        set qty = qty - v_qty, updated_at = now()
        where product_id = v_product.id and qty >= v_qty;
      if not found then
        raise exception 'Not enough stock for %. Please refresh and try again.', v_product.name;
      end if;

      insert into public.stock_movements (business_id, product_id, qty_change, unit_cost, reason, ref_type, ref_id, created_by)
      values (v_biz, v_product.id, -v_qty, v_cost, 'sale', 'sale', v_sale, v_uid);

      insert into public.sale_items
        (business_id, sale_id, item_type, description, product_id, quantity,
         unit_price, discount, line_total, warranty_days)
      values (v_biz, v_sale, 'accessory', v_product.name, v_product.id, v_qty,
              v_price, v_disc, v_line, v_warranty)
      returning id into v_item_id;
    end if;

    insert into public.sale_item_costs (item_id, business_id, unit_cost)
    values (v_item_id, v_biz, coalesce(v_cost, 0));
  end loop;

  if v_paid > 0 then
    insert into public.sale_payments (business_id, sale_id, amount, method, kind, created_by)
    values (v_biz, v_sale, v_paid, v_method, 'at_sale', v_uid);
    insert into public.cash_ledger
      (business_id, account, direction, amount, category, party_type, party_id, ref_type, ref_id, created_by)
    values
      (v_biz, v_method, 'in', v_paid, 'sale_receipt',
       case when v_customer is null then null else 'customer' end, v_customer, 'sale', v_sale, v_uid);
  end if;

  return jsonb_build_object('sale_id', v_sale, 'invoice_no', v_no, 'total', v_total,
                            'paid', v_paid, 'balance', v_total - v_paid);
end;
$function$;


-- 3. cancel_sale: an unstocked line changes no stock ---------------------------
create or replace function public.cancel_sale(p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_biz uuid := public.my_business_id();
  v_uid uuid := auth.uid();
  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
  v_reason text := nullif(trim(p_payload ->> 'reason'), '');
  v_pay record;
  v_refunded numeric(14,2) := 0;
begin
  if v_uid is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('returns.manage') then
    raise exception 'You do not have permission to cancel invoices.';
  end if;

  select * into v_sale from public.sales s
    where s.id = (p_payload ->> 'sale_id')::uuid and s.business_id = v_biz
    for update;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if v_sale.status = 'void' then
    raise exception 'This invoice is already cancelled.';
  end if;

  for v_item in select * from public.sale_items si where si.sale_id = v_sale.id loop
    if v_item.item_type = 'phone' then
      if exists (select 1 from public.phone_units u
                 where u.business_id = v_biz and u.imei = v_item.imei and u.status = 'in_stock') then
        raise exception 'Cannot cancel: the phone with IMEI % has been added to stock again.', v_item.imei;
      end if;
      update public.phone_units
        set status = 'in_stock', sale_id = null, sold_at = null
        where id = v_item.phone_unit_id and sale_id = v_sale.id and status = 'sold';
    elsif v_item.item_type = 'accessory' then
      insert into public.product_stock (product_id, business_id, qty)
      values (v_item.product_id, v_biz, v_item.quantity)
      on conflict (product_id) do update set qty = public.product_stock.qty + excluded.qty, updated_at = now();
      insert into public.stock_movements (business_id, product_id, qty_change, reason, ref_type, ref_id, created_by)
      values (v_biz, v_item.product_id, v_item.quantity, 'return', 'sale_void', v_sale.id, v_uid);
    end if;
    -- 'unstocked' lines were never in stock: nothing to put back
  end loop;

  -- Refund everything the customer paid (at the counter and later), by payment method
  for v_pay in
    select sp.method, sum(sp.amount) as amount from public.sale_payments sp
    where sp.sale_id = v_sale.id group by sp.method
  loop
    insert into public.cash_ledger
      (business_id, account, direction, amount, category, party_type, party_id, ref_type, ref_id, notes, created_by)
    values
      (v_biz, v_pay.method, 'out', v_pay.amount, 'other',
       case when v_sale.customer_id is null then null else 'customer' end, v_sale.customer_id,
       'sale_void', v_sale.id, 'Refund for cancelled invoice', v_uid);
    v_refunded := v_refunded + v_pay.amount;
  end loop;

  update public.sales
    set status = 'void', voided_at = now(), voided_by = v_uid, void_reason = v_reason
    where id = v_sale.id;

  return jsonb_build_object('sale_id', v_sale.id, 'refunded', v_refunded);
end;
$function$;


-- 4. sales_return_lines: an unstocked line reverses its profit, no stock change --
create or replace function public.sales_return_lines(p_business_id uuid, p_sale_id uuid, p_items jsonb)
returns table (
  sale_item_id uuid, item_type text, description text, quantity integer, line_total numeric,
  unit_cost numeric, restock boolean, phone_unit_id uuid, imei text, product_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  s public.sales%rowtype;
  it jsonb;
  si public.sale_items%rowtype;
  v_id uuid;
  v_qty integer;
  v_done integer;
  v_done_value numeric;
  v_share numeric;
  v_value numeric;
  v_left numeric;
  v_seen uuid[] := '{}';
begin
  select * into s from public.sales x where x.id = p_sale_id and x.business_id = p_business_id;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if s.status <> 'completed' then
    raise exception 'This invoice is cancelled.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one item to return.';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Too many items in one return.';
  end if;

  v_left := s.total - s.returned_total;

  for it in select value from jsonb_array_elements(p_items) loop
    begin
      v_id := (it ->> 'sale_item_id')::uuid;
      v_qty := (it ->> 'quantity')::integer;
    exception when others then
      raise exception 'An item in the return is not valid.';
    end;
    if v_id is null then
      raise exception 'An item in the return is not valid.';
    end if;
    if v_id = any (v_seen) then
      raise exception 'An item is listed twice.';
    end if;
    v_seen := v_seen || v_id;

    select * into si from public.sale_items x where x.id = v_id and x.sale_id = s.id;
    if not found then
      raise exception 'An item does not belong to this invoice.';
    end if;
    if v_qty is null or v_qty < 1 then
      raise exception 'Enter a quantity of at least 1 for %.', si.description;
    end if;

    select coalesce(sum(ri.quantity), 0), coalesce(sum(ri.line_total), 0)
      into v_done, v_done_value
    from public.sales_return_items ri where ri.sale_item_id = si.id;
    if v_qty > si.quantity - v_done then
      raise exception 'Only % of % can still be returned.', si.quantity - v_done, si.description;
    end if;

    if si.item_type = 'phone' then
      if si.phone_unit_id is null or not exists (
           select 1 from public.phone_units u
           where u.id = si.phone_unit_id and u.sale_id = s.id and u.status = 'sold') then
        raise exception 'The phone with IMEI % is not marked as sold on this invoice.', si.imei;
      end if;
    end if;

    v_share := case when s.subtotal > 0 then round(si.line_total * s.total / s.subtotal, 2) else 0 end;
    if v_done + v_qty = si.quantity then
      v_value := v_share - v_done_value;
    else
      v_value := round(v_share * v_qty / si.quantity, 2);
    end if;
    v_value := greatest(least(v_value, v_left), 0);
    v_left := v_left - v_value;

    sale_item_id := si.id;
    item_type := si.item_type;
    description := si.description;
    quantity := v_qty;
    line_total := v_value;
    unit_cost := coalesce((select c.unit_cost from public.sale_item_costs c where c.item_id = si.id), 0);
    -- An unstocked line has no stock to put back, but its cost comes back like
    -- a restocked item, so the return reverses exactly its profit
    restock := case when si.item_type = 'unstocked' then true
                    else coalesce((it ->> 'restock')::boolean, true) end;
    phone_unit_id := si.phone_unit_id;
    imei := si.imei;
    product_id := si.product_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.sales_return_lines(uuid, uuid, jsonb) from public, anon, authenticated;


-- 5. create_warranty_claim: accept a serial number on unstocked lines ---------
create or replace function public.create_warranty_claim(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  v_uid uuid := auth.uid();
  v_item_id uuid;
  si public.sale_items%rowtype;
  s public.sales%rowtype;
  v_issue text := nullif(trim(coalesce(p_payload ->> 'issue', '')), '');
  v_desc text := nullif(trim(coalesce(p_payload ->> 'item_description', '')), '');
  v_imei text := nullif(regexp_replace(coalesce(p_payload ->> 'imei', ''), '\s', '', 'g'), '');
  v_name text := nullif(trim(coalesce(p_payload ->> 'customer_name', '')), '');
  v_phone text := nullif(trim(coalesce(p_payload ->> 'customer_phone', '')), '');
  v_customer uuid;
  v_sale uuid;
  v_expires date;
  v_under boolean := false;
  v_date date := public.finance_entry_date(p_payload ->> 'received_on');
  v_no integer;
  v_id uuid;
begin
  if v_uid is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('returns.manage') then
    raise exception 'You do not have permission to record warranty claims.';
  end if;
  if v_issue is null or char_length(v_issue) > 1000 then
    raise exception 'Describe the problem (up to 1000 characters).';
  end if;
  begin
    v_item_id := nullif(p_payload ->> 'sale_item_id', '')::uuid;
  exception when others then
    raise exception 'The sold item is not valid.';
  end;

  if v_item_id is not null then
    select * into si from public.sale_items x where x.id = v_item_id and x.business_id = v_biz;
    if not found then
      raise exception 'The sold item was not found.';
    end if;
    select * into s from public.sales x where x.id = si.sale_id;
    if s.status <> 'completed' then
      raise exception 'This invoice is cancelled.';
    end if;
    if exists (select 1 from public.warranty_claims w where w.sale_item_id = si.id and w.status <> 'returned') then
      raise exception 'This item already has an open warranty claim.';
    end if;
    if si.quantity <= coalesce((select sum(ri.quantity) from public.sales_return_items ri
                                where ri.sale_item_id = si.id), 0) then
      raise exception 'This item was returned, so it cannot have a warranty claim.';
    end if;
    v_sale := s.id;
    v_customer := s.customer_id;
    v_desc := si.description;
    v_imei := si.imei;
    v_name := coalesce(s.customer_name, (select c.name from public.customers c where c.id = s.customer_id));
    v_phone := coalesce(s.customer_phone, (select c.phone from public.customers c where c.id = s.customer_id));
    if si.warranty_days > 0 then
      v_expires := (s.created_at at time zone 'Asia/Karachi')::date + si.warranty_days;
      v_under := v_date <= v_expires;
    end if;
  else
    if v_desc is null or char_length(v_desc) > 200 then
      raise exception 'Describe the item (up to 200 characters).';
    end if;
  end if;

  -- Unstocked lines may carry any serial number instead of a 15-digit IMEI
  if v_imei is not null and v_imei !~ '^\d{15}$'
     and (v_item_id is null or si.item_type is distinct from 'unstocked') then
    raise exception 'The IMEI must be 15 digits.';
  end if;
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'The customer name cannot be longer than 120 characters.';
  end if;
  if v_phone is not null and char_length(v_phone) > 30 then
    raise exception 'The phone number cannot be longer than 30 characters.';
  end if;

  v_no := public.next_doc_no(v_biz, 'warranty_claim');
  insert into public.warranty_claims
    (business_id, claim_no, sale_id, sale_item_id, customer_id, customer_name, customer_phone,
     item_description, imei, warranty_expires_on, under_warranty, issue, received_on, created_by)
  values
    (v_biz, v_no, v_sale, v_item_id, v_customer, v_name, v_phone,
     v_desc, v_imei, v_expires, v_under, v_issue, v_date, v_uid)
  returning id into v_id;

  insert into public.warranty_claim_events (business_id, claim_id, status, note, created_by)
  values (v_biz, v_id, 'received', null, v_uid);

  return jsonb_build_object('claim_id', v_id, 'claim_no', v_no);
end;
$$;

revoke all on function public.create_warranty_claim(jsonb) from public, anon;
grant execute on function public.create_warranty_claim(jsonb) to authenticated, service_role;

commit;
