import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/money";

export interface SeriesPoint {
  label: string;
  value: number;
  orders?: number;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: SeriesPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-fg">{p.label}</div>
      <div className="mt-0.5 text-muted">
        Net sales <span className="font-medium text-fg tabular">{formatMoney(p.value)}</span>
      </div>
      {p.orders !== undefined && <div className="text-muted">{p.orders} orders</div>}
    </div>
  );
}

/** Single-series magnitude over time: one hue, no legend (the card title names it). */
export function SalesChart({ data, height = 240 }: { data: SeriesPoint[]; height?: number }) {
  const compact = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v)));
  return (
    <div style={{ height }} role="img" aria-label="Net sales chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="0" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tick={{ fill: "var(--muted)", fontSize: 11 }}
            interval="preserveStartEnd" minTickGap={12} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} tickFormatter={compact} width={44} />
          <Tooltip cursor={{ fill: "var(--fg)", fillOpacity: 0.05 }} content={<ChartTooltip />} />
          <Bar dataKey="value" fill="var(--chart)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal magnitude bars for a breakdown; values are always printed as text, never color-only. */
export function BreakdownBars({ rows, format = (v: number) => formatMoney(v) }: { rows: { label: string; value: number }[]; format?: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between gap-3 text-[13px]">
            <span className="truncate">{r.label}</span>
            <span className="font-medium tabular">{format(r.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-fg/6">
            <div className="h-full rounded-full bg-chart" style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
