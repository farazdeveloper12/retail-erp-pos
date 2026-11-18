-- TEST PROJECT ONLY (gwadar-test). Read-only checks for region, VAT and plan
-- settings. Changes nothing. One single query: every row has check_name,
-- detail and ok. Every row should show ok = true.

select 'migration: new business columns exist' as check_name,
       count(*)::text || ' of 6 columns' as detail,
       count(*) = 6 as ok
from information_schema.columns
where table_schema = 'public' and table_name = 'businesses'
  and column_name in ('vat_enabled', 'trn', 'name_ar', 'address_ar', 'invoice_language', 'plan')

union all
select 'migration: VAT triggers exist', count(*)::text || ' of 4 triggers', count(*) = 4
from pg_trigger
where not tgisinternal
  and tgname in ('sales_set_vat', 'sales_keep_vat', 'sales_returns_set_vat', 'sales_returns_keep_vat')

union all
select 'safety: no other database function uses businesses.tax_rate', coalesce(string_agg(p.proname, ', '), 'none'),
       count(*) = 0
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname not in ('sales_set_vat')
  and pg_get_functiondef(p.oid) ilike '%tax_rate%'

union all
select 'sales: no VAT on sales without a VAT rate', count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.vat_rate = 0 and s.vat_amount <> 0

union all
select 'sales: VAT = round(total * rate / (100 + rate), 2)', count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.vat_rate > 0
  and s.vat_amount <> round(s.total * s.vat_rate / (100 + s.vat_rate), 2)

union all
select 'sales returns: VAT only on returns of VAT sales', count(*)::text || ' problems', count(*) = 0
from public.sales_returns r
join public.sales s on s.id = r.sale_id
where r.vat_rate <> s.vat_rate or (r.vat_rate = 0 and r.vat_amount <> 0)

union all
select 'sales returns: VAT reversed never more than the sale VAT', count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.vat_amount < coalesce((select sum(r.vat_amount) from public.sales_returns r where r.sale_id = s.id), 0)

union all
select 'sales returns: fully returned VAT sale has all VAT reversed', count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.vat_rate > 0 and s.returned_total >= s.total and s.total > 0
  and s.vat_amount <> coalesce((select sum(r.vat_amount) from public.sales_returns r where r.sale_id = s.id), 0)

union all
select 'businesses: VAT on only with a rate above 0', count(*)::text || ' problems', count(*) = 0
from public.businesses b
where b.vat_enabled and (b.tax_rate is null or b.tax_rate <= 0)

union all
select 'value: businesses per plan', string_agg(x.plan || ' = ' || x.n, ', '), true
from (select plan, count(*)::text as n from public.businesses group by plan) x;
