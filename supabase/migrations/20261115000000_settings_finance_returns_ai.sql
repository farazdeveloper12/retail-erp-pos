-- =============================================================================
-- Settings, Cash & Bank, Returns & Warranty and AI Assistant
--
-- One idempotent migration: it can be run more than once and only adds or
-- replaces objects. It never deletes rows and never changes existing data,
-- except where a section says so explicitly.
-- Run it in the Supabase SQL Editor of the TEST project first, then (after
-- approval) once on the real project.
-- =============================================================================


-- =============================================================================
-- 1. SETTINGS
-- =============================================================================

-- 1.1 New business settings (all optional, with safe defaults) ---------------
alter table public.businesses
  add column if not exists invoice_footer text,
  add column if not exists date_format text not null default 'medium',
  add column if not exists invoice_paper text not null default 'a4',
  add column if not exists invoice_show_logo boolean not null default true,
  add column if not exists invoice_show_customer_phone boolean not null default true,
  add column if not exists invoice_show_warranty boolean not null default true,
  add column if not exists invoice_show_payment_method boolean not null default true,
  add column if not exists low_stock_threshold integer not null default 5;

alter table public.businesses drop constraint if exists businesses_invoice_footer_check;
alter table public.businesses add constraint businesses_invoice_footer_check
  check (invoice_footer is null or char_length(invoice_footer) <= 500);

alter table public.businesses drop constraint if exists businesses_date_format_check;
alter table public.businesses add constraint businesses_date_format_check
  check (date_format in ('medium', 'dmy', 'mdy', 'iso'));

alter table public.businesses drop constraint if exists businesses_invoice_paper_check;
alter table public.businesses add constraint businesses_invoice_paper_check
  check (invoice_paper in ('a4', 'thermal'));

alter table public.businesses drop constraint if exists businesses_low_stock_threshold_check;
alter table public.businesses add constraint businesses_low_stock_threshold_check
  check (low_stock_threshold between 0 and 1000);

alter table public.businesses drop constraint if exists businesses_logo_url_check;
-- "not valid": checks new and changed rows only, so an older logo value can
-- never make this migration fail.
alter table public.businesses add constraint businesses_logo_url_check
  check (logo_url is null or (char_length(logo_url) <= 500 and logo_url ~* '^https://')) not valid;


-- 1.2 Expense categories (managed in Settings, used as suggestions) ----------
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.my_business_id() references public.businesses (id),
  name text not null,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_categories_name_check
    check (char_length(trim(name)) between 1 and 60)
);

create unique index if not exists expense_categories_name_key
  on public.expense_categories (business_id, lower(trim(name)));

alter table public.expense_categories enable row level security;

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories for select
  using (business_id = public.my_business_id()
         and (public.has_permission('expenses.view') or public.has_permission('expenses.manage')
              or public.has_permission('settings.manage')));

drop policy if exists expense_categories_insert on public.expense_categories;
create policy expense_categories_insert on public.expense_categories for insert
  with check (business_id = public.my_business_id() and created_by = auth.uid()
              and public.has_permission('settings.manage'));

drop policy if exists expense_categories_update on public.expense_categories;
create policy expense_categories_update on public.expense_categories for update
  using (business_id = public.my_business_id() and public.has_permission('settings.manage'))
  with check (business_id = public.my_business_id() and public.has_permission('settings.manage'));

drop trigger if exists expense_categories_set_updated_at on public.expense_categories;
create trigger expense_categories_set_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();


-- 1.3 Let every user change their own display name -------------------------
create or replace function public.update_my_profile(p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_full_name, ''));
begin
  if auth.uid() is null then
    raise exception 'You are not signed in.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Your name must be between 2 and 80 characters.';
  end if;
  update public.profiles set full_name = v_name, updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.update_my_profile(text) from public, anon;
grant execute on function public.update_my_profile(text) to authenticated, service_role;


-- 1.4 Storage bucket for the shop logo -------------------------------------
-- Public read (the logo is printed on invoices); upload limited to 512 KB and
-- PNG, JPEG or WebP. Files live under "<business id>/..." and only users with
-- settings.manage in that business can upload, replace or remove them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', true, 524288,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists business_logos_select on storage.objects;
create policy business_logos_select on storage.objects for select to authenticated
  using (bucket_id = 'business-logos'
         and (storage.foldername(name))[1] = public.my_business_id()::text);

drop policy if exists business_logos_insert on storage.objects;
create policy business_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'business-logos'
              and (storage.foldername(name))[1] = public.my_business_id()::text
              and public.has_permission('settings.manage'));

drop policy if exists business_logos_update on storage.objects;
create policy business_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'business-logos'
         and (storage.foldername(name))[1] = public.my_business_id()::text
         and public.has_permission('settings.manage'))
  with check (bucket_id = 'business-logos'
              and (storage.foldername(name))[1] = public.my_business_id()::text
              and public.has_permission('settings.manage'));

drop policy if exists business_logos_delete on storage.objects;
create policy business_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'business-logos'
         and (storage.foldername(name))[1] = public.my_business_id()::text
         and public.has_permission('settings.manage'));


-- 1.5 Dashboard ------------------------------------------------------------
-- Same function as before, with these changes:
--   * the low stock limit comes from Settings (businesses.low_stock_threshold)
--     instead of a fixed 5;
--   * the bank balance also includes wallet accounts (section 2);
--   * sales, profit and purchases are reduced by returns, and "cash received
--     on sales" leaves out return credits (section 3). The return tables are
--     created further down; a function body is only checked when it runs.
create or replace function public.get_dashboard(p_from date, p_to date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_biz uuid := public.my_business_id();
  v_fin boolean := public.has_permission('dashboard.financial') or public.has_permission('reports.financial');
  v_basic boolean := public.has_permission('dashboard.view') or public.has_permission('reports.basic') or v_fin;
  v_low_stock numeric := coalesce(
    (select b.low_stock_threshold from public.businesses b where b.id = public.my_business_id()), 5);
  r jsonb;
begin
  if auth.uid() is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not v_basic then
    raise exception 'You do not have permission to view the dashboard.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a valid date range of at most one year.';
  end if;

  with sale_rows as (
    select s.id, s.total, s.discount, s.paid_amount - s.return_credit as paid_amount,
           (s.created_at at time zone 'Asia/Karachi')::date as day
    from public.sales s
    where s.business_id = v_biz and s.status = 'completed'
      and (s.created_at at time zone 'Asia/Karachi')::date between p_from and p_to
  ),
  sale_profit as (
    select sr.id, sr.day,
           coalesce(sum(si.line_total - c.unit_cost * si.quantity), 0) - sr.discount as profit
    from sale_rows sr
    left join public.sale_items si on si.sale_id = sr.id
    left join public.sale_item_costs c on c.item_id = si.id
    group by sr.id, sr.day, sr.discount
  ),
  daily_sales as (
    select sr.day, count(*) as sales_count, sum(sr.total) as sales_total,
           coalesce(sum(sp.profit), 0) as profit
    from sale_rows sr join sale_profit sp on sp.id = sr.id
    group by sr.day
  ),
  -- Returns count on the day of the return. Profit loses the returned value,
  -- and gets the cost back when the item went back into stock.
  daily_returns as (
    select r.return_date as day, sum(ri.line_total) as amount,
           sum(ri.line_total - case when ri.restock then coalesce(rc.unit_cost, 0) * ri.quantity else 0 end) as profit
    from public.sales_returns r
    join public.sales_return_items ri on ri.return_id = r.id
    left join public.sales_return_item_costs rc on rc.item_id = ri.id
    where r.business_id = v_biz and r.return_date between p_from and p_to
    group by r.return_date
  ),
  daily as (
    select coalesce(s.day, r.day) as day,
           coalesce(s.sales_count, 0) as sales_count,
           coalesce(s.sales_total, 0) - coalesce(r.amount, 0) as sales_total,
           coalesce(s.profit, 0) - coalesce(r.profit, 0) as profit
    from daily_sales s
    full join daily_returns r on r.day = s.day
  ),
  top_items as (
    select si.description, sum(si.quantity) as qty, sum(si.line_total) as amount
    from sale_rows sr join public.sale_items si on si.sale_id = sr.id
    group by si.description
    order by sum(si.line_total) desc
    limit 10
  ),
  exp_cat as (
    select e.category, sum(e.amount) as amount
    from public.expenses e
    where e.business_id = v_biz and e.voided_at is null and e.expense_date between p_from and p_to
    group by e.category order by sum(e.amount) desc
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'financial', v_fin,
    'sales_total', coalesce((select sum(sales_total) from daily), 0),
    'returns_total', coalesce((select sum(amount) from daily_returns), 0),
    'sales_count', (select count(*) from sale_rows),
    'sales_paid', coalesce((select sum(paid_amount) from sale_rows), 0),
    'receivable', coalesce((select sum(s.total - s.paid_amount) from public.sales s
                            where s.business_id = v_biz and s.status = 'completed' and s.total > s.paid_amount), 0),
    'phones_in_stock', (select count(*) from public.phone_units u where u.business_id = v_biz and u.status = 'in_stock'),
    'accessory_units', coalesce((select sum(qty) from public.product_stock ps where ps.business_id = v_biz), 0),
    'low_stock_count', (select count(*) from public.product_stock ps join public.products p on p.id = ps.product_id
                        where ps.business_id = v_biz and p.is_active and ps.qty <= v_low_stock),
    'low_stock_threshold', v_low_stock,
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'sales_count', d.sales_count,
                        'sales_total', d.sales_total) order by d.day) from daily d), '[]'::jsonb),
    'daily_full', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'sales_count', d.sales_count,
                        'sales_total', d.sales_total, 'profit', d.profit) order by d.day) from daily d), '[]'::jsonb),
    'profit', coalesce((select sum(profit) from daily), 0),
    'top_items', coalesce((select jsonb_agg(jsonb_build_object('description', t.description, 'qty', t.qty,
                        'amount', t.amount)) from top_items t), '[]'::jsonb)
  ) into r;

  if v_fin then
    r := r || jsonb_build_object(
      'purchases_total', coalesce((select sum(p.total) from public.purchases p
                  where p.business_id = v_biz and p.purchase_date between p_from and p_to and p.status = 'completed'), 0)
                  - coalesce((select sum(pr.total) from public.purchase_returns pr
                  where pr.business_id = v_biz and pr.return_date between p_from and p_to), 0),
      'expenses_total', coalesce((select sum(e.amount) from public.expenses e
                  where e.business_id = v_biz and e.voided_at is null and e.expense_date between p_from and p_to), 0),
      'payable', coalesce((select sum(p.total - p.paid_amount) from public.purchases p
                  where p.business_id = v_biz and p.total > p.paid_amount and p.status = 'completed'), 0),
      'cash_balance', coalesce((select sum(case l.direction when 'in' then l.amount else -l.amount end)
                  from public.cash_ledger l where l.business_id = v_biz and l.account = 'cash'), 0),
      'bank_balance', coalesce((select sum(case l.direction when 'in' then l.amount else -l.amount end)
                  from public.cash_ledger l where l.business_id = v_biz and l.account in ('bank', 'wallet')), 0),
      'stock_value', coalesce((select sum(c.landed_cost) from public.phone_units u
                  join public.phone_unit_costs c on c.unit_id = u.id
                  where u.business_id = v_biz and u.status = 'in_stock'), 0)
                  + coalesce((select sum(ps.qty * pc.avg_cost) from public.product_stock ps
                  join public.product_costs pc on pc.product_id = ps.product_id
                  where ps.business_id = v_biz), 0),
      'expenses_by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount', amount))
                  from (select e.category, sum(e.amount) as amount from public.expenses e
                        where e.business_id = v_biz and e.voided_at is null and e.expense_date between p_from and p_to
                        group by e.category order by sum(e.amount) desc) q), '[]'::jsonb)
    );
    r := jsonb_set(r, '{daily}', r -> 'daily_full') - 'daily_full';
  else
    r := r - 'daily_full' - 'profit';
  end if;

  return r;
end;
$function$;


-- =============================================================================
-- 2. CASH & BANK
--
-- Design: every money movement stays in public.cash_ledger. A new table
-- public.finance_accounts holds the accounts (cash, bank, wallets such as
-- JazzCash or Easypaisa). cash_ledger gets an account_id column.
--
-- Existing functions (sales, purchases, payments, expenses, cancellations) are
-- NOT changed. They still write account = 'cash' or 'bank'; a trigger fills in
-- account_id with the default cash or default bank account of the business.
--
-- Existing data: the only change is that the new, empty account_id column of
-- existing ledger rows is filled with the default cash or bank account (2.5).
-- No amount, date or other value is changed and no row is deleted.
-- =============================================================================

-- 2.1 Permission to manage accounts and record manual entries --------------
-- Owners have every permission automatically. Give it to other roles or users
-- from the Users page when needed.
insert into public.permissions (key, module, description)
values ('finance.manage', 'Finance',
        'Manage cash, bank and wallet accounts, record manual entries and cash counts')
on conflict (key) do nothing;


-- 2.2 Accounts --------------------------------------------------------------
create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.my_business_id() references public.businesses (id),
  name text not null,
  kind text not null,
  details text,
  opening_balance numeric(14,2) not null default 0,
  opening_date date not null default ((now() at time zone 'Asia/Karachi')::date),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_accounts_kind_check check (kind in ('cash', 'bank', 'wallet')),
  constraint finance_accounts_name_check check (char_length(trim(name)) between 1 and 60),
  constraint finance_accounts_details_check check (details is null or char_length(details) <= 200),
  constraint finance_accounts_opening_check
    check (opening_balance between -999999999999.99 and 999999999999.99),
  -- Only cash and bank have a default (the account old cash/bank entries use)
  constraint finance_accounts_default_kind_check check (not is_default or kind in ('cash', 'bank')),
  constraint finance_accounts_default_active_check check (not is_default or is_active)
);

create unique index if not exists finance_accounts_name_key
  on public.finance_accounts (business_id, lower(trim(name)));
create unique index if not exists finance_accounts_default_key
  on public.finance_accounts (business_id, kind) where is_default;

alter table public.finance_accounts enable row level security;

-- Read only; every change goes through the functions below
drop policy if exists finance_accounts_select on public.finance_accounts;
create policy finance_accounts_select on public.finance_accounts for select
  using (business_id = public.my_business_id()
         and (public.has_permission('finance.view') or public.has_permission('finance.manage')));

drop trigger if exists finance_accounts_set_updated_at on public.finance_accounts;
create trigger finance_accounts_set_updated_at before update on public.finance_accounts
  for each row execute function public.set_updated_at();


-- 2.3 Ledger: account link, cancellation and new entry types ---------------
alter table public.cash_ledger
  add column if not exists account_id uuid references public.finance_accounts (id),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid,
  add column if not exists reversal_of uuid references public.cash_ledger (id);

alter table public.cash_ledger drop constraint if exists cash_ledger_account_check;
alter table public.cash_ledger add constraint cash_ledger_account_check
  check (account in ('cash', 'bank', 'wallet'));

alter table public.cash_ledger drop constraint if exists cash_ledger_category_check;
alter table public.cash_ledger add constraint cash_ledger_category_check
  check (category in (
    -- existing
    'supplier_payment', 'sale_receipt', 'customer_payment', 'expense', 'other',
    -- Cash & Bank
    'opening_balance', 'deposit', 'withdrawal', 'transfer',
    'owner_capital_in', 'owner_capital_out', 'adjustment',
    -- Returns
    'sale_refund', 'purchase_refund'));

create index if not exists cash_ledger_account_idx
  on public.cash_ledger (account_id, entry_date, created_at);

-- Same rule as before, and users with finance.manage may read the ledger too
drop policy if exists cash_ledger_select on public.cash_ledger;
create policy cash_ledger_select on public.cash_ledger for select
  using (business_id = public.my_business_id()
         and (public.has_permission('finance.view') or public.has_permission('finance.manage')));


-- 2.4 Default accounts --------------------------------------------------------
-- Returns the default cash or bank account of a business, creating it when
-- there is none yet. Internal helper: not callable from the app.
create or replace function public.default_finance_account(p_business_id uuid, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
begin
  if p_kind not in ('cash', 'bank') then
    raise exception 'Only cash and bank have a default account.';
  end if;

  select a.id into v_id from public.finance_accounts a
  where a.business_id = p_business_id and a.kind = p_kind and a.is_default;
  if v_id is not null then
    return v_id;
  end if;

  -- Use an existing active account of this kind before creating a new one
  select a.id into v_id from public.finance_accounts a
  where a.business_id = p_business_id and a.kind = p_kind and a.is_active
  order by a.created_at, a.id
  limit 1
  for update;
  if v_id is not null then
    update public.finance_accounts set is_default = true where id = v_id;
    return v_id;
  end if;

  v_name := case p_kind when 'cash' then 'Cash' else 'Bank' end;
  if exists (select 1 from public.finance_accounts a
             where a.business_id = p_business_id and lower(trim(a.name)) = lower(v_name)) then
    v_name := case p_kind when 'cash' then 'Cash in hand' else 'Main bank account' end;
  end if;

  insert into public.finance_accounts (business_id, name, kind, is_default, created_by)
  values (p_business_id, v_name, p_kind, true, null)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.default_finance_account(uuid, text) from public, anon, authenticated;

-- Fills account_id for entries written by the existing functions, and keeps
-- the account text column in line with the chosen account.
create or replace function public.cash_ledger_resolve_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if new.account_id is null then
    if new.account not in ('cash', 'bank') then
      raise exception 'Choose an account for this entry.';
    end if;
    -- A reversal from the existing cancel functions goes back to the account
    -- of the original entry, even when the default account changed since.
    if new.ref_type in ('expense_void', 'sale_void', 'purchase_void') and new.ref_id is not null then
      select l.account_id into new.account_id
      from public.cash_ledger l
      where l.business_id = new.business_id
        and l.ref_id = new.ref_id
        and l.ref_type = replace(new.ref_type, '_void', '')
        and l.account = new.account
        and l.account_id is not null
      order by l.created_at desc, l.id desc
      limit 1;
    end if;
    if new.account_id is null then
      new.account_id := public.default_finance_account(new.business_id, new.account);
    end if;
  else
    select a.kind into v_kind from public.finance_accounts a
    where a.id = new.account_id and a.business_id = new.business_id;
    if v_kind is null then
      raise exception 'The account does not belong to this business.';
    end if;
    new.account := v_kind;
  end if;
  return new;
end;
$$;

revoke all on function public.cash_ledger_resolve_account() from public, anon, authenticated;

drop trigger if exists cash_ledger_resolve_account on public.cash_ledger;
create trigger cash_ledger_resolve_account before insert on public.cash_ledger
  for each row execute function public.cash_ledger_resolve_account();

-- One default cash and one default bank account for every business
do $$
declare
  b record;
begin
  for b in select id from public.businesses loop
    perform public.default_finance_account(b.id, 'cash');
    perform public.default_finance_account(b.id, 'bank');
  end loop;
end;
$$;


-- 2.5 Link existing ledger rows to the default accounts --------------------
-- Only fills the new account_id column (null before this migration).
update public.cash_ledger l
set account_id = a.id
from public.finance_accounts a
where l.account_id is null
  and a.business_id = l.business_id
  and a.kind = l.account
  and a.is_default;


-- 2.6 Views: balances and ledger with running balance ----------------------
-- security_invoker: the reader's own Row Level Security applies.
create or replace view public.finance_account_balances
with (security_invoker = true) as
select a.id, a.business_id, a.name, a.kind, a.details, a.opening_balance, a.opening_date,
       a.is_default, a.is_active, a.created_at,
       coalesce(sum(case l.direction when 'in' then l.amount else -l.amount end), 0)::numeric(14,2) as balance,
       coalesce(sum(l.amount) filter (where l.direction = 'in'), 0)::numeric(14,2) as total_in,
       coalesce(sum(l.amount) filter (where l.direction = 'out'), 0)::numeric(14,2) as total_out,
       count(l.id) as entry_count,
       max(l.entry_date) as last_entry_date
from public.finance_accounts a
left join public.cash_ledger l on l.account_id = a.id
group by a.id;

-- The running balance is computed over all entries of the account before any
-- filter of the reader is applied, so it stays correct with filters.
create or replace view public.finance_ledger
with (security_invoker = true) as
select l.id, l.business_id, l.entry_date, l.created_at, l.account_id,
       a.name as account_name, a.kind as account_kind,
       l.direction, l.amount, l.category, l.party_type, l.party_id, l.ref_type, l.ref_id,
       l.notes, l.created_by, l.voided_at, l.reversal_of,
       (case l.direction when 'in' then l.amount else -l.amount end)::numeric(14,2) as signed_amount,
       sum(case l.direction when 'in' then l.amount else -l.amount end)
         over (partition by l.account_id order by l.entry_date, l.created_at, l.id
               rows between unbounded preceding and current row)::numeric(14,2) as running_balance
from public.cash_ledger l
join public.finance_accounts a on a.id = l.account_id;


-- 2.7 Shared checks ----------------------------------------------------------
create or replace function public.finance_require_manager()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
begin
  if auth.uid() is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('finance.manage') then
    raise exception 'You do not have permission to manage cash and bank accounts.';
  end if;
  return v_biz;
end;
$$;

revoke all on function public.finance_require_manager() from public, anon, authenticated;

-- Reads a money amount from the payload: positive, at most 2 decimals
create or replace function public.finance_amount(p_value text, p_label text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p_value is null or p_value !~ '^\d{1,12}(\.\d{1,2})?$' then
    raise exception '% must be a number above zero with up to 2 decimals.', p_label;
  end if;
  v := p_value::numeric;
  if v <= 0 then
    raise exception '% must be above zero.', p_label;
  end if;
  return v;
end;
$$;

revoke all on function public.finance_amount(text, text) from public, anon, authenticated;

-- Reads an entry date: not empty means a valid date, never in the future
create or replace function public.finance_entry_date(p_value text)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v date;
begin
  if p_value is null or trim(p_value) = '' then
    return v_today;
  end if;
  if p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'The date is not valid.';
  end if;
  v := p_value::date;
  if v > v_today then
    raise exception 'The date cannot be in the future.';
  end if;
  if v < date '2000-01-01' then
    raise exception 'The date is too far in the past.';
  end if;
  return v;
end;
$$;

revoke all on function public.finance_entry_date(text) from public, anon, authenticated;

-- Current balance of one account
create or replace function public.finance_balance(p_account_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case l.direction when 'in' then l.amount else -l.amount end), 0)
  from public.cash_ledger l
  where l.account_id = p_account_id;
$$;

revoke all on function public.finance_balance(uuid) from public, anon, authenticated;

-- 1234.5 -> '1,234.50', for messages
create or replace function public.finance_format(p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_value, 'FM999,999,999,990.00');
$$;

revoke all on function public.finance_format(numeric) from public, anon, authenticated;


-- 2.8 Create and edit accounts ----------------------------------------------
-- payload: name, kind (cash|bank|wallet), details, opening_balance (may be
-- negative, e.g. an overdraft), opening_date
create or replace function public.create_finance_account(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.finance_require_manager();
  v_uid uuid := auth.uid();
  v_name text := regexp_replace(trim(coalesce(p_payload ->> 'name', '')), '\s+', ' ', 'g');
  v_kind text := p_payload ->> 'kind';
  v_details text := nullif(trim(coalesce(p_payload ->> 'details', '')), '');
  v_opening_text text := nullif(trim(coalesce(p_payload ->> 'opening_balance', '')), '');
  v_opening numeric(14,2) := 0;
  v_date date := public.finance_entry_date(p_payload ->> 'opening_date');
  v_id uuid;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'The account name must be 1 to 60 characters.';
  end if;
  if v_kind is null or v_kind not in ('cash', 'bank', 'wallet') then
    raise exception 'Choose cash, bank or wallet.';
  end if;
  if v_details is not null and char_length(v_details) > 200 then
    raise exception 'The details cannot be longer than 200 characters.';
  end if;
  if v_opening_text is not null then
    if v_opening_text !~ '^-?\d{1,12}(\.\d{1,2})?$' then
      raise exception 'The opening balance must be a number with up to 2 decimals.';
    end if;
    v_opening := v_opening_text::numeric;
  end if;
  if exists (select 1 from public.finance_accounts a
             where a.business_id = v_biz and lower(trim(a.name)) = lower(v_name)) then
    raise exception 'An account with this name already exists.';
  end if;

  insert into public.finance_accounts
    (business_id, name, kind, details, opening_balance, opening_date, created_by)
  values (v_biz, v_name, v_kind, v_details, v_opening, v_date, v_uid)
  returning id into v_id;

  if v_opening <> 0 then
    insert into public.cash_ledger
      (business_id, entry_date, account, account_id, direction, amount, category,
       ref_type, ref_id, notes, created_by)
    values
      (v_biz, v_date, v_kind, v_id, case when v_opening > 0 then 'in' else 'out' end,
       abs(v_opening), 'opening_balance', 'finance_account', v_id, 'Opening balance', v_uid);
  end if;

  return jsonb_build_object('account_id', v_id);
end;
$$;

revoke all on function public.create_finance_account(jsonb) from public, anon;
grant execute on function public.create_finance_account(jsonb) to authenticated, service_role;

-- payload: account_id, and any of: name, details, opening_balance,
-- opening_date, is_active (true|false), make_default (true)
-- Changing the opening balance posts the difference as an opening balance
-- entry, so the ledger always explains the balance.
create or replace function public.update_finance_account(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.finance_require_manager();
  v_uid uuid := auth.uid();
  v_id uuid;
  a public.finance_accounts%rowtype;
  v_name text;
  v_details text;
  v_opening numeric(14,2);
  v_date date;
  v_diff numeric(14,2);
  v_active boolean;
  v_balance numeric;
begin
  begin
    v_id := (p_payload ->> 'account_id')::uuid;
  exception when others then
    raise exception 'The account is not valid.';
  end;

  select * into a from public.finance_accounts f
  where f.id = v_id and f.business_id = v_biz
  for update;
  if not found then
    raise exception 'The account was not found.';
  end if;

  -- Name
  if p_payload ? 'name' then
    v_name := regexp_replace(trim(coalesce(p_payload ->> 'name', '')), '\s+', ' ', 'g');
    if char_length(v_name) < 1 or char_length(v_name) > 60 then
      raise exception 'The account name must be 1 to 60 characters.';
    end if;
    if exists (select 1 from public.finance_accounts f
               where f.business_id = v_biz and f.id <> a.id and lower(trim(f.name)) = lower(v_name)) then
      raise exception 'An account with this name already exists.';
    end if;
    update public.finance_accounts set name = v_name where id = a.id;
  end if;

  -- Details
  if p_payload ? 'details' then
    v_details := nullif(trim(coalesce(p_payload ->> 'details', '')), '');
    if v_details is not null and char_length(v_details) > 200 then
      raise exception 'The details cannot be longer than 200 characters.';
    end if;
    update public.finance_accounts set details = v_details where id = a.id;
  end if;

  -- Opening balance and date
  if p_payload ? 'opening_balance' or p_payload ? 'opening_date' then
    v_opening := a.opening_balance;
    if p_payload ? 'opening_balance' then
      if coalesce(p_payload ->> 'opening_balance', '') !~ '^-?\d{1,12}(\.\d{1,2})?$' then
        raise exception 'The opening balance must be a number with up to 2 decimals.';
      end if;
      v_opening := (p_payload ->> 'opening_balance')::numeric;
    end if;
    v_date := case when p_payload ? 'opening_date'
                   then public.finance_entry_date(p_payload ->> 'opening_date') else a.opening_date end;
    v_diff := v_opening - a.opening_balance;

    if v_diff <> 0 then
      insert into public.cash_ledger
        (business_id, entry_date, account, account_id, direction, amount, category,
         ref_type, ref_id, notes, created_by)
      values
        (v_biz, v_date, a.kind, a.id, case when v_diff > 0 then 'in' else 'out' end,
         abs(v_diff), 'opening_balance', 'finance_account', a.id,
         'Opening balance changed from ' || public.finance_format(a.opening_balance) || ' to '
           || public.finance_format(v_opening), v_uid);
    end if;
    -- Earlier opening balance entries move to the new opening date
    update public.cash_ledger set entry_date = v_date
    where account_id = a.id and category = 'opening_balance' and ref_type = 'finance_account'
      and entry_date <> v_date;
    update public.finance_accounts set opening_balance = v_opening, opening_date = v_date where id = a.id;
  end if;

  -- Default account (cash and bank only)
  if coalesce((p_payload ->> 'make_default')::boolean, false) and not a.is_default then
    if a.kind not in ('cash', 'bank') then
      raise exception 'Only a cash or bank account can be the default.';
    end if;
    if not a.is_active then
      raise exception 'Activate the account before making it the default.';
    end if;
    update public.finance_accounts set is_default = false
    where business_id = v_biz and kind = a.kind and is_default;
    update public.finance_accounts set is_default = true where id = a.id;
  end if;

  -- Activate or deactivate
  if p_payload ? 'is_active' then
    v_active := (p_payload ->> 'is_active')::boolean;
    if v_active is false and a.is_active then
      if (select f.is_default from public.finance_accounts f where f.id = a.id) then
        raise exception 'The default % account cannot be deactivated. Make another account the default first.', a.kind;
      end if;
      v_balance := public.finance_balance(a.id);
      if v_balance <> 0 then
        raise exception 'Move the balance of % (%) to another account before deactivating it.',
          a.name, public.finance_format(v_balance);
      end if;
    end if;
    update public.finance_accounts set is_active = v_active where id = a.id;
  end if;

  return jsonb_build_object('account_id', a.id);
end;
$$;

revoke all on function public.update_finance_account(jsonb) from public, anon;
grant execute on function public.update_finance_account(jsonb) to authenticated, service_role;


-- 2.9 Manual entries ----------------------------------------------------------
-- payload: type, account_id, to_account_id (transfer), direction (adjustment:
-- in|out), amount, entry_date, notes
--   deposit            money in to the account (for example a loan received)
--   withdrawal         money out of the account
--   transfer           from one account to another (two linked entries)
--   owner_capital_in   owner puts money into the business
--   owner_capital_out  owner takes money out of the business
--   adjustment         correction in or out; a note is required
-- Money going out may not make an account negative, except for adjustments.
create or replace function public.record_finance_entry(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.finance_require_manager();
  v_uid uuid := auth.uid();
  v_type text := p_payload ->> 'type';
  v_amount numeric(14,2) := public.finance_amount(p_payload ->> 'amount', 'The amount');
  v_date date := public.finance_entry_date(p_payload ->> 'entry_date');
  v_notes text := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  v_direction text;
  v_from public.finance_accounts%rowtype;
  v_to public.finance_accounts%rowtype;
  v_from_id uuid;
  v_to_id uuid;
  v_group uuid;
  v_balance numeric;
  v_first uuid;
  v_second uuid;
begin
  if v_type is null or v_type not in
     ('deposit', 'withdrawal', 'transfer', 'owner_capital_in', 'owner_capital_out', 'adjustment') then
    raise exception 'Choose the type of entry.';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'The note cannot be longer than 500 characters.';
  end if;
  if v_type = 'adjustment' and v_notes is null then
    raise exception 'Write a short note that explains the adjustment.';
  end if;

  begin
    v_from_id := (p_payload ->> 'account_id')::uuid;
    v_to_id := nullif(p_payload ->> 'to_account_id', '')::uuid;
  exception when others then
    raise exception 'The account is not valid.';
  end;

  -- Lock the accounts in a fixed order so two entries cannot pass the
  -- balance check at the same time
  perform 1 from public.finance_accounts f
  where f.business_id = v_biz and f.id in (v_from_id, v_to_id)
  order by f.id
  for update;

  select * into v_from from public.finance_accounts f where f.id = v_from_id and f.business_id = v_biz;
  if not found then
    raise exception 'The account was not found.';
  end if;
  if not v_from.is_active then
    raise exception 'The account % is not active.', v_from.name;
  end if;

  v_direction := case v_type
    when 'deposit' then 'in'
    when 'owner_capital_in' then 'in'
    when 'withdrawal' then 'out'
    when 'owner_capital_out' then 'out'
    when 'transfer' then 'out'
    else p_payload ->> 'direction'
  end;
  if v_direction is null or v_direction not in ('in', 'out') then
    raise exception 'Choose whether the adjustment adds or removes money.';
  end if;

  if v_type = 'transfer' then
    if v_to_id is null then
      raise exception 'Choose the account the money goes to.';
    end if;
    if v_to_id = v_from_id then
      raise exception 'Choose two different accounts for a transfer.';
    end if;
    select * into v_to from public.finance_accounts f where f.id = v_to_id and f.business_id = v_biz;
    if not found then
      raise exception 'The account the money goes to was not found.';
    end if;
    if not v_to.is_active then
      raise exception 'The account % is not active.', v_to.name;
    end if;
  end if;

  if v_direction = 'out' and v_type <> 'adjustment' then
    v_balance := public.finance_balance(v_from.id);
    if v_balance - v_amount < 0 then
      raise exception 'Not enough money in %. The balance is %.', v_from.name, public.finance_format(v_balance);
    end if;
  end if;

  if v_type = 'transfer' then
    v_group := gen_random_uuid();
    insert into public.cash_ledger
      (business_id, entry_date, account, account_id, direction, amount, category,
       ref_type, ref_id, notes, created_by)
    values
      (v_biz, v_date, v_from.kind, v_from.id, 'out', v_amount, 'transfer', 'transfer', v_group,
       coalesce(v_notes, 'Transfer to ' || v_to.name), v_uid)
    returning id into v_first;
    insert into public.cash_ledger
      (business_id, entry_date, account, account_id, direction, amount, category,
       ref_type, ref_id, notes, created_by)
    values
      (v_biz, v_date, v_to.kind, v_to.id, 'in', v_amount, 'transfer', 'transfer', v_group,
       coalesce(v_notes, 'Transfer from ' || v_from.name), v_uid)
    returning id into v_second;
    return jsonb_build_object('entry_ids', jsonb_build_array(v_first, v_second), 'transfer_id', v_group);
  end if;

  insert into public.cash_ledger
    (business_id, entry_date, account, account_id, direction, amount, category,
     ref_type, notes, created_by)
  values
    (v_biz, v_date, v_from.kind, v_from.id, v_direction, v_amount, v_type, 'manual', v_notes, v_uid)
  returning id into v_first;

  return jsonb_build_object('entry_ids', jsonb_build_array(v_first));
end;
$$;

revoke all on function public.record_finance_entry(jsonb) from public, anon;
grant execute on function public.record_finance_entry(jsonb) to authenticated, service_role;

-- Cancels a manual entry or a transfer (both sides) with reversing entries
-- dated today. Nothing is deleted. Entries made by sales, purchases, payments
-- or expenses are cancelled on their own pages instead.
-- payload: entry_id, reason
create or replace function public.void_finance_entry(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.finance_require_manager();
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_reason text := nullif(trim(coalesce(p_payload ->> 'reason', '')), '');
  v_id uuid;
  e public.cash_ledger%rowtype;
  r public.cash_ledger%rowtype;
  v_count int := 0;
begin
  begin
    v_id := (p_payload ->> 'entry_id')::uuid;
  exception when others then
    raise exception 'The entry is not valid.';
  end;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'The reason cannot be longer than 300 characters.';
  end if;

  select * into e from public.cash_ledger l where l.id = v_id and l.business_id = v_biz for update;
  if not found then
    raise exception 'The entry was not found.';
  end if;
  if e.ref_type is null or e.ref_type not in ('manual', 'transfer') or e.reversal_of is not null then
    raise exception 'Only manual entries and transfers can be cancelled here.';
  end if;
  if e.voided_at is not null then
    raise exception 'This entry is already cancelled.';
  end if;

  for r in
    select * from public.cash_ledger l
    where l.business_id = v_biz and l.voided_at is null and l.reversal_of is null
      and (l.id = e.id or (e.ref_type = 'transfer' and l.ref_type = 'transfer' and l.ref_id = e.ref_id))
    order by l.id
    for update
  loop
    insert into public.cash_ledger
      (business_id, entry_date, account, account_id, direction, amount, category,
       ref_type, ref_id, notes, created_by, reversal_of)
    values
      (v_biz, v_today, r.account, r.account_id, case r.direction when 'in' then 'out' else 'in' end,
       r.amount, r.category, 'manual_void', r.id,
       'Cancelled' || coalesce(': ' || v_reason, ''), v_uid, r.id);
    update public.cash_ledger set voided_at = now(), voided_by = v_uid where id = r.id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('cancelled', v_count);
end;
$$;

revoke all on function public.void_finance_entry(jsonb) from public, anon;
grant execute on function public.void_finance_entry(jsonb) to authenticated, service_role;


-- 2.10 Cash counts (reconciliation) -------------------------------------------
create table if not exists public.finance_counts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.my_business_id() references public.businesses (id),
  account_id uuid not null references public.finance_accounts (id),
  count_date date not null default ((now() at time zone 'Asia/Karachi')::date),
  counted_amount numeric(14,2) not null,
  system_balance numeric(14,2) not null,
  difference numeric(14,2) not null,
  notes text,
  adjustment_id uuid references public.cash_ledger (id),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint finance_counts_counted_check check (counted_amount >= 0),
  constraint finance_counts_difference_check check (difference = counted_amount - system_balance),
  constraint finance_counts_notes_check check (notes is null or char_length(notes) <= 500)
);

create index if not exists finance_counts_account_idx
  on public.finance_counts (account_id, created_at desc);

alter table public.finance_counts enable row level security;

drop policy if exists finance_counts_select on public.finance_counts;
create policy finance_counts_select on public.finance_counts for select
  using (business_id = public.my_business_id()
         and (public.has_permission('finance.view') or public.has_permission('finance.manage')));

-- payload: account_id, counted_amount (0 or more), notes, post_adjustment
-- The system balance is read in the database at the moment of the count.
-- With post_adjustment the difference is posted as an adjustment entry, so the
-- account then matches the counted amount.
create or replace function public.record_finance_count(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.finance_require_manager();
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_counted_text text := trim(coalesce(p_payload ->> 'counted_amount', ''));
  v_counted numeric(14,2);
  v_notes text := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  v_post boolean := coalesce((p_payload ->> 'post_adjustment')::boolean, false);
  v_id uuid;
  a public.finance_accounts%rowtype;
  v_balance numeric(14,2);
  v_diff numeric(14,2);
  v_count_id uuid;
  v_entry_id uuid;
begin
  begin
    v_id := (p_payload ->> 'account_id')::uuid;
  exception when others then
    raise exception 'The account is not valid.';
  end;
  if v_counted_text !~ '^\d{1,12}(\.\d{1,2})?$' then
    raise exception 'The counted amount must be 0 or more with up to 2 decimals.';
  end if;
  v_counted := v_counted_text::numeric;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'The note cannot be longer than 500 characters.';
  end if;

  select * into a from public.finance_accounts f where f.id = v_id and f.business_id = v_biz for update;
  if not found then
    raise exception 'The account was not found.';
  end if;
  if not a.is_active then
    raise exception 'The account % is not active.', a.name;
  end if;

  v_balance := public.finance_balance(a.id);
  v_diff := v_counted - v_balance;

  insert into public.finance_counts
    (business_id, account_id, count_date, counted_amount, system_balance, difference, notes, created_by)
  values (v_biz, a.id, v_today, v_counted, v_balance, v_diff, v_notes, v_uid)
  returning id into v_count_id;

  if v_post and v_diff <> 0 then
    insert into public.cash_ledger
      (business_id, entry_date, account, account_id, direction, amount, category,
       ref_type, ref_id, notes, created_by)
    values
      (v_biz, v_today, a.kind, a.id, case when v_diff > 0 then 'in' else 'out' end, abs(v_diff),
       'adjustment', 'finance_count', v_count_id,
       'Count difference' || coalesce(': ' || v_notes, ''), v_uid)
    returning id into v_entry_id;
    update public.finance_counts set adjustment_id = v_entry_id where id = v_count_id;
  end if;

  return jsonb_build_object('count_id', v_count_id, 'system_balance', v_balance,
                            'difference', v_diff, 'adjustment_id', v_entry_id);
end;
$$;

revoke all on function public.record_finance_count(jsonb) from public, anon;
grant execute on function public.record_finance_count(jsonb) to authenticated, service_role;


-- 2.11 Day and month summary ---------------------------------------------------
-- Money in and out per day or month, for one account or all accounts.
-- Runs with the reader's rights, so Row Level Security applies.
create or replace function public.get_finance_summary(
  p_from date, p_to date, p_account_id uuid default null, p_group text default 'day')
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  r jsonb;
begin
  if auth.uid() is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not (public.has_permission('finance.view') or public.has_permission('finance.manage')) then
    raise exception 'You do not have permission to view cash and bank.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    raise exception 'Choose a valid date range of at most three years.';
  end if;
  if p_group not in ('day', 'month') then
    raise exception 'Group by day or month.';
  end if;

  with rows as (
    select case when p_group = 'month' then date_trunc('month', l.entry_date)::date else l.entry_date end
             as period,
           l.direction, l.amount
    from public.cash_ledger l
    where l.business_id = v_biz
      and l.entry_date between p_from and p_to
      and (p_account_id is null or l.account_id = p_account_id)
      -- A transfer between two accounts is not money in or out of the business
      and (p_account_id is not null or l.category <> 'transfer')
  ),
  periods as (
    select period,
           coalesce(sum(amount) filter (where direction = 'in'), 0) as total_in,
           coalesce(sum(amount) filter (where direction = 'out'), 0) as total_out,
           count(*) as entries
    from rows group by period
  )
  select jsonb_build_object(
    'opening', coalesce((select sum(case l.direction when 'in' then l.amount else -l.amount end)
                         from public.cash_ledger l
                         where l.business_id = v_biz and l.entry_date < p_from
                           and (p_account_id is null or l.account_id = p_account_id)), 0),
    'total_in', coalesce((select sum(total_in) from periods), 0),
    'total_out', coalesce((select sum(total_out) from periods), 0),
    'periods', coalesce((select jsonb_agg(jsonb_build_object(
                  'period', p.period, 'total_in', p.total_in, 'total_out', p.total_out,
                  'net', p.total_in - p.total_out, 'entries', p.entries) order by p.period desc)
                from periods p), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

revoke all on function public.get_finance_summary(date, date, uuid, text) from public, anon;
grant execute on function public.get_finance_summary(date, date, uuid, text) to authenticated, service_role;


-- =============================================================================
-- 3. RETURNS & WARRANTY
--
-- Sales returns (customer brings items back), purchase returns (items go back
-- to the supplier), warranty lookup and warranty claims.
--
-- Money rule for a return: the returned value first reduces what is still
-- owed on that invoice or purchase (the "credit"); only the rest is paid back
-- (the "refund"). The credit is added to paid_amount, so every existing
-- balance (customer and supplier balances, the remaining amount on invoices
-- and purchases, and the limits of the existing payment functions) stays
-- correct without changing the existing functions.
-- An invoice or purchase that has returns can no longer be cancelled as a
-- whole (a trigger blocks it), so money is never paid back twice.
-- =============================================================================

-- 3.1 Return totals on invoices and purchases ---------------------------------
-- returned_total: value of the goods returned; refunded_total: money paid back
-- (or received back from the supplier); return_credit: the part of the
-- returned value that reduced the amount owed (also included in paid_amount).
alter table public.sales
  add column if not exists returned_total numeric(14,2) not null default 0,
  add column if not exists refunded_total numeric(14,2) not null default 0,
  add column if not exists return_credit numeric(14,2) not null default 0;

alter table public.purchases
  add column if not exists returned_total numeric(14,2) not null default 0,
  add column if not exists refunded_total numeric(14,2) not null default 0,
  add column if not exists return_credit numeric(14,2) not null default 0;


-- 3.2 Sales returns -------------------------------------------------------------
create table if not exists public.sales_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  return_no integer not null,
  sale_id uuid not null references public.sales (id),
  customer_id uuid references public.customers (id),
  return_date date not null,
  reason text not null,
  notes text,
  total numeric(14,2) not null,
  credit_amount numeric(14,2) not null,
  refund_amount numeric(14,2) not null,
  refund_account_id uuid references public.finance_accounts (id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint sales_returns_amounts_check
    check (total >= 0 and credit_amount >= 0 and refund_amount >= 0 and credit_amount + refund_amount = total),
  constraint sales_returns_refund_account_check check (refund_amount = 0 or refund_account_id is not null),
  constraint sales_returns_reason_check check (char_length(reason) between 1 and 300),
  constraint sales_returns_notes_check check (notes is null or char_length(notes) <= 500)
);

create unique index if not exists sales_returns_no_key on public.sales_returns (business_id, return_no);
create index if not exists sales_returns_sale_idx on public.sales_returns (sale_id);
create index if not exists sales_returns_date_idx on public.sales_returns (business_id, return_date desc);

create table if not exists public.sales_return_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  return_id uuid not null references public.sales_returns (id),
  sale_item_id uuid not null references public.sale_items (id),
  item_type text not null,
  description text not null,
  quantity integer not null,
  line_total numeric(14,2) not null,
  restock boolean not null,
  phone_unit_id uuid references public.phone_units (id),
  imei text,
  product_id uuid references public.products (id),
  constraint sales_return_items_quantity_check check (quantity > 0),
  constraint sales_return_items_total_check check (line_total >= 0)
);

create index if not exists sales_return_items_return_idx on public.sales_return_items (return_id);
create index if not exists sales_return_items_sale_item_idx on public.sales_return_items (sale_item_id);

-- Cost of the returned items (for profit), visible only with cost permissions
create table if not exists public.sales_return_item_costs (
  item_id uuid primary key references public.sales_return_items (id),
  business_id uuid not null references public.businesses (id),
  unit_cost numeric(14,2) not null default 0
);

alter table public.sales_returns enable row level security;
alter table public.sales_return_items enable row level security;
alter table public.sales_return_item_costs enable row level security;

drop policy if exists sales_returns_select on public.sales_returns;
create policy sales_returns_select on public.sales_returns for select
  using (business_id = public.my_business_id()
         and (public.has_permission('returns.manage') or public.has_permission('sales.view_all')));

drop policy if exists sales_return_items_select on public.sales_return_items;
create policy sales_return_items_select on public.sales_return_items for select
  using (business_id = public.my_business_id()
         and (public.has_permission('returns.manage') or public.has_permission('sales.view_all')));

drop policy if exists sales_return_item_costs_select on public.sales_return_item_costs;
create policy sales_return_item_costs_select on public.sales_return_item_costs for select
  using (business_id = public.my_business_id()
         and (public.has_permission('inventory.view_cost') or public.has_permission('reports.financial')
              or public.has_permission('dashboard.financial')));


-- 3.3 Purchase returns ----------------------------------------------------------
create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  return_no integer not null,
  purchase_id uuid not null references public.purchases (id),
  supplier_id uuid not null references public.suppliers (id),
  return_date date not null,
  reason text not null,
  notes text,
  total numeric(14,2) not null,
  credit_amount numeric(14,2) not null,
  refund_amount numeric(14,2) not null,
  refund_account_id uuid references public.finance_accounts (id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint purchase_returns_amounts_check
    check (total >= 0 and credit_amount >= 0 and refund_amount >= 0 and credit_amount + refund_amount = total),
  constraint purchase_returns_refund_account_check check (refund_amount = 0 or refund_account_id is not null),
  constraint purchase_returns_reason_check check (char_length(reason) between 1 and 300),
  constraint purchase_returns_notes_check check (notes is null or char_length(notes) <= 500)
);

create unique index if not exists purchase_returns_no_key on public.purchase_returns (business_id, return_no);
create index if not exists purchase_returns_purchase_idx on public.purchase_returns (purchase_id);
create index if not exists purchase_returns_date_idx on public.purchase_returns (business_id, return_date desc);

create table if not exists public.purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  return_id uuid not null references public.purchase_returns (id),
  purchase_item_id uuid references public.purchase_items (id),
  phone_unit_id uuid references public.phone_units (id),
  product_id uuid references public.products (id),
  item_type text not null,
  description text not null,
  imei text,
  quantity integer not null,
  unit_cost numeric(14,2) not null,
  line_total numeric(14,2) not null,
  constraint purchase_return_items_quantity_check check (quantity > 0),
  constraint purchase_return_items_total_check check (line_total >= 0)
);

create index if not exists purchase_return_items_return_idx on public.purchase_return_items (return_id);
create index if not exists purchase_return_items_item_idx on public.purchase_return_items (purchase_item_id);

alter table public.purchase_returns enable row level security;
alter table public.purchase_return_items enable row level security;

drop policy if exists purchase_returns_select on public.purchase_returns;
create policy purchase_returns_select on public.purchase_returns for select
  using (business_id = public.my_business_id()
         and (public.has_permission('purchases.view') or public.has_permission('purchases.manage')));

drop policy if exists purchase_return_items_select on public.purchase_return_items;
create policy purchase_return_items_select on public.purchase_return_items for select
  using (business_id = public.my_business_id()
         and (public.has_permission('purchases.view') or public.has_permission('purchases.manage')));


-- 3.4 Block cancelling an invoice or purchase that has returns ------------------
create or replace function public.block_cancel_with_returns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'void' and old.status is distinct from 'void' then
    if tg_table_name = 'sales'
       and exists (select 1 from public.sales_returns r where r.sale_id = new.id) then
      raise exception 'This invoice has returns, so it cannot be cancelled. Return the remaining items instead.';
    end if;
    if tg_table_name = 'purchases'
       and exists (select 1 from public.purchase_returns r where r.purchase_id = new.id) then
      raise exception 'This purchase has returns, so it cannot be cancelled. Return the remaining items instead.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.block_cancel_with_returns() from public, anon, authenticated;

drop trigger if exists sales_block_cancel_with_returns on public.sales;
create trigger sales_block_cancel_with_returns before update of status on public.sales
  for each row execute function public.block_cancel_with_returns();

drop trigger if exists purchases_block_cancel_with_returns on public.purchases;
create trigger purchases_block_cancel_with_returns before update of status on public.purchases
  for each row execute function public.block_cancel_with_returns();


-- 3.5 Shared helpers -------------------------------------------------------------
-- "INV-000042", "inv42" or "42" -> 42; anything else -> null
create or replace function public.parse_doc_no(p_text text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when trim(coalesce(p_text, '')) ~* '^([a-z]{2,4}-?)?0*\d{1,9}$'
              then nullif(regexp_replace(trim(p_text), '\D', '', 'g'), '')::integer end;
$$;

revoke all on function public.parse_doc_no(text) from public, anon;
grant execute on function public.parse_doc_no(text) to authenticated, service_role;

-- Active accounts a refund can be paid from (names only, no balances)
create or replace function public.return_accounts(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind,
                                               'is_default', a.is_default)
                            order by case a.kind when 'cash' then 0 when 'bank' then 1 else 2 end,
                                     a.is_default desc, a.name), '[]'::jsonb)
  from public.finance_accounts a
  where a.business_id = p_business_id and a.is_active;
$$;

revoke all on function public.return_accounts(uuid) from public, anon, authenticated;

-- Checks the refund account and that it holds enough money for a payout
create or replace function public.return_refund_account(
  p_business_id uuid, p_account text, p_amount numeric, p_money_out boolean)
returns public.finance_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.finance_accounts%rowtype;
  v_id uuid;
  v_balance numeric;
begin
  begin
    v_id := nullif(p_account, '')::uuid;
  exception when others then
    raise exception 'The account is not valid.';
  end;
  if v_id is null then
    raise exception 'Choose the account for the refund.';
  end if;
  select * into a from public.finance_accounts f
  where f.id = v_id and f.business_id = p_business_id
  for update;
  if not found then
    raise exception 'The account was not found.';
  end if;
  if not a.is_active then
    raise exception 'The account % is not active.', a.name;
  end if;
  if p_money_out then
    v_balance := public.finance_balance(a.id);
    if v_balance < p_amount then
      raise exception 'Not enough money in % for this refund. The balance is %.',
        a.name, public.finance_format(v_balance);
    end if;
  end if;
  return a;
end;
$$;

revoke all on function public.return_refund_account(uuid, text, numeric, boolean) from public, anon, authenticated;


-- 3.6 Sales return: lines, preview and save --------------------------------------
-- Works out the value of each returned line. An invoice discount is shared over
-- the lines; the last unit of a line gets exactly what is left of that line, so
-- the total returned can never be more than the invoice total.
-- p_items: [{ "sale_item_id": uuid, "quantity": int, "restock": bool }]
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
    restock := coalesce((it ->> 'restock')::boolean, true);
    phone_unit_id := si.phone_unit_id;
    imei := si.imei;
    product_id := si.product_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.sales_return_lines(uuid, uuid, jsonb) from public, anon, authenticated;

-- Invoice with its items for the return screen.
-- payload: sale_id or invoice_no (for example "INV-000042" or "42")
create or replace function public.get_sale_for_return(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  v_id uuid;
  v_no integer := public.parse_doc_no(p_payload ->> 'invoice_no');
  s public.sales%rowtype;
begin
  if auth.uid() is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('returns.manage') then
    raise exception 'You do not have permission to record returns.';
  end if;
  begin
    v_id := nullif(p_payload ->> 'sale_id', '')::uuid;
  exception when others then
    v_id := null;
  end;

  select * into s from public.sales x
  where x.business_id = v_biz and ((v_id is not null and x.id = v_id) or (v_id is null and x.invoice_no = v_no));
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'sale', jsonb_build_object(
      'id', s.id, 'invoice_no', s.invoice_no, 'created_at', s.created_at, 'status', s.status,
      'customer_id', s.customer_id,
      'customer_name', coalesce(s.customer_name, (select c.name from public.customers c where c.id = s.customer_id)),
      'subtotal', s.subtotal, 'discount', s.discount, 'total', s.total,
      'paid_amount', s.paid_amount - s.return_credit, 'returned_total', s.returned_total,
      'refunded_total', s.refunded_total, 'due', s.total - s.paid_amount),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', si.id, 'item_type', si.item_type, 'description', si.description, 'imei', si.imei,
               'quantity', si.quantity, 'line_total', si.line_total, 'warranty_days', si.warranty_days,
               'returned_qty', coalesce((select sum(ri.quantity) from public.sales_return_items ri
                                         where ri.sale_item_id = si.id), 0))
             order by si.item_type desc, si.description)
      from public.sale_items si where si.sale_id = s.id), '[]'::jsonb),
    'accounts', public.return_accounts(v_biz));
end;
$$;

revoke all on function public.get_sale_for_return(jsonb) from public, anon;
grant execute on function public.get_sale_for_return(jsonb) to authenticated, service_role;

-- Value, credit and refund of a return before it is saved. Changes nothing.
-- payload: sale_id, items
create or replace function public.preview_sales_return(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  v_sale_id uuid;
  s public.sales%rowtype;
  v_total numeric(14,2);
  v_credit numeric(14,2);
begin
  if auth.uid() is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('returns.manage') then
    raise exception 'You do not have permission to record returns.';
  end if;
  begin
    v_sale_id := (p_payload ->> 'sale_id')::uuid;
  exception when others then
    raise exception 'Invoice not found.';
  end;
  select * into s from public.sales x where x.id = v_sale_id and x.business_id = v_biz;
  if not found then
    raise exception 'Invoice not found.';
  end if;

  select coalesce(sum(l.line_total), 0) into v_total
  from public.sales_return_lines(v_biz, s.id, p_payload -> 'items') l;
  v_credit := least(v_total, greatest(s.total - s.paid_amount, 0));

  return jsonb_build_object('total', v_total, 'credit', v_credit, 'refund', v_total - v_credit,
    'lines', (select jsonb_agg(jsonb_build_object('sale_item_id', l.sale_item_id, 'quantity', l.quantity,
                                                  'line_total', l.line_total))
              from public.sales_return_lines(v_biz, s.id, p_payload -> 'items') l));
end;
$$;

revoke all on function public.preview_sales_return(jsonb) from public, anon;
grant execute on function public.preview_sales_return(jsonb) to authenticated, service_role;

-- Saves a sales return.
-- payload: sale_id, items [{sale_item_id, quantity, restock}], reason, notes,
--          return_date, refund_account_id (needed when money is paid back)
-- Restocked items go back into stock; items that are not restocked (for
-- example damaged) are written off.
create or replace function public.create_sales_return(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  v_uid uuid := auth.uid();
  v_sale_id uuid;
  s public.sales%rowtype;
  v_date date;
  v_reason text := nullif(trim(coalesce(p_payload ->> 'reason', '')), '');
  v_notes text := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  v_total numeric(14,2);
  v_credit numeric(14,2);
  v_refund numeric(14,2);
  v_account public.finance_accounts%rowtype;
  v_return_id uuid;
  v_no integer;
  v_item_id uuid;
  l record;
begin
  if v_uid is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('returns.manage') then
    raise exception 'You do not have permission to record returns.';
  end if;
  if v_reason is null or char_length(v_reason) > 300 then
    raise exception 'Write the reason for the return (up to 300 characters).';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'The note cannot be longer than 500 characters.';
  end if;
  begin
    v_sale_id := (p_payload ->> 'sale_id')::uuid;
  exception when others then
    raise exception 'Invoice not found.';
  end;

  select * into s from public.sales x where x.id = v_sale_id and x.business_id = v_biz for update;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if s.status <> 'completed' then
    raise exception 'This invoice is cancelled.';
  end if;

  v_date := public.finance_entry_date(p_payload ->> 'return_date');
  if v_date < (s.created_at at time zone 'Asia/Karachi')::date then
    raise exception 'The return date cannot be before the invoice date.';
  end if;

  select coalesce(sum(x.line_total), 0) into v_total
  from public.sales_return_lines(v_biz, s.id, p_payload -> 'items') x;
  v_credit := least(v_total, greatest(s.total - s.paid_amount, 0));
  v_refund := v_total - v_credit;

  if v_refund > 0 then
    v_account := public.return_refund_account(v_biz, p_payload ->> 'refund_account_id', v_refund, true);
  end if;

  v_no := public.next_doc_no(v_biz, 'sales_return');
  insert into public.sales_returns
    (business_id, return_no, sale_id, customer_id, return_date, reason, notes, total,
     credit_amount, refund_amount, refund_account_id, created_by)
  values
    (v_biz, v_no, s.id, s.customer_id, v_date, v_reason, v_notes, v_total,
     v_credit, v_refund, case when v_refund > 0 then v_account.id end, v_uid)
  returning id into v_return_id;

  for l in select * from public.sales_return_lines(v_biz, s.id, p_payload -> 'items') loop
    insert into public.sales_return_items
      (business_id, return_id, sale_item_id, item_type, description, quantity, line_total,
       restock, phone_unit_id, imei, product_id)
    values
      (v_biz, v_return_id, l.sale_item_id, l.item_type, l.description, l.quantity, l.line_total,
       l.restock, l.phone_unit_id, l.imei, l.product_id)
    returning id into v_item_id;
    insert into public.sales_return_item_costs (item_id, business_id, unit_cost)
    values (v_item_id, v_biz, l.unit_cost);

    if l.item_type = 'phone' then
      if l.restock then
        if exists (select 1 from public.phone_units u
                   where u.business_id = v_biz and u.imei = l.imei and u.status = 'in_stock') then
          raise exception 'The phone with IMEI % is already in stock again.', l.imei;
        end if;
        update public.phone_units
          set status = 'in_stock', sale_id = null, sold_at = null, updated_at = now()
          where id = l.phone_unit_id;
      else
        update public.phone_units set status = 'written_off', updated_at = now()
          where id = l.phone_unit_id;
      end if;
    elsif l.restock and l.product_id is not null then
      insert into public.product_stock (product_id, business_id, qty)
      values (l.product_id, v_biz, l.quantity)
      on conflict (product_id) do update
        set qty = public.product_stock.qty + excluded.qty, updated_at = now();
      insert into public.stock_movements
        (business_id, product_id, qty_change, unit_cost, reason, ref_type, ref_id, created_by)
      values (v_biz, l.product_id, l.quantity, l.unit_cost, 'return', 'sales_return', v_return_id, v_uid);
    end if;
  end loop;

  update public.sales
    set paid_amount = paid_amount + v_credit,
        return_credit = return_credit + v_credit,
        returned_total = returned_total + v_total,
        refunded_total = refunded_total + v_refund
    where id = s.id;

  if v_refund > 0 then
    insert into public.cash_ledger
      (business_id, entry_date, account, account_id, direction, amount, category,
       party_type, party_id, ref_type, ref_id, notes, created_by)
    values
      (v_biz, v_date, v_account.kind, v_account.id, 'out', v_refund, 'sale_refund',
       case when s.customer_id is null then null else 'customer' end, s.customer_id,
       'sales_return', v_return_id, 'Refund for return SR-' || lpad(v_no::text, 6, '0'), v_uid);
  end if;

  return jsonb_build_object('return_id', v_return_id, 'return_no', v_no, 'total', v_total,
                            'credit', v_credit, 'refund', v_refund);
end;
$$;

revoke all on function public.create_sales_return(jsonb) from public, anon;
grant execute on function public.create_sales_return(jsonb) to authenticated, service_role;


-- 3.7 Purchase return -------------------------------------------------------------
-- Purchase with what can still be returned.
-- payload: purchase_id or purchase_no
create or replace function public.get_purchase_for_return(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  v_id uuid;
  v_no integer := public.parse_doc_no(p_payload ->> 'purchase_no');
  p public.purchases%rowtype;
begin
  if auth.uid() is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('purchases.manage') then
    raise exception 'You do not have permission to return items to suppliers.';
  end if;
  begin
    v_id := nullif(p_payload ->> 'purchase_id', '')::uuid;
  exception when others then
    v_id := null;
  end;

  select * into p from public.purchases x
  where x.business_id = v_biz and ((v_id is not null and x.id = v_id) or (v_id is null and x.purchase_no = v_no));
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'purchase', jsonb_build_object(
      'id', p.id, 'purchase_no', p.purchase_no, 'purchase_date', p.purchase_date, 'status', p.status,
      'supplier_id', p.supplier_id,
      'supplier_name', (select su.name from public.suppliers su where su.id = p.supplier_id),
      'total', p.total, 'paid_amount', p.paid_amount - p.return_credit,
      'returned_total', p.returned_total, 'refunded_total', p.refunded_total,
      'due', p.total - p.paid_amount),
    'accessories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pi.id, 'description', pi.description, 'product_id', pi.product_id,
               'quantity', pi.quantity, 'unit_cost', pi.unit_cost,
               'returned_qty', coalesce((select sum(ri.quantity) from public.purchase_return_items ri
                                         where ri.purchase_item_id = pi.id), 0),
               'in_stock', coalesce((select ps.qty from public.product_stock ps
                                     where ps.product_id = pi.product_id), 0))
             order by pi.description)
      from public.purchase_items pi
      where pi.purchase_id = p.id and pi.item_type = 'accessory'), '[]'::jsonb),
    'phones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'imei', u.imei, 'status', u.status,
               'description', trim(u.brand_name || ' ' || u.model_name || ' ' ||
                              case when u.storage_gb >= 1024 and u.storage_gb % 1024 = 0
                                   then (u.storage_gb / 1024)::text || ' TB'
                                   else u.storage_gb::text || ' GB' end
                              || coalesce(' ' || u.color_name, '')),
               'unit_cost', coalesce(c.purchase_cost, 0))
             order by u.model_name, u.imei)
      from public.phone_units u
      left join public.phone_unit_costs c on c.unit_id = u.id
      where u.purchase_id = p.id), '[]'::jsonb),
    'accounts', public.return_accounts(v_biz));
end;
$$;

revoke all on function public.get_purchase_for_return(jsonb) from public, anon;
grant execute on function public.get_purchase_for_return(jsonb) to authenticated, service_role;

-- Saves a purchase return: the items leave stock and the supplier owes less
-- (or pays money back).
-- payload: purchase_id, phone_unit_ids [uuid], items [{purchase_item_id, quantity}],
--          reason, notes, return_date, refund_account_id (when money comes back)
create or replace function public.create_purchase_return(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  v_uid uuid := auth.uid();
  v_purchase_id uuid;
  p public.purchases%rowtype;
  v_date date;
  v_reason text := nullif(trim(coalesce(p_payload ->> 'reason', '')), '');
  v_notes text := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  v_left numeric(14,2);
  v_total numeric(14,2) := 0;
  v_credit numeric(14,2);
  v_refund numeric(14,2);
  v_account public.finance_accounts%rowtype;
  v_return_id uuid;
  v_no integer;
  v_id uuid;
  v_qty integer;
  v_done integer;
  v_stock numeric;
  v_value numeric(14,2);
  v_seen uuid[] := '{}';
  v_count integer := 0;
  it jsonb;
  u public.phone_units%rowtype;
  pi public.purchase_items%rowtype;
  v_cost numeric(14,2);
begin
  if v_uid is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('purchases.manage') then
    raise exception 'You do not have permission to return items to suppliers.';
  end if;
  if v_reason is null or char_length(v_reason) > 300 then
    raise exception 'Write the reason for the return (up to 300 characters).';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'The note cannot be longer than 500 characters.';
  end if;
  begin
    v_purchase_id := (p_payload ->> 'purchase_id')::uuid;
  exception when others then
    raise exception 'Purchase not found.';
  end;

  select * into p from public.purchases x where x.id = v_purchase_id and x.business_id = v_biz for update;
  if not found then
    raise exception 'Purchase not found.';
  end if;
  if p.status <> 'completed' then
    raise exception 'This purchase is cancelled.';
  end if;
  v_date := public.finance_entry_date(p_payload ->> 'return_date');
  if v_date < p.purchase_date then
    raise exception 'The return date cannot be before the purchase date.';
  end if;
  if coalesce(jsonb_array_length(case when jsonb_typeof(p_payload -> 'phone_unit_ids') = 'array'
                                      then p_payload -> 'phone_unit_ids' end), 0)
     + coalesce(jsonb_array_length(case when jsonb_typeof(p_payload -> 'items') = 'array'
                                        then p_payload -> 'items' end), 0) = 0 then
    raise exception 'Choose at least one item to return.';
  end if;

  v_left := p.total - p.returned_total;
  v_no := public.next_doc_no(v_biz, 'purchase_return');
  insert into public.purchase_returns
    (business_id, return_no, purchase_id, supplier_id, return_date, reason, notes, total,
     credit_amount, refund_amount, created_by)
  values (v_biz, v_no, p.id, p.supplier_id, v_date, v_reason, v_notes, 0, 0, 0, v_uid)
  returning id into v_return_id;

  -- Phones
  if jsonb_typeof(p_payload -> 'phone_unit_ids') = 'array' then
    for it in select value from jsonb_array_elements(p_payload -> 'phone_unit_ids') loop
      begin
        v_id := (it #>> '{}')::uuid;
      exception when others then
        raise exception 'A phone in the return is not valid.';
      end;
      if v_id = any (v_seen) then
        raise exception 'A phone is listed twice.';
      end if;
      v_seen := v_seen || v_id;
      select * into u from public.phone_units x
      where x.id = v_id and x.purchase_id = p.id and x.business_id = v_biz
      for update;
      if not found then
        raise exception 'A phone does not belong to this purchase.';
      end if;
      if u.status <> 'in_stock' then
        raise exception 'The phone with IMEI % is not in stock.', u.imei;
      end if;
      v_cost := coalesce((select c.purchase_cost from public.phone_unit_costs c where c.unit_id = u.id), 0);
      v_value := greatest(least(v_cost, v_left), 0);
      v_left := v_left - v_value;
      v_total := v_total + v_value;
      v_count := v_count + 1;
      update public.phone_units set status = 'returned_to_supplier', updated_at = now() where id = u.id;
      insert into public.purchase_return_items
        (business_id, return_id, phone_unit_id, item_type, description, imei, quantity, unit_cost, line_total)
      values
        (v_biz, v_return_id, u.id, 'phone',
         trim(u.brand_name || ' ' || u.model_name || coalesce(' ' || u.color_name, '')), u.imei, 1, v_cost, v_value);
    end loop;
  end if;

  -- Accessories
  if jsonb_typeof(p_payload -> 'items') = 'array' then
    for it in select value from jsonb_array_elements(p_payload -> 'items') loop
      begin
        v_id := (it ->> 'purchase_item_id')::uuid;
        v_qty := (it ->> 'quantity')::integer;
      exception when others then
        raise exception 'An item in the return is not valid.';
      end;
      if v_id = any (v_seen) then
        raise exception 'An item is listed twice.';
      end if;
      v_seen := v_seen || v_id;
      select * into pi from public.purchase_items x
      where x.id = v_id and x.purchase_id = p.id and x.item_type = 'accessory';
      if not found then
        raise exception 'An item does not belong to this purchase.';
      end if;
      if v_qty is null or v_qty < 1 then
        raise exception 'Enter a quantity of at least 1 for %.', pi.description;
      end if;
      select coalesce(sum(ri.quantity), 0) into v_done
      from public.purchase_return_items ri where ri.purchase_item_id = pi.id;
      if v_qty > pi.quantity - v_done then
        raise exception 'Only % of % can still be returned.', pi.quantity - v_done, pi.description;
      end if;
      select ps.qty into v_stock from public.product_stock ps where ps.product_id = pi.product_id for update;
      if coalesce(v_stock, 0) < v_qty then
        raise exception 'Only % of % are in stock.', coalesce(v_stock, 0)::integer, pi.description;
      end if;

      v_value := greatest(least(round(pi.unit_cost * v_qty, 2), v_left), 0);
      v_left := v_left - v_value;
      v_total := v_total + v_value;
      v_count := v_count + 1;
      update public.product_stock set qty = qty - v_qty, updated_at = now() where product_id = pi.product_id;
      insert into public.stock_movements
        (business_id, product_id, qty_change, unit_cost, reason, ref_type, ref_id, created_by)
      values (v_biz, pi.product_id, -v_qty, pi.unit_cost, 'return', 'purchase_return', v_return_id, v_uid);
      insert into public.purchase_return_items
        (business_id, return_id, purchase_item_id, product_id, item_type, description, quantity, unit_cost, line_total)
      values (v_biz, v_return_id, pi.id, pi.product_id, 'accessory', pi.description, v_qty, pi.unit_cost, v_value);
    end loop;
  end if;

  if v_count = 0 then
    raise exception 'Choose at least one item to return.';
  end if;

  v_credit := least(v_total, greatest(p.total - p.paid_amount, 0));
  v_refund := v_total - v_credit;
  if v_refund > 0 then
    v_account := public.return_refund_account(v_biz, p_payload ->> 'refund_account_id', v_refund, false);
  end if;

  update public.purchase_returns
    set total = v_total, credit_amount = v_credit, refund_amount = v_refund,
        refund_account_id = case when v_refund > 0 then v_account.id end
    where id = v_return_id;

  update public.purchases
    set paid_amount = paid_amount + v_credit,
        return_credit = return_credit + v_credit,
        returned_total = returned_total + v_total,
        refunded_total = refunded_total + v_refund
    where id = p.id;

  if v_refund > 0 then
    insert into public.cash_ledger
      (business_id, entry_date, account, account_id, direction, amount, category,
       party_type, party_id, ref_type, ref_id, notes, created_by)
    values
      (v_biz, v_date, v_account.kind, v_account.id, 'in', v_refund, 'purchase_refund',
       'supplier', p.supplier_id, 'purchase_return', v_return_id,
       'Money back for return PR-' || lpad(v_no::text, 6, '0'), v_uid);
  end if;

  return jsonb_build_object('return_id', v_return_id, 'return_no', v_no, 'total', v_total,
                            'credit', v_credit, 'refund', v_refund);
end;
$$;

revoke all on function public.create_purchase_return(jsonb) from public, anon;
grant execute on function public.create_purchase_return(jsonb) to authenticated, service_role;


-- 3.8 Warranty lookup ---------------------------------------------------------------
-- Finds sold items by IMEI, invoice number or customer phone.
create or replace function public.warranty_lookup(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  v_q text := trim(coalesce(p_query, ''));
  v_no integer := public.parse_doc_no(p_query);
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_today date := (now() at time zone 'Asia/Karachi')::date;
begin
  if auth.uid() is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not (public.has_permission('returns.manage') or public.has_permission('sales.create')) then
    raise exception 'You do not have permission to look up warranties.';
  end if;
  if char_length(v_q) < 2 or char_length(v_q) > 40 then
    raise exception 'Enter an IMEI, an invoice number or a phone number.';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.sold_on desc, x.description)
    from (
      select si.id as sale_item_id, s.id as sale_id, s.invoice_no,
             (s.created_at at time zone 'Asia/Karachi')::date as sold_on,
             coalesce(s.customer_name, c.name) as customer_name,
             coalesce(s.customer_phone, c.phone) as customer_phone,
             si.description, si.imei, si.quantity, si.warranty_days,
             (s.created_at at time zone 'Asia/Karachi')::date + si.warranty_days as expires_on,
             greatest((s.created_at at time zone 'Asia/Karachi')::date + si.warranty_days - v_today, 0) as days_left,
             case when si.warranty_days <= 0 then 'none'
                  when (s.created_at at time zone 'Asia/Karachi')::date + si.warranty_days >= v_today then 'active'
                  else 'expired' end as warranty_status,
             coalesce((select sum(ri.quantity) from public.sales_return_items ri
                       where ri.sale_item_id = si.id), 0) as returned_qty,
             (select w.id from public.warranty_claims w
              where w.sale_item_id = si.id and w.status <> 'returned'
              order by w.created_at desc limit 1) as open_claim_id
      from public.sales s
      join public.sale_items si on si.sale_id = s.id
      left join public.customers c on c.id = s.customer_id
      where s.business_id = v_biz and s.status = 'completed'
        and (si.imei = v_q
             or si.id::text = lower(v_q)
             or (v_no is not null and s.invoice_no = v_no)
             or (char_length(v_digits) >= 7 and (
                   right(regexp_replace(coalesce(s.customer_phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10)
                   or right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10))))
      order by s.created_at desc
      limit 50
    ) x), '[]'::jsonb);
end;
$$;

revoke all on function public.warranty_lookup(text) from public, anon;
grant execute on function public.warranty_lookup(text) to authenticated, service_role;


-- 3.9 Warranty claims ------------------------------------------------------------
-- Status flow:
--   received -> sent_out (to the supplier or a repair shop), repaired, replaced or rejected
--   sent_out -> repaired, replaced or rejected
--   repaired, replaced or rejected -> returned (handed back to the customer)
create table if not exists public.warranty_claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  claim_no integer not null,
  sale_id uuid references public.sales (id),
  sale_item_id uuid references public.sale_items (id),
  customer_id uuid references public.customers (id),
  customer_name text,
  customer_phone text,
  item_description text not null,
  imei text,
  warranty_expires_on date,
  under_warranty boolean not null default false,
  issue text not null,
  status text not null default 'received',
  sent_to text,
  supplier_id uuid references public.suppliers (id),
  resolution text,
  received_on date not null,
  sent_on date,
  resolved_on date,
  returned_on date,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warranty_claims_status_check
    check (status in ('received', 'sent_out', 'repaired', 'replaced', 'rejected', 'returned')),
  constraint warranty_claims_issue_check check (char_length(issue) between 1 and 1000),
  constraint warranty_claims_item_check check (char_length(item_description) between 1 and 200),
  constraint warranty_claims_customer_check
    check ((customer_name is null or char_length(customer_name) <= 120)
           and (customer_phone is null or char_length(customer_phone) <= 30)),
  constraint warranty_claims_sent_to_check check (sent_to is null or char_length(sent_to) <= 120),
  constraint warranty_claims_resolution_check check (resolution is null or char_length(resolution) <= 1000)
);

create unique index if not exists warranty_claims_no_key on public.warranty_claims (business_id, claim_no);
create index if not exists warranty_claims_status_idx on public.warranty_claims (business_id, status, created_at desc);
create index if not exists warranty_claims_item_idx on public.warranty_claims (sale_item_id);

create table if not exists public.warranty_claim_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  claim_id uuid not null references public.warranty_claims (id),
  status text not null,
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint warranty_claim_events_note_check check (note is null or char_length(note) <= 500)
);

create index if not exists warranty_claim_events_claim_idx on public.warranty_claim_events (claim_id, created_at);

alter table public.warranty_claims enable row level security;
alter table public.warranty_claim_events enable row level security;

drop policy if exists warranty_claims_select on public.warranty_claims;
create policy warranty_claims_select on public.warranty_claims for select
  using (business_id = public.my_business_id() and public.has_permission('returns.manage'));

drop policy if exists warranty_claim_events_select on public.warranty_claim_events;
create policy warranty_claim_events_select on public.warranty_claim_events for select
  using (business_id = public.my_business_id() and public.has_permission('returns.manage'));

drop trigger if exists warranty_claims_set_updated_at on public.warranty_claims;
create trigger warranty_claims_set_updated_at before update on public.warranty_claims
  for each row execute function public.set_updated_at();

-- payload: sale_item_id (optional), item_description, imei, customer_name,
--          customer_phone (used when there is no sale item), issue, received_on
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

  if v_imei is not null and v_imei !~ '^\d{15}$' then
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

-- payload: claim_id, status, note, sent_to (or supplier_id) for sent_out,
--          resolution (optional), event_date
create or replace function public.update_warranty_claim(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  v_uid uuid := auth.uid();
  v_id uuid;
  w public.warranty_claims%rowtype;
  v_status text := p_payload ->> 'status';
  v_note text := nullif(trim(coalesce(p_payload ->> 'note', '')), '');
  v_sent_to text := nullif(trim(coalesce(p_payload ->> 'sent_to', '')), '');
  v_resolution text := nullif(trim(coalesce(p_payload ->> 'resolution', '')), '');
  v_supplier uuid;
  v_date date := public.finance_entry_date(p_payload ->> 'event_date');
begin
  if v_uid is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('returns.manage') then
    raise exception 'You do not have permission to update warranty claims.';
  end if;
  begin
    v_id := (p_payload ->> 'claim_id')::uuid;
    v_supplier := nullif(p_payload ->> 'supplier_id', '')::uuid;
  exception when others then
    raise exception 'The claim is not valid.';
  end;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The note cannot be longer than 500 characters.';
  end if;
  if v_resolution is not null and char_length(v_resolution) > 1000 then
    raise exception 'The result cannot be longer than 1000 characters.';
  end if;

  select * into w from public.warranty_claims x where x.id = v_id and x.business_id = v_biz for update;
  if not found then
    raise exception 'The claim was not found.';
  end if;
  if v_date < w.received_on then
    raise exception 'The date cannot be before the claim was received.';
  end if;

  if not (
       (w.status = 'received' and v_status in ('sent_out', 'repaired', 'replaced', 'rejected'))
    or (w.status = 'sent_out' and v_status in ('repaired', 'replaced', 'rejected'))
    or (w.status in ('repaired', 'replaced', 'rejected') and v_status = 'returned')) then
    raise exception 'A claim that is % cannot be changed to %.',
      replace(w.status, '_', ' '), replace(coalesce(v_status, 'nothing'), '_', ' ');
  end if;

  if v_status = 'sent_out' then
    if v_supplier is not null then
      if not exists (select 1 from public.suppliers su where su.id = v_supplier and su.business_id = v_biz) then
        raise exception 'The supplier was not found.';
      end if;
      v_sent_to := coalesce(v_sent_to, (select su.name from public.suppliers su where su.id = v_supplier));
    end if;
    if v_sent_to is null or char_length(v_sent_to) > 120 then
      raise exception 'Write where the item was sent (up to 120 characters).';
    end if;
    update public.warranty_claims
      set status = v_status, sent_to = v_sent_to, supplier_id = v_supplier, sent_on = v_date
      where id = w.id;
  elsif v_status in ('repaired', 'replaced', 'rejected') then
    update public.warranty_claims
      set status = v_status, resolved_on = v_date, resolution = coalesce(v_resolution, v_note, resolution)
      where id = w.id;
  else
    update public.warranty_claims set status = v_status, returned_on = v_date where id = w.id;
  end if;

  insert into public.warranty_claim_events (business_id, claim_id, status, note, created_by)
  values (v_biz, w.id, v_status, v_note, v_uid);

  return jsonb_build_object('claim_id', w.id, 'status', v_status);
end;
$$;

revoke all on function public.update_warranty_claim(jsonb) from public, anon;
grant execute on function public.update_warranty_claim(jsonb) to authenticated, service_role;


-- =============================================================================
-- 4. AI ASSISTANT
--
-- The assistant only reads data through the signed-in user's session, so Row
-- Level Security and permissions apply to every answer. This section adds a
-- usage log for per-user rate limits and one read-only report function.
-- Questions and answers are not stored.
-- =============================================================================

-- 4.1 Usage log (for rate limits) ---------------------------------------------
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  constraint ai_usage_tokens_check check (input_tokens >= 0 and output_tokens >= 0)
);

create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage for select
  using (business_id = public.my_business_id() and user_id = auth.uid());

-- Starts one question: checks the permission and the limits, then logs it.
-- Limits: 20 questions per hour and 100 per day for each user.
create or replace function public.ai_start_request()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('ai.use') then
    raise exception 'You do not have permission to use the AI Assistant.';
  end if;
  -- One user's requests are counted one at a time
  perform pg_advisory_xact_lock(hashtextextended('ai_usage:' || v_uid::text, 0));
  if (select count(*) from public.ai_usage u
      where u.user_id = v_uid and u.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'You have asked 20 questions in the last hour. Please try again later.';
  end if;
  if (select count(*) from public.ai_usage u
      where u.user_id = v_uid and u.created_at > now() - interval '1 day') >= 100 then
    raise exception 'You have reached the limit of 100 questions per day. Please try again tomorrow.';
  end if;
  insert into public.ai_usage (business_id, user_id) values (v_biz, v_uid) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ai_start_request() from public, anon;
grant execute on function public.ai_start_request() to authenticated, service_role;

-- Adds the token counts to a logged question of the same user
create or replace function public.ai_finish_request(p_id uuid, p_input integer, p_output integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage
     set input_tokens = least(greatest(coalesce(p_input, 0), 0), 100000000),
         output_tokens = least(greatest(coalesce(p_output, 0), 0), 100000000)
   where id = p_id and user_id = auth.uid();
$$;

revoke all on function public.ai_finish_request(uuid, integer, integer) from public, anon;
grant execute on function public.ai_finish_request(uuid, integer, integer) to authenticated, service_role;


-- 4.2 Read-only report: best customers by sales --------------------------------
-- Names and totals only (no phone numbers). Runs with the reader's rights, so
-- it only counts the sales the reader may see.
create or replace function public.ai_top_customers(p_from date, p_to date, p_limit integer default 10)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x.sales_total desc), '[]'::jsonb)
  from (
    select coalesce(c.name, s.customer_name, 'Walk-in customers') as customer,
           count(*) as invoices,
           sum(s.total - s.returned_total)::numeric(14,2) as sales_total
    from public.sales s
    left join public.customers c on c.id = s.customer_id
    where s.business_id = public.my_business_id() and s.status = 'completed'
      and (s.created_at at time zone 'Asia/Karachi')::date between p_from and p_to
    group by s.customer_id, coalesce(c.name, s.customer_name, 'Walk-in customers')
    order by sum(s.total - s.returned_total) desc
    limit least(greatest(coalesce(p_limit, 10), 1), 25)
  ) x;
$$;

revoke all on function public.ai_top_customers(date, date, integer) from public, anon;
grant execute on function public.ai_top_customers(date, date, integer) to authenticated, service_role;
