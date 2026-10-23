import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "lagoon" | "saffron" | "coral" | "ok" | "reef";

const toneClass: Record<Tone, string> = {
  neutral: "bg-fg/6 text-muted",
  lagoon: "bg-lagoon-soft text-lagoon-strong",
  saffron: "bg-saffron-soft text-[#8a5a12] dark:text-saffron",
  coral: "bg-coral-soft text-coral",
  ok: "bg-ok-soft text-ok",
  reef: "bg-reef text-white",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action, description }: { title: React.ReactNode; action?: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="font-display text-[15px] font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("rounded bg-fg/8 [animation:skeleton_1.4s_ease-in-out_infinite]", className)} aria-hidden />;
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="mb-3 grid size-11 place-items-center rounded-full bg-lagoon-soft text-lagoon">
          <Icon className="size-5" />
        </div>
      )}
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Money({ value, currency, className, plain }: { value: unknown; currency?: string; className?: string; plain?: boolean }) {
  const v = value as number | string | null | undefined;
  return <span className={cn("tabular", className)}>{plain ? formatAmount(v) : formatMoney(v, currency)}</span>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-surface-2 px-1 font-sans text-[11px] text-muted">{children}</kbd>
  );
}

export function Stat({
  label,
  value,
  delta,
  hint,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  hint?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-[13px] text-muted">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-28" />
      ) : (
        <div className="mt-1 truncate font-display text-[22px] font-semibold tabular">{value}</div>
      )}
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {delta !== undefined && delta !== null && !loading && (
          <span className={cn("font-medium", delta >= 0 ? "text-ok" : "text-coral")}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {hint}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <div className={cn("size-5 animate-spin rounded-full border-2 border-lagoon/25 border-t-lagoon", className)} role="status" aria-label="Loading" />;
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-lg border border-coral/30 bg-coral-soft px-4 py-3 text-sm text-coral" role="alert">
      {msg}
      {onRetry && (
        <button className="ms-3 font-medium underline underline-offset-2" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
