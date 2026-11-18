-- =============================================================================
-- Profit before VAT, and sale profit for the Sales screens
--
-- 1. get_dashboard (dashboard, Reports and the AI Assistant): profit is now
--    calculated on the amount before VAT. Example: sold for 120 incl. 5% VAT
--    (VAT 5.71), cost 100: profit 14.29, not 20. Returns reverse profit the
--    same way: the VAT a return reverses is taken off its profit.
--    With VAT off every vat_amount is 0, so nothing changes.
-- 2. get_sale_profits: profit per sale for the Sales list.
-- 3. get_sale_line_costs: cost per line for the sale detail page.
--    Both are only for users with inventory.view_cost.
--
-- One idempotent migration: it can be run more than once and only replaces
-- or adds functions. It changes no table and no row.
-- get_dashboard is the version read from gwadar-test on 19 Nov 2026
-- (fingerprint 809d7e52cddbeac46a0ccbe2dc7db8e2) with only the VAT parts added.
--
-- It runs as one transaction: if any statement fails, nothing is changed.
-- Run it in the Supabase SQL Editor. It contains no test data.
-- =============================================================================

begin;

-- 0. Safety check: needs the VAT migration (20261118100000) first -------------
do $$
begin
  if to_regprocedure('public.get_dashboard(date, date)') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'sales' and column_name = 'vat_amount')
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'sales_returns' and column_name = 'vat_amount') then
    raise exception 'Stopped: run the VAT migration 20261118100000_business_region_vat_plan.sql first.';
  end if;
end;
$$;


-- 1. Dashboard and reports: profit before VAT ---------------------------------
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
    select s.id, s.total, s.discount, s.vat_amount, s.paid_amount - s.return_credit as paid_amount,
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


-- 2. Profit per sale (Sales list and sale detail) ------------------------------
-- profit         = total - VAT - cost of all lines (the amount before VAT minus cost)
-- returns_profit = profit reversed by the returns of the sale, before VAT
-- net_profit     = profit - returns_profit
-- cost_missing   = a line has no saved cost, or a stock line has cost 0
-- Cancelled sales have no profit (0).
create or replace function public.get_sale_profits(p_sale_ids uuid[])
returns table (
  sale_id uuid, cost_total numeric, cost_missing boolean,
  profit numeric, returns_profit numeric, net_profit numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_biz uuid := public.my_business_id();
begin
  if auth.uid() is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('inventory.view_cost') then
    raise exception 'You do not have permission to see cost and profit.';
  end if;
  if p_sale_ids is null or cardinality(p_sale_ids) = 0 then
    return;
  end if;
  if cardinality(p_sale_ids) > 200 then
    raise exception 'Ask for at most 200 sales at once.';
  end if;

  return query
  with sale_cost as (
    select s.id, s.status, s.total, s.vat_amount,
           coalesce(sum(coalesce(c.unit_cost, 0) * si.quantity), 0) as cost_total,
           coalesce(bool_or(c.item_id is null or (c.unit_cost = 0 and si.item_type <> 'unstocked')), false)
             as cost_missing
    from public.sales s
    left join public.sale_items si on si.sale_id = s.id
    left join public.sale_item_costs c on c.item_id = si.id
    where s.business_id = v_biz and s.id = any (p_sale_ids)
    group by s.id, s.status, s.total, s.vat_amount
  ),
  return_profit as (
    select x.sale_id, sum(x.item_profit - x.vat_amount) as profit
    from (
      select r.id, r.sale_id, r.vat_amount,
             sum(ri.line_total - case when ri.restock then coalesce(rc.unit_cost, 0) * ri.quantity else 0 end)
               as item_profit
      from public.sales_returns r
      join public.sales_return_items ri on ri.return_id = r.id
      left join public.sales_return_item_costs rc on rc.item_id = ri.id
      where r.business_id = v_biz and r.sale_id = any (p_sale_ids)
      group by r.id, r.sale_id, r.vat_amount
    ) x
    group by x.sale_id
  )
  select sc.id,
         sc.cost_total,
         sc.cost_missing,
         case when sc.status = 'completed' then sc.total - sc.vat_amount - sc.cost_total else 0 end,
         case when sc.status = 'completed' then coalesce(rp.profit, 0) else 0 end,
         case when sc.status = 'completed'
              then sc.total - sc.vat_amount - sc.cost_total - coalesce(rp.profit, 0) else 0 end
  from sale_cost sc
  left join return_profit rp on rp.sale_id = sc.id;
end;
$$;

revoke all on function public.get_sale_profits(uuid[]) from public, anon;
grant execute on function public.get_sale_profits(uuid[]) to authenticated, service_role;


-- 3. Cost per line of one sale (sale detail page) -------------------------------
create or replace function public.get_sale_line_costs(p_sale_id uuid)
returns table (sale_item_id uuid, unit_cost numeric, cost_missing boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_biz uuid := public.my_business_id();
begin
  if auth.uid() is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not public.has_permission('inventory.view_cost') then
    raise exception 'You do not have permission to see cost and profit.';
  end if;

  return query
  select si.id,
         coalesce(c.unit_cost, 0),
         (c.item_id is null or (c.unit_cost = 0 and si.item_type <> 'unstocked'))
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  left join public.sale_item_costs c on c.item_id = si.id
  where s.business_id = v_biz and si.sale_id = p_sale_id;
end;
$$;

revoke all on function public.get_sale_line_costs(uuid) from public, anon;
grant execute on function public.get_sale_line_costs(uuid) to authenticated, service_role;

commit;
