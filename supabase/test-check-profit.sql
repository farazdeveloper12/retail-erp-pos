-- TEST PROJECT ONLY (gwadar-test). Read-only checks for profit before VAT.
-- Changes nothing. One single query: every row has check_name, detail and ok.
-- Every row should show ok = true. Rows starting with "value:" only show
-- numbers to compare with the app and are always ok.

select 'migration: profit functions exist' as check_name,
       count(*)::text || ' of 3 functions' as detail,
       count(*) = 3 as ok
from (
  select p.proname,
         case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('get_dashboard', 'get_sale_profits', 'get_sale_line_costs')
) f
where f.proname <> 'get_dashboard' or f.def ilike '%sr.vat_amount%'

union all
select 'sales: lines minus discount = total (the profit formula relies on it)',
       count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.total <> coalesce((select sum(si.line_total) from public.sale_items si where si.sale_id = s.id), 0) - s.discount

union all
select 'sales returns: items add up to the return total', count(*)::text || ' problems', count(*) = 0
from public.sales_returns r
where r.total <> coalesce((select sum(i.line_total) from public.sales_return_items i where i.return_id = r.id), 0)

union all
select 'value: VAT sales (profit before VAT = total - VAT - cost)',
       coalesce(string_agg('INV-' || lpad(x.invoice_no::text, 6, '0') || ': total ' || x.total
                           || ', VAT ' || x.vat_amount || ', cost ' || x.cost
                           || ', profit ' || (x.total - x.vat_amount - x.cost), '; ' order by x.invoice_no), 'none'),
       true
from (
  select s.invoice_no, s.total, s.vat_amount,
         coalesce((select sum(coalesce(c.unit_cost, 0) * si.quantity)
                   from public.sale_items si
                   left join public.sale_item_costs c on c.item_id = si.id
                   where si.sale_id = s.id), 0) as cost
  from public.sales s
  where s.status = 'completed' and s.vat_rate > 0
  order by s.created_at desc
  limit 10
) x;
