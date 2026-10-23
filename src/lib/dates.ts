import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export const TIMEZONE = "Indian/Maldives";

/** yyyy-MM-dd for "today" in the business timezone. */
export function todayISO(tz = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfMonthISO(iso: string): string {
  return `${iso.slice(0, 8)}01`;
}

export function fmtDateTime(value: string | Date | null | undefined, tz = TIMEZONE): string {
  if (!value) return "—";
  return format(new TZDate(new Date(value), tz), "d MMM yyyy, HH:mm");
}

export function fmtDate(value: string | Date | null | undefined, tz = TIMEZONE): string {
  if (!value) return "—";
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return format(new TZDate(d, tz), "d MMM yyyy");
}

export function fmtTime(value: string | Date | null | undefined, tz = TIMEZONE): string {
  if (!value) return "—";
  return format(new TZDate(new Date(value), tz), "HH:mm");
}

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "mtd" | "custom";

export function rangeFor(key: RangeKey, tz = TIMEZONE): { from: string; to: string } {
  const t = todayISO(tz);
  switch (key) {
    case "today":
      return { from: t, to: t };
    case "yesterday":
      return { from: addDaysISO(t, -1), to: addDaysISO(t, -1) };
    case "7d":
      return { from: addDaysISO(t, -6), to: t };
    case "30d":
      return { from: addDaysISO(t, -29), to: t };
    case "mtd":
      return { from: startOfMonthISO(t), to: t };
    default:
      return { from: t, to: t };
  }
}
