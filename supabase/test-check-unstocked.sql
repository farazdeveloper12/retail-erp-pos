-- TEST PROJECT ONLY (gwadar-test). Read-only checks for "Item not in stock"
-- sale lines (item_type 'unstocked'). Changes nothing. One single query:
-- every row has check_name, detail and ok. Every row should show ok = true.
-- Rows starting with "value:" only show numbers and are always ok.

select 'migration: functions know unstocked lines' as check_name,
       coalesce(string_agg(f.proname::text, ', ' order by f.proname), 'none') as detail,
       count(*) = 4 as ok
from (
  select p.proname,
         case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_sale', 'cancel_sale', 'sales_return_lines', 'create_warranty_claim')
) f
where f.def ilike '%unstocked%'

union all
select 'unstocked lines: never linked to a phone or product', count(*)::text || ' problems', count(*) = 0
from public.sale_items si
where si.item_type = 'unstocked' and (si.phone_unit_id is not null or si.product_id is not null)

union all
select 'unstocked lines: cost price saved', count(*)::text || ' problems', count(*) = 0
from public.sale_items si
left join public.sale_item_costs c on c.item_id = si.id
where si.item_type = 'unstocked' and c.item_id is null

union all
select 'sales: stock movements only for accessory lines', count(*)::text || ' problems', count(*) = 0
from public.sales s
where (select count(*) from public.stock_movements m
       where m.ref_type = 'sale' and m.ref_id = s.id)
   <> (select count(*) from public.sale_items si
       where si.sale_id = s.id and si.item_type = 'accessory')

union all
select 'cancelled invoices: no stock put back for unstocked lines', count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.status = 'void'
  and (select count(*) from public.stock_movements m
       where m.ref_type = 'sale_void' and m.ref_id = s.id)
   <> (select count(*) from public.sale_items si
       where si.sale_id = s.id and si.item_type = 'accessory')

union all
select 'returns of unstocked lines: profit reversed, no stock', count(*)::text || ' problems', count(*) = 0
from public.sales_return_items ri
join public.sale_items si on si.id = ri.sale_item_id
where si.item_type = 'unstocked'
  and (not ri.restock or ri.phone_unit_id is not null or ri.product_id is not null)

union all
select 'value: unstocked lines (count, sales, profit)',
       count(*)::text || ' lines, sales ' || coalesce(sum(si.line_total), 0)::text
         || ', profit ' || coalesce(sum(si.line_total - c.unit_cost * si.quantity), 0)::text,
       true
from public.sale_items si
join public.sales s on s.id = si.sale_id and s.status = 'completed'
left join public.sale_item_costs c on c.item_id = si.id
where si.item_type = 'unstocked';
