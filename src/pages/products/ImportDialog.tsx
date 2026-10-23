import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileDown } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/misc";
import { IMPORT_COLUMNS, validateImport, type ImportRow } from "@/lib/csv";
import { rpc, supabase, unwrap } from "@/lib/supabase";

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const orgId = useOrgId();
  const { outlet, can } = useOrg();
  const qc = useQueryClient();
  const [rows, setRows] = React.useState<ImportRow[] | null>(null);
  const [headerError, setHeaderError] = React.useState<string>();
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);

  React.useEffect(() => {
    if (open) { setRows(null); setHeaderError(undefined); setProgress(null); }
  }, [open]);

  async function onFile(file: File) {
    const text = await file.text();
    const [skus, barcodes] = await Promise.all([
      supabase.from("product_variants").select("sku").eq("organization_id", orgId).not("sku", "is", null),
      supabase.from("product_barcodes").select("barcode").eq("organization_id", orgId),
    ]);
    const res = validateImport(text,
      new Set((unwrap(skus) as { sku: string }[]).map((s) => s.sku.toLowerCase())),
      new Set((unwrap(barcodes) as { barcode: string }[]).map((b) => b.barcode)));
    setHeaderError(res.headerError);
    setRows(res.rows);
  }

  const valid = rows?.filter((r) => r.errors.length === 0) ?? [];

  async function run() {
    const byProduct = new Map<string, ImportRow[]>();
    for (const r of valid) byProduct.set(r.name, [...(byProduct.get(r.name) ?? []), r]);
    const cats = unwrap(await supabase.from("categories").select("id, name").eq("organization_id", orgId)) as { id: string; name: string }[];
    const catId = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
    setProgress({ done: 0, total: byProduct.size });
    let done = 0;
    const failures: string[] = [];
    for (const [name, group] of byProduct) {
      try {
        const catName = group[0].category;
        if (catName && !catId.has(catName.toLowerCase())) {
          const c = unwrap(await supabase.from("categories").insert({ organization_id: orgId, name: catName }).select("id").single()) as { id: string };
          catId.set(catName.toLowerCase(), c.id);
        }
        await rpc("create_product", { payload: {
          organization_id: orgId, name, category_id: catName ? catId.get(catName.toLowerCase()) : null,
          variants: group.map((r) => ({
            name: r.variant || "Default", sku: r.sku || null, retail_price: r.retail_price, cost_price: r.cost_price || "0",
            wholesale_price: r.wholesale_price || null, min_stock: r.min_stock || 0, barcodes: r.barcode ? [r.barcode] : [],
            opening_stock: r.opening_stock && Number(r.opening_stock) !== 0 && outlet?.default_warehouse_id && can("inventory.adjust")
              ? [{ warehouse_id: outlet.default_warehouse_id, qty: r.opening_stock, unit_cost: r.cost_price || "0" }] : [],
          })),
        } });
      } catch (e) {
        failures.push(`${name}: ${(e as Error).message}`);
      }
      setProgress({ done: ++done, total: byProduct.size });
    }
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["pos-catalog"] });
    if (failures.length) toast.error(`${failures.length} products failed: ${failures.slice(0, 3).join("; ")}`);
    else toast.success(`Imported ${byProduct.size} products`);
    onOpenChange(false);
  }

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_COLUMNS.join(",") + "\nTuna chunks 185g,Default,TUNA-185,4791234500017,Groceries,18.50,12.00,16.00,48,12\nT-shirt,Blue / M,TS-BL-M,,Clothing,150.00,70.00,,10,2\n")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Import products from CSV" wide
        description={`Rows with the same name become variants of one product. Opening stock goes to ${outlet?.name ?? "the current outlet"}.`}>
        {!rows ? (
          <div className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line-strong px-6 py-10 text-center hover:border-lagoon">
              <span className="font-medium">Choose a CSV file</span>
              <span className="mt-1 text-sm text-muted">Columns: {IMPORT_COLUMNS.join(", ")}</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <a href={template} download="product-import-template.csv" className="inline-flex items-center gap-2 text-sm text-lagoon hover:underline">
              <FileDown className="size-4" /> Download the template
            </a>
          </div>
        ) : headerError ? (
          <p className="text-sm text-coral">{headerError}</p>
        ) : (
          <>
            <div className="mb-3 flex gap-2 text-sm">
              <Badge tone="ok">{valid.length} ready</Badge>
              {rows.length - valid.length > 0 && <Badge tone="coral">{rows.length - valid.length} with problems (skipped)</Badge>}
            </div>
            <div className="max-h-80 overflow-auto rounded-md border border-line text-xs">
              <table className="w-full">
                <thead className="sticky top-0 bg-surface-2 text-muted">
                  <tr><th className="px-2 py-1.5 text-start">Line</th><th className="px-2 text-start">Name</th><th className="px-2 text-start">Variant</th><th className="px-2 text-start">SKU</th><th className="px-2 text-end">Price</th><th className="px-2 text-end">Stock</th><th className="px-2 text-start">Status</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line} className="border-t border-line">
                      <td className="px-2 py-1.5 text-muted">{r.line}</td>
                      <td className="px-2">{r.name}</td>
                      <td className="px-2">{r.variant || "Default"}</td>
                      <td className="px-2">{r.sku}</td>
                      <td className="px-2 text-end tabular">{r.retail_price}</td>
                      <td className="px-2 text-end tabular">{r.opening_stock}</td>
                      <td className="px-2">{r.errors.length ? <span className="text-coral">{r.errors.join("; ")}</span> : <CheckCircle2 className="size-4 text-ok" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <DialogFooter>
          {rows && <Button variant="secondary" onClick={() => setRows(null)}>Choose another file</Button>}
          <Button disabled={!valid.length || !!progress} loading={!!progress} onClick={run}>
            {progress ? `Importing ${progress.done}/${progress.total}` : `Import ${valid.length} rows`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
