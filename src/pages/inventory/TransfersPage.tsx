import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ArrowRight, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { VariantPicker, variantLabel, type VariantOption } from "@/components/common/VariantPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/dates";
import { formatQty } from "@/lib/money";
import { rpc, supabase, unwrap } from "@/lib/supabase";

interface Transfer {
  id: string;
  transfer_number: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  status: "requested" | "approved" | "in_transit" | "received" | "cancelled";
  notes: string | null;
  created_at: string;
  issued_at: string | null;
  received_at: string | null;
  stock_transfer_items: { id: string; qty_requested: number; qty_issued: number; qty_received: number;
    product_variants: { name: string; products: { name: string } } }[];
}

const statusTone = { requested: "saffron", approved: "lagoon", in_transit: "lagoon", received: "ok", cancelled: "neutral" } as const;
const statusLabel = { requested: "Requested", approved: "Approved", in_transit: "In transit", received: "Received", cancelled: "Cancelled" };

function NewTransfer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const orgId = useOrgId();
  const { warehouses, outlet } = useOrg();
  const qc = useQueryClient();
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<{ v: VariantOption; qty: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) { setFrom(warehouses.find((w) => w.id !== outlet?.default_warehouse_id)?.id ?? ""); setTo(outlet?.default_warehouse_id ?? ""); setLines([]); setNotes(""); }
  }, [open, warehouses, outlet]);
  const valid = from && to && from !== to && lines.length > 0 && lines.every((l) => Number(l.qty) > 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Request a transfer" wide description="Stock leaves the source when issued and arrives when the destination receives it.">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <Field label="From" htmlFor="t-from"><Select id="t-from" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="" disabled>Choose</option>{warehouses.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          <ArrowRight className="mb-2.5 hidden size-4 text-muted sm:block" />
          <Field label="To" htmlFor="t-to"><Select id="t-to" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="" disabled>Choose</option>{warehouses.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        </div>
        <div className="mt-4"><VariantPicker stockedOnly onPick={(v) => setLines((ls) => (ls.some((l) => l.v.id === v.id) ? ls : [...ls, { v, qty: "" }]))} /></div>
        {lines.map((l, i) => (
          <div key={l.v.id} className="mt-2 flex items-center gap-2 text-sm">
            <span className="flex-1">{variantLabel(l.v)}</span>
            <Input aria-label="Quantity" inputMode="decimal" value={l.qty} autoFocus onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="h-8 w-24 text-end" />
            <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
          </div>
        ))}
        <Field label="Notes" htmlFor="t-notes" className="mt-4"><Textarea id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-14" /></Field>
        <DialogFooter>
          <Button disabled={!valid} loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await rpc("request_transfer", { payload: { organization_id: orgId, from_warehouse_id: from, to_warehouse_id: to, notes: notes || null, items: lines.map((l) => ({ variant_id: l.v.id, qty: l.qty })) } });
              toast.success("Transfer requested");
              qc.invalidateQueries({ queryKey: ["transfers"] });
              onOpenChange(false);
            } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}>Request transfer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDetail({ t, onClose }: { t: Transfer | null; onClose: () => void }) {
  const { warehouses, can } = useOrg();
  const qc = useQueryClient();
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (t) setQty(Object.fromEntries(t.stock_transfer_items.map((i) => [i.id, String(Number(t.status === "approved" ? i.qty_requested : i.qty_issued))])));
  }, [t]);
  if (!t) return null;
  const wh = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "—";
  const act = async (action: string) => {
    setBusy(true);
    try {
      const items = action === "issue" || action === "receive" ? t.stock_transfer_items.map((i) => ({ item_id: i.id, qty: qty[i.id] || "0" })) : null;
      await rpc("advance_transfer", { p_transfer: t.id, p_action: action, p_items: items });
      toast.success(`Transfer ${action === "issue" ? "issued" : action === "receive" ? "received" : action === "approve" ? "approved" : "cancelled"}`);
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const editableQty = t.status === "approved" || t.status === "in_transit";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" title={t.transfer_number} description={`${wh(t.from_warehouse_id)} → ${wh(t.to_warehouse_id)}`}>
        <Badge tone={statusTone[t.status]}>{statusLabel[t.status]}</Badge>
        <table className="mt-4 w-full text-sm">
          <thead className="text-xs text-muted"><tr><th className="py-1 text-start font-medium">Product</th><th className="text-end font-medium">Requested</th><th className="text-end font-medium">Issued</th><th className="text-end font-medium">Received</th></tr></thead>
          <tbody>
            {t.stock_transfer_items.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="py-2">{i.product_variants.name === "Default" ? i.product_variants.products.name : `${i.product_variants.products.name} · ${i.product_variants.name}`}</td>
                <td className="text-end tabular">{formatQty(i.qty_requested)}</td>
                <td className="text-end tabular">{t.status === "approved" ? <Input aria-label="Issue quantity" value={qty[i.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))} className="ms-auto h-8 w-20 text-end" /> : formatQty(i.qty_issued)}</td>
                <td className="text-end tabular">{t.status === "in_transit" ? <Input aria-label="Received quantity" value={qty[i.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))} className="ms-auto h-8 w-20 text-end" /> : formatQty(i.qty_received)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {editableQty && <p className="mt-2 text-xs text-muted">Adjust quantities if fewer were {t.status === "approved" ? "packed" : "delivered"}. Shortfalls stay on record.</p>}
        {t.notes && <p className="mt-4 text-sm text-muted">{t.notes}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          {t.status === "requested" && can("inventory.adjust") && <Button loading={busy} onClick={() => act("approve")}>Approve</Button>}
          {t.status === "approved" && <Button loading={busy} onClick={() => act("issue")}>Issue stock</Button>}
          {t.status === "in_transit" && <Button loading={busy} onClick={() => act("receive")}>Receive stock</Button>}
          {(t.status === "requested" || t.status === "approved") && <Button variant="danger-ghost" loading={busy} onClick={() => act("cancel")}>Cancel transfer</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TransfersPage() {
  const orgId = useOrgId();
  const { warehouses, can } = useOrg();
  const [creating, setCreating] = React.useState(false);
  const [selected, setSelected] = React.useState<Transfer | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["transfers", orgId],
    queryFn: async () => unwrap(await supabase.from("stock_transfers")
      .select("*, stock_transfer_items(id, qty_requested, qty_issued, qty_received, product_variants(name, products(name)))")
      .eq("organization_id", orgId).order("created_at", { ascending: false }).limit(200)) as unknown as Transfer[],
  });
  const wh = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "—";
  return (
    <>
      <PageHeader title="Stock transfers" description="Move stock between outlets and warehouses: request, approve, issue, receive."
        actions={can("inventory.transfer") && warehouses.length > 1 && <Button size="sm" onClick={() => setCreating(true)}><Plus /> New transfer</Button>} />
      <Card>
        <Table>
          <THead><tr><Th>Number</Th><Th>Route</Th><Th>Items</Th><Th>Status</Th><Th>Requested</Th></tr></THead>
          {isLoading ? <TableSkeleton cols={5} /> : (
            <tbody>
              {data?.map((t) => (
                <Tr key={t.id} onClick={() => setSelected(t)}>
                  <Td className="font-medium">{t.transfer_number}</Td>
                  <Td>{wh(t.from_warehouse_id)} <ArrowRight className="inline size-3.5 text-muted" /> {wh(t.to_warehouse_id)}</Td>
                  <Td className="text-muted">{t.stock_transfer_items.length}</Td>
                  <Td><Badge tone={statusTone[t.status]}>{statusLabel[t.status]}</Badge></Td>
                  <Td className="text-muted">{fmtDateTime(t.created_at)}</Td>
                </Tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={5}><EmptyState icon={ArrowLeftRight} title="No transfers yet">
                {warehouses.length > 1 ? "Request stock from another location when an outlet runs low." : "Add a second outlet or warehouse to move stock between them."}</EmptyState></td></tr>}
            </tbody>
          )}
        </Table>
      </Card>
      <NewTransfer open={creating} onOpenChange={setCreating} />
      <TransferDetail t={selected} onClose={() => setSelected(null)} />
    </>
  );
}
