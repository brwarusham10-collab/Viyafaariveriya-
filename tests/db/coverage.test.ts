// Exercises every remaining RPC / report at least once so PL/pgSQL runtime errors surface in CI.
import { afterAll, describe, expect, it } from "vitest";
import { addStaff, as, expectError, makeBusiness, makeProduct, openShift, pool, rpc, stockOf, uuid } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Indian/Maldives" }).format(new Date());

describe("RPC coverage", () => {
  it("quotations: save, update, convert at checkout", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "200", stock: 5 });
    const q = await rpc<string>(f.owner.id, "save_quotation", [{ organization_id: f.orgId, outlet_id: f.outletId,
      items: [{ variant_id: v, qty: 2, discount_type: "percent", discount_value: 10 }], valid_until: today(), notes: "Resort order" }]);
    await rpc(f.owner.id, "save_quotation", [{ id: q, organization_id: f.orgId, outlet_id: f.outletId, status: "sent",
      items: [{ variant_id: v, qty: 3 }] }]);
    const [quote] = await as<{ total: string; quote_number: string; status: string }>(f.owner.id, "select total, quote_number, status from quotations where id = $1", [q]);
    expect(quote).toMatchObject({ total: "600.00", quote_number: "MAIN-QT-000001", status: "sent" });
    const shift = await openShift(f);
    await rpc(f.owner.id, "pos_checkout", [{ client_uuid: uuid(), register_id: f.registerId, shift_id: shift, quotation_id: q,
      items: [{ variant_id: v, qty: 3 }], payments: [{ payment_method_id: f.methods.card, amount: "600" }] }]);
    const [after] = await as<{ status: string }>(f.owner.id, "select status from quotations where id = $1", [q]);
    expect(after.status).toBe("converted");
    await expectError(rpc(f.owner.id, "set_quotation_status", [q, "draft"]), "QUOTATION_LOCKED");
  });

  it("parked bills are scoped to the outlet", async () => {
    const f = await makeBusiness();
    const [h] = await as<{ id: string }>(f.owner.id,
      "insert into held_bills (organization_id, outlet_id, register_id, label, cart) values ($1, $2, $3, 'Table 4', '{\"lines\":[]}') returning id",
      [f.orgId, f.outletId, f.registerId]);
    expect(h.id).toBeTruthy();
    await as(f.owner.id, "delete from held_bills where id = $1", [h.id]);
  });

  it("purchase return, reorder suggestions and valuation", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "30", cost: "12", stock: 6 });
    await as(f.owner.id, "update product_variants set min_stock = 10 where id = $1", [v]);
    const [sup] = await as<{ id: string }>(f.owner.id, "insert into suppliers (organization_id, name) values ($1, 'Island Traders') returning id", [f.orgId]);
    const sugg = await as<{ suggested_qty: string }>(f.owner.id, "select * from reorder_suggestions($1, $2)", [f.orgId, f.warehouseId]);
    expect(sugg).toHaveLength(1);
    const rid = await rpc<string>(f.owner.id, "create_purchase_return", [{ organization_id: f.orgId, client_uuid: uuid(), supplier_id: sup.id,
      warehouse_id: f.warehouseId, reason: "Expired", items: [{ variant_id: v, qty: 2 }] }]);
    const [ret] = await as<{ total: string }>(f.owner.id, "select total from purchase_returns where id = $1", [rid]);
    expect(ret.total).toBe("24.00");
    expect(await stockOf(v, f.warehouseId)).toBe(4);
    const val = await as<{ stock_value: string; retail_value: string }>(f.owner.id, "select * from report_inventory_valuation($1, null)", [f.orgId]);
    expect(val[0]).toMatchObject({ stock_value: "48.00", retail_value: "120.00" });
    // PO lifecycle edges
    const po = await rpc<string>(f.owner.id, "save_purchase_order", [{ organization_id: f.orgId, supplier_id: sup.id, warehouse_id: f.warehouseId,
      items: [{ variant_id: v, qty_ordered: 5, unit_cost: "12" }] }]);
    await rpc(f.owner.id, "set_purchase_order_status", [po, "cancelled"]);
    await expectError(rpc(f.owner.id, "receive_goods", [{ organization_id: f.orgId, client_uuid: uuid(), purchase_order_id: po,
      items: [{ variant_id: v, qty: 1, unit_cost: "12" }] }]), "PO_NOT_RECEIVABLE");
    // direct receipt without a PO is idempotent
    const payload = { organization_id: f.orgId, client_uuid: uuid(), supplier_id: sup.id, warehouse_id: f.warehouseId, duty: "6",
      items: [{ variant_id: v, qty: 3, unit_cost: "12", batch_no: "B-2026-10", expiry_date: "2027-03-01" }] };
    await rpc(f.owner.id, "receive_goods", [payload]);
    const replay = await rpc<{ replayed: boolean }>(f.owner.id, "receive_goods", [payload]);
    expect(replay.replayed).toBe(true);
    expect(await stockOf(v, f.warehouseId)).toBe(7);
  });

  it("catalog snapshot, member directory and invitations", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { name: "Coconut oil", price: "45", stock: 3, barcode: "8901234567890" });
    await as(f.owner.id, "insert into outlet_prices (organization_id, outlet_id, variant_id, price) values ($1, $2, $3, 42)", [f.orgId, f.outletId, v]);
    const cat = await rpc<{ items: { price: number; stock: number; barcodes: string[]; tax_rate: number }[] }>(f.owner.id, "pos_catalog", [f.orgId, f.outletId]);
    expect(cat.items[0]).toMatchObject({ price: 42, stock: 3, barcodes: ["8901234567890"], tax_rate: 8 });
    const acct = await addStaff(f, "accountant");
    const members = await as<{ email: string; role_name: string }>(f.owner.id, "select * from list_members($1)", [f.orgId]);
    expect(members.map((m) => m.role_name).sort()).toEqual(["Accountant", "Owner"]);
    await expectError(as(acct.id, "select * from list_members($1)", [f.orgId]), "staff.manage");
    const names = await as(acct.id, "select * from member_names($1)", [f.orgId]);
    expect(names).toHaveLength(2);
    const inv = await as<{ id: string }>(f.owner.id, "select * from my_invitations()");
    expect(inv).toHaveLength(0);
  });

  it("all report endpoints execute for a populated business", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "54", cost: "20", stock: 50 });
    await makeProduct(f, { name: "Slow mover", price: "9", stock: 40 });
    const shift = await openShift(f);
    await rpc(f.owner.id, "pos_checkout", [{ client_uuid: uuid(), register_id: f.registerId, shift_id: shift,
      items: [{ variant_id: v, qty: 2 }], payments: [{ payment_method_id: f.methods.cash, amount: "108" }] }]);
    const d = today();
    for (const dim of ["payment_method", "cashier", "outlet", "category"]) {
      const rows = await as<{ amount: string }>(f.owner.id, "select * from report_sales_breakdown($1, $2, $3, null, $4)", [f.orgId, d, d, dim]);
      expect(Number(rows[0].amount), dim).toBe(108);
    }
    const top = await as<{ qty_sold: string; profit: string }>(f.owner.id, "select * from report_product_performance($1, $2, $3, null, 'top', 10)", [f.orgId, d, d]);
    expect(top[0]).toMatchObject({ qty_sold: "2.000", profit: "60.00" });
    const slow = await as<{ product_name: string }>(f.owner.id, "select * from report_product_performance($1, $2, $3, null, 'slow', 10)", [f.orgId, d, d]);
    expect(slow[0].product_name).toBe("Slow mover");
    for (const b of ["day", "week", "month"]) {
      const s = await as(f.owner.id, "select * from report_sales_timeseries($1, $2, $3, null, $4)", [f.orgId, d, d, b]);
      expect(s.length).toBe(1);
    }
    await rpc(f.owner.id, "close_shift", [shift, { "500": 1, "100": 1, "5": 1, "2": 1, "1": 1 }, null]);
    const closeouts = await as<{ variance: string; sales_count: string }>(f.owner.id, "select * from report_shift_closeouts($1, $2, $3, null)", [f.orgId, d, d]);
    expect(closeouts[0]).toMatchObject({ variance: "0.00", sales_count: "1" });
    const counters = await rpc<{ shifts_to_approve: number; open_shifts: number }>(f.owner.id, "dashboard_counters", [f.orgId, null]);
    expect(counters).toMatchObject({ shifts_to_approve: 1, open_shifts: 0 });
    const [c] = await as<{ id: string }>(f.owner.id, "insert into customers (organization_id, name, credit_limit) values ($1, 'Ahmed', 1000) returning id", [f.orgId]);
    const st = await rpc<{ entries: unknown[]; opening_balance: number }>(f.owner.id, "customer_statement", [c.id, d, d]);
    expect(st.opening_balance).toBe(0);
  });

  it("accountant cannot sell; inventory staff cannot see profit", async () => {
    const f = await makeBusiness();
    const acct = await addStaff(f, "accountant");
    const inv = await addStaff(f, "inventory");
    await expectError(rpc(acct.id, "open_shift", [f.registerId, "0"]), "PERMISSION_DENIED");
    await expectError(rpc(inv.id, "report_sales_summary", [f.orgId, today(), today(), null]), "reports.view");
    const val = await as<{ avg_cost: string | null }>(inv.id, "select * from report_inventory_valuation($1, null)", [f.orgId]);
    expect(val).toEqual([]);
    const summary = await rpc<{ financial: boolean }>(acct.id, "report_sales_summary", [f.orgId, today(), today(), null]);
    expect(summary.financial).toBe(true);
  });

  it("suspended businesses cannot transact", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "5", stock: 5 });
    const shift = await openShift(f);
    await pool.query("update organizations set status = 'suspended' where id = $1", [f.orgId]);
    await expectError(rpc(f.owner.id, "pos_checkout", [{ client_uuid: uuid(), register_id: f.registerId, shift_id: shift,
      items: [{ variant_id: v, qty: 1 }], payments: [{ payment_method_id: f.methods.cash, amount: "5" }] }]), "ORGANIZATION_SUSPENDED");
    const s = await rpc(f.owner.id, "report_sales_summary", [f.orgId, today(), today(), null]);
    expect(s).toBeTruthy();
  });
});
