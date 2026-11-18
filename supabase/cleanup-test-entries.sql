-- =============================================================================
-- Remove test transactions before real use
--
-- Deletes every transaction of the shop (sales, purchases, payments, expenses,
-- stock, phones, customers, suppliers, cash and bank entries, returns,
-- warranty claims) and resets the document numbers, so the next invoice is
-- INV-000001 again.
--
-- KEEPS: businesses (and their settings), profiles, permissions,
-- role_permissions, user_permission_overrides, brands, product_models,
-- model_variants, model_colors, product_categories, products (catalog items,
-- with no stock), expense_categories, and the default Cash and Bank accounts
-- with a zero balance. Other cash, bank or wallet accounts are removed; add
-- them again afterwards with their real opening balance.
--
-- SAFETY: it stops (and changes nothing) when the database holds more than
-- 2 sales, 2 purchases, 1 business, 5 customers, 5 suppliers, 10 expenses or
-- 100 cash and bank entries, so it can never wipe a shop in real use.
-- Everything runs in one transaction: if any step fails, nothing is changed.
--
-- Run it once in the Supabase SQL Editor. The last statement shows a table:
-- deleted tables must show 0, kept tables must show the same number before
-- and after.
-- =============================================================================

-- Row counts before, for the report at the end (this session only)
drop table if exists cleanup_report_before;
create temp table cleanup_report_before as
select 'businesses' as table_name, count(*) as rows_before from public.businesses
union all select 'profiles', count(*) from public.profiles
union all select 'permissions', count(*) from public.permissions
union all select 'role_permissions', count(*) from public.role_permissions
union all select 'user_permission_overrides', count(*) from public.user_permission_overrides
union all select 'brands', count(*) from public.brands
union all select 'product_models', count(*) from public.product_models
union all select 'model_variants', count(*) from public.model_variants
union all select 'model_colors', count(*) from public.model_colors
union all select 'product_categories', count(*) from public.product_categories
union all select 'products', count(*) from public.products
union all select 'expense_categories', count(*) from public.expense_categories
union all select 'finance_accounts (default)', count(*) from public.finance_accounts where is_default;

begin;

-- 1. Safety guard -------------------------------------------------------------
do $$
declare
  v_sales integer := (select count(*) from public.sales);
  v_purchases integer := (select count(*) from public.purchases);
  v_businesses integer := (select count(*) from public.businesses);
  v_customers integer := (select count(*) from public.customers);
  v_suppliers integer := (select count(*) from public.suppliers);
  v_expenses integer := (select count(*) from public.expenses);
  v_ledger integer := (select count(*) from public.cash_ledger);
begin
  if v_sales > 2 or v_purchases > 2 or v_businesses > 1
     or v_customers > 5 or v_suppliers > 5 or v_expenses > 10 or v_ledger > 100 then
    raise exception 'Stopped, nothing was changed: this looks like a shop in real use (sales %, purchases %, businesses %, customers %, suppliers %, expenses %, ledger entries %).',
      v_sales, v_purchases, v_businesses, v_customers, v_suppliers, v_expenses, v_ledger;
  end if;
  if v_businesses = 0 then
    raise exception 'Stopped, nothing was changed: there is no business in this database.';
  end if;
end;
$$;

-- 2. AI usage log, warranty claims and returns ------------------------------------
delete from public.ai_usage;
delete from public.warranty_claim_events;
delete from public.warranty_claims;
delete from public.sales_return_item_costs;
delete from public.sales_return_items;
delete from public.sales_returns;
delete from public.purchase_return_items;
delete from public.purchase_returns;

-- 3. Cash and bank ---------------------------------------------------------------------
delete from public.finance_counts;
update public.cash_ledger set reversal_of = null where reversal_of is not null;
delete from public.cash_ledger;

-- 4. Sales -----------------------------------------------------------------------------
delete from public.sale_payments;
delete from public.sale_item_costs;
delete from public.sale_items;

-- 5. Stock and phones ------------------------------------------------------------------
delete from public.stock_movements;
delete from public.phone_unit_costs;
delete from public.phone_units;
delete from public.product_stock;
delete from public.product_costs;

-- 6. Invoices, purchases, expenses ------------------------------------------------------
delete from public.sales;
delete from public.purchase_payments;
delete from public.purchase_items;
delete from public.purchases;
delete from public.expenses;

-- 7. Customers and suppliers ------------------------------------------------------------
delete from public.customers;
delete from public.suppliers;

-- 8. Document numbers: the next invoice, purchase, return and claim start at 1 ------------
delete from public.document_counters;

-- 9. Accounts: keep only the default Cash and Bank, with no opening balance ---------------
delete from public.finance_accounts where not is_default;
update public.finance_accounts
   set opening_balance = 0, opening_date = (now() at time zone 'Asia/Karachi')::date
 where is_default;

-- 10. Final check inside the transaction ----------------------------------------------------
do $$
begin
  if exists (select 1 from public.sales) or exists (select 1 from public.purchases)
     or exists (select 1 from public.cash_ledger) or exists (select 1 from public.phone_units)
     or exists (select 1 from public.customers) or exists (select 1 from public.suppliers) then
    raise exception 'Stopped, nothing was changed: some rows could not be removed.';
  end if;
  if (select count(*) from public.finance_accounts where is_default) <> 2 * (select count(*) from public.businesses) then
    raise exception 'Stopped, nothing was changed: the default Cash and Bank accounts are missing.';
  end if;
end;
$$;

commit;

-- 11. Report: deleted tables must be 0; kept tables must be unchanged ----------------------
select kind, table_name, rows_before, rows_after, ok
from (
  select 'deleted' as kind, d.table_name, null::bigint as rows_before, d.rows_after, d.rows_after = 0 as ok
  from (
    select 'sales' as table_name, (select count(*) from public.sales) as rows_after
    union all select 'sale_items', (select count(*) from public.sale_items)
    union all select 'sale_item_costs', (select count(*) from public.sale_item_costs)
    union all select 'sale_payments', (select count(*) from public.sale_payments)
    union all select 'purchases', (select count(*) from public.purchases)
    union all select 'purchase_items', (select count(*) from public.purchase_items)
    union all select 'purchase_payments', (select count(*) from public.purchase_payments)
    union all select 'phone_units', (select count(*) from public.phone_units)
    union all select 'phone_unit_costs', (select count(*) from public.phone_unit_costs)
    union all select 'product_stock', (select count(*) from public.product_stock)
    union all select 'product_costs', (select count(*) from public.product_costs)
    union all select 'stock_movements', (select count(*) from public.stock_movements)
    union all select 'expenses', (select count(*) from public.expenses)
    union all select 'customers', (select count(*) from public.customers)
    union all select 'suppliers', (select count(*) from public.suppliers)
    union all select 'cash_ledger', (select count(*) from public.cash_ledger)
    union all select 'finance_counts', (select count(*) from public.finance_counts)
    union all select 'sales_returns', (select count(*) from public.sales_returns)
    union all select 'purchase_returns', (select count(*) from public.purchase_returns)
    union all select 'warranty_claims', (select count(*) from public.warranty_claims)
    union all select 'document_counters', (select count(*) from public.document_counters)
    union all select 'finance_accounts (not default)', (select count(*) from public.finance_accounts where not is_default)
  ) d
  union all
  select 'kept', b.table_name, b.rows_before, a.rows_after, b.rows_before = a.rows_after
  from cleanup_report_before b
  join (
    select 'businesses' as table_name, count(*) as rows_after from public.businesses
    union all select 'profiles', count(*) from public.profiles
    union all select 'permissions', count(*) from public.permissions
    union all select 'role_permissions', count(*) from public.role_permissions
    union all select 'user_permission_overrides', count(*) from public.user_permission_overrides
    union all select 'brands', count(*) from public.brands
    union all select 'product_models', count(*) from public.product_models
    union all select 'model_variants', count(*) from public.model_variants
    union all select 'model_colors', count(*) from public.model_colors
    union all select 'product_categories', count(*) from public.product_categories
    union all select 'products', count(*) from public.products
    union all select 'expense_categories', count(*) from public.expense_categories
    union all select 'finance_accounts (default)', count(*) from public.finance_accounts where is_default
  ) a on a.table_name = b.table_name
  union all
  select 'kept', 'default account balance: ' || f.name, 0, coalesce(fb.balance, 0),
         coalesce(fb.balance, 0) = 0 and f.opening_balance = 0
  from public.finance_accounts f
  left join public.finance_account_balances fb on fb.id = f.id
  where f.is_default
) report
order by kind, table_name;
