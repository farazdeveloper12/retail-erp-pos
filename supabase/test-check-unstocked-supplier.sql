-- TEST PROJECT ONLY (gwadar-test). Read-only checks for "Item not in stock"
-- lines with a supplier (Part 3). Changes nothing. Every row should show
-- ok = true.

select 'migration: new sale line columns exist' as check_name,
       count(*)::text || ' of 6' as detail,
       count(*) = 6 as ok
from information_schema.columns
where table_schema = 'public' and table_name = 'sale_items'
  and column_name in ('storage_gb', 'ram_gb', 'color_name', 'unstocked_note', 'supplier_id', 'purchase_id')

union all
select 'supplier lines: one purchase each, same supplier and cost', count(*)::text || ' problems', count(*) = 0
from public.sale_items si
left join public.purchases p on p.id = si.purchase_id
left join public.sale_item_costs c on c.item_id = si.id
where si.supplier_id is not null
  and (p.id is null or p.supplier_id <> si.supplier_id or p.total <> round(c.unit_cost * si.quantity, 2))

union all
select 'supplier lines: no stock (no purchase lines, no stock movements)', count(*)::text || ' problems', count(*) = 0
from public.sale_items si
where si.purchase_id is not null
  and (exists (select 1 from public.purchase_items pi where pi.purchase_id = si.purchase_id)
       or exists (select 1 from public.stock_movements m where m.ref_type = 'purchase' and m.ref_id = si.purchase_id)
       or exists (select 1 from public.phone_units u where u.purchase_id = si.purchase_id))

union all
select 'supplier lines: paid now is in the ledger', count(*)::text || ' problems', count(*) = 0
from public.sale_items si
join public.purchases p on p.id = si.purchase_id
where p.paid_amount <> coalesce((select sum(l.amount) from public.cash_ledger l
                                 where l.ref_type = 'purchase' and l.ref_id = p.id and l.direction = 'out'), 0)
  and not exists (select 1 from public.purchase_payments pp where pp.purchase_id = p.id)

union all
select 'value: owed to suppliers for not-in-stock lines',
       'AED/PKR ' || coalesce(sum(p.total - p.paid_amount), 0)::text,
       true
from public.sale_items si
join public.purchases p on p.id = si.purchase_id and p.status = 'completed';
