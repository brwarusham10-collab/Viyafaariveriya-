import { Trash2 } from "lucide-react";
import * as React from "react";
import { useOrg } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Money } from "@/components/ui/misc";
import type { DiscountType } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import type { CartLine } from "./cartStore";

export function LineEditor({ line, onClose, onSave, onRemove }: {
  line: CartLine | null;
  onClose: () => void;
  onSave: (patch: Partial<CartLine>) => void;
  onRemove: () => void;
}) {
  const { can } = useOrg();
  const [qty, setQty] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [dType, setDType] = React.useState<DiscountType | null>(null);
  const [dValue, setDValue] = React.useState("");

  React.useEffect(() => {
    if (line) {
      setQty(line.qty);
      setPrice(line.unitPrice);
      setDType(line.discountType);
      setDValue(line.discountValue);
    }
  }, [line]);

  if (!line) return null;
  const qtyOk = Number(qty) > 0 && (line.allowDecimal ? /^\d+(\.\d{1,3})?$/.test(qty) : /^\d+$/.test(qty));
  const priceOk = /^\d+(\.\d{1,2})?$/.test(price);
  const discOk = !dType || dValue === "" || (/^\d+(\.\d{1,2})?$/.test(dValue) && (dType === "fixed" || Number(dValue) <= 100));
  const overridden = priceOk && Number(price) !== Number(line.listPrice);

  return (
    <Dialog open={!!line} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={line.name} description={line.sku ?? undefined}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!qtyOk || !priceOk || !discOk) return;
            onSave({
              qty,
              unitPrice: overridden ? Number(price).toFixed(2) : line.listPrice,
              discountType: dType && Number(dValue) > 0 ? dType : null,
              discountValue: dType && Number(dValue) > 0 ? dValue : "",
            });
          }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={line.allowDecimal ? "Quantity (up to 3 decimals)" : "Quantity"} htmlFor="le-qty" error={qtyOk ? undefined : "Enter a valid quantity"}>
              <Input id="le-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus className="text-lg tabular" />
            </Field>
            <Field label="Unit price" htmlFor="le-price" hint={can("pos.price_override") ? <>List <Money value={line.listPrice} /></> : "Your role can't change prices"}>
              <Input id="le-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} disabled={!can("pos.price_override")}
                className={cn("text-lg tabular", overridden && "border-saffron")} />
            </Field>
          </div>
          <Field label="Line discount" htmlFor="le-disc" hint={can("pos.discount") ? undefined : "Your role can't give discounts"}>
            <div className="flex gap-2">
              <div className="flex rounded-md border border-line-strong p-0.5">
                {(["percent", "fixed"] as const).map((t) => (
                  <button type="button" key={t} disabled={!can("pos.discount")} onClick={() => setDType(dType === t ? null : t)}
                    className={cn("rounded px-3 text-sm", dType === t ? "bg-reef text-white" : "text-muted")}>
                    {t === "percent" ? "%" : "MVR"}
                  </button>
                ))}
              </div>
              <Input id="le-disc" inputMode="decimal" value={dValue} onChange={(e) => setDValue(e.target.value)} disabled={!dType || !can("pos.discount")}
                placeholder={dType ? (dType === "percent" ? "e.g. 10" : "e.g. 5.00") : "Choose % or MVR"} />
            </div>
          </Field>
          <DialogFooter className="justify-between">
            <Button type="button" variant="danger-ghost" onClick={onRemove}>
              <Trash2 /> Remove item
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!qtyOk || !priceOk || !discOk}>
                Update item
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
