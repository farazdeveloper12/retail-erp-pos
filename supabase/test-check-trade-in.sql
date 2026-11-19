-- TEST PROJECT ONLY (gwadar-test). Read-only checks for phones bought from
-- customers and POS trade-ins. Changes nothing. One single query: every row
-- has check_name, detail and ok. Every row should show ok = true.

select 'migration: trade-in functions exist' as check_name,
       count(*)::text || ' of 4' as detail,
       count(*) = 4 as ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('buy_from_customer', 'create_trade_in_sale', 'quick_add_phone_model', 'customer_purchase_add_unit')

union all
select 'phones bought: in stock records are "used" with cost = price paid', count(*)::text || ' problems', count(*) = 0
from public.customer_purchases cp
join public.phone_units u on u.id = cp.phone_unit_id
left join public.phone_unit_costs c on c.unit_id = u.id
where u.condition <> 'used' or u.imei <> cp.imei or u.purchase_id is not null
   or c.unit_id is null or c.landed_cost <> cp.price or c.purchase_cost <> cp.price

union all
select 'bought for cash/bank: one ledger payment of the same amount', count(*)::text || ' problems', count(*) = 0
from public.customer_purchases cp
where cp.payment_method in ('cash', 'bank')
  and cp.price <> coalesce((select sum(l.amount) from public.cash_ledger l
                            where l.ref_type = 'customer_purchase' and l.ref_id = cp.id
                              and l.direction = 'out' and l.category = 'customer_purchase'), 0)

union all
select 'trade-ins: no money moved through Cash or Bank', count(*)::text || ' problems', count(*) = 0
from public.customer_purchases cp
where cp.payment_method = 'trade_in'
  and exists (select 1 from public.cash_ledger l where l.ref_type = 'customer_purchase' and l.ref_id = cp.id)

union all
select 'sales: trade-in credit = value of the trade-in', count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.trade_in_credit <> coalesce((select sum(cp.price) from public.customer_purchases cp
                                     where cp.sale_id = s.id), 0)

union all
select 'sales: paid never above total (trade-in included)', count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.paid_amount > s.total or s.trade_in_credit > s.total

union all
select 'sales: VAT unchanged by trade-ins', count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.trade_in_credit > 0 and s.vat_rate > 0
  and s.vat_amount <> round(s.total * s.vat_rate / (100 + s.vat_rate), 2)

union all
select 'cancelled invoices: none with a trade-in', count(*)::text || ' problems', count(*) = 0
from public.sales s
where s.status = 'void' and s.trade_in_credit > 0

union all
select 'value: phones bought from customers',
       count(*)::text || ' (' || count(*) filter (where payment_method = 'trade_in')::text
         || ' trade-ins), total ' || coalesce(sum(price), 0)::text,
       true
from public.customer_purchases;
