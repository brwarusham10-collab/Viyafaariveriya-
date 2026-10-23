import { describe, expect, it } from "vitest";
import { centsToString, divRound, formatMoney, toCents } from "./money";
import { evaluateTenders, priceCart } from "./pricing";

const s = centsToString;

describe("money", () => {
  it("parses and rounds half away from zero like PostgreSQL", () => {
    expect(s(toCents("1.005"))).toBe("1.01");
    expect(s(toCents("-1.005"))).toBe("-1.01");
    expect(s(toCents(0.1 + 0.2))).toBe("0.30");
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
  });
  it("formats MVR with two decimals", () => {
    expect(formatMoney("1234.5")).toBe("MVR 1,234.50");
    expect(formatMoney(0)).toBe("MVR 0.00");
  });
});

describe("priceCart", () => {
  it("extracts inclusive tax per line", () => {
    const c = priceCart([{ key: "a", name: "a", qty: 2, unitPrice: "108", taxRate: 8 }], null, true);
    expect(s(c.total)).toBe("216.00");
    expect(s(c.taxTotal)).toBe("16.00");
  });
  it("adds exclusive tax on top", () => {
    const c = priceCart([{ key: "a", name: "a", qty: 3, unitPrice: "10.00", taxRate: 8 }], null, false);
    expect(s(c.taxTotal)).toBe("2.40");
    expect(s(c.total)).toBe("32.40");
  });
  it("allocates a cart discount so line allocations sum exactly", () => {
    const c = priceCart(
      [
        { key: "a", name: "a", qty: 1, unitPrice: "10.00", taxRate: 8 },
        { key: "b", name: "b", qty: 1, unitPrice: "10.00", taxRate: 8 },
        { key: "c", name: "c", qty: 1, unitPrice: "10.00", taxRate: 0 },
      ],
      { type: "fixed", value: "10.00" },
      true,
    );
    expect(c.lines.map((l) => s(l.cartDiscountAlloc))).toEqual(["3.33", "3.33", "3.34"]);
    expect(s(c.total)).toBe("20.00");
  });
  it("caps fixed discounts at the line value and handles decimal quantities", () => {
    const c = priceCart([{ key: "a", name: "kg", qty: "0.755", unitPrice: "35.00", taxRate: 0, discountType: "fixed", discountValue: "100" }], null, true);
    expect(s(c.subtotal)).toBe("26.43");
    expect(s(c.total)).toBe("0.00");
  });
  it("rejects invalid input", () => {
    expect(() => priceCart([{ key: "a", name: "a", qty: 0, unitPrice: "1", taxRate: 0 }], null, true)).toThrow("INVALID_QTY");
    expect(() => priceCart([{ key: "a", name: "a", qty: 1, unitPrice: "1", taxRate: 0, discountType: "percent", discountValue: 101 }], null, true)).toThrow("INVALID_DISCOUNT");
  });
});

describe("evaluateTenders", () => {
  it("gives change only from cash", () => {
    const r = evaluateTenders(toCents("178.50"), [{ kind: "card", amount: "100" }, { kind: "cash", amount: "100" }]);
    expect(r.complete).toBe(true);
    expect(s(r.change)).toBe("21.50");
  });
  it("flags non-cash overpayment and shortfalls", () => {
    expect(evaluateTenders(toCents("50"), [{ kind: "card", amount: "60" }]).overpaidNonCash).toBe(true);
    const r = evaluateTenders(toCents("50"), [{ kind: "cash", amount: "20" }]);
    expect(r.complete).toBe(false);
    expect(s(r.remaining)).toBe("30.00");
  });
});
