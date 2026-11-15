-- =============================================================================
-- Settings, Cash & Bank, Returns & Warranty and AI Assistant
--
-- One idempotent migration: it can be run more than once and only adds or
-- replaces objects. It never deletes rows and never changes existing data,
-- except where a section says so explicitly.
-- Run it in the Supabase SQL Editor of the TEST project first, then (after
-- approval) once on the real project.
-- =============================================================================


-- =============================================================================
-- 1. SETTINGS
-- =============================================================================

-- 1.1 New business settings (all optional, with safe defaults) ---------------
alter table public.businesses
  add column if not exists invoice_footer text,
  add column if not exists date_format text not null default 'medium',
  add column if not exists invoice_paper text not null default 'a4',
  add column if not exists invoice_show_logo boolean not null default true,
  add column if not exists invoice_show_customer_phone boolean not null default true,
  add column if not exists invoice_show_warranty boolean not null default true,
  add column if not exists invoice_show_payment_method boolean not null default true,
  add column if not exists low_stock_threshold integer not null default 5;

alter table public.businesses drop constraint if exists businesses_invoice_footer_check;
alter table public.businesses add constraint businesses_invoice_footer_check
  check (invoice_footer is null or char_length(invoice_footer) <= 500);

alter table public.businesses drop constraint if exists businesses_date_format_check;
alter table public.businesses add constraint businesses_date_format_check
  check (date_format in ('medium', 'dmy', 'mdy', 'iso'));

alter table public.businesses drop constraint if exists businesses_invoice_paper_check;
alter table public.businesses add constraint businesses_invoice_paper_check
  check (invoice_paper in ('a4', 'thermal'));

alter table public.businesses drop constraint if exists businesses_low_stock_threshold_check;
alter table public.businesses add constraint businesses_low_stock_threshold_check
  check (low_stock_threshold between 0 and 1000);

alter table public.businesses drop constraint if exists businesses_logo_url_check;
-- "not valid": checks new and changed rows only, so an older logo value can
-- never make this migration fail.
alter table public.businesses add constraint businesses_logo_url_check
  check (logo_url is null or (char_length(logo_url) <= 500 and logo_url ~* '^https://')) not valid;


-- 1.2 Expense categories (managed in Settings, used as suggestions) ----------
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.my_business_id() references public.businesses (id),
  name text not null,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_categories_name_check
    check (char_length(trim(name)) between 1 and 60)
);

create unique index if not exists expense_categories_name_key
  on public.expense_categories (business_id, lower(trim(name)));

alter table public.expense_categories enable row level security;

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories for select
  using (business_id = public.my_business_id()
         and (public.has_permission('expenses.view') or public.has_permission('expenses.manage')
              or public.has_permission('settings.manage')));

drop policy if exists expense_categories_insert on public.expense_categories;
create policy expense_categories_insert on public.expense_categories for insert
  with check (business_id = public.my_business_id() and created_by = auth.uid()
              and public.has_permission('settings.manage'));

drop policy if exists expense_categories_update on public.expense_categories;
create policy expense_categories_update on public.expense_categories for update
  using (business_id = public.my_business_id() and public.has_permission('settings.manage'))
  with check (business_id = public.my_business_id() and public.has_permission('settings.manage'));

drop trigger if exists expense_categories_set_updated_at on public.expense_categories;
create trigger expense_categories_set_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();


-- 1.3 Let every user change their own display name -------------------------
create or replace function public.update_my_profile(p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_full_name, ''));
begin
  if auth.uid() is null then
    raise exception 'You are not signed in.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Your name must be between 2 and 80 characters.';
  end if;
  update public.profiles set full_name = v_name, updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.update_my_profile(text) from public, anon;
grant execute on function public.update_my_profile(text) to authenticated, service_role;


-- 1.4 Storage bucket for the shop logo -------------------------------------
-- Public read (the logo is printed on invoices); upload limited to 512 KB and
-- PNG, JPEG or WebP. Files live under "<business id>/..." and only users with
-- settings.manage in that business can upload, replace or remove them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', true, 524288,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists business_logos_select on storage.objects;
create policy business_logos_select on storage.objects for select to authenticated
  using (bucket_id = 'business-logos'
         and (storage.foldername(name))[1] = public.my_business_id()::text);

drop policy if exists business_logos_insert on storage.objects;
create policy business_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'business-logos'
              and (storage.foldername(name))[1] = public.my_business_id()::text
              and public.has_permission('settings.manage'));

drop policy if exists business_logos_update on storage.objects;
create policy business_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'business-logos'
         and (storage.foldername(name))[1] = public.my_business_id()::text
         and public.has_permission('settings.manage'))
  with check (bucket_id = 'business-logos'
              and (storage.foldername(name))[1] = public.my_business_id()::text
              and public.has_permission('settings.manage'));

drop policy if exists business_logos_delete on storage.objects;
create policy business_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'business-logos'
         and (storage.foldername(name))[1] = public.my_business_id()::text
         and public.has_permission('settings.manage'));


-- 1.5 Dashboard: use the low stock threshold from Settings ------------------
-- Same function as before; only the low stock limit now comes from Settings
-- (businesses.low_stock_threshold) instead of a fixed 5.
create or replace function public.get_dashboard(p_from date, p_to date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_biz uuid := public.my_business_id();
  v_fin boolean := public.has_permission('dashboard.financial') or public.has_permission('reports.financial');
  v_basic boolean := public.has_permission('dashboard.view') or public.has_permission('reports.basic') or v_fin;
  v_low_stock numeric := coalesce(
    (select b.low_stock_threshold from public.businesses b where b.id = public.my_business_id()), 5);
  r jsonb;
begin
  if auth.uid() is null or v_biz is null then
    raise exception 'You are not signed in or no business is assigned to your account.';
  end if;
  if not v_basic then
    raise exception 'You do not have permission to view the dashboard.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a valid date range of at most one year.';
  end if;

  with sale_rows as (
    select s.id, s.total, s.discount, s.paid_amount,
           (s.created_at at time zone 'Asia/Karachi')::date as day
    from public.sales s
    where s.business_id = v_biz and s.status = 'completed'
      and (s.created_at at time zone 'Asia/Karachi')::date between p_from and p_to
  ),
  sale_profit as (
    select sr.id, sr.day,
           coalesce(sum(si.line_total - c.unit_cost * si.quantity), 0) - sr.discount as profit
    from sale_rows sr
    left join public.sale_items si on si.sale_id = sr.id
    left join public.sale_item_costs c on c.item_id = si.id
    group by sr.id, sr.day, sr.discount
  ),
  daily as (
    select sr.day, count(*) as sales_count, sum(sr.total) as sales_total,
           coalesce(sum(sp.profit), 0) as profit
    from sale_rows sr join sale_profit sp on sp.id = sr.id
    group by sr.day
  ),
  top_items as (
    select si.description, sum(si.quantity) as qty, sum(si.line_total) as amount
    from sale_rows sr join public.sale_items si on si.sale_id = sr.id
    group by si.description
    order by sum(si.line_total) desc
    limit 10
  ),
  exp_cat as (
    select e.category, sum(e.amount) as amount
    from public.expenses e
    where e.business_id = v_biz and e.voided_at is null and e.expense_date between p_from and p_to
    group by e.category order by sum(e.amount) desc
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'financial', v_fin,
    'sales_total', coalesce((select sum(total) from sale_rows), 0),
    'sales_count', (select count(*) from sale_rows),
    'sales_paid', coalesce((select sum(paid_amount) from sale_rows), 0),
    'receivable', coalesce((select sum(s.total - s.paid_amount) from public.sales s
                            where s.business_id = v_biz and s.status = 'completed' and s.total > s.paid_amount), 0),
    'phones_in_stock', (select count(*) from public.phone_units u where u.business_id = v_biz and u.status = 'in_stock'),
    'accessory_units', coalesce((select sum(qty) from public.product_stock ps where ps.business_id = v_biz), 0),
    'low_stock_count', (select count(*) from public.product_stock ps join public.products p on p.id = ps.product_id
                        where ps.business_id = v_biz and p.is_active and ps.qty <= v_low_stock),
    'low_stock_threshold', v_low_stock,
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'sales_count', d.sales_count,
                        'sales_total', d.sales_total) order by d.day) from daily d), '[]'::jsonb),
    'daily_full', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'sales_count', d.sales_count,
                        'sales_total', d.sales_total, 'profit', d.profit) order by d.day) from daily d), '[]'::jsonb),
    'profit', coalesce((select sum(profit) from daily), 0),
    'top_items', coalesce((select jsonb_agg(jsonb_build_object('description', t.description, 'qty', t.qty,
                        'amount', t.amount)) from top_items t), '[]'::jsonb)
  ) into r;

  if v_fin then
    r := r || jsonb_build_object(
      'purchases_total', coalesce((select sum(p.total) from public.purchases p
                  where p.business_id = v_biz and p.purchase_date between p_from and p_to and p.status = 'completed'), 0),
      'expenses_total', coalesce((select sum(e.amount) from public.expenses e
                  where e.business_id = v_biz and e.voided_at is null and e.expense_date between p_from and p_to), 0),
      'payable', coalesce((select sum(p.total - p.paid_amount) from public.purchases p
                  where p.business_id = v_biz and p.total > p.paid_amount and p.status = 'completed'), 0),
      'cash_balance', coalesce((select sum(case l.direction when 'in' then l.amount else -l.amount end)
                  from public.cash_ledger l where l.business_id = v_biz and l.account = 'cash'), 0),
      'bank_balance', coalesce((select sum(case l.direction when 'in' then l.amount else -l.amount end)
                  from public.cash_ledger l where l.business_id = v_biz and l.account = 'bank'), 0),
      'stock_value', coalesce((select sum(c.landed_cost) from public.phone_units u
                  join public.phone_unit_costs c on c.unit_id = u.id
                  where u.business_id = v_biz and u.status = 'in_stock'), 0)
                  + coalesce((select sum(ps.qty * pc.avg_cost) from public.product_stock ps
                  join public.product_costs pc on pc.product_id = ps.product_id
                  where ps.business_id = v_biz), 0),
      'expenses_by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount', amount))
                  from (select e.category, sum(e.amount) as amount from public.expenses e
                        where e.business_id = v_biz and e.voided_at is null and e.expense_date between p_from and p_to
                        group by e.category order by sum(e.amount) desc) q), '[]'::jsonb)
    );
    r := jsonb_set(r, '{daily}', r -> 'daily_full') - 'daily_full';
  else
    r := r - 'daily_full' - 'profit';
  end if;

  return r;
end;
$function$;
