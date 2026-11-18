-- =============================================================================
-- DEMO SEED: "Al Noor Mobiles", Deira, Dubai (UAE demo)
--
-- TEST PROJECT ONLY (gwadar-test). Never run this on the real project.
--
-- Resets the demo: deletes all transactions of the single test business and
-- creates a fake Dubai shop with 30 days of realistic AED data (up to
-- yesterday). It can be run again at any time and always creates the same
-- data (fixed random seed).
--
-- Safety: it stops with an error unless ALL of these are true:
--   * there is exactly one business;
--   * its name is "Test Mobile Shop" or "Al Noor Mobiles";
--   * the test owner owner@test.local exists and belongs to that business;
--   * every login (auth.users) has an email ending in @test.local.
-- Everything runs in one transaction: on any error nothing is changed.
--
-- Needs these migrations first: 20261118100000 (VAT), 20261119000000
-- (Item not in stock) and 20261120000000 (profit before VAT).
--
-- All data is created through the app's own database functions while acting
-- as the test owner, so stock, IMEIs, VAT, cost and profit are calculated
-- exactly as in the app. The functions save everything with today's time, so
-- after each step only the DATE/TIME of the rows just created is moved back
-- to the demo day (shop hours 11:00-22:00 Dubai time). Amounts are never
-- changed.
--
-- Keeps: the test logins and profiles, the business row (renamed), the
-- default Cash and Bank accounts and the shared phone catalog.
-- =============================================================================

begin;

-- Helpers (temporary: they disappear when the SQL Editor session ends) -------

-- A 15-digit IMEI with a valid Luhn check digit, from a running number
create or replace function pg_temp.demo_imei(p_n integer)
returns text
language plpgsql
immutable
as $$
declare
  v_body text := '35' || lpad((((p_n::bigint * 7919) % 1000000000000) + p_n)::text, 12, '0');
  v_sum integer := 0;
  v_digit integer;
begin
  v_body := right(v_body, 14);
  for i in 1..14 loop
    v_digit := substr(v_body, i, 1)::integer;
    if i % 2 = 0 then
      v_digit := v_digit * 2;
      if v_digit > 9 then
        v_digit := v_digit - 9;
      end if;
    end if;
    v_sum := v_sum + v_digit;
  end loop;
  return v_body || ((10 - v_sum % 10) % 10)::text;
end;
$$;

-- A moment on a demo day: p_minute minutes after 11:00, Dubai time
create or replace function pg_temp.demo_ts(p_day date, p_minute integer)
returns timestamptz
language sql
immutable
as $$
  select ((p_day + time '11:00') + make_interval(mins => p_minute)) at time zone 'Asia/Dubai';
$$;

-- Moves every row created in this transaction and not moved yet (its time is
-- still now(), the start of the transaction) to p_ts. Only dates and times
-- change; columns that do not exist are skipped.
create or replace function pg_temp.demo_backdate(p_biz uuid, p_ts timestamptz)
returns void
language plpgsql
as $$
declare
  v_pair text[];
begin
  update public.cash_ledger
     set entry_date = (p_ts at time zone 'Asia/Karachi')::date, created_at = p_ts
   where business_id = p_biz and created_at = now();

  foreach v_pair slice 1 in array array[
    ['sales', 'created_at'], ['sale_payments', 'created_at'], ['stock_movements', 'created_at'],
    ['phone_units', 'created_at'], ['phone_units', 'sold_at'], ['phone_units', 'updated_at'],
    ['purchases', 'created_at'], ['purchase_items', 'created_at'], ['purchase_payments', 'created_at'],
    ['sales_returns', 'created_at'], ['expenses', 'created_at'], ['customers', 'created_at'],
    ['suppliers', 'created_at'], ['products', 'created_at'], ['product_stock', 'updated_at']]
  loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = v_pair[1] and column_name = v_pair[2])
       and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = v_pair[1] and column_name = 'business_id') then
      execute format('update public.%I set %I = $1 where business_id = $2 and %I = now()',
                     v_pair[1], v_pair[2], v_pair[2])
        using p_ts, p_biz;
    end if;
  end loop;
end;
$$;


do $$
declare
  v_biz uuid;
  v_owner uuid;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_day date;
  v_cash uuid;
  v_bank uuid;
  v_brand uuid;
  v_model uuid;
  v_variant uuid;
  v_sup_a uuid;
  v_sup_b uuid;
  v_sup_c uuid;
  v_sup_d uuid;
  v_purchase_a uuid;
  v_purchase_c uuid;
  v_items jsonb;
  v_imeis jsonb;
  v_res jsonb;
  v_imei text;
  v_imei_no integer := 0;
  v_minute integer;
  v_planned integer;
  v_slot integer;
  v_cap integer;
  v_phones_today integer;
  v_day_total numeric;
  v_total numeric;
  v_paid numeric;
  v_price numeric;
  v_cost numeric;
  v_disc numeric;
  v_qty integer;
  v_warranty integer;
  v_unit uuid;
  v_product uuid;
  v_picked uuid[];
  v_customer uuid;
  v_method text;
  v_sale uuid;
  v_unstocked boolean;
  v_credit_count integer := 0;
  v_pencil_sale uuid;
  v_line uuid;
  r_m record;
  r_p record;
  r_c record;
  r_e record;
  r_u record;
begin
  -- 1. Safety checks -----------------------------------------------------------
  if (select count(*) from public.businesses) <> 1 then
    raise exception 'Stopped: there must be exactly one business. This does not look like gwadar-test.';
  end if;
  select b.id into v_biz from public.businesses b
  where b.name in ('Test Mobile Shop', 'Al Noor Mobiles');
  if v_biz is null then
    raise exception 'Stopped: the business is not "Test Mobile Shop" or "Al Noor Mobiles". This does not look like gwadar-test.';
  end if;
  if exists (select 1 from auth.users au where au.email is null or au.email not like '%@test.local') then
    raise exception 'Stopped: a login without an @test.local email exists. This does not look like gwadar-test.';
  end if;
  select pr.id into v_owner
  from public.profiles pr join auth.users au on au.id = pr.id
  where au.email = 'owner@test.local';
  if v_owner is null then
    raise exception 'Stopped: the test owner owner@test.local was not found.';
  end if;

  -- Act as the test owner for this transaction only
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  if public.my_business_id() is distinct from v_biz then
    raise exception 'Stopped: owner@test.local does not belong to the test business.';
  end if;

  -- Needed migrations
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'businesses' and column_name = 'vat_enabled')
     or not exists (select 1 from pg_constraint pc
                    where pc.conname = 'sale_items_item_type_check'
                      and pg_get_constraintdef(pc.oid) ilike '%unstocked%')
     or to_regprocedure('public.get_sale_profits(uuid[])') is null then
    raise exception 'Stopped: run the migrations 20261118100000, 20261119000000 and 20261120000000 first.';
  end if;

  -- 2. Delete the old test data (same order as test-cleanup.sql) -----------------
  if to_regclass('public.ai_usage') is not null then
    execute 'delete from public.ai_usage where business_id = $1' using v_biz;
  end if;
  delete from public.warranty_claim_events where business_id = v_biz;
  delete from public.warranty_claims where business_id = v_biz;
  delete from public.sales_return_item_costs where business_id = v_biz;
  delete from public.sales_return_items where business_id = v_biz;
  delete from public.sales_returns where business_id = v_biz;
  delete from public.purchase_return_items where business_id = v_biz;
  delete from public.purchase_returns where business_id = v_biz;
  delete from public.finance_counts where business_id = v_biz;
  update public.cash_ledger set reversal_of = null where business_id = v_biz;
  delete from public.cash_ledger where business_id = v_biz;
  delete from public.sale_payments where business_id = v_biz;
  delete from public.sale_item_costs where business_id = v_biz;
  delete from public.sale_items where business_id = v_biz;
  delete from public.stock_movements where business_id = v_biz;
  delete from public.phone_unit_costs where business_id = v_biz;
  delete from public.phone_units where business_id = v_biz;
  delete from public.sales where business_id = v_biz;
  delete from public.purchase_payments where business_id = v_biz;
  delete from public.purchase_items where business_id = v_biz;
  delete from public.purchases where business_id = v_biz;
  delete from public.product_stock where business_id = v_biz;
  delete from public.product_costs where business_id = v_biz;
  delete from public.products where business_id = v_biz;
  delete from public.product_categories where business_id = v_biz;
  delete from public.customers where business_id = v_biz;
  delete from public.suppliers where business_id = v_biz;
  delete from public.document_counters where business_id = v_biz;
  delete from public.expenses where business_id = v_biz;
  delete from public.expense_categories where business_id = v_biz;
  delete from public.finance_accounts where business_id = v_biz and not is_default;
  update public.finance_accounts set opening_balance = 0 where business_id = v_biz;

  -- 3. The Dubai shop ------------------------------------------------------------
  update public.businesses
     set name = 'Al Noor Mobiles',
         legal_name = 'Al Noor Mobiles Trading LLC',
         address = 'Shop 14, Al Sabkha Road, near Naif Souq, Deira, Dubai, United Arab Emirates',
         phone = '04 222 5147',
         email = 'sales@alnoor-mobiles.test',
         currency_code = 'AED',
         tax_label = 'VAT',
         tax_rate = 5,
         vat_enabled = true,
         trn = '100000000000003',
         name_ar = 'النور للهواتف المتحركة',
         address_ar = 'محل 14، شارع السبخة، بالقرب من سوق نايف، ديرة، دبي، الإمارات العربية المتحدة',
         invoice_language = 'en_ar',
         plan = 'full',
         invoice_footer = 'Thank you for shopping at Al Noor Mobiles. All prices include 5% VAT.',
         warranty_terms = 'New phones: 1 year warranty against manufacturing defects. Accessories: as stated per item. No warranty for water or physical damage. Returns within 7 days with the original box and invoice.',
         date_format = 'medium',
         invoice_paper = 'a4',
         invoice_show_logo = true,
         invoice_show_customer_phone = true,
         invoice_show_warranty = true,
         invoice_show_payment_method = true,
         low_stock_threshold = 3,
         logo_url = null
   where id = v_biz;

  -- Same "random" demo data on every run
  perform setseed(0.2026);
  v_day := v_today - 30;

  -- Opening balances on the first demo day
  v_cash := public.default_finance_account(v_biz, 'cash');
  v_bank := public.default_finance_account(v_biz, 'bank');
  if v_cash is null or v_bank is null then
    raise exception 'Stopped: the default Cash or Bank account is missing.';
  end if;
  perform public.update_finance_account(jsonb_build_object(
    'account_id', v_cash, 'name', 'Cash', 'opening_balance', '20000', 'opening_date', v_day::text));
  perform public.update_finance_account(jsonb_build_object(
    'account_id', v_bank, 'name', 'Emirates NBD', 'details', 'Current account (demo)',
    'opening_balance', '150000', 'opening_date', v_day::text));

  -- Expense categories
  insert into public.expense_categories (business_id, name)
  select v_biz, x.name
  from unnest(array['Rent', 'Utilities', 'Salaries', 'Shop supplies', 'Transport',
                    'Internet & phone', 'Refreshments']) as x(name);

  -- Phone models (shared catalog: reused when they already exist).
  -- qty_a / qty_c / qty_d: units bought on day 30 / 18 / 9.
  -- Prices include 5% VAT; the margin before VAT is about 8-12%.
  create temp table demo_models (
    idx integer, brand text, model text, storage integer, ram integer,
    cost numeric, price numeric, qty_a integer, qty_c integer, qty_d integer,
    model_id uuid, variant_id uuid) on commit drop;
  insert into demo_models (idx, brand, model, storage, ram, cost, price, qty_a, qty_c, qty_d) values
    (1,  'Apple',   'iPhone 16 Pro',     256, 8,  4100, 4869, 2, 1, 1),
    (2,  'Apple',   'iPhone 15 Pro Max', 256, 8,  4350, 5149, 2, 1, 0),
    (3,  'Apple',   'iPhone 15',         128, 6,  2850, 3379, 3, 2, 1),
    (4,  'Apple',   'iPhone 14',         128, 6,  2350, 2789, 3, 1, 1),
    (5,  'Apple',   'iPhone 13',         128, 4,  1850, 2199, 3, 2, 1),
    (6,  'Samsung', 'Galaxy S24 Ultra',  256, 12, 3900, 4629, 2, 1, 0),
    (7,  'Samsung', 'Galaxy S24',        256, 8,  2650, 3149, 3, 1, 1),
    (8,  'Samsung', 'Galaxy A55',        128, 8,  1150, 1369, 3, 2, 1),
    (9,  'Samsung', 'Galaxy A35',        128, 6,  900,  1069, 3, 1, 1),
    (10, 'Samsung', 'Galaxy A15',        128, 4,  480,  569,  3, 2, 0),
    (11, 'Xiaomi',  'Redmi Note 13 Pro', 256, 8,  900,  1069, 3, 1, 1),
    (12, 'Xiaomi',  'Redmi 13C',         128, 4,  370,  439,  3, 2, 0),
    (13, 'Xiaomi',  'Xiaomi 14',         256, 12, 2300, 2729, 2, 0, 0),
    (14, 'Oppo',    'Reno 11',           256, 8,  1150, 1369, 3, 1, 0),
    (15, 'Oppo',    'A78',               128, 8,  620,  739,  3, 1, 0);

  for r_m in select * from demo_models order by idx loop
    v_brand := null;
    v_model := null;
    v_variant := null;
    select br.id into v_brand from public.brands br where lower(br.name) = lower(r_m.brand) limit 1;
    if v_brand is null then
      insert into public.brands (name, created_by) values (r_m.brand, v_owner) returning id into v_brand;
    end if;
    select pm.id into v_model from public.product_models pm
    where pm.brand_id = v_brand and lower(pm.name) = lower(r_m.model) limit 1;
    if v_model is null then
      insert into public.product_models (brand_id, name, created_by)
      values (v_brand, r_m.model, v_owner) returning id into v_model;
    end if;
    select mv.id into v_variant from public.model_variants mv
    where mv.model_id = v_model and mv.storage_gb = r_m.storage
    order by mv.ram_gb desc nulls last limit 1;
    if v_variant is null then
      insert into public.model_variants (model_id, storage_gb, ram_gb, created_by)
      values (v_model, r_m.storage, r_m.ram, v_owner) returning id into v_variant;
    end if;
    update demo_models set model_id = v_model, variant_id = v_variant where idx = r_m.idx;
  end loop;

  -- Accessories. qty_b: bought on day 30, qty_d: restocked on day 9.
  -- Prices include 5% VAT; the margin before VAT is about 35-50%.
  -- weight: how often it sells; addon: sold together with a phone.
  create temp table demo_products (
    idx integer, name text, cost numeric, price numeric, qty_b integer, qty_d integer,
    warranty integer, weight numeric, addon boolean, product_id uuid) on commit drop;
  insert into demo_products (idx, name, cost, price, qty_b, qty_d, warranty, weight, addon) values
    (1,  'Apple 20W USB-C Power Adapter',           40,  79,  35, 10, 365, 8,  true),
    (2,  'Samsung 25W Super Fast Charger',          35,  69,  30, 10, 180, 7,  true),
    (3,  'USB-C to USB-C Cable 1m',                 14,  29,  40, 20, 30,  8,  true),
    (4,  'USB-C to Lightning Cable 1m',             18,  35,  40, 20, 30,  7,  true),
    (5,  'iPhone 15 Silicone Case',                 25,  49,  50, 15, 0,   8,  true),
    (6,  'Galaxy S24 Clear Case',                   23,  45,  45, 10, 0,   6,  true),
    (7,  'Tempered Glass Screen Protector iPhone',  15,  29,  60, 30, 0,   10, true),
    (8,  'Tempered Glass Screen Protector Samsung', 15,  29,  50, 20, 0,   8,  true),
    (9,  'Apple AirPods Pro (2nd generation)',      560, 949, 25, 10, 365, 8,  true),
    (10, 'Samsung Galaxy Buds FE',                  185, 349, 12, 0,  365, 3,  false),
    (11, 'Anker Power Bank 10000mAh',               66,  129, 25, 10, 365, 7,  true),
    (12, 'Anker Power Bank 20000mAh',               92,  179, 25, 10, 365, 6,  true),
    (13, 'Dual USB Car Charger 36W',                25,  49,  20, 0,  90,  2,  false),
    (14, 'Magnetic Car Phone Holder',               20,  39,  20, 0,  0,   2,  false),
    (15, 'SanDisk 128GB microSD Card',              34,  65,  20, 0,  365, 2,  true),
    (16, 'Apple Watch Sport Band 45mm',             25,  49,  15, 0,  0,   1,  false),
    (17, 'Wired Earphones USB-C',                   13,  25,  30, 0,  30,  3,  false),
    (18, 'JBL Go 3 Bluetooth Speaker',              88,  169, 15, 0,  365, 3,  false),
    (19, 'Redmi Watch 4',                           145, 269, 12, 0,  365, 2,  false),
    (20, 'MagSafe Charger 15W',                     88,  169, 15, 0,  180, 3,  false);

  for r_p in select * from demo_products order by idx loop
    insert into public.products (business_id, name, sale_price, created_by)
    values (v_biz, r_p.name, r_p.price, v_owner) returning id into v_product;
    update demo_products set product_id = v_product where idx = r_p.idx;
  end loop;

  -- Suppliers
  insert into public.suppliers (business_id, name, phone, created_by)
  values (v_biz, 'Al Murar Mobile Trading LLC', '04 226 1180', v_owner) returning id into v_sup_a;
  insert into public.suppliers (business_id, name, phone, created_by)
  values (v_biz, 'Naif Accessories Wholesale', '04 225 9034', v_owner) returning id into v_sup_b;
  insert into public.suppliers (business_id, name, phone, created_by)
  values (v_biz, 'Deira Phone Distribution FZE', '04 272 6651', v_owner) returning id into v_sup_c;
  insert into public.suppliers (business_id, name, phone, created_by)
  values (v_biz, 'Gulf Gadgets General Trading LLC', '04 238 4412', v_owner) returning id into v_sup_d;

  -- Customers (UAE mobile numbers; one company with a TRN)
  create temp table demo_customers (idx integer, name text, phone text, trn text, id uuid) on commit drop;
  insert into demo_customers (idx, name, phone, trn) values
    (1,  'Ahmed Al Mansoori',     '050 214 7731', null),
    (2,  'Fatima Al Hashimi',     '055 318 9024', null),
    (3,  'Mohammed Rafiq',        '052 447 1089', null),
    (4,  'Priya Nair',            '056 902 3317', null),
    (5,  'Omar Haddad',           '054 771 2490', null),
    (6,  'Sara Khalid',           '050 663 1852', null),
    (7,  'Rashid Al Suwaidi',     '055 120 4476', null),
    (8,  'Imran Qureshi',         '052 389 6603', null),
    (9,  'Maria Santos',          '056 245 7718', null),
    (10, 'Yousef Abdullah',       '050 908 3345', null),
    (11, 'Aisha Rahman',          '054 517 6629', null),
    (12, 'Hassan Tahir',          '055 734 2091', null),
    (13, 'Grace Mendoza',         '052 610 4458', null),
    (14, 'Khalid Al Marri',       '056 381 9906', null),
    (15, 'Gulf Star Trading LLC', '050 552 7781', '100234567800003');
  for r_c in select * from demo_customers order by idx loop
    insert into public.customers (business_id, name, phone, trn, created_by)
    values (v_biz, r_c.name, r_c.phone, r_c.trn, v_owner) returning id into v_customer;
    update demo_customers set id = v_customer where idx = r_c.idx;
  end loop;

  -- Opening balances, catalog, customers and suppliers: early on day 30
  perform pg_temp.demo_backdate(v_biz, pg_temp.demo_ts(v_day, -120));

  -- Sale price and cost of every phone bought, by IMEI (for the sales below)
  create temp table demo_units (imei text primary key, price numeric, cost numeric) on commit drop;
  -- Credit sales and the day the customer pays the rest (null: still open)
  create temp table demo_credit (sale_id uuid, amount numeric, pay_day date, method text) on commit drop;

  -- 4. Thirty days, oldest first, up to yesterday (nothing is in the future) ----
  for v_n in reverse 30..1 loop
    v_day := v_today - v_n;

    -- Phone purchases on days 30, 18 and 9 -----------------------------------
    if v_n in (30, 18, 9) then
      v_items := '[]'::jsonb;
      for r_m in select * from demo_models order by idx loop
        v_qty := case v_n when 30 then r_m.qty_a when 18 then r_m.qty_c else r_m.qty_d end;
        if v_qty > 0 then
          v_imeis := '[]'::jsonb;
          for v_i in 1..v_qty loop
            v_imei_no := v_imei_no + 1;
            v_imei := pg_temp.demo_imei(v_imei_no);
            v_imeis := v_imeis || to_jsonb(v_imei);
            insert into demo_units (imei, price, cost) values (v_imei, r_m.price, r_m.cost);
          end loop;
          v_items := v_items || jsonb_build_array(jsonb_build_object(
            'item_type', 'phone', 'model_id', r_m.model_id, 'variant_id', r_m.variant_id,
            'color_id', null, 'condition', 'new', 'unit_cost', r_m.cost, 'sale_price', r_m.price,
            'imeis', v_imeis));
        end if;
      end loop;
      if v_n = 9 then
        -- Restock of fast-moving accessories with the last phone purchase
        for r_p in select * from demo_products where qty_d > 0 order by idx loop
          v_items := v_items || jsonb_build_array(jsonb_build_object(
            'item_type', 'accessory', 'product_id', r_p.product_id, 'quantity', r_p.qty_d,
            'unit_cost', r_p.cost, 'sale_price', r_p.price));
        end loop;
      end if;
      select sum((x.value ->> 'unit_cost')::numeric
                 * coalesce((x.value ->> 'quantity')::numeric, jsonb_array_length(x.value -> 'imeis')))
        into v_total
      from jsonb_array_elements(v_items) x;

      v_res := public.create_purchase(jsonb_build_object(
        'supplier_id', case v_n when 30 then v_sup_a when 18 then v_sup_c else v_sup_d end,
        'purchase_date', v_day::text,
        'supplier_invoice_no', case v_n when 30 then 'AMT-24811' when 18 then 'DPD-5530' else 'GG-1187' end,
        'extra_cost', 0,
        -- Day 30: partly paid, day 18: fully on credit, day 9: half paid
        'paid_amount', case v_n when 30 then 40000 when 18 then 0 else round(v_total / 2) end,
        'payment_method', 'bank',
        'notes', 'Phone stock',
        'items', v_items));
      if v_n = 30 then v_purchase_a := (v_res ->> 'purchase_id')::uuid; end if;
      if v_n = 18 then v_purchase_c := (v_res ->> 'purchase_id')::uuid; end if;
      perform pg_temp.demo_backdate(v_biz, pg_temp.demo_ts(v_day, -60));
    end if;

    -- Accessories purchase on day 30, paid by bank -----------------------------
    if v_n = 30 then
      v_items := '[]'::jsonb;
      for r_p in select * from demo_products order by idx loop
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'item_type', 'accessory', 'product_id', r_p.product_id, 'quantity', r_p.qty_b,
          'unit_cost', r_p.cost, 'sale_price', r_p.price));
      end loop;
      select sum((x.value ->> 'unit_cost')::numeric * (x.value ->> 'quantity')::numeric)
        into v_total
      from jsonb_array_elements(v_items) x;
      perform public.create_purchase(jsonb_build_object(
        'supplier_id', v_sup_b, 'purchase_date', v_day::text, 'supplier_invoice_no', 'NAW-0932',
        'extra_cost', 0, 'paid_amount', v_total, 'payment_method', 'bank',
        'notes', 'Accessories stock', 'items', v_items));
      perform pg_temp.demo_backdate(v_biz, pg_temp.demo_ts(v_day, -50));
    end if;

    -- Supplier payments --------------------------------------------------------
    if v_n = 15 then
      perform public.record_supplier_payment(jsonb_build_object(
        'purchase_id', v_purchase_a, 'amount', 25000, 'payment_method', 'bank'));
      perform pg_temp.demo_backdate(v_biz, pg_temp.demo_ts(v_day, 30));
    end if;
    if v_n = 5 then
      perform public.record_supplier_payment(jsonb_build_object(
        'purchase_id', v_purchase_c, 'amount', 10000, 'payment_method', 'bank'));
      perform pg_temp.demo_backdate(v_biz, pg_temp.demo_ts(v_day, 30));
    end if;

    -- Expenses -----------------------------------------------------------------
    for r_e in
      select * from (values
        (30, 'Rent',             'Shop rent, Deira (monthly)',          6500, 'bank'),
        (25, 'Utilities',        'DEWA electricity and water bill',     835,  'bank'),
        (22, 'Shop supplies',    'Cleaning supplies and shopping bags', 120,  'cash'),
        (14, 'Transport',        'Courier deliveries to customers',     75,   'cash'),
        (8,  'Internet & phone', 'du business internet and landline',   399,  'bank'),
        (4,  'Refreshments',     'Tea and water for the shop',          85,   'cash'),
        (1,  'Salaries',         'Salary: sales staff (Bilal)',         3500, 'bank'),
        (1,  'Salaries',         'Salary: sales staff (Joseph)',        3000, 'bank')
      ) as e(day_no, category, description, amount, method)
      where e.day_no = v_n
    loop
      perform public.record_expense(jsonb_build_object(
        'category', r_e.category, 'description', r_e.description, 'amount', r_e.amount,
        'payment_method', r_e.method, 'expense_date', v_day::text));
      perform pg_temp.demo_backdate(v_biz, pg_temp.demo_ts(v_day, 10));
    end loop;

    -- Customers paying the rest of earlier credit sales --------------------------
    for r_u in select * from demo_credit dc where dc.pay_day = v_day loop
      perform public.record_customer_payment(jsonb_build_object(
        'sale_id', r_u.sale_id, 'amount', r_u.amount, 'payment_method', r_u.method));
      perform pg_temp.demo_backdate(v_biz, pg_temp.demo_ts(v_day, 45));
    end loop;

    -- Sales ----------------------------------------------------------------------
    -- 2 or 3 invoices a day; more are added (up to 4) while the day is below
    -- AED 2,000. One phone a day, sometimes two, each with 2-3 accessories;
    -- the other invoices sell 3-6 accessories. Phones and accessories are
    -- only added while the day stays below about AED 6,500.
    v_planned := case when random() < 0.6 then 3 else 2 end;
    v_cap := case when random() < 0.35 then 2 else 1 end;
    v_phones_today := 0;
    v_day_total := 0;
    v_slot := 0;
    loop
      v_slot := v_slot + 1;
      exit when v_slot > 4 or (v_slot > v_planned and v_day_total >= 2000);

      v_minute := (v_slot - 1) * 165 + floor(random() * 140)::integer;
      v_items := '[]'::jsonb;
      v_total := 0;
      v_picked := '{}';
      v_customer := null;
      v_unit := null;
      v_product := null;
      v_unstocked := v_slot = 1 and v_n in (26, 16, 7);

      if v_unstocked then
        -- "Item not in stock": bought from another shop on the spot
        select * into r_u from (values
          (26, 'iPhone 16 Pro Max 512GB Desert Titanium',    5350, 5799, pg_temp.demo_imei(900001), 7),
          (16, 'Samsung Galaxy Z Flip6 256GB Silver Shadow', 3150, 3449, pg_temp.demo_imei(900002), 4),
          (7,  'Apple Pencil Pro',                           430,  529,  'SFJQ7K2L9MXV',            13)
        ) as x(day_no, name, cost, price, serial, customer_idx)
        where x.day_no = v_n;
        v_items := jsonb_build_array(jsonb_build_object(
          'item_type', 'unstocked', 'description', r_u.name, 'imei', r_u.serial, 'quantity', 1,
          'unit_price', r_u.price, 'discount', 0, 'unit_cost', r_u.cost, 'warranty_days', 365));
        v_total := r_u.price;
        select dc.id into v_customer from demo_customers dc where dc.idx = r_u.customer_idx;
      elsif v_phones_today < v_cap
            and random() < case when v_slot <= 2 then 0.8 else 0.35 end then
        -- A phone (if one fits the day) with 2 or 3 accessories
        select pu.id, du.price, du.cost into v_unit, v_price, v_cost
        from public.phone_units pu join demo_units du on du.imei = pu.imei
        where pu.business_id = v_biz and pu.status = 'in_stock'
          and du.price <= greatest(6500 - v_day_total, 0)
        order by random() limit 1;
        if v_unit is not null then
          -- A small discount on some phones (at most 2% of the price)
          v_disc := case when random() < 0.25
                         then least((1 + floor(random() * 5)) * 10, floor(v_price * 0.02 / 10) * 10)
                         else 0 end;
          v_items := jsonb_build_array(jsonb_build_object(
            'item_type', 'phone', 'phone_unit_id', v_unit, 'unit_price', v_price,
            'discount', v_disc, 'warranty_days', 365));
          v_total := v_price - v_disc;
          v_phones_today := v_phones_today + 1;
          for v_i in 1..(2 + floor(random() * 2)::integer) loop
            v_product := null;
            -- Weighted random choice: popular items come up more often
            select dp.product_id, dp.price, dp.warranty into v_product, v_price, v_warranty
            from demo_products dp join public.product_stock ps on ps.product_id = dp.product_id
            where dp.addon and ps.qty >= 1 and not (dp.product_id = any (v_picked))
            order by -ln(1 - random()) / dp.weight limit 1;
            if v_product is not null then
              v_picked := v_picked || v_product;
              v_items := v_items || jsonb_build_array(jsonb_build_object(
                'item_type', 'accessory', 'product_id', v_product, 'quantity', 1,
                'unit_price', v_price, 'discount', 0, 'warranty_days', v_warranty));
              v_total := v_total + v_price;
            end if;
          end loop;
        end if;
      end if;

      if jsonb_array_length(v_items) = 0 then
        -- Accessories only: 3 to 6 different items (cheap ones sometimes twice)
        for v_i in 1..(3 + floor(random() * 4)::integer) loop
          v_product := null;
          select dp.product_id, dp.price, dp.warranty into v_product, v_price, v_warranty
          from demo_products dp join public.product_stock ps on ps.product_id = dp.product_id
          where ps.qty >= 2 and not (dp.product_id = any (v_picked))
          order by -ln(1 - random()) / dp.weight limit 1;
          if v_product is not null then
            v_qty := case when v_price < 60 and random() < 0.3 then 2 else 1 end;
            v_picked := v_picked || v_product;
            if v_day_total + v_total + v_price * v_qty <= 6500 then
              v_items := v_items || jsonb_build_array(jsonb_build_object(
                'item_type', 'accessory', 'product_id', v_product, 'quantity', v_qty,
                'unit_price', v_price, 'discount', 0, 'warranty_days', v_warranty));
              v_total := v_total + v_price * v_qty;
            end if;
          end if;
        end loop;
      end if;

      continue when jsonb_array_length(v_items) = 0;

      if v_customer is null and random() < 0.55 then
        select dc.id into v_customer from demo_customers dc order by random() limit 1;
      end if;
      v_method := case when random() < 0.6 then 'cash' else 'bank' end;
      v_paid := v_total;
      -- A few known customers pay part now and the rest later
      if v_customer is not null and not v_unstocked and v_total >= 800
         and v_credit_count < 4 and random() < 0.3 then
        v_credit_count := v_credit_count + 1;
        v_paid := floor(v_total * 0.4 / 10) * 10;
      end if;

      v_res := public.create_quick_sale(jsonb_build_object('sale', jsonb_build_object(
        'customer_id', v_customer, 'discount', 0, 'paid_amount', v_paid,
        'payment_method', v_method, 'items', v_items)));
      v_sale := (v_res ->> 'sale_id')::uuid;
      perform pg_temp.demo_backdate(v_biz, pg_temp.demo_ts(v_day, v_minute));
      v_day_total := v_day_total + v_total;

      if v_paid < v_total then
        -- The first two credit sales are paid 3 to 6 days later; the others stay open
        insert into demo_credit (sale_id, amount, pay_day, method) values
          (v_sale, v_total - v_paid,
           case when v_credit_count <= 2
                then least(v_day + 3 + floor(random() * 4)::integer, v_today - 1) end,
           'cash');
      end if;
      if v_unstocked and v_n = 7 then
        v_pencil_sale := v_sale;
      end if;
    end loop;

    -- Returns ------------------------------------------------------------------
    if v_n = 12 then
      -- A phone sold a few days ago comes back unused and goes back into stock
      v_line := null;
      select si.id, sa.id into v_line, v_sale
      from public.sales sa join public.sale_items si on si.sale_id = sa.id
      where sa.business_id = v_biz and sa.status = 'completed' and si.item_type = 'phone'
        and sa.paid_amount = sa.total and sa.returned_total = 0
        and sa.created_at < pg_temp.demo_ts(v_day, -120)
      order by sa.created_at desc limit 1;
      if v_line is not null then
        perform public.create_sales_return(jsonb_build_object(
          'sale_id', v_sale, 'return_date', v_day::text,
          'reason', 'Customer changed mind within 7 days',
          'notes', 'Box sealed, phone unused',
          'refund_account_id', v_cash,
          'items', jsonb_build_array(jsonb_build_object(
            'sale_item_id', v_line, 'quantity', 1, 'restock', true))));
        perform pg_temp.demo_backdate(v_biz, pg_temp.demo_ts(v_day, 270));
      end if;
    end if;
    if v_n = 6 and v_pencil_sale is not null then
      -- The "Item not in stock" Apple Pencil does not fit the customer's iPad
      select si.id into v_line from public.sale_items si
      where si.sale_id = v_pencil_sale and si.item_type = 'unstocked' limit 1;
      perform public.create_sales_return(jsonb_build_object(
        'sale_id', v_pencil_sale, 'return_date', v_day::text,
        'reason', 'Not compatible with the customer''s iPad',
        'refund_account_id', v_cash,
        'items', jsonb_build_array(jsonb_build_object(
          'sale_item_id', v_line, 'quantity', 1, 'restock', true))));
      perform pg_temp.demo_backdate(v_biz, pg_temp.demo_ts(v_day, 200));
    end if;
  end loop;

  raise notice 'Demo seed done for Al Noor Mobiles.';
end;
$$;

commit;

-- What was created ---------------------------------------------------------------
select 'business' as what, name || ' (' || currency_code || ', VAT ' || tax_rate || '%)' as detail
from public.businesses
union all
select 'sales (completed)', count(*)::text || ', total AED ' || coalesce(sum(total), 0)::text
       || ', VAT AED ' || coalesce(sum(vat_amount), 0)::text
from public.sales where status = 'completed'
union all
select 'sales per day', 'min AED ' || min(t)::text || ', max AED ' || max(t)::text || ', average AED '
       || round(avg(t))::text
from (select (created_at at time zone 'Asia/Dubai')::date as day, sum(total) as t
      from public.sales where status = 'completed' group by 1) x
union all
select 'profit before VAT (before returns)', 'AED ' || coalesce(sum(s.total - s.vat_amount
       - (select coalesce(sum(c.unit_cost * si.quantity), 0) from public.sale_items si
          join public.sale_item_costs c on c.item_id = si.id where si.sale_id = s.id)), 0)::text
from public.sales s where s.status = 'completed'
union all
-- Same formula as the dashboard: sales profit before VAT, minus the profit
-- reversed by returns (before VAT), minus expenses
select 'profit after returns / after expenses',
       'AED ' || round(x.sale_profit - x.return_profit)::text || ' / AED '
       || round(x.sale_profit - x.return_profit - x.expenses)::text
from (
  select
    coalesce((select sum(s.total - s.vat_amount
                     - (select coalesce(sum(c.unit_cost * si.quantity), 0) from public.sale_items si
                        join public.sale_item_costs c on c.item_id = si.id where si.sale_id = s.id))
              from public.sales s where s.status = 'completed'), 0) as sale_profit,
    coalesce((select sum(r.total - r.vat_amount
                     - (select coalesce(sum(case when ri.restock then rc.unit_cost * ri.quantity else 0 end), 0)
                        from public.sales_return_items ri
                        left join public.sales_return_item_costs rc on rc.item_id = ri.id
                        where ri.return_id = r.id))
              from public.sales_returns r), 0) as return_profit,
    coalesce((select sum(e.amount) from public.expenses e where e.voided_at is null), 0) as expenses
) x
union all
select 'not in stock lines', count(*)::text from public.sale_items where item_type = 'unstocked'
union all
select 'sales returns', count(*)::text || ', total AED ' || coalesce(sum(total), 0)::text from public.sales_returns
union all
select 'customers still owing', count(*)::text || ', AED ' || coalesce(sum(total - paid_amount), 0)::text
from public.sales where status = 'completed' and total > paid_amount
union all
select 'purchases', count(*)::text || ', still to pay AED ' || coalesce(sum(total - paid_amount), 0)::text
from public.purchases where status = 'completed'
union all
select 'phones in stock', count(*)::text from public.phone_units where status = 'in_stock'
union all
select 'expenses', count(*)::text || ', AED ' || coalesce(sum(amount), 0)::text from public.expenses
union all
select 'customers / suppliers / accessories',
       (select count(*) from public.customers)::text || ' / ' || (select count(*) from public.suppliers)::text
       || ' / ' || (select count(*) from public.products)::text;
