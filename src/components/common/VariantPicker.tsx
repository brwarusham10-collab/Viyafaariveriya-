import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import * as React from "react";
import { useOrgId } from "@/app/org";
import { Input } from "@/components/ui/input";
import { formatAmount } from "@/lib/money";
import { supabase, unwrap } from "@/lib/supabase";

export interface VariantOption {
  id: string;
  name: string;
  sku: string | null;
  cost_price: number;
  retail_price: number;
  products: { name: string; track_stock: boolean };
}

export const variantLabel = (v: VariantOption) => (v.name === "Default" ? v.products.name : `${v.products.name} · ${v.name}`);

/** Search-as-you-type product variant picker used by adjustments, transfers and purchase orders. */
export function VariantPicker({ onPick, stockedOnly, placeholder = "Add a product by name, SKU or barcode" }: {
  onPick: (v: VariantOption) => void;
  stockedOnly?: boolean;
  placeholder?: string;
}) {
  const orgId = useOrgId();
  const [term, setTerm] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 180);
    return () => clearTimeout(t);
  }, [term]);
  const { data = [] } = useQuery({
    queryKey: ["variant-search", orgId, debounced, stockedOnly],
    enabled: debounced.length > 0,
    queryFn: async () => {
      const safe = debounced.replace(/[%,()]/g, " ");
      const byBarcode = unwrap(await supabase.from("product_barcodes").select("variant_id").eq("organization_id", orgId).eq("barcode", debounced)) as { variant_id: string }[];
      let q = supabase.from("product_variants").select("id, name, sku, cost_price, retail_price, products!inner(name, track_stock, is_active)")
        .eq("organization_id", orgId).eq("is_active", true).eq("products.is_active", true).limit(15);
      if (stockedOnly) q = q.eq("products.track_stock", true);
      q = byBarcode.length ? q.in("id", byBarcode.map((b) => b.variant_id)) : q.or(`sku.ilike.%${safe}%,name.ilike.%${safe}%`);
      let rows = unwrap(await q) as unknown as VariantOption[];
      if (!byBarcode.length) {
        const byProduct = unwrap(await supabase.from("product_variants").select("id, name, sku, cost_price, retail_price, products!inner(name, track_stock, is_active)")
          .eq("organization_id", orgId).eq("is_active", true).eq("products.is_active", true).ilike("products.name", `%${safe}%`).limit(15)) as unknown as VariantOption[];
        const seen = new Set(rows.map((r) => r.id));
        rows = [...rows, ...byProduct.filter((r) => !seen.has(r.id))].filter((r) => !stockedOnly || r.products.track_stock);
      }
      return rows.slice(0, 15);
    },
  });
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <Input value={term} placeholder={placeholder} className="ps-9" aria-label="Find product"
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && data.length > 0) {
            e.preventDefault();
            onPick(data[0]);
            setTerm("");
          }
        }} />
      {open && debounced && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-surface shadow-lg">
          {data.length === 0 && <li className="px-3 py-2 text-sm text-muted">No products match.</li>}
          {data.map((v) => (
            <li key={v.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-fg/[0.04]"
                onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(v); setTerm(""); }}>
                <span className="truncate">{variantLabel(v)} {v.sku && <span className="text-xs text-muted">{v.sku}</span>}</span>
                <span className="text-xs text-muted tabular">{formatAmount(v.retail_price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
