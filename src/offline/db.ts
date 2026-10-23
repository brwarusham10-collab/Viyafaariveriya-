import Dexie, { type EntityTable } from "dexie";
import type { CatalogItem } from "@/lib/types";

export interface CachedCatalog {
  key: string;                 // `${orgId}:${outletId}`
  orgId: string;
  outletId: string;
  warehouseId: string | null;
  generatedAt: string;         // server time the snapshot was taken
  cachedAt: string;
  items: CatalogItem[];
}

export type QueueStatus = "pending" | "syncing" | "synced" | "conflict";

export interface QueuedSale {
  id: string;                  // client_uuid — the idempotency key used by pos_checkout
  orgId: string;
  outletId: string;
  registerId: string;
  userId: string;
  payload: Record<string, unknown>;
  status: QueueStatus;
  total: string;
  itemCount: number;
  createdAt: string;
  attempts: number;
  error?: string;
  errorCode?: string;
  invoiceNumber?: string;
  syncedAt?: string;
}

export interface DeviceSetting {
  key: string;
  value: unknown;
}

// Offline storage is scoped per signed-in user and organisation and holds no customer data.
export const offlineDb = new Dexie("viyafaari-offline") as Dexie & {
  catalogs: EntityTable<CachedCatalog, "key">;
  queue: EntityTable<QueuedSale, "id">;
  settings: EntityTable<DeviceSetting, "key">;
};

offlineDb.version(1).stores({
  catalogs: "key, orgId",
  queue: "id, status, orgId, createdAt",
  settings: "key",
});

export async function isOfflineDevice(orgId: string, userId: string): Promise<boolean> {
  const s = await offlineDb.settings.get(`offline:${userId}:${orgId}`);
  return s?.value === true;
}

export async function setOfflineDevice(orgId: string, userId: string, enabled: boolean) {
  await offlineDb.settings.put({ key: `offline:${userId}:${orgId}`, value: enabled });
  if (!enabled) await offlineDb.catalogs.where("orgId").equals(orgId).delete();
}

/** Called on sign-out: drop cached catalogues but never unsynced sales. */
export async function clearOfflineCaches() {
  await offlineDb.catalogs.clear();
  await offlineDb.settings.clear();
}
