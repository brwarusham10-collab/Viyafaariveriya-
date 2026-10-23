import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useOrg, useOrgId } from "@/app/org";
import { DateRangePicker, useRange } from "@/components/common/DateRange";
import { ExportMenu } from "@/components/common/ExportMenu";
import { Select } from "@/components/ui/input";
import { Card, CardHeader, Money, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { rpc } from "@/lib/supabase";

interface Val { variant_id: string; product_name: string; variant_name: string; sku: string | null; category: string | null; warehouse: string; qty: number; avg_cost: number | null; stock_value: number | null; retail_value: number; min_stock: number; last_received_at: string | null; last_sold_at: string | null }

const ageBucket = (r: Val) => {
  const ref = r.last_sold_at ?? r.last_received_at;
  if (!ref) return "No activity";
  const days = (Date.now() - new Date(ref).getTime()) / 86_400_000;
  return days <= 30 ? "0–30 days" : days <= 60 ? "31–60 days" : days <= 90 ? "61–90 days" : "Over 90 days";
};

export default function InventoryReportPage() {
  const orgId = useOrgId();
  const { warehouses, can } = useOrg();
  const [warehouse, setWarehouse] = React.useState("");
  const [range, setRange] = useRange("30d");
  const fin = can("reports.financial") || can("purchases.view");
  const val = useQuery({ queryKey: ["inv-valuation", orgId, warehouse], queryFn: () => rpc<Val[]>("report_inventory_valuation", { p_org: orgId, p_warehouse: warehouse || null }) });
  const shrink = useQuery({ queryKey: ["inv-shrink", orgId, range.from, range.to], enabled: can("reports.financial"),
    queryFn: () => rpc<{ reason: string; movements: number; qty: number; cost_value: number }[]>("report_shrinkage", { p_org: orgId, p_from: range.from, p_to: range.to }) });
  const suppliers = useQuery({ queryKey: ["supplier-purchases", orgId, range.from, range.to], enabled: can("purchases.view"),
    queryFn: () => rpc<{ supplier_id: string; supplier: string; receipts: number; items_value: number; landed_value: number; returns_value: number; open_po_value: number }[]>("report_supplier_purchases", { p_org: orgId, p_from: range.from, p_to: range.to }) });
  const rows = val.data ?? [];
  const totals = rows.reduce((s, r) => ({ cost: s.cost + Number(r.stock_value ?? 0), retail: s.retail + Number(r.retail_value), units: s.units + Number(r.qty) }), { cost: 0, retail: 0, units: 0 });
  const aging = Object.entries(rows.filter((r) => Number(r.qty) > 0).reduce<Record<string, { lines: number; value: number }>>((m, r) => {
    const k = ageBucket(r); m[k] = { lines: (m[k]?.lines ?? 0) + 1, value: (m[k]?.value ?? 0) + Number(r.stock_value ?? r.retail_value) }; return m;
  }, {}));
  const name = (r: Val) => (r.variant_name === "Default" ? r.product_name : `${r.product_name} · ${r.variant_name}`);

  return (
    <>
      <PageHeader title="Inventory report" description="Valued at weighted-average cost, including freight and duty captured on receipt."
        actions={<Select aria-label="Location" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="h-8 w-48"><option value="">All locations</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {fin && <Stat label="Stock value at cost" value={formatMoney(totals.cost)} loading={val.isLoading} />}
        <Stat label="Stock value at retail" value={formatMoney(totals.retail)} loading={val.isLoading} />
        <Stat label="Units on hand" value={formatQty(totals.units)} loading={val.isLoading} />
        <Stat label="Stock lines" value={rows.length} loading={val.isLoading} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Valuation" action={<ExportMenu rows={rows} filename="inventory-valuation" title="Inventory valuation" columns={[
            { header: "Product", value: name }, { header: "SKU", value: (r) => r.sku }, { header: "Category", value: (r) => r.category }, { header: "Location", value: (r) => r.warehouse },
            { header: "Qty", value: (r) => r.qty, numeric: true }, ...(fin ? [{ header: "Avg cost", value: (r: Val) => r.avg_cost, numeric: true }, { header: "Value at cost", value: (r: Val) => r.stock_value, numeric: true }] : []),
            { header: "Value at retail", value: (r) => r.retail_value, numeric: true }, { header: "Last received", value: (r) => fmtDate(r.last_received_at) }, { header: "Last sold", value: (r) => fmtDate(r.last_sold_at) }]} />} />
          <Table className="max-h-[560px]">
            <THead><tr><Th>Product</Th><Th>Location</Th><Th align="end">Qty</Th>{fin && <Th align="end">Avg cost</Th>}{fin && <Th align="end">Value</Th>}<Th>Last sold</Th></tr></THead>
            {val.isLoading ? <TableSkeleton cols={6} /> : (
              <tbody>{rows.map((r) => (
                <Tr key={r.variant_id + r.warehouse}><Td>{name(r)}</Td><Td className="text-muted">{r.warehouse}</Td><Td align="end" className={Number(r.qty) < 0 ? "text-coral" : ""}>{formatQty(r.qty)}</Td>
                  {fin && <Td align="end">{Number(r.avg_cost).toFixed(2)}</Td>}{fin && <Td align="end"><Money value={r.stock_value} plain /></Td>}<Td className="text-muted">{fmtDate(r.last_sold_at)}</Td></Tr>
              ))}</tbody>
            )}
          </Table>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Stock ageing" description="Days since each line last sold (or was received)" />
            <ul className="divide-y divide-line text-sm">
              {["0–30 days", "31–60 days", "61–90 days", "Over 90 days", "No activity"].map((k) => {
                const a = aging.find(([x]) => x === k)?.[1];
                return <li key={k} className="flex justify-between px-4 py-2"><span>{k}</span><span className="tabular text-muted">{a?.lines ?? 0} lines · <Money value={a?.value ?? 0} plain className="text-fg" /></span></li>;
              })}
            </ul>
          </Card>
          {can("reports.financial") && (
            <Card>
              <CardHeader title="Shrinkage" description="Stock written off by reason" action={<DateRangePicker value={range} onChange={setRange} />} />
              <ul className="divide-y divide-line text-sm">
                {shrink.data?.map((s) => <li key={s.reason} className="flex justify-between px-4 py-2"><span className="capitalize">{s.reason.replace("_", " ")}</span><span className="tabular">{formatQty(s.qty)} units · <Money value={s.cost_value} plain /></span></li>)}
                {shrink.data?.length === 0 && <li className="px-4 py-3 text-muted">No write-offs in this period.</li>}
              </ul>
            </Card>
          )}
        </div>
      </div>
      {can("purchases.view") && (
        <Card className="mt-4">
          <CardHeader title="Supplier purchases" description={`${fmtDate(range.from)} – ${fmtDate(range.to)}`} action={<ExportMenu rows={suppliers.data ?? []} filename="supplier-purchases" title="Supplier purchases" columns={[
            { header: "Supplier", value: (r) => r.supplier }, { header: "Receipts", value: (r) => r.receipts, numeric: true }, { header: "Items value", value: (r) => r.items_value, numeric: true },
            { header: "Landed value", value: (r) => r.landed_value, numeric: true }, { header: "Returns", value: (r) => r.returns_value, numeric: true }, { header: "Open orders", value: (r) => r.open_po_value, numeric: true }]} />} />
          <Table>
            <THead><tr><Th>Supplier</Th><Th align="end">Receipts</Th><Th align="end">Items value</Th><Th align="end">Landed value</Th><Th align="end">Returns</Th><Th align="end">On order</Th></tr></THead>
            <tbody>{suppliers.data?.map((s) => (
              <Tr key={s.supplier_id}><Td>{s.supplier}</Td><Td align="end">{s.receipts}</Td><Td align="end"><Money value={s.items_value} plain /></Td><Td align="end" className="font-medium"><Money value={s.landed_value} plain /></Td>
                <Td align="end"><Money value={s.returns_value} plain /></Td><Td align="end" className="text-muted"><Money value={s.open_po_value} plain /></Td></Tr>
            ))}</tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
