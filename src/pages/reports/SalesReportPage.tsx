import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useOrg, useOrgId } from "@/app/org";
import { SalesChart } from "@/components/charts/SalesChart";
import { DateRangePicker, useRange } from "@/components/common/DateRange";
import { ExportMenu } from "@/components/common/ExportMenu";
import { Select } from "@/components/ui/input";
import { Card, CardHeader, Money, PageHeader, Skeleton, Stat } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { rpc } from "@/lib/supabase";
import { bucketFor, bucketLabel, delta, type Summary } from "../dashboard/DashboardPage";

interface ProductRow { variant_id: string; product_name: string; variant_name: string; sku: string | null; category: string | null; qty_sold: number; net_revenue: number; cost: number | null; profit: number | null; on_hand: number }
interface BreakdownRow { key: string; label: string; orders: number; amount: number; net_amount: number | null }
interface Receivable { customer_id: string; customer_name: string; phone: string | null; credit_limit: number; balance: number; current_0_30: number; days_31_60: number; days_61_90: number; over_90: number }

const dims = { category: "Category", payment_method: "Payment method", cashier: "Cashier", outlet: "Outlet" } as const;

export default function SalesReportPage() {
  const orgId = useOrgId();
  const { outlets, can } = useOrg();
  const [range, setRange] = useRange("30d");
  const [outlet, setOutlet] = React.useState("");
  const [bucket, setBucket] = React.useState<string>("");
  const [dim, setDim] = React.useState<keyof typeof dims>("category");
  const [order, setOrder] = React.useState<"top" | "qty" | "slow">("top");
  const o = outlet || null;
  const b = bucket || bucketFor(range.from, range.to);
  const args = { p_org: orgId, p_from: range.from, p_to: range.to, p_outlet: o };

  const summary = useQuery({ queryKey: ["report-summary", orgId, range.from, range.to, o], queryFn: () => rpc<Summary>("report_sales_summary", args) });
  const series = useQuery({ queryKey: ["report-series", orgId, range.from, range.to, o, b], queryFn: () => rpc<{ bucket: string; orders: number; sales_total: number; net_sales: number; refunds: number }[]>("report_sales_timeseries", { ...args, p_bucket: b }) });
  const breakdown = useQuery({ queryKey: ["report-breakdown", orgId, range.from, range.to, o, dim], queryFn: () => rpc<BreakdownRow[]>("report_sales_breakdown", { ...args, p_dimension: dim }) });
  const products = useQuery({ queryKey: ["report-products", orgId, range.from, range.to, o, order], queryFn: () => rpc<ProductRow[]>("report_product_performance", { ...args, p_order: order, p_limit: 100 }) });
  const receivables = useQuery({ queryKey: ["report-receivables", orgId], enabled: can("customers.view"), queryFn: () => rpc<Receivable[]>("report_receivables", { p_org: orgId }) });

  const c = summary.data?.current;
  const p = summary.data?.previous;
  const fin = summary.data?.financial;
  const subtitle = `${fmtDate(range.from)} – ${fmtDate(range.to)}${outlet ? ` · ${outlets.find((x) => x.id === outlet)?.name}` : ""}`;

  return (
    <>
      <PageHeader title="Sales report" description={subtitle} actions={
        <>
          {outlets.length > 1 && <Select aria-label="Outlet" value={outlet} onChange={(e) => setOutlet(e.target.value)} className="h-8 w-40"><option value="">All outlets</option>{outlets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}
          <DateRangePicker value={range} onChange={setRange} />
        </>
      } />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Gross sales" loading={summary.isLoading} value={formatMoney(c?.gross_sales)} delta={delta(c?.gross_sales, p?.gross_sales)} />
        <Stat label="Discounts" loading={summary.isLoading} value={formatMoney(c?.discounts)} />
        <Stat label="Refunds" loading={summary.isLoading} value={formatMoney(c?.refunds)} hint={c && `${c.refund_count}`} />
        <Stat label="Net sales (excl. tax)" loading={summary.isLoading} value={formatMoney(c?.net_sales)} delta={delta(c?.net_sales, p?.net_sales)} />
        <Stat label="Tax" loading={summary.isLoading} value={formatMoney(c?.tax)} />
        <Stat label="Orders · avg" loading={summary.isLoading} value={c?.orders ?? 0} hint={c && formatMoney(c.aov)} delta={delta(c?.orders, p?.orders)} />
      </div>
      {fin && c && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Cost of goods sold" value={formatMoney(c.cogs)} />
          <Stat label="Gross profit" value={formatMoney(c.gross_profit)} hint={c.gross_margin !== null ? `${c.gross_margin}% margin` : undefined} delta={delta(c.gross_profit, p?.gross_profit)} />
          <Stat label="Operating expenses" value={formatMoney(c.expenses)} />
          <Stat label="Operating profit" value={formatMoney(c.operating_profit)} delta={delta(c.operating_profit, p?.operating_profit)} />
        </div>
      )}
      <Card className="mt-4">
        <CardHeader title="Net sales over time" action={
          <div className="flex items-center gap-2">
            <Select aria-label="Group by" value={bucket} onChange={(e) => setBucket(e.target.value)} className="h-8 w-32">
              <option value="">Automatic</option><option value="hour">By hour</option><option value="day">By day</option><option value="week">By week</option><option value="month">By month</option>
            </Select>
            <ExportMenu rows={series.data ?? []} filename="sales-over-time" title="Net sales over time" subtitle={subtitle} columns={[
              { header: "Period", value: (r) => r.bucket.slice(0, 16).replace("T", " ") }, { header: "Orders", value: (r) => r.orders, numeric: true },
              { header: "Sales incl. tax", value: (r) => r.sales_total, numeric: true }, { header: "Refunds", value: (r) => r.refunds, numeric: true }, { header: "Net sales", value: (r) => r.net_sales, numeric: true }]} />
          </div>} />
        <div className="px-2 py-3">{series.isLoading ? <Skeleton className="mx-2 h-[260px]" /> :
          <SalesChart height={260} data={(series.data ?? []).map((r) => ({ label: bucketLabel(r.bucket, b), value: Number(r.net_sales), orders: Number(r.orders) }))} />}</div>
      </Card>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader title="Breakdown" action={
            <div className="flex items-center gap-2">
              <Select aria-label="Dimension" value={dim} onChange={(e) => setDim(e.target.value as keyof typeof dims)} className="h-8 w-40">
                {Object.entries(dims).map(([k, l]) => <option key={k} value={k}>By {l.toLowerCase()}</option>)}
              </Select>
              <ExportMenu rows={breakdown.data ?? []} filename={`sales-by-${dim}`} title={`Sales by ${dims[dim].toLowerCase()}`} subtitle={subtitle} columns={[
                { header: dims[dim], value: (r) => r.label }, { header: "Orders", value: (r) => r.orders, numeric: true }, { header: "Amount", value: (r) => r.amount, numeric: true },
                ...(dim !== "payment_method" ? [{ header: "Net (excl. tax)", value: (r: BreakdownRow) => r.net_amount, numeric: true }] : [])]} />
            </div>} />
          <Table>
            <THead><tr><Th>{dims[dim]}</Th><Th align="end">Orders</Th><Th align="end">{dim === "payment_method" ? "Received" : "Sales"}</Th>{dim !== "payment_method" && <Th align="end">Net</Th>}</tr></THead>
            {breakdown.isLoading ? <TableSkeleton cols={3} rows={4} /> : (
              <tbody>{breakdown.data?.map((r) => <Tr key={r.key + r.label}><Td>{r.label}</Td><Td align="end">{r.orders}</Td><Td align="end"><Money value={r.amount} plain /></Td>{dim !== "payment_method" && <Td align="end"><Money value={r.net_amount} plain /></Td>}</Tr>)}
                {breakdown.data?.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-muted">No sales.</td></tr>}</tbody>
            )}
          </Table>
        </Card>
        <Card>
          <CardHeader title="Products" action={
            <div className="flex items-center gap-2">
              <Select aria-label="Sort products" value={order} onChange={(e) => setOrder(e.target.value as typeof order)} className="h-8 w-44">
                <option value="top">Top by revenue</option><option value="qty">Top by quantity</option><option value="slow">Slow movers (in stock)</option>
              </Select>
              <ExportMenu rows={products.data ?? []} filename={`products-${order}`} title="Product performance" subtitle={subtitle} columns={[
                { header: "Product", value: (r) => r.variant_name === "Default" ? r.product_name : `${r.product_name} · ${r.variant_name}` }, { header: "SKU", value: (r) => r.sku },
                { header: "Category", value: (r) => r.category }, { header: "Qty sold", value: (r) => r.qty_sold, numeric: true }, { header: "Net revenue", value: (r) => r.net_revenue, numeric: true },
                ...(fin ? [{ header: "Cost", value: (r: ProductRow) => r.cost, numeric: true }, { header: "Profit", value: (r: ProductRow) => r.profit, numeric: true }] : []),
                { header: "On hand", value: (r) => r.on_hand, numeric: true }]} />
            </div>} />
          <Table>
            <THead><tr><Th>Product</Th><Th align="end">Sold</Th><Th align="end">Net revenue</Th>{fin && <Th align="end">Profit</Th>}<Th align="end">On hand</Th></tr></THead>
            {products.isLoading ? <TableSkeleton cols={4} /> : (
              <tbody>
                {products.data?.map((r) => (
                  <Tr key={r.variant_id}>
                    <Td>{r.product_name}{r.variant_name !== "Default" && <span className="text-muted"> · {r.variant_name}</span>}</Td>
                    <Td align="end">{formatQty(r.qty_sold)}</Td><Td align="end"><Money value={r.net_revenue} plain /></Td>
                    {fin && <Td align="end" className={Number(r.profit) < 0 ? "text-coral" : ""}><Money value={r.profit} plain /></Td>}
                    <Td align="end" className="text-muted">{formatQty(r.on_hand)}</Td>
                  </Tr>
                ))}
                {products.data?.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">No products.</td></tr>}
              </tbody>
            )}
          </Table>
        </Card>
      </div>
      {can("customers.view") && (
        <Card className="mt-4">
          <CardHeader title="Receivables ageing" description="Balances owed by credit customers, oldest charges assumed unpaid first."
            action={<ExportMenu rows={receivables.data ?? []} filename="receivables" title="Receivables ageing" columns={[
              { header: "Customer", value: (r) => r.customer_name }, { header: "Phone", value: (r) => r.phone }, { header: "Limit", value: (r) => r.credit_limit, numeric: true },
              { header: "0-30", value: (r) => r.current_0_30, numeric: true }, { header: "31-60", value: (r) => r.days_31_60, numeric: true }, { header: "61-90", value: (r) => r.days_61_90, numeric: true },
              { header: "90+", value: (r) => r.over_90, numeric: true }, { header: "Balance", value: (r) => r.balance, numeric: true }]} />} />
          <Table>
            <THead><tr><Th>Customer</Th><Th align="end">0–30 days</Th><Th align="end">31–60</Th><Th align="end">61–90</Th><Th align="end">90+</Th><Th align="end">Balance</Th></tr></THead>
            <tbody>
              {receivables.data?.map((r) => (
                <Tr key={r.customer_id}><Td>{r.customer_name}</Td><Td align="end"><Money value={r.current_0_30} plain /></Td><Td align="end"><Money value={r.days_31_60} plain /></Td>
                  <Td align="end"><Money value={r.days_61_90} plain /></Td><Td align="end" className={Number(r.over_90) > 0 ? "text-coral" : ""}><Money value={r.over_90} plain /></Td><Td align="end" className="font-medium"><Money value={r.balance} plain /></Td></Tr>
              ))}
              {receivables.data?.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-muted">No outstanding balances.</td></tr>}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
