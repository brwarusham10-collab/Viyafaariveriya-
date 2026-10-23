// Exact money arithmetic in integer minor units (laari) using BigInt.
// Rounding is half away from zero, matching PostgreSQL round(numeric, 2).

export type Cents = bigint;

/** Parse a decimal string/number with up to `scale` decimals into a scaled bigint. */
export function toScaled(value: string | number | null | undefined, scale: number): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  let s = typeof value === "number" ? numberToPlain(value) : value.trim();
  let neg = false;
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error(`Invalid number: ${value}`);
  const [int = "0", frac = ""] = s.split(".");
  // round half away from zero on extra digits
  const kept = frac.slice(0, scale).padEnd(scale, "0");
  let result = BigInt((int || "0") + kept);
  const next = frac.charAt(scale);
  if (next && Number(next) >= 5) result += 1n;
  return neg ? -result : result;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${n}`);
  // toFixed(10) avoids exponent notation for typical money values; trim trailing zeros
  const s = Math.abs(n) < 1e-6 && n !== 0 ? n.toFixed(12) : String(n);
  if (/e/i.test(s)) return n.toFixed(12);
  return s;
}

export const toCents = (v: string | number | null | undefined): Cents => toScaled(v, 2);

/** Integer division rounding half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("Division by zero");
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

export function centsToString(c: Cents): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  const s = a.toString().padStart(3, "0");
  return `${neg ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}

export const centsToNumber = (c: Cents): number => Number(centsToString(c));

const groupFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "MVR 1,234.50" — amounts are always shown with two decimals. */
export function formatMoney(value: string | number | bigint | null | undefined, currency = "MVR"): string {
  const n = typeof value === "bigint" ? centsToNumber(value) : Number(value ?? 0);
  return `${currency} ${groupFmt.format(Number.isFinite(n) ? n : 0)}`;
}

export function formatAmount(value: string | number | bigint | null | undefined): string {
  const n = typeof value === "bigint" ? centsToNumber(value) : Number(value ?? 0);
  return groupFmt.format(Number.isFinite(n) ? n : 0);
}

export function formatQty(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
