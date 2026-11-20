-- =============================================================================
-- "Item not in stock" lines: details and an optional supplier (Part 3)
--
-- 1. sale_items gets optional details for these lines: storage_gb, ram_gb,
--    color_name, unstocked_note (short description such as "box pack"),
--    supplier_id and purchase_id. Existing rows stay empty (null).
-- 2. create_sale: an "Item not in stock" line may name a supplier with
--    supplier_paid and supplier_method. The cost then becomes a purchase from
--    that supplier WITHOUT stock: the paid part leaves Cash or Bank (same
--    balance rule as supplier payments), the rest is owed to the supplier and
--    is paid later with the normal supplier payment. There is still no stock
--    movement, no phone unit and no stock value; profit stays
--    sale price before VAT - cost. A customer return of the line reverses the
--    profit (sales_return_lines, unchanged) and does not change the supplier
--    balance.
--
-- One idempotent migration: it can be run more than once and only adds or
-- replaces objects. It never deletes rows and never changes existing data.
-- create_sale is the version from 20261122000000_phone_catalog_pta.sql with
-- only the parts above added.
--
-- It runs as one transaction: if any statement fails, nothing is changed.
-- Run it in the Supabase SQL Editor. It contains no test data.
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.pta_status_value(text)') is null
     or to_regprocedure('public.default_finance_account(uuid, text)') is null
     or to_regprocedure('public.finance_balance(uuid)') is null then
    raise exception 'Stopped: run the earlier migrations first (up to 20261122000000_phone_catalog_pta.sql).';
  end if;
end;
$$;

alter table public.sale_items
  add column if not exists storage_gb integer,
  add column if not exists ram_gb integer,
  add column if not exists color_name text,
  add column if not exists unstocked_note text,
  add column if not exists supplier_id uuid references public.suppliers (id),
  add column if not exists purchase_id uuid references public.purchases (id);

alter table public.sale_items drop constraint if exists sale_items_unstocked_details_check;
alter table public.sale_items add constraint sale_items_unstocked_details_check
  check ((storage_gb is null or storage_gb between 1 and 4096)
         and (ram_gb is null or ram_gb between 1 and 64)
         and (color_name is null or char_length(color_name) <= 60)
         and (unstocked_note is null or char_length(unstocked_note) <= 200)
         and (item_type = 'unstocked' or (supplier_id is null and purchase_id is null)));

create index if not exists sale_items_purchase_idx on public.sale_items (purchase_id) where purchase_id is not null;

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
  v_sup_id uuid;
  v_sup_paid numeric(14,2);
  v_sup_method text;
  v_line_cost numeric(14,2);
  v_purchase uuid;
  v_pno integer;
  v_account public.finance_accounts%rowtype;
  v_balance numeric;
  v_storage integer;
  v_ram integer;
  v_color text;
  v_note text;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
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
      -- Optional details: storage, RAM, colour and a short description
      begin
        v_storage := nullif(v_item ->> 'storage_gb', '')::integer;
        v_ram := nullif(v_item ->> 'ram_gb', '')::integer;
      exception when others then
        raise exception 'The storage or RAM of % is not valid.', v_desc;
      end;
      if v_storage is not null and (v_storage < 1 or v_storage > 4096) then
        raise exception 'The storage of % must be from 1 GB to 4 TB.', v_desc;
      end if;
      if v_ram is not null and (v_ram < 1 or v_ram > 64) then
        raise exception 'The RAM of % must be from 1 to 64 GB.', v_desc;
      end if;
      if char_length(coalesce(v_item ->> 'color_name', '')) > 60 then
        raise exception 'The colour of % cannot be longer than 60 characters.', v_desc;
      end if;
      if char_length(coalesce(v_item ->> 'note', '')) > 200 then
        raise exception 'The description of % cannot be longer than 200 characters.', v_desc;
      end if;
      -- Optional supplier: the cost becomes a purchase from that supplier
      if nullif(v_item ->> 'supplier_id', '') is not null then
        if not public.has_permission('purchases.manage') then
          raise exception 'You do not have permission to record what is owed to a supplier.';
        end if;
        begin
          v_sup_id := (v_item ->> 'supplier_id')::uuid;
          v_sup_paid := coalesce(nullif(v_item ->> 'supplier_paid', '')::numeric, 0);
        exception when others then
          raise exception 'The supplier details of % are not valid.', v_desc;
        end;
        if not exists (select 1 from public.suppliers s
                       where s.id = v_sup_id and s.business_id = v_biz and s.is_active) then
          raise exception 'Choose an active supplier for %.', v_desc;
        end if;
        if v_sup_paid < 0 or v_sup_paid > round(v_cost * v_qty, 2) then
          raise exception 'Paid to the supplier for % must be from 0 to the cost.', v_desc;
        end if;
        if v_sup_paid > 0 and coalesce(v_item ->> 'supplier_method', '') not in ('cash', 'bank') then
          raise exception 'Choose Cash or Bank for the supplier payment of %.', v_desc;
        end if;
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
      v_storage := nullif(v_item ->> 'storage_gb', '')::integer;
      v_ram := nullif(v_item ->> 'ram_gb', '')::integer;
      v_color := nullif(regexp_replace(trim(coalesce(v_item ->> 'color_name', '')), '\s+', ' ', 'g'), '');
      v_note := nullif(trim(coalesce(v_item ->> 'note', '')), '');
      v_sup_id := nullif(v_item ->> 'supplier_id', '')::uuid;

      insert into public.sale_items
        (business_id, sale_id, item_type, description, imei, quantity,
         unit_price, discount, line_total, warranty_days, pta_status,
         storage_gb, ram_gb, color_name, unstocked_note, supplier_id)
      values (v_biz, v_sale, 'unstocked', v_desc, v_serial, v_qty,
              v_price, v_disc, v_line, v_warranty, v_pta,
              v_storage, v_ram, v_color, v_note, v_sup_id)
      returning id into v_item_id;

      -- Bought from a supplier on the spot: a purchase without stock, so
      -- what is not paid now shows as owed to the supplier (paid later with
      -- the normal supplier payment). Never a stock movement.
      if v_sup_id is not null then
        v_line_cost := round(v_cost * v_qty, 2);
        v_sup_paid := coalesce(nullif(v_item ->> 'supplier_paid', '')::numeric, 0);
        v_sup_method := nullif(v_item ->> 'supplier_method', '');
        v_pno := public.next_doc_no(v_biz, 'purchase');
        insert into public.purchases
          (business_id, purchase_no, supplier_id, purchase_date, subtotal, extra_cost, total,
           paid_amount, payment_method, notes, created_by)
        values
          (v_biz, v_pno, v_sup_id, v_today, v_line_cost, 0, v_line_cost,
           v_sup_paid, case when v_sup_paid > 0 then v_sup_method end,
           left('Item not in stock sold on invoice INV-' || lpad(v_no::text, 6, '0') || ': ' || v_qty || ' x ' || v_desc, 500),
           v_uid)
        returning id into v_purchase;
        update public.sale_items set purchase_id = v_purchase where id = v_item_id;

        if v_sup_paid > 0 then
          -- Same rule as supplier payments: the default account must hold enough
          select * into v_account from public.finance_accounts a
            where a.id = public.default_finance_account(v_biz, v_sup_method)
            for update;
          v_balance := public.finance_balance(v_account.id);
          if v_balance < v_sup_paid then
            raise exception 'Not enough money in % to pay the supplier. The balance is %, the payment is %.',
              v_account.name, public.finance_format(v_balance), public.finance_format(v_sup_paid);
          end if;
          insert into public.cash_ledger
            (business_id, entry_date, account, account_id, direction, amount, category,
             party_type, party_id, ref_type, ref_id, created_by)
          values
            (v_biz, v_today, v_account.kind, v_account.id, 'out', v_sup_paid, 'supplier_payment',
             'supplier', v_sup_id, 'purchase', v_purchase, v_uid);
        end if;
      end if;
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

commit;
