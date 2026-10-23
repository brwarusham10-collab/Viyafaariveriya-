import { cn } from "@/lib/utils";

/** The Viyafaariveriyaa mark: a dhoni sail under a rising sun. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8", className)} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#0D2B33" />
      <circle cx="46" cy="17" r="5.5" fill="#E9A23B" />
      <path d="M25 11v35" stroke="#F4F6F5" strokeWidth="3" strokeLinecap="round" />
      <path d="M28 12c13 5 19 17 18 31H28z" fill="#12A493" />
      <path d="M12 49c13 7 27 7 40 0" fill="none" stroke="#F4F6F5" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="size-8 shrink-0 rounded-[9px] ring-1 ring-white/10" />
      {!compact && (
        <span className="font-display text-[17px] font-semibold leading-none tracking-tight">
          viyafaari<span className="opacity-60">veriyaa</span>
        </span>
      )}
    </span>
  );
}
