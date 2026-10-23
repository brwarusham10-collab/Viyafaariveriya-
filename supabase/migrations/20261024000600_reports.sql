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
