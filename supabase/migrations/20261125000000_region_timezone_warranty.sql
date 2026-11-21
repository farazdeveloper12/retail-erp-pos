-- =============================================================================
-- Region, time zone and default warranty per business (Part 5)
--
-- 1. businesses.region: 'PK' (Pakistan) or 'AE' (UAE). It decides what the
--    app shows: Pakistan = PKR, PTA status, CNIC, no VAT/TRN/Arabic;
--    UAE = AED, VAT/TRN, Arabic invoice, Emirates ID, no PTA.
--    Existing businesses: AED -> UAE, everything else -> Pakistan.
-- 2. businesses.time_zone: Asia/Karachi or Asia/Dubai (follows the region).
--    get_dashboard (dashboard and reports) now counts days in it.
-- 3. businesses.default_warranty_phone_days / default_warranty_accessory_days:
--    pre-filled on new sale lines. Pakistan businesses without a value get
--    7 days for both; UAE businesses stay empty.
--
-- One idempotent migration: it only adds columns and replaces get_dashboard
-- (the version from 20261121000000_customer_trade_in.sql with only the time
-- zone changed). It never removes rows.
-- It runs as one transaction: if any statement fails, nothing is changed.
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.get_dashboard(date, date)') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'sales' and column_name = 'trade_in_credit') then
    raise exception 'Stopped: run the earlier migrations first (up to 20261124000000_edit_delete_entries.sql).';
  end if;
end;
$$;

-- New columns: added with a marker so the one-time defaults below run once
do $$
declare
  v_new boolean := not exists (select 1 from information_schema.columns
                               where table_schema = 'public' and table_name = 'businesses' and column_name = 'region');
begin
  alter table public.businesses
    add column if not exists region text not null default 'PK',
    add column if not exists time_zone text not null default 'Asia/Karachi',
    add column if not exists default_warranty_phone_days integer,
    add column if not exists default_warranty_accessory_days integer;

  if v_new then
    update public.businesses
       set region = case when currency_code = 'AED' then 'AE' else 'PK' end,
           time_zone = case when currency_code = 'AED' then 'Asia/Dubai' else 'Asia/Karachi' end;
    update public.businesses
       set default_warranty_phone_days = 7, default_warranty_accessory_days = 7
     where region = 'PK' and default_warranty_phone_days is null and default_warranty_accessory_days is null;
  end if;
end;
$$;

-- Pakistan has no VAT and no Arabic invoices (saved invoices keep their VAT)
update public.businesses
   set vat_enabled = false, invoice_language = 'en'
 where region = 'PK' and (vat_enabled or invoice_language <> 'en');

alter table public.businesses drop constraint if exists businesses_region_check;
alter table public.businesses add constraint businesses_region_check
  check ((region = 'PK' and time_zone = 'Asia/Karachi') or (region = 'AE' and time_zone = 'Asia/Dubai'));

alter table public.businesses drop constraint if exists businesses_default_warranty_check;
alter table public.businesses add constraint businesses_default_warranty_check
  check ((default_warranty_phone_days is null or default_warranty_phone_days between 0 and 3650)
         and (default_warranty_accessory_days is null or default_warranty_accessory_days between 0 and 3650));

-- Dashboard and reports: days in the business time zone -----------------------
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
  -- Days are counted in the business time zone (Pakistan or UAE)
  v_tz text := coalesce((select b.time_zone from public.businesses b where b.id = public.my_business_id()),
                        'Asia/Karachi');
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
           (s.created_at at time zone v_tz)::date as day
    from public.sales s
    where s.business_id = v_biz and s.status = 'completed'
      and (s.created_at at time zone v_tz)::date between p_from and p_to
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
