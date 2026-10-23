-- VIYAFAARIVERIYAA · 0005 Expenses, onboarding, outlets, staff, POS catalog, platform admin

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outlet_id uuid,
  category_id uuid not null,
  expense_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null default 'cash' check (payment_method in ('cash','card','bank_transfer','other')),
  reference text,
  payee text,
  description text,
  attachment_path text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, category_id) references public.expense_categories(organization_id, id)
);
create index expenses_org_date_idx on public.expenses(organization_id, expense_date desc);
create trigger expenses_touch before update on public.expenses
  for each row execute function private.touch_updated_at();

create or replace function private.audit_expense() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations where id = coalesce(new.organization_id, old.organization_id)) then
    return coalesce(new, old);
  end if;
  perform private.audit(coalesce(new.organization_id, old.organization_id), 'expense.' || lower(tg_op), 'expense',
    coalesce(new.id, old.id), jsonb_build_object('amount', coalesce(new.amount, old.amount),
                                                 'old_amount', case when tg_op = 'UPDATE' then old.amount end));
  return coalesce(new, old);
end $$;
create trigger expenses_audit after insert or update or delete on public.expenses
  for each row execute function private.audit_expense();

-- Settings changes are audited
create or replace function private.audit_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if tg_table_name = 'organizations' then
    v_org := coalesce(new.id, old.id);
  else
    v_org := (to_jsonb(coalesce(new, old))->>'organization_id')::uuid;
  end if;
  if not exists (select 1 from public.organizations where id = v_org) then
    return coalesce(new, old);   -- cascading delete of a whole organization
  end if;
  perform private.audit(v_org, tg_table_name || '.' || lower(tg_op), tg_table_name, coalesce(new.id, old.id),
    case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
         else to_jsonb(coalesce(new, old)) end);
  return coalesce(new, old);
end $$;
create trigger organizations_audit after update on public.organizations for each row execute function private.audit_settings();
create trigger tax_rates_audit after insert or update or delete on public.tax_rates for each row execute function private.audit_settings();
create trigger payment_methods_audit after insert or update or delete on public.payment_methods for each row execute function private.audit_settings();
create trigger roles_audit after insert or update or delete on public.roles for each row execute function private.audit_settings();
create trigger registers_audit after insert or update or delete on public.registers for each row execute function private.audit_settings();
create trigger document_sequences_audit after update on public.document_sequences for each row
  when (old.prefix is distinct from new.prefix or old.padding is distinct from new.padding)
  execute function private.audit_settings();

-- Sequences can only move forward when edited by users
create or replace function private.guard_sequence() returns trigger
language plpgsql as $$
begin
  if new.next_number < old.next_number then
    raise exception 'SEQUENCE_CANNOT_DECREASE' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger document_sequences_guard before update on public.document_sequences
  for each row execute function private.guard_sequence();

-- Members: prevent losing the last owner
create or replace function private.guard_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner_role uuid;
begin
  if not exists (select 1 from public.organizations where id = old.organization_id) then
    return old;   -- cascading delete of a whole organization
  end if;
  select id into owner_role from public.roles where organization_id = old.organization_id and system_key = 'owner';
  if old.role_id = owner_role and old.status = 'active'
     and (tg_op = 'DELETE' or new.role_id <> owner_role or new.status <> 'active')
     and not exists (select 1 from public.organization_users where organization_id = old.organization_id
                      and role_id = owner_role and status = 'active' and id <> old.id) then
    raise exception 'LAST_OWNER' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger organization_users_last_owner before update or delete on public.organization_users
  for each row execute function private.guard_last_owner();

-- ---------------------------------------------------------------------------
-- Outlet provisioning (outlet + store warehouse + register + numbering)
-- ---------------------------------------------------------------------------
create or replace function private.provision_outlet(p_org uuid, p_name text, p_code text, p_address text, p_island text,
                                                    p_phone text, p_register_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_outlet uuid; v_wh uuid; v_code text := upper(trim(p_code));
begin
  insert into public.outlets (organization_id, name, code, address, island, phone)
  values (p_org, trim(p_name), v_code, p_address, p_island, p_phone) returning id into v_outlet;
  insert into public.warehouses (organization_id, outlet_id, name)
  values (p_org, v_outlet, trim(p_name) || ' store') returning id into v_wh;
  update public.outlets set default_warehouse_id = v_wh where id = v_outlet;
  insert into public.registers (organization_id, outlet_id, name)
  values (p_org, v_outlet, coalesce(nullif(trim(p_register_name), ''), 'Register 1'));
  insert into public.document_sequences (organization_id, outlet_id, doc_type, prefix) values
    (p_org, v_outlet, 'sale', v_code || '-'),
    (p_org, v_outlet, 'refund', v_code || '-RF-'),
    (p_org, v_outlet, 'quotation', v_code || '-QT-');
  return v_outlet;
end $$;

create or replace function public.create_outlet(p_org uuid, p_name text, p_code text, p_address text, p_island text,
                                                p_phone text, p_register_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform private.require_perm(p_org, 'settings.manage');
  v := private.provision_outlet(p_org, p_name, p_code, p_address, p_island, p_phone, p_register_name);
  perform private.audit(p_org, 'outlet.created', 'outlet', v, jsonb_build_object('name', p_name, 'code', p_code));
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding: one transaction creates a fully usable business for the caller.
-- payload: {name, legal_name?, tin?, gst_registration?, business_registration?, phone?, email?, address?,
--           island?, atoll?, currency?, prices_include_tax?, display_name?,
--           outlet:{name, code, address?, island?, phone?}, register_name?,
--           taxes:[{name, rate, is_default}]}
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_owner uuid;
  t jsonb;
  has_default boolean := false;
  owned int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select count(*) into owned from public.organizations where created_by = auth.uid() and created_at > now() - interval '1 day';
  if owned >= 5 then raise exception 'RATE_LIMITED' using errcode = 'P0001'; end if;
  if coalesce(trim(payload->>'name'), '') = '' then raise exception 'NAME_REQUIRED' using errcode = '22023'; end if;

  insert into public.organizations (name, legal_name, tin, gst_registration, business_registration, phone, email, address,
                                    island, atoll, currency, prices_include_tax, created_by)
  values (trim(payload->>'name'), payload->>'legal_name', payload->>'tin', payload->>'gst_registration',
          payload->>'business_registration', payload->>'phone', payload->>'email', payload->>'address',
          payload->>'island', payload->>'atoll', upper(coalesce(nullif(payload->>'currency',''), 'MVR')),
          coalesce((payload->>'prices_include_tax')::boolean, true), auth.uid())
  returning id into v_org;

  insert into public.roles (organization_id, name, description, system_key, permissions) values
    (v_org, 'Owner', 'Full access, including billing and ownership', 'owner', '{}'),
    (v_org, 'Manager', 'Runs the business day to day', 'admin',
       array(select code from public.permissions)),
    (v_org, 'Cashier', 'Sells at the register', 'cashier',
       array['pos.sell','pos.quotations','sales.view','shifts.manage','cash.movements','products.view',
             'customers.view','customers.manage','inventory.view']),
    (v_org, 'Inventory', 'Receives and manages stock', 'inventory',
       array['products.view','products.manage','inventory.view','inventory.adjust','inventory.transfer',
             'purchases.view','purchases.manage','suppliers.manage']),
    (v_org, 'Accountant', 'Views reports and reconciles payments', 'accountant',
       array['sales.view','reports.view','reports.financial','expenses.view','expenses.manage','customers.view',
             'customers.payments','payments.verify','purchases.view','inventory.view','audit.view','products.view']);
  select id into v_owner from public.roles where organization_id = v_org and system_key = 'owner';

  insert into public.organization_users (organization_id, user_id, role_id, display_name)
  values (v_org, auth.uid(), v_owner, payload->>'display_name');

  for t in select * from jsonb_array_elements(coalesce(payload->'taxes', '[]'::jsonb)) loop
    insert into public.tax_rates (organization_id, name, rate, is_default)
    values (v_org, t->>'name', (t->>'rate')::numeric,
            coalesce((t->>'is_default')::boolean, false) and not has_default);
    has_default := has_default or coalesce((t->>'is_default')::boolean, false);
  end loop;

  insert into public.payment_methods (organization_id, name, kind, requires_reference, requires_verification, allowed_offline, sort_order) values
    (v_org, 'Cash', 'cash', false, false, true, 1),
    (v_org, 'Card', 'card', false, false, true, 2),
    (v_org, 'Bank transfer', 'bank_transfer', true, true, false, 3),
    (v_org, 'Store credit', 'store_credit', false, false, false, 4),
    (v_org, 'Customer account', 'on_account', false, false, false, 5);

  insert into public.document_sequences (organization_id, outlet_id, doc_type, prefix) values
    (v_org, null, 'purchase_order', 'PO-'), (v_org, null, 'goods_receipt', 'GRN-'),
    (v_org, null, 'purchase_return', 'PR-'), (v_org, null, 'transfer', 'TR-'), (v_org, null, 'adjustment', 'ADJ-');

  insert into public.units (organization_id, name, abbreviation, allow_decimal) values
    (v_org, 'Piece', 'pc', false), (v_org, 'Kilogram', 'kg', true), (v_org, 'Litre', 'L', true), (v_org, 'Metre', 'm', true);
  insert into public.categories (organization_id, name) values (v_org, 'General');
  insert into public.expense_categories (organization_id, name) values
    (v_org, 'Rent'), (v_org, 'Utilities'), (v_org, 'Salaries'), (v_org, 'Transport'), (v_org, 'Maintenance'),
    (v_org, 'Marketing'), (v_org, 'Supplies'), (v_org, 'Other');
  insert into public.customer_groups (organization_id, name, price_list) values
    (v_org, 'Retail', 'retail'), (v_org, 'Wholesale', 'wholesale');

  perform private.provision_outlet(v_org, coalesce(payload->'outlet'->>'name', trim(payload->>'name')),
            coalesce(payload->'outlet'->>'code', 'MAIN'), payload->'outlet'->>'address', payload->'outlet'->>'island',
            payload->'outlet'->>'phone', payload->>'register_name');

  insert into public.profiles (id, full_name, default_organization_id)
  values (auth.uid(), payload->>'display_name', v_org)
  on conflict (id) do update set default_organization_id = excluded.default_organization_id,
                                 full_name = coalesce(public.profiles.full_name, excluded.full_name);

  perform private.audit(v_org, 'organization.created', 'organization', v_org, jsonb_build_object('name', payload->>'name'));
  return v_org;
end $$;

-- ---------------------------------------------------------------------------
-- Staff invitations. No service-role key needed: invitees sign up with the invited
-- email and accept; the email is read from auth.users, never from the client.
-- ---------------------------------------------------------------------------
create or replace function public.invite_staff(p_org uuid, p_email text, p_role uuid, p_outlet_ids uuid[], p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; r public.roles%rowtype;
begin
  perform private.require_perm(p_org, 'staff.manage');
  select * into r from public.roles where id = p_role and organization_id = p_org;
  if not found then raise exception 'ROLE_NOT_FOUND' using errcode = '22023'; end if;
  if r.system_key = 'owner' and not exists (select 1 from private.member_role(p_org) where system_key = 'owner') then
    raise exception 'PERMISSION_DENIED: only owners can invite owners' using errcode = '42501';
  end if;
  if p_outlet_ids is not null and exists (select 1 from unnest(p_outlet_ids) o
       where not exists (select 1 from public.outlets where id = o and organization_id = p_org)) then
    raise exception 'OUTLET_NOT_FOUND' using errcode = '22023';
  end if;
  update public.invitations set status = 'revoked'
   where organization_id = p_org and email = lower(trim(p_email)) and status = 'pending';
  insert into public.invitations (organization_id, email, role_id, outlet_ids, display_name, invited_by)
  values (p_org, lower(trim(p_email)), p_role, p_outlet_ids, p_display_name, auth.uid())
  returning id into v_id;
  perform private.audit(p_org, 'staff.invited', 'invitation', v_id, jsonb_build_object('email', lower(trim(p_email)), 'role', r.name));
  return v_id;
end $$;

create or replace function public.my_invitations()
returns table (id uuid, organization_name text, role_name text, invited_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, o.name, r.name, i.created_at, i.expires_at
    from public.invitations i
    join public.organizations o on o.id = i.organization_id
    join public.roles r on r.id = i.role_id
   where i.status = 'pending' and i.expires_at > now()
     and i.email = (select lower(email) from auth.users where id = auth.uid());
$$;

create or replace function public.accept_invitation(p_invitation uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.invitations%rowtype; v_email text;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  select * into inv from public.invitations where id = p_invitation for update;
  if not found or inv.status <> 'pending' or inv.expires_at < now() or inv.email <> v_email then
    raise exception 'INVITATION_INVALID' using errcode = '42501';
  end if;
  insert into public.organization_users (organization_id, user_id, role_id, outlet_ids, display_name)
  values (inv.organization_id, auth.uid(), inv.role_id, inv.outlet_ids, inv.display_name)
  on conflict (organization_id, user_id) do update
     set role_id = excluded.role_id, outlet_ids = excluded.outlet_ids, status = 'active';
  update public.invitations set status = 'accepted', accepted_by = auth.uid() where id = inv.id;
  insert into public.profiles (id, full_name, default_organization_id) values (auth.uid(), inv.display_name, inv.organization_id)
  on conflict (id) do nothing;
  perform private.audit(inv.organization_id, 'staff.joined', 'invitation', inv.id, jsonb_build_object('email', v_email));
  return inv.organization_id;
end $$;

create or replace function public.update_member(p_member uuid, p_role uuid, p_outlet_ids uuid[], p_status text, p_display_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.organization_users%rowtype; r public.roles%rowtype; caller_owner boolean;
begin
  select * into m from public.organization_users where id = p_member for update;
  if not found then raise exception 'MEMBER_NOT_FOUND' using errcode = '22023'; end if;
  perform private.require_perm(m.organization_id, 'staff.manage');
  select * into r from public.roles where id = p_role and organization_id = m.organization_id;
  if not found then raise exception 'ROLE_NOT_FOUND' using errcode = '22023'; end if;
  caller_owner := exists (select 1 from private.member_role(m.organization_id) where system_key = 'owner');
  if not caller_owner and (r.system_key = 'owner'
       or exists (select 1 from public.roles where id = m.role_id and system_key = 'owner')) then
    raise exception 'PERMISSION_DENIED: only owners can change owners' using errcode = '42501';
  end if;
  if m.user_id = auth.uid() and p_status <> 'active' then
    raise exception 'CANNOT_DISABLE_SELF' using errcode = 'P0001';
  end if;
  update public.organization_users set role_id = p_role, outlet_ids = p_outlet_ids, status = p_status,
         display_name = coalesce(p_display_name, display_name)
   where id = p_member;
  perform private.audit(m.organization_id, 'staff.updated', 'organization_user', m.id,
    jsonb_build_object('role', r.name, 'status', p_status, 'outlets', p_outlet_ids));
end $$;

-- Member list with emails (only for staff managers; emails come from auth.users)
create or replace function public.list_members(p_org uuid)
returns table (id uuid, user_id uuid, email text, display_name text, role_id uuid, role_name text,
               outlet_ids uuid[], status text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_perm(p_org, 'staff.manage');
  return query
  select m.id, m.user_id, u.email::text, m.display_name, m.role_id, r.name, m.outlet_ids, m.status, m.created_at, u.last_sign_in_at
    from public.organization_users m
    join auth.users u on u.id = m.user_id
    join public.roles r on r.id = m.role_id
   where m.organization_id = p_org
   order by m.created_at;
end $$;

-- Cashier names for receipts / reports without exposing emails
create or replace function public.member_names(p_org uuid)
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, coalesce(m.display_name, split_part(u.email::text, '@', 1))
    from public.organization_users m join auth.users u on u.id = m.user_id
   where m.organization_id = p_org and private.is_member(p_org);
$$;

-- ---------------------------------------------------------------------------
-- POS catalog snapshot for an outlet (also used for the offline cache)
-- ---------------------------------------------------------------------------
create or replace function public.pos_catalog(p_org uuid, p_outlet uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_wh uuid; result jsonb; default_rate numeric;
begin
  perform private.require_perm(p_org, 'pos.sell');
  perform private.require_outlet(p_org, p_outlet);
  select default_warehouse_id into v_wh from public.outlets where id = p_outlet and organization_id = p_org;
  select rate into default_rate from public.tax_rates where organization_id = p_org and is_default and is_active;
  select coalesce(jsonb_agg(jsonb_build_object(
      'variant_id', pv.id, 'product_id', p.id, 'product_name', p.name, 'variant_name', pv.name,
      'sku', pv.sku, 'category_id', p.category_id, 'is_favorite', p.is_favorite,
      'price', coalesce(op.price, pv.retail_price), 'wholesale_price', pv.wholesale_price,
      'tax_rate', case when p.tax_rate_id is null then coalesce(default_rate, 0)
                       else coalesce((select t.rate from public.tax_rates t where t.id = p.tax_rate_id and t.is_active), 0) end,
      'track_stock', p.track_stock, 'sold_by_weight', p.sold_by_weight,
      'allow_decimal', coalesce(u.allow_decimal, false), 'unit', u.abbreviation,
      'stock', b.qty, 'image_path', p.image_path,
      'barcodes', coalesce((select jsonb_agg(pb.barcode) from public.product_barcodes pb where pb.variant_id = pv.id), '[]'::jsonb)
    ) order by p.name, pv.sort_order, pv.name), '[]'::jsonb)
    into result
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    left join public.units u on u.id = p.unit_id
    left join public.outlet_prices op on op.variant_id = pv.id and op.outlet_id = p_outlet
    left join public.inventory_balances b on b.variant_id = pv.id and b.warehouse_id = v_wh
   where pv.organization_id = p_org and p.is_active and pv.is_active;
  return jsonb_build_object('generated_at', now(), 'outlet_id', p_outlet, 'warehouse_id', v_wh, 'items', result);
end $$;

-- ---------------------------------------------------------------------------
-- Customer statement
-- ---------------------------------------------------------------------------
create or replace function public.customer_statement(p_customer uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.customers%rowtype; tz text; opening numeric(14,2); entries jsonb;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode = '22023'; end if;
  perform private.require_perm(c.organization_id, 'customers.view');
  select timezone into tz from public.organizations where id = c.organization_id;
  select coalesce((select account_balance_after from public.customer_ledger
                    where customer_id = p_customer and (created_at at time zone tz)::date < p_from
                    order by created_at desc, id desc limit 1), 0) into opening;
  select coalesce(jsonb_agg(jsonb_build_object('date', l.created_at, 'type', l.entry_type, 'note', l.note,
           'debit', greatest(l.account_delta, 0), 'credit', greatest(-l.account_delta, 0),
           'balance', l.account_balance_after, 'store_credit_delta', l.credit_delta,
           'invoice_number', s.invoice_number, 'sale_id', l.sale_id) order by l.created_at, l.id), '[]'::jsonb)
    into entries
    from public.customer_ledger l left join public.sales s on s.id = l.sale_id
   where l.customer_id = p_customer and (l.created_at at time zone tz)::date between p_from and p_to;
  return jsonb_build_object('customer', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone,
           'balance', c.account_balance, 'credit_limit', c.credit_limit, 'store_credit', c.store_credit),
         'from', p_from, 'to', p_to, 'opening_balance', opening, 'entries', entries);
end $$;

-- ---------------------------------------------------------------------------
-- Platform administration (requires platform_admins membership; separate from tenant roles)
-- ---------------------------------------------------------------------------
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.is_platform_admin() then raise exception 'PERMISSION_DENIED: platform admin' using errcode = '42501'; end if;
  select jsonb_build_object(
    'totals', jsonb_build_object(
       'organizations', (select count(*) from public.organizations),
       'active', (select count(*) from public.organizations where status = 'active'),
       'suspended', (select count(*) from public.organizations where status = 'suspended'),
       'users', (select count(distinct user_id) from public.organization_users),
       'sales_30d', (select count(*) from public.sales where sold_at > now() - interval '30 days' and status = 'completed'),
       'gmv_30d', (select coalesce(sum(total), 0) from public.sales where sold_at > now() - interval '30 days' and status = 'completed')),
    'organizations', coalesce((select jsonb_agg(jsonb_build_object(
         'id', o.id, 'name', o.name, 'status', o.status, 'plan', o.plan, 'created_at', o.created_at,
         'members', (select count(*) from public.organization_users m where m.organization_id = o.id and m.status = 'active'),
         'outlets', (select count(*) from public.outlets x where x.organization_id = o.id),
         'sales_30d', (select count(*) from public.sales s where s.organization_id = o.id and s.sold_at > now() - interval '30 days'),
         'last_sale_at', (select max(sold_at) from public.sales s where s.organization_id = o.id)
       ) order by o.created_at desc) from public.organizations o), '[]'::jsonb))
    into result;
  return result;
end $$;

create or replace function public.admin_set_organization(p_org uuid, p_status text, p_plan text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'PERMISSION_DENIED: platform admin' using errcode = '42501'; end if;
  update public.organizations set status = coalesce(p_status, status), plan = coalesce(p_plan, plan) where id = p_org;
  insert into public.audit_logs (organization_id, user_id, action, entity, entity_id, details)
  values (p_org, auth.uid(), 'platform.organization_updated', 'organization', p_org,
          jsonb_build_object('status', p_status, 'plan', p_plan));
end $$;
