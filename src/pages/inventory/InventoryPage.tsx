import { useQuery } from "@tanstack/react-query";
import { Boxes, History, Search, SlidersHorizontal } from "lucide-react";
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useOrg, useOrgId } from "@/app/org";
import { ExportMenu } from "@/components/common/ExportMenu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, Card, EmptyState, ErrorNotice, Money, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatQty } from "@/lib/money";
import { supabase, unwrap } from "@/lib/supabase";
import { AdjustDialog } from "./AdjustDialog";
import type { VariantOption } from "@/components/common/VariantPicker";

interface Row {
  id: string;
  name: string;
  sku: string | null;
  min_stock: number;
  cost_price: number;
  retail_price: number;
  products: { id: string; name: string; track_stock: boolean; is_active: boolean; categories: { name: string } | null };
  inventory_balances: { warehouse_id: string; qty: number; avg_cost: number }[];
}

export default function InventoryPage() {
  const orgId = useOrgId();
  const { warehouses, outlet, can } = useOrg();
  const [params] = useSearchParams();
  const [warehouse, setWarehouse] = React.useState<string>(outlet?.default_warehouse_id ?? "");
  const [term, setTerm] = React.useState("");
  const [lowOnly, setLowOnly] = React.useState(params.get("filter") === "low");
  const [adjust, setAdjust] = React.useState<{ open: boolean; initial: VariantOption | null }>({ open: false, initial: null });
  const showCost = can("reports.financial") || can("purchases.view");

  React.useEffect(() => { if (!warehouse && outlet?.default_warehouse_id) setWarehouse(outlet.default_warehouse_id); }, [outlet, warehouse]);

  const stock = useQuery({
    queryKey: ["stock", orgId],
    queryFn: async () => unwrap(await supabase.from("product_variants")
      .select("id, name, sku, min_stock, cost_price, retail_price, products!inner(id, name, track_stock, is_active, categories(name)), inventory_balances(warehouse_id, qty, avg_cost)")
      .eq("organization_id", orgId).eq("products.track_stock", true).eq("products.is_active", true).eq("is_active", true).limit(5000)) as unknown as Row[],
  });

  const rows = React.useMemo(() => {
    const t = term.trim().toLowerCase();
    return (stock.data ?? []).map((r) => {
      const bals = r.inventory_balances.filter((b) => !warehouse || b.warehouse_id === warehouse);
      const qty = bals.reduce((s, b) => s + Number(b.qty), 0);
      const value = bals.reduce((s, b) => s + Number(b.qty) * Number(b.avg_cost), 0);
      return { ...r, qty, value, avg: qty ? value / qty : Number(bals[0]?.avg_cost ?? 0), low: Number(r.min_stock) > 0 && qty <= Number(r.min_stock) };
    }).filter((r) => (!lowOnly || r.low) && (!t || `${r.products.name} ${r.name} ${r.sku ?? ""}`.toLowerCase().includes(t)))
      .sort((a, b) => a.products.name.localeCompare(b.products.name) || a.name.localeCompare(b.name));
  }, [stock.data, warehouse, term, lowOnly]);

  const label = (r: Row) => (r.name === "Default" ? r.products.name : `${r.products.name} · ${r.name}`);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const whName = warehouses.find((w) => w.id === warehouse)?.name ?? "All locations";

  return (
    <>
      <PageHeader title="Inventory" description="On-hand stock by location. Every change is recorded in the stock ledger."
        actions={
          <>
            <Button variant="secondary" size="sm" asChild><Link to="/inventory/movements"><History /> Stock ledger</Link></Button>
            <ExportMenu rows={rows} filename={`stock-${whName}`} title={`Stock on hand — ${whName}`} columns={[
              { header: "Product", value: (r) => label(r) }, { header: "SKU", value: (r) => r.sku }, { header: "Category", value: (r) => r.products.categories?.name },
              { header: "On hand", value: (r) => r.qty, numeric: true }, { header: "Minimum", value: (r) => r.min_stock, numeric: true },
              ...(showCost ? [{ header: "Avg cost", value: (r: typeof rows[number]) => r.avg.toFixed(4), numeric: true }, { header: "Value", value: (r: typeof rows[number]) => r.value.toFixed(2), numeric: true }] : []),
            ]} />
            {can("inventory.adjust") && <Button size="sm" onClick={() => setAdjust({ open: true, initial: null })}><SlidersHorizontal /> Adjust stock</Button>}
          </>
        } />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search products" className="ps-9" aria-label="Search stock" />
          </div>
          <Select aria-label="Location" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="w-52">
            <option value="">All locations</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="accent-[var(--lagoon)]" /> Low stock only</label>
          {showCost && <span className="ms-auto text-sm text-muted">Stock value <Money value={totalValue} className="font-semibold text-fg" /></span>}
        </div>
        {stock.error ? <div className="p-4"><ErrorNotice error={stock.error} /></div> : (
          <Table>
            <THead><tr><Th>Product</Th><Th>SKU</Th><Th align="end">On hand</Th><Th align="end">Minimum</Th>{showCost && <Th align="end">Avg cost</Th>}{showCost && <Th align="end">Value</Th>}<Th /></tr></THead>
            {stock.isLoading ? <TableSkeleton cols={6} /> : (
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td><Link to={`/products/${r.products.id}`} className="font-medium hover:underline">{label(r)}</Link>
                      {r.products.categories && <div className="text-xs text-muted">{r.products.categories.name}</div>}</Td>
                    <Td className="text-muted">{r.sku ?? "—"}</Td>
                    <Td align="end"><span className={r.qty < 0 ? "text-coral" : ""}>{formatQty(r.qty)}</span>{r.low && <Badge tone="saffron" className="ms-2">Low</Badge>}</Td>
                    <Td align="end" className="text-muted">{formatQty(r.min_stock)}</Td>
                    {showCost && <Td align="end">{r.avg.toFixed(2)}</Td>}
                    {showCost && <Td align="end"><Money value={r.value} plain /></Td>}
                    <Td align="end">
                      {can("inventory.adjust") && <Button variant="ghost" size="sm" onClick={() => setAdjust({ open: true, initial: { id: r.id, name: r.name, sku: r.sku, cost_price: r.cost_price, retail_price: r.retail_price, products: { name: r.products.name, track_stock: true } } })}>Adjust</Button>}
                    </Td>
                  </Tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7}><EmptyState icon={Boxes} title={lowOnly ? "Nothing is below its minimum" : "No stocked products"}>{lowOnly ? "Set minimum stock on products to get low-stock alerts." : "Products that track stock appear here."}</EmptyState></td></tr>}
              </tbody>
            )}
          </Table>
        )}
      </Card>
      <AdjustDialog open={adjust.open} initial={adjust.initial} onOpenChange={(o) => setAdjust((a) => ({ ...a, open: o }))} />
    </>
  );
}
