import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Truck } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Switch, Textarea } from "@/components/ui/input";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { supabase, toAppError, unwrap } from "@/lib/supabase";

interface Supplier {
  id: string; name: string; contact_name: string | null; phone: string | null; email: string | null; address: string | null;
  tin: string | null; payment_terms_days: number; notes: string | null; is_active: boolean;
}

const empty: Omit<Supplier, "id"> = { name: "", contact_name: "", phone: "", email: "", address: "", tin: "", payment_terms_days: 0, notes: "", is_active: true };

export default function SuppliersPage() {
  const orgId = useOrgId();
  const { can } = useOrg();
  const qc = useQueryClient();
  const [edit, setEdit] = React.useState<(Omit<Supplier, "id"> & { id?: string }) | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["suppliers", orgId],
    queryFn: async () => unwrap(await supabase.from("suppliers").select("*").eq("organization_id", orgId).order("name")) as Supplier[],
  });
  async function save() {
    if (!edit?.name.trim()) return;
    const { id, ...row } = edit;
    const res = id ? await supabase.from("suppliers").update(row).eq("id", id) : await supabase.from("suppliers").insert({ ...row, organization_id: orgId });
    if (res.error) return toast.error(toAppError(res.error).message);
    toast.success("Supplier saved");
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    setEdit(null);
  }
  const f = (k: keyof Supplier) => ({ value: (edit?.[k] as string | number | null) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setEdit((x) => x && { ...x, [k]: e.target.value }) });
  return (
    <>
      <PageHeader title="Suppliers" description="Who you buy stock from." actions={can("suppliers.manage") && <Button size="sm" onClick={() => setEdit({ ...empty })}><Plus /> New supplier</Button>} />
      <Card>
        <Table>
          <THead><tr><Th>Name</Th><Th>Contact</Th><Th>Phone</Th><Th>TIN</Th><Th align="end">Terms</Th></tr></THead>
          {isLoading ? <TableSkeleton cols={5} /> : (
            <tbody>
              {data?.map((s) => (
                <Tr key={s.id} onClick={can("suppliers.manage") ? () => setEdit(s) : undefined}>
                  <Td className="font-medium">{s.name}{!s.is_active && <Badge className="ms-2">Inactive</Badge>}</Td>
                  <Td className="text-muted">{s.contact_name ?? "—"}</Td><Td className="text-muted">{s.phone ?? "—"}</Td><Td className="text-muted">{s.tin ?? "—"}</Td>
                  <Td align="end" className="text-muted">{s.payment_terms_days ? `${s.payment_terms_days} days` : "On delivery"}</Td>
                </Tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={5}><EmptyState icon={Truck} title="No suppliers yet">Add the wholesalers and importers you order from.</EmptyState></td></tr>}
            </tbody>
          )}
        </Table>
      </Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={edit?.id ? "Edit supplier" : "New supplier"}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="s-name" className="sm:col-span-2"><Input id="s-name" {...f("name")} autoFocus /></Field>
            <Field label="Contact person" htmlFor="s-contact"><Input id="s-contact" {...f("contact_name")} /></Field>
            <Field label="Phone" htmlFor="s-phone"><Input id="s-phone" {...f("phone")} /></Field>
            <Field label="Email" htmlFor="s-email"><Input id="s-email" type="email" {...f("email")} /></Field>
            <Field label="TIN" htmlFor="s-tin"><Input id="s-tin" {...f("tin")} /></Field>
            <Field label="Payment terms (days)" htmlFor="s-terms"><Input id="s-terms" inputMode="numeric" {...f("payment_terms_days")} /></Field>
            <Field label="Address" htmlFor="s-addr"><Input id="s-addr" {...f("address")} /></Field>
            <Field label="Notes" htmlFor="s-notes" className="sm:col-span-2"><Textarea id="s-notes" {...f("notes")} className="min-h-14" /></Field>
            {edit?.id && <label className="flex items-center gap-2 text-sm"><Switch checked={edit.is_active} onCheckedChange={(v) => setEdit({ ...edit, is_active: v })} /> Active</label>}
          </div>
          <DialogFooter><Button onClick={save} disabled={!edit?.name.trim()}>Save supplier</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
