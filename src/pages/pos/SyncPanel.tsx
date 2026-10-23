import { CloudUpload, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useOrg } from "@/app/org";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge, EmptyState, Money } from "@/components/ui/misc";
import { fmtDateTime } from "@/lib/dates";
import { useOnline, useQueue } from "@/offline/hooks";
import { discardQueued, resolveConflict, syncQueue } from "@/offline/sync";

export function SyncPanel({ open, onOpenChange, currentShiftId }: { open: boolean; onOpenChange: (o: boolean) => void; currentShiftId: string | null }) {
  const { membership, can } = useOrg();
  const queue = useQueue(membership?.organization_id ?? null);
  const online = useOnline();
  const [busy, setBusy] = React.useState(false);
  const [discard, setDiscard] = React.useState<string | null>(null);
  const [openedAt] = React.useState(() => Date.now());
  const visible = queue.filter((q) => q.status !== "synced" || openedAt - new Date(q.syncedAt ?? 0).getTime() < 86_400_000);

  async function run(p: Promise<unknown> | undefined) {
    setBusy(true);
    try {
      const r = (await p) as { synced: number; conflicts: number } | undefined;
      if (r) toast.message(`${r.synced} synced${r.conflicts ? `, ${r.conflicts} need attention` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" title="Offline sales" description="Sales taken without a connection. They post through the same checkout as online sales and can't be duplicated.">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-muted">{online ? "Connected" : "Offline — sync resumes automatically when the connection returns."}</span>
          <Button size="sm" disabled={!online} loading={busy} onClick={() => run(syncQueue(membership?.organization_id))}>
            <CloudUpload /> Sync now
          </Button>
        </div>
        {visible.length === 0 ? (
          <EmptyState icon={CloudUpload} title="Nothing waiting to sync" />
        ) : (
          <ul className="space-y-2">
            {visible.map((q) => (
              <li key={q.id} className="rounded-md border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      <Money value={q.total} /> · {q.itemCount} item{q.itemCount === 1 ? "" : "s"}
                    </div>
                    <div className="text-xs text-muted">Taken {fmtDateTime(q.createdAt)}</div>
                  </div>
                  {q.status === "synced" ? <Badge tone="ok">{q.invoiceNumber}</Badge>
                    : q.status === "conflict" ? <Badge tone="coral">Needs attention</Badge>
                    : <Badge tone="saffron">{q.status === "syncing" ? "Syncing" : "Waiting"}</Badge>}
                </div>
                {q.status === "conflict" && (
                  <div className="mt-2 space-y-2">
                    <p className="text-sm text-coral">{q.error}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={!online} onClick={() => run(resolveConflict(q.id, { type: "retry" }))}>
                        Retry
                      </Button>
                      {q.errorCode === "SHIFT_CLOSED" && currentShiftId && (
                        <Button size="sm" variant="secondary" disabled={!online} onClick={() => run(resolveConflict(q.id, { type: "use_shift", shiftId: currentShiftId }))}>
                          Post to current shift
                        </Button>
                      )}
                      {q.errorCode === "INSUFFICIENT_STOCK" && can("inventory.adjust") && (
                        <Button size="sm" variant="secondary" disabled={!online} onClick={() => run(resolveConflict(q.id, { type: "allow_negative" }))}>
                          Accept and record negative stock
                        </Button>
                      )}
                      <Button size="sm" variant="danger-ghost" onClick={() => setDiscard(q.id)}>
                        <Trash2 /> Discard
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog open={!!discard} onOpenChange={(o) => !o && setDiscard(null)} title="Discard this offline sale?" danger confirmLabel="Discard sale"
          description="It will never reach the server. If the customer paid, settle it with them directly and record any cash adjustment in the shift."
          onConfirm={async () => {
            if (discard) await discardQueued(discard);
          }} />
      </DialogContent>
    </Dialog>
  );
}
