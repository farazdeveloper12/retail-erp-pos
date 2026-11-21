-- TEST PROJECT ONLY (gwadar-test). Read-only checks after edits and deletes
-- (Part 4). Changes nothing. Every row should show ok = true.

select 'migration: permissions and functions exist' as check_name,
       (select count(*) from public.permissions where key in ('entries.edit', 'entries.delete'))::text || ' of 2 permissions, '
       || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('edit_sale', 'edit_purchase', 'edit_expense', 'edit_payment',
                               'edit_customer_purchase', 'delete_entry'))::text || ' of 6 functions' as detail,
       (select count(*) from public.permissions where key in ('entries.edit', 'entries.delete')) = 2
       and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('edit_sale', 'edit_purchase', 'edit_expense', 'edit_payment',
                                'edit_customer_purchase', 'delete_entry')) = 6 as ok

union all
select 'sales: lines add up to the total', count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.status = 'completed'
  and s.total <> coalesce((select sum(si.line_total) from public.sale_items si where si.sale_id = s.id), 0) - s.discount

union all
select 'sales: paid = payments + credits (deleted payments left out)', count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.status = 'completed'
  and s.paid_amount <> coalesce((select sum(sp.amount) from public.sale_payments sp
                                 where sp.sale_id = s.id and sp.deleted_at is null), 0)
                      + s.return_credit + s.trade_in_credit

union all
select 'purchases: lines add up to the total', count(*)::text || ' problems', count(*) = 0
from public.purchases p
where p.status = 'completed'
  and exists (select 1 from public.purchase_items pi where pi.purchase_id = p.id)
  and p.total <> coalesce((select sum(pi.line_total) from public.purchase_items pi where pi.purchase_id = p.id), 0)
                 + p.extra_cost

union all
select 'deleted sales and purchases are cancelled (out of totals)', count(*)::text || ' problems', count(*) = 0
from (select status from public.sales where deleted_at is not null
      union all select status from public.purchases where deleted_at is not null) x
where x.status = 'completed'

union all
select 'deleted expenses are cancelled', count(*)::text || ' problems', count(*) = 0
from public.expenses where deleted_at is not null and voided_at is null

union all
select 'every edit and delete has a reason', count(*)::text || ' problems', count(*) = 0
from public.entry_changes where char_length(trim(reason)) < 3

union all
select 'value: history', count(*)::text || ' changes (' || count(*) filter (where action = 'delete')::text || ' deletes)', true
from public.entry_changes;
