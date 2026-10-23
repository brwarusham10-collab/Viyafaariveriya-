import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { supabase, toAppError, unwrap } from "@/lib/supabase";
import type { Customer } from "@/lib/types";

export function CustomerForm({ customer, open, onOpenChange }: { customer: Partial<Customer> | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const orgId = useOrgId();
  const { can } = useOrg();
  const qc = useQueryClient();
  const [f, setF] = React.useState<Partial<Customer>>({});
  const groups = useQuery({ queryKey: ["customer-groups", orgId], enabled: open,
    queryFn: async () => unwrap(await supabase.from("customer_groups").select("id, name, price_list, discount_percent").eq("organization_id", orgId).order("name")) as { id: string; name: string; price_list: string; discount_percent: number }[] });
  React.useEffect(() => { if (open) setF(customer ?? { is_active: true, credit_limit: 0 }); }, [open, customer]);
  const set = (k: keyof Customer) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const canCredit = can("pos.credit_sale") || can("settings.manage");
  async function save() {
    const row = { name: f.name?.trim(), phone: f.phone || null, email: f.email || null, address: f.address || null, island: f.island || null, tin: f.tin || null,
      customer_group_id: f.customer_group_id || null, notes: f.notes || null, is_active: f.is_active ?? true,
      ...(canCredit ? { credit_limit: Number(f.credit_limit || 0) } : {}) };
    const res = f.id ? await supabase.from("customers").update(row).eq("id", f.id) : await supabase.from("customers").insert({ ...row, organization_id: orgId });
    if (res.error) return toast.error(toAppError(res.error).message);
    toast.success("Customer saved");
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["customer", f.id] });
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={f.id ? "Edit customer" : "New customer"}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="c-name" className="sm:col-span-2"><Input id="c-name" value={f.name ?? ""} onChange={set("name")} autoFocus /></Field>
          <Field label="Phone" htmlFor="c-phone"><Input id="c-phone" inputMode="tel" value={f.phone ?? ""} onChange={set("phone")} /></Field>
          <Field label="Email" htmlFor="c-email"><Input id="c-email" type="email" value={f.email ?? ""} onChange={set("email")} /></Field>
          <Field label="Island" htmlFor="c-island"><Input id="c-island" value={f.island ?? ""} onChange={set("island")} /></Field>
          <Field label="TIN (for tax invoices)" htmlFor="c-tin"><Input id="c-tin" value={f.tin ?? ""} onChange={set("tin")} /></Field>
          <Field label="Address" htmlFor="c-addr" className="sm:col-span-2"><Input id="c-addr" value={f.address ?? ""} onChange={set("address")} /></Field>
          <Field label="Customer group" htmlFor="c-group" hint="Groups can use wholesale prices or a standing discount.">
            <Select id="c-group" value={f.customer_group_id ?? ""} onChange={set("customer_group_id")}>
              <option value="">None (retail)</option>
              {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}{g.price_list === "wholesale" ? " · wholesale" : ""}{Number(g.discount_percent) ? ` · ${Number(g.discount_percent)}% off` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Credit limit (MVR)" htmlFor="c-limit" hint={canCredit ? "0 means no credit sales." : "Only managers can set credit limits."}>
            <Input id="c-limit" inputMode="decimal" value={String(f.credit_limit ?? 0)} onChange={set("credit_limit")} disabled={!canCredit} />
          </Field>
          <Field label="Notes" htmlFor="c-notes" className="sm:col-span-2"><Textarea id="c-notes" value={f.notes ?? ""} onChange={set("notes")} className="min-h-14" /></Field>
          {f.id && <label className="flex items-center gap-2 text-sm"><Switch checked={f.is_active ?? true} onCheckedChange={(v) => setF((x) => ({ ...x, is_active: v }))} /> Active</label>}
        </div>
        <DialogFooter><Button onClick={save} disabled={!f.name?.trim() || !/^\d+(\.\d{1,2})?$/.test(String(f.credit_limit ?? 0))}>Save customer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
