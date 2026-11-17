-- Go-live checks: READ-ONLY. Changes nothing.
--
-- Run this on the REAL project twice: once BEFORE the migration
-- 20261115000000_settings_finance_returns_ai.sql and once AFTER it. Save both
-- results. Every line must be exactly the same in both results; the migration
-- adds new tables and columns but never changes existing rows, amounts or
-- dates (the new account_id column of cash_ledger is not part of these checks).
--
-- It only reads tables and columns that exist before the migration, so it works
-- on both sides. One table with two columns: check_name, detail.

select check_name, detail
from (
  -- Row counts
  select '01 rows: businesses' as check_name, count(*)::text as detail from public.businesses
  union all select '02 rows: profiles', count(*)::text from public.profiles
  union all select '03 rows: customers', count(*)::text from public.customers
  union all select '04 rows: suppliers', count(*)::text from public.suppliers
  union all select '05 rows: products', count(*)::text from public.products
  union all select '06 rows: product_categories', count(*)::text from public.product_categories
  union all select '07 rows: phone_units', count(*)::text from public.phone_units
  union all select '08 rows: purchases', count(*)::text from public.purchases
  union all select '09 rows: purchase_items', count(*)::text from public.purchase_items
  union all select '10 rows: purchase_payments', count(*)::text from public.purchase_payments
  union all select '11 rows: sales', count(*)::text from public.sales
  union all select '12 rows: sale_items', count(*)::text from public.sale_items
  union all select '13 rows: sale_payments', count(*)::text from public.sale_payments
  union all select '14 rows: expenses', count(*)::text from public.expenses
  union all select '15 rows: cash_ledger', count(*)::text from public.cash_ledger
  union all select '16 rows: stock_movements', count(*)::text from public.stock_movements

  -- Money in sales and purchases
  union all select '20 sales completed: count / total / paid',
    count(*)::text || ' / ' || coalesce(sum(total), 0)::text || ' / ' || coalesce(sum(paid_amount), 0)::text
    from public.sales where status = 'completed'
  union all select '21 sales cancelled: count / total',
    count(*)::text || ' / ' || coalesce(sum(total), 0)::text
    from public.sales where status <> 'completed'
  union all select '22 sale payments: sum', coalesce(sum(amount), 0)::text from public.sale_payments
  union all select '23 purchases completed: count / total / paid',
    count(*)::text || ' / ' || coalesce(sum(total), 0)::text || ' / ' || coalesce(sum(paid_amount), 0)::text
    from public.purchases where status = 'completed'
  union all select '24 purchases cancelled: count / total',
    count(*)::text || ' / ' || coalesce(sum(total), 0)::text
    from public.purchases where status <> 'completed'
  union all select '25 purchase payments: sum', coalesce(sum(amount), 0)::text from public.purchase_payments
  union all select '26 expenses active: count / sum',
    count(*)::text || ' / ' || coalesce(sum(amount), 0)::text
    from public.expenses where voided_at is null

  -- Cash ledger per account text (cash / bank)
  union all select '30 ledger ' || account || ': in / out / balance',
    coalesce(sum(amount) filter (where direction = 'in'), 0)::text || ' / '
      || coalesce(sum(amount) filter (where direction = 'out'), 0)::text || ' / '
      || coalesce(sum(case direction when 'in' then amount else -amount end), 0)::text
    from public.cash_ledger group by account
  union all select '31 ledger: earliest / latest entry date',
    coalesce(min(entry_date)::text, '-') || ' / ' || coalesce(max(entry_date)::text, '-')
    from public.cash_ledger

  -- Customer and supplier balances
  union all select '40 customer balances: total owed / customers owing',
    coalesce(sum(balance), 0)::text || ' / ' || count(*) filter (where balance > 0)::text
    from public.customer_balances
  union all select '41 supplier balances: total owed / suppliers owed',
    coalesce(sum(balance), 0)::text || ' / ' || count(*) filter (where balance > 0)::text
    from public.supplier_balances

  -- Stock
  union all select '50 phones: ' || status, count(*)::text from public.phone_units group by status
  union all select '51 accessory stock: products / total quantity',
    count(*)::text || ' / ' || coalesce(sum(qty), 0)::text from public.product_stock
  union all select '52 stock movements: sum of changes', coalesce(sum(qty_change), 0)::text from public.stock_movements
  union all select '53 phone cost at landed cost (in stock)',
    coalesce(sum(c.landed_cost), 0)::text
    from public.phone_units u join public.phone_unit_costs c on c.unit_id = u.id
    where u.status = 'in_stock'
  union all select '54 accessory stock at average cost',
    coalesce(sum(ps.qty * pc.avg_cost), 0)::text
    from public.product_stock ps join public.product_costs pc on pc.product_id = ps.product_id
) checks
order by check_name;
