-- VIYAFAARIVERIYAA: all migrations in order, for pasting into the Supabase SQL editor on a NEW project.
-- Generated from supabase/migrations. Do not edit by hand; prefer 'supabase db push' when the CLI is available.

-- ==== 20261024000100_foundation.sql ====
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

-- ==== 20261024000200_catalog_inventory.sql ====
-- VIYAFAARIVERIYAA · 0002 Catalog, customers, suppliers, inventory ledger

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  parent_id uuid,
  color text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id),
  foreign key (organization_id, parent_id) references public.categories(organization_id, id)
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  abbreviation text not null,
  allow_decimal boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  category_id uuid,
  brand_id uuid,
  unit_id uuid,
  tax_rate_id uuid,                 -- null = organization default rate
  product_type text not null default 'standard' check (product_type in ('standard','service')),
  track_stock boolean not null default true,
  sold_by_weight boolean not null default false,
  is_favorite boolean not null default false,
  is_active boolean not null default true,
  image_path text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, category_id) references public.categories(organization_id, id),
  foreign key (organization_id, brand_id) references public.brands(organization_id, id),
  foreign key (organization_id, unit_id) references public.units(organization_id, id),
  foreign key (organization_id, tax_rate_id) references public.tax_rates(organization_id, id)
);
create index products_org_name_idx on public.products(organization_id, lower(name));
create index products_category_idx on public.products(organization_id, category_id);
create trigger products_touch before update on public.products
  for each row execute function private.touch_updated_at();

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  name text not null default 'Default',
  sku text,
  attributes jsonb not null default '{}',     -- e.g. {"Size":"L","Color":"Red"}
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),  -- last purchase cost
  retail_price numeric(14,2) not null check (retail_price >= 0),
  wholesale_price numeric(14,2) check (wholesale_price >= 0),
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  reorder_qty numeric(14,3) not null default 0 check (reorder_qty >= 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, product_id) references public.products(organization_id, id) on delete cascade
);
create unique index product_variants_sku_uq on public.product_variants(organization_id, lower(sku)) where sku is not null;
create index product_variants_product_idx on public.product_variants(product_id);
create trigger product_variants_touch before update on public.product_variants
  for each row execute function private.touch_updated_at();

create table public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant_id uuid not null,
  barcode text not null check (length(barcode) between 3 and 64),
  created_at timestamptz not null default now(),
  unique (organization_id, barcode),
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id) on delete cascade
);
create index product_barcodes_variant_idx on public.product_barcodes(variant_id);

create table public.outlet_prices (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outlet_id uuid not null,
  variant_id uuid not null,
  price numeric(14,2) not null check (price >= 0),
  primary key (outlet_id, variant_id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id) on delete cascade,
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customer_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  price_list text not null default 'retail' check (price_list in ('retail','wholesale')),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text,
  email text,
  address text,
  island text,
  tin text,
  customer_group_id uuid,
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  account_balance numeric(14,2) not null default 0,   -- amount the customer owes (maintained by RPCs only)
  store_credit numeric(14,2) not null default 0 check (store_credit >= 0),  -- maintained by RPCs only
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, customer_group_id) references public.customer_groups(organization_id, id)
);
create index customers_org_name_idx on public.customers(organization_id, lower(name));
create index customers_org_phone_idx on public.customers(organization_id, phone);
create trigger customers_touch before update on public.customers
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  email text,
  address text,
  tin text,
  payment_terms_days int not null default 0 check (payment_terms_days >= 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

-- ---------------------------------------------------------------------------
-- Inventory: balances are a cache of the movement ledger, written only by
-- private.post_movement() inside RPC transactions.
-- ---------------------------------------------------------------------------
create table public.inventory_balances (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid not null,
  variant_id uuid not null,
  qty numeric(14,3) not null default 0,
  avg_cost numeric(14,4) not null default 0 check (avg_cost >= 0),
  last_received_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (warehouse_id, variant_id),
  foreign key (organization_id, warehouse_id) references public.warehouses(organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create index inventory_balances_variant_idx on public.inventory_balances(organization_id, variant_id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid not null,
  variant_id uuid not null,
  movement_type text not null check (movement_type in
    ('opening','sale','refund','void','purchase_receipt','purchase_return','adjustment','transfer_out','transfer_in')),
  qty_change numeric(14,3) not null check (qty_change <> 0),
  unit_cost numeric(14,4) not null default 0,
  qty_after numeric(14,3) not null,
  avg_cost_after numeric(14,4) not null,
  reference_type text,
  reference_id uuid,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, warehouse_id) references public.warehouses(organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create index inventory_movements_org_time_idx on public.inventory_movements(organization_id, created_at desc);
create index inventory_movements_variant_idx on public.inventory_movements(variant_id, created_at desc);
create index inventory_movements_ref_idx on public.inventory_movements(reference_type, reference_id);
create trigger inventory_movements_immutable before update on public.inventory_movements
  for each row execute function private.raise_immutable();

-- Post one stock movement. Locks the balance row; refuses to go negative unless allowed.
-- Incoming movements with a cost update the weighted-average cost.
-- Returns the unit cost attributable to the movement (avg cost for outgoing stock).
create or replace function private.post_movement(
  p_org uuid, p_warehouse uuid, p_variant uuid, p_qty numeric, p_unit_cost numeric,
  p_type text, p_ref_type text, p_ref_id uuid, p_reason text, p_allow_negative boolean
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  bal public.inventory_balances%rowtype;
  new_qty numeric(14,3);
  new_avg numeric(14,4);
  cost numeric(14,4);
  base_qty numeric;
begin
  if p_qty = 0 then
    return 0;
  end if;

  insert into public.inventory_balances (organization_id, warehouse_id, variant_id)
  values (p_org, p_warehouse, p_variant)
  on conflict (warehouse_id, variant_id) do nothing;

  select * into bal from public.inventory_balances
   where warehouse_id = p_warehouse and variant_id = p_variant and organization_id = p_org
   for update;
  if not found then
    raise exception 'BALANCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  new_qty := bal.qty + p_qty;

  if p_qty < 0 then
    if new_qty < 0 and not p_allow_negative then
      raise exception 'INSUFFICIENT_STOCK'
        using errcode = 'P0001',
              detail = json_build_object('variant_id', p_variant, 'warehouse_id', p_warehouse,
                                         'available', bal.qty, 'requested', -p_qty)::text;
    end if;
    cost := coalesce(nullif(p_unit_cost, 0), bal.avg_cost);
    new_avg := bal.avg_cost;
  else
    cost := coalesce(p_unit_cost, bal.avg_cost);
    base_qty := greatest(bal.qty, 0);
    if base_qty + p_qty > 0 then
      new_avg := round((base_qty * bal.avg_cost + p_qty * cost) / (base_qty + p_qty), 4);
    else
      new_avg := cost;
    end if;
  end if;

  update public.inventory_balances
     set qty = new_qty, avg_cost = greatest(new_avg, 0), updated_at = now(),
         last_received_at = case when p_type in ('purchase_receipt','opening','transfer_in') then now() else last_received_at end
   where warehouse_id = p_warehouse and variant_id = p_variant;

  insert into public.inventory_movements
    (organization_id, warehouse_id, variant_id, movement_type, qty_change, unit_cost,
     qty_after, avg_cost_after, reference_type, reference_id, reason, created_by)
  values
    (p_org, p_warehouse, p_variant, p_type, p_qty, cost, new_qty, greatest(new_avg, 0),
     p_ref_type, p_ref_id, p_reason, auth.uid());

  return cost;
end $$;

-- Stock adjustments (documented, reason-coded)
create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  adjustment_number text not null,
  client_uuid uuid not null,
  warehouse_id uuid not null,
  reason_code text not null check (reason_code in ('opening','count_correction','damage','theft','expired','internal_use','found','other')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, client_uuid),
  unique (organization_id, adjustment_number),
  foreign key (organization_id, warehouse_id) references public.warehouses(organization_id, id)
);

create table public.stock_adjustment_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  adjustment_id uuid not null references public.stock_adjustments(id) on delete cascade,
  variant_id uuid not null,
  qty_change numeric(14,3) not null check (qty_change <> 0),
  unit_cost numeric(14,4) not null,
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create index stock_adjustment_items_adj_idx on public.stock_adjustment_items(adjustment_id);

-- ---------------------------------------------------------------------------
-- Catalog RPCs
-- ---------------------------------------------------------------------------

-- Create a product with variants, barcodes and optional opening stock in one transaction.
-- payload: {organization_id, name, description, category_id, brand_id, unit_id, tax_rate_id,
--           product_type, track_stock, sold_by_weight, is_favorite,
--           variants:[{name, sku, attributes, cost_price, retail_price, wholesale_price,
--                      min_stock, reorder_qty, barcodes:[..],
--                      opening_stock:[{warehouse_id, qty, unit_cost}]}]}
create or replace function public.create_product(payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (payload->>'organization_id')::uuid;
  v_product uuid;
  v_variant uuid;
  v jsonb;
  b text;
  s jsonb;
  v_allow_neg boolean;
  v_wh uuid;
begin
  perform private.require_perm(v_org, 'products.manage');
  if jsonb_array_length(coalesce(payload->'variants', '[]'::jsonb)) = 0 then
    raise exception 'VARIANT_REQUIRED' using errcode = '22023';
  end if;

  insert into public.products (organization_id, name, description, category_id, brand_id, unit_id,
                               tax_rate_id, product_type, track_stock, sold_by_weight, is_favorite,
                               image_path, created_by)
  values (v_org, trim(payload->>'name'), payload->>'description',
          nullif(payload->>'category_id','')::uuid, nullif(payload->>'brand_id','')::uuid,
          nullif(payload->>'unit_id','')::uuid, nullif(payload->>'tax_rate_id','')::uuid,
          coalesce(payload->>'product_type','standard'),
          coalesce((payload->>'track_stock')::boolean, (coalesce(payload->>'product_type','standard') = 'standard')),
          coalesce((payload->>'sold_by_weight')::boolean, false),
          coalesce((payload->>'is_favorite')::boolean, false),
          payload->>'image_path', auth.uid())
  returning id into v_product;

  for v in select * from jsonb_array_elements(payload->'variants') loop
    insert into public.product_variants (organization_id, product_id, name, sku, attributes,
                                         cost_price, retail_price, wholesale_price, min_stock, reorder_qty)
    values (v_org, v_product, coalesce(nullif(trim(v->>'name'),''), 'Default'), nullif(trim(v->>'sku'),''),
            coalesce(v->'attributes','{}'::jsonb),
            coalesce((v->>'cost_price')::numeric, 0), (v->>'retail_price')::numeric,
            nullif(v->>'wholesale_price','')::numeric,
            coalesce((v->>'min_stock')::numeric, 0), coalesce((v->>'reorder_qty')::numeric, 0))
    returning id into v_variant;

    for b in select jsonb_array_elements_text(coalesce(v->'barcodes','[]'::jsonb)) loop
      if length(trim(b)) > 0 then
        insert into public.product_barcodes (organization_id, variant_id, barcode) values (v_org, v_variant, trim(b));
      end if;
    end loop;

    for s in select * from jsonb_array_elements(coalesce(v->'opening_stock','[]'::jsonb)) loop
      if coalesce((s->>'qty')::numeric, 0) <> 0 then
        perform private.require_perm(v_org, 'inventory.adjust');
        v_wh := (s->>'warehouse_id')::uuid;
        if not exists (select 1 from public.warehouses where id = v_wh and organization_id = v_org) then
          raise exception 'WAREHOUSE_NOT_FOUND' using errcode = '22023';
        end if;
        perform private.post_movement(v_org, v_wh, v_variant, (s->>'qty')::numeric,
                 coalesce((s->>'unit_cost')::numeric, (v->>'cost_price')::numeric, 0),
                 'opening', 'product', v_product, 'Opening stock', false);
      end if;
    end loop;
  end loop;

  perform private.audit(v_org, 'product.created', 'product', v_product, jsonb_build_object('name', payload->>'name'));
  return v_product;
end $$;

-- Reason-coded stock adjustment. Idempotent on client_uuid.
-- payload: {organization_id, client_uuid, warehouse_id, reason_code, notes,
--           items:[{variant_id, qty_change, unit_cost?}]}
create or replace function public.adjust_stock(payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (payload->>'organization_id')::uuid;
  v_client uuid := (payload->>'client_uuid')::uuid;
  v_wh uuid := (payload->>'warehouse_id')::uuid;
  v_id uuid;
  v_no text;
  it record;
  v_cost numeric;
begin
  perform private.require_perm(v_org, 'inventory.adjust');
  perform pg_advisory_xact_lock(hashtextextended('adj:' || v_client::text, 0));
  select id into v_id from public.stock_adjustments where organization_id = v_org and client_uuid = v_client;
  if found then return v_id; end if;

  if not exists (select 1 from public.warehouses where id = v_wh and organization_id = v_org and is_active) then
    raise exception 'WAREHOUSE_NOT_FOUND' using errcode = '22023';
  end if;
  if coalesce(trim(payload->>'reason_code'), '') = '' then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  v_no := private.next_document_number(v_org, null, 'adjustment');
  insert into public.stock_adjustments (organization_id, adjustment_number, client_uuid, warehouse_id, reason_code, notes, created_by)
  values (v_org, v_no, v_client, v_wh, payload->>'reason_code', payload->>'notes', auth.uid())
  returning id into v_id;

  for it in
    select (x->>'variant_id')::uuid as variant_id, (x->>'qty_change')::numeric as qty,
           nullif(x->>'unit_cost','')::numeric as unit_cost
      from jsonb_array_elements(payload->'items') x
     order by (x->>'variant_id')
  loop
    if it.qty = 0 then continue; end if;
    if not exists (select 1 from public.product_variants pv join public.products p on p.id = pv.product_id
                    where pv.id = it.variant_id and pv.organization_id = v_org and p.track_stock) then
      raise exception 'VARIANT_NOT_STOCKED' using errcode = '22023';
    end if;
    v_cost := private.post_movement(v_org, v_wh, it.variant_id, it.qty, it.unit_cost, 'adjustment',
                                    'stock_adjustment', v_id, payload->>'reason_code', false);
    insert into public.stock_adjustment_items (organization_id, adjustment_id, variant_id, qty_change, unit_cost)
    values (v_org, v_id, it.variant_id, it.qty, v_cost);
  end loop;

  perform private.audit(v_org, 'stock.adjusted', 'stock_adjustment', v_id,
    jsonb_build_object('number', v_no, 'reason', payload->>'reason_code'));
  return v_id;
end $$;

-- ==== 20261024000300_sales_shifts.sql ====
-- VIYAFAARIVERIYAA · 0003 Shifts, sales, payments, refunds, quotations, customer ledger

-- ---------------------------------------------------------------------------
-- Shifts and cash management
-- ---------------------------------------------------------------------------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outlet_id uuid not null,
  register_id uuid not null,
  status text not null default 'open' check (status in ('open','closed','approved')),
  opening_float numeric(14,2) not null default 0 check (opening_float >= 0),
  opened_by uuid not null references auth.users(id),
  opened_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  expected_cash numeric(14,2),
  counted_cash numeric(14,2),
  variance numeric(14,2),
  denominations jsonb,
  close_note text,
  summary jsonb,               -- Z report snapshot taken at close
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_note text,
  unique (organization_id, id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, register_id) references public.registers(organization_id, id)
);
create unique index shifts_one_open_per_register on public.shifts(register_id) where status = 'open';
create index shifts_org_opened_idx on public.shifts(organization_id, opened_at desc);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null,
  kind text not null check (kind in ('cash_in','cash_out')),
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) > 0),
  client_uuid uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, client_uuid),
  foreign key (organization_id, shift_id) references public.shifts(organization_id, id)
);
create index cash_movements_shift_idx on public.cash_movements(shift_id);
create trigger cash_movements_immutable before update or delete on public.cash_movements
  for each row execute function private.raise_immutable();

-- ---------------------------------------------------------------------------
-- Quotations and parked bills
-- ---------------------------------------------------------------------------
create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outlet_id uuid not null,
  quote_number text not null,
  customer_id uuid,
  status text not null default 'draft' check (status in ('draft','sent','accepted','converted','expired','cancelled')),
  valid_until date,
  cart_discount jsonb,
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  notes text,
  converted_sale_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, quote_number),
  unique (organization_id, id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id)
);
create trigger quotations_touch before update on public.quotations
  for each row execute function private.touch_updated_at();

create table public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  line_no int not null,
  variant_id uuid not null,
  name text not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null,
  discount_type text check (discount_type in ('percent','fixed')),
  discount_value numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null,
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create index quotation_items_q_idx on public.quotation_items(quotation_id);

create table public.held_bills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outlet_id uuid not null,
  register_id uuid,
  label text not null,
  cart jsonb not null,
  customer_id uuid,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, register_id) references public.registers(organization_id, id)
);
create index held_bills_outlet_idx on public.held_bills(organization_id, outlet_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outlet_id uuid not null,
  register_id uuid not null,
  shift_id uuid not null,
  warehouse_id uuid not null,
  invoice_number text not null,
  client_uuid uuid not null,
  customer_id uuid,
  cashier_id uuid not null references auth.users(id),
  quotation_id uuid,
  status text not null default 'completed' check (status in ('completed','voided')),
  payment_status text not null default 'paid'
    check (payment_status in ('paid','pending_verification','on_account','payment_rejected')),
  prices_include_tax boolean not null,
  currency char(3) not null default 'MVR',
  subtotal numeric(14,2) not null,          -- sum of line gross (qty x unit price), price basis
  discount_total numeric(14,2) not null,    -- item + cart discounts, price basis
  tax_total numeric(14,2) not null,
  total numeric(14,2) not null check (total >= 0),   -- amount payable
  amount_paid numeric(14,2) not null default 0,       -- settled at the counter (excl. account)
  balance_due numeric(14,2) not null default 0,       -- charged to customer account
  change_given numeric(14,2) not null default 0,
  cart_discount jsonb,
  notes text,
  is_offline boolean not null default false,
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, client_uuid),
  unique (organization_id, invoice_number),
  unique (organization_id, id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, register_id) references public.registers(organization_id, id),
  foreign key (organization_id, shift_id) references public.shifts(organization_id, id),
  foreign key (organization_id, warehouse_id) references public.warehouses(organization_id, id),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id),
  foreign key (organization_id, quotation_id) references public.quotations(organization_id, id)
);
create index sales_org_sold_idx on public.sales(organization_id, sold_at desc);
create index sales_outlet_sold_idx on public.sales(outlet_id, sold_at desc);
create index sales_shift_idx on public.sales(shift_id);
create index sales_customer_idx on public.sales(customer_id, sold_at desc);
create index sales_cashier_idx on public.sales(organization_id, cashier_id, sold_at desc);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null,
  line_no int not null,
  variant_id uuid not null,
  product_id uuid not null,
  name text not null,
  sku text,
  qty numeric(14,3) not null check (qty > 0),
  list_price numeric(14,2) not null,
  unit_price numeric(14,2) not null,
  price_overridden boolean not null default false,
  discount_type text check (discount_type in ('percent','fixed')),
  discount_value numeric(14,2) not null default 0,
  line_discount numeric(14,2) not null default 0,
  cart_discount_alloc numeric(14,2) not null default 0,
  tax_rate numeric(6,3) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null,
  unit_cost numeric(14,4) not null default 0,     -- weighted-average cost snapshot at sale time
  cost_total numeric(14,2) not null default 0,
  track_stock boolean not null,
  qty_refunded numeric(14,3) not null default 0,
  amount_refunded numeric(14,2) not null default 0,
  tax_refunded numeric(14,2) not null default 0,
  unique (sale_id, line_no),
  foreign key (organization_id, sale_id) references public.sales(organization_id, id) on delete cascade,
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create index sale_items_variant_idx on public.sale_items(variant_id);
create index sale_items_sale_idx on public.sale_items(sale_id);

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null,
  outlet_id uuid not null,
  shift_id uuid,
  refund_number text not null,
  client_uuid uuid not null,
  kind text not null default 'refund' check (kind in ('refund','void')),
  reason text not null check (length(trim(reason)) > 0),
  restock boolean not null,
  subtotal numeric(14,2) not null,     -- refund amount excl. tax
  tax_total numeric(14,2) not null,
  total numeric(14,2) not null check (total >= 0),
  cost_total numeric(14,2) not null default 0,  -- cost returned to stock (restocked lines only)
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, client_uuid),
  unique (organization_id, refund_number),
  unique (organization_id, id),
  foreign key (organization_id, sale_id) references public.sales(organization_id, id),
  foreign key (organization_id, shift_id) references public.shifts(organization_id, id)
);
create index refunds_org_time_idx on public.refunds(organization_id, created_at desc);
create index refunds_sale_idx on public.refunds(sale_id);

create table public.refund_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  refund_id uuid not null references public.refunds(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id),
  variant_id uuid not null,
  qty numeric(14,3) not null check (qty > 0),
  amount numeric(14,2) not null,
  tax_amount numeric(14,2) not null,
  unit_cost numeric(14,4) not null,
  restocked boolean not null
);
create index refund_items_refund_idx on public.refund_items(refund_id);

-- ---------------------------------------------------------------------------
-- Payments (sales tenders, refund payouts, account collections)
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid,
  refund_id uuid references public.refunds(id),
  customer_id uuid,
  shift_id uuid,
  payment_method_id uuid not null,
  method_kind text not null,
  method_name text not null,
  direction text not null default 'in' check (direction in ('in','out')),
  amount numeric(14,2) not null check (amount > 0),
  tendered numeric(14,2),
  reference text,
  status text not null default 'completed' check (status in ('completed','pending','rejected')),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  verification_note text,
  client_uuid uuid,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, client_uuid),
  foreign key (organization_id, sale_id) references public.sales(organization_id, id),
  foreign key (organization_id, shift_id) references public.shifts(organization_id, id),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id),
  foreign key (organization_id, payment_method_id) references public.payment_methods(organization_id, id)
);
create index payments_sale_idx on public.payments(sale_id);
create index payments_shift_idx on public.payments(shift_id);
create index payments_org_time_idx on public.payments(organization_id, created_at desc);
create index payments_pending_idx on public.payments(organization_id) where status = 'pending';

-- Only verification columns may change on a payment; nothing may be deleted.
create or replace function private.guard_payment_update() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_RECORD: payments cannot be deleted' using errcode = '42501';
  end if;
  if (new.amount, new.method_kind, new.direction, new.sale_id, new.refund_id, new.customer_id, new.shift_id, new.payment_method_id)
     is distinct from (old.amount, old.method_kind, old.direction, old.sale_id, old.refund_id, old.customer_id, old.shift_id, old.payment_method_id) then
    raise exception 'IMMUTABLE_RECORD: payment financial fields cannot change' using errcode = '42501';
  end if;
  if old.status <> 'pending' then
    raise exception 'IMMUTABLE_RECORD: payment already %', old.status using errcode = '42501';
  end if;
  return new;
end $$;
create trigger payments_guard before update or delete on public.payments
  for each row execute function private.guard_payment_update();

-- ---------------------------------------------------------------------------
-- Customer ledger (account balance and store credit history)
-- ---------------------------------------------------------------------------
create table public.customer_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  entry_type text not null check (entry_type in
    ('sale_on_account','account_payment','refund_to_account','store_credit_issued','store_credit_used','void_reversal','adjustment')),
  account_delta numeric(14,2) not null default 0,   -- + increases amount owed
  credit_delta numeric(14,2) not null default 0,    -- + increases store credit
  account_balance_after numeric(14,2) not null,
  store_credit_after numeric(14,2) not null,
  sale_id uuid,
  refund_id uuid,
  payment_id uuid,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id)
);
create index customer_ledger_customer_idx on public.customer_ledger(customer_id, created_at);
create trigger customer_ledger_immutable before update or delete on public.customer_ledger
  for each row execute function private.raise_immutable();

create or replace function private.post_customer_ledger(
  p_org uuid, p_customer uuid, p_type text, p_account numeric, p_credit numeric,
  p_sale uuid, p_refund uuid, p_payment uuid, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare c public.customers%rowtype;
begin
  select * into c from public.customers where id = p_customer and organization_id = p_org for update;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = '22023';
  end if;
  if c.store_credit + p_credit < 0 then
    raise exception 'INSUFFICIENT_STORE_CREDIT' using errcode = 'P0001',
      detail = json_build_object('available', c.store_credit)::text;
  end if;
  update public.customers
     set account_balance = account_balance + p_account,
         store_credit = store_credit + p_credit
   where id = p_customer;
  insert into public.customer_ledger (organization_id, customer_id, entry_type, account_delta, credit_delta,
                                      account_balance_after, store_credit_after, sale_id, refund_id, payment_id, note, created_by)
  values (p_org, p_customer, p_type, p_account, p_credit, c.account_balance + p_account, c.store_credit + p_credit,
          p_sale, p_refund, p_payment, p_note, auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- Pricing engine. Single source of truth for totals; mirrored in src/lib/pricing.ts
-- for instant previews. Rounding: round(x, 2) = half away from zero, per line.
-- ---------------------------------------------------------------------------
create or replace function private.resolve_price(p_org uuid, p_outlet uuid, p_variant uuid, p_customer uuid)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  v public.product_variants%rowtype;
  base numeric(14,2);
  grp public.customer_groups%rowtype;
begin
  select * into v from public.product_variants where id = p_variant and organization_id = p_org;
  if not found then return null; end if;
  select price into base from public.outlet_prices where outlet_id = p_outlet and variant_id = p_variant;
  base := coalesce(base, v.retail_price);
  if p_customer is not null then
    select g.* into grp from public.customers c join public.customer_groups g on g.id = c.customer_group_id
     where c.id = p_customer and c.organization_id = p_org;
    if found then
      if grp.price_list = 'wholesale' and v.wholesale_price is not null then
        base := v.wholesale_price;
      end if;
      if grp.discount_percent > 0 then
        base := round(base * (1 - grp.discount_percent / 100), 2);
      end if;
    end if;
  end if;
  return base;
end $$;

-- p_items: [{variant_id, qty, unit_price?, discount_type?, discount_value?}]
-- p_cart_discount: {type:'percent'|'fixed', value}
create or replace function private.compute_cart(
  p_org uuid, p_outlet uuid, p_customer uuid, p_items jsonb, p_cart_discount jsonb,
  p_allow_override boolean, p_allow_discount boolean
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  inclusive boolean;
  default_rate numeric;
  it record;
  r record;
  lines jsonb := '[]'::jsonb;
  ln jsonb;
  list_price numeric(14,2);
  unit_price numeric(14,2);
  gross numeric(14,2);
  disc numeric(14,2);
  dtype text;
  dval numeric;
  rate numeric;
  base_total numeric(14,2) := 0;
  cart_disc numeric(14,2) := 0;
  allocated numeric(14,2) := 0;
  last_idx int := -1;
  i int;
  alloc numeric(14,2);
  amount numeric(14,2);
  tax numeric(14,2);
  subtotal numeric(14,2) := 0;
  disc_total numeric(14,2) := 0;
  tax_total numeric(14,2) := 0;
  grand numeric(14,2) := 0;
  ctype text;
  cval numeric;
  n int;
begin
  select prices_include_tax into inclusive from public.organizations where id = p_org;
  select t.rate into default_rate from public.tax_rates t where t.organization_id = p_org and t.is_default and t.is_active;
  n := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if n = 0 then
    raise exception 'EMPTY_CART' using errcode = '22023';
  end if;
  if n > 500 then
    raise exception 'CART_TOO_LARGE' using errcode = '22023';
  end if;

  for it in select x, ord from jsonb_array_elements(p_items) with ordinality as e(x, ord) loop
    select pv.id, pv.name as vname, pv.sku, p.id as product_id, p.name as pname, p.track_stock,
           p.sold_by_weight, coalesce(u.allow_decimal, false) as allow_decimal,
           tr.rate as prate, tr.is_active as prate_active, p.is_active and pv.is_active as active
      into r
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      left join public.units u on u.id = p.unit_id
      left join public.tax_rates tr on tr.id = p.tax_rate_id
     where pv.id = (it.x->>'variant_id')::uuid and pv.organization_id = p_org;
    if not found then
      raise exception 'VARIANT_NOT_FOUND' using errcode = '22023', detail = it.x->>'variant_id';
    end if;
    if not r.active then
      raise exception 'VARIANT_INACTIVE' using errcode = '22023', detail = it.x->>'variant_id';
    end if;
    if (it.x->>'qty')::numeric is null or (it.x->>'qty')::numeric <= 0 then
      raise exception 'INVALID_QTY' using errcode = '22023';
    end if;
    if not (r.sold_by_weight or r.allow_decimal) and (it.x->>'qty')::numeric <> trunc((it.x->>'qty')::numeric) then
      raise exception 'QTY_MUST_BE_WHOLE' using errcode = '22023', detail = r.pname;
    end if;

    list_price := private.resolve_price(p_org, p_outlet, r.id, p_customer);
    unit_price := coalesce(nullif(it.x->>'unit_price','')::numeric, list_price);
    if unit_price < 0 then
      raise exception 'INVALID_PRICE' using errcode = '22023';
    end if;
    if unit_price <> list_price and not p_allow_override then
      raise exception 'PERMISSION_DENIED: pos.price_override' using errcode = '42501';
    end if;

    gross := round((it.x->>'qty')::numeric * unit_price, 2);
    dtype := nullif(it.x->>'discount_type', '');
    dval := coalesce(nullif(it.x->>'discount_value','')::numeric, 0);
    if dval < 0 then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;
    if dtype = 'percent' then
      if dval > 100 then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;
      disc := round(gross * dval / 100, 2);
    elsif dtype = 'fixed' then
      disc := least(round(dval, 2), gross);
    else
      disc := 0; dtype := null; dval := 0;
    end if;
    if disc > 0 and not p_allow_discount then
      raise exception 'PERMISSION_DENIED: pos.discount' using errcode = '42501';
    end if;

    rate := case when r.prate is not null and r.prate_active then r.prate
                 when r.prate is not null then 0
                 else coalesce(default_rate, 0) end;

    lines := lines || jsonb_build_object(
      'line_no', it.ord, 'variant_id', r.id, 'product_id', r.product_id,
      'name', case when r.vname = 'Default' then r.pname else r.pname || ' · ' || r.vname end,
      'sku', r.sku, 'qty', (it.x->>'qty')::numeric, 'list_price', list_price, 'unit_price', unit_price,
      'price_overridden', unit_price <> list_price, 'discount_type', dtype, 'discount_value', dval,
      'gross', gross, 'line_discount', disc, 'after_item', gross - disc, 'tax_rate', rate,
      'track_stock', r.track_stock);
    base_total := base_total + gross - disc;
  end loop;

  ctype := nullif(p_cart_discount->>'type', '');
  cval := coalesce(nullif(p_cart_discount->>'value','')::numeric, 0);
  if cval < 0 then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;
  if ctype = 'percent' then
    if cval > 100 then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;
    cart_disc := round(base_total * cval / 100, 2);
  elsif ctype = 'fixed' then
    cart_disc := least(round(cval, 2), base_total);
  end if;
  if cart_disc > 0 and not p_allow_discount then
    raise exception 'PERMISSION_DENIED: pos.discount' using errcode = '42501';
  end if;

  -- last line with a positive base receives the rounding remainder
  for i in 0 .. jsonb_array_length(lines) - 1 loop
    if (lines->i->>'after_item')::numeric > 0 then last_idx := i; end if;
  end loop;

  for i in 0 .. jsonb_array_length(lines) - 1 loop
    ln := lines->i;
    if cart_disc > 0 and (ln->>'after_item')::numeric > 0 then
      if i = last_idx then
        alloc := cart_disc - allocated;
      else
        alloc := round(cart_disc * (ln->>'after_item')::numeric / base_total, 2);
      end if;
    else
      alloc := 0;
    end if;
    allocated := allocated + alloc;
    amount := (ln->>'after_item')::numeric - alloc;
    rate := (ln->>'tax_rate')::numeric;
    if inclusive then
      tax := round(amount * rate / (100 + rate), 2);
    else
      tax := round(amount * rate / 100, 2);
    end if;
    ln := ln || jsonb_build_object('cart_discount_alloc', alloc, 'tax_amount', tax,
                                   'line_total', case when inclusive then amount else amount + tax end);
    lines := jsonb_set(lines, array[i::text], ln);
    subtotal := subtotal + (ln->>'gross')::numeric;
    disc_total := disc_total + (ln->>'line_discount')::numeric + alloc;
    tax_total := tax_total + tax;
    grand := grand + (ln->>'line_total')::numeric;
  end loop;

  return jsonb_build_object('lines', lines, 'prices_include_tax', inclusive,
    'subtotal', subtotal, 'discount_total', disc_total, 'cart_discount', cart_disc,
    'tax_total', tax_total, 'total', grand);
end $$;

-- Preview for quotations/tests (permission-checked; never persisted)
create or replace function public.price_cart(p_org uuid, p_outlet uuid, p_customer uuid, p_items jsonb, p_cart_discount jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_perm(p_org, 'products.view');
  return private.compute_cart(p_org, p_outlet, p_customer, p_items, p_cart_discount,
    private.has_perm(p_org, 'pos.price_override'), private.has_perm(p_org, 'pos.discount'));
end $$;

-- ---------------------------------------------------------------------------
-- Shift RPCs
-- ---------------------------------------------------------------------------
create or replace function public.open_shift(p_register uuid, p_opening_float numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare reg public.registers%rowtype; v_id uuid;
begin
  select * into reg from public.registers where id = p_register;
  if not found or not reg.is_active then
    raise exception 'REGISTER_NOT_FOUND' using errcode = '22023';
  end if;
  perform private.require_perm(reg.organization_id, 'shifts.manage');
  perform private.require_outlet(reg.organization_id, reg.outlet_id);
  if coalesce(p_opening_float, 0) < 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  begin
    insert into public.shifts (organization_id, outlet_id, register_id, opening_float, opened_by)
    values (reg.organization_id, reg.outlet_id, reg.id, round(coalesce(p_opening_float, 0), 2), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'SHIFT_ALREADY_OPEN' using errcode = 'P0001';
  end;
  perform private.audit(reg.organization_id, 'shift.opened', 'shift', v_id, jsonb_build_object('opening_float', p_opening_float));
  return v_id;
end $$;

create or replace function public.add_cash_movement(p_shift uuid, p_kind text, p_amount numeric, p_reason text, p_client_uuid uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.shifts%rowtype; v_id uuid;
begin
  select * into s from public.shifts where id = p_shift;
  if not found then raise exception 'SHIFT_NOT_FOUND' using errcode = '22023'; end if;
  perform private.require_perm(s.organization_id, 'cash.movements');
  perform private.require_outlet(s.organization_id, s.outlet_id);
  select id into v_id from public.cash_movements where organization_id = s.organization_id and client_uuid = p_client_uuid;
  if found then return v_id; end if;
  if s.status <> 'open' then raise exception 'SHIFT_CLOSED' using errcode = 'P0001'; end if;
  if p_kind not in ('cash_in','cash_out') then raise exception 'INVALID_KIND' using errcode = '22023'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  insert into public.cash_movements (organization_id, shift_id, kind, amount, reason, client_uuid, created_by)
  values (s.organization_id, s.id, p_kind, round(p_amount, 2), trim(p_reason), p_client_uuid, auth.uid())
  returning id into v_id;
  perform private.audit(s.organization_id, 'cash.' || p_kind, 'shift', s.id, jsonb_build_object('amount', p_amount, 'reason', p_reason));
  return v_id;
end $$;

-- X report (any time) / data for Z report.
create or replace function private.shift_totals(p_shift uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.shifts%rowtype;
  cash_in numeric(14,2); cash_out numeric(14,2);
  cash_pay_in numeric(14,2); cash_pay_out numeric(14,2);
  methods jsonb; sales jsonb; refunds jsonb;
begin
  select * into s from public.shifts where id = p_shift;
  select coalesce(sum(amount) filter (where kind = 'cash_in'), 0), coalesce(sum(amount) filter (where kind = 'cash_out'), 0)
    into cash_in, cash_out from public.cash_movements where shift_id = p_shift;
  select coalesce(sum(amount) filter (where direction = 'in'), 0), coalesce(sum(amount) filter (where direction = 'out'), 0)
    into cash_pay_in, cash_pay_out
    from public.payments where shift_id = p_shift and method_kind = 'cash' and status = 'completed';
  select coalesce(jsonb_agg(m order by m->>'method'), '[]'::jsonb) into methods from (
    select jsonb_build_object('method', method_name, 'kind', method_kind,
             'in', coalesce(sum(amount) filter (where direction = 'in' and status = 'completed'), 0),
             'out', coalesce(sum(amount) filter (where direction = 'out' and status = 'completed'), 0),
             'pending', coalesce(sum(amount) filter (where status = 'pending'), 0),
             'count', count(*)) as m
      from public.payments where shift_id = p_shift group by method_name, method_kind) t;
  select jsonb_build_object(
      'count', count(*) filter (where status = 'completed'),
      'voided_count', count(*) filter (where status = 'voided'),
      'total', coalesce(sum(total) filter (where status = 'completed'), 0),
      'tax', coalesce(sum(tax_total) filter (where status = 'completed'), 0),
      'discounts', coalesce(sum(discount_total) filter (where status = 'completed'), 0),
      'on_account', coalesce(sum(balance_due) filter (where status = 'completed'), 0))
    into sales from public.sales where shift_id = p_shift;
  select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0))
    into refunds from public.refunds where shift_id = p_shift and kind = 'refund';
  return jsonb_build_object(
    'shift_id', s.id, 'status', s.status, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'opening_float', s.opening_float, 'cash_in', cash_in, 'cash_out', cash_out,
    'cash_payments_in', cash_pay_in, 'cash_payments_out', cash_pay_out,
    'expected_cash', s.opening_float + cash_pay_in - cash_pay_out + cash_in - cash_out,
    'payment_methods', methods, 'sales', sales, 'refunds', refunds);
end $$;

create or replace function public.shift_report(p_shift uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.shifts%rowtype;
begin
  select * into s from public.shifts where id = p_shift;
  if not found then raise exception 'SHIFT_NOT_FOUND' using errcode = '22023'; end if;
  if not (private.has_perm(s.organization_id, 'shifts.manage') or private.has_perm(s.organization_id, 'shifts.approve')
          or private.has_perm(s.organization_id, 'reports.view')) then
    raise exception 'PERMISSION_DENIED: shifts.manage' using errcode = '42501';
  end if;
  perform private.require_outlet(s.organization_id, s.outlet_id);
  if s.status <> 'open' and s.summary is not null then
    return s.summary || jsonb_build_object('status', s.status, 'counted_cash', s.counted_cash, 'variance', s.variance,
      'denominations', s.denominations, 'approved_at', s.approved_at, 'close_note', s.close_note);
  end if;
  return private.shift_totals(p_shift);
end $$;

-- p_denominations: {"1000": 2, "500": 3, ..., "0.25": 4}
create or replace function public.close_shift(p_shift uuid, p_denominations jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts%rowtype;
  totals jsonb;
  counted numeric(14,2) := 0;
  k text; v text;
begin
  select * into s from public.shifts where id = p_shift for update;
  if not found then raise exception 'SHIFT_NOT_FOUND' using errcode = '22023'; end if;
  perform private.require_perm(s.organization_id, 'shifts.manage');
  perform private.require_outlet(s.organization_id, s.outlet_id);
  if s.status <> 'open' then raise exception 'SHIFT_CLOSED' using errcode = 'P0001'; end if;
  if s.opened_by <> auth.uid() and not private.has_perm(s.organization_id, 'shifts.approve') then
    raise exception 'PERMISSION_DENIED: shifts.approve' using errcode = '42501';
  end if;
  for k, v in select * from jsonb_each_text(coalesce(p_denominations, '{}'::jsonb)) loop
    if k !~ '^[0-9]+(\.[0-9]{1,2})?$' or v !~ '^[0-9]+$' then
      raise exception 'INVALID_DENOMINATION' using errcode = '22023', detail = k;
    end if;
    counted := counted + k::numeric * v::int;
  end loop;
  totals := private.shift_totals(p_shift);
  update public.shifts
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         expected_cash = (totals->>'expected_cash')::numeric, counted_cash = counted,
         variance = counted - (totals->>'expected_cash')::numeric,
         denominations = p_denominations, close_note = p_note,
         summary = totals || jsonb_build_object('closed_at', now())
   where id = p_shift;
  perform private.audit(s.organization_id, 'shift.closed', 'shift', s.id,
    jsonb_build_object('expected', totals->'expected_cash', 'counted', counted));
  return public.shift_report(p_shift);
end $$;

create or replace function public.approve_shift(p_shift uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.shifts%rowtype;
begin
  select * into s from public.shifts where id = p_shift for update;
  if not found then raise exception 'SHIFT_NOT_FOUND' using errcode = '22023'; end if;
  perform private.require_perm(s.organization_id, 'shifts.approve');
  if s.status <> 'closed' then raise exception 'SHIFT_NOT_CLOSED' using errcode = 'P0001'; end if;
  update public.shifts set status = 'approved', approved_by = auth.uid(), approved_at = now(), approval_note = p_note
   where id = p_shift;
  perform private.audit(s.organization_id, 'shift.approved', 'shift', s.id, jsonb_build_object('variance', s.variance, 'note', p_note));
end $$;

-- Closed shifts are frozen except for the approval step.
create or replace function private.guard_shift_update() returns trigger
language plpgsql as $$
begin
  if old.status = 'approved' then
    raise exception 'IMMUTABLE_RECORD: approved shift' using errcode = '42501';
  end if;
  if old.status = 'closed' and (new.status <> 'approved'
      or (new.counted_cash, new.expected_cash, new.variance, new.denominations, new.summary, new.opening_float)
         is distinct from (old.counted_cash, old.expected_cash, old.variance, old.denominations, old.summary, old.opening_float)) then
    raise exception 'IMMUTABLE_RECORD: closed shift' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger shifts_guard before update on public.shifts
  for each row execute function private.guard_shift_update();
create trigger shifts_no_delete before delete on public.shifts
  for each row execute function private.raise_immutable();

-- ---------------------------------------------------------------------------
-- Checkout. Atomic and idempotent on (organization_id, client_uuid).
-- payload: {
--   client_uuid, register_id, shift_id, customer_id?, quotation_id?, notes?,
--   items:[{variant_id, qty, unit_price?, discount_type?, discount_value?}],
--   cart_discount?:{type, value},
--   payments:[{payment_method_id, amount, reference?}],   -- cash amount = cash tendered
--   offline?:{created_at, force_negative_stock?}
-- }
-- ---------------------------------------------------------------------------
create or replace function public.pos_checkout(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := (payload->>'client_uuid')::uuid;
  reg public.registers%rowtype;
  sh public.shifts%rowtype;
  org public.organizations%rowtype;
  existing public.sales%rowtype;
  outlet public.outlets%rowtype;
  v_customer public.customers%rowtype;
  cart jsonb;
  ln jsonb;
  pay jsonb;
  pm public.payment_methods%rowtype;
  v_sale uuid := gen_random_uuid();
  v_invoice text;
  v_total numeric(14,2);
  noncash numeric(14,2) := 0;
  cash_tendered numeric(14,2) := 0;
  cash_needed numeric(14,2);
  cash_left numeric(14,2);
  applied numeric(14,2);
  v_change numeric(14,2) := 0;
  paid_counter numeric(14,2) := 0;
  on_account numeric(14,2) := 0;
  any_pending boolean := false;
  v_status text;
  v_cost numeric;
  v_wh uuid;
  allow_neg boolean;
  is_offline boolean := payload ? 'offline';
  v_sold_at timestamptz := now();
  v_payment uuid;
  stock record;
  costs jsonb := '{}'::jsonb;
  amt numeric(14,2);
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if v_client is null then raise exception 'CLIENT_UUID_REQUIRED' using errcode = '22023'; end if;

  select * into reg from public.registers where id = (payload->>'register_id')::uuid;
  if not found or not reg.is_active then raise exception 'REGISTER_NOT_FOUND' using errcode = '22023'; end if;
  perform private.require_perm(reg.organization_id, 'pos.sell');
  perform private.require_outlet(reg.organization_id, reg.outlet_id);

  -- Idempotency: serialize same-key requests, then replay if already committed.
  perform pg_advisory_xact_lock(hashtextextended('sale:' || reg.organization_id::text || v_client::text, 0));
  select * into existing from public.sales where organization_id = reg.organization_id and client_uuid = v_client;
  if found then
    return jsonb_build_object('sale_id', existing.id, 'invoice_number', existing.invoice_number,
      'total', existing.total, 'change_given', existing.change_given, 'replayed', true);
  end if;

  select * into org from public.organizations where id = reg.organization_id;
  select * into outlet from public.outlets where id = reg.outlet_id;
  v_wh := outlet.default_warehouse_id;
  if v_wh is null then raise exception 'OUTLET_HAS_NO_WAREHOUSE' using errcode = 'P0001'; end if;

  select * into sh from public.shifts where id = (payload->>'shift_id')::uuid and register_id = reg.id for share;
  if not found then raise exception 'SHIFT_NOT_FOUND' using errcode = '22023'; end if;
  if sh.status <> 'open' then raise exception 'SHIFT_CLOSED' using errcode = 'P0001'; end if;

  if nullif(payload->>'customer_id', '') is not null then
    select * into v_customer from public.customers
     where id = (payload->>'customer_id')::uuid and organization_id = org.id and is_active;
    if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode = '22023'; end if;
  end if;

  if is_offline then
    v_sold_at := least(coalesce((payload->'offline'->>'created_at')::timestamptz, now()), now());
  end if;

  cart := private.compute_cart(org.id, reg.outlet_id, v_customer.id, payload->'items', payload->'cart_discount',
            private.has_perm(org.id, 'pos.price_override'), private.has_perm(org.id, 'pos.discount'));
  v_total := (cart->>'total')::numeric;

  -- ---- Validate tenders -------------------------------------------------
  for pay in select * from jsonb_array_elements(coalesce(payload->'payments', '[]'::jsonb)) loop
    select * into pm from public.payment_methods
     where id = (pay->>'payment_method_id')::uuid and organization_id = org.id and is_active;
    if not found then raise exception 'PAYMENT_METHOD_NOT_FOUND' using errcode = '22023'; end if;
    amt := round((pay->>'amount')::numeric, 2);
    if amt is null or amt <= 0 then raise exception 'INVALID_PAYMENT_AMOUNT' using errcode = '22023'; end if;
    if pm.requires_reference and coalesce(trim(pay->>'reference'), '') = '' then
      raise exception 'PAYMENT_REFERENCE_REQUIRED' using errcode = '22023', detail = pm.name;
    end if;
    if is_offline and not pm.allowed_offline then
      raise exception 'PAYMENT_METHOD_NOT_ALLOWED_OFFLINE' using errcode = 'P0001', detail = pm.name;
    end if;
    if pm.kind = 'cash' then
      cash_tendered := cash_tendered + amt;
    else
      noncash := noncash + amt;
      if pm.kind in ('store_credit','on_account') and v_customer.id is null then
        raise exception 'CUSTOMER_REQUIRED' using errcode = '22023', detail = pm.name;
      end if;
      if pm.kind = 'on_account' then
        perform private.require_perm(org.id, 'pos.credit_sale');
        on_account := on_account + amt;
      end if;
    end if;
  end loop;

  if noncash > v_total then
    raise exception 'OVERPAYMENT_NON_CASH' using errcode = 'P0001',
      detail = json_build_object('total', v_total, 'non_cash', noncash)::text;
  end if;
  cash_needed := v_total - noncash;
  if cash_tendered < cash_needed then
    raise exception 'INSUFFICIENT_PAYMENT' using errcode = 'P0001',
      detail = json_build_object('total', v_total, 'paid', noncash + cash_tendered)::text;
  end if;
  v_change := cash_tendered - cash_needed;

  if on_account > 0 then
    select * into v_customer from public.customers where id = v_customer.id for update;
    if v_customer.account_balance + on_account > v_customer.credit_limit then
      raise exception 'CREDIT_LIMIT_EXCEEDED' using errcode = 'P0001',
        detail = json_build_object('limit', v_customer.credit_limit, 'balance', v_customer.account_balance,
                                   'requested', on_account)::text;
    end if;
  end if;

  -- ---- Stock: lock and deduct in variant order (deadlock-safe) -----------
  allow_neg := org.allow_negative_stock;
  if is_offline and coalesce((payload->'offline'->>'force_negative_stock')::boolean, false) then
    perform private.require_perm(org.id, 'inventory.adjust');
    allow_neg := true;
  end if;
  for stock in
    select (l->>'variant_id')::uuid as variant_id, sum((l->>'qty')::numeric) as qty
      from jsonb_array_elements(cart->'lines') l
     where (l->>'track_stock')::boolean
     group by 1 order by 1
  loop
    v_cost := private.post_movement(org.id, v_wh, stock.variant_id, -stock.qty, null, 'sale', 'sale', v_sale,
                                    null, allow_neg);
    costs := costs || jsonb_build_object(stock.variant_id::text, v_cost);
  end loop;

  -- ---- Persist -----------------------------------------------------------
  v_invoice := private.next_document_number(org.id, reg.outlet_id, 'sale');

  insert into public.sales (id, organization_id, outlet_id, register_id, shift_id, warehouse_id, invoice_number,
      client_uuid, customer_id, cashier_id, quotation_id, prices_include_tax, currency, subtotal, discount_total,
      tax_total, total, change_given, cart_discount, notes, is_offline, sold_at)
  values (v_sale, org.id, reg.outlet_id, reg.id, sh.id, v_wh, v_invoice, v_client, v_customer.id, auth.uid(),
      nullif(payload->>'quotation_id','')::uuid, (cart->>'prices_include_tax')::boolean, org.currency,
      (cart->>'subtotal')::numeric, (cart->>'discount_total')::numeric, (cart->>'tax_total')::numeric,
      v_total, v_change, payload->'cart_discount', payload->>'notes', is_offline, v_sold_at);

  for ln in select * from jsonb_array_elements(cart->'lines') loop
    v_cost := coalesce((costs->>(ln->>'variant_id'))::numeric, 0);
    insert into public.sale_items (organization_id, sale_id, line_no, variant_id, product_id, name, sku, qty,
        list_price, unit_price, price_overridden, discount_type, discount_value, line_discount, cart_discount_alloc,
        tax_rate, tax_amount, line_total, unit_cost, cost_total, track_stock)
    values (org.id, v_sale, (ln->>'line_no')::int, (ln->>'variant_id')::uuid, (ln->>'product_id')::uuid,
        ln->>'name', ln->>'sku', (ln->>'qty')::numeric, (ln->>'list_price')::numeric, (ln->>'unit_price')::numeric,
        (ln->>'price_overridden')::boolean, ln->>'discount_type', (ln->>'discount_value')::numeric,
        (ln->>'line_discount')::numeric, (ln->>'cart_discount_alloc')::numeric, (ln->>'tax_rate')::numeric,
        (ln->>'tax_amount')::numeric, (ln->>'line_total')::numeric, v_cost,
        round(v_cost * (ln->>'qty')::numeric, 2), (ln->>'track_stock')::boolean);
    if (ln->>'price_overridden')::boolean then
      perform private.audit(org.id, 'pos.price_override', 'sale', v_sale,
        jsonb_build_object('variant_id', ln->'variant_id', 'list', ln->'list_price', 'charged', ln->'unit_price'));
    end if;
  end loop;

  cash_left := cash_needed;
  for pay in select * from jsonb_array_elements(coalesce(payload->'payments', '[]'::jsonb)) loop
    select * into pm from public.payment_methods where id = (pay->>'payment_method_id')::uuid;
    amt := round((pay->>'amount')::numeric, 2);
    if pm.kind = 'cash' then
      applied := least(amt, cash_left);
      cash_left := cash_left - applied;
      if applied <= 0 then continue; end if;
    else
      applied := amt;
    end if;
    v_status := case when pm.kind = 'bank_transfer' and pm.requires_verification then 'pending' else 'completed' end;
    if v_status = 'pending' then any_pending := true; end if;
    insert into public.payments (organization_id, sale_id, customer_id, shift_id, payment_method_id, method_kind,
        method_name, direction, amount, tendered, reference, status, created_by)
    values (org.id, v_sale, v_customer.id, sh.id, pm.id, pm.kind, pm.name, 'in', applied,
        case when pm.kind = 'cash' then amt end, nullif(trim(pay->>'reference'), ''), v_status, auth.uid())
    returning id into v_payment;
    if pm.kind not in ('on_account') then
      paid_counter := paid_counter + applied;
    end if;
    if pm.kind = 'store_credit' then
      perform private.post_customer_ledger(org.id, v_customer.id, 'store_credit_used', 0, -applied, v_sale, null, v_payment, v_invoice);
    elsif pm.kind = 'on_account' then
      perform private.post_customer_ledger(org.id, v_customer.id, 'sale_on_account', applied, 0, v_sale, null, v_payment, v_invoice);
    end if;
  end loop;

  update public.sales
     set amount_paid = paid_counter, balance_due = on_account,
         payment_status = case when any_pending then 'pending_verification'
                               when on_account > 0 then 'on_account' else 'paid' end
   where id = v_sale;

  if nullif(payload->>'quotation_id','') is not null then
    update public.quotations set status = 'converted', converted_sale_id = v_sale
     where id = (payload->>'quotation_id')::uuid and organization_id = org.id and status in ('draft','sent','accepted');
  end if;

  if on_account > 0 then
    perform private.audit(org.id, 'pos.credit_sale', 'sale', v_sale, jsonb_build_object('amount', on_account, 'customer_id', v_customer.id));
  end if;
  if is_offline then
    perform private.audit(org.id, 'pos.offline_sale_synced', 'sale', v_sale,
      jsonb_build_object('created_at', payload->'offline'->'created_at', 'forced_negative', allow_neg and not org.allow_negative_stock));
  end if;

  return jsonb_build_object('sale_id', v_sale, 'invoice_number', v_invoice, 'total', v_total,
    'change_given', v_change, 'replayed', false);
end $$;

-- ---------------------------------------------------------------------------
-- Refunds (partial or full). Idempotent on client_uuid.
-- payload: {client_uuid, sale_id, shift_id?, reason, restock,
--           items:[{sale_item_id, qty}], payouts:[{payment_method_id, amount, reference?}]}
-- ---------------------------------------------------------------------------
create or replace function private.refund_core(payload jsonb, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := (payload->>'client_uuid')::uuid;
  s public.sales%rowtype;
  si public.sale_items%rowtype;
  existing public.refunds%rowtype;
  sh public.shifts%rowtype;
  pm public.payment_methods%rowtype;
  it jsonb;
  pay jsonb;
  v_refund uuid := gen_random_uuid();
  v_no text;
  q numeric(14,3);
  amount numeric(14,2);
  tax numeric(14,2);
  r_total numeric(14,2) := 0;
  r_tax numeric(14,2) := 0;
  r_cost numeric(14,2) := 0;
  payout_total numeric(14,2) := 0;
  restock boolean := coalesce((payload->>'restock')::boolean, true);
  v_payment uuid;
  amt numeric(14,2);
begin
  if v_client is null then raise exception 'CLIENT_UUID_REQUIRED' using errcode = '22023'; end if;
  select * into s from public.sales where id = (payload->>'sale_id')::uuid for update;
  if not found then raise exception 'SALE_NOT_FOUND' using errcode = '22023'; end if;
  perform private.require_perm(s.organization_id, case when p_kind = 'void' then 'pos.void' else 'pos.refund' end);
  perform private.require_outlet(s.organization_id, s.outlet_id);

  select * into existing from public.refunds where organization_id = s.organization_id and client_uuid = v_client;
  if found then
    return jsonb_build_object('refund_id', existing.id, 'refund_number', existing.refund_number, 'total', existing.total, 'replayed', true);
  end if;

  if s.status = 'voided' then raise exception 'SALE_VOIDED' using errcode = 'P0001'; end if;
  if coalesce(trim(payload->>'reason'), '') = '' then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;

  if nullif(payload->>'shift_id','') is not null then
    select * into sh from public.shifts where id = (payload->>'shift_id')::uuid and organization_id = s.organization_id;
    if not found then raise exception 'SHIFT_NOT_FOUND' using errcode = '22023'; end if;
    if sh.status <> 'open' then raise exception 'SHIFT_CLOSED' using errcode = 'P0001'; end if;
  end if;

  if p_kind = 'void' then
    select * into sh from public.shifts where id = s.shift_id;
    if sh.status <> 'open' then raise exception 'VOID_ONLY_IN_OPEN_SHIFT' using errcode = 'P0001'; end if;
    if exists (select 1 from public.refunds where sale_id = s.id) then
      raise exception 'SALE_HAS_REFUNDS' using errcode = 'P0001';
    end if;
    restock := true;
  end if;

  v_no := private.next_document_number(s.organization_id, s.outlet_id, 'refund');
  insert into public.refunds (id, organization_id, sale_id, outlet_id, shift_id, refund_number, client_uuid, kind,
                              reason, restock, subtotal, tax_total, total, created_by)
  values (v_refund, s.organization_id, s.id, s.outlet_id, sh.id, v_no, v_client, p_kind, trim(payload->>'reason'),
          restock, 0, 0, 0, auth.uid());

  for it in
    select x from jsonb_array_elements(payload->'items') x order by x->>'sale_item_id'
  loop
    select * into si from public.sale_items where id = (it->>'sale_item_id')::uuid and sale_id = s.id for update;
    if not found then raise exception 'SALE_ITEM_NOT_FOUND' using errcode = '22023'; end if;
    q := (it->>'qty')::numeric;
    if q is null or q <= 0 then raise exception 'INVALID_QTY' using errcode = '22023'; end if;
    if q > si.qty - si.qty_refunded then
      raise exception 'REFUND_EXCEEDS_SOLD' using errcode = 'P0001',
        detail = json_build_object('sale_item_id', si.id, 'refundable', si.qty - si.qty_refunded)::text;
    end if;
    if si.qty_refunded + q = si.qty then
      amount := si.line_total - si.amount_refunded;      -- last unit absorbs rounding
      tax := si.tax_amount - si.tax_refunded;
    else
      amount := round(si.line_total * q / si.qty, 2);
      tax := round(si.tax_amount * q / si.qty, 2);
    end if;
    update public.sale_items set qty_refunded = qty_refunded + q, amount_refunded = amount_refunded + amount,
                                 tax_refunded = tax_refunded + tax where id = si.id;
    insert into public.refund_items (organization_id, refund_id, sale_item_id, variant_id, qty, amount, tax_amount, unit_cost, restocked)
    values (s.organization_id, v_refund, si.id, si.variant_id, q, amount, tax, si.unit_cost, restock and si.track_stock);
    if restock and si.track_stock then
      perform private.post_movement(s.organization_id, s.warehouse_id, si.variant_id, q, si.unit_cost,
                                    case when p_kind = 'void' then 'void' else 'refund' end, 'refund', v_refund,
                                    payload->>'reason', true);
      r_cost := r_cost + round(si.unit_cost * q, 2);
    end if;
    r_total := r_total + amount;
    r_tax := r_tax + tax;
  end loop;

  if r_total = 0 and jsonb_array_length(coalesce(payload->'items','[]'::jsonb)) = 0 then
    raise exception 'NO_ITEMS' using errcode = '22023';
  end if;

  -- Payouts
  for pay in select * from jsonb_array_elements(coalesce(payload->'payouts', '[]'::jsonb)) loop
    select * into pm from public.payment_methods
     where id = (pay->>'payment_method_id')::uuid and organization_id = s.organization_id;
    if not found then raise exception 'PAYMENT_METHOD_NOT_FOUND' using errcode = '22023'; end if;
    amt := round((pay->>'amount')::numeric, 2);
    if amt is null or amt <= 0 then raise exception 'INVALID_PAYMENT_AMOUNT' using errcode = '22023'; end if;
    if pm.kind = 'cash' and sh.id is null then
      raise exception 'OPEN_SHIFT_REQUIRED_FOR_CASH' using errcode = 'P0001';
    end if;
    if pm.kind in ('store_credit','on_account') and s.customer_id is null then
      raise exception 'CUSTOMER_REQUIRED' using errcode = '22023';
    end if;
    insert into public.payments (organization_id, sale_id, refund_id, customer_id, shift_id, payment_method_id, method_kind,
                                 method_name, direction, amount, reference, status, created_by)
    values (s.organization_id, s.id, v_refund, s.customer_id, sh.id, pm.id, pm.kind, pm.name, 'out', amt,
            nullif(trim(pay->>'reference'),''), 'completed', auth.uid())
    returning id into v_payment;
    if pm.kind = 'store_credit' then
      perform private.post_customer_ledger(s.organization_id, s.customer_id,
        case when p_kind = 'void' then 'void_reversal' else 'store_credit_issued' end, 0, amt, s.id, v_refund, v_payment, v_no);
    elsif pm.kind = 'on_account' then
      perform private.post_customer_ledger(s.organization_id, s.customer_id,
        case when p_kind = 'void' then 'void_reversal' else 'refund_to_account' end, -amt, 0, s.id, v_refund, v_payment, v_no);
    end if;
    payout_total := payout_total + amt;
  end loop;

  if p_kind = 'void' then
    -- unverified transfers were never received: they are rejected, not paid out
    payout_total := payout_total + (select coalesce(sum(x.amount), 0) from public.payments x
                                     where x.sale_id = s.id and x.direction = 'in' and x.status = 'pending');
  end if;
  if payout_total <> r_total then
    raise exception 'PAYOUT_MISMATCH' using errcode = 'P0001',
      detail = json_build_object('refund_total', r_total, 'payouts', payout_total)::text;
  end if;

  update public.refunds set subtotal = r_total - r_tax, tax_total = r_tax, total = r_total, cost_total = r_cost
   where id = v_refund;

  if p_kind = 'void' then
    update public.sales set status = 'voided' where id = s.id;
    update public.payments set status = 'rejected', verification_note = 'Sale voided', verified_at = now(), verified_by = auth.uid()
     where sale_id = s.id and status = 'pending';
  end if;

  perform private.audit(s.organization_id, 'sale.' || p_kind, 'refund', v_refund,
    jsonb_build_object('sale_id', s.id, 'invoice', s.invoice_number, 'total', r_total, 'reason', payload->>'reason'));
  return jsonb_build_object('refund_id', v_refund, 'refund_number', v_no, 'total', r_total, 'replayed', false);
end $$;

create or replace function public.process_refund(payload jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select private.refund_core(payload, 'refund');
$$;

-- Void: full reversal of a sale in its still-open shift. Payouts mirror the original tenders
-- (pending bank transfers are rejected rather than paid out).
create or replace function public.void_sale(p_sale uuid, p_reason text, p_client_uuid uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.sales%rowtype;
  items jsonb; payouts jsonb;
begin
  select * into s from public.sales where id = p_sale;
  if not found then raise exception 'SALE_NOT_FOUND' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('sale_item_id', id, 'qty', qty)), '[]'::jsonb) into items
    from public.sale_items where sale_id = p_sale;
  select coalesce(jsonb_agg(jsonb_build_object('payment_method_id', payment_method_id, 'amount', amt)), '[]'::jsonb) into payouts
    from (select payment_method_id, sum(amount) as amt from public.payments
           where sale_id = p_sale and direction = 'in' and status = 'completed' group by payment_method_id) t;
  -- pending transfers are not paid out; refund_core rejects them instead
  return private.refund_core(jsonb_build_object('client_uuid', p_client_uuid, 'sale_id', p_sale, 'reason', p_reason,
           'restock', true, 'items', items, 'payouts', payouts, 'shift_id', s.shift_id), 'void');
end $$;

-- ---------------------------------------------------------------------------
-- Bank transfer verification (manual; no bank integration is implied)
-- ---------------------------------------------------------------------------
create or replace function public.verify_payment(p_payment uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.payments%rowtype;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = '22023'; end if;
  perform private.require_perm(p.organization_id, 'payments.verify');
  if p.status <> 'pending' then raise exception 'PAYMENT_NOT_PENDING' using errcode = 'P0001'; end if;
  update public.payments set status = case when p_approve then 'completed' else 'rejected' end,
         verified_by = auth.uid(), verified_at = now(), verification_note = p_note
   where id = p_payment;
  if p.sale_id is not null then
    update public.sales s set payment_status =
      case when exists (select 1 from public.payments x where x.sale_id = s.id and x.status = 'rejected' and x.direction = 'in') then 'payment_rejected'
           when exists (select 1 from public.payments x where x.sale_id = s.id and x.status = 'pending') then 'pending_verification'
           when s.balance_due > 0 then 'on_account' else 'paid' end
     where s.id = p.sale_id and s.status = 'completed';
  elsif p.customer_id is not null and p_approve then
    perform private.post_customer_ledger(p.organization_id, p.customer_id, 'account_payment', -p.amount, 0, null, null, p.id,
      coalesce(p.reference, 'Verified transfer'));
  end if;
  perform private.audit(p.organization_id, case when p_approve then 'payment.verified' else 'payment.rejected' end,
    'payment', p.id, jsonb_build_object('amount', p.amount, 'reference', p.reference, 'note', p_note));
end $$;

-- ---------------------------------------------------------------------------
-- Customer account collections
-- payload: {organization_id, client_uuid, customer_id, payment_method_id, amount, reference?, shift_id?}
-- ---------------------------------------------------------------------------
create or replace function public.record_customer_payment(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (payload->>'organization_id')::uuid;
  v_client uuid := (payload->>'client_uuid')::uuid;
  c public.customers%rowtype;
  pm public.payment_methods%rowtype;
  sh public.shifts%rowtype;
  v_id uuid;
  amt numeric(14,2) := round((payload->>'amount')::numeric, 2);
  v_status text;
begin
  perform private.require_perm(v_org, 'customers.payments');
  perform pg_advisory_xact_lock(hashtextextended('cpay:' || v_client::text, 0));
  select id into v_id from public.payments where organization_id = v_org and client_uuid = v_client;
  if found then return v_id; end if;
  select * into c from public.customers where id = (payload->>'customer_id')::uuid and organization_id = v_org for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode = '22023'; end if;
  select * into pm from public.payment_methods where id = (payload->>'payment_method_id')::uuid and organization_id = v_org and is_active;
  if not found or pm.kind in ('store_credit','on_account') then raise exception 'PAYMENT_METHOD_NOT_ALLOWED' using errcode = '22023'; end if;
  if amt is null or amt <= 0 then raise exception 'INVALID_PAYMENT_AMOUNT' using errcode = '22023'; end if;
  if amt > c.account_balance then raise exception 'PAYMENT_EXCEEDS_BALANCE' using errcode = 'P0001',
      detail = json_build_object('balance', c.account_balance)::text; end if;
  if pm.requires_reference and coalesce(trim(payload->>'reference'),'') = '' then
    raise exception 'PAYMENT_REFERENCE_REQUIRED' using errcode = '22023'; end if;
  if nullif(payload->>'shift_id','') is not null then
    select * into sh from public.shifts where id = (payload->>'shift_id')::uuid and organization_id = v_org;
    if not found or sh.status <> 'open' then raise exception 'SHIFT_CLOSED' using errcode = 'P0001'; end if;
  elsif pm.kind = 'cash' then
    raise exception 'OPEN_SHIFT_REQUIRED_FOR_CASH' using errcode = 'P0001';
  end if;
  v_status := case when pm.kind = 'bank_transfer' and pm.requires_verification then 'pending' else 'completed' end;
  insert into public.payments (organization_id, customer_id, shift_id, payment_method_id, method_kind, method_name, direction,
                               amount, reference, status, client_uuid, created_by)
  values (v_org, c.id, sh.id, pm.id, pm.kind, pm.name, 'in', amt, nullif(trim(payload->>'reference'),''), v_status, v_client, auth.uid())
  returning id into v_id;
  if v_status = 'completed' then
    perform private.post_customer_ledger(v_org, c.id, 'account_payment', -amt, 0, null, null, v_id, payload->>'reference');
  end if;
  perform private.audit(v_org, 'customer.payment', 'customer', c.id, jsonb_build_object('amount', amt, 'status', v_status));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Quotations
-- payload: {organization_id, id?, outlet_id, customer_id?, valid_until?, notes?, status?,
--           items:[...same as checkout...], cart_discount?}
-- ---------------------------------------------------------------------------
create or replace function public.save_quotation(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (payload->>'organization_id')::uuid;
  v_outlet uuid := (payload->>'outlet_id')::uuid;
  v_id uuid := nullif(payload->>'id','')::uuid;
  cart jsonb;
  ln jsonb;
  q public.quotations%rowtype;
begin
  perform private.require_perm(v_org, 'pos.quotations');
  perform private.require_outlet(v_org, v_outlet);
  cart := private.compute_cart(v_org, v_outlet, nullif(payload->>'customer_id','')::uuid, payload->'items', payload->'cart_discount',
            private.has_perm(v_org, 'pos.price_override'), private.has_perm(v_org, 'pos.discount'));
  if v_id is null then
    insert into public.quotations (organization_id, outlet_id, quote_number, customer_id, status, valid_until, cart_discount,
                                   subtotal, discount_total, tax_total, total, notes, created_by)
    values (v_org, v_outlet, private.next_document_number(v_org, v_outlet, 'quotation'), nullif(payload->>'customer_id','')::uuid,
            coalesce(payload->>'status','draft'), nullif(payload->>'valid_until','')::date, payload->'cart_discount',
            (cart->>'subtotal')::numeric, (cart->>'discount_total')::numeric, (cart->>'tax_total')::numeric,
            (cart->>'total')::numeric, payload->>'notes', auth.uid())
    returning id into v_id;
  else
    select * into q from public.quotations where id = v_id and organization_id = v_org for update;
    if not found then raise exception 'QUOTATION_NOT_FOUND' using errcode = '22023'; end if;
    if q.status in ('converted','cancelled') then raise exception 'QUOTATION_LOCKED' using errcode = 'P0001'; end if;
    update public.quotations set customer_id = nullif(payload->>'customer_id','')::uuid,
           status = coalesce(payload->>'status', status), valid_until = nullif(payload->>'valid_until','')::date,
           cart_discount = payload->'cart_discount', subtotal = (cart->>'subtotal')::numeric,
           discount_total = (cart->>'discount_total')::numeric, tax_total = (cart->>'tax_total')::numeric,
           total = (cart->>'total')::numeric, notes = payload->>'notes'
     where id = v_id;
    delete from public.quotation_items where quotation_id = v_id;
  end if;
  for ln in select * from jsonb_array_elements(cart->'lines') loop
    insert into public.quotation_items (organization_id, quotation_id, line_no, variant_id, name, qty, unit_price,
                                        discount_type, discount_value, tax_rate, tax_amount, line_total)
    values (v_org, v_id, (ln->>'line_no')::int, (ln->>'variant_id')::uuid, ln->>'name', (ln->>'qty')::numeric,
            (ln->>'unit_price')::numeric, ln->>'discount_type', (ln->>'discount_value')::numeric,
            (ln->>'tax_rate')::numeric, (ln->>'tax_amount')::numeric, (ln->>'line_total')::numeric);
  end loop;
  return v_id;
end $$;

create or replace function public.set_quotation_status(p_quotation uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.quotations%rowtype;
begin
  select * into q from public.quotations where id = p_quotation for update;
  if not found then raise exception 'QUOTATION_NOT_FOUND' using errcode = '22023'; end if;
  perform private.require_perm(q.organization_id, 'pos.quotations');
  if q.status in ('converted','cancelled') then raise exception 'QUOTATION_LOCKED' using errcode = 'P0001'; end if;
  if p_status not in ('draft','sent','accepted','expired','cancelled') then raise exception 'INVALID_STATUS' using errcode = '22023'; end if;
  update public.quotations set status = p_status where id = p_quotation;
end $$;

-- ==== 20261024000400_purchasing_transfers.sql ====
-- VIYAFAARIVERIYAA · 0004 Purchasing, receiving with landed cost, purchase returns, stock transfers

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  po_number text not null,
  supplier_id uuid not null,
  warehouse_id uuid not null,
  status text not null default 'draft' check (status in ('draft','approved','partial','received','cancelled')),
  order_date date not null default current_date,
  expected_date date,
  notes text,
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, po_number),
  unique (organization_id, id),
  foreign key (organization_id, supplier_id) references public.suppliers(organization_id, id),
  foreign key (organization_id, warehouse_id) references public.warehouses(organization_id, id)
);
create index purchase_orders_org_idx on public.purchase_orders(organization_id, created_at desc);
create trigger purchase_orders_touch before update on public.purchase_orders
  for each row execute function private.touch_updated_at();

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null,
  variant_id uuid not null,
  qty_ordered numeric(14,3) not null check (qty_ordered > 0),
  qty_received numeric(14,3) not null default 0 check (qty_received >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  line_total numeric(14,2) not null default 0,
  foreign key (organization_id, purchase_order_id) references public.purchase_orders(organization_id, id) on delete cascade,
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create index purchase_order_items_po_idx on public.purchase_order_items(purchase_order_id);

create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  grn_number text not null,
  client_uuid uuid not null,
  purchase_order_id uuid,
  supplier_id uuid not null,
  warehouse_id uuid not null,
  supplier_invoice_ref text,
  received_at timestamptz not null default now(),
  freight numeric(14,2) not null default 0 check (freight >= 0),
  duty numeric(14,2) not null default 0 check (duty >= 0),
  handling numeric(14,2) not null default 0 check (handling >= 0),
  other_costs numeric(14,2) not null default 0 check (other_costs >= 0),
  items_total numeric(14,2) not null default 0,
  landed_total numeric(14,2) not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, client_uuid),
  unique (organization_id, grn_number),
  unique (organization_id, id),
  foreign key (organization_id, purchase_order_id) references public.purchase_orders(organization_id, id),
  foreign key (organization_id, supplier_id) references public.suppliers(organization_id, id),
  foreign key (organization_id, warehouse_id) references public.warehouses(organization_id, id)
);
create index goods_receipts_org_idx on public.goods_receipts(organization_id, received_at desc);

create table public.goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  purchase_order_item_id uuid references public.purchase_order_items(id),
  variant_id uuid not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  landed_unit_cost numeric(14,4) not null,
  batch_no text,          -- captured for traceability; batch allocation on sale is not implemented
  expiry_date date,
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create index goods_receipt_items_grn_idx on public.goods_receipt_items(goods_receipt_id);

create table public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  return_number text not null,
  client_uuid uuid not null,
  supplier_id uuid not null,
  warehouse_id uuid not null,
  goods_receipt_id uuid,
  reason text not null,
  total numeric(14,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, client_uuid),
  unique (organization_id, return_number),
  foreign key (organization_id, supplier_id) references public.suppliers(organization_id, id),
  foreign key (organization_id, warehouse_id) references public.warehouses(organization_id, id),
  foreign key (organization_id, goods_receipt_id) references public.goods_receipts(organization_id, id)
);

create table public.purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_return_id uuid not null references public.purchase_returns(id) on delete cascade,
  variant_id uuid not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_cost numeric(14,4) not null,
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);

create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transfer_number text not null,
  from_warehouse_id uuid not null,
  to_warehouse_id uuid not null,
  status text not null default 'requested' check (status in ('requested','approved','in_transit','received','cancelled')),
  notes text,
  requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  issued_by uuid references auth.users(id),
  received_by uuid references auth.users(id),
  approved_at timestamptz,
  issued_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_warehouse_id <> to_warehouse_id),
  unique (organization_id, transfer_number),
  unique (organization_id, id),
  foreign key (organization_id, from_warehouse_id) references public.warehouses(organization_id, id),
  foreign key (organization_id, to_warehouse_id) references public.warehouses(organization_id, id)
);
create index stock_transfers_org_idx on public.stock_transfers(organization_id, created_at desc);

create table public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transfer_id uuid not null,
  variant_id uuid not null,
  qty_requested numeric(14,3) not null check (qty_requested > 0),
  qty_issued numeric(14,3) not null default 0 check (qty_issued >= 0),
  qty_received numeric(14,3) not null default 0 check (qty_received >= 0),
  unit_cost numeric(14,4) not null default 0,
  foreign key (organization_id, transfer_id) references public.stock_transfers(organization_id, id) on delete cascade,
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create index stock_transfer_items_t_idx on public.stock_transfer_items(transfer_id);

-- ---------------------------------------------------------------------------
-- Purchase order RPCs
-- payload: {organization_id, id?, supplier_id, warehouse_id, expected_date?, notes?,
--           items:[{variant_id, qty_ordered, unit_cost, discount_amount?}]}
-- ---------------------------------------------------------------------------
create or replace function public.save_purchase_order(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (payload->>'organization_id')::uuid;
  v_id uuid := nullif(payload->>'id','')::uuid;
  po public.purchase_orders%rowtype;
  it jsonb;
  sub numeric(14,2) := 0; disc numeric(14,2) := 0;
  q numeric; c numeric; d numeric;
begin
  perform private.require_perm(v_org, 'purchases.manage');
  if jsonb_array_length(coalesce(payload->'items','[]'::jsonb)) = 0 then
    raise exception 'ITEMS_REQUIRED' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.purchase_orders (organization_id, po_number, supplier_id, warehouse_id, expected_date, notes, created_by)
    values (v_org, private.next_document_number(v_org, null, 'purchase_order'), (payload->>'supplier_id')::uuid,
            (payload->>'warehouse_id')::uuid, nullif(payload->>'expected_date','')::date, payload->>'notes', auth.uid())
    returning id into v_id;
  else
    select * into po from public.purchase_orders where id = v_id and organization_id = v_org for update;
    if not found then raise exception 'PO_NOT_FOUND' using errcode = '22023'; end if;
    if po.status <> 'draft' then raise exception 'PO_NOT_EDITABLE' using errcode = 'P0001'; end if;
    update public.purchase_orders set supplier_id = (payload->>'supplier_id')::uuid, warehouse_id = (payload->>'warehouse_id')::uuid,
           expected_date = nullif(payload->>'expected_date','')::date, notes = payload->>'notes'
     where id = v_id;
    delete from public.purchase_order_items where purchase_order_id = v_id;
  end if;
  for it in select * from jsonb_array_elements(payload->'items') loop
    q := (it->>'qty_ordered')::numeric; c := round((it->>'unit_cost')::numeric, 2);
    d := round(coalesce(nullif(it->>'discount_amount','')::numeric, 0), 2);
    if d > round(q * c, 2) then raise exception 'INVALID_DISCOUNT' using errcode = '22023'; end if;
    insert into public.purchase_order_items (organization_id, purchase_order_id, variant_id, qty_ordered, unit_cost, discount_amount, line_total)
    values (v_org, v_id, (it->>'variant_id')::uuid, q, c, d, round(q * c, 2) - d);
    sub := sub + round(q * c, 2); disc := disc + d;
  end loop;
  update public.purchase_orders set subtotal = sub, discount_total = disc, total = sub - disc where id = v_id;
  return v_id;
end $$;

create or replace function public.set_purchase_order_status(p_po uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders%rowtype;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'PO_NOT_FOUND' using errcode = '22023'; end if;
  if p_status = 'approved' then
    perform private.require_perm(po.organization_id, 'purchases.approve');
    if po.status <> 'draft' then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_po;
  elsif p_status = 'cancelled' then
    perform private.require_perm(po.organization_id, 'purchases.manage');
    if po.status not in ('draft','approved') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    update public.purchase_orders set status = 'cancelled' where id = p_po;
  elsif p_status = 'received' then
    -- close a partially received PO short
    perform private.require_perm(po.organization_id, 'purchases.manage');
    if po.status <> 'partial' then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    update public.purchase_orders set status = 'received' where id = p_po;
  else
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  perform private.audit(po.organization_id, 'purchase_order.' || p_status, 'purchase_order', p_po, jsonb_build_object('number', po.po_number));
end $$;

-- Receive goods, with or without a PO. Landed costs (freight, duty, handling, other) are allocated
-- across lines by line value (or by quantity when all lines are zero-cost). Idempotent on client_uuid.
-- payload: {organization_id, client_uuid, purchase_order_id?, supplier_id, warehouse_id, supplier_invoice_ref?,
--           freight?, duty?, handling?, other_costs?, notes?,
--           items:[{purchase_order_item_id?, variant_id, qty, unit_cost, batch_no?, expiry_date?}]}
create or replace function public.receive_goods(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (payload->>'organization_id')::uuid;
  v_client uuid := (payload->>'client_uuid')::uuid;
  v_po uuid := nullif(payload->>'purchase_order_id','')::uuid;
  po public.purchase_orders%rowtype;
  poi public.purchase_order_items%rowtype;
  v_id uuid;
  v_no text;
  v_supplier uuid := (payload->>'supplier_id')::uuid;
  v_wh uuid := (payload->>'warehouse_id')::uuid;
  extra numeric(14,2);
  items_value numeric(14,2) := 0;
  items_qty numeric := 0;
  it jsonb;
  q numeric(14,3); c numeric(14,2); landed numeric(14,4);
  landed_total numeric(14,2) := 0;
  n int; i int := 0;
  extra_left numeric(14,2);
  share numeric(14,2);
begin
  perform private.require_perm(v_org, 'purchases.manage');
  perform pg_advisory_xact_lock(hashtextextended('grn:' || v_client::text, 0));
  select id, grn_number into v_id, v_no from public.goods_receipts where organization_id = v_org and client_uuid = v_client;
  if found then return jsonb_build_object('goods_receipt_id', v_id, 'grn_number', v_no, 'replayed', true); end if;

  n := jsonb_array_length(coalesce(payload->'items','[]'::jsonb));
  if n = 0 then raise exception 'ITEMS_REQUIRED' using errcode = '22023'; end if;

  if v_po is not null then
    select * into po from public.purchase_orders where id = v_po and organization_id = v_org for update;
    if not found then raise exception 'PO_NOT_FOUND' using errcode = '22023'; end if;
    if po.status not in ('approved','partial') then raise exception 'PO_NOT_RECEIVABLE' using errcode = 'P0001'; end if;
    v_supplier := po.supplier_id;
    v_wh := coalesce(v_wh, po.warehouse_id);
  end if;
  if not exists (select 1 from public.warehouses where id = v_wh and organization_id = v_org) then
    raise exception 'WAREHOUSE_NOT_FOUND' using errcode = '22023';
  end if;

  extra := round(coalesce((payload->>'freight')::numeric,0) + coalesce((payload->>'duty')::numeric,0)
               + coalesce((payload->>'handling')::numeric,0) + coalesce((payload->>'other_costs')::numeric,0), 2);
  for it in select * from jsonb_array_elements(payload->'items') loop
    if (it->>'qty')::numeric <= 0 or (it->>'unit_cost')::numeric < 0 then
      raise exception 'INVALID_LINE' using errcode = '22023';
    end if;
    items_value := items_value + round((it->>'qty')::numeric * (it->>'unit_cost')::numeric, 2);
    items_qty := items_qty + (it->>'qty')::numeric;
  end loop;

  v_no := private.next_document_number(v_org, null, 'goods_receipt');
  insert into public.goods_receipts (organization_id, grn_number, client_uuid, purchase_order_id, supplier_id, warehouse_id,
      supplier_invoice_ref, freight, duty, handling, other_costs, items_total, landed_total, notes, created_by)
  values (v_org, v_no, v_client, v_po, v_supplier, v_wh, payload->>'supplier_invoice_ref',
      coalesce((payload->>'freight')::numeric,0), coalesce((payload->>'duty')::numeric,0),
      coalesce((payload->>'handling')::numeric,0), coalesce((payload->>'other_costs')::numeric,0),
      items_value, items_value + extra, payload->>'notes', auth.uid())
  returning id into v_id;

  extra_left := extra;
  for it in select x from jsonb_array_elements(payload->'items') x order by x->>'variant_id' loop
    i := i + 1;
    q := (it->>'qty')::numeric; c := round((it->>'unit_cost')::numeric, 2);
    if i = n then
      share := extra_left;
    elsif items_value > 0 then
      share := round(extra * round(q * c, 2) / items_value, 2);
    else
      share := round(extra * q / items_qty, 2);
    end if;
    extra_left := extra_left - share;
    landed := round((round(q * c, 2) + share) / q, 4);

    if v_po is not null then
      select * into poi from public.purchase_order_items
       where id = (it->>'purchase_order_item_id')::uuid and purchase_order_id = v_po for update;
      if not found then raise exception 'PO_ITEM_NOT_FOUND' using errcode = '22023'; end if;
      if poi.variant_id <> (it->>'variant_id')::uuid then raise exception 'PO_ITEM_MISMATCH' using errcode = '22023'; end if;
      update public.purchase_order_items set qty_received = qty_received + q where id = poi.id;
    end if;

    insert into public.goods_receipt_items (organization_id, goods_receipt_id, purchase_order_item_id, variant_id, qty,
                                            unit_cost, landed_unit_cost, batch_no, expiry_date)
    values (v_org, v_id, nullif(it->>'purchase_order_item_id','')::uuid, (it->>'variant_id')::uuid, q, c, landed,
            nullif(it->>'batch_no',''), nullif(it->>'expiry_date','')::date);

    if exists (select 1 from public.product_variants pv join public.products p on p.id = pv.product_id
                where pv.id = (it->>'variant_id')::uuid and pv.organization_id = v_org and p.track_stock) then
      perform private.post_movement(v_org, v_wh, (it->>'variant_id')::uuid, q, landed, 'purchase_receipt',
                                    'goods_receipt', v_id, v_no, true);
    end if;
    update public.product_variants set cost_price = round(landed, 2) where id = (it->>'variant_id')::uuid;
    landed_total := landed_total + round(q * c, 2) + share;
  end loop;

  if v_po is not null then
    update public.purchase_orders p set status =
      case when not exists (select 1 from public.purchase_order_items x where x.purchase_order_id = p.id and x.qty_received < x.qty_ordered)
           then 'received' else 'partial' end
     where p.id = v_po;
  end if;

  perform private.audit(v_org, 'goods.received', 'goods_receipt', v_id,
    jsonb_build_object('number', v_no, 'po', v_po, 'landed_total', landed_total));
  return jsonb_build_object('goods_receipt_id', v_id, 'grn_number', v_no, 'landed_total', landed_total, 'replayed', false);
end $$;

-- payload: {organization_id, client_uuid, supplier_id, warehouse_id, goods_receipt_id?, reason,
--           items:[{variant_id, qty}]}
create or replace function public.create_purchase_return(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (payload->>'organization_id')::uuid;
  v_client uuid := (payload->>'client_uuid')::uuid;
  v_wh uuid := (payload->>'warehouse_id')::uuid;
  v_id uuid; v_no text;
  it record; cost numeric; r_total numeric(14,2) := 0;
begin
  perform private.require_perm(v_org, 'purchases.manage');
  perform pg_advisory_xact_lock(hashtextextended('pret:' || v_client::text, 0));
  select id into v_id from public.purchase_returns where organization_id = v_org and client_uuid = v_client;
  if found then return v_id; end if;
  if coalesce(trim(payload->>'reason'),'') = '' then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  v_no := private.next_document_number(v_org, null, 'purchase_return');
  insert into public.purchase_returns (organization_id, return_number, client_uuid, supplier_id, warehouse_id, goods_receipt_id, reason, created_by)
  values (v_org, v_no, v_client, (payload->>'supplier_id')::uuid, v_wh, nullif(payload->>'goods_receipt_id','')::uuid,
          payload->>'reason', auth.uid())
  returning id into v_id;
  for it in select (x->>'variant_id')::uuid as variant_id, (x->>'qty')::numeric as qty
              from jsonb_array_elements(payload->'items') x order by 1 loop
    cost := private.post_movement(v_org, v_wh, it.variant_id, -it.qty, null, 'purchase_return', 'purchase_return', v_id, payload->>'reason', false);
    insert into public.purchase_return_items (organization_id, purchase_return_id, variant_id, qty, unit_cost)
    values (v_org, v_id, it.variant_id, it.qty, cost);
    r_total := r_total + round(cost * it.qty, 2);
  end loop;
  update public.purchase_returns set total = r_total where id = v_id;
  perform private.audit(v_org, 'purchase.returned', 'purchase_return', v_id, jsonb_build_object('number', v_no, 'total', r_total));
  return v_id;
end $$;

-- Reorder suggestions: tracked variants at or below min stock in a warehouse
create or replace function public.reorder_suggestions(p_org uuid, p_warehouse uuid)
returns table (variant_id uuid, product_name text, variant_name text, sku text, on_hand numeric, min_stock numeric,
               suggested_qty numeric, last_cost numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_perm(p_org, 'purchases.view');
  return query
  select pv.id, p.name, pv.name, pv.sku, coalesce(b.qty, 0), pv.min_stock,
         greatest(coalesce(nullif(pv.reorder_qty, 0), pv.min_stock * 2 - coalesce(b.qty, 0)), 1),
         pv.cost_price
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    left join public.inventory_balances b on b.variant_id = pv.id and b.warehouse_id = p_warehouse
   where pv.organization_id = p_org and p.track_stock and p.is_active and pv.is_active
     and pv.min_stock > 0 and coalesce(b.qty, 0) <= pv.min_stock
   order by p.name, pv.name;
end $$;

-- ---------------------------------------------------------------------------
-- Stock transfers: request -> approve -> issue (stock leaves source) -> receive (stock arrives)
-- ---------------------------------------------------------------------------
create or replace function public.request_transfer(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (payload->>'organization_id')::uuid;
  v_id uuid;
  it jsonb;
begin
  perform private.require_perm(v_org, 'inventory.transfer');
  if jsonb_array_length(coalesce(payload->'items','[]'::jsonb)) = 0 then raise exception 'ITEMS_REQUIRED' using errcode = '22023'; end if;
  insert into public.stock_transfers (organization_id, transfer_number, from_warehouse_id, to_warehouse_id, notes, requested_by)
  values (v_org, private.next_document_number(v_org, null, 'transfer'), (payload->>'from_warehouse_id')::uuid,
          (payload->>'to_warehouse_id')::uuid, payload->>'notes', auth.uid())
  returning id into v_id;
  for it in select * from jsonb_array_elements(payload->'items') loop
    insert into public.stock_transfer_items (organization_id, transfer_id, variant_id, qty_requested)
    values (v_org, v_id, (it->>'variant_id')::uuid, (it->>'qty')::numeric);
  end loop;
  perform private.audit(v_org, 'transfer.requested', 'stock_transfer', v_id, '{}');
  return v_id;
end $$;

-- p_action: approve | issue | receive | cancel; p_items (issue/receive): [{item_id, qty}]
create or replace function public.advance_transfer(p_transfer uuid, p_action text, p_items jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.stock_transfers%rowtype;
  ti public.stock_transfer_items%rowtype;
  q numeric(14,3);
  cost numeric;
begin
  select * into t from public.stock_transfers where id = p_transfer for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode = '22023'; end if;
  perform private.require_perm(t.organization_id, 'inventory.transfer');

  if p_action = 'approve' then
    if t.status <> 'requested' then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    perform private.require_perm(t.organization_id, 'inventory.adjust');
    update public.stock_transfers set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = t.id;

  elsif p_action = 'issue' then
    if t.status <> 'approved' then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    for ti in select * from public.stock_transfer_items where transfer_id = t.id order by variant_id loop
      q := coalesce((select (x->>'qty')::numeric from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
                      where (x->>'item_id')::uuid = ti.id), ti.qty_requested);
      if q < 0 or q > ti.qty_requested then raise exception 'INVALID_QTY' using errcode = '22023'; end if;
      if q > 0 then
        cost := private.post_movement(t.organization_id, t.from_warehouse_id, ti.variant_id, -q, null,
                                      'transfer_out', 'stock_transfer', t.id, t.transfer_number, false);
      else
        cost := 0;
      end if;
      update public.stock_transfer_items set qty_issued = q, unit_cost = cost where id = ti.id;
    end loop;
    update public.stock_transfers set status = 'in_transit', issued_by = auth.uid(), issued_at = now() where id = t.id;

  elsif p_action = 'receive' then
    if t.status <> 'in_transit' then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    for ti in select * from public.stock_transfer_items where transfer_id = t.id order by variant_id loop
      q := coalesce((select (x->>'qty')::numeric from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
                      where (x->>'item_id')::uuid = ti.id), ti.qty_issued);
      if q < 0 or q > ti.qty_issued then raise exception 'INVALID_QTY' using errcode = '22023'; end if;
      if q > 0 then
        perform private.post_movement(t.organization_id, t.to_warehouse_id, ti.variant_id, q, ti.unit_cost,
                                      'transfer_in', 'stock_transfer', t.id, t.transfer_number, true);
      end if;
      update public.stock_transfer_items set qty_received = q where id = ti.id;
    end loop;
    update public.stock_transfers set status = 'received', received_by = auth.uid(), received_at = now() where id = t.id;

  elsif p_action = 'cancel' then
    if t.status not in ('requested','approved') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    update public.stock_transfers set status = 'cancelled' where id = t.id;
  else
    raise exception 'INVALID_ACTION' using errcode = '22023';
  end if;
  perform private.audit(t.organization_id, 'transfer.' || p_action, 'stock_transfer', t.id, coalesce(p_items, '{}'::jsonb));
end $$;

-- ==== 20261024000500_expenses_onboarding_admin.sql ====
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

-- ==== 20261024000600_reports.sql ====
-- VIYAFAARIVERIYAA · 0006 Reporting functions. All figures derive from persisted transactions.
--
-- KPI definitions (documented in README, "Reporting definitions"):
--   orders            completed (non-voided) sales in period
--   gross_sales       sum(sales.subtotal)  — qty x unit price before discounts, price basis (incl. or excl. tax per org)
--   discounts         sum(sales.discount_total)
--   tax               sum(sales.tax_total) - tax on refunds in period
--   sales_total       sum(sales.total)     — amount charged to customers
--   refunds           sum(refunds.total) for refunds (not voids) created in period
--   net_sales         (sales_total - sales tax) - (refunds - refund tax)    — excludes tax
--   aov               sales_total / orders
--   cogs              sum(sale_items.cost_total) - cost of restocked refunded units
--   gross_profit      net_sales - cogs
--   expenses          sum(expenses.amount) dated in period
--   operating_profit  gross_profit - expenses
-- Voided sales and their void reversals are excluded everywhere.

create or replace function private.report_guard(p_org uuid, p_outlet uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_perm(p_org, 'reports.view');
  if p_outlet is not null then perform private.require_outlet(p_org, p_outlet); end if;
  return private.allowed_outlets(p_org);
end $$;

create or replace function private.org_tz(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select timezone from public.organizations where id = p_org), 'Indian/Maldives');
$$;

create or replace function private.sales_kpis(p_org uuid, p_start timestamptz, p_end timestamptz, p_outlet uuid,
                                              p_allowed uuid[], p_from date, p_to date, p_financial boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  k record; r record; cogs numeric(14,2); exp numeric(14,2);
  net numeric(14,2);
begin
  select count(*) as orders, coalesce(sum(subtotal),0) as gross, coalesce(sum(discount_total),0) as discounts,
         coalesce(sum(tax_total),0) as tax, coalesce(sum(total),0) as total
    into k
    from public.sales s
   where s.organization_id = p_org and s.status = 'completed' and s.sold_at >= p_start and s.sold_at < p_end
     and (p_outlet is null or s.outlet_id = p_outlet) and (p_allowed is null or s.outlet_id = any(p_allowed));

  select count(*) as cnt, coalesce(sum(f.total),0) as total, coalesce(sum(f.tax_total),0) as tax,
         coalesce(sum(f.cost_total),0) as cost
    into r
    from public.refunds f
   where f.organization_id = p_org and f.kind = 'refund' and f.created_at >= p_start and f.created_at < p_end
     and (p_outlet is null or f.outlet_id = p_outlet) and (p_allowed is null or f.outlet_id = any(p_allowed));

  net := (k.total - k.tax) - (r.total - r.tax);
  if not p_financial then
    return jsonb_build_object('orders', k.orders, 'gross_sales', k.gross, 'discounts', k.discounts,
      'tax', k.tax - r.tax, 'sales_total', k.total, 'refunds', r.total, 'refund_count', r.cnt,
      'net_sales', net, 'aov', case when k.orders > 0 then round(k.total / k.orders, 2) else 0 end);
  end if;

  select coalesce(sum(i.cost_total),0) into cogs
    from public.sale_items i join public.sales s on s.id = i.sale_id
   where s.organization_id = p_org and s.status = 'completed' and s.sold_at >= p_start and s.sold_at < p_end
     and (p_outlet is null or s.outlet_id = p_outlet) and (p_allowed is null or s.outlet_id = any(p_allowed));
  cogs := cogs - r.cost;

  select coalesce(sum(e.amount),0) into exp
    from public.expenses e
   where e.organization_id = p_org and e.expense_date between p_from and p_to
     and (p_outlet is null or e.outlet_id = p_outlet)
     and (p_allowed is null or e.outlet_id = any(p_allowed));

  return jsonb_build_object('orders', k.orders, 'gross_sales', k.gross, 'discounts', k.discounts,
    'tax', k.tax - r.tax, 'sales_total', k.total, 'refunds', r.total, 'refund_count', r.cnt,
    'net_sales', net, 'aov', case when k.orders > 0 then round(k.total / k.orders, 2) else 0 end,
    'cogs', cogs, 'gross_profit', net - cogs,
    'gross_margin', case when net <> 0 then round((net - cogs) / net * 100, 1) else null end,
    'expenses', exp, 'operating_profit', net - cogs - exp);
end $$;

-- Current period and the immediately preceding period of equal length
create or replace function public.report_sales_summary(p_org uuid, p_from date, p_to date, p_outlet uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  allowed uuid[] := private.report_guard(p_org, p_outlet);
  tz text := private.org_tz(p_org);
  fin boolean := private.has_perm(p_org, 'reports.financial');
  days int := p_to - p_from + 1;
begin
  if days < 1 or days > 3700 then raise exception 'INVALID_RANGE' using errcode = '22023'; end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'financial', fin,
    'current', private.sales_kpis(p_org, p_from::timestamp at time zone tz, (p_to + 1)::timestamp at time zone tz,
                                  p_outlet, allowed, p_from, p_to, fin),
    'previous', private.sales_kpis(p_org, (p_from - days)::timestamp at time zone tz, p_from::timestamp at time zone tz,
                                   p_outlet, allowed, p_from - days, p_from - 1, fin));
end $$;

create or replace function public.report_sales_timeseries(p_org uuid, p_from date, p_to date, p_outlet uuid default null,
                                                          p_bucket text default 'day')
returns table (bucket timestamp, orders bigint, sales_total numeric, net_sales numeric, refunds numeric)
language plpgsql stable security definer set search_path = '' as $$
declare allowed uuid[] := private.report_guard(p_org, p_outlet); tz text := private.org_tz(p_org);
begin
  if p_bucket not in ('hour','day','week','month') then raise exception 'INVALID_BUCKET' using errcode = '22023'; end if;
  return query
  with s as (
    select date_trunc(p_bucket, x.sold_at at time zone tz) as b, count(*) as o, sum(x.total) as t, sum(x.total - x.tax_total) as n
      from public.sales x
     where x.organization_id = p_org and x.status = 'completed'
       and x.sold_at >= p_from::timestamp at time zone tz and x.sold_at < (p_to + 1)::timestamp at time zone tz
       and (p_outlet is null or x.outlet_id = p_outlet) and (allowed is null or x.outlet_id = any(allowed))
     group by 1),
  r as (
    select date_trunc(p_bucket, f.created_at at time zone tz) as b, sum(f.total) as t, sum(f.total - f.tax_total) as n
      from public.refunds f
     where f.organization_id = p_org and f.kind = 'refund'
       and f.created_at >= p_from::timestamp at time zone tz and f.created_at < (p_to + 1)::timestamp at time zone tz
       and (p_outlet is null or f.outlet_id = p_outlet) and (allowed is null or f.outlet_id = any(allowed))
     group by 1),
  buckets as (
    select generate_series(date_trunc(p_bucket, p_from::timestamp),
                           date_trunc(p_bucket, (p_to + 1)::timestamp - interval '1 second'),
                           ('1 ' || p_bucket)::interval) as b)
  select bk.b, coalesce(s.o, 0)::bigint, coalesce(s.t, 0)::numeric, (coalesce(s.n, 0) - coalesce(r.n, 0))::numeric,
         coalesce(r.t, 0)::numeric
    from buckets bk left join s on s.b = bk.b left join r on r.b = bk.b
   order by bk.b;
end $$;

-- Product performance. p_order: 'top' (by revenue) | 'qty' | 'slow' (least sold among stocked items)
create or replace function public.report_product_performance(p_org uuid, p_from date, p_to date, p_outlet uuid default null,
                                                             p_order text default 'top', p_limit int default 20)
returns table (variant_id uuid, product_name text, variant_name text, sku text, category text,
               qty_sold numeric, net_revenue numeric, cost numeric, profit numeric, on_hand numeric)
language plpgsql stable security definer set search_path = '' as $$
declare allowed uuid[] := private.report_guard(p_org, p_outlet); tz text := private.org_tz(p_org);
        fin boolean := private.has_perm(p_org, 'reports.financial');
begin
  return query
  with sold as (
    select i.variant_id as vid, sum(i.qty - i.qty_refunded) as q,
           sum((i.line_total - i.tax_amount) - (i.amount_refunded - i.tax_refunded)) as rev,
           sum(round(i.unit_cost * (i.qty - i.qty_refunded), 2)) as c
      from public.sale_items i join public.sales s on s.id = i.sale_id
     where s.organization_id = p_org and s.status = 'completed'
       and s.sold_at >= p_from::timestamp at time zone tz and s.sold_at < (p_to + 1)::timestamp at time zone tz
       and (p_outlet is null or s.outlet_id = p_outlet) and (allowed is null or s.outlet_id = any(allowed))
     group by i.variant_id),
  stock as (
    select b.variant_id as vid, sum(b.qty) as q from public.inventory_balances b
      join public.warehouses w on w.id = b.warehouse_id
     where b.organization_id = p_org
       and (p_outlet is null or w.outlet_id = p_outlet)
     group by b.variant_id)
  select pv.id, p.name, pv.name, pv.sku, c.name,
         coalesce(sold.q, 0), coalesce(sold.rev, 0),
         case when fin then coalesce(sold.c, 0) end,
         case when fin then coalesce(sold.rev, 0) - coalesce(sold.c, 0) end,
         coalesce(stock.q, 0)
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    left join public.categories c on c.id = p.category_id
    left join sold on sold.vid = pv.id
    left join stock on stock.vid = pv.id
   where pv.organization_id = p_org
     and case when p_order = 'slow' then p.track_stock and coalesce(stock.q, 0) > 0 and p.is_active
              else sold.vid is not null end
   order by
     case when p_order = 'top' then coalesce(sold.rev, 0) end desc nulls last,
     case when p_order = 'qty' then coalesce(sold.q, 0) end desc nulls last,
     case when p_order = 'slow' then coalesce(sold.q, 0) end asc nulls first,
     p.name
   limit greatest(least(p_limit, 500), 1);
end $$;

-- Breakdown by dimension: cashier | category | outlet | payment_method
create or replace function public.report_sales_breakdown(p_org uuid, p_from date, p_to date, p_outlet uuid default null,
                                                         p_dimension text default 'payment_method')
returns table (key text, label text, orders bigint, amount numeric, net_amount numeric)
language plpgsql stable security definer set search_path = '' as $$
declare allowed uuid[] := private.report_guard(p_org, p_outlet); tz text := private.org_tz(p_org);
        t0 timestamptz := p_from::timestamp at time zone tz; t1 timestamptz := (p_to + 1)::timestamp at time zone tz;
begin
  if p_dimension = 'payment_method' then
    return query
    select x.method_name, x.method_name || case when x.status = 'pending' then ' (pending)' else '' end,
           count(distinct x.sale_id), sum(case when x.direction = 'in' then x.amount else -x.amount end), null::numeric
      from public.payments x left join public.sales s on s.id = x.sale_id
     where x.organization_id = p_org and x.status in ('completed','pending')
       and x.created_at >= t0 and x.created_at < t1 and (s.id is null or s.status = 'completed')
       and (p_outlet is null or s.outlet_id = p_outlet) and (allowed is null or s.outlet_id = any(allowed))
     group by x.method_name, x.status order by 4 desc;
  elsif p_dimension = 'cashier' then
    return query
    select s.cashier_id::text, coalesce(m.display_name, split_part(u.email::text, '@', 1)), count(*), sum(s.total), sum(s.total - s.tax_total)
      from public.sales s
      left join public.organization_users m on m.user_id = s.cashier_id and m.organization_id = s.organization_id
      left join auth.users u on u.id = s.cashier_id
     where s.organization_id = p_org and s.status = 'completed' and s.sold_at >= t0 and s.sold_at < t1
       and (p_outlet is null or s.outlet_id = p_outlet) and (allowed is null or s.outlet_id = any(allowed))
     group by 1, 2 order by 4 desc;
  elsif p_dimension = 'outlet' then
    return query
    select o.id::text, o.name, count(*), sum(s.total), sum(s.total - s.tax_total)
      from public.sales s join public.outlets o on o.id = s.outlet_id
     where s.organization_id = p_org and s.status = 'completed' and s.sold_at >= t0 and s.sold_at < t1
       and (p_outlet is null or s.outlet_id = p_outlet) and (allowed is null or s.outlet_id = any(allowed))
     group by 1, 2 order by 4 desc;
  elsif p_dimension = 'category' then
    return query
    select coalesce(c.id::text, 'none'), coalesce(c.name, 'Uncategorised'), count(distinct s.id),
           sum(i.line_total - i.amount_refunded), sum((i.line_total - i.tax_amount) - (i.amount_refunded - i.tax_refunded))
      from public.sale_items i join public.sales s on s.id = i.sale_id
      join public.products p on p.id = i.product_id left join public.categories c on c.id = p.category_id
     where s.organization_id = p_org and s.status = 'completed' and s.sold_at >= t0 and s.sold_at < t1
       and (p_outlet is null or s.outlet_id = p_outlet) and (allowed is null or s.outlet_id = any(allowed))
     group by 1, 2 order by 4 desc;
  else
    raise exception 'INVALID_DIMENSION' using errcode = '22023';
  end if;
end $$;

-- GST summary by rate. Output tax = tax on sales less tax on refunds in the period.
create or replace function public.report_tax_summary(p_org uuid, p_from date, p_to date, p_outlet uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare allowed uuid[]; tz text := private.org_tz(p_org); rows jsonb; org public.organizations%rowtype;
        t0 timestamptz; t1 timestamptz;
begin
  allowed := private.report_guard(p_org, p_outlet);
  perform private.require_perm(p_org, 'reports.financial');
  t0 := p_from::timestamp at time zone tz; t1 := (p_to + 1)::timestamp at time zone tz;
  select * into org from public.organizations where id = p_org;
  with s as (
    select i.tax_rate as rate, sum(i.line_total - i.tax_amount) as taxable, sum(i.tax_amount) as tax, count(distinct s.id) as docs
      from public.sale_items i join public.sales s on s.id = i.sale_id
     where s.organization_id = p_org and s.status = 'completed' and s.sold_at >= t0 and s.sold_at < t1
       and (p_outlet is null or s.outlet_id = p_outlet) and (allowed is null or s.outlet_id = any(allowed))
     group by i.tax_rate),
  r as (
    select si.tax_rate as rate, sum(ri.amount - ri.tax_amount) as taxable, sum(ri.tax_amount) as tax
      from public.refund_items ri join public.refunds f on f.id = ri.refund_id join public.sale_items si on si.id = ri.sale_item_id
     where f.organization_id = p_org and f.kind = 'refund' and f.created_at >= t0 and f.created_at < t1
       and (p_outlet is null or f.outlet_id = p_outlet) and (allowed is null or f.outlet_id = any(allowed))
     group by si.tax_rate)
  select coalesce(jsonb_agg(jsonb_build_object(
           'rate', coalesce(s.rate, r.rate),
           'sales_taxable', coalesce(s.taxable, 0), 'sales_tax', coalesce(s.tax, 0), 'documents', coalesce(s.docs, 0),
           'refund_taxable', coalesce(r.taxable, 0), 'refund_tax', coalesce(r.tax, 0),
           'net_taxable', coalesce(s.taxable, 0) - coalesce(r.taxable, 0),
           'net_tax', coalesce(s.tax, 0) - coalesce(r.tax, 0)) order by coalesce(s.rate, r.rate) desc), '[]'::jsonb)
    into rows
    from s full join r on r.rate = s.rate;
  return jsonb_build_object('organization', jsonb_build_object('name', org.name, 'legal_name', org.legal_name, 'tin', org.tin,
           'gst_registration', org.gst_registration),
         'from', p_from, 'to', p_to, 'prices_include_tax', org.prices_include_tax, 'rates', rows,
         'net_taxable', (select coalesce(sum((x->>'net_taxable')::numeric), 0) from jsonb_array_elements(rows) x),
         'net_tax', (select coalesce(sum((x->>'net_tax')::numeric), 0) from jsonb_array_elements(rows) x));
end $$;

create or replace function public.report_inventory_valuation(p_org uuid, p_warehouse uuid default null)
returns table (variant_id uuid, product_name text, variant_name text, sku text, category text, warehouse text,
               qty numeric, avg_cost numeric, stock_value numeric, retail_value numeric, min_stock numeric,
               last_received_at timestamptz, last_sold_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare fin boolean;
begin
  perform private.require_perm(p_org, 'inventory.view');
  fin := private.has_perm(p_org, 'reports.financial') or private.has_perm(p_org, 'purchases.view');
  return query
  select pv.id, p.name, pv.name, pv.sku, c.name, w.name, b.qty,
         case when fin then b.avg_cost end, case when fin then round(b.qty * b.avg_cost, 2) end,
         round(b.qty * pv.retail_price, 2), pv.min_stock, b.last_received_at,
         (select max(m.created_at) from public.inventory_movements m
           where m.variant_id = b.variant_id and m.warehouse_id = b.warehouse_id and m.movement_type = 'sale')
    from public.inventory_balances b
    join public.product_variants pv on pv.id = b.variant_id
    join public.products p on p.id = pv.product_id
    join public.warehouses w on w.id = b.warehouse_id
    left join public.categories c on c.id = p.category_id
   where b.organization_id = p_org and (p_warehouse is null or b.warehouse_id = p_warehouse)
     and (b.qty <> 0)
   order by p.name, pv.name, w.name;
end $$;

-- Shrinkage: negative adjustments by reason in period
create or replace function public.report_shrinkage(p_org uuid, p_from date, p_to date)
returns table (reason text, movements bigint, qty numeric, cost_value numeric)
language plpgsql stable security definer set search_path = '' as $$
declare tz text := private.org_tz(p_org);
begin
  perform private.require_perm(p_org, 'reports.financial');
  return query
  select coalesce(m.reason, 'other'), count(*), sum(-m.qty_change), sum(round(-m.qty_change * m.unit_cost, 2))
    from public.inventory_movements m
   where m.organization_id = p_org and m.movement_type = 'adjustment' and m.qty_change < 0
     and m.created_at >= p_from::timestamp at time zone tz and m.created_at < (p_to + 1)::timestamp at time zone tz
   group by 1 order by 4 desc;
end $$;

-- Receivables with aging. Payments are assumed to settle the oldest charges first (FIFO).
create or replace function public.report_receivables(p_org uuid)
returns table (customer_id uuid, customer_name text, phone text, credit_limit numeric, balance numeric,
               current_0_30 numeric, days_31_60 numeric, days_61_90 numeric, over_90 numeric, oldest_open_charge timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_perm(p_org, 'customers.view');
  perform private.require_perm(p_org, 'reports.view');
  return query
  with charges as (
    select l.customer_id as cid, l.created_at, l.account_delta as amt,
           sum(l.account_delta) over (partition by l.customer_id order by l.created_at desc, l.id desc) as cum
      from public.customer_ledger l
     where l.organization_id = p_org and l.account_delta > 0),
  open_parts as (
    select ch.cid, ch.created_at, greatest(least(ch.amt, c.account_balance - (ch.cum - ch.amt)), 0) as open_amt
      from charges ch join public.customers c on c.id = ch.cid
     where c.account_balance > 0)
  select c.id, c.name, c.phone, c.credit_limit, c.account_balance,
         coalesce(sum(op.open_amt) filter (where op.created_at > now() - interval '30 days'), 0),
         coalesce(sum(op.open_amt) filter (where op.created_at <= now() - interval '30 days' and op.created_at > now() - interval '60 days'), 0),
         coalesce(sum(op.open_amt) filter (where op.created_at <= now() - interval '60 days' and op.created_at > now() - interval '90 days'), 0),
         coalesce(sum(op.open_amt) filter (where op.created_at <= now() - interval '90 days'), 0),
         min(op.created_at) filter (where op.open_amt > 0)
    from public.customers c left join open_parts op on op.cid = c.id
   where c.organization_id = p_org and c.account_balance > 0
   group by c.id
   order by c.account_balance desc;
end $$;

create or replace function public.report_shift_closeouts(p_org uuid, p_from date, p_to date, p_outlet uuid default null)
returns table (shift_id uuid, outlet text, register text, opened_by text, opened_at timestamptz, closed_at timestamptz,
               status text, opening_float numeric, expected_cash numeric, counted_cash numeric, variance numeric,
               sales_count bigint, sales_total numeric)
language plpgsql stable security definer set search_path = '' as $$
declare allowed uuid[] := private.report_guard(p_org, p_outlet); tz text := private.org_tz(p_org);
begin
  return query
  select s.id, o.name, r.name, coalesce(m.display_name, split_part(u.email::text, '@', 1)), s.opened_at, s.closed_at, s.status,
         s.opening_float, s.expected_cash, s.counted_cash, s.variance,
         (select count(*) from public.sales x where x.shift_id = s.id and x.status = 'completed'),
         (select coalesce(sum(x.total), 0) from public.sales x where x.shift_id = s.id and x.status = 'completed')
    from public.shifts s
    join public.outlets o on o.id = s.outlet_id
    join public.registers r on r.id = s.register_id
    left join public.organization_users m on m.user_id = s.opened_by and m.organization_id = s.organization_id
    left join auth.users u on u.id = s.opened_by
   where s.organization_id = p_org
     and s.opened_at >= p_from::timestamp at time zone tz and s.opened_at < (p_to + 1)::timestamp at time zone tz
     and (p_outlet is null or s.outlet_id = p_outlet) and (allowed is null or s.outlet_id = any(allowed))
   order by s.opened_at desc;
end $$;

create or replace function public.report_supplier_purchases(p_org uuid, p_from date, p_to date)
returns table (supplier_id uuid, supplier text, receipts bigint, items_value numeric, landed_value numeric,
               returns_value numeric, open_po_value numeric)
language plpgsql stable security definer set search_path = '' as $$
declare tz text := private.org_tz(p_org);
begin
  perform private.require_perm(p_org, 'purchases.view');
  return query
  select sp.id, sp.name,
         (select count(*) from public.goods_receipts g where g.supplier_id = sp.id
            and g.received_at >= p_from::timestamp at time zone tz and g.received_at < (p_to + 1)::timestamp at time zone tz),
         (select coalesce(sum(g.items_total), 0) from public.goods_receipts g where g.supplier_id = sp.id
            and g.received_at >= p_from::timestamp at time zone tz and g.received_at < (p_to + 1)::timestamp at time zone tz),
         (select coalesce(sum(g.landed_total), 0) from public.goods_receipts g where g.supplier_id = sp.id
            and g.received_at >= p_from::timestamp at time zone tz and g.received_at < (p_to + 1)::timestamp at time zone tz),
         (select coalesce(sum(pr.total), 0) from public.purchase_returns pr where pr.supplier_id = sp.id
            and pr.created_at >= p_from::timestamp at time zone tz and pr.created_at < (p_to + 1)::timestamp at time zone tz),
         (select coalesce(sum(round((pi.qty_ordered - pi.qty_received) * pi.unit_cost, 2)), 0)
            from public.purchase_order_items pi join public.purchase_orders po on po.id = pi.purchase_order_id
           where po.supplier_id = sp.id and po.status in ('approved','partial'))
    from public.suppliers sp
   where sp.organization_id = p_org
   order by 5 desc, sp.name;
end $$;

-- Operational counters for the dashboard
create or replace function public.dashboard_counters(p_org uuid, p_outlet uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare allowed uuid[];
begin
  if not private.is_member(p_org) then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  allowed := private.allowed_outlets(p_org);
  return jsonb_build_object(
    'low_stock', case when private.has_perm(p_org, 'inventory.view') then (
        select count(*) from public.product_variants pv join public.products p on p.id = pv.product_id
          join public.outlets o on o.organization_id = pv.organization_id and (p_outlet is null or o.id = p_outlet)
          left join public.inventory_balances b on b.variant_id = pv.id and b.warehouse_id = o.default_warehouse_id
         where pv.organization_id = p_org and p.track_stock and p.is_active and pv.is_active and pv.min_stock > 0
           and coalesce(b.qty, 0) <= pv.min_stock and (allowed is null or o.id = any(allowed))) end,
    'pending_payments', case when private.has_perm(p_org, 'payments.verify') or private.has_perm(p_org, 'sales.view') then (
        select count(*) from public.payments where organization_id = p_org and status = 'pending') end,
    'open_shifts', (select count(*) from public.shifts where organization_id = p_org and status = 'open'
                     and (p_outlet is null or outlet_id = p_outlet) and (allowed is null or outlet_id = any(allowed))),
    'shifts_to_approve', case when private.has_perm(p_org, 'shifts.approve') then (
        select count(*) from public.shifts where organization_id = p_org and status = 'closed') end,
    'transfers_in_progress', case when private.has_perm(p_org, 'inventory.view') then (
        select count(*) from public.stock_transfers where organization_id = p_org and status in ('requested','approved','in_transit')) end,
    'purchase_orders_open', case when private.has_perm(p_org, 'purchases.view') then (
        select count(*) from public.purchase_orders where organization_id = p_org and status in ('approved','partial')) end,
    'receivables', case when private.has_perm(p_org, 'customers.view') then (
        select coalesce(sum(account_balance), 0) from public.customers where organization_id = p_org and account_balance > 0) end);
end $$;

-- ==== 20261024000700_rls_grants.sql ====
-- VIYAFAARIVERIYAA · 0007 Row Level Security, privileges and write guards
--
-- Model:
--  * Every tenant table has RLS enabled. Reads require membership (and usually a permission).
--  * Direct writes are allowed only for master data, gated by permission, and only on whitelisted columns.
--  * Financial and stock tables (sales, payments, refunds, movements, balances, ledgers, shifts...) have
--    no client write privileges at all: they change only inside SECURITY DEFINER RPCs.

-- ---------------------------------------------------------------------------
-- Extra write guards
-- ---------------------------------------------------------------------------
create or replace function private.guard_credit_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.credit_limit > 0) or (tg_op = 'UPDATE' and new.credit_limit is distinct from old.credit_limit) then
    if auth.uid() is not null and not (private.has_perm(new.organization_id, 'pos.credit_sale')
                                       or private.has_perm(new.organization_id, 'settings.manage')) then
      raise exception 'PERMISSION_DENIED: credit limit' using errcode = '42501';
    end if;
    if auth.uid() is not null then
      perform private.audit(new.organization_id, 'customer.credit_limit', 'customer', new.id,
        jsonb_build_object('from', case when tg_op = 'UPDATE' then old.credit_limit end, 'to', new.credit_limit));
    end if;
  end if;
  return new;
end $$;
create trigger customers_credit_limit before insert or update on public.customers
  for each row execute function private.guard_credit_limit();

create or replace function private.audit_price_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (new.retail_price, new.wholesale_price) is distinct from (old.retail_price, old.wholesale_price) then
    perform private.audit(new.organization_id, 'product.price_changed', 'product_variant', new.id,
      jsonb_build_object('retail_from', old.retail_price, 'retail_to', new.retail_price,
                         'wholesale_from', old.wholesale_price, 'wholesale_to', new.wholesale_price));
  end if;
  return new;
end $$;
create trigger product_variants_price_audit after update on public.product_variants
  for each row execute function private.audit_price_change();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid), private.has_perm(uuid, text), private.can_access_outlet(uuid, uuid),
                          private.is_platform_admin(), private.allowed_outlets(uuid), private.member_role(uuid)
  to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- Whitelisted direct writes (column-level where it matters)
grant update (name, legal_name, tin, gst_registration, business_registration, phone, email, address, island, atoll,
              logo_path, prices_include_tax, allow_negative_stock, receipt_footer, receipt_header, locale, timezone)
  on public.organizations to authenticated;
grant insert (organization_id, name, description, permissions), update (name, description, permissions), delete
  on public.roles to authenticated;
grant update (name, address, island, phone, is_active) on public.outlets to authenticated;
grant insert (organization_id, outlet_id, name, is_active), update (name, is_active) on public.warehouses to authenticated;
grant insert (organization_id, outlet_id, name, receipt_width, is_active), update (name, receipt_width, is_active)
  on public.registers to authenticated;
grant insert (organization_id, name, rate, is_default, is_active), update (name, rate, is_default, is_active)
  on public.tax_rates to authenticated;
grant insert (organization_id, name, kind, requires_reference, requires_verification, allowed_offline, is_active, sort_order),
      update (name, requires_reference, requires_verification, allowed_offline, is_active, sort_order)
  on public.payment_methods to authenticated;
grant update (prefix, padding, next_number) on public.document_sequences to authenticated;
grant insert, update, delete on public.categories, public.brands, public.units to authenticated;
grant insert (organization_id, name, description, category_id, brand_id, unit_id, tax_rate_id, product_type, track_stock,
              sold_by_weight, is_favorite, is_active, image_path),
      update (name, description, category_id, brand_id, unit_id, tax_rate_id, sold_by_weight, is_favorite, is_active, image_path),
      delete
  on public.products to authenticated;
grant insert (organization_id, product_id, name, sku, attributes, cost_price, retail_price, wholesale_price, min_stock,
              reorder_qty, is_active, sort_order),
      update (name, sku, attributes, cost_price, retail_price, wholesale_price, min_stock, reorder_qty, is_active, sort_order),
      delete
  on public.product_variants to authenticated;
grant insert, delete on public.product_barcodes to authenticated;
grant insert, update, delete on public.outlet_prices to authenticated;
grant insert, update on public.customer_groups to authenticated;
grant insert (organization_id, name, phone, email, address, island, tin, customer_group_id, credit_limit, notes, is_active),
      update (name, phone, email, address, island, tin, customer_group_id, credit_limit, notes, is_active)
  on public.customers to authenticated;
grant insert, update on public.suppliers to authenticated;
grant insert, update on public.expense_categories to authenticated;
grant insert (organization_id, outlet_id, category_id, expense_date, amount, payment_method, reference, payee, description, attachment_path),
      update (outlet_id, category_id, expense_date, amount, payment_method, reference, payee, description, attachment_path),
      delete
  on public.expenses to authenticated;
grant insert (organization_id, outlet_id, register_id, label, cart, customer_id), delete on public.held_bills to authenticated;
grant insert (id, full_name, phone, default_organization_id), update (full_name, phone, default_organization_id)
  on public.profiles to authenticated;
grant update (status) on public.invitations to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'platform_admins','system_settings','profiles','organizations','permissions','roles','outlets','warehouses','registers',
    'organization_users','invitations','tax_rates','payment_methods','document_sequences','audit_logs',
    'categories','brands','units','products','product_variants','product_barcodes','outlet_prices','customer_groups',
    'customers','suppliers','inventory_balances','inventory_movements','stock_adjustments','stock_adjustment_items',
    'shifts','cash_movements','quotations','quotation_items','held_bills','sales','sale_items','refunds','refund_items',
    'payments','customer_ledger','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items',
    'purchase_returns','purchase_return_items','stock_transfers','stock_transfer_items','expense_categories','expenses']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Platform
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());
create policy system_settings_read on public.system_settings for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy profiles_own_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_own_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_own_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Organization & configuration
create policy organizations_select on public.organizations for select to authenticated using (private.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_perm(id, 'settings.manage')) with check (private.has_perm(id, 'settings.manage'));

create policy roles_select on public.roles for select to authenticated using (private.is_member(organization_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (private.has_perm(organization_id, 'staff.manage') and system_key is null);
create policy roles_update on public.roles for update to authenticated
  using (private.has_perm(organization_id, 'staff.manage') and coalesce(system_key, '') <> 'owner')
  with check (private.has_perm(organization_id, 'staff.manage'));
create policy roles_delete on public.roles for delete to authenticated
  using (private.has_perm(organization_id, 'staff.manage') and system_key is null);

create policy outlets_select on public.outlets for select to authenticated using (private.is_member(organization_id));
create policy outlets_update on public.outlets for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy warehouses_select on public.warehouses for select to authenticated using (private.is_member(organization_id));
create policy warehouses_insert on public.warehouses for insert to authenticated with check (private.has_perm(organization_id, 'settings.manage'));
create policy warehouses_update on public.warehouses for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy registers_select on public.registers for select to authenticated using (private.is_member(organization_id));
create policy registers_insert on public.registers for insert to authenticated with check (private.has_perm(organization_id, 'settings.manage'));
create policy registers_update on public.registers for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy members_select on public.organization_users for select to authenticated
  using (user_id = auth.uid() or private.has_perm(organization_id, 'staff.manage'));
create policy invitations_select on public.invitations for select to authenticated
  using (private.has_perm(organization_id, 'staff.manage'));
create policy invitations_update on public.invitations for update to authenticated
  using (private.has_perm(organization_id, 'staff.manage') and status = 'pending')
  with check (status = 'revoked');

create policy tax_rates_select on public.tax_rates for select to authenticated using (private.is_member(organization_id));
create policy tax_rates_insert on public.tax_rates for insert to authenticated with check (private.has_perm(organization_id, 'settings.manage'));
create policy tax_rates_update on public.tax_rates for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy payment_methods_select on public.payment_methods for select to authenticated using (private.is_member(organization_id));
create policy payment_methods_insert on public.payment_methods for insert to authenticated with check (private.has_perm(organization_id, 'settings.manage'));
create policy payment_methods_update on public.payment_methods for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy sequences_select on public.document_sequences for select to authenticated using (private.is_member(organization_id));
create policy sequences_update on public.document_sequences for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy audit_select on public.audit_logs for select to authenticated using (private.has_perm(organization_id, 'audit.view'));

-- Catalog (members read; products.manage writes)
do $$
declare t text;
begin
  foreach t in array array['categories','brands','units','products','product_variants','product_barcodes','outlet_prices'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.is_member(organization_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.has_perm(organization_id, ''products.manage''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.has_perm(organization_id, ''products.manage'')) with check (private.has_perm(organization_id, ''products.manage''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.has_perm(organization_id, ''products.manage''))', t || '_delete', t);
  end loop;
end $$;

-- Customers (PII limited to customers.view)
create policy customer_groups_select on public.customer_groups for select to authenticated using (private.is_member(organization_id));
create policy customer_groups_insert on public.customer_groups for insert to authenticated with check (private.has_perm(organization_id, 'customers.manage'));
create policy customer_groups_update on public.customer_groups for update to authenticated
  using (private.has_perm(organization_id, 'customers.manage')) with check (private.has_perm(organization_id, 'customers.manage'));
create policy customers_select on public.customers for select to authenticated using (private.has_perm(organization_id, 'customers.view'));
create policy customers_insert on public.customers for insert to authenticated with check (private.has_perm(organization_id, 'customers.manage'));
create policy customers_update on public.customers for update to authenticated
  using (private.has_perm(organization_id, 'customers.manage')) with check (private.has_perm(organization_id, 'customers.manage'));
create policy customer_ledger_select on public.customer_ledger for select to authenticated using (private.has_perm(organization_id, 'customers.view'));

-- Suppliers & purchasing
create policy suppliers_select on public.suppliers for select to authenticated
  using (private.has_perm(organization_id, 'purchases.view') or private.has_perm(organization_id, 'suppliers.manage'));
create policy suppliers_insert on public.suppliers for insert to authenticated with check (private.has_perm(organization_id, 'suppliers.manage'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (private.has_perm(organization_id, 'suppliers.manage')) with check (private.has_perm(organization_id, 'suppliers.manage'));
do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items','purchase_returns','purchase_return_items'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.has_perm(organization_id, ''purchases.view''))', t || '_select', t);
  end loop;
  foreach t in array array['inventory_balances','inventory_movements','stock_adjustments','stock_adjustment_items','stock_transfers','stock_transfer_items'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.has_perm(organization_id, ''inventory.view''))', t || '_select', t);
  end loop;
end $$;

-- Shifts & cash
create policy shifts_select on public.shifts for select to authenticated
  using ((private.has_perm(organization_id, 'shifts.manage') or private.has_perm(organization_id, 'shifts.approve')
          or private.has_perm(organization_id, 'reports.view'))
         and private.can_access_outlet(organization_id, outlet_id));
create policy cash_movements_select on public.cash_movements for select to authenticated
  using (exists (select 1 from public.shifts s where s.id = shift_id));

-- Sales, refunds, payments
create policy sales_select on public.sales for select to authenticated
  using (private.has_perm(organization_id, 'sales.view') and private.can_access_outlet(organization_id, outlet_id));
create policy sale_items_select on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));
create policy refunds_select on public.refunds for select to authenticated
  using (private.has_perm(organization_id, 'sales.view') and private.can_access_outlet(organization_id, outlet_id));
create policy refund_items_select on public.refund_items for select to authenticated
  using (exists (select 1 from public.refunds r where r.id = refund_id));
create policy payments_select on public.payments for select to authenticated
  using (private.has_perm(organization_id, 'sales.view') or private.has_perm(organization_id, 'payments.verify')
         or (customer_id is not null and sale_id is null and private.has_perm(organization_id, 'customers.view')));

-- Quotations & parked bills
create policy quotations_select on public.quotations for select to authenticated
  using ((private.has_perm(organization_id, 'pos.quotations') or private.has_perm(organization_id, 'sales.view'))
         and private.can_access_outlet(organization_id, outlet_id));
create policy quotation_items_select on public.quotation_items for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id));
create policy held_bills_select on public.held_bills for select to authenticated
  using (private.has_perm(organization_id, 'pos.sell') and private.can_access_outlet(organization_id, outlet_id));
create policy held_bills_insert on public.held_bills for insert to authenticated
  with check (private.has_perm(organization_id, 'pos.sell') and private.can_access_outlet(organization_id, outlet_id));
create policy held_bills_delete on public.held_bills for delete to authenticated
  using (private.has_perm(organization_id, 'pos.sell') and private.can_access_outlet(organization_id, outlet_id));

-- Expenses
create policy expense_categories_select on public.expense_categories for select to authenticated using (private.is_member(organization_id));
create policy expense_categories_insert on public.expense_categories for insert to authenticated with check (private.has_perm(organization_id, 'expenses.manage'));
create policy expense_categories_update on public.expense_categories for update to authenticated
  using (private.has_perm(organization_id, 'expenses.manage')) with check (private.has_perm(organization_id, 'expenses.manage'));
create policy expenses_select on public.expenses for select to authenticated
  using (private.has_perm(organization_id, 'expenses.view') and (outlet_id is null or private.can_access_outlet(organization_id, outlet_id)));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (private.has_perm(organization_id, 'expenses.manage') and (outlet_id is null or private.can_access_outlet(organization_id, outlet_id)));
create policy expenses_update on public.expenses for update to authenticated
  using (private.has_perm(organization_id, 'expenses.manage'))
  with check (private.has_perm(organization_id, 'expenses.manage') and (outlet_id is null or private.can_access_outlet(organization_id, outlet_id)));
create policy expenses_delete on public.expenses for delete to authenticated using (private.has_perm(organization_id, 'expenses.manage'));

-- ==== 20261024000800_storage.sql ====
-- VIYAFAARIVERIYAA · 0008 Private file storage (logos, product images, expense receipts)
-- Object paths: <organization_id>/<area>/<file>, area in (branding, products, expenses).
-- Skipped automatically where the Supabase storage schema is not installed (plain Postgres test runs).

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not present; skipping storage policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('org-files', 'org-files', false, 5242880, array['image/png','image/jpeg','image/webp','application/pdf'])
  on conflict (id) do nothing;

  execute $p$
    create or replace function private.storage_org(p_name text) returns uuid
    language sql immutable as $f$
      select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
    $f$;
    grant execute on function private.storage_org(text) to authenticated;

    create or replace function private.storage_write_perm(p_name text) returns text
    language sql immutable as $f$
      select case split_part(p_name, '/', 2)
               when 'branding' then 'settings.manage'
               when 'products' then 'products.manage'
               when 'expenses' then 'expenses.manage'
             end
    $f$;
    grant execute on function private.storage_write_perm(text) to authenticated;

    create policy org_files_read on storage.objects for select to authenticated
      using (bucket_id = 'org-files' and private.is_member(private.storage_org(name))
             and (split_part(name, '/', 2) <> 'expenses' or private.has_perm(private.storage_org(name), 'expenses.view')));
    create policy org_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'org-files' and private.storage_write_perm(name) is not null
                  and private.has_perm(private.storage_org(name), private.storage_write_perm(name)));
    create policy org_files_update on storage.objects for update to authenticated
      using (bucket_id = 'org-files' and private.storage_write_perm(name) is not null
             and private.has_perm(private.storage_org(name), private.storage_write_perm(name)));
    create policy org_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'org-files' and private.storage_write_perm(name) is not null
             and private.has_perm(private.storage_org(name), private.storage_write_perm(name)));
  $p$;
end
$outer$;
