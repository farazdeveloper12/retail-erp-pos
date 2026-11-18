-- =============================================================================
-- Supplier payments: check the account balance
--
-- record_supplier_payment (the "Pay supplier" button on a purchase) now refuses
-- a payment when the cash or bank account it is paid from holds less money
-- than the amount. Everything else in the function is unchanged.
--
-- Needs 20261115000000_settings_finance_returns_ai.sql (finance accounts).
-- Idempotent: it only replaces one function. No data is changed.
-- Runs as one transaction in the Supabase SQL Editor.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.finance_accounts') is null
     or to_regprocedure('public.finance_balance(uuid)') is null
     or to_regprocedure('public.default_finance_account(uuid,text)') is null
     or to_regprocedure('public.finance_format(numeric)') is null then
    raise exception 'Stopped: run 20261115000000_settings_finance_returns_ai.sql first.';
  end if;
end;
$$;

create or replace function public.record_supplier_payment(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_biz uuid := public.my_business_id();
  v_uid uuid := auth.uid();
  v_purchase public.purchases%rowtype;
  v_amount numeric(14,2);
  v_method text;
  v_account public.finance_accounts%rowtype;
  v_balance numeric;
begin
  if v_uid is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not (public.has_permission('purchases.manage') or public.has_permission('suppliers.manage')) then
    raise exception 'You do not have permission to pay suppliers.';
  end if;

  v_amount := (p_payload ->> 'amount')::numeric;
  v_method := p_payload ->> 'payment_method';
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if v_method is distinct from 'cash' and v_method is distinct from 'bank' then
    raise exception 'Choose cash or bank for the payment.';
  end if;

  select * into v_purchase from public.purchases p
    where p.id = (p_payload ->> 'purchase_id')::uuid and p.business_id = v_biz and p.status = 'completed'
    for update;
  if not found then
    raise exception 'Purchase not found.';
  end if;
  if v_amount > v_purchase.total - v_purchase.paid_amount then
    raise exception 'The amount is more than the remaining balance of this purchase.';
  end if;

  -- New: the payment comes from the default cash or bank account (the same
  -- account the ledger entry below is linked to), which must hold enough.
  -- The account row is locked so two payments cannot both pass the check.
  select * into v_account from public.finance_accounts a
    where a.id = public.default_finance_account(v_biz, v_method)
    for update;
  v_balance := public.finance_balance(v_account.id);
  if v_balance < v_amount then
    raise exception 'Not enough money in % to pay this supplier. The balance is %, the payment is %.',
      v_account.name, public.finance_format(v_balance), public.finance_format(v_amount);
  end if;

  update public.purchases set paid_amount = paid_amount + v_amount where id = v_purchase.id;
  insert into public.purchase_payments (business_id, purchase_id, amount, method, created_by)
  values (v_biz, v_purchase.id, v_amount, v_method, v_uid);
  insert into public.cash_ledger
    (business_id, account, account_id, direction, amount, category, party_type, party_id, ref_type, ref_id, created_by)
  values
    (v_biz, v_method, v_account.id, 'out', v_amount, 'supplier_payment', 'supplier', v_purchase.supplier_id,
     'purchase', v_purchase.id, v_uid);

  return jsonb_build_object('purchase_id', v_purchase.id,
                            'balance', v_purchase.total - v_purchase.paid_amount - v_amount);
end;
$function$;

-- Same rights as before
revoke all on function public.record_supplier_payment(jsonb) from public, anon;
grant execute on function public.record_supplier_payment(jsonb) to authenticated, service_role;

commit;
