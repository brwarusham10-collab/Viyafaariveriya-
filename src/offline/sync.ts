import { rpc, toAppError } from "@/lib/supabase";
import { offlineDb, type QueuedSale } from "./db";

let running: Promise<SyncResult> | null = null;

export interface SyncResult {
  synced: number;
  conflicts: number;
  remaining: number;
  networkError: boolean;
}

const NETWORK = /Failed to fetch|NetworkError|network|fetch failed|Load failed/i;

/** Push queued offline sales through the same idempotent checkout RPC used online. */
export function syncQueue(orgId?: string): Promise<SyncResult> {
  if (running) return running;
  running = (async () => {
    const result: SyncResult = { synced: 0, conflicts: 0, remaining: 0, networkError: false };
    const pending = (await offlineDb.queue.where("status").anyOf("pending", "syncing").sortBy("createdAt")).filter(
      (q) => !orgId || q.orgId === orgId,
    );
    for (const q of pending) {
      await offlineDb.queue.update(q.id, { status: "syncing", attempts: q.attempts + 1 });
      try {
        const r = await rpc<{ invoice_number: string }>("pos_checkout", { payload: q.payload });
        await offlineDb.queue.update(q.id, { status: "synced", invoiceNumber: r.invoice_number, syncedAt: new Date().toISOString(), error: undefined });
        result.synced++;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (NETWORK.test(err.message) || !navigator.onLine) {
          await offlineDb.queue.update(q.id, { status: "pending" });
          result.networkError = true;
          break;
        }
        const app = "code" in err ? (err as { code: string }) : toAppError(err);
        await offlineDb.queue.update(q.id, { status: "conflict", error: err.message, errorCode: app.code });
        result.conflicts++;
      }
    }
    result.remaining = await offlineDb.queue.where("status").anyOf("pending", "syncing").count();
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Resolve a conflicted offline sale and retry it. */
export async function resolveConflict(
  id: string,
  action: { type: "retry" } | { type: "use_shift"; shiftId: string } | { type: "allow_negative" },
) {
  const q = await offlineDb.queue.get(id);
  if (!q) return;
  const payload = { ...q.payload } as QueuedSale["payload"] & { offline?: Record<string, unknown> };
  if (action.type === "use_shift") payload.shift_id = action.shiftId;
  if (action.type === "allow_negative") payload.offline = { ...payload.offline, force_negative_stock: true };
  await offlineDb.queue.update(id, { payload, status: "pending", error: undefined, errorCode: undefined });
  return syncQueue(q.orgId);
}

export async function discardQueued(id: string) {
  await offlineDb.queue.delete(id);
}
