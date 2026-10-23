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
