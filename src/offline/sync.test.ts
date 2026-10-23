import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  rpc: (...a: unknown[]) => rpcMock(...a),
  toAppError: (e: Error) => ({ code: e.message.split(":")[0], message: e.message }),
}));

import { offlineDb } from "./db";
import { resolveConflict, syncQueue } from "./sync";

function queued(id: string, createdAt: string) {
  return {
    id, orgId: "org", outletId: "o", registerId: "r", userId: "u", status: "pending" as const, total: "10.00", itemCount: 1, createdAt, attempts: 0,
    payload: { client_uuid: id, register_id: "r", shift_id: "s1", items: [], payments: [], offline: { created_at: createdAt } },
  };
}

describe("offline sale queue", () => {
  beforeEach(async () => {
    rpcMock.mockReset();
    await offlineDb.queue.clear();
  });

  it("syncs in order through the idempotent checkout and records invoice numbers", async () => {
    await offlineDb.queue.bulkPut([queued("b", "2026-10-24T02:00:00Z"), queued("a", "2026-10-24T01:00:00Z")]);
    rpcMock.mockImplementation(async (_fn, { payload }) => ({ invoice_number: `INV-${payload.client_uuid}` }));
    const r = await syncQueue("org");
    expect(r).toMatchObject({ synced: 2, conflicts: 0, remaining: 0 });
    expect(rpcMock.mock.calls.map((c) => c[1].payload.client_uuid)).toEqual(["a", "b"]);
    expect((await offlineDb.queue.get("a"))?.invoiceNumber).toBe("INV-a");
  });

  it("stops and keeps sales pending on network failure", async () => {
    await offlineDb.queue.bulkPut([queued("a", "2026-10-24T01:00:00Z"), queued("b", "2026-10-24T02:00:00Z")]);
    rpcMock.mockRejectedValue(new Error("Failed to fetch"));
    const r = await syncQueue("org");
    expect(r).toMatchObject({ synced: 0, networkError: true, remaining: 2 });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("marks business-rule failures as conflicts and lets a manager resolve them", async () => {
    await offlineDb.queue.put(queued("a", "2026-10-24T01:00:00Z"));
    rpcMock.mockRejectedValueOnce(new Error("SHIFT_CLOSED"));
    await syncQueue("org");
    const c = await offlineDb.queue.get("a");
    expect(c).toMatchObject({ status: "conflict", errorCode: "SHIFT_CLOSED" });
    rpcMock.mockResolvedValueOnce({ invoice_number: "INV-9" });
    await resolveConflict("a", { type: "use_shift", shiftId: "s2" });
    expect(rpcMock.mock.calls.at(-1)![1].payload.shift_id).toBe("s2");
    expect((await offlineDb.queue.get("a"))?.status).toBe("synced");
  });
});
