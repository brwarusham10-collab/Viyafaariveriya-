import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Search, Star, Tags, Trash2, Upload } from "lucide-react";
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { ExportMenu } from "@/components/common/ExportMenu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Badge, Card, EmptyState, ErrorNotice, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatAmount, formatQty } from "@/lib/money";
import { supabase, toAppError, unwrap } from "@/lib/supabase";
import { ImportDialog } from "./ImportDialog";

export interface ProductRow {
  id: string;
  name: string;
  is_active: boolean;
  is_favorite: boolean;
  track_stock: boolean;
  product_type: string;
  category_id: string | null;
  categories: { name: string } | null;
  brands: { name: string } | null;
  product_variants: { id: string; name: string; sku: string | null; retail_price: number; cost_price: number; is_active: boolean;
    inventory_balances: { qty: number }[]; product_barcodes: { barcode: string }[] }[];
}

function TaxonomyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<"categories" | "brands" | "units">("categories");
  const [name, setName] = React.useState("");
  const [abbr, setAbbr] = React.useState("");
  const [decimal, setDecimal] = React.useState(false);
  const { data = [] } = useQuery({
    queryKey: ["taxonomy", orgId, tab],
    enabled: open,
    queryFn: async () => unwrap(await supabase.from(tab).select("*").eq("organization_id", orgId).order("name")) as { id: string; name: string; abbreviation?: string; allow_decimal?: boolean }[],
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["taxonomy"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["product-options"] });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Categories, brands and units">
        <div className="mb-3 flex gap-1 rounded-md bg-fg/5 p-1">
          {(["categories", "brands", "units"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded px-2 py-1 text-sm capitalize ${tab === t ? "bg-surface font-medium shadow-sm" : "text-muted"}`}>{t}</button>
          ))}
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const row: Record<string, unknown> = { organization_id: orgId, name: name.trim() };
          if (tab === "units") Object.assign(row, { abbreviation: abbr.trim() || name.trim().slice(0, 3), allow_decimal: decimal });
          const { error } = await supabase.from(tab).insert(row);
          if (error) return toast.error(toAppError(error).message);
          setName(""); setAbbr("");
          refresh();
        }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`New ${tab.slice(0, -1).replace("categorie", "category")}`} className="min-w-40 flex-1" />
          {tab === "units" && (
            <>
              <Input value={abbr} onChange={(e) => setAbbr(e.target.value)} placeholder="Short (kg)" className="w-28" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={decimal} onChange={(e) => setDecimal(e.target.checked)} /> Decimals</label>
            </>
          )}
          <Button type="submit"><Plus /> Add</Button>
        </form>
        <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
          {data.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{r.name}{r.abbreviation && <span className="text-muted"> ({r.abbreviation}{r.allow_decimal ? ", decimals" : ""})</span>}</span>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.name}`} onClick={async () => {
                const { error } = await supabase.from(tab).delete().eq("id", r.id);
                if (error) return toast.error("In use by products — reassign them first.");
                refresh();
              }}><Trash2 /></Button>
            </li>
          ))}
          {data.length === 0 && <li className="px-3 py-3 text-sm text-muted">None yet.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsPage() {
  const orgId = useOrgId();
  const { can } = useOrg();
  const navigate = useNavigate();
  const [term, setTerm] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [status, setStatus] = React.useState<"active" | "archived" | "all">("active");
  const [taxonomyOpen, setTaxonomyOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const categories = useQuery({
    queryKey: ["categories", orgId],
    queryFn: async () => unwrap(await supabase.from("categories").select("id, name").eq("organization_id", orgId).order("name")) as { id: string; name: string }[],
  });
  const products = useQuery({
    queryKey: ["products", orgId, status, category],
    queryFn: async () => {
      let q = supabase.from("products")
        .select("id, name, is_active, is_favorite, track_stock, product_type, category_id, categories(name), brands(name), product_variants(id, name, sku, retail_price, cost_price, is_active, inventory_balances(qty), product_barcodes(barcode))")
        .eq("organization_id", orgId).order("name").limit(2000);
      if (status !== "all") q = q.eq("is_active", status === "active");
      if (category) q = q.eq("category_id", category);
      return unwrap(await q) as unknown as ProductRow[];
    },
  });

  const rows = React.useMemo(() => {
    const t = term.trim().toLowerCase();
    return (products.data ?? []).filter((p) => !t || p.name.toLowerCase().includes(t) ||
      p.product_variants.some((v) => v.sku?.toLowerCase().includes(t) || v.product_barcodes.some((b) => b.barcode.includes(t))));
  }, [products.data, term]);

  const stockOf = (p: ProductRow) => p.product_variants.reduce((s, v) => s + v.inventory_balances.reduce((a, b) => a + Number(b.qty), 0), 0);
  const priceRange = (p: ProductRow) => {
    const prices = p.product_variants.map((v) => Number(v.retail_price));
    const lo = Math.min(...prices), hi = Math.max(...prices);
    return lo === hi ? formatAmount(lo) : `${formatAmount(lo)} – ${formatAmount(hi)}`;
  };

  return (
    <>
      <PageHeader title="Products" description="Everything you sell. Each product has one or more variants with their own SKU, barcode and price."
        actions={
          <>
            <ExportMenu rows={rows.flatMap((p) => p.product_variants.map((v) => ({ p, v })))} filename="products" title="Products"
              columns={[
                { header: "Product", value: (r) => r.p.name },
                { header: "Variant", value: (r) => r.v.name },
                { header: "SKU", value: (r) => r.v.sku },
                { header: "Barcodes", value: (r) => r.v.product_barcodes.map((b) => b.barcode).join(" ") },
                { header: "Category", value: (r) => r.p.categories?.name },
                { header: "Retail price", value: (r) => r.v.retail_price, numeric: true },
                { header: "Cost price", value: (r) => r.v.cost_price, numeric: true },
                { header: "On hand", value: (r) => r.v.inventory_balances.reduce((a, b) => a + Number(b.qty), 0), numeric: true },
              ]} />
            {can("products.manage") && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}><Upload /> Import CSV</Button>
                <Button variant="secondary" size="sm" onClick={() => setTaxonomyOpen(true)}><Tags /> Categories</Button>
                <Button size="sm" asChild><Link to="/products/new"><Plus /> New product</Link></Button>
              </>
            )}
          </>
        } />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name, SKU or barcode" className="ps-9" aria-label="Search products" />
          </div>
          <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-44">
            <option value="">All categories</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-32">
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </Select>
        </div>
        {products.error ? <div className="p-4"><ErrorNotice error={products.error} onRetry={() => products.refetch()} /></div> : (
          <Table>
            <THead>
              <tr><Th>Product</Th><Th>Category</Th><Th>SKU</Th><Th align="end">Price (MVR)</Th><Th align="end">On hand</Th></tr>
            </THead>
            {products.isLoading ? <TableSkeleton cols={5} /> : (
              <tbody>
                {rows.map((p) => (
                  <Tr key={p.id} onClick={() => navigate(`/products/${p.id}`)}>
                    <Td>
                      <div className="flex items-center gap-2 font-medium">
                        {p.is_favorite && <Star className="size-3.5 fill-saffron text-saffron" aria-label="Favourite" />}
                        {p.name}
                        {!p.is_active && <Badge>Archived</Badge>}
                      </div>
                      {p.product_variants.length > 1 && <div className="text-xs text-muted">{p.product_variants.length} variants</div>}
                    </Td>
                    <Td className="text-muted">{p.categories?.name ?? "—"}</Td>
                    <Td className="text-muted">{p.product_variants.length === 1 ? p.product_variants[0].sku ?? "—" : "—"}</Td>
                    <Td align="end">{priceRange(p)}</Td>
                    <Td align="end">{p.track_stock ? formatQty(stockOf(p)) : <span className="text-muted">Not tracked</span>}</Td>
                  </Tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5}>
                    <EmptyState icon={Package} title={term ? "No matching products" : "No products yet"}
                      action={can("products.manage") && !term ? <Button asChild><Link to="/products/new"><Plus /> Add your first product</Link></Button> : undefined}>
                      {term ? "Try another name, SKU or barcode." : "Add products one at a time or import a CSV."}
                    </EmptyState>
                  </td></tr>
                )}
              </tbody>
            )}
          </Table>
        )}
      </Card>
      <TaxonomyDialog open={taxonomyOpen} onOpenChange={setTaxonomyOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}
