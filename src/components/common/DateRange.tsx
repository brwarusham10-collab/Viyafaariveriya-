import * as React from "react";
import { Input, Select } from "@/components/ui/input";
import { rangeFor, type RangeKey } from "@/lib/dates";

export interface Range {
  key: RangeKey;
  from: string;
  to: string;
}

export function useRange(initial: RangeKey = "7d"): [Range, (r: Range) => void] {
  return React.useState<Range>({ key: initial, ...rangeFor(initial) });
}

export function DateRangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Date range" value={value.key} className="h-8 w-40"
        onChange={(e) => {
          const key = e.target.value as RangeKey;
          onChange(key === "custom" ? { ...value, key } : { key, ...rangeFor(key) });
        }}>
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="mtd">This month</option>
        <option value="custom">Custom range</option>
      </Select>
      {value.key === "custom" && (
        <>
          <Input type="date" aria-label="From" value={value.from} max={value.to} className="h-8 w-38" onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span className="text-muted">to</span>
          <Input type="date" aria-label="To" value={value.to} min={value.from} className="h-8 w-38" onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </>
      )}
    </div>
  );
}
