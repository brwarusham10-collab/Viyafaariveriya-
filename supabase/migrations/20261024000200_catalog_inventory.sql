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
