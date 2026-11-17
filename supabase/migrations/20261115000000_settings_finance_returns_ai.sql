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


-- 1.5 Dashboard: use the low stock threshold from Settings ------------------
-- Same function as before, with two changes: the low stock limit now comes
-- from Settings (businesses.low_stock_threshold) instead of a fixed 5, and the
-- bank balance also includes wallet accounts (section 2).
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
    select s.id, s.total, s.discount, s.paid_amount,
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
  daily as (
    select sr.day, count(*) as sales_count, sum(sr.total) as sales_total,
           coalesce(sum(sp.profit), 0) as profit
    from sale_rows sr join sale_profit sp on sp.id = sr.id
    group by sr.day
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
    'sales_total', coalesce((select sum(total) from sale_rows), 0),
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
                  where p.business_id = v_biz and p.purchase_date between p_from and p_to and p.status = 'completed'), 0),
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
