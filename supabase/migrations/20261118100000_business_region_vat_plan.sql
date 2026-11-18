-- =============================================================================
-- Region, VAT and plan settings per business (UAE demo)
--
-- One idempotent migration: it can be run more than once and only adds or
-- replaces objects. It never deletes rows and never changes existing amounts,
-- dates or settings. New columns get defaults that keep every existing
-- business exactly as it is today: VAT off, English invoices, plan "full".
-- Existing sales and sales returns get vat_rate = 0 and vat_amount = 0.
--
-- VAT is INCLUSIVE: the price the customer pays already contains VAT. The
-- sale total does not change; the VAT part is only calculated and saved:
--   vat_amount = round(total * rate / (100 + rate), 2)
-- so no payment, ledger or report amount changes.
--
-- It runs as one transaction: if any statement fails, nothing is changed.
-- Run it in the Supabase SQL Editor. It contains no test data.
-- =============================================================================

begin;

-- 0. Safety check: stop unless this is a database of this app ----------------
do $$
begin
  if to_regclass('public.businesses') is null or to_regclass('public.sales') is null
     or to_regclass('public.sales_returns') is null or to_regclass('public.customers') is null
     or to_regprocedure('public.my_business_id()') is null then
    raise exception 'Stopped: this database does not have the tables of this app. Check that the right project is open.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'businesses' and column_name = 'tax_rate') then
    raise exception 'Stopped: businesses.tax_rate is missing. This migration reuses it as the VAT rate.';
  end if;
end;
$$;


-- 1. Business settings --------------------------------------------------------
-- businesses.tax_rate (existing column) is reused as the VAT rate.
alter table public.businesses
  add column if not exists vat_enabled boolean not null default false,
  add column if not exists trn text,
  add column if not exists name_ar text,
  add column if not exists address_ar text,
  add column if not exists invoice_language text not null default 'en',
  add column if not exists plan text not null default 'full';

-- NOT VALID: checks new and changed rows only, existing rows are never blocked
alter table public.businesses drop constraint if exists businesses_currency_code_check;
alter table public.businesses add constraint businesses_currency_code_check
  check (currency_code in ('PKR', 'AED')) not valid;

alter table public.businesses drop constraint if exists businesses_vat_rate_check;
alter table public.businesses add constraint businesses_vat_rate_check
  check (not vat_enabled or (tax_rate is not null and tax_rate > 0 and tax_rate <= 100));

alter table public.businesses drop constraint if exists businesses_trn_check;
alter table public.businesses add constraint businesses_trn_check
  check (trn is null or trn ~ '^[0-9]{15}$');

alter table public.businesses drop constraint if exists businesses_name_ar_check;
alter table public.businesses add constraint businesses_name_ar_check
  check (name_ar is null or char_length(name_ar) <= 120);

alter table public.businesses drop constraint if exists businesses_address_ar_check;
alter table public.businesses add constraint businesses_address_ar_check
  check (address_ar is null or char_length(address_ar) <= 300);

alter table public.businesses drop constraint if exists businesses_invoice_language_check;
alter table public.businesses add constraint businesses_invoice_language_check
  check (invoice_language in ('en', 'en_ar'));

alter table public.businesses drop constraint if exists businesses_plan_check;
alter table public.businesses add constraint businesses_plan_check
  check (plan in ('mobile_shop', 'repair_shop', 'full'));


-- 2. Customer TRN (optional) --------------------------------------------------
alter table public.customers add column if not exists trn text;

alter table public.customers drop constraint if exists customers_trn_check;
alter table public.customers add constraint customers_trn_check
  check (trn is null or trn ~ '^[0-9]{15}$');


-- 3. VAT on sales -------------------------------------------------------------
-- The defaults fill every existing sale with 0: old sales are not changed.
alter table public.sales
  add column if not exists vat_rate numeric(5,2) not null default 0,
  add column if not exists vat_amount numeric(14,2) not null default 0;

alter table public.sales drop constraint if exists sales_vat_check;
alter table public.sales add constraint sales_vat_check
  check (vat_rate >= 0 and vat_rate <= 100 and vat_amount >= 0);

-- New sale: take the VAT rate from the business settings at the moment of sale.
create or replace function public.sales_set_vat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_rate numeric;
begin
  select b.vat_enabled, coalesce(b.tax_rate, 0)
    into v_enabled, v_rate
  from public.businesses b
  where b.id = new.business_id;

  -- Never trust a value sent with the insert
  if coalesce(v_enabled, false) and v_rate > 0 then
    new.vat_rate := v_rate;
    new.vat_amount := round(coalesce(new.total, 0) * v_rate / (100 + v_rate), 2);
  else
    new.vat_rate := 0;
    new.vat_amount := 0;
  end if;
  return new;
end;
$$;

-- Existing sale: the rate saved at the moment of sale never changes. When the
-- total of a VAT sale changes, its VAT is recalculated with that same rate.
-- Sales with vat_rate = 0 (all old sales) always keep vat_amount = 0.
create or replace function public.sales_keep_vat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.vat_rate := old.vat_rate;
  if old.vat_rate > 0 and new.total is distinct from old.total then
    new.vat_amount := round(coalesce(new.total, 0) * old.vat_rate / (100 + old.vat_rate), 2);
  else
    new.vat_amount := old.vat_amount;
  end if;
  return new;
end;
$$;

revoke all on function public.sales_set_vat() from public, anon, authenticated;
revoke all on function public.sales_keep_vat() from public, anon, authenticated;

drop trigger if exists sales_set_vat on public.sales;
create trigger sales_set_vat
  before insert on public.sales
  for each row execute function public.sales_set_vat();

drop trigger if exists sales_keep_vat on public.sales;
create trigger sales_keep_vat
  before update on public.sales
  for each row execute function public.sales_keep_vat();


-- 4. VAT reversed on sales returns --------------------------------------------
alter table public.sales_returns
  add column if not exists vat_rate numeric(5,2) not null default 0,
  add column if not exists vat_amount numeric(14,2) not null default 0;

alter table public.sales_returns drop constraint if exists sales_returns_vat_check;
alter table public.sales_returns add constraint sales_returns_vat_check
  check (vat_rate >= 0 and vat_rate <= 100 and vat_amount >= 0 and vat_amount <= total);

-- A return reverses VAT with the rate of the original sale. The return that
-- brings the returned total up to the sale total reverses exactly the VAT
-- that is left, so rounding can never leave a cent of VAT behind.
-- create_sales_return inserts the return BEFORE it raises sales.returned_total,
-- so returned_total here is the total of the earlier returns.
create or replace function public.sales_returns_set_vat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric;
  v_sale_vat numeric;
  v_sale_total numeric;
  v_returned numeric;
  v_prev_vat numeric;
begin
  select s.vat_rate, s.vat_amount, s.total, s.returned_total
    into v_rate, v_sale_vat, v_sale_total, v_returned
  from public.sales s
  where s.id = new.sale_id;

  if coalesce(v_rate, 0) <= 0 then
    new.vat_rate := 0;
    new.vat_amount := 0;
    return new;
  end if;

  new.vat_rate := v_rate;
  select coalesce(sum(r.vat_amount), 0) into v_prev_vat
  from public.sales_returns r
  where r.sale_id = new.sale_id;

  if coalesce(v_returned, 0) + new.total >= v_sale_total then
    new.vat_amount := least(greatest(v_sale_vat - v_prev_vat, 0), new.total);
  else
    new.vat_amount := least(round(new.total * v_rate / (100 + v_rate), 2),
                            greatest(v_sale_vat - v_prev_vat, 0));
  end if;
  return new;
end;
$$;

-- Saved return VAT never changes afterwards
create or replace function public.sales_returns_keep_vat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.vat_rate := old.vat_rate;
  new.vat_amount := old.vat_amount;
  return new;
end;
$$;

revoke all on function public.sales_returns_set_vat() from public, anon, authenticated;
revoke all on function public.sales_returns_keep_vat() from public, anon, authenticated;

drop trigger if exists sales_returns_set_vat on public.sales_returns;
create trigger sales_returns_set_vat
  before insert on public.sales_returns
  for each row execute function public.sales_returns_set_vat();

drop trigger if exists sales_returns_keep_vat on public.sales_returns;
create trigger sales_returns_keep_vat
  before update on public.sales_returns
  for each row execute function public.sales_returns_keep_vat();

commit;
