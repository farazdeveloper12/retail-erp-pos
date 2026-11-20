-- =============================================================================
-- PTA status and phone options that are created when they are missing
--
-- 1. PTA status (Pakistan): 'approved' (PTA Approved), 'non_pta' (Non-PTA),
--    'jv' (JV). Saved on phone units, purchase lines and sale lines. Empty
--    (null) means unknown; all existing rows stay null.
-- 2. ensure_phone_option: returns the storage/RAM option and the colour of a
--    phone model, and creates them when they are missing (no duplicates;
--    names compared without case). Used when a user picks "Other".
-- 3. New versions of create_purchase, create_quick_sale, create_sale and
--    customer_purchase_add_unit that also save the PTA status. Everything
--    else in them is unchanged.
--
-- One idempotent migration: it can be run more than once and only adds or
-- replaces objects. It never deletes rows and never changes existing data.
-- create_purchase and create_quick_sale are the versions read from
-- gwadar-test on 19 Nov 2026; create_sale is the version from
-- 20261119000000_unstocked_sale_lines.sql; customer_purchase_add_unit is the
-- version from 20261121000000_customer_trade_in.sql.
--
-- It runs as one transaction: if any statement fails, nothing is changed.
-- Run it in the Supabase SQL Editor. It contains no test data.
-- =============================================================================

begin;

-- 0. Safety check -------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.create_purchase(jsonb)') is null
     or to_regprocedure('public.create_quick_sale(jsonb)') is null
     or to_regprocedure('public.create_sale(jsonb)') is null
     or to_regprocedure('public.customer_purchase_add_unit(uuid, uuid, jsonb)') is null
     or to_regclass('public.customer_purchases') is null then
    raise exception 'Stopped: run the earlier migrations first (up to 20261121000000_customer_trade_in.sql).';
  end if;
end;
$$;


-- 1. PTA status columns ---------------------------------------------------------
alter table public.phone_units add column if not exists pta_status text;
alter table public.phone_units drop constraint if exists phone_units_pta_status_check;
alter table public.phone_units add constraint phone_units_pta_status_check
  check (pta_status is null or pta_status in ('approved', 'non_pta', 'jv'));

alter table public.purchase_items add column if not exists pta_status text;
alter table public.purchase_items drop constraint if exists purchase_items_pta_status_check;
alter table public.purchase_items add constraint purchase_items_pta_status_check
  check (pta_status is null or pta_status in ('approved', 'non_pta', 'jv'));

alter table public.sale_items add column if not exists pta_status text;
alter table public.sale_items drop constraint if exists sale_items_pta_status_check;
alter table public.sale_items add constraint sale_items_pta_status_check
  check (pta_status is null or pta_status in ('approved', 'non_pta', 'jv'));

create index if not exists phone_units_pta_idx on public.phone_units (business_id, status, pta_status);

-- Checks a PTA value from a payload: empty = null (unknown)
create or replace function public.pta_status_value(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or trim(p_value) = '' then
    return null;
  end if;
  if p_value not in ('approved', 'non_pta', 'jv') then
    raise exception 'The PTA status must be PTA Approved, Non-PTA or JV.';
  end if;
  return p_value;
end;
$$;


-- 2. Storage/RAM option and colour, created when missing --------------------------
-- payload: model_id, storage_gb, ram_gb (optional), color_name (optional)
-- returns: { variant_id, color_id (null without a colour) }
create or replace function public.ensure_phone_option(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model uuid;
  v_storage integer;
  v_ram integer;
  v_color text := nullif(regexp_replace(trim(coalesce(p_payload ->> 'color_name', '')), '\s+', ' ', 'g'), '');
  v_variant uuid;
  v_variant_active boolean;
  v_color_id uuid;
  v_color_active boolean;
begin
  if auth.uid() is null or public.my_business_id() is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not (public.has_permission('purchases.manage') or public.has_permission('sales.create')
          or public.has_permission('catalog.manage')) then
    raise exception 'You do not have permission to add phone options.';
  end if;
  begin
    v_model := (p_payload ->> 'model_id')::uuid;
    v_storage := (p_payload ->> 'storage_gb')::integer;
    v_ram := nullif(p_payload ->> 'ram_gb', '')::integer;
  exception when others then
    raise exception 'The phone model, storage or RAM is not valid.';
  end;
  if not exists (select 1 from public.product_models pm where pm.id = v_model and pm.is_active) then
    raise exception 'Choose an active phone model.';
  end if;
  if v_storage is null or v_storage < 1 or v_storage > 4096 then
    raise exception 'Storage must be from 1 GB to 4 TB.';
  end if;
  if v_ram is not null and (v_ram < 1 or v_ram > 64) then
    raise exception 'RAM must be from 1 to 64 GB.';
  end if;
  if v_color is not null and char_length(v_color) > 60 then
    raise exception 'The colour cannot be longer than 60 characters.';
  end if;

  insert into public.model_variants (model_id, storage_gb, ram_gb)
  values (v_model, v_storage, v_ram)
  on conflict do nothing;
  select mv.id, mv.is_active into v_variant, v_variant_active
  from public.model_variants mv
  where mv.model_id = v_model and mv.storage_gb = v_storage and coalesce(mv.ram_gb, 0) = coalesce(v_ram, 0);
  if not v_variant_active then
    raise exception 'This storage option is deactivated in the catalog. Ask a manager to activate it.';
  end if;

  if v_color is not null then
    insert into public.model_colors (model_id, name)
    values (v_model, v_color)
    on conflict do nothing;
    select mc.id, mc.is_active into v_color_id, v_color_active
    from public.model_colors mc
    where mc.model_id = v_model and lower(mc.name) = lower(v_color);
    if not v_color_active then
      raise exception 'The colour % is deactivated in the catalog. Ask a manager to activate it.', v_color;
    end if;
  end if;

  return jsonb_build_object('variant_id', v_variant, 'color_id', v_color_id);
end;
$$;

revoke all on function public.ensure_phone_option(jsonb) from public, anon;
grant execute on function public.ensure_phone_option(jsonb) to authenticated, service_role;


-- 3. create_purchase: phone lines may carry pta_status ------------------------------
create or replace function public.create_purchase(p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_biz uuid := public.my_business_id();
  v_uid uuid := auth.uid();
  v_items jsonb := p_payload -> 'items';
  v_supplier uuid;
  v_date date;
  v_extra numeric(14,2);
  v_paid numeric(14,2);
  v_method text;
  v_item jsonb;
  v_type text;
  v_qty integer;
  v_cost numeric(14,2);
  v_sale numeric(14,2);
  v_line numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2);
  v_purchase uuid;
  v_no integer;
  v_item_id uuid;
  v_share numeric(14,4);
  v_landed numeric(14,4);
  v_imei text;
  v_unit uuid;
  v_cond text;
  v_model_id uuid;
  v_variant_id uuid;
  v_color_id uuid;
  v_product_id uuid;
  v_brand_name text;
  v_model_name text;
  v_storage integer;
  v_ram integer;
  v_color_name text;
  v_desc text;
  v_old_qty numeric;
  v_old_avg numeric;
  v_pta text;
begin
  if v_uid is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('purchases.manage') then
    raise exception 'You do not have permission to create purchases.';
  end if;
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Add at least one item to the purchase.';
  end if;
  if jsonb_array_length(v_items) > 200 then
    raise exception 'A purchase can have at most 200 lines.';
  end if;

  v_supplier := (p_payload ->> 'supplier_id')::uuid;
  if not exists (select 1 from public.suppliers s where s.id = v_supplier and s.business_id = v_biz and s.is_active) then
    raise exception 'Please choose an active supplier.';
  end if;

  v_date := coalesce((p_payload ->> 'purchase_date')::date, current_date);
  v_extra := coalesce((p_payload ->> 'extra_cost')::numeric, 0);
  v_paid := coalesce((p_payload ->> 'paid_amount')::numeric, 0);
  v_method := nullif(p_payload ->> 'payment_method', '');
  if v_extra < 0 or v_paid < 0 then
    raise exception 'Amounts cannot be negative.';
  end if;
  if v_paid > 0 and v_method not in ('cash', 'bank') then
    raise exception 'Choose cash or bank for the payment.';
  end if;

  -- Pass 1: validate every line and calculate the subtotal
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_type := v_item ->> 'item_type';
    v_cost := (v_item ->> 'unit_cost')::numeric;
    if v_cost is null or v_cost < 0 then
      raise exception 'Every line needs a purchase price of zero or more.';
    end if;
    if v_type = 'phone' then
      if jsonb_typeof(v_item -> 'imeis') is distinct from 'array' or jsonb_array_length(v_item -> 'imeis') = 0 then
        raise exception 'Every phone line needs at least one IMEI.';
      end if;
      if jsonb_array_length(v_item -> 'imeis') > 100 then
        raise exception 'A phone line can have at most 100 IMEI numbers.';
      end if;
      v_qty := jsonb_array_length(v_item -> 'imeis');
      if coalesce(v_item ->> 'condition', '') not in ('new', 'used', 'open_box', 'refurbished') then
        raise exception 'Choose a condition for every phone line.';
      end if;
      perform public.pta_status_value(v_item ->> 'pta_status');
      if not exists (
        select 1 from public.model_variants mv
        join public.product_models pm on pm.id = mv.model_id
        where mv.id = (v_item ->> 'variant_id')::uuid
          and mv.model_id = (v_item ->> 'model_id')::uuid
          and mv.is_active and pm.is_active
      ) then
        raise exception 'A phone line has an invalid model or storage option.';
      end if;
      if nullif(v_item ->> 'color_id', '') is not null and not exists (
        select 1 from public.model_colors mc
        where mc.id = (v_item ->> 'color_id')::uuid
          and mc.model_id = (v_item ->> 'model_id')::uuid and mc.is_active
      ) then
        raise exception 'A phone line has an invalid colour.';
      end if;
    elsif v_type = 'accessory' then
      v_qty := (v_item ->> 'quantity')::integer;
      if v_qty is null or v_qty < 1 or v_qty > 10000 then
        raise exception 'Accessory quantity must be between 1 and 10000.';
      end if;
      if not exists (select 1 from public.products p
                     where p.id = (v_item ->> 'product_id')::uuid and p.business_id = v_biz and p.is_active) then
        raise exception 'A line has an invalid or inactive accessory.';
      end if;
    else
      raise exception 'Unknown line type.';
    end if;
    v_subtotal := v_subtotal + round(v_cost * v_qty, 2);
  end loop;

  v_total := v_subtotal + v_extra;
  if v_paid > v_total then
    raise exception 'The paid amount cannot be more than the purchase total.';
  end if;

  v_no := public.next_doc_no(v_biz, 'purchase');
  insert into public.purchases
    (business_id, purchase_no, supplier_id, purchase_date, supplier_invoice_no, subtotal, extra_cost, total,
     paid_amount, payment_method, notes, created_by)
  values
    (v_biz, v_no, v_supplier, v_date, nullif(trim(p_payload ->> 'supplier_invoice_no'), ''), v_subtotal, v_extra, v_total,
     v_paid, case when v_paid > 0 then v_method else null end, nullif(trim(p_payload ->> 'notes'), ''), v_uid)
  returning id into v_purchase;

  -- Pass 2: save lines, IMEI units and stock
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_type := v_item ->> 'item_type';
    v_cost := (v_item ->> 'unit_cost')::numeric;
    v_sale := nullif(v_item ->> 'sale_price', '')::numeric;
    if v_type = 'phone' then
      v_qty := jsonb_array_length(v_item -> 'imeis');
    else
      v_qty := (v_item ->> 'quantity')::integer;
    end if;
    v_line := round(v_cost * v_qty, 2);
    v_share := case when v_subtotal > 0 then v_extra * v_line / v_subtotal else 0 end;
    v_landed := round((v_line + v_share) / v_qty, 4);

    if v_type = 'phone' then
      v_model_id := (v_item ->> 'model_id')::uuid;
      v_variant_id := (v_item ->> 'variant_id')::uuid;
      v_color_id := nullif(v_item ->> 'color_id', '')::uuid;
      v_cond := v_item ->> 'condition';
      v_pta := public.pta_status_value(v_item ->> 'pta_status');
      select b.name, pm.name into v_brand_name, v_model_name
        from public.product_models pm join public.brands b on b.id = pm.brand_id where pm.id = v_model_id;
      select mv.storage_gb, mv.ram_gb into v_storage, v_ram from public.model_variants mv where mv.id = v_variant_id;
      select mc.name into v_color_name from public.model_colors mc where mc.id = v_color_id;
      v_desc := v_model_name || ' ' || v_storage || 'GB' || coalesce(' ' || v_color_name, '');

      insert into public.purchase_items
        (business_id, purchase_id, item_type, description, model_id, variant_id, color_id, condition, quantity, unit_cost,
         sale_price, line_total, pta_status)
      values (v_biz, v_purchase, 'phone', v_desc, v_model_id, v_variant_id, v_color_id, v_cond, v_qty, v_cost,
              v_sale, v_line, v_pta)
      returning id into v_item_id;

      for v_imei in select jsonb_array_elements_text(v_item -> 'imeis') loop
        if v_imei !~ '^[0-9]{15}$' then
          raise exception 'IMEI % is not valid. An IMEI has exactly 15 digits.', v_imei;
        end if;
        insert into public.phone_units
          (business_id, model_id, variant_id, color_id, brand_name, model_name, storage_gb, ram_gb, color_name,
           condition, imei, sale_price, purchase_id, created_by, pta_status)
        values
          (v_biz, v_model_id, v_variant_id, v_color_id, v_brand_name, v_model_name, v_storage, v_ram, v_color_name,
           v_cond, v_imei, v_sale, v_purchase, v_uid, v_pta)
        returning id into v_unit;
        insert into public.phone_unit_costs (unit_id, business_id, purchase_cost, landed_cost)
        values (v_unit, v_biz, v_cost, v_landed);
      end loop;
    else
      v_product_id := (v_item ->> 'product_id')::uuid;
      select p.name into v_desc from public.products p where p.id = v_product_id;

      insert into public.purchase_items
        (business_id, purchase_id, item_type, description, product_id, quantity, unit_cost, sale_price, line_total)
      values (v_biz, v_purchase, 'accessory', v_desc, v_product_id, v_qty, v_cost, v_sale, v_line);

      select ps.qty into v_old_qty from public.product_stock ps where ps.product_id = v_product_id for update;
      select pc.avg_cost into v_old_avg from public.product_costs pc where pc.product_id = v_product_id;
      v_old_qty := coalesce(v_old_qty, 0);
      v_old_avg := coalesce(v_old_avg, 0);

      insert into public.product_stock (product_id, business_id, qty)
      values (v_product_id, v_biz, v_qty)
      on conflict (product_id) do update set qty = public.product_stock.qty + excluded.qty, updated_at = now();

      insert into public.product_costs (product_id, business_id, avg_cost)
      values (v_product_id, v_biz, v_landed)
      on conflict (product_id) do update
        set avg_cost = round((v_old_qty * v_old_avg + v_qty * v_landed) / (v_old_qty + v_qty), 4);

      insert into public.stock_movements (business_id, product_id, qty_change, unit_cost, reason, ref_type, ref_id, created_by)
      values (v_biz, v_product_id, v_qty, v_landed, 'purchase', 'purchase', v_purchase, v_uid);

      if v_sale is not null then
        update public.products set sale_price = v_sale where id = v_product_id and business_id = v_biz;
      end if;
    end if;
  end loop;

  if v_paid > 0 then
    insert into public.cash_ledger
      (business_id, entry_date, account, direction, amount, category, party_type, party_id, ref_type, ref_id, created_by)
    values
      (v_biz, v_date, v_method, 'out', v_paid, 'supplier_payment', 'supplier', v_supplier, 'purchase', v_purchase, v_uid);
  end if;

  return jsonb_build_object('purchase_id', v_purchase, 'purchase_no', v_no, 'total', v_total, 'balance', v_total - v_paid);
exception
  when unique_violation then
    raise exception 'One of the IMEI numbers is already in stock.';
end;
$function$;


-- 4. create_quick_sale: a phone bought from a supplier keeps its pta_status -----------
create or replace function public.create_quick_sale(p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sale_payload jsonb := p_payload -> 'sale';
  v_items jsonb;
  v_item jsonb;
  v_new_items jsonb := '[]'::jsonb;
  v_purchase_items jsonb := '[]'::jsonb;
  v_purchase jsonb;
  v_purchase_id uuid;
  v_unit uuid;
  v_sale jsonb;
  v_paid numeric;
  v_method text;
begin
  if auth.uid() is null or public.my_business_id() is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if jsonb_typeof(v_sale_payload) is distinct from 'object' then
    raise exception 'The sale details are missing.';
  end if;
  v_items := v_sale_payload -> 'items';
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Add at least one item to the sale.';
  end if;

  -- Collect the items that are not in stock yet
  for v_item in select * from jsonb_array_elements(v_items) loop
    if coalesce((v_item ->> 'sourced')::boolean, false) then
      if v_item ->> 'item_type' = 'phone' then
        v_purchase_items := v_purchase_items || jsonb_build_array(jsonb_build_object(
          'item_type', 'phone',
          'model_id', v_item -> 'model_id',
          'variant_id', v_item -> 'variant_id',
          'color_id', v_item -> 'color_id',
          'condition', v_item -> 'condition',
          'pta_status', v_item -> 'pta_status',
          'unit_cost', v_item -> 'unit_cost',
          'sale_price', v_item -> 'unit_price',
          'imeis', jsonb_build_array(v_item -> 'imei')));
      elsif v_item ->> 'item_type' = 'accessory' then
        v_purchase_items := v_purchase_items || jsonb_build_array(jsonb_build_object(
          'item_type', 'accessory',
          'product_id', v_item -> 'product_id',
          'quantity', v_item -> 'quantity',
          'unit_cost', v_item -> 'unit_cost',
          'sale_price', v_item -> 'unit_price'));
      else
        raise exception 'Unknown line type.';
      end if;
    end if;
  end loop;

  -- Nothing to source: this is an ordinary sale
  if jsonb_array_length(v_purchase_items) = 0 then
    return public.create_sale(v_sale_payload);
  end if;

  if not public.has_permission('purchases.manage') then
    raise exception 'You do not have permission to add items that are not in stock.';
  end if;
  if nullif(p_payload ->> 'supplier_id', '') is null then
    raise exception 'Choose the supplier for the items that are not in stock.';
  end if;

  v_paid := coalesce(nullif(p_payload ->> 'supplier_paid_amount', '')::numeric, 0);
  v_method := nullif(p_payload ->> 'supplier_payment_method', '');

  -- Step 1: save the purchase (stock, IMEI units, supplier balance)
  v_purchase := public.create_purchase(jsonb_build_object(
    'supplier_id', p_payload -> 'supplier_id',
    'paid_amount', v_paid,
    'payment_method', v_method,
    'notes', 'Created automatically from a sale',
    'items', v_purchase_items));
  v_purchase_id := (v_purchase ->> 'purchase_id')::uuid;

  -- Step 2: point the sale lines at the newly created stock
  for v_item in select * from jsonb_array_elements(v_items) loop
    if coalesce((v_item ->> 'sourced')::boolean, false) and v_item ->> 'item_type' = 'phone' then
      select u.id into v_unit from public.phone_units u
        where u.purchase_id = v_purchase_id and u.imei = v_item ->> 'imei';
      v_item := jsonb_build_object(
        'item_type', 'phone',
        'phone_unit_id', v_unit,
        'unit_price', v_item -> 'unit_price',
        'discount', coalesce(v_item -> 'discount', '0'::jsonb),
        'warranty_days', coalesce(v_item -> 'warranty_days', '0'::jsonb));
    elsif v_item ->> 'item_type' = 'accessory' then
      v_item := jsonb_build_object(
        'item_type', 'accessory',
        'product_id', v_item -> 'product_id',
        'quantity', v_item -> 'quantity',
        'unit_price', v_item -> 'unit_price',
        'discount', coalesce(v_item -> 'discount', '0'::jsonb),
        'warranty_days', coalesce(v_item -> 'warranty_days', '0'::jsonb));
    end if;
    v_new_items := v_new_items || jsonb_build_array(v_item);
  end loop;

  -- Step 3: save the sale
  v_sale := public.create_sale(jsonb_set(v_sale_payload, '{items}', v_new_items));

  return v_sale || jsonb_build_object('purchase_no', (v_purchase ->> 'purchase_no')::integer,
                                      'supplier_balance', (v_purchase ->> 'balance')::numeric);
end;
$function$;


-- 5. create_sale: sale lines keep the PTA status ------------------------------------
-- Phone lines copy it from the phone unit; "Item not in stock" lines take it
-- from the payload (pta_status).
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
  v_pta text;
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
      perform public.pta_status_value(v_item ->> 'pta_status');
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
         unit_price, discount, line_total, warranty_days, pta_status)
      values (v_biz, v_sale, 'phone', v_desc, v_unit.condition, v_unit.id, v_unit.imei, 1,
              v_price, v_disc, v_line, v_warranty, v_unit.pta_status)
      returning id into v_item_id;
    elsif v_type = 'unstocked' then
      -- No stock change, no purchase, no supplier: only the line and its cost
      v_qty := (v_item ->> 'quantity')::integer;
      v_line := round(v_price * v_qty, 2) - v_disc;
      v_desc := trim(regexp_replace(v_item ->> 'description', '\s+', ' ', 'g'));
      v_serial := nullif(trim(coalesce(v_item ->> 'imei', '')), '');
      v_cost := (v_item ->> 'unit_cost')::numeric;
      v_pta := public.pta_status_value(v_item ->> 'pta_status');

      insert into public.sale_items
        (business_id, sale_id, item_type, description, imei, quantity,
         unit_price, discount, line_total, warranty_days, pta_status)
      values (v_biz, v_sale, 'unstocked', v_desc, v_serial, v_qty,
              v_price, v_disc, v_line, v_warranty, v_pta)
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


-- 6. Phones bought from customers keep their PTA status ------------------------------
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
  perform public.pta_status_value(p_phone ->> 'pta_status');
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
     condition, imei, sale_price, purchase_id, created_by, pta_status)
  values
    (p_biz, v_model, v_variant, v_color, v_brand_name, v_model_name, v_storage, v_ram, v_color_name,
     'used', v_imei, v_sale, null, p_uid, public.pta_status_value(p_phone ->> 'pta_status'))
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

commit;
