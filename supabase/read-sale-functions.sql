-- READ-ONLY. Changes nothing. Safe on gwadar-test and on the real project.
-- Shows the sale functions and the sale_items table with an md5 fingerprint
-- per row. Run it on both projects and compare the "fingerprint" column:
-- equal fingerprints mean the objects are exactly the same.

select 'function: ' || f.proname::text as item,
       md5(f.def) as fingerprint,
       f.def as detail
from (
  select p.proname,
         case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
) f
where f.def ilike '%sale_items%'
   or f.proname in ('create_quick_sale', 'create_sale', 'cancel_sale', 'create_sales_return')

union all
select x.item, md5(x.detail), x.detail
from (
  select 'table: sale_items columns' as item,
         string_agg(column_name || ' ' || data_type || ' null=' || is_nullable
                    || ' default=' || coalesce(column_default, '-'), E'\n' order by ordinal_position) as detail
  from information_schema.columns
  where table_schema = 'public' and table_name = 'sale_items'

  union all
  select 'table: sale_items constraints',
         string_agg(conname::text || ': ' || pg_get_constraintdef(oid), E'\n' order by conname)
  from pg_constraint
  where conrelid = 'public.sale_items'::regclass

  union all
  select 'triggers on sales, sale_items, sale_item_costs',
         string_agg(tgrelid::regclass::text || '.' || tgname::text || ': ' || pg_get_triggerdef(oid), E'\n'
                    order by tgrelid::regclass::text, tgname)
  from pg_trigger
  where not tgisinternal
    and tgrelid in ('public.sales'::regclass, 'public.sale_items'::regclass, 'public.sale_item_costs'::regclass)
) x

order by 1;
