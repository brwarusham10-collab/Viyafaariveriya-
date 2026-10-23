import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft, History } from "lucide-react";
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useOrg, useOrgId } from "@/app/org";
import { DateRangePicker, useRange } from "@/components/common/DateRange";
import { ExportMenu } from "@/components/common/ExportMenu";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { addDaysISO, fmtDateTime } from "@/lib/dates";
import { formatQty } from "@/lib/money";
import { supabase, unwrap } from "@/lib/supabase";

const types: Record<string, string> = {
  opening: "Opening", sale: "Sale", refund: "Refund", void: "Void", purchase_receipt: "Received", purchase_return: "Returned to supplier",
  adjustment: "Adjustment", transfer_out: "Transfer out", transfer_in: "Transfer in",
};

interface Row {
  id: string;
  created_at: string;
  movement_type: string;
  qty_change: number;
  qty_after: number;
  unit_cost: number;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  warehouses: { name: string };
  product_variants: { name: string; sku: string | null; products: { name: string } };
}

const PAGE = 100;

export default function MovementsPage() {
  const orgId = useOrgId();
  const { warehouses, can } = useOrg();
  const [params] = useSearchParams();
  const product = params.get("product");
  const [range, setRange] = useRange("30d");
  const [warehouse, setWarehouse] = React.useState("");
  const [type, setType] = React.useState("");

  const q = useInfiniteQuery({
    queryKey: ["movements", orgId, range.from, range.to, warehouse, type, product],
    initialPageParam: 0,
    getNextPageParam: (last: Row[], all) => (last.length === PAGE ? all.length * PAGE : undefined),
    queryFn: async ({ pageParam }) => {
      let s = supabase.from("inventory_movements")
        .select("id, created_at, movement_type, qty_change, qty_after, unit_cost, reason, reference_type, reference_id, warehouses(name), product_variants!inner(name, sku, product_id, products(name))")
        .eq("organization_id", orgId)
        .gte("created_at", `${range.from}T00:00:00+05:00`).lt("created_at", `${addDaysISO(range.to, 1)}T00:00:00+05:00`)
        .order("created_at", { ascending: false }).range(pageParam, pageParam + PAGE - 1);
      if (warehouse) s = s.eq("warehouse_id", warehouse);
      if (type) s = s.eq("movement_type", type);
      if (product) s = s.eq("product_variants.product_id", product);
      return unwrap(await s) as unknown as Row[];
    },
  });
  const rows = q.data?.pages.flat() ?? [];
  const name = (r: Row) => (r.product_variants.name === "Default" ? r.product_variants.products.name : `${r.product_variants.products.name} · ${r.product_variants.name}`);
  const showCost = can("reports.financial") || can("purchases.view");

  return (
    <>
      <Link to="/inventory" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Inventory</Link>
      <PageHeader title="Stock ledger" description="Every stock change, newest first. Balances are always the sum of these entries."
        actions={<ExportMenu rows={rows} filename="stock-ledger" title="Stock ledger" subtitle={`${range.from} to ${range.to}`} columns={[
          { header: "Date", value: (r) => fmtDateTime(r.created_at) }, { header: "Product", value: name }, { header: "SKU", value: (r) => r.product_variants.sku },
          { header: "Location", value: (r) => r.warehouses.name }, { header: "Type", value: (r) => types[r.movement_type] }, { header: "Change", value: (r) => r.qty_change, numeric: true },
          { header: "Balance after", value: (r) => r.qty_after, numeric: true }, ...(showCost ? [{ header: "Unit cost", value: (r: Row) => r.unit_cost, numeric: true }] : []),
          { header: "Reason", value: (r) => r.reason },
        ]} />} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <DateRangePicker value={range} onChange={setRange} />
          <Select aria-label="Location" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="h-8 w-48">
            <option value="">All locations</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Select aria-label="Movement type" value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-44">
            <option value="">All movements</option>
            {Object.entries(types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          {product && <Badge tone="lagoon">Filtered to one product <Link to="/inventory/movements" className="ms-1 underline">clear</Link></Badge>}
        </div>
        <Table>
          <THead><tr><Th>When</Th><Th>Product</Th><Th>Location</Th><Th>Type</Th><Th align="end">Change</Th><Th align="end">After</Th>{showCost && <Th align="end">Unit cost</Th>}<Th>Reason / ref</Th></tr></THead>
          {q.isLoading ? <TableSkeleton cols={7} /> : (
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap text-muted">{fmtDateTime(r.created_at)}</Td>
                  <Td>{name(r)}</Td>
                  <Td className="text-muted">{r.warehouses.name}</Td>
                  <Td><Badge tone={Number(r.qty_change) > 0 ? "ok" : "neutral"}>{types[r.movement_type]}</Badge></Td>
                  <Td align="end" className={Number(r.qty_change) > 0 ? "text-ok" : "text-coral"}>{Number(r.qty_change) > 0 ? "+" : ""}{formatQty(r.qty_change)}</Td>
                  <Td align="end">{formatQty(r.qty_after)}</Td>
                  {showCost && <Td align="end">{Number(r.unit_cost).toFixed(2)}</Td>}
                  <Td className="text-muted">
                    {r.reference_type === "sale" ? <Link className="text-lagoon hover:underline" to={`/sales/${r.reference_id}`}>View sale</Link> : r.reason ?? "—"}
                  </Td>
                </Tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8}><EmptyState icon={History} title="No stock movements in this period" /></td></tr>}
            </tbody>
          )}
        </Table>
        {q.hasNextPage && <div className="border-t border-line p-3 text-center"><Button variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load more</Button></div>}
      </Card>
    </>
  );
}
