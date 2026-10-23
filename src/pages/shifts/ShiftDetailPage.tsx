import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, CheckCheck, Lock, Printer } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/app/auth";
import { useOrg } from "@/app/org";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge, Card, CardHeader, ErrorNotice, Money, PageHeader, Skeleton } from "@/components/ui/misc";
import { fmtDateTime } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { rpc, supabase, unwrap } from "@/lib/supabase";
import type { Shift, ShiftReport } from "@/lib/types";
import { cn, uuid } from "@/lib/utils";
import { useCart } from "../pos/cartStore";
import { shiftTone } from "./ShiftsPage";

// Maldivian Rufiyaa notes and coins (laari as fractions)
export const MVR_DENOMINATIONS = ["1000", "500", "100", "50", "20", "10", "5", "2", "1", "0.5", "0.25", "0.1", "0.05", "0.01"];

function countTotal(c: Record<string, string>) {
  return MVR_DENOMINATIONS.reduce((s, d) => s + Number(d) * (Number(c[d]) || 0), 0);
}

function CashMoveDialog({ shiftId, open, onOpenChange }: { shiftId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = React.useState<"cash_in" | "cash_out">("cash_out");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [key, setKey] = React.useState(uuid());
  React.useEffect(() => { if (open) { setAmount(""); setReason(""); setKey(uuid()); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Cash in or out" description="For money added to or taken from the drawer that isn't a sale, e.g. a change top-up or paying a delivery.">
        <div className="mb-3 flex rounded-md border border-line-strong p-0.5">
          {(["cash_out", "cash_in"] as const).map((k) => <button key={k} onClick={() => setKind(k)} className={cn("flex-1 rounded py-1.5 text-sm", kind === k ? "bg-reef text-white" : "text-muted")}>{k === "cash_in" ? "Cash in" : "Cash out"}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
          <Field label="Amount (MVR)" htmlFor="cm-amt"><Input id="cm-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
          <Field label="Reason" htmlFor="cm-reason"><Input id="cm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "cash_out" ? "e.g. Paid ice delivery" : "e.g. Change from safe"} /></Field>
        </div>
        <DialogFooter>
          <Button disabled={!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || reason.trim().length < 3} loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await rpc("add_cash_movement", { p_shift: shiftId, p_kind: kind, p_amount: amount, p_reason: reason, p_client_uuid: key });
              toast.success(kind === "cash_in" ? "Cash in recorded" : "Cash out recorded");
              qc.invalidateQueries({ queryKey: ["shift"] });
              onOpenChange(false);
            } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}>Record {kind === "cash_in" ? "cash in" : "cash out"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportBlock({ r, title }: { r: ShiftReport; title: string }) {
  const line = (l: string, v: number, strong = false) => (
    <div className={cn("flex justify-between py-1", strong && "font-semibold")}><span>{l}</span><span className="tabular">{formatAmount(v)}</span></div>
  );
  return (
    <div className="print-area text-sm">
      <div className="hidden print:block"><h2 className="text-lg font-bold">{title}</h2></div>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-1 font-display text-sm font-semibold">Cash drawer</h3>
          <div className="divide-y divide-line">
            {line("Opening float", r.opening_float)}
            {line("Cash sales and collections", r.cash_payments_in)}
            {line("Cash refunds paid out", -r.cash_payments_out)}
            {line("Cash in", r.cash_in)}
            {line("Cash out", -r.cash_out)}
            {line("Expected in drawer", r.expected_cash, true)}
            {r.counted_cash !== undefined && r.counted_cash !== null && line("Counted", Number(r.counted_cash), true)}
            {r.variance !== undefined && r.variance !== null && (
              <div className={cn("flex justify-between py-1 font-semibold", Number(r.variance) < 0 ? "text-coral" : Number(r.variance) > 0 ? "text-[#a5680d]" : "text-ok")}>
                <span>{Number(r.variance) === 0 ? "Balanced" : Number(r.variance) < 0 ? "Short" : "Over"}</span><span className="tabular">{formatAmount(r.variance)}</span></div>
            )}
          </div>
        </div>
        <div>
          <h3 className="mb-1 font-display text-sm font-semibold">Takings by payment type</h3>
          <div className="divide-y divide-line">
            {r.payment_methods.map((m) => (
              <div key={m.method} className="flex justify-between py-1">
                <span>{m.method}{m.pending > 0 && <span className="ms-1 text-xs text-[#a5680d]">({formatAmount(m.pending)} pending)</span>}</span>
                <span className="tabular">{formatAmount(m.in - m.out)}</span>
              </div>
            ))}
            {r.payment_methods.length === 0 && <div className="py-1 text-muted">No payments yet</div>}
          </div>
          <h3 className="mb-1 mt-4 font-display text-sm font-semibold">Sales</h3>
          <div className="divide-y divide-line">
            <div className="flex justify-between py-1"><span>Sales</span><span className="tabular">{r.sales.count} · {formatAmount(r.sales.total)}</span></div>
            <div className="flex justify-between py-1"><span>Tax collected</span><span className="tabular">{formatAmount(r.sales.tax)}</span></div>
            <div className="flex justify-between py-1"><span>Discounts given</span><span className="tabular">{formatAmount(r.sales.discounts)}</span></div>
            <div className="flex justify-between py-1"><span>Charged to accounts</span><span className="tabular">{formatAmount(r.sales.on_account)}</span></div>
            <div className="flex justify-between py-1"><span>Refunds</span><span className="tabular">{r.refunds.count} · {formatAmount(r.refunds.total)}</span></div>
            <div className="flex justify-between py-1"><span>Voided sales</span><span className="tabular">{r.sales.voided_count}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ShiftDetailPage() {
  const { id } = useParams();
  const { can, registers, outlets } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [approve, setApprove] = React.useState(false);
  const [counts, setCounts] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const shift = useQuery({ queryKey: ["shift", id], queryFn: async () => unwrap(await supabase.from("shifts").select("*").eq("id", id!).single()) as Shift & { close_note: string | null; approval_note: string | null } });
  const report = useQuery({ queryKey: ["shift", id, "report"], refetchInterval: shift.data?.status === "open" ? 30_000 : false, queryFn: () => rpc<ShiftReport>("shift_report", { p_shift: id }) });
  const moves = useQuery({ queryKey: ["shift", id, "moves"], queryFn: async () => unwrap(await supabase.from("cash_movements").select("*").eq("shift_id", id!).order("created_at")) as { id: string; kind: string; amount: number; reason: string; created_at: string }[] });

  if (shift.isLoading || report.isLoading) return <Skeleton className="h-96" />;
  if (shift.error || report.error) return <ErrorNotice error={shift.error ?? report.error} />;
  const s = shift.data!;
  const r = report.data!;
  const reg = registers.find((x) => x.id === s.register_id);
  const outlet = outlets.find((o) => o.id === s.outlet_id);
  const counted = countTotal(counts);
  const canClose = s.status === "open" && can("shifts.manage") && (s.opened_by === user?.id || can("shifts.approve"));

  return (
    <>
      <Link to="/shifts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Registers & shifts</Link>
      <PageHeader title={`${reg?.name ?? "Register"} shift`} description={`${outlet?.name ?? ""} · opened ${fmtDateTime(s.opened_at)}${s.closed_at ? ` · closed ${fmtDateTime(s.closed_at)}` : ""}`}
        actions={
          <>
            <Badge tone={shiftTone[s.status]} className="capitalize">{s.status === "closed" ? "Closed, to review" : s.status}</Badge>
            <Button variant="secondary" size="sm" onClick={() => window.print()}><Printer /> Print {s.status === "open" ? "X" : "Z"} report</Button>
            {s.status === "open" && can("cash.movements") && <Button variant="secondary" size="sm" onClick={() => setMoveOpen(true)}><ArrowDownToLine /> Cash in / out</Button>}
            {canClose && <Button size="sm" onClick={() => { setCounts({}); setNote(""); setClosing(true); }}><Lock /> Close shift</Button>}
            {s.status === "closed" && can("shifts.approve") && <Button size="sm" onClick={() => setApprove(true)}><CheckCheck /> Approve</Button>}
          </>
        } />
      <Card>
        <CardHeader title={s.status === "open" ? "X report (so far)" : "Z report"} description={s.status === "open" ? "Live totals. Updates every 30 seconds." : "Frozen at close. Can't be edited."} />
        <div className="p-4"><ReportBlock r={r} title={`${s.status === "open" ? "X" : "Z"} report — ${reg?.name} — ${fmtDateTime(s.opened_at)}`} /></div>
        {(s.close_note || s.approval_note) && <div className="border-t border-line px-4 py-3 text-sm text-muted">{s.close_note && <div>Close note: {s.close_note}</div>}{s.approval_note && <div>Approval: {s.approval_note}</div>}</div>}
      </Card>
      {r.denominations && (
        <Card className="mt-4">
          <CardHeader title="Cash count" />
          <div className="grid grid-cols-3 gap-x-6 gap-y-1 p-4 text-sm sm:grid-cols-5">
            {MVR_DENOMINATIONS.filter((d) => r.denominations?.[d]).map((d) => <div key={d} className="flex justify-between"><span className="text-muted">{Number(d) >= 1 ? `MVR ${d}` : `${Math.round(Number(d) * 100)} laari`}</span><span className="tabular">× {r.denominations![d]}</span></div>)}
          </div>
        </Card>
      )}
      <Card className="mt-4">
        <CardHeader title="Cash in and out" />
        <ul className="divide-y divide-line">
          {moves.data?.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {m.kind === "cash_in" ? <ArrowDownToLine className="size-4 text-ok" /> : <ArrowUpFromLine className="size-4 text-coral" />}
              <span className="flex-1">{m.reason}<span className="block text-xs text-muted">{fmtDateTime(m.created_at)}</span></span>
              <Money value={m.kind === "cash_in" ? m.amount : -m.amount} className="font-medium" />
            </li>
          ))}
          {moves.data?.length === 0 && <li className="px-4 py-4 text-sm text-muted">None recorded.</li>}
        </ul>
      </Card>

      <CashMoveDialog shiftId={s.id} open={moveOpen} onOpenChange={setMoveOpen} />
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent title="Count the drawer and close" wide description="Count each note and coin. The expected amount is shown after you finish, so the count isn't influenced by it.">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {MVR_DENOMINATIONS.map((d) => (
              <label key={d} className="flex items-center justify-between gap-2 text-sm">
                <span className="w-20 text-muted">{Number(d) >= 1 ? `MVR ${d}` : `${Math.round(Number(d) * 100)} laari`}</span>
                <Input aria-label={`Count of ${d}`} inputMode="numeric" value={counts[d] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, "") }))} className="h-8 w-20 text-end" />
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-md bg-reef px-4 py-3 text-white">
            <span className="text-sm text-reef-text">Counted</span>
            <span className="font-display text-2xl font-semibold tabular">{formatMoney(counted)}</span>
          </div>
          <Field label="Note (optional)" htmlFor="close-note" className="mt-3"><Textarea id="close-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-14" /></Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setClosing(false)}>Keep shift open</Button>
            <Button loading={busy} onClick={async () => {
              setBusy(true);
              try {
                const res = await rpc<ShiftReport>("close_shift", { p_shift: s.id, p_denominations: Object.fromEntries(Object.entries(counts).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])), p_note: note || null });
                useCart.getState().rememberShift(s.register_id, null);
                const v = Number(res.variance);
                toast[v === 0 ? "success" : "warning"](v === 0 ? "Shift closed. The drawer balances." : `Shift closed. Drawer is ${v < 0 ? "short" : "over"} by ${formatMoney(Math.abs(v))}.`);
                qc.invalidateQueries({ queryKey: ["shift"] });
                qc.invalidateQueries({ queryKey: ["open-shift"] });
                qc.invalidateQueries({ queryKey: ["open-shifts"] });
                setClosing(false);
              } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
            }}>Close shift</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={approve} onOpenChange={setApprove} title="Approve this shift?" confirmLabel="Approve shift" requireReason={Number(r.variance ?? 0) !== 0}
        description={Number(r.variance ?? 0) !== 0 ? `The drawer was ${Number(r.variance) < 0 ? "short" : "over"} by ${formatMoney(Math.abs(Number(r.variance)))}. Explain the variance.` : "The drawer balanced."}
        onConfirm={async (reason) => {
          try { await rpc("approve_shift", { p_shift: s.id, p_note: reason || "Balanced" }); qc.invalidateQueries({ queryKey: ["shift"] }); }
          catch (e) { toast.error((e as Error).message); throw e; }
        }} />
      {s.status === "open" && reg && <div className="mt-4"><Button variant="link" onClick={() => navigate("/pos")}>Back to the register</Button></div>}
    </>
  );
}
