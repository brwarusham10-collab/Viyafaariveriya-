import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Check, RotateCcw, X } from "lucide-react";
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useOrg } from "@/app/org";
import { ReceiptActions, ReceiptDocument, type ReceiptFormat } from "@/components/receipt/Receipt";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Badge, Card, CardHeader, ErrorNotice, Money, PageHeader, Skeleton } from "@/components/ui/misc";
import { fmtDateTime } from "@/lib/dates";
import { centsToString, divRound, formatMoney, formatQty, toCents, toScaled } from "@/lib/money";
import { loadReceipt } from "@/lib/receipt";
import { rpc, supabase, unwrap } from "@/lib/supabase";
import type { Payment, Sale, SaleItem, Shift } from "@/lib/types";
import { uuid } from "@/lib/utils";
import { paymentStatus } from "./SalesPage";

type FullItem = SaleItem & { amount_refunded: number; tax_refunded: number };

/** Mirrors refund_core's line amount: the final unit absorbs rounding. */
export function refundAmount(item: FullItem, qty: string): bigint {
  const q = toScaled(qty || "0", 3);
  if (q <= 0n) return 0n;
  const sold = toScaled(item.qty, 3);
  const already = toScaled(item.qty_refunded, 3);
  if (already + q === sold) return toCents(item.line_total) - toCents(item.amount_refunded);
  return divRound(toCents(item.line_total) * q, sold);
}

function RefundDialog({ open, onOpenChange, sale, items, payments }: {
  open: boolean; onOpenChange: (o: boolean) => void; sale: Sale; items: FullItem[]; payments: Payment[];
}) {
  const { paymentMethods } = useOrg();
  const qc = useQueryClient();
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [restock, setRestock] = React.useState(true);
  const [reason, setReason] = React.useState("");
  const [methodId, setMethodId] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [shiftId, setShiftId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [clientUuid, setClientUuid] = React.useState(uuid());

  const shifts = useQuery({
    queryKey: ["open-shifts-outlet", sale.outlet_id],
    enabled: open,
    queryFn: async () => unwrap(await supabase.from("shifts").select("id, register_id, registers(name)").eq("outlet_id", sale.outlet_id).eq("status", "open")) as unknown as (Shift & { registers: { name: string } })[],
  });

  React.useEffect(() => {
    if (open) {
      setQty({}); setReason(""); setReference(""); setRestock(true); setClientUuid(uuid());
      const original = payments.find((p) => p.direction === "in" && p.status === "completed");
      const m = paymentMethods.find((pm) => pm.name === original?.method_name) ?? paymentMethods.find((pm) => pm.kind === "cash");
      setMethodId(m?.id ?? "");
    }
  }, [open, payments, paymentMethods]);
  React.useEffect(() => { if (shifts.data?.length && !shiftId) setShiftId(shifts.data[0].id); }, [shifts.data, shiftId]);

  const total = items.reduce((s, i) => s + refundAmount(i, qty[i.id] ?? ""), 0n);
  const method = paymentMethods.find((m) => m.id === methodId);
  const needsShift = method?.kind === "cash";
  const qtyErrors = items.filter((i) => qty[i.id] && (!/^\d+(\.\d{1,3})?$/.test(qty[i.id]) || Number(qty[i.id]) > Number(i.qty) - Number(i.qty_refunded)));
  const valid = total > 0n && reason.trim().length >= 3 && method && qtyErrors.length === 0 && (!needsShift || shiftId)
    && (!(method.kind === "store_credit" || method.kind === "on_account") || sale.customer_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Refund ${sale.invoice_number}`} wide description="Refunds are calculated from what the customer actually paid on each line, including discounts.">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted"><tr><th className="py-1 text-start font-medium">Item</th><th className="text-end font-medium">Refundable</th><th className="text-end font-medium">Refund qty</th><th className="text-end font-medium">Amount</th></tr></thead>
          <tbody>
            {items.map((i) => {
              const left = Number(i.qty) - Number(i.qty_refunded);
              return (
                <tr key={i.id} className="border-t border-line">
                  <td className="py-2">{i.name}</td>
                  <td className="text-end tabular text-muted">{formatQty(left)}</td>
                  <td className="py-1.5 text-end">
                    <div className="flex items-center justify-end gap-1">
                      <Input aria-label={`Refund quantity for ${i.name}`} inputMode="decimal" value={qty[i.id] ?? ""} disabled={left <= 0}
                        onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))} className="h-8 w-20 text-end" aria-invalid={qtyErrors.includes(i)} />
                      <Button variant="ghost" size="sm" disabled={left <= 0} onClick={() => setQty((q) => ({ ...q, [i.id]: String(left) }))}>All</Button>
                    </div>
                  </td>
                  <td className="text-end tabular">{formatMoney(centsToString(refundAmount(i, qty[i.id] ?? "")))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Refund to" htmlFor="rf-method">
            <Select id="rf-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              {paymentMethods.filter((m) => m.is_active && (sale.customer_id || (m.kind !== "store_credit" && m.kind !== "on_account"))).map((m) => (
                <option key={m.id} value={m.id}>{m.kind === "store_credit" ? "Store credit (customer keeps it)" : m.kind === "on_account" ? "Reduce customer account balance" : m.name}</option>
              ))}
            </Select>
          </Field>
          {needsShift ? (
            <Field label="Pay out from" htmlFor="rf-shift" error={shifts.data && !shifts.data.length ? "Open a shift at this outlet to pay cash back." : undefined}>
              <Select id="rf-shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
                {shifts.data?.map((s) => <option key={s.id} value={s.id}>{s.registers.name} drawer</option>)}
              </Select>
            </Field>
          ) : method?.kind === "bank_transfer" ? (
            <Field label="Transfer reference" htmlFor="rf-ref"><Input id="rf-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          ) : <div />}
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm">
          <Switch checked={restock} onCheckedChange={setRestock} />
          Return items to stock {!restock && <span className="text-muted">(damaged items are written off)</span>}
        </label>
        <Field label="Reason" htmlFor="rf-reason" className="mt-4"><Textarea id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-14" placeholder="e.g. Customer returned unopened" /></Field>
        <DialogFooter className="items-center">
          <span className="me-auto text-sm">Refund total <span className="font-display text-lg font-semibold tabular">{formatMoney(centsToString(total))}</span></span>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" disabled={!valid} loading={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await rpc<{ refund_number: string }>("process_refund", { payload: {
                client_uuid: clientUuid, sale_id: sale.id, reason: reason.trim(), restock, shift_id: needsShift ? shiftId : null,
                items: items.filter((i) => Number(qty[i.id]) > 0).map((i) => ({ sale_item_id: i.id, qty: qty[i.id] })),
                payouts: [{ payment_method_id: methodId, amount: centsToString(total), reference: reference || undefined }],
              } });
              toast.success(`Refund ${r.refund_number} recorded`);
              qc.invalidateQueries({ queryKey: ["sale", sale.id] });
              qc.invalidateQueries({ queryKey: ["sales"] });
              onOpenChange(false);
            } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}>Refund {formatMoney(centsToString(total))}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SaleDetailPage() {
  const { id } = useParams();
  const { can } = useOrg();
  const qc = useQueryClient();
  const [format, setFormat] = React.useState<ReceiptFormat>("80mm");
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [voidOpen, setVoidOpen] = React.useState(false);
  const [verify, setVerify] = React.useState<{ payment: Payment; approve: boolean } | null>(null);

  const q = useQuery({
    queryKey: ["sale", id],
    queryFn: async () => {
      const [receipt, sale, items, payments, refunds] = await Promise.all([
        loadReceipt(id!),
        supabase.from("sales").select("*, shifts(status)").eq("id", id!).single(),
        supabase.from("sale_items").select("*").eq("sale_id", id!).order("line_no"),
        supabase.from("payments").select("*").eq("sale_id", id!).order("created_at"),
        supabase.from("refunds").select("*, refund_items(qty, amount, sale_item_id)").eq("sale_id", id!).order("created_at"),
      ]);
      return {
        receipt, sale: unwrap(sale) as Sale & { shifts: { status: string } }, items: unwrap(items) as FullItem[],
        payments: unwrap(payments) as Payment[], refunds: unwrap(refunds) as { id: string; refund_number: string; kind: string; reason: string; total: number; restock: boolean; created_at: string; refund_items: { qty: number }[] }[],
      };
    },
  });

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <ErrorNotice error={q.error ?? "Sale not found"} />;
  const { sale, items, payments, refunds, receipt } = q.data;
  const canVoid = can("pos.void") && sale.status === "completed" && sale.shifts.status === "open" && refunds.length === 0;
  const refundable = sale.status === "completed" && items.some((i) => Number(i.qty_refunded) < Number(i.qty));

  return (
    <>
      <Link to="/sales" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Sales</Link>
      <PageHeader title={sale.invoice_number} description={fmtDateTime(sale.sold_at)}
        actions={
          <>
            {sale.status === "voided" ? <Badge tone="coral">Voided</Badge> : <Badge tone={paymentStatus[sale.payment_status].tone}>{paymentStatus[sale.payment_status].label}</Badge>}
            {can("pos.refund") && refundable && <Button variant="secondary" size="sm" onClick={() => setRefundOpen(true)}><RotateCcw /> Refund</Button>}
            {canVoid && <Button variant="danger-ghost" size="sm" onClick={() => setVoidOpen(true)}><Ban /> Void sale</Button>}
          </>
        } />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Items" />
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-4 py-2 text-start font-medium">Item</th><th className="px-2 text-end font-medium">Qty</th><th className="px-2 text-end font-medium">Price</th><th className="px-2 text-end font-medium">Discount</th><th className="px-2 text-end font-medium">Tax</th><th className="px-4 text-end font-medium">Total</th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t border-line">
                    <td className="px-4 py-2">{i.name}{i.price_overridden && <Badge tone="saffron" className="ms-2">Price changed from {Number(i.list_price).toFixed(2)}</Badge>}
                      {Number(i.qty_refunded) > 0 && <div className="text-xs text-coral">{formatQty(i.qty_refunded)} refunded</div>}</td>
                    <td className="px-2 text-end tabular">{formatQty(i.qty)}</td>
                    <td className="px-2 text-end tabular">{Number(i.unit_price).toFixed(2)}</td>
                    <td className="px-2 text-end tabular">{(Number(i.line_discount) + Number(i.cart_discount_alloc)).toFixed(2)}</td>
                    <td className="px-2 text-end tabular">{Number(i.tax_amount).toFixed(2)}</td>
                    <td className="px-4 text-end font-medium tabular">{Number(i.line_total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line-strong">
                <tr><td colSpan={5} className="px-4 py-2 text-end text-muted">Total</td><td className="px-4 text-end font-display text-base font-semibold"><Money value={sale.total} /></td></tr>
              </tfoot>
            </table>
          </Card>
          <Card>
            <CardHeader title="Payments" />
            <ul className="divide-y divide-line">
              {payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1">
                    {p.direction === "out" ? "Refund via " : ""}{p.method_name}
                    {p.reference && <span className="text-muted"> · ref {p.reference}</span>}
                    {p.verification_note && <span className="block text-xs text-muted">{p.verification_note}</span>}
                  </span>
                  {p.status === "pending" && <Badge tone="saffron">Pending</Badge>}
                  {p.status === "rejected" && <Badge tone="coral">Rejected</Badge>}
                  <Money value={p.direction === "out" ? -Number(p.amount) : p.amount} className="font-medium" />
                  {p.status === "pending" && can("payments.verify") && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setVerify({ payment: p, approve: true })}><Check /> Verified</Button>
                      <Button size="sm" variant="danger-ghost" onClick={() => setVerify({ payment: p, approve: false })}><X /> Reject</Button>
                    </span>
                  )}
                </li>
              ))}
              {Number(sale.change_given) > 0 && <li className="flex justify-between px-4 py-2.5 text-sm text-muted"><span>Change given</span><Money value={sale.change_given} /></li>}
            </ul>
          </Card>
          {refunds.length > 0 && (
            <Card>
              <CardHeader title="Refunds and voids" />
              <ul className="divide-y divide-line">
                {refunds.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="flex-1"><span className="font-medium">{r.refund_number}</span> · {r.kind === "void" ? "Void" : "Refund"} · {r.reason}
                      <span className="block text-xs text-muted">{fmtDateTime(r.created_at)} · {r.restock ? "restocked" : "written off"}</span></span>
                    <Money value={-Number(r.total)} className="font-medium text-coral" />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader title="Receipt" />
          <div className="border-b border-line px-4 py-2.5"><ReceiptActions data={receipt} format={format} onFormat={setFormat} /></div>
          <div className="max-h-[70vh] overflow-y-auto bg-white p-2"><ReceiptDocument data={receipt} format={format} /></div>
        </Card>
      </div>
      <RefundDialog open={refundOpen} onOpenChange={setRefundOpen} sale={sale} items={items} payments={payments} />
      <ConfirmDialog open={voidOpen} onOpenChange={setVoidOpen} title={`Void ${sale.invoice_number}?`} danger requireReason confirmLabel="Void sale"
        description="Reverses the whole sale: stock returns, cash and card amounts are paid back from this shift, and the invoice is marked VOID."
        onConfirm={async (reason) => {
          try {
            await rpc("void_sale", { p_sale: sale.id, p_reason: reason, p_client_uuid: uuid() });
            toast.success("Sale voided");
            qc.invalidateQueries({ queryKey: ["sale", sale.id] });
            qc.invalidateQueries({ queryKey: ["sales"] });
          } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
      <ConfirmDialog open={!!verify} onOpenChange={(o) => !o && setVerify(null)} requireReason={!verify?.approve}
        title={verify?.approve ? "Mark transfer as received?" : "Reject this transfer?"} danger={!verify?.approve}
        confirmLabel={verify?.approve ? "Mark verified" : "Reject transfer"}
        description={verify && `${verify.payment.method_name} ${formatMoney(verify.payment.amount)}${verify.payment.reference ? `, reference ${verify.payment.reference}` : ""}. ${verify.approve ? "Only confirm after you've seen the money on the bank statement." : "The sale will be flagged as unpaid."}`}
        onConfirm={async (note) => {
          try {
            await rpc("verify_payment", { p_payment: verify!.payment.id, p_approve: verify!.approve, p_note: note || "Matched on bank statement" });
            qc.invalidateQueries({ queryKey: ["sale", sale.id] });
          } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
    </>
  );
}
