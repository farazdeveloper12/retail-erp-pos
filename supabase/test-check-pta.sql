-- TEST PROJECT ONLY (gwadar-test). Read-only checks for the phone catalog,
-- auto-created phone options and PTA status. Changes nothing. One single
-- query: every row has check_name, detail and ok. Every row should show
-- ok = true. Rows starting with "value:" only show numbers.

select 'migration: PTA columns exist' as check_name,
       count(*)::text || ' of 3' as detail,
       count(*) = 3 as ok
from information_schema.columns
where table_schema = 'public' and column_name = 'pta_status'
  and table_name in ('phone_units', 'purchase_items', 'sale_items')

union all
select 'migration: functions save the PTA status',
       coalesce(string_agg(f.proname::text, ', ' order by f.proname), 'none'),
       count(*) = 4
from (
  select p.proname,
         case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_purchase', 'create_quick_sale', 'create_sale', 'customer_purchase_add_unit')
) f
where f.def ilike '%pta_status%'

union all
select 'migration: ensure_phone_option exists', count(*)::text, count(*) = 1
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ensure_phone_option'

union all
select 'catalog: no duplicate models (case-insensitive)', count(*)::text || ' problems', count(*) = 0
from (select brand_id, lower(name) from public.product_models group by 1, 2 having count(*) > 1) x

union all
select 'catalog: no duplicate storage options', count(*)::text || ' problems', count(*) = 0
from (select model_id, storage_gb, coalesce(ram_gb, 0) from public.model_variants group by 1, 2, 3 having count(*) > 1) x

union all
select 'sale lines: phone lines have the PTA of their phone', count(*)::text || ' problems', count(*) = 0
from public.sale_items si
join public.phone_units u on u.id = si.phone_unit_id
join public.sales s on s.id = si.sale_id
where si.item_type = 'phone' and si.pta_status is distinct from u.pta_status
  and s.created_at > (select min(created_at) from public.sale_items x
                      join public.sales y on y.id = x.sale_id where x.pta_status is not null)

union all
select 'value: catalog size',
       (select count(*) from public.brands)::text || ' brands, '
       || (select count(*) from public.product_models)::text || ' models, '
       || (select count(*) from public.model_variants)::text || ' storage options, '
       || (select count(*) from public.model_colors)::text || ' colours',
       true

union all
select 'value: phones in stock by PTA status',
       coalesce(string_agg(coalesce(x.pta_status, 'not recorded') || ' = ' || x.n, ', '), 'none'),
       true
from (select pta_status, count(*)::text as n from public.phone_units where status = 'in_stock' group by pta_status) x;
