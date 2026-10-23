// Client-side mirror of private.compute_cart (supabase/migrations/..._sales_shifts.sql).
// The server is authoritative; this gives instant, identical previews at the register.
import { centsToString, divRound, toScaled, type Cents } from "./money";

export type DiscountType = "percent" | "fixed";

export interface PricingLineInput {
  key: string;
  name: string;
  qty: string | number;          // up to 3 decimals
  unitPrice: string | number;    // price basis (incl. or excl. tax per org)
  listPrice?: string | number;
  taxRate: string | number;      // percent, up to 3 decimals
  discountType?: DiscountType | null;
  discountValue?: string | number | null;
}

export interface CartDiscount {
  type: DiscountType;
  value: string | number;
}

export interface PricedLine {
  key: string;
  name: string;
  qtyMilli: bigint;
  unitPrice: Cents;
  gross: Cents;
  lineDiscount: Cents;
  cartDiscountAlloc: Cents;
  taxRate: string;
  tax: Cents;
  lineTotal: Cents;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: Cents;
  discountTotal: Cents;
  cartDiscount: Cents;
  taxTotal: Cents;
  total: Cents;
  pricesIncludeTax: boolean;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

export function priceCart(
  items: PricingLineInput[],
  cartDiscount: CartDiscount | null | undefined,
  pricesIncludeTax: boolean,
): PricedCart {
  type Work = { line: PricingLineInput; qtyMilli: bigint; unit: Cents; gross: Cents; disc: Cents; after: Cents; rateMilli: bigint };
  const work: Work[] = items.map((line) => {
    const qtyMilli = toScaled(line.qty, 3);
    if (qtyMilli <= 0n) throw new Error("INVALID_QTY");
    const unit = toScaled(line.unitPrice, 2);
    const gross = divRound(qtyMilli * unit, 1000n);
    let disc = 0n;
    const dv = toScaled(line.discountValue ?? 0, 2);
    if (line.discountType === "percent") {
      if (dv < 0n || dv > 10000n) throw new Error("INVALID_DISCOUNT");
      disc = divRound(gross * dv, 10000n);
    } else if (line.discountType === "fixed") {
      if (dv < 0n) throw new Error("INVALID_DISCOUNT");
      disc = min(dv, gross);
    }
    return { line, qtyMilli, unit, gross, disc, after: gross - disc, rateMilli: toScaled(line.taxRate, 3) };
  });

  const base = work.reduce((s, w) => s + w.after, 0n);
  let cart = 0n;
  if (cartDiscount && cartDiscount.value !== "" && cartDiscount.value !== null) {
    const cv = toScaled(cartDiscount.value, 2);
    if (cv < 0n) throw new Error("INVALID_DISCOUNT");
    if (cartDiscount.type === "percent") {
      if (cv > 10000n) throw new Error("INVALID_DISCOUNT");
      cart = divRound(base * cv, 10000n);
    } else {
      cart = min(cv, base);
    }
  }

  let lastIdx = -1;
  work.forEach((w, i) => {
    if (w.after > 0n) lastIdx = i;
  });

  let allocated = 0n;
  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  let total = 0n;
  const lines: PricedLine[] = work.map((w, i) => {
    let alloc = 0n;
    if (cart > 0n && w.after > 0n) {
      alloc = i === lastIdx ? cart - allocated : divRound(cart * w.after, base);
    }
    allocated += alloc;
    const amount = w.after - alloc;
    const tax = pricesIncludeTax
      ? divRound(amount * w.rateMilli, 100000n + w.rateMilli)
      : divRound(amount * w.rateMilli, 100000n);
    const lineTotal = pricesIncludeTax ? amount : amount + tax;
    subtotal += w.gross;
    discountTotal += w.disc + alloc;
    taxTotal += tax;
    total += lineTotal;
    return {
      key: w.line.key,
      name: w.line.name,
      qtyMilli: w.qtyMilli,
      unitPrice: w.unit,
      gross: w.gross,
      lineDiscount: w.disc,
      cartDiscountAlloc: alloc,
      taxRate: String(w.line.taxRate),
      tax,
      lineTotal,
    };
  });

  return { lines, subtotal, discountTotal, cartDiscount: cart, taxTotal, total, pricesIncludeTax };
}

export interface TenderInput {
  kind: "cash" | "card" | "bank_transfer" | "store_credit" | "on_account" | "other";
  amount: string | number;
}

/** Mirrors the tender validation in pos_checkout. */
export function evaluateTenders(total: Cents, tenders: TenderInput[]) {
  let cash = 0n;
  let nonCash = 0n;
  for (const t of tenders) {
    const a = toScaled(t.amount, 2);
    if (a <= 0n) continue;
    if (t.kind === "cash") cash += a;
    else nonCash += a;
  }
  const cashNeeded = total - nonCash;
  const overpaidNonCash = nonCash > total;
  const paid = cash + nonCash;
  const remaining = paid >= total ? 0n : total - paid;
  const change = !overpaidNonCash && cash > cashNeeded ? cash - (cashNeeded > 0n ? cashNeeded : 0n) : 0n;
  return {
    paid,
    remaining,
    change,
    overpaidNonCash,
    complete: !overpaidNonCash && paid >= total,
  };
}

export const centsStr = centsToString;
