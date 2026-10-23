import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, HandCoins, Pencil } from "lucide-react";
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { DateRangePicker, useRange } from "@/components/common/DateRange";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Card, CardHeader, ErrorNotice, Money, PageHeader, Skeleton, Stat } from "@/components/ui/misc";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { rpc, supabase, unwrap } from "@/lib/supabase";
import type { Customer } from "@/lib/types";
import { uuid } from "@/lib/utils";
import { useCart } from "../pos/cartStore";
import { CustomerForm } from "./CustomerForm";

interface Statement {
  opening_balance: number;
  entries: { date: string; type: string; note: string | null; debit: number; credit: number; balance: number; store_credit_delta: number; invoice_number: string | null; sale_id: string | null }[];
}

const entryLabel: Record<string, string> = {
  sale_on_account: "Sale on account", account_payment: "Payment received", refund_to_account: "Refund credited", store_credit_issued: "Store credit issued",
  store_credit_used: "Store credit used", void_reversal: "Void reversed", adjustment: "Adjustment",
};

function CollectDialog({ customer, open, onOpenChange }: { customer: Customer; open: boolean; onOpenChange: (o: boolean) => void }) {
  const orgId = useOrgId();
  const { paymentMethods, outlet } = useOrg();
  const qc = useQueryClient();
  const [amount, setAmount] = React.useState("");
  const [methodId, setMethodId] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [clientUuid, setClientUuid] = React.useState(uuid());
  const shiftId = useCart((s) => Object.values(s.shiftByRegister)[0]);
  const shifts = useQuery({ queryKey: ["open-shifts-outlet", outlet?.id], enabled: open,
    queryFn: async () => unwrap(await supabase.from("shifts").select("id, registers(name)").eq("outlet_id", outlet!.id).eq("status", "open")) as unknown as { id: string; registers: { name: string } }[] });
  const [shift, setShift] = React.useState("");
  const methods = paymentMethods.filter((m) => m.is_active && !["store_credit", "on_account"].includes(m.kind));
  React.useEffect(() => {
    if (open) { setAmount(Number(customer.account_balance).toFixed(2)); setMethodId(methods[0]?.id ?? ""); setReference(""); setClientUuid(uuid()); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  React.useEffect(() => { if (shifts.data?.length) setShift(shifts.data.find((s) => s.id === shiftId)?.id ?? shifts.data[0].id); }, [shifts.data, shiftId]);
  const method = methods.find((m) => m.id === methodId);
  const valid = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= Number(customer.account_balance) && method
    && (method.kind !== "cash" || shift) && (!method.requires_reference || reference.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Collect payment from ${customer.name}`} description={`Balance owed ${formatMoney(customer.account_balance)}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount (MVR)" htmlFor="col-amt"><Input id="col-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
          <Field label="Paid by" htmlFor="col-m"><Select id="col-m" value={methodId} onChange={(e) => setMethodId(e.target.value)}>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          {method?.kind === "cash" && <Field label="Into drawer" htmlFor="col-shift" error={shifts.data && !shifts.data.length ? "Open a shift to take cash." : undefined}>
            <Select id="col-shift" value={shift} onChange={(e) => setShift(e.target.value)}>{shifts.data?.map((s) => <option key={s.id} value={s.id}>{s.registers.name}</option>)}</Select></Field>}
          {method?.requires_reference && <Field label="Reference" htmlFor="col-ref"><Input id="col-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
        </div>
        {method?.requires_verification && <p className="mt-3 text-xs text-muted">This transfer reduces the balance once it's verified against the bank statement.</p>}
        <DialogFooter>
          <Button disabled={!valid} loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await rpc("record_customer_payment", { payload: { organization_id: orgId, client_uuid: clientUuid, customer_id: customer.id, payment_method_id: methodId,
                amount, reference: reference || null, shift_id: method?.kind === "cash" ? shift : null } });
              toast.success("Payment recorded");
              qc.invalidateQueries({ queryKey: ["customer", customer.id] });
              qc.invalidateQueries({ queryKey: ["statement", customer.id] });
              qc.invalidateQueries({ queryKey: ["customers"] });
              onOpenChange(false);
            } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}>Record payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CustomerDetailPage() {
  const { id } = useParams();
  const { can, org } = useOrg();
  const [range, setRange] = useRange("30d");
  const [editing, setEditing] = React.useState(false);
  const [collecting, setCollecting] = React.useState(false);
  const customer = useQuery({ queryKey: ["customer", id], queryFn: async () => unwrap(await supabase.from("customers").select("*").eq("id", id!).single()) as Customer });
  const stats = useQuery({ queryKey: ["customer-stats", id], queryFn: async () => {
    const rows = unwrap(await supabase.from("sales").select("id, invoice_number, sold_at, total, status, payment_status").eq("customer_id", id!).order("sold_at", { ascending: false }).limit(500)) as { id: string; invoice_number: string; sold_at: string; total: number; status: string; payment_status: string }[];
    const done = rows.filter((r) => r.status === "completed");
    return { rows, lifetime: done.reduce((s, r) => s + Number(r.total), 0), count: done.length, last: done[0]?.sold_at };
  } });
  const statement = useQuery({ queryKey: ["statement", id, range.from, range.to], queryFn: () => rpc<Statement>("customer_statement", { p_customer: id, p_from: range.from, p_to: range.to }) });

  async function statementPdf() {
    const st = statement.data!;
    const c = customer.data!;
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ unit: "pt" });
    doc.setFont("helvetica", "bold").setFontSize(15).text(org?.legal_name || org?.name || "", 40, 48);
    doc.setFontSize(13).text("CUSTOMER STATEMENT", 555, 48, { align: "right" });
    doc.setFont("helvetica", "normal").setFontSize(9).text(`${fmtDate(range.from)} – ${fmtDate(range.to)}`, 555, 64, { align: "right" });
    doc.text([c.name, c.phone ?? "", c.address ?? "", c.tin ? `TIN ${c.tin}` : ""].filter(Boolean), 40, 80);
    autoTable(doc, { startY: 130, head: [["Date", "Description", "Charges", "Payments", "Balance"]],
      body: [["", "Opening balance", "", "", formatAmount(st.opening_balance)],
        ...st.entries.filter((e) => e.debit || e.credit).map((e) => [fmtDate(e.date), `${entryLabel[e.type] ?? e.type}${e.invoice_number ? ` ${e.invoice_number}` : e.note ? ` (${e.note})` : ""}`,
          e.debit ? formatAmount(e.debit) : "", e.credit ? formatAmount(e.credit) : "", formatAmount(e.balance)])],
      headStyles: { fillColor: [13, 43, 51] }, styles: { fontSize: 9 }, columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } } });
    doc.setFont("helvetica", "bold").text(`Amount due: MVR ${formatAmount(c.account_balance)}`, 555, (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24, { align: "right" });
    doc.save(`statement-${c.name.replace(/\W+/g, "-")}.pdf`);
  }

  if (customer.isLoading) return <Skeleton className="h-96" />;
  if (customer.error || !customer.data) return <ErrorNotice error={customer.error ?? "Customer not found"} />;
  const c = customer.data;
  return (
    <>
      <Link to="/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Customers</Link>
      <PageHeader title={c.name} description={[c.phone, c.email, c.island].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            {can("customers.payments") && Number(c.account_balance) > 0 && <Button size="sm" onClick={() => setCollecting(true)}><HandCoins /> Collect payment</Button>}
            {can("customers.manage") && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
          </>
        } />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lifetime spend" value={formatMoney(stats.data?.lifetime ?? 0)} loading={stats.isLoading} hint={stats.data && `${stats.data.count} purchases`} />
        <Stat label="Balance owed" value={formatMoney(c.account_balance)} hint={Number(c.credit_limit) ? `limit ${formatMoney(c.credit_limit)}` : "no credit limit"} />
        <Stat label="Store credit" value={formatMoney(c.store_credit)} />
        <Stat label="Last purchase" value={stats.data?.last ? fmtDate(stats.data.last) : "—"} loading={stats.isLoading} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Account statement" action={<div className="flex items-center gap-2"><DateRangePicker value={range} onChange={setRange} />
            <Button variant="secondary" size="sm" disabled={!statement.data} onClick={statementPdf}><Download /> PDF</Button></div>} />
          <Table>
            <THead><tr><Th>Date</Th><Th>Description</Th><Th align="end">Charge</Th><Th align="end">Payment</Th><Th align="end">Balance</Th></tr></THead>
            <tbody>
              <Tr><Td colSpan={4} className="text-muted">Opening balance</Td><Td align="end"><Money value={statement.data?.opening_balance ?? 0} plain /></Td></Tr>
              {statement.data?.entries.map((e, i) => (
                <Tr key={i}>
                  <Td className="whitespace-nowrap text-muted">{fmtDateTime(e.date)}</Td>
                  <Td>{entryLabel[e.type] ?? e.type} {e.sale_id && e.invoice_number ? <Link to={`/sales/${e.sale_id}`} className="text-lagoon hover:underline">{e.invoice_number}</Link> : <span className="text-muted">{e.note}</span>}
                    {Number(e.store_credit_delta) !== 0 && <span className="block text-xs text-muted">Store credit {Number(e.store_credit_delta) > 0 ? "+" : ""}{formatAmount(e.store_credit_delta)}</span>}</Td>
                  <Td align="end">{Number(e.debit) ? formatAmount(e.debit) : ""}</Td>
                  <Td align="end" className="text-ok">{Number(e.credit) ? formatAmount(e.credit) : ""}</Td>
                  <Td align="end" className="font-medium">{formatAmount(e.balance)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Purchase history" />
          <Table>
            <THead><tr><Th>Invoice</Th><Th>Date</Th><Th align="end">Total</Th></tr></THead>
            <tbody>
              {stats.data?.rows.slice(0, 50).map((s) => (
                <Tr key={s.id}>
                  <Td><Link to={`/sales/${s.id}`} className="font-medium hover:underline">{s.invoice_number}</Link>{s.status === "voided" && <span className="ms-2 text-xs text-coral">void</span>}</Td>
                  <Td className="text-muted">{fmtDateTime(s.sold_at)}</Td>
                  <Td align="end"><Money value={s.total} plain /></Td>
                </Tr>
              ))}
              {stats.data?.rows.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-sm text-muted">No purchases yet.</td></tr>}
            </tbody>
          </Table>
        </Card>
      </div>
      <CustomerForm customer={c} open={editing} onOpenChange={setEditing} />
      <CollectDialog customer={c} open={collecting} onOpenChange={setCollecting} />
    </>
  );
}
