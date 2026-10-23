import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CloudOff, FileText, Minus, MoreHorizontal, PauseCircle, Percent, Plus, ScanBarcode, Search, Star, StickyNote, Trash2, UserRound,
  Vault, WifiOff, X,
} from "lucide-react";
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/app/auth";
import { useOrg, useOrgId } from "@/app/org";
import { ReceiptActions, ReceiptDocument, type ReceiptFormat } from "@/components/receipt/Receipt";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge, EmptyState, Kbd, Skeleton } from "@/components/ui/misc";
import { fmtDateTime } from "@/lib/dates";
import { centsToString, formatAmount, formatMoney, formatQty } from "@/lib/money";
import type { ReceiptData } from "@/lib/receipt";
import { rpc, supabase, unwrap } from "@/lib/supabase";
import type { CatalogItem, Category } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isOfflineDevice, setOfflineDevice } from "@/offline/db";
import { useOnline, useSyncSummary } from "@/offline/hooks";
import { syncQueue } from "@/offline/sync";
import { priceLines, toPayloadItems, useCart, type CartLine } from "./cartStore";
import { CustomerPicker } from "./CustomerPicker";
import { HeldBills, parkCart } from "./HeldBills";
import { LineEditor } from "./LineEditor";
import { GateSpinner, ShiftGate, useRegisterShift } from "./ShiftGate";
import { SyncPanel } from "./SyncPanel";
import { TenderDialog, type CheckoutOutcome, type Tender } from "./TenderDialog";
import { useCatalog } from "./useCatalog";

/** Keyboard-wedge scanners type fast and finish with Enter; capture that even when no input has focus. */
function useScannerCapture(onScan: (code: string) => void, enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;
    let buf = "";
    let last = 0;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (document.querySelector("[role=dialog]")) return;
      const now = performance.now();
      if (now - last > 60) buf = "";
      last = now;
      if (e.key === "Enter") {
        if (buf.length >= 4) {
          e.preventDefault();
          onScan(buf);
        }
        buf = "";
      } else if (e.key.length === 1) {
        buf += e.key;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onScan, enabled]);
}

function ProductCard({ item, onAdd, group }: { item: CatalogItem; onAdd: () => void; group?: number }) {
  const out = item.track_stock && (item.stock ?? 0) <= 0;
  const low = item.track_stock && !out && (item.stock ?? 0) <= 5;
  return (
    <button onClick={onAdd}
      className="group flex min-h-[92px] flex-col justify-between rounded-lg border border-line bg-surface p-3 text-start transition-[border-color,transform] hover:border-lagoon/60 active:scale-[0.98]">
      <span className="line-clamp-2 text-[13.5px] font-medium leading-snug">{item.product_name}</span>
      <span className="mt-2 flex items-end justify-between gap-2">
        <span className="font-display text-[15px] font-semibold tabular">{formatAmount(item.price)}</span>
        <span className="text-[11px] text-muted">
          {group && group > 1 ? `${group} options` : out ? <span className="text-coral">Out</span> : item.track_stock ? (
            <span className={cn(low && "text-[#a5680d] dark:text-saffron")}>{formatQty(item.stock)}{item.unit ? ` ${item.unit}` : ""} left</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function CartLineRow({ line, priced, onEdit, onBump }: {
  line: CartLine;
  priced?: { lineTotal: bigint; lineDiscount: bigint; cartDiscountAlloc: bigint };
  onEdit: () => void;
  onBump: (d: number) => void;
}) {
  const discounted = priced && priced.lineDiscount + priced.cartDiscountAlloc > 0n;
  return (
    <li className="flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-0">
      <button className="min-w-0 flex-1 text-start" onClick={onEdit}>
        <div className="truncate text-[13.5px] font-medium">{line.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span className="tabular">@ {formatAmount(line.unitPrice)}</span>
          {line.unitPrice !== line.listPrice && <Badge tone="saffron">Price changed</Badge>}
          {discounted && <span className="text-ok">− {formatAmount(centsToString(priced.lineDiscount + priced.cartDiscountAlloc))}</span>}
        </div>
      </button>
      <div className="flex items-center rounded-md border border-line-strong">
        <button className="grid size-9 place-items-center text-muted hover:text-fg" aria-label={`Decrease ${line.name}`} onClick={() => onBump(-1)}>
          <Minus className="size-4" />
        </button>
        <button className="min-w-9 px-1 text-center text-sm font-semibold tabular" onClick={onEdit} aria-label="Edit quantity">
          {formatQty(line.qty)}
        </button>
        <button className="grid size-9 place-items-center text-muted hover:text-fg" aria-label={`Increase ${line.name}`} onClick={() => onBump(1)}>
          <Plus className="size-4" />
        </button>
      </div>
      <div className="w-20 text-end text-[13.5px] font-semibold tabular">{priced ? formatAmount(centsToString(priced.lineTotal)) : "—"}</div>
    </li>
  );
}

export default function PosPage() {
  const orgId = useOrgId();
  const { org, outlet, can, registers: _r } = useOrg();
  void _r;
  const { user } = useAuth();
  const online = useOnline();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { register, outletRegisters, shift, loading: shiftLoading, refetch: refetchShift } = useRegisterShift();
  const catalog = useCatalog(orgId, outlet?.id);
  const cart = useCart();
  const sync = useSyncSummary();

  const [term, setTerm] = React.useState("");
  const [category, setCategory] = React.useState<string>("all");
  const [editing, setEditing] = React.useState<CartLine | null>(null);
  const [variantPick, setVariantPick] = React.useState<CatalogItem[] | null>(null);
  const [weightPick, setWeightPick] = React.useState<CatalogItem | null>(null);
  const [tenderOpen, setTenderOpen] = React.useState(false);
  const [customerOpen, setCustomerOpen] = React.useState(false);
  const [heldOpen, setHeldOpen] = React.useState(false);
  const [discountOpen, setDiscountOpen] = React.useState(false);
  const [notesOpen, setNotesOpen] = React.useState(false);
  const [clearOpen, setClearOpen] = React.useState(false);
  const [mobileCart, setMobileCart] = React.useState(false); // phones: cart opens as a full-screen sheet
  const [done, setDone] = React.useState<CheckoutOutcome | null>(null);
  const [receiptFormat, setReceiptFormat] = React.useState<ReceiptFormat>((register?.receipt_width as ReceiptFormat) ?? "80mm");
  const syncOpen = params.get("sync") === "1";
  const searchRef = React.useRef<HTMLInputElement>(null);

  const offlineDevice = useQuery({
    queryKey: ["offline-device", orgId, user?.id],
    enabled: !!user,
    queryFn: () => isOfflineDevice(orgId, user!.id),
  });

  const categories = useQuery({
    queryKey: ["categories", orgId],
    enabled: online,
    queryFn: async () => unwrap(await supabase.from("categories").select("id, name, color, sort_order").eq("organization_id", orgId).order("sort_order").order("name")) as Category[],
  });

  // Sync offline sales automatically when the connection returns.
  React.useEffect(() => {
    if (online && sync.pending > 0) {
      syncQueue(orgId).then((r) => {
        if (r.synced) qc.invalidateQueries({ queryKey: ["pos-catalog"] });
      });
    }
  }, [online, sync.pending, orgId, qc]);

  const inclusive = org?.prices_include_tax ?? true;
  const priced = React.useMemo(() => priceLines(cart.lines, cart.cartDiscount, inclusive), [cart.lines, cart.cartDiscount, inclusive]);
  const pricedByKey = React.useMemo(() => new Map(priced?.lines.map((l) => [l.key, l]) ?? []), [priced]);
  const total = priced?.total ?? 0n;

  const grouped = React.useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const it of catalog.items) map.set(it.product_id, [...(map.get(it.product_id) ?? []), it]);
    return map;
  }, [catalog.items]);

  const visible = React.useMemo(() => {
    const q = term.trim().toLowerCase();
    const seen = new Set<string>();
    const out: CatalogItem[] = [];
    for (const it of catalog.items) {
      if (category === "fav" && !it.is_favorite) continue;
      if (category !== "all" && category !== "fav" && it.category_id !== category) continue;
      if (q && !(`${it.product_name} ${it.variant_name} ${it.sku ?? ""} ${it.barcodes.join(" ")}`.toLowerCase().includes(q))) continue;
      if (!q && seen.has(it.product_id)) continue; // one card per product when browsing
      seen.add(it.product_id);
      out.push(it);
      if (out.length >= 120) break;
    }
    return out;
  }, [catalog.items, term, category]);

  const allowNegative = org?.allow_negative_stock ?? false;
  const addItem = React.useCallback((item: CatalogItem, qty = "1") => {
    if (item.track_stock && !allowNegative) {
      const inCart = useCart.getState().lines.filter((l) => l.variantId === item.variant_id).reduce((s, l) => s + Number(l.qty), 0);
      if (inCart + Number(qty) > Number(item.stock ?? 0)) {
        toast.error(`Only ${formatQty(item.stock ?? 0)} ${item.product_name} in stock${catalog.source === "cache" ? " (as of the last sync)" : ""}.`);
        return;
      }
    }
    useCart.getState().add(item, qty);
  }, [allowNegative, catalog.source]);

  const choose = React.useCallback((item: CatalogItem, fromSearch = false) => {
    const group = grouped.get(item.product_id) ?? [item];
    if (!fromSearch && group.length > 1) return setVariantPick(group);
    if (item.sold_by_weight) return setWeightPick(item);
    addItem(item);
  }, [grouped, addItem]);

  const scan = React.useCallback((code: string) => {
    const hit = catalog.index.get(code.trim().toLowerCase());
    if (hit) {
      if (hit.sold_by_weight) setWeightPick(hit);
      else addItem(hit);
      setTerm("");
    } else {
      toast.error(`No product with barcode or SKU “${code}”.`);
    }
  }, [catalog.index, addItem]);

  const ready = !!register && !!shift;
  useScannerCapture(scan, ready && !tenderOpen && !done);

  // Shortcuts
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ready || done) return;
      if (e.key === "F2" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        if (useCart.getState().lines.length) setTenderOpen(true);
      } else if (e.key === "F1" || (e.key === "/" && !(e.target as HTMLElement).closest("input,textarea"))) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        setCustomerOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, done]);

  if (!register || shiftLoading) {
    if (shiftLoading) return <GateSpinner />;
  }
  if (!ready) {
    return <ShiftGate registers={outletRegisters} register={register} onOpened={() => refetchShift()} />;
  }

  const buildPayload = (payments: { payment_method_id: string; amount: string; reference?: string }[]) => ({
    client_uuid: cart.checkoutId,
    register_id: register.id,
    shift_id: shift.id,
    outlet_id: outlet?.id,
    ...(cart.customer ? { customer_id: cart.customer.id } : {}),
    ...(cart.quotationId ? { quotation_id: cart.quotationId } : {}),
    ...(cart.notes ? { notes: cart.notes } : {}),
    ...(cart.cartDiscount && Number(cart.cartDiscount.value) > 0 ? { cart_discount: cart.cartDiscount } : {}),
    items: toPayloadItems(cart.lines),
    payments,
  });

  const provisionalReceipt = (tenders: Tender[]): ReceiptData => ({
    provisional: true,
    org: org!,
    outlet: outlet,
    register,
    cashier: user?.email ?? null,
    customer: null,
    sale: {
      invoice_number: "PENDING", sold_at: new Date().toISOString(), subtotal: centsToString(priced!.subtotal),
      discount_total: centsToString(priced!.discountTotal), tax_total: centsToString(priced!.taxTotal), total: centsToString(priced!.total),
      change_given: "0", prices_include_tax: inclusive, status: "completed", payment_status: "paid", balance_due: 0, notes: cart.notes || null,
    },
    items: cart.lines.map((l) => {
      const p = pricedByKey.get(l.key)!;
      return { name: l.name, sku: l.sku, qty: l.qty, unit_price: l.unitPrice, line_discount: centsToString(p.lineDiscount),
        cart_discount_alloc: centsToString(p.cartDiscountAlloc), tax_rate: l.taxRate, tax_amount: centsToString(p.tax), line_total: centsToString(p.lineTotal) };
    }),
    payments: tenders.map((t) => ({ method_name: t.name, amount: t.amount, tendered: null, reference: t.reference || null, status: "completed", direction: "in" })),
  });

  const offlineBanner = !online || catalog.source === "cache";

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Catalogue */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {offlineBanner && (
          <div className="flex items-center gap-2 border-b border-saffron/40 bg-saffron-soft px-4 py-2 text-[13px] text-[#7a4f0f] dark:text-saffron">
            <WifiOff className="size-4" />
            {catalog.source === "none"
              ? "Offline with no saved catalogue. Turn on offline selling for this device while connected."
              : `Offline. Prices and stock are from ${fmtDateTime(catalog.generatedAt)} and may have changed. Only cash and card can be taken.`}
          </div>
        )}
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3">
          <form className="relative flex-1" onSubmit={(e) => {
            e.preventDefault();
            const exact = catalog.index.get(term.trim().toLowerCase());
            if (exact) return scan(term);
            if (visible.length === 1) {
              choose(visible[0], true);
              setTerm("");
            }
          }}>
            <ScanBarcode className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-subtle" />
            <Input ref={searchRef} value={term} onChange={(e) => setTerm(e.target.value)} autoFocus
              placeholder="Scan a barcode or search products" aria-label="Scan or search" className="h-11 ps-10 text-[15px]" />
            {term && (
              <button type="button" className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-subtle hover:text-fg" onClick={() => setTerm("")} aria-label="Clear search">
                <X className="size-4" />
              </button>
            )}
          </form>
          <div className="hidden items-center gap-1 text-xs text-muted xl:flex">
            <Kbd>F1</Kbd> search <Kbd>F2</Kbd> charge <Kbd>F4</Kbd> customer
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto border-b border-line bg-surface px-4 py-2">
          {[{ id: "all", name: "All" }, { id: "fav", name: "Favourites" }, ...(categories.data ?? [])].map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)}
              className={cn("flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[13px]",
                category === c.id ? "border-reef bg-reef text-white" : "border-line-strong text-muted hover:text-fg")}>
              {c.id === "fav" && <Star className="size-3.5" />}
              {c.name}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {catalog.isLoading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
              {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState icon={Search} title={term ? `Nothing matches “${term}”` : "No products yet"}>
              {term ? "Try a shorter name, the SKU, or scan the barcode." : can("products.manage") ? "Add products to start selling." : "Ask a manager to add products."}
            </EmptyState>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
              {visible.map((it) => (
                <ProductCard key={it.variant_id} item={it} group={term ? undefined : grouped.get(it.product_id)?.length} onAdd={() => choose(it, !!term)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Cart */}
      {cart.lines.length > 0 && !mobileCart && (
        <button className="flex items-center justify-between gap-3 bg-reef px-4 py-3 text-white lg:hidden" onClick={() => setMobileCart(true)}>
          <span className="text-sm text-reef-text">{formatQty(cart.lines.reduce((s, l) => s + Number(l.qty), 0))} items · View sale</span>
          <span className="font-display text-xl font-semibold tabular">MVR {formatAmount(centsToString(total))}</span>
        </button>
      )}
      <aside className={cn("w-full shrink-0 flex-col border-line bg-surface lg:static lg:flex lg:h-full lg:w-[400px] lg:border-s xl:w-[430px]",
        mobileCart ? "fixed inset-0 z-30 flex" : "hidden")}>
        <button className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm text-lagoon lg:hidden" onClick={() => setMobileCart(false)}>
          <X className="size-4" /> Back to products
        </button>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <button onClick={() => (online ? setCustomerOpen(true) : toast.error("Customers need a connection."))}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-fg/[0.04]">
            <UserRound className="size-4 shrink-0 text-subtle" />
            {cart.customer ? (
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{cart.customer.name}</span>
                <span className="block truncate text-xs text-muted">
                  {cart.customer.price_list === "wholesale" ? "Wholesale prices · " : ""}
                  {cart.customer.store_credit > 0 ? `Credit ${formatMoney(cart.customer.store_credit)}` : cart.customer.phone ?? ""}
                </span>
              </span>
            ) : (
              <span className="text-sm text-muted">Add customer</span>
            )}
          </button>
          {cart.customer && (
            <Button variant="ghost" size="icon-sm" aria-label="Remove customer" onClick={() => cart.setCustomer(null)}>
              <X />
            </Button>
          )}
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Sale actions">
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent align="end">
              <DropdownItem disabled={!cart.lines.length || !online} onSelect={async () => {
                try {
                  await parkCart(orgId, outlet!.id, register.id, cart.customer?.name ?? `Sale at ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`);
                  toast.success("Sale parked");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}>
                <PauseCircle /> Park sale
              </DropdownItem>
              <DropdownItem disabled={!online} onSelect={() => setHeldOpen(true)}>
                <PauseCircle /> Recall parked sale
              </DropdownItem>
              <DropdownItem disabled={!cart.lines.length || !can("pos.discount")} onSelect={() => setDiscountOpen(true)}>
                <Percent /> Discount whole sale
              </DropdownItem>
              <DropdownItem onSelect={() => setNotesOpen(true)}>
                <StickyNote /> Sale note
              </DropdownItem>
              <DropdownItem disabled={!cart.lines.length || !online || !can("pos.quotations")} onSelect={async () => {
                try {
                  const id = await rpc<string>("save_quotation", { payload: {
                    organization_id: orgId, id: cart.quotationId, outlet_id: outlet!.id, customer_id: cart.customer?.id ?? null,
                    items: toPayloadItems(cart.lines), cart_discount: cart.cartDiscount, notes: cart.notes || null } });
                  cart.clear();
                  toast.success("Quotation saved", { action: { label: "View", onClick: () => navigate(`/quotations?id=${id}`) } });
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}>
                <FileText /> Save as quotation
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem disabled={!online} onSelect={async () => {
                const v = !offlineDevice.data;
                await setOfflineDevice(orgId, user!.id, v);
                await offlineDevice.refetch();
                qc.invalidateQueries({ queryKey: ["pos-catalog"] });
                toast.success(v ? "This device now keeps prices and stock (no customer data) for offline selling." : "Offline catalogue removed from this device.");
              }}>
                <WifiOff /> {offlineDevice.data ? "Turn off offline selling here" : "Allow offline selling on this device"}
              </DropdownItem>
              <DropdownItem onSelect={() => setParams({ sync: "1" })}>
                <CloudOff /> Offline sales {sync.pending + sync.failed > 0 && `(${sync.pending + sync.failed})`}
              </DropdownItem>
              <DropdownItem onSelect={() => navigate(`/shifts/${shift.id}`)}>
                <Vault /> Shift, cash in/out & close
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem disabled={!cart.lines.length} onSelect={() => setClearOpen(true)} className="text-coral">
                <Trash2 /> Clear sale
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Cart">
          {cart.lines.length === 0 ? (
            <li className="flex h-full flex-col items-center justify-center px-8 text-center text-sm text-muted">
              <ScanBarcode className="mb-2 size-8 text-line-strong" />
              Scan an item or tap a product to start a sale.
            </li>
          ) : (
            cart.lines.map((l) => (
              <CartLineRow key={l.key} line={l} priced={pricedByKey.get(l.key)} onEdit={() => setEditing(l)}
                onBump={(d) => {
                  if (d > 0 && l.trackStock && !allowNegative && Number(l.qty) + d > Number(l.stock ?? 0)) {
                    return toast.error(`Only ${formatQty(l.stock ?? 0)} in stock.`);
                  }
                  cart.bump(l.key, d);
                }} />
            ))
          )}
        </ul>

        {cart.notes && <div className="border-t border-line px-4 py-2 text-xs text-muted">Note: {cart.notes}</div>}
        {cart.quotationId && <div className="border-t border-line px-4 py-2 text-xs text-lagoon">From a quotation — prices re-checked at charge</div>}

        {/* Tender slab */}
        <div className="relative bg-reef px-4 pb-4 pt-5 text-white">
          <svg className="absolute -top-[7px] left-0 h-2 w-full" preserveAspectRatio="none" viewBox="0 0 40 2" aria-hidden>
            <path d="M0 2 L1 0 L2 2 L3 0 L4 2 L5 0 L6 2 L7 0 L8 2 L9 0 L10 2 L11 0 L12 2 L13 0 L14 2 L15 0 L16 2 L17 0 L18 2 L19 0 L20 2 L21 0 L22 2 L23 0 L24 2 L25 0 L26 2 L27 0 L28 2 L29 0 L30 2 L31 0 L32 2 L33 0 L34 2 L35 0 L36 2 L37 0 L38 2 L39 0 L40 2 Z" fill="var(--reef)" />
          </svg>
          <dl className="space-y-1 text-[13px] text-reef-text">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular">{formatAmount(centsToString(priced?.subtotal ?? 0n))}</dd>
            </div>
            {(priced?.discountTotal ?? 0n) > 0n && (
              <div className="flex justify-between text-[#8fe0c9]">
                <dt>Discounts{cart.cartDiscount && Number(cart.cartDiscount.value) > 0 ? ` (sale ${cart.cartDiscount.type === "percent" ? `${cart.cartDiscount.value}%` : formatAmount(cart.cartDiscount.value)})` : ""}</dt>
                <dd className="tabular">− {formatAmount(centsToString(priced!.discountTotal))}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>{inclusive ? "Tax included" : "Tax"}</dt>
              <dd className="tabular">{formatAmount(centsToString(priced?.taxTotal ?? 0n))}</dd>
            </div>
          </dl>
          <div className="mt-3 flex items-end justify-between">
            <span className="text-sm text-reef-text">{cart.lines.reduce((s, l) => s + Number(l.qty), 0) ? `${formatQty(cart.lines.reduce((s, l) => s + Number(l.qty), 0))} items` : "Total"}</span>
            <span className="font-display text-[40px] font-semibold leading-none tabular" aria-live="polite">
              <span className="me-1.5 text-lg font-medium text-reef-text">MVR</span>
              {formatAmount(centsToString(total))}
            </span>
          </div>
          <Button size="xl" className="mt-4 w-full bg-saffron text-[17px] text-reef hover:bg-saffron hover:brightness-105"
            disabled={!cart.lines.length || !priced} onClick={() => setTenderOpen(true)}>
            Charge {formatMoney(centsToString(total))}
            <Kbd>F2</Kbd>
          </Button>
          <div className="mt-2 flex items-center justify-between text-[11px] text-reef-text/80">
            <span>{register.name} · shift open</span>
            {!online && <span className="text-saffron">Offline</span>}
          </div>
        </div>
      </aside>

      <LineEditor line={editing} onClose={() => setEditing(null)}
        onSave={(p) => { cart.updateLine(editing!.key, p); setEditing(null); }}
        onRemove={() => { cart.remove(editing!.key); setEditing(null); }} />

      <Dialog open={!!variantPick} onOpenChange={(o) => !o && setVariantPick(null)}>
        <DialogContent title={variantPick?.[0]?.product_name ?? "Choose an option"} description="Pick the option the customer is buying.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {variantPick?.map((v) => (
              <button key={v.variant_id} onClick={() => { setVariantPick(null); if (v.sold_by_weight) setWeightPick(v); else addItem(v); }}
                className="rounded-md border border-line-strong p-3 text-start hover:border-lagoon">
                <div className="font-medium">{v.variant_name}</div>
                <div className="mt-1 flex justify-between text-xs text-muted">
                  <span className="tabular">{formatAmount(v.price)}</span>
                  {v.track_stock && <span>{formatQty(v.stock ?? 0)} left</span>}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <WeightDialog item={weightPick} onClose={() => setWeightPick(null)} onAdd={(qty) => { addItem(weightPick!, qty); setWeightPick(null); }} />

      <TenderDialog open={tenderOpen} onOpenChange={setTenderOpen} total={total} customer={cart.customer} buildPayload={buildPayload}
        offline={!online} canQueueOffline={!!offlineDevice.data} provisionalReceipt={provisionalReceipt}
        onComplete={(o) => {
          setTenderOpen(false);
          setMobileCart(false);
          setDone(o);
          cart.clear();
          qc.invalidateQueries({ queryKey: ["pos-catalog"] });
        }} />

      <CustomerPicker open={customerOpen} onOpenChange={setCustomerOpen} onPick={(c) => cart.setCustomer(c)} />
      <HeldBills open={heldOpen} onOpenChange={setHeldOpen} />
      <SyncPanel open={syncOpen} onOpenChange={(o) => !o && setParams({})} currentShiftId={shift.id} />
      <CartDiscountDialog open={discountOpen} onOpenChange={setDiscountOpen} />
      <NotesDialog open={notesOpen} onOpenChange={setNotesOpen} />
      <ConfirmDialog open={clearOpen} onOpenChange={setClearOpen} title="Clear this sale?" danger confirmLabel="Clear sale"
        description="All items, discounts and the attached customer will be removed." onConfirm={() => cart.clear()} />

      <Dialog open={!!done} onOpenChange={(o) => { if (!o) { setDone(null); setTimeout(() => searchRef.current?.focus(), 50); } }}>
        <DialogContent title={done?.offline ? "Sale saved offline" : "Sale complete"} wide
          description={done?.offline ? "It will sync automatically. The receipt below is provisional." : done?.receipt.sale.invoice_number}>
          {done && (
            <div className="grid gap-5 md:grid-cols-[1fr_auto]">
              <div>
                <div className="rounded-lg bg-reef p-5 text-white">
                  <div className="text-sm text-reef-text">Change due</div>
                  <div className="font-display text-5xl font-semibold tabular text-saffron">{formatMoney(done.change)}</div>
                  <div className="mt-2 text-sm text-reef-text">Total {formatMoney(done.receipt.sale.total)}</div>
                </div>
                <div className="mt-4">
                  <ReceiptActions data={done.receipt} format={receiptFormat} onFormat={setReceiptFormat} />
                </div>
              </div>
              <div className="max-h-[60vh] overflow-y-auto rounded-md border border-line bg-white">
                <ReceiptDocument data={done.receipt} format={receiptFormat} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button size="lg" autoFocus onClick={() => { setDone(null); setTimeout(() => searchRef.current?.focus(), 50); }}>
              New sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WeightDialog({ item, onClose, onAdd }: { item: CatalogItem | null; onClose: () => void; onAdd: (qty: string) => void }) {
  const [qty, setQty] = React.useState("");
  React.useEffect(() => setQty(""), [item]);
  const ok = /^\d+(\.\d{1,3})?$/.test(qty) && Number(qty) > 0;
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={item?.product_name ?? ""} description={`Enter the weight or measure in ${item?.unit ?? "units"}. ${item ? formatMoney(item.price) : ""} per ${item?.unit ?? "unit"}.`}>
        <form onSubmit={(e) => { e.preventDefault(); if (ok) onAdd(qty); }}>
          <Field label={`Quantity (${item?.unit ?? "units"})`} htmlFor="wq">
            <Input id="wq" inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} className="h-12 text-xl tabular" placeholder="0.000" />
          </Field>
          {ok && item && <p className="mt-2 text-sm text-muted">≈ {formatMoney(Number(qty) * item.price)}</p>}
          <DialogFooter>
            <Button type="submit" disabled={!ok}>Add to sale</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CartDiscountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { cartDiscount, setCartDiscount } = useCart();
  const [type, setType] = React.useState<"percent" | "fixed">("percent");
  const [value, setValue] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setType(cartDiscount?.type ?? "percent");
      setValue(cartDiscount ? String(cartDiscount.value) : "");
    }
  }, [open, cartDiscount]);
  const ok = value === "" || (/^\d+(\.\d{1,2})?$/.test(value) && (type === "fixed" || Number(value) <= 100));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Discount the whole sale" description="Spread across items by value so tax stays correct on each line.">
        <div className="flex gap-2">
          <div className="flex rounded-md border border-line-strong p-0.5">
            {(["percent", "fixed"] as const).map((t) => (
              <button key={t} onClick={() => setType(t)} className={cn("rounded px-3 text-sm", type === t ? "bg-reef text-white" : "text-muted")}>
                {t === "percent" ? "%" : "MVR"}
              </button>
            ))}
          </div>
          <Input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Discount value" className="h-10 text-lg" />
        </div>
        <DialogFooter>
          {cartDiscount && <Button variant="danger-ghost" onClick={() => { setCartDiscount(null); onOpenChange(false); }}>Remove discount</Button>}
          <Button disabled={!ok} onClick={() => { setCartDiscount(value && Number(value) > 0 ? { type, value } : null); onOpenChange(false); }}>Apply discount</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { notes, setNotes } = useCart();
  const [v, setV] = React.useState(notes);
  React.useEffect(() => { if (open) setV(notes); }, [open, notes]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Sale note" description="Printed on the receipt.">
        <Textarea value={v} onChange={(e) => setV(e.target.value)} autoFocus maxLength={300} />
        <DialogFooter>
          <Button onClick={() => { setNotes(v.trim()); onOpenChange(false); }}>Save note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
