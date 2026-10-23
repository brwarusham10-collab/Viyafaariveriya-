import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Grid3x3, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Card, CardHeader, ErrorNotice, PageHeader, Skeleton } from "@/components/ui/misc";
import { formatQty } from "@/lib/money";
import { rpc, supabase, toAppError, unwrap } from "@/lib/supabase";
import { uuid } from "@/lib/utils";

interface VariantDraft {
  key: string;
  id?: string;
  name: string;
  sku: string;
  barcodes: string;
  retail_price: string;
  wholesale_price: string;
  cost_price: string;
  min_stock: string;
  reorder_qty: string;
  opening_stock: string;
  is_active: boolean;
  attributes: Record<string, string>;
  on_hand?: number;
  originalBarcodes?: string[];
}

const blankVariant = (name = "Default"): VariantDraft => ({
  key: uuid(), name, sku: "", barcodes: "", retail_price: "", wholesale_price: "", cost_price: "", min_stock: "0", reorder_qty: "0",
  opening_stock: "", is_active: true, attributes: {},
});

const moneyOk = (v: string, required = false) => (v === "" ? !required : /^\d+(\.\d{1,2})?$/.test(v));
const qtyOk = (v: string) => v === "" || /^\d+(\.\d{1,3})?$/.test(v);

function MatrixDialog({ open, onOpenChange, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; onApply: (v: VariantDraft[]) => void }) {
  const [options, setOptions] = React.useState([{ name: "Size", values: "S, M, L" }, { name: "Colour", values: "" }]);
  const combos = React.useMemo(() => {
    const lists = options.filter((o) => o.name.trim() && o.values.trim())
      .map((o) => o.values.split(",").map((v) => v.trim()).filter(Boolean).map((v) => [o.name.trim(), v] as const));
    return lists.reduce<(readonly [string, string])[][]>((acc, l) => acc.flatMap((a) => l.map((x) => [...a, x])), [[]]).filter((c) => c.length);
  }, [options]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Build variants from options" description="Every combination becomes a variant. You can edit prices and SKUs afterwards.">
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="grid grid-cols-[140px_1fr_36px] gap-2">
              <Input aria-label="Option name" value={o.name} onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Option" />
              <Input aria-label="Option values" value={o.values} onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} placeholder="Comma separated values" />
              <Button variant="ghost" size="icon-sm" aria-label="Remove option" onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setOptions((os) => [...os, { name: "", values: "" }])}><Plus /> Add option</Button>
        </div>
        <p className="mt-3 text-sm text-muted">{combos.length} variants: {combos.slice(0, 6).map((c) => c.map((x) => x[1]).join(" / ")).join(", ")}{combos.length > 6 ? "…" : ""}</p>
        <DialogFooter>
          <Button disabled={!combos.length || combos.length > 100} onClick={() => {
            onApply(combos.map((c) => ({ ...blankVariant(c.map((x) => x[1]).join(" / ")), attributes: Object.fromEntries(c) })));
            onOpenChange(false);
          }}>Create {combos.length} variants</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductFormPage() {
  const { id } = useParams();
  const isNew = !id;
  const orgId = useOrgId();
  const { can, outlet, taxRates, allOutlets } = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [saving, setSaving] = React.useState(false);
  const [matrixOpen, setMatrixOpen] = React.useState(false);
  const [attempted, setAttempted] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "", description: "", category_id: "", brand_id: "", unit_id: "", tax_rate_id: "", product_type: "standard",
    track_stock: true, sold_by_weight: false, is_favorite: false, is_active: true,
  });
  const [variants, setVariants] = React.useState<VariantDraft[]>([blankVariant()]);
  const [outletPrices, setOutletPrices] = React.useState<Record<string, string>>({}); // `${outlet}:${variant}` -> price
  const editable = can("products.manage");

  const options = useQuery({
    queryKey: ["product-options", orgId],
    queryFn: async () => {
      const [c, b, u] = await Promise.all([
        supabase.from("categories").select("id, name").eq("organization_id", orgId).order("name"),
        supabase.from("brands").select("id, name").eq("organization_id", orgId).order("name"),
        supabase.from("units").select("id, name, abbreviation").eq("organization_id", orgId).order("name"),
      ]);
      return { categories: unwrap(c) as { id: string; name: string }[], brands: unwrap(b) as { id: string; name: string }[], units: unwrap(u) as { id: string; name: string; abbreviation: string }[] };
    },
  });

  const existing = useQuery({
    queryKey: ["product", id],
    enabled: !isNew,
    queryFn: async () => {
      const p = unwrap(await supabase.from("products")
        .select("*, product_variants(*, product_barcodes(barcode), inventory_balances(qty))")
        .eq("id", id!).single()) as Record<string, unknown> & { product_variants: (Record<string, unknown> & { product_barcodes: { barcode: string }[]; inventory_balances: { qty: number }[] })[] };
      const op = unwrap(await supabase.from("outlet_prices").select("outlet_id, variant_id, price").in("variant_id", p.product_variants.map((v) => v.id as string))) as { outlet_id: string; variant_id: string; price: number }[];
      return { p, op };
    },
  });

  React.useEffect(() => {
    if (!existing.data) return;
    const { p, op } = existing.data;
    setForm({
      name: p.name as string, description: (p.description as string) ?? "", category_id: (p.category_id as string) ?? "", brand_id: (p.brand_id as string) ?? "",
      unit_id: (p.unit_id as string) ?? "", tax_rate_id: (p.tax_rate_id as string) ?? "", product_type: p.product_type as string,
      track_stock: p.track_stock as boolean, sold_by_weight: p.sold_by_weight as boolean, is_favorite: p.is_favorite as boolean, is_active: p.is_active as boolean,
    });
    setVariants([...p.product_variants].sort((a, b) => (a.sort_order as number) - (b.sort_order as number) || String(a.name).localeCompare(String(b.name))).map((v) => ({
      key: v.id as string, id: v.id as string, name: v.name as string, sku: (v.sku as string) ?? "",
      barcodes: v.product_barcodes.map((b) => b.barcode).join(", "), originalBarcodes: v.product_barcodes.map((b) => b.barcode),
      retail_price: Number(v.retail_price).toFixed(2), wholesale_price: v.wholesale_price === null ? "" : Number(v.wholesale_price).toFixed(2),
      cost_price: Number(v.cost_price).toFixed(2), min_stock: String(Number(v.min_stock)), reorder_qty: String(Number(v.reorder_qty)),
      opening_stock: "", is_active: v.is_active as boolean, attributes: (v.attributes as Record<string, string>) ?? {},
      on_hand: v.inventory_balances.reduce((s, b) => s + Number(b.qty), 0),
    })));
    setOutletPrices(Object.fromEntries(op.map((o) => [`${o.outlet_id}:${o.variant_id}`, Number(o.price).toFixed(2)])));
  }, [existing.data]);

  const setV = (key: string, patch: Partial<VariantDraft>) => setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const errors: string[] = [];
  if (!form.name.trim()) errors.push("Name is required.");
  variants.forEach((v) => {
    const label = variants.length > 1 ? `${v.name}: ` : "";
    if (!moneyOk(v.retail_price, true)) errors.push(`${label}enter a retail price like 12.50.`);
    if (!moneyOk(v.wholesale_price) || !moneyOk(v.cost_price)) errors.push(`${label}check cost and wholesale prices.`);
    if (!qtyOk(v.min_stock) || !qtyOk(v.reorder_qty) || !qtyOk(v.opening_stock)) errors.push(`${label}quantities must be numbers.`);
  });
  const skus = variants.map((v) => v.sku.trim().toLowerCase()).filter(Boolean);
  if (new Set(skus).size !== skus.length) errors.push("Each variant needs a different SKU.");

  async function save() {
    setAttempted(true);
    if (errors.length) return toast.error(errors[0]);
    setSaving(true);
    const barcodes = (v: VariantDraft) => v.barcodes.split(/[,\s]+/).map((b) => b.trim()).filter(Boolean);
    const base = {
      name: form.name.trim(), description: form.description || null, category_id: form.category_id || null, brand_id: form.brand_id || null,
      unit_id: form.unit_id || null, tax_rate_id: form.tax_rate_id || null, sold_by_weight: form.sold_by_weight, is_favorite: form.is_favorite,
    };
    try {
      if (isNew) {
        const pid = await rpc<string>("create_product", { payload: {
          organization_id: orgId, ...base, product_type: form.product_type, track_stock: form.product_type === "standard" && form.track_stock,
          variants: variants.map((v, i) => ({
            name: v.name || "Default", sku: v.sku.trim() || null, attributes: v.attributes, retail_price: v.retail_price,
            wholesale_price: v.wholesale_price || null, cost_price: v.cost_price || "0", min_stock: v.min_stock || 0, reorder_qty: v.reorder_qty || 0,
            barcodes: barcodes(v), sort_order: i,
            opening_stock: v.opening_stock && Number(v.opening_stock) > 0 && outlet?.default_warehouse_id
              ? [{ warehouse_id: outlet.default_warehouse_id, qty: v.opening_stock, unit_cost: v.cost_price || "0" }] : [],
          })),
        } });
        toast.success(`${base.name} added`);
        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["pos-catalog"] });
        navigate(`/products/${pid}`, { replace: true });
        return;
      }
      unwrap(await supabase.from("products").update({ ...base, is_active: form.is_active }).eq("id", id!));
      const keep = new Set(variants.filter((v) => v.id).map((v) => v.id));
      for (const old of existing.data!.p.product_variants) {
        if (!keep.has(old.id as string)) {
          const { error } = await supabase.from("product_variants").delete().eq("id", old.id as string);
          if (error) unwrap(await supabase.from("product_variants").update({ is_active: false }).eq("id", old.id as string));
        }
      }
      for (const [i, v] of variants.entries()) {
        const row = {
          name: v.name || "Default", sku: v.sku.trim() || null, attributes: v.attributes, retail_price: v.retail_price,
          wholesale_price: v.wholesale_price || null, cost_price: v.cost_price || "0", min_stock: v.min_stock || 0, reorder_qty: v.reorder_qty || 0,
          is_active: v.is_active, sort_order: i,
        };
        let vid = v.id;
        if (vid) unwrap(await supabase.from("product_variants").update(row).eq("id", vid));
        else vid = (unwrap(await supabase.from("product_variants").insert({ ...row, organization_id: orgId, product_id: id }).select("id").single()) as { id: string }).id;
        const next = barcodes(v);
        const prev = v.originalBarcodes ?? [];
        const removed = prev.filter((b) => !next.includes(b));
        const added = next.filter((b) => !prev.includes(b));
        if (removed.length) unwrap(await supabase.from("product_barcodes").delete().eq("variant_id", vid).in("barcode", removed));
        if (added.length) unwrap(await supabase.from("product_barcodes").insert(added.map((b) => ({ organization_id: orgId, variant_id: vid, barcode: b }))));
        for (const o of allOutlets) {
          const k = `${o.id}:${vid}`;
          const price = outletPrices[k];
          if (price && moneyOk(price, true)) unwrap(await supabase.from("outlet_prices").upsert({ organization_id: orgId, outlet_id: o.id, variant_id: vid, price }));
          else if (v.id) unwrap(await supabase.from("outlet_prices").delete().eq("outlet_id", o.id).eq("variant_id", vid));
        }
      }
      toast.success("Changes saved");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product", id] });
      qc.invalidateQueries({ queryKey: ["pos-catalog"] });
    } catch (e) {
      toast.error(toAppError(e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!isNew && existing.isLoading) return <Skeleton className="h-96" />;
  if (existing.error) return <ErrorNotice error={existing.error} />;

  const service = form.product_type === "service";
  return (
    <>
      <Link to="/products" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Products</Link>
      <PageHeader title={isNew ? "New product" : form.name || "Product"}
        actions={editable && (
          <>
            {!isNew && <Button variant="secondary" asChild><Link to={`/inventory/movements?product=${id}`}>Stock history</Link></Button>}
            <Button onClick={save} loading={saving}>{isNew ? "Create product" : "Save changes"}</Button>
          </>
        )} />
      <fieldset disabled={!editable} className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="pname" className="sm:col-span-2">
                <Input id="pname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus={isNew} />
              </Field>
              <Field label="Category" htmlFor="pcat">
                <Select id="pcat" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                  <option value="">None</option>
                  {options.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Brand" htmlFor="pbrand">
                <Select id="pbrand" value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}>
                  <option value="">None</option>
                  {options.data?.brands.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Selling unit" htmlFor="punit">
                <Select id="punit" value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
                  <option value="">Piece (default)</option>
                  {options.data?.units.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.abbreviation})</option>)}
                </Select>
              </Field>
              <Field label="Tax" htmlFor="ptax">
                <Select id="ptax" value={form.tax_rate_id} onChange={(e) => setForm({ ...form, tax_rate_id: e.target.value })}>
                  <option value="">Business default</option>
                  {taxRates.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate)}%)</option>)}
                </Select>
              </Field>
              <Field label="Description" htmlFor="pdesc" className="sm:col-span-2">
                <Textarea id="pdesc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-16" />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Variants and pricing" description="Prices in MVR. Leave wholesale empty to use retail for wholesale customers."
              action={editable && (
                <div className="flex gap-2">
                  {isNew && <Button variant="secondary" size="sm" onClick={() => setMatrixOpen(true)}><Grid3x3 /> Options</Button>}
                  <Button variant="secondary" size="sm" onClick={() => setVariants((vs) => [...vs, blankVariant(`Variant ${vs.length + 1}`)])}><Plus /> Variant</Button>
                </div>
              )} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    {variants.length > 1 && <th className="px-2 py-2 text-start font-medium">Variant</th>}
                    <th className="px-2 py-2 text-start font-medium">SKU</th>
                    <th className="px-2 py-2 text-start font-medium">Barcodes</th>
                    <th className="px-2 py-2 text-end font-medium">Retail</th>
                    <th className="px-2 py-2 text-end font-medium">Wholesale</th>
                    <th className="px-2 py-2 text-end font-medium">Cost</th>
                    {!service && <th className="px-2 py-2 text-end font-medium">Min stock</th>}
                    {!service && <th className="px-2 py-2 text-end font-medium">{isNew ? `Opening stock` : "On hand"}</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={v.key} className="border-t border-line">
                      {variants.length > 1 && <td className="px-2 py-1.5"><Input aria-label="Variant name" value={v.name} onChange={(e) => setV(v.key, { name: e.target.value })} className="h-8 min-w-28" /></td>}
                      <td className="px-2 py-1.5"><Input aria-label="SKU" value={v.sku} onChange={(e) => setV(v.key, { sku: e.target.value })} className="h-8 w-24" /></td>
                      <td className="px-2 py-1.5"><Input aria-label="Barcodes" value={v.barcodes} onChange={(e) => setV(v.key, { barcodes: e.target.value })} className="h-8 w-32" placeholder="Scan or type" /></td>
                      <td className="px-2 py-1.5"><Input aria-label="Retail price" inputMode="decimal" value={v.retail_price} onChange={(e) => setV(v.key, { retail_price: e.target.value })} className="h-8 w-20 text-end tabular" aria-invalid={(attempted || !isNew) && !moneyOk(v.retail_price, true)} /></td>
                      <td className="px-2 py-1.5"><Input aria-label="Wholesale price" inputMode="decimal" value={v.wholesale_price} onChange={(e) => setV(v.key, { wholesale_price: e.target.value })} className="h-8 w-20 text-end tabular" /></td>
                      <td className="px-2 py-1.5"><Input aria-label="Cost price" inputMode="decimal" value={v.cost_price} onChange={(e) => setV(v.key, { cost_price: e.target.value })} className="h-8 w-20 text-end tabular" /></td>
                      {!service && <td className="px-2 py-1.5"><Input aria-label="Minimum stock" inputMode="decimal" value={v.min_stock} onChange={(e) => setV(v.key, { min_stock: e.target.value })} className="h-8 w-20 text-end tabular" /></td>}
                      {!service && <td className="px-2 py-1.5 text-end">
                        {isNew || !v.id ? (
                          <Input aria-label="Opening stock" inputMode="decimal" value={v.opening_stock} onChange={(e) => setV(v.key, { opening_stock: e.target.value })}
                            className="ms-auto h-8 w-20 text-end tabular" disabled={!isNew || !can("inventory.adjust")} placeholder={isNew ? "0" : "—"} />
                        ) : <span className="tabular">{formatQty(v.on_hand)}</span>}
                      </td>}
                      <td className="px-1">
                        <Button variant="ghost" size="icon-sm" aria-label="Remove variant" disabled={variants.length === 1}
                          onClick={() => setVariants((vs) => vs.filter((x) => x.key !== v.key))}><Trash2 /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isNew && !service && <p className="border-t border-line px-4 py-2 text-xs text-muted">Opening stock is recorded at {outlet?.name} at the cost price entered, and appears in the stock ledger.</p>}
            {!isNew && <p className="border-t border-line px-4 py-2 text-xs text-muted">To change stock levels use Inventory → Adjust stock, so every change has a reason. Variants with sales history are archived instead of deleted.</p>}
          </Card>

          {!isNew && allOutlets.length > 1 && (
            <Card>
              <CardHeader title="Outlet prices" description="Override the retail price at specific outlets. Leave blank to use the retail price." />
              <div className="overflow-x-auto p-2">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted"><tr><th className="px-2 py-1.5 text-start font-medium">Variant</th>{allOutlets.map((o) => <th key={o.id} className="px-2 text-end font-medium">{o.name}</th>)}</tr></thead>
                  <tbody>
                    {variants.filter((v) => v.id).map((v) => (
                      <tr key={v.key} className="border-t border-line">
                        <td className="px-2 py-1.5">{v.name}</td>
                        {allOutlets.map((o) => (
                          <td key={o.id} className="px-2 py-1.5">
                            <Input aria-label={`Price at ${o.name}`} inputMode="decimal" placeholder={v.retail_price} value={outletPrices[`${o.id}:${v.id}`] ?? ""}
                              onChange={(e) => setOutletPrices((p) => ({ ...p, [`${o.id}:${v.id}`]: e.target.value }))} className="ms-auto h-8 w-24 text-end tabular" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            {isNew && (
              <Field label="Type" htmlFor="ptype">
                <Select id="ptype" value={form.product_type} onChange={(e) => setForm({ ...form, product_type: e.target.value, track_stock: e.target.value === "standard" })}>
                  <option value="standard">Physical product</option>
                  <option value="service">Service (no stock)</option>
                </Select>
              </Field>
            )}
            {[
              { k: "track_stock", label: "Track stock", hint: "Count on-hand quantity and block overselling.", hide: service || !isNew },
              { k: "sold_by_weight", label: "Sold by weight or measure", hint: "Ask for quantity (e.g. 0.750 kg) when added to a sale." },
              { k: "is_favorite", label: "Favourite", hint: "Shows under Favourites on the register." },
              { k: "is_active", label: "Active", hint: "Archived products stay in history but can't be sold.", hide: isNew },
            ].filter((x) => !x.hide).map((x) => (
              <label key={x.k} className="flex items-start gap-3">
                <Switch checked={form[x.k as keyof typeof form] as boolean} onCheckedChange={(v) => setForm({ ...form, [x.k]: v })} className="mt-0.5" />
                <span><span className="block text-sm font-medium">{x.label}</span><span className="block text-xs text-muted">{x.hint}</span></span>
              </label>
            ))}
          </Card>
          {errors.length > 0 && editable && (attempted || !isNew) && (
            <ul className="space-y-1 rounded-lg border border-coral/30 bg-coral-soft px-4 py-3 text-sm text-coral">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
        </div>
      </fieldset>
      <MatrixDialog open={matrixOpen} onOpenChange={setMatrixOpen} onApply={(vs) => setVariants(vs)} />
    </>
  );
}
