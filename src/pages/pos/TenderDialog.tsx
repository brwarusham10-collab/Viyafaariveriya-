import { Banknote, CircleAlert, CreditCard, Landmark, Plus, UserRound, Wallet, X } from "lucide-react";
import * as React from "react";
import { useAuth } from "@/app/auth";
import { useOrg } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge, Kbd } from "@/components/ui/misc";
import { centsToString, formatMoney, toCents, type Cents } from "@/lib/money";
import { evaluateTenders } from "@/lib/pricing";
import { loadReceipt, type ReceiptData } from "@/lib/receipt";
import { AppError, rpc } from "@/lib/supabase";
import type { PaymentMethod } from "@/lib/types";
import { cn } from "@/lib/utils";
import { offlineDb } from "@/offline/db";
import type { CartCustomer } from "./cartStore";

export interface Tender {
  methodId: string;
  kind: PaymentMethod["kind"];
  name: string;
  amount: string;
  reference: string;
}

const icons = { cash: Banknote, card: CreditCard, bank_transfer: Landmark, store_credit: Wallet, on_account: UserRound, other: Wallet };

const NOTES = [10, 20, 50, 100, 500, 1000];

function quickCash(remaining: Cents): string[] {
  const r = Number(centsToString(remaining));
  if (r <= 0) return [];
  const out = new Set<string>([r.toFixed(2)]);
  for (const n of NOTES) {
    const up = Math.ceil(r / n) * n;
    if (up > r) out.add(up.toFixed(2));
    if (out.size >= 5) break;
  }
  return [...out];
}

export interface CheckoutOutcome {
  receipt: ReceiptData;
  change: string;
  offline: boolean;
}

export function TenderDialog({
  open,
  onOpenChange,
  total,
  customer,
  buildPayload,
  offline,
  canQueueOffline,
  provisionalReceipt,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  total: Cents;
  customer: CartCustomer | null;
  buildPayload: (payments: { payment_method_id: string; amount: string; reference?: string }[]) => Record<string, unknown>;
  offline: boolean;
  canQueueOffline: boolean;
  provisionalReceipt: (tenders: Tender[]) => ReceiptData;
  onComplete: (o: CheckoutOutcome) => void;
}) {
  const { paymentMethods, can, membership } = useOrg();
  const { user } = useAuth();
  const [tenders, setTenders] = React.useState<Tender[]>([]);
  const [methodId, setMethodId] = React.useState<string>("");
  const [amount, setAmount] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [networkFailed, setNetworkFailed] = React.useState(false);
  const amountRef = React.useRef<HTMLInputElement>(null);

  const methods = paymentMethods.filter((m) => m.is_active && (!offline || m.allowed_offline));
  const method = methods.find((m) => m.id === methodId) ?? methods[0];

  const evalResult = evaluateTenders(total, tenders.map((t) => ({ kind: t.kind, amount: t.amount })));
  const remaining = evalResult.remaining;

  React.useEffect(() => {
    if (open) {
      setTenders([]);
      setError(null);
      setNetworkFailed(false);
      const cash = methods.find((m) => m.kind === "cash");
      setMethodId((cash ?? methods[0])?.id ?? "");
      setAmount(centsToString(total));
      setReference("");
      setTimeout(() => amountRef.current?.select(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (open) setAmount(remaining > 0n ? centsToString(remaining) : "");
  }, [remaining, open]);

  const blocked = (m: PaymentMethod): string | null => {
    if ((m.kind === "store_credit" || m.kind === "on_account") && !customer) return "Attach a customer first";
    if (m.kind === "on_account" && !can("pos.credit_sale")) return "Your role can't sell on credit";
    if (m.kind === "store_credit" && customer && customer.store_credit <= 0) return "No store credit";
    return null;
  };

  function addTender(amt = amount) {
    if (!method) return;
    const reason = blocked(method);
    if (reason) return setError(reason);
    const cents = (() => {
      try {
        return toCents(amt);
      } catch {
        return -1n;
      }
    })();
    if (cents <= 0n) return setError("Enter an amount greater than zero.");
    if (method.kind !== "cash" && cents > remaining) return setError("Only cash can be more than the amount due.");
    if (method.requires_reference && !reference.trim()) return setError("Enter the transfer reference.");
    if (method.kind === "store_credit" && customer && cents > toCents(customer.store_credit)) return setError(`Only ${formatMoney(customer.store_credit)} store credit available.`);
    if (method.kind === "on_account" && customer && toCents(customer.account_balance) + cents > toCents(customer.credit_limit))
      return setError(`That exceeds the ${formatMoney(customer.credit_limit)} credit limit.`);
    setError(null);
    setTenders((t) => [...t, { methodId: method.id, kind: method.kind, name: method.name, amount: centsToString(cents), reference: reference.trim() }]);
    setReference("");
  }

  async function complete() {
    setBusy(true);
    setError(null);
    const payments = tenders.map((t) => ({ payment_method_id: t.methodId, amount: t.amount, ...(t.reference ? { reference: t.reference } : {}) }));
    const payload = buildPayload(payments);
    const change = centsToString(evalResult.change);

    const queue = async () => {
      await offlineDb.queue.put({
        id: payload.client_uuid as string,
        orgId: membership!.organization_id,
        outletId: payload.outlet_id as string,
        registerId: payload.register_id as string,
        userId: user!.id,
        payload: { ...payload, offline: { created_at: new Date().toISOString() } },
        status: "pending",
        total: centsToString(total),
        itemCount: (payload.items as unknown[]).length,
        createdAt: new Date().toISOString(),
        attempts: 0,
      });
      onComplete({ receipt: provisionalReceipt(tenders), change, offline: true });
    };

    try {
      if (offline) {
        await queue();
        return;
      }
      const res = await rpc<{ sale_id: string; change_given: number }>("pos_checkout", { payload });
      const receipt = await loadReceipt(res.sale_id);
      onComplete({ receipt, change: Number(res.change_given).toFixed(2), offline: false });
    } catch (e) {
      const msg = (e as Error).message;
      if (/Can't reach the server|Failed to fetch|NetworkError|network/i.test(msg) || !navigator.onLine) {
        setNetworkFailed(true);
        setError("The connection dropped before the server confirmed this sale. Retrying is safe — it can't be charged twice.");
      } else {
        setError(e instanceof AppError ? e.message : msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const ready = evalResult.complete && !evalResult.overpaidNonCash && (tenders.length > 0 || total === 0n);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title="Take payment" wide className="max-w-3xl"
        description={offline ? "Offline: only cash and card can be accepted. The sale syncs when the connection returns." : undefined}>
        <div className="grid gap-5 md:grid-cols-[1fr_280px]">
          <div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {methods.map((m) => {
                const Icon = icons[m.kind] ?? Wallet;
                const reason = blocked(m);
                return (
                  <button key={m.id} onClick={() => { setMethodId(m.id); setError(null); amountRef.current?.focus(); }}
                    disabled={!!reason} title={reason ?? undefined}
                    className={cn("flex h-16 flex-col items-start justify-center gap-1 rounded-md border px-3 text-start transition-colors",
                      method?.id === m.id ? "border-lagoon bg-lagoon-soft text-lagoon-strong" : "border-line-strong hover:bg-fg/[0.03]",
                      reason && "opacity-45")}>
                    <Icon className="size-4" />
                    <span className="text-sm font-medium leading-tight">{m.name}</span>
                  </button>
                );
              })}
            </div>

            <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); addTender(); }}>
              <div className="relative flex-1">
                <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-subtle">MVR</span>
                <Input ref={amountRef} aria-label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
                  className="h-12 ps-12 text-xl font-semibold tabular" />
              </div>
              <Button type="submit" size="lg" variant="secondary" className="h-12" disabled={remaining === 0n && method?.kind !== "cash"}>
                <Plus /> Add
              </Button>
            </form>
            {method?.requires_reference && (
              <Input className="mt-2" placeholder="Transfer reference (from the customer's bank app)" value={reference}
                onChange={(e) => setReference(e.target.value)} aria-label="Payment reference" />
            )}
            {method?.kind === "cash" && remaining > 0n && (
              <div className="mt-2 flex flex-wrap gap-2">
                {quickCash(remaining).map((v, i) => (
                  <Button key={v} variant="secondary" size="sm" onClick={() => addTender(v)}>
                    {i === 0 ? "Exact" : formatMoney(v).replace(".00", "")}
                  </Button>
                ))}
              </div>
            )}
            {method?.kind === "bank_transfer" && method.requires_verification && (
              <p className="mt-2 text-xs text-muted">Transfers stay “pending” until someone with payment-verification access matches them on the statement.</p>
            )}
            {error && (
              <div className="mt-3 flex gap-2 rounded-md bg-coral-soft px-3 py-2 text-sm text-coral" role="alert">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            )}
          </div>

          <div className="flex flex-col rounded-lg bg-reef p-4 text-white">
            <div className="text-xs text-reef-text">Amount due</div>
            <div className="font-display text-[34px] font-semibold leading-tight tabular">{formatMoney(centsToString(total))}</div>
            <ul className="mt-3 flex-1 space-y-1.5 text-sm">
              {tenders.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {t.name}
                    {t.reference && <span className="text-reef-text"> · {t.reference}</span>}
                  </span>
                  <span className="flex items-center gap-1 tabular">
                    {formatMoney(t.amount)}
                    <button className="rounded p-0.5 text-reef-text hover:bg-white/10" aria-label={`Remove ${t.name}`} onClick={() => setTenders((ts) => ts.filter((_, j) => j !== i))}>
                      <X className="size-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 space-y-1 border-t border-white/15 pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-reef-text">Still due</span>
                <span className="tabular">{formatMoney(centsToString(remaining))}</span>
              </div>
              <div className="flex justify-between text-base font-semibold text-saffron">
                <span>Change</span>
                <span className="tabular">{formatMoney(centsToString(evalResult.change))}</span>
              </div>
            </div>
            <Button size="xl" className="mt-4 w-full bg-saffron text-reef hover:bg-saffron hover:brightness-105" disabled={!ready} loading={busy} onClick={complete}>
              {networkFailed ? "Retry sale" : offline ? "Save offline sale" : "Complete sale"}
            </Button>
            {networkFailed && canQueueOffline && methods.length > 0 && tenders.every((t) => paymentMethods.find((m) => m.id === t.methodId)?.allowed_offline) && (
              <Button variant="ghost" className="mt-2 text-white hover:bg-white/10" onClick={async () => {
                const payments = tenders.map((t) => ({ payment_method_id: t.methodId, amount: t.amount, ...(t.reference ? { reference: t.reference } : {}) }));
                const payload = buildPayload(payments);
                await offlineDb.queue.put({
                  id: payload.client_uuid as string, orgId: membership!.organization_id, outletId: payload.outlet_id as string,
                  registerId: payload.register_id as string, userId: user!.id,
                  payload: { ...payload, offline: { created_at: new Date().toISOString() } }, status: "pending",
                  total: centsToString(total), itemCount: (payload.items as unknown[]).length, createdAt: new Date().toISOString(), attempts: 0,
                });
                onComplete({ receipt: provisionalReceipt(tenders), change: centsToString(evalResult.change), offline: true });
              }}>
                Keep as offline sale and sync later
              </Button>
            )}
            {offline && <Badge tone="saffron" className="mt-2 self-start">Provisional until synced</Badge>}
            <div className="mt-3 text-[11px] text-reef-text">
              <Kbd>Enter</Kbd> adds the amount
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
