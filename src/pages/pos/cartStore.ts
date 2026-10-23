import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toScaled, divRound, centsToString } from "@/lib/money";
import { priceCart, type CartDiscount, type DiscountType } from "@/lib/pricing";
import type { CatalogItem } from "@/lib/types";
import { uuid } from "@/lib/utils";

export interface CartCustomer {
  id: string;
  name: string;
  phone: string | null;
  store_credit: number;
  account_balance: number;
  credit_limit: number;
  price_list: "retail" | "wholesale";
  discount_percent: number;
}

export interface CartLine {
  key: string;
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  qty: string;
  listPrice: string;        // catalogue price after customer-group pricing
  unitPrice: string;        // charged price (differs from listPrice only on override)
  basePrice: number;        // outlet price before customer pricing
  wholesalePrice: number | null;
  taxRate: string;
  trackStock: boolean;
  allowDecimal: boolean;
  stock: number | null;
  discountType: DiscountType | null;
  discountValue: string;
}

interface CartState {
  lines: CartLine[];
  cartDiscount: CartDiscount | null;
  customer: CartCustomer | null;
  quotationId: string | null;
  notes: string;
  checkoutId: string;       // idempotency key for the next checkout of this cart
  shiftByRegister: Record<string, string>;   // last known open shift per register (needed offline)
  add: (item: CatalogItem, qty?: string) => void;
  setQty: (key: string, qty: string) => void;
  bump: (key: string, delta: number) => void;
  updateLine: (key: string, patch: Partial<Pick<CartLine, "unitPrice" | "discountType" | "discountValue" | "qty">>) => void;
  remove: (key: string) => void;
  setCartDiscount: (d: CartDiscount | null) => void;
  setCustomer: (c: CartCustomer | null) => void;
  setNotes: (n: string) => void;
  load: (state: { lines: CartLine[]; cartDiscount: CartDiscount | null; customer: CartCustomer | null; quotationId?: string | null; notes?: string }) => void;
  clear: () => void;
  rememberShift: (registerId: string, shiftId: string | null) => void;
}

/** Customer-group price, mirroring private.resolve_price. */
export function customerPrice(base: number, wholesale: number | null, customer: CartCustomer | null): string {
  let price = toScaled(base, 2);
  if (customer?.price_list === "wholesale" && wholesale !== null && wholesale !== undefined) price = toScaled(wholesale, 2);
  if (customer && customer.discount_percent > 0) {
    price = divRound(price * (10000n - toScaled(customer.discount_percent, 2)), 10000n);
  }
  return centsToString(price);
}

const fresh = () => ({ lines: [], cartDiscount: null, customer: null, quotationId: null, notes: "", checkoutId: uuid() });

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      ...fresh(),
      shiftByRegister: {},
      add: (item, qty = "1") =>
        set((s) => {
          const existing = s.lines.find((l) => l.variantId === item.variant_id && l.unitPrice === l.listPrice && !l.discountType);
          if (existing && !item.sold_by_weight) {
            return {
              checkoutId: uuid(),
              lines: s.lines.map((l) => (l.key === existing.key ? { ...l, qty: String(Number(l.qty) + Number(qty)) } : l)),
            };
          }
          const list = customerPrice(item.price, item.wholesale_price, s.customer);
          const line: CartLine = {
            key: uuid(),
            variantId: item.variant_id,
            productId: item.product_id,
            name: item.variant_name === "Default" ? item.product_name : `${item.product_name} · ${item.variant_name}`,
            sku: item.sku,
            qty,
            listPrice: list,
            unitPrice: list,
            basePrice: item.price,
            wholesalePrice: item.wholesale_price,
            taxRate: String(item.tax_rate),
            trackStock: item.track_stock,
            allowDecimal: item.allow_decimal || item.sold_by_weight,
            stock: item.stock,
            discountType: null,
            discountValue: "",
          };
          return { lines: [...s.lines, line], checkoutId: uuid() };
        }),
      setQty: (key, qty) => set((s) => ({ checkoutId: uuid(), lines: s.lines.map((l) => (l.key === key ? { ...l, qty } : l)) })),
      bump: (key, delta) =>
        set((s) => ({
          checkoutId: uuid(),
          lines: s.lines
            .map((l) => (l.key === key ? { ...l, qty: String(Math.round((Number(l.qty) + delta) * 1000) / 1000) } : l))
            .filter((l) => Number(l.qty) > 0),
        })),
      updateLine: (key, patch) => set((s) => ({ checkoutId: uuid(), lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })),
      remove: (key) => set((s) => ({ checkoutId: uuid(), lines: s.lines.filter((l) => l.key !== key) })),
      setCartDiscount: (cartDiscount) => set({ cartDiscount, checkoutId: uuid() }),
      setCustomer: (customer) =>
        set((s) => ({
          customer,
          checkoutId: uuid(),
          lines: s.lines.map((l) => {
            const list = customerPrice(l.basePrice, l.wholesalePrice, customer);
            const overridden = l.unitPrice !== l.listPrice;
            return { ...l, listPrice: list, unitPrice: overridden ? l.unitPrice : list };
          }),
        })),
      setNotes: (notes) => set({ notes }),
      load: (state) => set({ ...fresh(), ...state, quotationId: state.quotationId ?? null, notes: state.notes ?? "" }),
      clear: () => set(fresh()),
      rememberShift: (registerId, shiftId) =>
        set((s) => {
          const next = { ...s.shiftByRegister };
          if (shiftId) next[registerId] = shiftId;
          else delete next[registerId];
          return { shiftByRegister: next };
        }),
    }),
    { name: "vfv-cart" },
  ),
);

export function priceLines(lines: CartLine[], cartDiscount: CartDiscount | null, inclusive: boolean) {
  const valid = lines.filter((l) => Number(l.qty) > 0);
  if (valid.length === 0) return null;
  try {
    return priceCart(
      valid.map((l) => ({
        key: l.key,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        discountType: l.discountType,
        discountValue: l.discountValue || 0,
      })),
      cartDiscount,
      inclusive,
    );
  } catch {
    return null;
  }
}

/** Shape sent to pos_checkout / save_quotation. Unit price is only sent when overridden. */
export function toPayloadItems(lines: CartLine[]) {
  return lines.map((l) => ({
    variant_id: l.variantId,
    qty: l.qty,
    ...(l.unitPrice !== l.listPrice ? { unit_price: l.unitPrice } : {}),
    ...(l.discountType && Number(l.discountValue) > 0 ? { discount_type: l.discountType, discount_value: l.discountValue } : {}),
  }));
}
