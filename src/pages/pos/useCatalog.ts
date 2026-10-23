import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useAuth } from "@/app/auth";
import { offlineDb, isOfflineDevice } from "@/offline/db";
import { useOnline } from "@/offline/hooks";
import { rpc } from "@/lib/supabase";
import type { CatalogItem } from "@/lib/types";

interface CatalogResult {
  items: CatalogItem[];
  generatedAt: string | null;
  source: "live" | "cache" | "none";
}

/**
 * Live catalogue when online (and refreshed into IndexedDB on designated offline devices);
 * the last cached snapshot when offline. Stock in a cached snapshot may be stale.
 */
export function useCatalog(orgId: string, outletId: string | undefined) {
  const online = useOnline();
  const { user } = useAuth();
  const query = useQuery<CatalogResult>({
    queryKey: ["pos-catalog", orgId, outletId, online],
    enabled: !!orgId && !!outletId,
    staleTime: 60_000,
    refetchInterval: online ? 120_000 : false,
    queryFn: async () => {
      const key = `${orgId}:${outletId}`;
      if (online) {
        try {
          const snap = await rpc<{ generated_at: string; warehouse_id: string | null; items: CatalogItem[] }>("pos_catalog", {
            p_org: orgId,
            p_outlet: outletId,
          });
          if (user && (await isOfflineDevice(orgId, user.id))) {
            await offlineDb.catalogs.put({
              key, orgId, outletId: outletId!, warehouseId: snap.warehouse_id, generatedAt: snap.generated_at,
              cachedAt: new Date().toISOString(), items: snap.items,
            });
          }
          return { items: snap.items, generatedAt: snap.generated_at, source: "live" };
        } catch (e) {
          if (navigator.onLine) throw e;
        }
      }
      const cached = await offlineDb.catalogs.get(key);
      return cached ? { items: cached.items, generatedAt: cached.generatedAt, source: "cache" } : { items: [], generatedAt: null, source: "none" };
    },
  });

  const index = React.useMemo(() => {
    const byCode = new Map<string, CatalogItem>();
    for (const it of query.data?.items ?? []) {
      for (const b of it.barcodes) byCode.set(b.toLowerCase(), it);
      if (it.sku) byCode.set(it.sku.toLowerCase(), it);
    }
    return byCode;
  }, [query.data]);

  return { ...query, items: query.data?.items ?? [], index, source: query.data?.source ?? "none", generatedAt: query.data?.generatedAt ?? null };
}
