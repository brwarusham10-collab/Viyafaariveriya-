import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PauseCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/misc";
import { fmtDateTime } from "@/lib/dates";
import { supabase, unwrap } from "@/lib/supabase";
import { useCart, type CartCustomer, type CartLine } from "./cartStore";
import type { CartDiscount } from "@/lib/pricing";

interface Held {
  id: string;
  label: string;
  created_at: string;
  cart: { lines: CartLine[]; cartDiscount: CartDiscount | null; customer: CartCustomer | null; notes?: string };
}

export async function parkCart(orgId: string, outletId: string, registerId: string, label: string) {
  const s = useCart.getState();
  unwrap(
    await supabase.from("held_bills").insert({
      organization_id: orgId, outlet_id: outletId, register_id: registerId, label,
      cart: { lines: s.lines, cartDiscount: s.cartDiscount, customer: s.customer, notes: s.notes },
      customer_id: s.customer?.id ?? null,
    }),
  );
  s.clear();
}

export function HeldBills({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const orgId = useOrgId();
  const { outlet } = useOrg();
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["held-bills", outlet?.id],
    enabled: open && !!outlet,
    queryFn: async () => unwrap(await supabase.from("held_bills").select("*").eq("organization_id", orgId).eq("outlet_id", outlet!.id).order("created_at", { ascending: false })) as Held[],
  });

  async function recall(h: Held) {
    const cart = useCart.getState();
    if (cart.lines.length > 0) return toast.error("Finish or park the current sale before recalling another.");
    cart.load({ lines: h.cart.lines, cartDiscount: h.cart.cartDiscount, customer: h.cart.customer, notes: h.cart.notes });
    unwrap(await supabase.from("held_bills").delete().eq("id", h.id));
    qc.invalidateQueries({ queryKey: ["held-bills"] });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Parked sales" description="Sales put on hold at this outlet. Prices are re-checked when you charge.">
        {data.length === 0 ? (
          <EmptyState icon={PauseCircle} title="No parked sales" />
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {data.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{h.label}</div>
                  <div className="text-xs text-muted">
                    {h.cart.lines.length} items · {fmtDateTime(h.created_at)}
                    {h.cart.customer && ` · ${h.cart.customer.name}`}
                  </div>
                </div>
                <Button size="sm" onClick={() => recall(h)}>
                  Recall
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Delete parked sale"
                  onClick={async () => {
                    unwrap(await supabase.from("held_bills").delete().eq("id", h.id));
                    qc.invalidateQueries({ queryKey: ["held-bills"] });
                  }}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
