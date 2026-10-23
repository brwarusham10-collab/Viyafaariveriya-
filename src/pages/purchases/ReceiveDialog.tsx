import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { VariantPicker, variantLabel } from "@/components/common/VariantPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { formatMoney, formatQty } from "@/lib/money";
import { rpc, supabase, unwrap } from "@/lib/supabase";
import { uuid } from "@/lib/utils";

export interface PoForReceive {
  id: string;
  supplier_id: string;
  warehouse_id: string;
  po_number: string;
  items: { id: string; variant_id: string; label: string; qty_ordered: number; qty_received: number; unit_cost: number }[];
}

interface Line { key: string; po_item_id?: string; variant_id: string; label: string; qty: string; unit_cost: string; batch_no: string; expiry_date: string; remaining?: number }

export function ReceiveDialog({ open, onOpenChange, po }: { open: boolean; onOpenChange: (o: boolean) => void; po: PoForReceive | null }) {
  const orgId = useOrgId();
  const { warehouses, outlet } = useOrg();
  const qc = useQueryClient();
  const [supplier, setSupplier] = React.useState("");
  const [warehouse, setWarehouse] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [costs, setCosts] = React.useState({ freight: "", duty: "", handling: "", other_costs: "" });
  const [lines, setLines] = React.useState<Line[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [clientUuid, setClientUuid] = React.useState(uuid());
  const suppliers = useQuery({ queryKey: ["suppliers", orgId], enabled: open && !po,
    queryFn: async () => unwrap(await supabase.from("suppliers").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("name")) as { id: string; name: string }[] });

  React.useEffect(() => {
    if (!open) return;
    setClientUuid(uuid()); setRef(""); setCosts({ freight: "", duty: "", handling: "", other_costs: "" });
    setSupplier(po?.supplier_id ?? ""); setWarehouse(po?.warehouse_id ?? outlet?.default_warehouse_id ?? "");
    setLines(po ? po.items.filter((i) => Number(i.qty_ordered) > Number(i.qty_received)).map((i) => ({
      key: i.id, po_item_id: i.id, variant_id: i.variant_id, label: i.label, qty: String(Number(i.qty_ordered) - Number(i.qty_received)),
      unit_cost: Number(i.unit_cost).toFixed(2), batch_no: "", expiry_date: "", remaining: Number(i.qty_ordered) - Number(i.qty_received),
    })) : []);
  }, [open, po, outlet]);

  const extra = Object.values(costs).reduce((s, v) => s + (Number(v) || 0), 0);
  const value = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
  const landedUnit = (l: Line) => {
    const q = Number(l.qty) || 0;
    if (!q) return 0;
    const lv = q * (Number(l.unit_cost) || 0);
    const share = value > 0 ? (extra * lv) / value : extra / lines.length;
    return (lv + share) / q;
  };
  const active = lines.filter((l) => Number(l.qty) > 0);
  const valid = supplier && warehouse && active.length > 0 && active.every((l) => /^\d+(\.\d{1,3})?$/.test(l.qty) && /^\d+(\.\d{1,2})?$/.test(l.unit_cost)
    && (l.remaining === undefined || Number(l.qty) <= l.remaining)) && Object.values(costs).every((v) => v === "" || /^\d+(\.\d{1,2})?$/.test(v));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={po ? `Receive ${po.po_number}` : "Receive stock"} wide className="max-w-4xl"
        description="Freight, duty and handling are spread across lines by value and included in each item's cost.">
        <div className="grid gap-3 sm:grid-cols-3">
          {!po && <Field label="Supplier" htmlFor="rc-sup"><Select id="rc-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="" disabled>Choose a supplier</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
          <Field label="Receive into" htmlFor="rc-wh"><Select id="rc-wh" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} disabled={!!po}>
            {warehouses.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          <Field label="Supplier invoice no." htmlFor="rc-ref"><Input id="rc-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        </div>
        {!po && <div className="mt-4"><VariantPicker onPick={(v) => setLines((ls) => [...ls, { key: uuid(), variant_id: v.id, label: variantLabel(v), qty: "", unit_cost: Number(v.cost_price).toFixed(2), batch_no: "", expiry_date: "" }])} /></div>}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-1 text-start font-medium">Product</th><th className="text-end font-medium">Qty</th><th className="text-end font-medium">Unit cost</th><th className="text-start font-medium ps-3">Batch</th><th className="text-start font-medium">Expiry</th><th className="text-end font-medium">Landed / unit</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="border-t border-line">
                  <td className="py-1.5">{l.label}{l.remaining !== undefined && <div className="text-xs text-muted">{formatQty(l.remaining)} outstanding</div>}</td>
                  <td><Input aria-label="Quantity" inputMode="decimal" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="ms-auto h-8 w-20 text-end" /></td>
                  <td><Input aria-label="Unit cost" inputMode="decimal" value={l.unit_cost} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit_cost: e.target.value } : x)))} className="ms-auto h-8 w-24 text-end" /></td>
                  <td className="ps-3"><Input aria-label="Batch number" value={l.batch_no} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, batch_no: e.target.value } : x)))} className="h-8 w-28" /></td>
                  <td><Input aria-label="Expiry date" type="date" value={l.expiry_date} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, expiry_date: e.target.value } : x)))} className="h-8 w-36" /></td>
                  <td className="text-end tabular">{landedUnit(l).toFixed(2)}</td>
                  <td className="w-9">{!po && <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["freight", "duty", "handling", "other_costs"] as const).map((k) => (
            <Field key={k} label={{ freight: "Freight", duty: "Customs duty", handling: "Handling", other_costs: "Other costs" }[k]} htmlFor={`rc-${k}`}>
              <Input id={`rc-${k}`} inputMode="decimal" value={costs[k]} onChange={(e) => setCosts((c) => ({ ...c, [k]: e.target.value }))} placeholder="0.00" />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Batch and expiry are recorded for traceability. Sales don't yet pick specific batches.</p>
        <DialogFooter className="items-center">
          <span className="me-auto text-sm">Items {formatMoney(value)} + costs {formatMoney(extra)} = <span className="font-semibold">{formatMoney(value + extra)}</span></span>
          <Button disabled={!valid} loading={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await rpc<{ grn_number: string }>("receive_goods", { payload: {
                organization_id: orgId, client_uuid: clientUuid, purchase_order_id: po?.id ?? null, supplier_id: supplier, warehouse_id: warehouse,
                supplier_invoice_ref: ref || null, ...Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, v || 0])),
                items: active.map((l) => ({ purchase_order_item_id: l.po_item_id ?? null, variant_id: l.variant_id, qty: l.qty, unit_cost: l.unit_cost, batch_no: l.batch_no || null, expiry_date: l.expiry_date || null })),
              } });
              toast.success(`Received as ${r.grn_number}`);
              ["purchase-orders", "purchase-order", "goods-receipts", "stock", "pos-catalog"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
              onOpenChange(false);
            } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}>Receive stock</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
