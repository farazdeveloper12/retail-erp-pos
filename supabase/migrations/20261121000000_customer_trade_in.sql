-- =============================================================================
-- Buying used phones from customers (Buy from customer, POS trade-in)
--
-- 1. customer_purchases: one row per phone bought from a customer, either on
--    its own ("Buy from customer", paid from Cash or Bank) or as a trade-in
--    inside a POS sale (its value is credited to the sale).
-- 2. The phone goes into stock as a normal phone unit: condition "used",
--    cost = the price paid, no supplier and no purchase.
-- 3. A trade-in is NOT a discount: the sale total, its VAT and its profit stay
--    exactly as they are. The trade-in value is credited to the sale like a
--    return credit (sales.trade_in_credit, also added to paid_amount), and no
--    money moves through Cash or Bank for it.
-- 4. Only users with purchases.manage may buy from customers or take a
--    trade-in. An invoice with a trade-in cannot be cancelled (use a return).
-- 5. quick_add_phone_model: adds a phone model to the shared catalog from the
--    model picker, or returns the existing one.
-- 6. get_dashboard: "cash received on sales" leaves out trade-in credits.
--
-- One idempotent migration: it can be run more than once and only adds or
-- replaces objects. It never deletes rows and never changes existing amounts.
-- Existing sales get trade_in_credit = 0, so nothing changes for them.
-- get_dashboard is the version from 20261120000000_profit_before_vat.sql with
-- only the trade-in part added.
--
-- It runs as one transaction: if any statement fails, nothing is changed.
-- Run it in the Supabase SQL Editor. It contains no test data.
-- =============================================================================

begin;

-- 0. Safety check -------------------------------------------------------------
do $$
begin
  if to_regclass('public.phone_units') is null or to_regclass('public.phone_unit_costs') is null
     or to_regclass('public.cash_ledger') is null or to_regclass('public.customers') is null
     or to_regprocedure('public.create_quick_sale(jsonb)') is null
     or to_regprocedure('public.default_finance_account(uuid, text)') is null
     or to_regprocedure('public.finance_balance(uuid)') is null
     or to_regprocedure('public.get_sale_profits(uuid[])') is null then
    raise exception 'Stopped: run the earlier migrations first (up to 20261120000000_profit_before_vat.sql).';
  end if;
end;
$$;


-- 1. Columns and the new ledger category --------------------------------------
alter table public.customers add column if not exists id_number text;
alter table public.customers drop constraint if exists customers_id_number_check;
alter table public.customers add constraint customers_id_number_check
  check (id_number is null or char_length(id_number) between 5 and 40);

alter table public.sales add column if not exists trade_in_credit numeric(14,2) not null default 0;
alter table public.sales drop constraint if exists sales_trade_in_credit_check;
alter table public.sales add constraint sales_trade_in_credit_check
  check (trade_in_credit >= 0 and trade_in_credit <= total);

-- Same list as before plus 'customer_purchase'
alter table public.cash_ledger drop constraint if exists cash_ledger_category_check;
alter table public.cash_ledger add constraint cash_ledger_category_check
  check (category in (
    'supplier_payment', 'sale_receipt', 'customer_payment', 'expense', 'other',
    'opening_balance', 'deposit', 'withdrawal', 'transfer',
    'owner_capital_in', 'owner_capital_out', 'adjustment',
    'sale_refund', 'purchase_refund',
    'customer_purchase'));


-- 2. Phones bought from customers -----------------------------------------------
create table if not exists public.customer_purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  purchase_no integer not null,
  purchase_date date not null,
  customer_id uuid references public.customers (id),
  seller_name text not null,
  seller_phone text not null,
  seller_id_number text,
  phone_unit_id uuid not null references public.phone_units (id),
  imei text not null,
  description text not null,
  grade text not null,
  condition_notes text,
  price numeric(14,2) not null,
  payment_method text not null,
  account_id uuid references public.finance_accounts (id),
  sale_id uuid references public.sales (id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint customer_purchases_grade_check check (grade in ('A', 'B', 'C')),
  constraint customer_purchases_price_check check (price > 0),
  constraint customer_purchases_method_check check (payment_method in ('cash', 'bank', 'trade_in')),
  constraint customer_purchases_trade_in_check
    check ((payment_method = 'trade_in') = (sale_id is not null)),
  constraint customer_purchases_imei_check check (imei ~ '^[0-9]{15}$'),
  constraint customer_purchases_seller_check
    check (char_length(seller_name) between 1 and 120 and char_length(seller_phone) between 1 and 40
           and (seller_id_number is null or char_length(seller_id_number) between 5 and 40)),
  constraint customer_purchases_notes_check check (condition_notes is null or char_length(condition_notes) <= 500)
);

create unique index if not exists customer_purchases_no_key on public.customer_purchases (business_id, purchase_no);
create index if not exists customer_purchases_date_idx on public.customer_purchases (business_id, purchase_date desc);
create index if not exists customer_purchases_imei_idx on public.customer_purchases (business_id, imei);
create unique index if not exists customer_purchases_sale_key on public.customer_purchases (sale_id)
  where sale_id is not null;

alter table public.customer_purchases enable row level security;

-- Read only for purchase users; all writes go through the functions below
drop policy if exists customer_purchases_select on public.customer_purchases;
create policy customer_purchases_select on public.customer_purchases for select
  using (business_id = public.my_business_id()
         and (public.has_permission('purchases.view') or public.has_permission('purchases.manage')));


-- 3. Shared helper: validate the phone and put it into stock --------------------
-- Payload keys (the "phone" part): model_id, variant_id, color_id (optional),
-- imei, grade (A/B/C), condition_notes, price, sale_price (optional).
-- Returns the new phone unit id and the line description.
create or replace function public.customer_purchase_add_unit(
  p_biz uuid, p_uid uuid, p_phone jsonb, out unit_id uuid, out description text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model uuid;
  v_variant uuid;
  v_color uuid;
  v_imei text := regexp_replace(coalesce(p_phone ->> 'imei', ''), '\s', '', 'g');
  v_price numeric(14,2);
  v_sale numeric(14,2);
  v_brand_name text;
  v_model_name text;
  v_storage integer;
  v_ram integer;
  v_color_name text;
begin
  begin
    v_model := (p_phone ->> 'model_id')::uuid;
    v_variant := (p_phone ->> 'variant_id')::uuid;
    v_color := nullif(p_phone ->> 'color_id', '')::uuid;
    v_price := (p_phone ->> 'price')::numeric;
    v_sale := nullif(p_phone ->> 'sale_price', '')::numeric;
  exception when others then
    raise exception 'The phone details are not valid.';
  end;

  if v_imei !~ '^[0-9]{15}$' then
    raise exception 'The IMEI must be exactly 15 digits.';
  end if;
  if exists (select 1 from public.phone_units u
             where u.business_id = p_biz and u.imei = v_imei and u.status = 'in_stock') then
    raise exception 'The phone with IMEI % is already in stock.', v_imei;
  end if;
  if coalesce(p_phone ->> 'grade', '') not in ('A', 'B', 'C') then
    raise exception 'Choose the condition grade A, B or C.';
  end if;
  if char_length(coalesce(p_phone ->> 'condition_notes', '')) > 500 then
    raise exception 'The condition notes cannot be longer than 500 characters.';
  end if;
  if v_price is null or v_price <= 0 or v_price <> round(v_price, 2) then
    raise exception 'Enter the price paid for the phone (above zero, up to 2 decimals).';
  end if;
  if v_sale is not null and (v_sale < 0 or v_sale <> round(v_sale, 2)) then
    raise exception 'The sale price must be zero or more, with up to 2 decimals.';
  end if;

  select b.name, pm.name, mv.storage_gb, mv.ram_gb
    into v_brand_name, v_model_name, v_storage, v_ram
  from public.model_variants mv
  join public.product_models pm on pm.id = mv.model_id
  join public.brands b on b.id = pm.brand_id
  where mv.id = v_variant and mv.model_id = v_model and mv.is_active and pm.is_active;
  if not found then
    raise exception 'Choose a valid phone model and storage.';
  end if;
  if v_color is not null then
    select mc.name into v_color_name from public.model_colors mc
    where mc.id = v_color and mc.model_id = v_model and mc.is_active;
    if not found then
      raise exception 'The colour is not valid for this model.';
    end if;
  end if;

  insert into public.phone_units
    (business_id, model_id, variant_id, color_id, brand_name, model_name, storage_gb, ram_gb, color_name,
     condition, imei, sale_price, purchase_id, created_by)
  values
    (p_biz, v_model, v_variant, v_color, v_brand_name, v_model_name, v_storage, v_ram, v_color_name,
     'used', v_imei, v_sale, null, p_uid)
  returning id into unit_id;
  insert into public.phone_unit_costs (unit_id, business_id, purchase_cost, landed_cost)
  values (unit_id, p_biz, v_price, v_price);

  description := v_model_name || ' ' || v_storage || 'GB' || coalesce(' ' || v_color_name, '');
exception
  when unique_violation then
    raise exception 'The phone with IMEI % is already in stock.', v_imei;
end;
$$;

revoke all on function public.customer_purchase_add_unit(uuid, uuid, jsonb) from public, anon, authenticated;

-- Seller details: checks them and finds or creates the customer by phone.
create or replace function public.customer_purchase_seller(
  p_biz uuid, p_uid uuid, p_seller jsonb,
  out customer_id uuid, out seller_name text, out seller_phone text, out seller_id_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_digits text;
begin
  seller_name := nullif(regexp_replace(trim(coalesce(p_seller ->> 'seller_name', '')), '\s+', ' ', 'g'), '');
  seller_phone := nullif(trim(coalesce(p_seller ->> 'seller_phone', '')), '');
  seller_id_number := nullif(regexp_replace(trim(coalesce(p_seller ->> 'seller_id_number', '')), '\s+', ' ', 'g'), '');
  if seller_name is null or char_length(seller_name) > 120 then
    raise exception 'Enter the seller''s name (up to 120 characters).';
  end if;
  if seller_phone is null or char_length(seller_phone) > 40 then
    raise exception 'Enter the seller''s phone number (up to 40 characters).';
  end if;
  if seller_id_number is not null
     and (char_length(seller_id_number) not between 5 and 40 or seller_id_number !~ '^[0-9A-Za-z -]+$') then
    raise exception 'The CNIC / Emirates ID must be 5 to 40 letters, digits, spaces or dashes.';
  end if;

  -- Same customer as a sale with this phone number (digits compared)
  v_digits := regexp_replace(seller_phone, '[^0-9]', '', 'g');
  begin
    customer_id := nullif(p_seller ->> 'customer_id', '')::uuid;
  exception when others then
    raise exception 'The customer is not valid.';
  end;
  if customer_id is not null then
    if not exists (select 1 from public.customers c
                   where c.id = customer_id and c.business_id = p_biz and c.is_active) then
      raise exception 'Please choose an active customer.';
    end if;
  else
    select c.id into customer_id from public.customers c
    where c.business_id = p_biz and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = v_digits
      and v_digits <> ''
    order by c.is_active desc, c.created_at
    limit 1;
    if customer_id is null then
      insert into public.customers (business_id, name, phone, id_number, created_by)
      values (p_biz, seller_name, seller_phone, seller_id_number, p_uid)
      returning id into customer_id;
    end if;
  end if;

  -- Keep the ID number on the customer when it was not known yet
  if seller_id_number is not null then
    update public.customers c set id_number = seller_id_number
    where c.id = customer_id and c.id_number is null;
  end if;
end;
$$;

revoke all on function public.customer_purchase_seller(uuid, uuid, jsonb) from public, anon, authenticated;


-- 4. Buy from customer (paid from Cash or Bank) -----------------------------------
-- payload: seller_name, seller_phone, seller_id_number, customer_id (optional),
-- the phone keys of customer_purchase_add_unit, payment_method (cash|bank),
-- purchase_date (optional, not in the future).
create or replace function public.buy_from_customer(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  v_uid uuid := auth.uid();
  v_method text := p_payload ->> 'payment_method';
  v_date date;
  v_price numeric(14,2);
  v_account public.finance_accounts%rowtype;
  v_balance numeric;
  v_seller record;
  v_unit record;
  v_no integer;
  v_id uuid;
begin
  if v_uid is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('purchases.manage') then
    raise exception 'You do not have permission to buy phones from customers.';
  end if;
  if v_method is distinct from 'cash' and v_method is distinct from 'bank' then
    raise exception 'Choose Cash or Bank for the payment.';
  end if;
  v_date := public.finance_entry_date(p_payload ->> 'purchase_date');

  select * into v_seller from public.customer_purchase_seller(v_biz, v_uid, p_payload);
  select * into v_unit from public.customer_purchase_add_unit(v_biz, v_uid, p_payload);
  v_price := (p_payload ->> 'price')::numeric;

  -- Same rule as supplier payments: the default account must hold enough.
  -- The account row is locked so two payments cannot both pass the check.
  select * into v_account from public.finance_accounts a
    where a.id = public.default_finance_account(v_biz, v_method)
    for update;
  if not found then
    raise exception 'The default % account is missing.', v_method;
  end if;
  v_balance := public.finance_balance(v_account.id);
  if v_balance < v_price then
    raise exception 'Not enough money in % to pay for this phone. The balance is %, the payment is %.',
      v_account.name, public.finance_format(v_balance), public.finance_format(v_price);
  end if;

  v_no := public.next_doc_no(v_biz, 'customer_purchase');
  insert into public.customer_purchases
    (business_id, purchase_no, purchase_date, customer_id, seller_name, seller_phone, seller_id_number,
     phone_unit_id, imei, description, grade, condition_notes, price, payment_method, account_id, created_by)
  values
    (v_biz, v_no, v_date, v_seller.customer_id, v_seller.seller_name, v_seller.seller_phone,
     v_seller.seller_id_number, v_unit.unit_id,
     regexp_replace(p_payload ->> 'imei', '\s', '', 'g'), v_unit.description, p_payload ->> 'grade',
     nullif(trim(coalesce(p_payload ->> 'condition_notes', '')), ''), v_price, v_method, v_account.id, v_uid)
  returning id into v_id;

  insert into public.cash_ledger
    (business_id, entry_date, account, account_id, direction, amount, category,
     party_type, party_id, ref_type, ref_id, notes, created_by)
  values
    (v_biz, v_date, v_account.kind, v_account.id, 'out', v_price, 'customer_purchase',
     'customer', v_seller.customer_id, 'customer_purchase', v_id,
     'Phone bought from customer CP-' || lpad(v_no::text, 6, '0'), v_uid);

  return jsonb_build_object('id', v_id, 'purchase_no', v_no, 'phone_unit_id', v_unit.unit_id);
end;
$$;

revoke all on function public.buy_from_customer(jsonb) from public, anon;
grant execute on function public.buy_from_customer(jsonb) to authenticated, service_role;


-- 5. POS sale with a trade-in ---------------------------------------------------
-- payload: the create_quick_sale payload (sale, supplier ...) plus
-- trade_in: { seller and phone keys as above }.
-- The sale is saved by create_quick_sale exactly as without a trade-in; then
-- the trade-in value is credited to it and the old phone goes into stock.
create or replace function public.create_trade_in_sale(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz uuid := public.my_business_id();
  v_uid uuid := auth.uid();
  v_trade jsonb := p_payload -> 'trade_in';
  v_sale_payload jsonb := p_payload -> 'sale';
  v_value numeric(14,2);
  v_result jsonb;
  v_sale public.sales%rowtype;
  v_seller record;
  v_unit record;
  v_no integer;
  v_id uuid;
begin
  if v_uid is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('purchases.manage') then
    raise exception 'You do not have permission to take a trade-in.';
  end if;
  if jsonb_typeof(v_trade) is distinct from 'object' or jsonb_typeof(v_sale_payload) is distinct from 'object' then
    raise exception 'The trade-in details are missing.';
  end if;
  begin
    v_value := (v_trade ->> 'price')::numeric;
  exception when others then
    raise exception 'Enter the trade-in value.';
  end;
  if v_value is null or v_value <= 0 then
    raise exception 'Enter the trade-in value (above zero).';
  end if;

  -- The seller is the buyer of this sale: the sale gets the same customer, so
  -- the part not paid now (covered by the trade-in) is never on a walk-in.
  select * into v_seller from public.customer_purchase_seller(v_biz, v_uid, v_trade);
  if nullif(v_sale_payload ->> 'customer_id', '') is null then
    v_sale_payload := v_sale_payload || jsonb_build_object('customer_id', v_seller.customer_id);
  end if;

  v_result := public.create_quick_sale(jsonb_set(p_payload - 'trade_in', '{sale}', v_sale_payload));

  select * into v_sale from public.sales s
  where s.id = (v_result ->> 'sale_id')::uuid and s.business_id = v_biz
  for update;
  if v_sale.paid_amount + v_value > v_sale.total then
    raise exception 'The trade-in value plus the amount paid now cannot be more than the invoice total (%).',
      public.finance_format(v_sale.total);
  end if;
  update public.sales
     set paid_amount = paid_amount + v_value, trade_in_credit = trade_in_credit + v_value
   where id = v_sale.id;

  select * into v_unit from public.customer_purchase_add_unit(v_biz, v_uid, v_trade);
  v_no := public.next_doc_no(v_biz, 'customer_purchase');
  insert into public.customer_purchases
    (business_id, purchase_no, purchase_date, customer_id, seller_name, seller_phone, seller_id_number,
     phone_unit_id, imei, description, grade, condition_notes, price, payment_method, sale_id, created_by)
  values
    (v_biz, v_no, (v_sale.created_at at time zone 'Asia/Karachi')::date, v_sale.customer_id,
     v_seller.seller_name, v_seller.seller_phone, v_seller.seller_id_number, v_unit.unit_id,
     regexp_replace(v_trade ->> 'imei', '\s', '', 'g'), v_unit.description, v_trade ->> 'grade',
     nullif(trim(coalesce(v_trade ->> 'condition_notes', '')), ''), v_value, 'trade_in', v_sale.id, v_uid)
  returning id into v_id;

  return v_result || jsonb_build_object(
    'paid', v_sale.paid_amount, 'trade_in', v_value,
    'balance', v_sale.total - v_sale.paid_amount - v_value,
    'trade_in_id', v_id, 'trade_in_no', v_no);
end;
$$;

revoke all on function public.create_trade_in_sale(jsonb) from public, anon;
grant execute on function public.create_trade_in_sale(jsonb) to authenticated, service_role;

-- An invoice with a trade-in cannot be cancelled: the old phone and its credit
-- would be left behind. Its items can be returned instead.
create or replace function public.block_cancel_with_trade_in()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'void' and old.status <> 'void' and old.trade_in_credit > 0 then
    raise exception 'This invoice has a trade-in, so it cannot be cancelled. Return the items instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists sales_block_cancel_with_trade_in on public.sales;
create trigger sales_block_cancel_with_trade_in
  before update of status on public.sales
  for each row execute function public.block_cancel_with_trade_in();


-- 6. Add a phone model from the model picker ----------------------------------------
-- payload: brand, model, storage_gb, ram_gb (optional).
-- Reuses an existing brand, model and storage option (names compared without
-- case), so the shared catalog gets no duplicates.
create or replace function public.quick_add_phone_model(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_brand_name text := nullif(regexp_replace(trim(coalesce(p_payload ->> 'brand', '')), '\s+', ' ', 'g'), '');
  v_model_name text := nullif(regexp_replace(trim(coalesce(p_payload ->> 'model', '')), '\s+', ' ', 'g'), '');
  v_storage integer;
  v_ram integer;
  v_brand uuid;
  v_brand_active boolean;
  v_model uuid;
  v_model_active boolean;
  v_variant uuid;
  v_variant_active boolean;
begin
  if v_uid is null or public.my_business_id() is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not (public.has_permission('purchases.manage') or public.has_permission('catalog.manage')
          or public.has_permission('catalog.create')) then
    raise exception 'You do not have permission to add phone models.';
  end if;
  if v_brand_name is null or char_length(v_brand_name) > 60 then
    raise exception 'Enter the brand (up to 60 characters).';
  end if;
  if v_model_name is null or char_length(v_model_name) > 100 then
    raise exception 'Enter the model name (up to 100 characters).';
  end if;
  begin
    v_storage := (p_payload ->> 'storage_gb')::integer;
    v_ram := nullif(p_payload ->> 'ram_gb', '')::integer;
  exception when others then
    raise exception 'Storage and RAM must be whole numbers.';
  end;
  if v_storage is null or v_storage < 1 or v_storage > 4096 then
    raise exception 'Storage must be from 1 to 4096 GB.';
  end if;
  if v_ram is not null and (v_ram < 1 or v_ram > 64) then
    raise exception 'RAM must be from 1 to 64 GB.';
  end if;

  select b.id, b.is_active into v_brand, v_brand_active from public.brands b
  where lower(b.name) = lower(v_brand_name) order by b.is_active desc limit 1;
  if v_brand is null then
    insert into public.brands (name, created_by) values (v_brand_name, v_uid) returning id into v_brand;
  elsif not v_brand_active then
    raise exception 'The brand % is deactivated in the catalog. Ask a manager to activate it.', v_brand_name;
  end if;

  select pm.id, pm.is_active into v_model, v_model_active from public.product_models pm
  where pm.brand_id = v_brand and lower(pm.name) = lower(v_model_name) order by pm.is_active desc limit 1;
  if v_model is null then
    insert into public.product_models (brand_id, name, product_type, created_by)
    values (v_brand, v_model_name, 'phone', v_uid) returning id into v_model;
  elsif not v_model_active then
    raise exception 'The model % is deactivated in the catalog. Ask a manager to activate it.', v_model_name;
  end if;

  select mv.id, mv.is_active into v_variant, v_variant_active from public.model_variants mv
  where mv.model_id = v_model and mv.storage_gb = v_storage and mv.ram_gb is not distinct from v_ram
  order by mv.is_active desc limit 1;
  if v_variant is null then
    insert into public.model_variants (model_id, storage_gb, ram_gb, created_by)
    values (v_model, v_storage, v_ram, v_uid) returning id into v_variant;
  elsif not v_variant_active then
    raise exception 'This storage option is deactivated in the catalog. Ask a manager to activate it.';
  end if;

  return jsonb_build_object('brand_id', v_brand, 'model_id', v_model, 'variant_id', v_variant);
end;
$$;

revoke all on function public.quick_add_phone_model(jsonb) from public, anon;
grant execute on function public.quick_add_phone_model(jsonb) to authenticated, service_role;


-- 7. Dashboard: "cash received on sales" leaves out trade-in credits -------------
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
    -- Money actually received: return credits and trade-in credits are not cash
    select s.id, s.total, s.discount, s.vat_amount,
           s.paid_amount - s.return_credit - s.trade_in_credit as paid_amount,
           (s.created_at at time zone 'Asia/Karachi')::date as day
    from public.sales s
    where s.business_id = v_biz and s.status = 'completed'
      and (s.created_at at time zone 'Asia/Karachi')::date between p_from and p_to
  ),
  -- Profit is calculated on the amount before VAT: the VAT inside the total
  -- belongs to the tax authority. Without VAT, vat_amount is 0.
  sale_profit as (
    select sr.id, sr.day,
           coalesce(sum(si.line_total - c.unit_cost * si.quantity), 0) - sr.discount - sr.vat_amount as profit
    from sale_rows sr
    left join public.sale_items si on si.sale_id = sr.id
    left join public.sale_item_costs c on c.item_id = si.id
    group by sr.id, sr.day, sr.discount, sr.vat_amount
  ),
  daily_sales as (
    select sr.day, count(*) as sales_count, sum(sr.total) as sales_total,
           coalesce(sum(sp.profit), 0) as profit
    from sale_rows sr join sale_profit sp on sp.id = sr.id
    group by sr.day
  ),
  -- Returns count on the day of the return. Profit loses the returned value,
  -- and gets the cost back when the item went back into stock.
  -- The VAT reversed by a return is not profit either, so it is taken off
  -- once per return (not per item).
  return_rows as (
    select r.id, r.return_date as day, r.vat_amount, sum(ri.line_total) as amount,
           sum(ri.line_total - case when ri.restock then coalesce(rc.unit_cost, 0) * ri.quantity else 0 end) as profit
    from public.sales_returns r
    join public.sales_return_items ri on ri.return_id = r.id
    left join public.sales_return_item_costs rc on rc.item_id = ri.id
    where r.business_id = v_biz and r.return_date between p_from and p_to
    group by r.id, r.return_date, r.vat_amount
  ),
  daily_returns as (
    select rr.day, sum(rr.amount) as amount, sum(rr.profit - rr.vat_amount) as profit
    from return_rows rr
    group by rr.day
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

commit;
