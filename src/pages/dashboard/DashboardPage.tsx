import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, ClipboardList, Landmark, ScanBarcode, Vault, Wallet } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { useOrg, useOrgId } from "@/app/org";
import { BreakdownBars, SalesChart } from "@/components/charts/SalesChart";
import { DateRangePicker, useRange } from "@/components/common/DateRange";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Card, CardHeader, EmptyState, ErrorNotice, Money, PageHeader, Skeleton, Stat } from "@/components/ui/misc";
import { fmtDate } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { rpc } from "@/lib/supabase";

export interface Kpis {
  orders: number;
  gross_sales: number;
  discounts: number;
  tax: number;
  sales_total: number;
  refunds: number;
  refund_count: number;
  net_sales: number;
  aov: number;
  cogs?: number;
  gross_profit?: number;
  gross_margin?: number | null;
  expenses?: number;
  operating_profit?: number;
}

export interface Summary {
  financial: boolean;
  current: Kpis;
  previous: Kpis;
}

export const delta = (cur?: number, prev?: number) => (cur === undefined || prev === undefined || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100);

export function bucketFor(from: string, to: string): "hour" | "day" | "week" | "month" {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 + 1;
  return days <= 1 ? "hour" : days <= 45 ? "day" : days <= 200 ? "week" : "month";
}

export function bucketLabel(b: string, bucket: string) {
  const d = new Date(`${b.slice(0, 19)}Z`);
  if (bucket === "hour") return `${String(d.getUTCHours()).padStart(2, "0")}:00`;
  if (bucket === "month") return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function Counters() {
  const orgId = useOrgId();
  const { outlet } = useOrg();
  const { data } = useQuery({
    queryKey: ["dashboard-counters", orgId, outlet?.id],
    queryFn: () => rpc<Record<string, number | null>>("dashboard_counters", { p_org: orgId, p_outlet: null }),
  });
  if (!data) return null;
  const items = [
    { k: "low_stock", label: "Products at or below minimum stock", to: "/inventory?filter=low", icon: AlertTriangle },
    { k: "pending_payments", label: "Bank transfers waiting for verification", to: "/sales?payment=pending_verification", icon: Landmark },
    { k: "shifts_to_approve", label: "Closed shifts to review", to: "/shifts?status=closed", icon: Vault },
    { k: "transfers_in_progress", label: "Stock transfers in progress", to: "/inventory/transfers", icon: ArrowLeftRight },
    { k: "purchase_orders_open", label: "Purchase orders awaiting delivery", to: "/purchases", icon: ClipboardList },
  ].filter((i) => (data[i.k] ?? 0) > 0);
  return (
    <Card>
      <CardHeader title="Needs attention" />
      {items.length === 0 && Number(data.receivables ?? 0) === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">All clear — nothing is waiting on you.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.k}>
              <Link to={i.to} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-fg/[0.03]">
                <i.icon className="size-4 text-saffron" />
                <span className="flex-1">{i.label}</span>
                <span className="font-semibold tabular">{data[i.k]}</span>
              </Link>
            </li>
          ))}
          {Number(data.receivables ?? 0) > 0 && (
            <li>
              <Link to="/customers?balance=1" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-fg/[0.03]">
                <Wallet className="size-4 text-saffron" />
                <span className="flex-1">Owed by credit customers</span>
                <Money value={data.receivables} className="font-semibold" />
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const orgId = useOrgId();
  const { can, outlets, org } = useOrg();
  const [range, setRange] = useRange("7d");
  const [outletFilter, setOutletFilter] = React.useState<string>("");
  const outletArg = outletFilter || null;
  const bucket = bucketFor(range.from, range.to);

  const summary = useQuery({
    queryKey: ["report-summary", orgId, range.from, range.to, outletArg],
    enabled: can("reports.view"),
    queryFn: () => rpc<Summary>("report_sales_summary", { p_org: orgId, p_from: range.from, p_to: range.to, p_outlet: outletArg }),
  });
  const series = useQuery({
    queryKey: ["report-series", orgId, range.from, range.to, outletArg, bucket],
    enabled: can("reports.view"),
    queryFn: () => rpc<{ bucket: string; orders: number; net_sales: number }[]>("report_sales_timeseries",
      { p_org: orgId, p_from: range.from, p_to: range.to, p_outlet: outletArg, p_bucket: bucket }),
  });
  const top = useQuery({
    queryKey: ["report-top", orgId, range.from, range.to, outletArg],
    enabled: can("reports.view"),
    queryFn: () => rpc<{ product_name: string; variant_name: string; qty_sold: number; net_revenue: number }[]>("report_product_performance",
      { p_org: orgId, p_from: range.from, p_to: range.to, p_outlet: outletArg, p_order: "top", p_limit: 6 }),
  });
  const methods = useQuery({
    queryKey: ["report-methods", orgId, range.from, range.to, outletArg],
    enabled: can("reports.view"),
    queryFn: () => rpc<{ label: string; amount: number }[]>("report_sales_breakdown",
      { p_org: orgId, p_from: range.from, p_to: range.to, p_outlet: outletArg, p_dimension: "payment_method" }),
  });

  if (!can("reports.view")) {
    return (
      <>
        <PageHeader title={`Welcome to ${org?.name ?? "your business"}`} />
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold">Ready to sell</h2>
            <p className="mt-1 text-sm text-muted">Open the register to start taking sales.</p>
            {can("pos.sell") && <Button asChild className="mt-4"><Link to="/pos"><ScanBarcode /> Open register</Link></Button>}
          </Card>
          <Counters />
        </div>
      </>
    );
  }

  const c = summary.data?.current;
  const p = summary.data?.previous;
  const loading = summary.isLoading;
  const chartData = (series.data ?? []).map((r) => ({ label: bucketLabel(r.bucket, bucket), value: Number(r.net_sales), orders: Number(r.orders) }));
  const hasSales = chartData.some((d) => d.value !== 0);

  return (
    <>
      <PageHeader title="Dashboard" description={`${fmtDate(range.from)} – ${fmtDate(range.to)} · compared with the previous ${bucket === "hour" ? "day" : "period"}`}
        actions={
          <>
            {outlets.length > 1 && (
              <Select aria-label="Outlet" className="h-8 w-44" value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)}>
                <option value="">All outlets</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
            <DateRangePicker value={range} onChange={setRange} />
          </>
        } />
      {summary.error && <ErrorNotice error={summary.error} onRetry={() => summary.refetch()} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net sales (excl. tax)" loading={loading} value={formatMoney(c?.net_sales)} delta={delta(c?.net_sales, p?.net_sales)} />
        <Stat label="Orders" loading={loading} value={c?.orders ?? 0} delta={delta(c?.orders, p?.orders)} hint={c && `avg ${formatMoney(c.aov)}`} />
        {summary.data?.financial ? (
          <Stat label="Gross profit" loading={loading} value={formatMoney(c?.gross_profit)} delta={delta(c?.gross_profit, p?.gross_profit)}
            hint={c?.gross_margin !== null && c?.gross_margin !== undefined ? `${c.gross_margin}% margin` : undefined} />
        ) : (
          <Stat label="Collected (incl. tax)" loading={loading} value={formatMoney(c?.sales_total)} delta={delta(c?.sales_total, p?.sales_total)} />
        )}
        <Stat label="Refunds" loading={loading} value={formatMoney(c?.refunds)} hint={c ? `${c.refund_count} refunds` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Net sales" description={`By ${bucket}, excluding tax and refunds`} />
          <div className="px-2 py-3">
            {series.isLoading ? <Skeleton className="mx-2 h-[240px]" /> : hasSales ? <SalesChart data={chartData} /> : (
              <EmptyState icon={ScanBarcode} title="No sales in this period" action={can("pos.sell") ? <Button asChild size="sm"><Link to="/pos">Open register</Link></Button> : undefined} />
            )}
          </div>
        </Card>
        <Counters />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top products" action={<Link to="/reports/sales" className="text-sm text-lagoon hover:underline">All products</Link>} />
          {top.isLoading ? <div className="space-y-2 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-5" />)}</div> : top.data?.length ? (
            <ul className="divide-y divide-line">
              {top.data.map((t, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{t.product_name}{t.variant_name !== "Default" && <span className="text-muted"> · {t.variant_name}</span>}</span>
                  <span className="text-muted tabular">{formatQty(t.qty_sold)} sold</span>
                  <Money value={t.net_revenue} className="w-28 text-end font-medium" />
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-sm text-muted">No products sold in this period.</p>}
        </Card>
        <Card>
          <CardHeader title="Payments received" description="Including pending transfers; refunds paid out are deducted" />
          <div className="p-4">
            {methods.data?.length ? <BreakdownBars rows={methods.data.map((m) => ({ label: m.label, value: Number(m.amount) }))} />
              : <p className="py-2 text-sm text-muted">No payments in this period.</p>}
          </div>
        </Card>
      </div>
      {summary.data?.financial && c && (
        <Card className="mt-4">
          <CardHeader title="Profit and loss" description="Net sales less cost of goods sold, then operating expenses" />
          <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-5">
            {[["Net sales", c.net_sales], ["Cost of goods", c.cogs], ["Gross profit", c.gross_profit], ["Expenses", c.expenses], ["Operating profit", c.operating_profit]].map(([l, v]) => (
              <div key={l as string} className="bg-surface px-4 py-3">
                <dt className="text-xs text-muted">{l}</dt>
                <dd className="mt-0.5 font-display text-lg font-semibold tabular">{formatMoney(v as number)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </>
  );
}
