import { liveQuery } from "dexie";
import * as React from "react";
import { offlineDb, type QueuedSale } from "./db";

export function useOnline(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Subscribe to a Dexie live query; re-subscribes when `deps` change. */
export function useLive<T>(query: () => Promise<T>, deps: React.DependencyList, initial: T): T {
  const [value, setValue] = React.useState<T>(initial);
  const queryRef = React.useRef(query);
  React.useEffect(() => {
    queryRef.current = query;
  });
  const key = JSON.stringify(deps);
  React.useEffect(() => {
    const sub = liveQuery(() => queryRef.current()).subscribe({ next: setValue, error: () => undefined });
    return () => sub.unsubscribe();
  }, [key]);
  return value;
}

export function useSyncSummary() {
  return useLive(
    async () => {
      const all = await offlineDb.queue.toArray();
      return {
        pending: all.filter((q) => q.status === "pending" || q.status === "syncing").length,
        failed: all.filter((q) => q.status === "conflict").length,
      };
    },
    [],
    { pending: 0, failed: 0 },
  );
}

export function useQueue(orgId: string | null): QueuedSale[] {
  return useLive(
    async () => (orgId ? (await offlineDb.queue.where("orgId").equals(orgId).reverse().sortBy("createdAt")) : []),
    [orgId],
    [],
  );
}
