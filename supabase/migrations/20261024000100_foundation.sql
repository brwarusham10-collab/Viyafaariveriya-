-- VIYAFAARIVERIYAA · 0001 Foundation: tenancy, roles, locations, configuration, audit
-- All money: numeric(14,2). All quantities: numeric(14,3). Never float.

create extension if not exists pgcrypto;

create schema if not exists private;
comment on schema private is 'Internal helpers. Not exposed through the Data API.';

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.raise_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'IMMUTABLE_RECORD: % rows cannot be %', tg_table_name, lower(tg_op)
    using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- Platform level
-- ---------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  default_organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Organizations (tenants)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  legal_name text,
  tin text,                      -- MIRA taxpayer identification number
  gst_registration text,         -- GST registration number shown on invoices
  business_registration text,
  phone text,
  email text,
  address text,
  island text,
  atoll text,
  logo_path text,
  currency char(3) not null default 'MVR',
  timezone text not null default 'Indian/Maldives',
  prices_include_tax boolean not null default true,
  allow_negative_stock boolean not null default false,
  receipt_footer text,
  receipt_header text,
  locale text not null default 'en',
  status text not null default 'active' check (status in ('active','suspended','closed')),
  plan text not null default 'trial' check (plan in ('trial','starter','growth','enterprise')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_touch before update on public.organizations
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Permissions catalog and roles
-- ---------------------------------------------------------------------------
create table public.permissions (
  code text primary key,
  module text not null,
  description text not null
);

insert into public.permissions (code, module, description) values
  ('pos.sell',             'POS',        'Ring up sales at a register'),
  ('pos.discount',         'POS',        'Apply item and cart discounts'),
  ('pos.price_override',   'POS',        'Change a selling price at checkout'),
  ('pos.credit_sale',      'POS',        'Charge a sale to a customer account'),
  ('pos.refund',           'POS',        'Process returns and refunds'),
  ('pos.void',             'POS',        'Void a sale in the current shift'),
  ('pos.quotations',       'POS',        'Create and convert quotations'),
  ('sales.view',           'Sales',      'View sales history and invoices'),
  ('shifts.manage',        'Registers',  'Open and close register shifts'),
  ('shifts.approve',       'Registers',  'Approve closed shifts and variances'),
  ('cash.movements',       'Registers',  'Record cash in and cash out'),
  ('products.view',        'Products',   'View products and prices'),
  ('products.manage',      'Products',   'Create and edit products'),
  ('inventory.view',       'Inventory',  'View stock levels and movements'),
  ('inventory.adjust',     'Inventory',  'Adjust stock with a reason'),
  ('inventory.transfer',   'Inventory',  'Request, issue and receive transfers'),
  ('purchases.view',       'Purchases',  'View purchase orders and receipts'),
  ('purchases.manage',     'Purchases',  'Create purchase orders and receive goods'),
  ('purchases.approve',    'Purchases',  'Approve purchase orders'),
  ('suppliers.manage',     'Purchases',  'Manage suppliers'),
  ('customers.view',       'Customers',  'View customer records'),
  ('customers.manage',     'Customers',  'Create and edit customers'),
  ('customers.payments',   'Customers',  'Collect payments on customer accounts'),
  ('payments.verify',      'Payments',   'Verify or reject bank transfer payments'),
  ('expenses.view',        'Expenses',   'View expenses'),
  ('expenses.manage',      'Expenses',   'Record and edit expenses'),
  ('reports.view',         'Reports',    'View sales and inventory reports'),
  ('reports.financial',    'Reports',    'View cost, profit and tax reports'),
  ('staff.manage',         'Admin',      'Invite staff and assign roles'),
  ('settings.manage',      'Admin',      'Change business, outlet and register settings'),
  ('audit.view',           'Admin',      'View the audit log');

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  system_key text check (system_key in ('owner','admin','cashier','inventory','accountant')),
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);
create unique index roles_system_key_uq on public.roles(organization_id, system_key) where system_key is not null;

create or replace function private.validate_role_permissions() returns trigger
language plpgsql as $$
declare bad text;
begin
  select p into bad from unnest(new.permissions) p
   where p not in (select code from public.permissions) limit 1;
  if bad is not null then
    raise exception 'UNKNOWN_PERMISSION: %', bad using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.system_key = 'owner' and new.permissions is distinct from old.permissions then
    raise exception 'OWNER_ROLE_LOCKED' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger roles_validate before insert or update on public.roles
  for each row execute function private.validate_role_permissions();

-- ---------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------
create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null check (code ~ '^[A-Z0-9]{2,6}$'),
  address text,
  island text,
  phone text,
  default_warehouse_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outlet_id uuid,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, name),
  unique (organization_id, id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id)
);
alter table public.outlets
  add constraint outlets_default_wh_fk foreign key (organization_id, default_warehouse_id)
  references public.warehouses(organization_id, id) deferrable initially deferred;

create table public.registers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outlet_id uuid not null,
  name text not null,
  receipt_width text not null default '80mm' check (receipt_width in ('58mm','80mm','a4')),
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  unique (outlet_id, name),
  unique (organization_id, id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id)
);

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
create table public.organization_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null,
  outlet_ids uuid[],               -- null = all outlets
  display_name text,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id),
  foreign key (organization_id, role_id) references public.roles(organization_id, id)
);
create index organization_users_user_idx on public.organization_users(user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role_id uuid not null,
  outlet_ids uuid[],
  display_name text,
  token uuid not null default gen_random_uuid() unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid references auth.users(id),
  accepted_by uuid references auth.users(id),
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now(),
  foreign key (organization_id, role_id) references public.roles(organization_id, id)
);
create unique index invitations_pending_uq on public.invitations(organization_id, email) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Tax, payments, sequences
-- ---------------------------------------------------------------------------
create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  rate numeric(6,3) not null check (rate >= 0 and rate <= 100),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);
create unique index tax_rates_one_default on public.tax_rates(organization_id) where is_default;

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('cash','card','bank_transfer','store_credit','on_account','other')),
  requires_reference boolean not null default false,
  requires_verification boolean not null default false,
  allowed_offline boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.document_sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outlet_id uuid,
  doc_type text not null check (doc_type in ('sale','refund','quotation','purchase_order','goods_receipt','purchase_return','transfer','adjustment')),
  prefix text not null,
  next_number bigint not null default 1 check (next_number > 0),
  padding int not null default 6 check (padding between 1 and 12),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id)
);
create unique index document_sequences_uq on public.document_sequences
  (organization_id, coalesce(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid), doc_type);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid,
  action text not null,
  entity text,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_org_time_idx on public.audit_logs(organization_id, created_at desc);
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function private.raise_immutable();

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so RLS policies can call them
-- without recursive policy evaluation). They always derive the caller from auth.uid().
-- ---------------------------------------------------------------------------
create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create or replace function private.member_role(p_org uuid)
returns table (role_id uuid, system_key text, permissions text[], outlet_ids uuid[])
language sql stable security definer set search_path = '' as $$
  select r.id, r.system_key, r.permissions, m.outlet_ids
    from public.organization_users m
    join public.roles r on r.id = m.role_id
    join public.organizations o on o.id = m.organization_id
   where m.organization_id = p_org
     and m.user_id = auth.uid()
     and m.status = 'active'
     and o.status <> 'closed';
$$;

create or replace function private.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.member_role(p_org));
$$;

create or replace function private.has_perm(p_org uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select mr.system_key = 'owner' or p_perm = any(mr.permissions)
                     from private.member_role(p_org) mr), false);
$$;

create or replace function private.require_perm(p_org uuid, p_perm text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not private.has_perm(p_org, p_perm) then
    raise exception 'PERMISSION_DENIED: %', p_perm using errcode = '42501';
  end if;
  if exists (select 1 from public.organizations where id = p_org and status = 'suspended')
     and p_perm not in ('sales.view','reports.view','reports.financial','settings.manage','audit.view') then
    raise exception 'ORGANIZATION_SUSPENDED' using errcode = '42501';
  end if;
end $$;

create or replace function private.can_access_outlet(p_org uuid, p_outlet uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select mr.system_key = 'owner' or mr.outlet_ids is null or p_outlet = any(mr.outlet_ids)
                     from private.member_role(p_org) mr), false);
$$;

create or replace function private.require_outlet(p_org uuid, p_outlet uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_access_outlet(p_org, p_outlet) then
    raise exception 'OUTLET_ACCESS_DENIED' using errcode = '42501';
  end if;
end $$;

-- outlet ids the caller may see; null = all
create or replace function private.allowed_outlets(p_org uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case when mr.system_key = 'owner' then null else mr.outlet_ids end
    from private.member_role(p_org) mr;
$$;

create or replace function private.audit(p_org uuid, p_action text, p_entity text, p_entity_id uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (organization_id, user_id, action, entity, entity_id, details)
  values (p_org, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- Next document number. Locks the sequence row for the duration of the transaction,
-- so numbers are gap-free per (org, outlet, type) for committed transactions.
create or replace function private.next_document_number(p_org uuid, p_outlet uuid, p_type text)
returns text language plpgsql security definer set search_path = '' as $$
declare seq public.document_sequences%rowtype;
begin
  select * into seq from public.document_sequences
   where organization_id = p_org and doc_type = p_type
     and coalesce(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_outlet, '00000000-0000-0000-0000-000000000000'::uuid)
   for update;
  if not found then
    -- fall back to the organization-wide sequence for this type
    select * into seq from public.document_sequences
     where organization_id = p_org and doc_type = p_type and outlet_id is null
     for update;
  end if;
  if not found then
    insert into public.document_sequences (organization_id, outlet_id, doc_type, prefix)
    values (p_org, p_outlet, p_type, upper(left(p_type, 3)) || '-')
    returning * into seq;
  end if;
  update public.document_sequences set next_number = next_number + 1 where id = seq.id;
  return seq.prefix || lpad(seq.next_number::text, seq.padding, '0');
end $$;

-- Self-service helpers exposed to the client
create or replace function public.my_memberships()
returns table (organization_id uuid, organization_name text, organization_status text,
               role_id uuid, role_name text, system_key text, permissions text[], outlet_ids uuid[])
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.status, r.id, r.name, r.system_key,
         case when r.system_key = 'owner' then (select array_agg(code order by code) from public.permissions)
              else r.permissions end,
         m.outlet_ids
    from public.organization_users m
    join public.organizations o on o.id = m.organization_id
    join public.roles r on r.id = m.role_id
   where m.user_id = auth.uid() and m.status = 'active' and o.status <> 'closed'
   order by o.name;
$$;

create or replace function public.am_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin();
$$;
