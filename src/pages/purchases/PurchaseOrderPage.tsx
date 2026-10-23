import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, PackageCheck, Sparkles, Trash2 } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { VariantPicker, variantLabel } from "@/components/common/VariantPicker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, Card, CardHeader, ErrorNotice, Money, PageHeader, Skeleton } from "@/components/ui/misc";
import { fmtDate } from "@/lib/dates";
import { formatAmount, formatMoney, formatQty } from "@/lib/money";
import { rpc, supabase, unwrap } from "@/lib/supabase";
import { uuid } from "@/lib/utils";
import { poLabel, poTone } from "./PurchasesPage";
import { ReceiveDialog, type PoForReceive } from "./ReceiveDialog";

interface Line { key: string; id?: string; variant_id: string; label: string; qty_ordered: string; unit_cost: string; discount_amount: string; qty_received?: number }

export default function PurchaseOrderPage() {
  const { id } = useParams();
  const isNew = !id;
  const orgId = useOrgId();
  const { warehouses, outlet, can, org } = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [supplier, setSupplier] = React.useState("");
  const [warehouse, setWarehouse] = React.useState(outlet?.default_warehouse_id ?? "");
  const [expected, setExpected] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [receiveOpen, setReceiveOpen] = React.useState(false);

  const suppliers = useQuery({ queryKey: ["suppliers", orgId], queryFn: async () => unwrap(await supabase.from("suppliers").select("id, name, email, phone").eq("organization_id", orgId).order("name")) as { id: string; name: string; email: string | null; phone: string | null }[] });
  const po = useQuery({
    queryKey: ["purchase-order", id],
    enabled: !isNew,
    queryFn: async () => unwrap(await supabase.from("purchase_orders").select("*, purchase_order_items(*, product_variants(name, products(name)))").eq("id", id!).single()) as {
      id: string; po_number: string; status: keyof typeof poLabel; supplier_id: string; warehouse_id: string; expected_date: string | null; notes: string | null;
      order_date: string; subtotal: number; discount_total: number; total: number;
      purchase_order_items: { id: string; variant_id: string; qty_ordered: number; qty_received: number; unit_cost: number; discount_amount: number; line_total: number; product_variants: { name: string; products: { name: string } } }[];
    },
  });
  React.useEffect(() => {
    if (!po.data) return;
    setSupplier(po.data.supplier_id); setWarehouse(po.data.warehouse_id); setExpected(po.data.expected_date ?? ""); setNotes(po.data.notes ?? "");
    setLines(po.data.purchase_order_items.map((i) => ({ key: i.id, id: i.id, variant_id: i.variant_id,
      label: variantLabel({ name: i.product_variants.name, products: i.product_variants.products } as never), qty_ordered: String(Number(i.qty_ordered)),
      unit_cost: Number(i.unit_cost).toFixed(2), discount_amount: Number(i.discount_amount) ? Number(i.discount_amount).toFixed(2) : "", qty_received: Number(i.qty_received) })));
  }, [po.data]);

  const editable = (isNew || po.data?.status === "draft") && can("purchases.manage");
  const total = lines.reduce((s, l) => s + (Number(l.qty_ordered) || 0) * (Number(l.unit_cost) || 0) - (Number(l.discount_amount) || 0), 0);
  const valid = supplier && warehouse && lines.length > 0 && lines.every((l) => Number(l.qty_ordered) > 0 && /^\d+(\.\d{1,2})?$/.test(l.unit_cost));

  async function save() {
    setBusy(true);
    try {
      const pid = await rpc<string>("save_purchase_order", { payload: { organization_id: orgId, id: id ?? null, supplier_id: supplier, warehouse_id: warehouse,
        expected_date: expected || null, notes: notes || null,
        items: lines.map((l) => ({ variant_id: l.variant_id, qty_ordered: l.qty_ordered, unit_cost: l.unit_cost, discount_amount: l.discount_amount || 0 })) } });
      toast.success("Purchase order saved");
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchase-order", pid] });
      if (isNew) navigate(`/purchases/${pid}`, { replace: true });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function setStatus(s: string) {
    try {
      await rpc("set_purchase_order_status", { p_po: id, p_status: s });
      qc.invalidateQueries({ queryKey: ["purchase-order", id] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    } catch (e) { toast.error((e as Error).message); }
  }
  async function addSuggestions() {
    if (!warehouse) return;
    const rows = await rpc<{ variant_id: string; product_name: string; variant_name: string; suggested_qty: number; last_cost: number }[]>("reorder_suggestions", { p_org: orgId, p_warehouse: warehouse });
    if (!rows.length) return toast.message("Nothing is below its minimum at this location.");
    setLines((ls) => [...ls, ...rows.filter((r) => !ls.some((l) => l.variant_id === r.variant_id)).map((r) => ({
      key: uuid(), variant_id: r.variant_id, label: r.variant_name === "Default" ? r.product_name : `${r.product_name} · ${r.variant_name}`,
      qty_ordered: String(Number(r.suggested_qty)), unit_cost: Number(r.last_cost).toFixed(2), discount_amount: "" }))]);
  }
  async function pdf() {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const sup = suppliers.data?.find((s) => s.id === supplier);
    const doc = new jsPDF({ unit: "pt" });
    doc.setFont("helvetica", "bold").setFontSize(16).text(org?.legal_name || org?.name || "", 40, 50);
    doc.setFontSize(14).text("PURCHASE ORDER", 555, 50, { align: "right" });
    doc.setFont("helvetica", "normal").setFontSize(9).text(`No. ${po.data?.po_number}`, 555, 66, { align: "right" }).text(`Date ${fmtDate(po.data?.order_date)}`, 555, 78, { align: "right" });
    if (expected) doc.text(`Deliver by ${fmtDate(expected)}`, 555, 90, { align: "right" });
    doc.text([org?.address, org?.island, org?.phone, org?.tin ? `TIN ${org.tin}` : null].filter(Boolean) as string[], 40, 66);
    doc.setFont("helvetica", "bold").text("Supplier", 40, 130).setFont("helvetica", "normal").text([sup?.name ?? "", sup?.phone ?? "", sup?.email ?? ""].filter(Boolean), 40, 142);
    doc.text(`Deliver to: ${warehouses.find((w) => w.id === warehouse)?.name ?? ""}`, 300, 142);
    autoTable(doc, { startY: 180, head: [["Item", "Qty", "Unit cost", "Discount", "Amount (MVR)"]],
      body: lines.map((l) => [l.label, formatQty(l.qty_ordered), formatAmount(l.unit_cost), formatAmount(l.discount_amount || 0), formatAmount((Number(l.qty_ordered) * Number(l.unit_cost)) - (Number(l.discount_amount) || 0))]),
      foot: [["", "", "", "Total", formatAmount(total)]], headStyles: { fillColor: [13, 43, 51] }, footStyles: { fillColor: [244, 246, 245], textColor: 20 }, styles: { fontSize: 9 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } } });
    if (notes) doc.text(notes, 40, (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24, { maxWidth: 515 });
    doc.save(`${po.data?.po_number}.pdf`);
  }

  if (!isNew && po.isLoading) return <Skeleton className="h-96" />;
  if (po.error) return <ErrorNotice error={po.error} />;
  const receiveData: PoForReceive | null = po.data ? { id: po.data.id, supplier_id: po.data.supplier_id, warehouse_id: po.data.warehouse_id, po_number: po.data.po_number,
    items: po.data.purchase_order_items.map((i) => ({ id: i.id, variant_id: i.variant_id, label: variantLabel({ name: i.product_variants.name, products: i.product_variants.products } as never),
      qty_ordered: i.qty_ordered, qty_received: i.qty_received, unit_cost: i.unit_cost })) } : null;

  return (
    <>
      <Link to="/purchases" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Purchases</Link>
      <PageHeader title={isNew ? "New purchase order" : po.data!.po_number} description={!isNew && <Badge tone={poTone[po.data!.status]}>{poLabel[po.data!.status]}</Badge>}
        actions={
          <>
            {!isNew && <Button variant="secondary" size="sm" onClick={pdf}><Download /> PDF</Button>}
            {editable && <Button size="sm" variant={isNew ? "primary" : "secondary"} disabled={!valid} loading={busy} onClick={save}>{isNew ? "Save draft" : "Save changes"}</Button>}
            {po.data?.status === "draft" && can("purchases.approve") && <Button size="sm" onClick={() => setStatus("approved")}>Approve</Button>}
            {(po.data?.status === "approved" || po.data?.status === "partial") && can("purchases.manage") && <Button size="sm" onClick={() => setReceiveOpen(true)}><PackageCheck /> Receive stock</Button>}
            {po.data?.status === "partial" && can("purchases.manage") && <Button size="sm" variant="ghost" onClick={() => setStatus("received")}>Close short</Button>}
            {(po.data?.status === "draft" || po.data?.status === "approved") && can("purchases.manage") && <Button size="sm" variant="danger-ghost" onClick={() => setStatus("cancelled")}>Cancel order</Button>}
          </>
        } />
      <fieldset disabled={!editable} className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="Items" action={editable && <Button variant="secondary" size="sm" onClick={addSuggestions}><Sparkles /> Add low-stock items</Button>} />
          {editable && <div className="border-b border-line p-3"><VariantPicker onPick={(v) => setLines((ls) => [...ls, { key: uuid(), variant_id: v.id, label: variantLabel(v), qty_ordered: "1", unit_cost: Number(v.cost_price).toFixed(2), discount_amount: "" }])} /></div>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-4 py-2 text-start font-medium">Product</th><th className="text-end font-medium">Qty</th>{!isNew && <th className="text-end font-medium">Received</th>}<th className="text-end font-medium">Unit cost</th><th className="text-end font-medium">Discount</th><th className="px-4 text-end font-medium">Amount</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key} className="border-t border-line">
                    <td className="px-4 py-1.5">{l.label}</td>
                    <td><Input aria-label="Quantity" inputMode="decimal" value={l.qty_ordered} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty_ordered: e.target.value } : x)))} className="ms-auto h-8 w-20 text-end" /></td>
                    {!isNew && <td className="text-end tabular text-muted">{formatQty(l.qty_received ?? 0)}</td>}
                    <td><Input aria-label="Unit cost" inputMode="decimal" value={l.unit_cost} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit_cost: e.target.value } : x)))} className="ms-auto h-8 w-24 text-end" /></td>
                    <td><Input aria-label="Discount" inputMode="decimal" value={l.discount_amount} placeholder="0.00" onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, discount_amount: e.target.value } : x)))} className="ms-auto h-8 w-20 text-end" /></td>
                    <td className="px-4 text-end tabular">{formatAmount((Number(l.qty_ordered) || 0) * (Number(l.unit_cost) || 0) - (Number(l.discount_amount) || 0))}</td>
                    <td className="w-9">{editable && <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>}</td>
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">Search for products above, or add everything that's running low.</td></tr>}
              </tbody>
              <tfoot><tr className="border-t border-line-strong"><td colSpan={isNew ? 4 : 5} className="px-4 py-2 text-end text-muted">Total</td><td className="px-4 text-end font-display text-base font-semibold"><Money value={total} /></td><td /></tr></tfoot>
            </table>
          </div>
        </Card>
        <Card className="h-fit space-y-4 p-4">
          <Field label="Supplier" htmlFor="po-sup">
            <Select id="po-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="" disabled>Choose a supplier</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          {suppliers.data?.length === 0 && <p className="text-xs text-muted"><Link to="/suppliers" className="text-lagoon underline">Add a supplier</Link> first.</p>}
          <Field label="Deliver to" htmlFor="po-wh"><Select id="po-wh" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
            {warehouses.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          <Field label="Expected delivery" htmlFor="po-exp"><Input id="po-exp" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
          <Field label="Notes for supplier" htmlFor="po-notes"><Textarea id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {!isNew && po.data && <div className="border-t border-line pt-3 text-sm text-muted">Ordered {fmtDate(po.data.order_date)} · {formatMoney(po.data.total)}</div>}
        </Card>
      </fieldset>
      <ReceiveDialog open={receiveOpen} onOpenChange={setReceiveOpen} po={receiveData} />
    </>
  );
}
