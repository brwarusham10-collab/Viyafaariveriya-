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
