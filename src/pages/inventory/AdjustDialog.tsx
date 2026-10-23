import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { VariantPicker, variantLabel, type VariantOption } from "@/components/common/VariantPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { rpc } from "@/lib/supabase";
import { uuid } from "@/lib/utils";

const reasons = [
  ["count_correction", "Stock count correction"], ["damage", "Damaged"], ["expired", "Expired"], ["theft", "Theft or loss"],
  ["internal_use", "Used in the business"], ["found", "Found stock"], ["opening", "Opening stock"], ["other", "Other"],
] as const;

export function AdjustDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: VariantOption | null }) {
  const orgId = useOrgId();
  const { warehouses, outlet } = useOrg();
  const qc = useQueryClient();
  const [warehouse, setWarehouse] = React.useState("");
  const [reason, setReason] = React.useState<string>("count_correction");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<{ v: VariantOption; qty: string; cost: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [clientUuid, setClientUuid] = React.useState(uuid());

  React.useEffect(() => {
    if (open) {
      setWarehouse(outlet?.default_warehouse_id ?? warehouses[0]?.id ?? "");
      setLines(initial ? [{ v: initial, qty: "", cost: "" }] : []);
      setNotes("");
      setClientUuid(uuid());
    }
  }, [open, initial, outlet, warehouses]);

  const valid = lines.length > 0 && lines.every((l) => /^-?\d+(\.\d{1,3})?$/.test(l.qty) && Number(l.qty) !== 0 && (l.cost === "" || /^\d+(\.\d{1,2})?$/.test(l.cost)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Adjust stock" wide description="Use a negative quantity to remove stock. Every adjustment is kept in the stock ledger with its reason.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Location" htmlFor="adj-wh">
            <Select id="adj-wh" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              {warehouses.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Reason" htmlFor="adj-reason">
            <Select id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-4">
          <VariantPicker stockedOnly onPick={(v) => setLines((ls) => (ls.some((l) => l.v.id === v.id) ? ls : [...ls, { v, qty: "", cost: "" }]))} />
        </div>
        {lines.length > 0 && (
          <table className="mt-3 w-full text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-1 text-start font-medium">Product</th><th className="text-end font-medium">Change (+/−)</th><th className="text-end font-medium">Unit cost for additions</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.v.id} className="border-t border-line">
                  <td className="py-1.5">{variantLabel(l.v)}</td>
                  <td className="py-1.5"><Input aria-label="Quantity change" inputMode="decimal" value={l.qty} autoFocus={i === lines.length - 1}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="ms-auto h-8 w-24 text-end tabular" placeholder="e.g. -2" /></td>
                  <td className="py-1.5"><Input aria-label="Unit cost" inputMode="decimal" value={l.cost} placeholder="avg cost"
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} className="ms-auto h-8 w-28 text-end tabular" /></td>
                  <td className="w-9"><Button variant="ghost" size="icon-sm" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Field label="Notes" htmlFor="adj-notes" className="mt-4">
          <Textarea id="adj-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-14" />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid || !warehouse} loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await rpc("adjust_stock", { payload: { organization_id: orgId, client_uuid: clientUuid, warehouse_id: warehouse, reason_code: reason, notes: notes || null,
                items: lines.map((l) => ({ variant_id: l.v.id, qty_change: l.qty, unit_cost: l.cost || null })) } });
              toast.success("Stock adjusted");
              qc.invalidateQueries({ queryKey: ["stock"] });
              qc.invalidateQueries({ queryKey: ["movements"] });
              qc.invalidateQueries({ queryKey: ["pos-catalog"] });
              onOpenChange(false);
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}>Save adjustment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
