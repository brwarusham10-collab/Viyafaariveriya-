import { useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone, Plus, Store, Warehouse as WarehouseIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/misc";
import { rpc, supabase, toAppError } from "@/lib/supabase";
import type { Outlet, Register, Warehouse } from "@/lib/types";

type Edit =
  | { kind: "outlet-new"; name: string; code: string; island: string; address: string; phone: string; register: string }
  | { kind: "outlet"; row: Outlet }
  | { kind: "register"; row: Partial<Register> }
  | { kind: "warehouse"; row: Partial<Warehouse> };

export default function OutletsPage() {
  const orgId = useOrgId();
  const { allOutlets, registers, warehouses, refetch } = useOrg();
  const qc = useQueryClient();
  const [edit, setEdit] = React.useState<Edit | null>(null);
  const [busy, setBusy] = React.useState(false);
  const done = (msg: string) => { toast.success(msg); refetch(); qc.invalidateQueries({ queryKey: ["org-config"] }); setEdit(null); };

  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      if (edit.kind === "outlet-new") {
        await rpc("create_outlet", { p_org: orgId, p_name: edit.name, p_code: edit.code, p_address: edit.address || null, p_island: edit.island || null, p_phone: edit.phone || null, p_register_name: edit.register });
        done(`${edit.name} created with its own stock location and register`);
      } else if (edit.kind === "outlet") {
        const { name, address, island, phone, is_active } = edit.row;
        const { error } = await supabase.from("outlets").update({ name, address, island, phone, is_active }).eq("id", edit.row.id);
        if (error) throw toAppError(error);
        done("Outlet saved");
      } else if (edit.kind === "register") {
        const r = edit.row;
        const { error } = r.id ? await supabase.from("registers").update({ name: r.name, receipt_width: r.receipt_width, is_active: r.is_active }).eq("id", r.id)
          : await supabase.from("registers").insert({ organization_id: orgId, outlet_id: r.outlet_id, name: r.name, receipt_width: r.receipt_width ?? "80mm" });
        if (error) throw toAppError(error);
        done("Register saved");
      } else {
        const w = edit.row;
        const { error } = w.id ? await supabase.from("warehouses").update({ name: w.name, is_active: w.is_active }).eq("id", w.id)
          : await supabase.from("warehouses").insert({ organization_id: orgId, name: w.name, outlet_id: null });
        if (error) throw toAppError(error);
        done("Warehouse saved");
      }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  const standalone = warehouses.filter((w) => !w.outlet_id);
  return (
    <>
      <PageHeader title="Outlets" description="Shops you sell from, their registers, and any separate warehouses."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setEdit({ kind: "warehouse", row: { name: "", is_active: true } })}><WarehouseIcon /> Add warehouse</Button>
            <Button size="sm" onClick={() => setEdit({ kind: "outlet-new", name: "", code: "", island: "", address: "", phone: "", register: "Register 1" })}><Plus /> New outlet</Button>
          </>
        } />
      <div className="grid gap-4 lg:grid-cols-2">
        {allOutlets.map((o) => (
          <Card key={o.id}>
            <CardHeader title={<span className="flex items-center gap-2"><Store className="size-4 text-lagoon" />{o.name} <Badge>{o.code}</Badge>{!o.is_active && <Badge tone="coral">Inactive</Badge>}</span>}
              description={[o.island, o.address, o.phone].filter(Boolean).join(" · ") || "No address"}
              action={<Button size="sm" variant="ghost" onClick={() => setEdit({ kind: "outlet", row: o })}>Edit</Button>} />
            <ul className="divide-y divide-line text-sm">
              {registers.filter((r) => r.outlet_id === o.id).map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <MonitorSmartphone className="size-4 text-subtle" />
                  <span className="flex-1">{r.name} <span className="text-xs text-muted">· {r.receipt_width === "a4" ? "A4" : r.receipt_width} receipts</span>{!r.is_active && <Badge className="ms-2">Inactive</Badge>}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ kind: "register", row: r })}>Edit</Button>
                </li>
              ))}
              <li className="flex items-center gap-3 px-4 py-2.5 text-muted">
                <WarehouseIcon className="size-4 text-subtle" /> <span className="flex-1">Stock location: {warehouses.find((w) => w.id === o.default_warehouse_id)?.name}</span>
              </li>
            </ul>
            <div className="border-t border-line px-4 py-2.5">
              <Button size="sm" variant="secondary" onClick={() => setEdit({ kind: "register", row: { outlet_id: o.id, name: `Register ${registers.filter((r) => r.outlet_id === o.id).length + 1}`, receipt_width: "80mm", is_active: true } })}><Plus /> Add register</Button>
            </div>
          </Card>
        ))}
        {standalone.length > 0 && (
          <Card>
            <CardHeader title="Warehouses" description="Stock locations that don't sell directly. Move stock to outlets with transfers." />
            <ul className="divide-y divide-line text-sm">
              {standalone.map((w) => (
                <li key={w.id} className="flex items-center gap-3 px-4 py-2.5">
                  <WarehouseIcon className="size-4 text-subtle" /><span className="flex-1">{w.name}{!w.is_active && <Badge className="ms-2">Inactive</Badge>}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ kind: "warehouse", row: w })}>Edit</Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={edit?.kind === "outlet-new" ? "New outlet" : edit?.kind === "outlet" ? "Edit outlet" : edit?.kind === "register" ? "Register" : "Warehouse"}>
          {edit?.kind === "outlet-new" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="o-name"><Input id="o-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
              <Field label="Code" htmlFor="o-code" hint="2–6 letters/digits; prefixes invoice numbers"><Input id="o-code" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })} /></Field>
              <Field label="Island" htmlFor="o-island"><Input id="o-island" value={edit.island} onChange={(e) => setEdit({ ...edit, island: e.target.value })} /></Field>
              <Field label="Phone" htmlFor="o-phone"><Input id="o-phone" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
              <Field label="Address" htmlFor="o-addr"><Input id="o-addr" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
              <Field label="First register" htmlFor="o-reg"><Input id="o-reg" value={edit.register} onChange={(e) => setEdit({ ...edit, register: e.target.value })} /></Field>
            </div>
          )}
          {edit?.kind === "outlet" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="e-name"><Input id="e-name" value={edit.row.name} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, name: e.target.value } })} /></Field>
              <Field label="Island" htmlFor="e-island"><Input id="e-island" value={edit.row.island ?? ""} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, island: e.target.value } })} /></Field>
              <Field label="Address" htmlFor="e-addr"><Input id="e-addr" value={edit.row.address ?? ""} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, address: e.target.value } })} /></Field>
              <Field label="Phone" htmlFor="e-phone"><Input id="e-phone" value={edit.row.phone ?? ""} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, phone: e.target.value } })} /></Field>
              <label className="flex items-center gap-2 text-sm"><Switch checked={edit.row.is_active} onCheckedChange={(v) => setEdit({ ...edit, row: { ...edit.row, is_active: v } })} /> Active</label>
            </div>
          )}
          {edit?.kind === "register" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="rg-name"><Input id="rg-name" value={edit.row.name ?? ""} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, name: e.target.value } })} /></Field>
              <Field label="Default receipt" htmlFor="rg-w"><Select id="rg-w" value={edit.row.receipt_width ?? "80mm"} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, receipt_width: e.target.value as Register["receipt_width"] } })}>
                <option value="80mm">80 mm thermal</option><option value="58mm">58 mm thermal</option><option value="a4">A4 invoice</option></Select></Field>
              {edit.row.id && <label className="flex items-center gap-2 text-sm"><Switch checked={edit.row.is_active ?? true} onCheckedChange={(v) => setEdit({ ...edit, row: { ...edit.row, is_active: v } })} /> Active</label>}
            </div>
          )}
          {edit?.kind === "warehouse" && (
            <div className="space-y-3">
              <Field label="Name" htmlFor="w-name"><Input id="w-name" value={edit.row.name ?? ""} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, name: e.target.value } })} placeholder="e.g. Thilafushi store" /></Field>
              {edit.row.id && <label className="flex items-center gap-2 text-sm"><Switch checked={edit.row.is_active ?? true} onCheckedChange={(v) => setEdit({ ...edit, row: { ...edit.row, is_active: v } })} /> Active</label>}
            </div>
          )}
          <DialogFooter><Button loading={busy} onClick={save} disabled={edit?.kind === "outlet-new" && (!edit.name.trim() || !/^[A-Z0-9]{2,6}$/.test(edit.code))}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
