import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./misc";

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="sticky top-0 z-[1] bg-surface-2 text-start text-xs text-muted [&_th]:border-b [&_th]:border-line">{children}</thead>;
}

export function Th({ className, children, align }: { className?: string; children?: React.ReactNode; align?: "end" | "center" }) {
  return (
    <th className={cn("whitespace-nowrap px-3 py-2 text-start font-medium", align === "end" && "text-end", align === "center" && "text-center", className)}>
      {children}
    </th>
  );
}

export function Tr({ className, children, onClick }: { className?: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <tr
      className={cn("border-b border-line last:border-0", onClick && "cursor-pointer hover:bg-fg/[0.03]", className)}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      tabIndex={onClick ? 0 : undefined}>
      {children}
    </tr>
  );
}

export function Td({ className, children, align, colSpan }: { className?: string; children?: React.ReactNode; align?: "end" | "center"; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("px-3 py-2 align-middle", align === "end" && "text-end tabular", align === "center" && "text-center", className)}>
      {children}
    </td>
  );
}

export function TableSkeleton({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-line">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-3 py-2.5">
              <Skeleton className={cn("h-4", c === 0 ? "w-40" : "w-16")} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
