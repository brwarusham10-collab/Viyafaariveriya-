import { afterAll, describe, expect, it } from "vitest";
import {
  addStaff, as, createUser, expectError, makeBusiness, makeProduct, openShift, pool, rpc, stockOf, uuid, type Fixture,
} from "./helpers";
import { priceCart } from "../../src/lib/pricing";
import { centsToString } from "../../src/lib/money";

afterAll(async () => {
  await pool.end();
});

type Checkout = { sale_id: string; invoice_number: string; total: string; change_given: string; replayed: boolean };

function sale(f: Fixture, shift: string, items: unknown[], payments: unknown[], extra: Record<string, unknown> = {}) {
  return { client_uuid: uuid(), register_id: f.registerId, shift_id: shift, items, payments, ...extra };
}

describe("onboarding", () => {
  it("creates a usable business with roles, outlet, register, taxes and tender types", async () => {
    const f = await makeBusiness();
    const roles = await as<{ system_key: string }>(f.owner.id, "select system_key from roles where organization_id = $1 order by 1", [f.orgId]);
    expect(roles.map((r) => r.system_key)).toEqual(["accountant", "admin", "cashier", "inventory", "owner"]);
    expect(Object.keys(f.methods).sort()).toEqual(["bank_transfer", "card", "cash", "on_account", "store_credit"]);
    const m = await as<{ permissions: string[] }>(f.owner.id, "select permissions from my_memberships() where organization_id = $1", [f.orgId]);
    expect(m[0].permissions).toContain("pos.void");
  });

  it("rejects anonymous callers", async () => {
    await expectError(as(null, "select public.create_organization('{\"name\":\"x\"}'::jsonb)"), /permission denied|NOT_AUTHENTICATED/);
  });
});

describe("checkout", () => {
  it("completes a tax-inclusive cash sale atomically with change, stock and invoice number", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { name: "Tuna can", price: "108.00", cost: "60", stock: 10, barcode: "4791234500017" });
    const shift = await openShift(f);
    const r = await rpc<Checkout>(f.owner.id, "pos_checkout", [
      sale(f, shift, [{ variant_id: v, qty: 2 }], [{ payment_method_id: f.methods.cash, amount: "250" }]),
    ]);
    expect(r.invoice_number).toBe("MAIN-000001");
    expect(Number(r.total)).toBe(216);
    expect(Number(r.change_given)).toBe(34);
    const [s] = await as<{ tax_total: string; amount_paid: string; payment_status: string }>(
      f.owner.id, "select tax_total, amount_paid, payment_status from sales where id = $1", [r.sale_id]);
    expect(s).toEqual({ tax_total: "16.00", amount_paid: "216.00", payment_status: "paid" });
    const [item] = await as<{ unit_cost: string; cost_total: string }>(f.owner.id, "select unit_cost, cost_total from sale_items where sale_id = $1", [r.sale_id]);
    expect(Number(item.unit_cost)).toBe(60);
    expect(Number(item.cost_total)).toBe(120);
    expect(await stockOf(v, f.warehouseId)).toBe(8);
    const mv = await as<{ qty_change: string }>(f.owner.id, "select qty_change from inventory_movements where reference_id = $1", [r.sale_id]);
    expect(mv.map((m) => Number(m.qty_change))).toEqual([-2]);
  });

  it("matches the client pricing engine for discounts, mixed tax rates and both tax modes", async () => {
    for (const inclusive of [true, false]) {
      const f = await makeBusiness("Pricing", { inclusive });
      const a = await makeProduct(f, { price: "19.99", stock: 100 });
      const b = await makeProduct(f, { price: "7.35", stock: 100 });
      const items = [
        { variant_id: a, qty: 3, discount_type: "percent", discount_value: "12.5" },
        { variant_id: b, qty: 7, discount_type: "fixed", discount_value: "1.10" },
        { variant_id: a, qty: 1 },
      ];
      const cart = { type: "percent", value: "7" };
      const server = await rpc<{ total: string; tax_total: string; discount_total: string; lines: { line_total: string; tax_amount: string }[] }>(
        f.owner.id, "price_cart", [f.orgId, f.outletId, null, JSON.stringify(items), cart]);
      const client = priceCart(
        items.map((i, k) => ({
          key: String(k), name: "x", qty: i.qty, unitPrice: i.variant_id === a ? "19.99" : "7.35", taxRate: "8",
          discountType: (i.discount_type as "percent" | "fixed") ?? null, discountValue: i.discount_value ?? null,
        })),
        { type: "percent", value: "7" },
        inclusive,
      );
      expect(centsToString(client.total)).toBe(Number(server.total).toFixed(2));
      expect(centsToString(client.taxTotal)).toBe(Number(server.tax_total).toFixed(2));
      expect(centsToString(client.discountTotal)).toBe(Number(server.discount_total).toFixed(2));
      expect(client.lines.map((l) => centsToString(l.lineTotal))).toEqual(server.lines.map((l) => Number(l.line_total).toFixed(2)));
    }
  });

  it("is idempotent: a retried submission returns the original sale and deducts stock once", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "50", stock: 5 });
    const shift = await openShift(f);
    const payload = sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.card, amount: "50" }]);
    const [a, b, c] = await Promise.all([
      rpc<Checkout>(f.owner.id, "pos_checkout", [payload]),
      rpc<Checkout>(f.owner.id, "pos_checkout", [payload]),
      rpc<Checkout>(f.owner.id, "pos_checkout", [payload]),
    ]);
    expect(new Set([a.sale_id, b.sale_id, c.sale_id]).size).toBe(1);
    expect([a, b, c].filter((x) => x.replayed).length).toBe(2);
    expect(await stockOf(v, f.warehouseId)).toBe(4);
    const [{ n }] = await as<{ n: string }>(f.owner.id, "select count(*) as n from payments where sale_id = $1", [a.sale_id]);
    expect(Number(n)).toBe(1);
  });

  it("never oversells the last unit under concurrent checkouts", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "10", stock: 1 });
    const shift = await openShift(f);
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        rpc<Checkout>(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.cash, amount: "10" }])]),
      ),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled");
    const failed = attempts.filter((a) => a.status === "rejected") as PromiseRejectedResult[];
    expect(ok.length).toBe(1);
    expect(failed.every((x) => String(x.reason.message).includes("INSUFFICIENT_STOCK"))).toBe(true);
    expect(await stockOf(v, f.warehouseId)).toBe(0);
  });

  it("rejects underpayment, overpaid card tenders, and sales on a closed shift", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "100", stock: 10 });
    const shift = await openShift(f);
    await expectError(rpc(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.cash, amount: "99.99" }])]), "INSUFFICIENT_PAYMENT");
    await expectError(rpc(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.card, amount: "120" }])]), "OVERPAYMENT_NON_CASH");
    await rpc(f.owner.id, "close_shift", [shift, { "500": 1 }, null]);
    await expectError(rpc(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.cash, amount: "100" }])]), "SHIFT_CLOSED");
    expect(await stockOf(v, f.warehouseId)).toBe(10);
  });

  it("enforces credit limits and tracks the customer account", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "300", stock: 10 });
    const shift = await openShift(f);
    const [c] = await as<{ id: string }>(f.owner.id,
      "insert into customers (organization_id, name, phone, credit_limit) values ($1, 'Ali Resort Supplies', '7771234', 500) returning id", [f.orgId]);
    await rpc(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.on_account, amount: "300" }], { customer_id: c.id })]);
    await expectError(
      rpc(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.on_account, amount: "300" }], { customer_id: c.id })]),
      "CREDIT_LIMIT_EXCEEDED");
    await rpc(f.owner.id, "record_customer_payment", [{ organization_id: f.orgId, client_uuid: uuid(), customer_id: c.id, payment_method_id: f.methods.cash, amount: "120", shift_id: shift }]);
    const [cust] = await as<{ account_balance: string }>(f.owner.id, "select account_balance from customers where id = $1", [c.id]);
    expect(cust.account_balance).toBe("180.00");
    const rec = await as<{ balance: string; current_0_30: string }>(f.owner.id, "select * from report_receivables($1)", [f.orgId]);
    expect(rec[0]).toMatchObject({ balance: "180.00", current_0_30: "180.00" });
  });

  it("keeps bank transfers pending until verified", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "75", stock: 3 });
    const shift = await openShift(f);
    await expectError(rpc(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.bank_transfer, amount: "75" }])]), "PAYMENT_REFERENCE_REQUIRED");
    const r = await rpc<Checkout>(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.bank_transfer, amount: "75", reference: "BML-REF-88231" }])]);
    const [p] = await as<{ id: string; status: string }>(f.owner.id, "select id, status from payments where sale_id = $1", [r.sale_id]);
    expect(p.status).toBe("pending");
    await rpc(f.owner.id, "verify_payment", [p.id, true, "Matched on statement"]);
    const [s] = await as<{ payment_status: string }>(f.owner.id, "select payment_status from sales where id = $1", [r.sale_id]);
    expect(s.payment_status).toBe("paid");
  });
});

describe("refunds and voids", () => {
  it("refunds part of a sale, restocks at original cost, and blocks over-refunding", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "33.33", cost: "20", stock: 10 });
    const shift = await openShift(f);
    const r = await rpc<Checkout>(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 3 }], [{ payment_method_id: f.methods.cash, amount: "100" }])]);
    const [item] = await as<{ id: string }>(f.owner.id, "select id from sale_items where sale_id = $1", [r.sale_id]);
    const refundOne = (qty: number, amount: string) =>
      rpc<{ total: string }>(f.owner.id, "process_refund", [{
        client_uuid: uuid(), sale_id: r.sale_id, shift_id: shift, reason: "Damaged tin", restock: true,
        items: [{ sale_item_id: item.id, qty }], payouts: [{ payment_method_id: f.methods.cash, amount }],
      }]);
    await expectError(refundOne(1, "30.00"), "PAYOUT_MISMATCH");
    const first = await refundOne(1, "33.33");
    expect(first.total).toBe(33.33);
    // last two units absorb rounding: 99.99 - 33.33
    const second = await refundOne(2, "66.66");
    expect(second.total).toBe(66.66);
    await expectError(refundOne(1, "33.33"), "REFUND_EXCEEDS_SOLD");
    expect(await stockOf(v, f.warehouseId)).toBe(10);
    const rep = await rpc<{ current: { net_sales: string; refunds: string; cogs: string } }>(f.owner.id, "report_sales_summary", [f.orgId, today(), today(), null]);
    expect(Number(rep.current.net_sales)).toBe(0);
    expect(Number(rep.current.cogs)).toBe(0);
  });

  it("requires pos.refund and a reason", async () => {
    const f = await makeBusiness();
    const cashier = await addStaff(f, "cashier");
    const v = await makeProduct(f, { price: "10", stock: 5 });
    const shift = await openShift(f, cashier.id);
    const r = await rpc<Checkout>(cashier.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.cash, amount: "10" }])]);
    const [item] = await as<{ id: string }>(f.owner.id, "select id from sale_items where sale_id = $1", [r.sale_id]);
    const payload = { client_uuid: uuid(), sale_id: r.sale_id, shift_id: shift, reason: "", restock: true,
      items: [{ sale_item_id: item.id, qty: 1 }], payouts: [{ payment_method_id: f.methods.cash, amount: "10" }] };
    await expectError(rpc(cashier.id, "process_refund", [payload]), "PERMISSION_DENIED: pos.refund");
    await expectError(rpc(f.owner.id, "process_refund", [payload]), "REASON_REQUIRED");
  });

  it("voids a sale in the open shift, restoring stock and store credit", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "40", stock: 5 });
    const shift = await openShift(f);
    const [c] = await as<{ id: string }>(f.owner.id, "insert into customers (organization_id, name) values ($1, 'Mariyam') returning id", [f.orgId]);
    // issue store credit via a refund first
    const s1 = await rpc<Checkout>(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.cash, amount: "40" }], { customer_id: c.id })]);
    const [i1] = await as<{ id: string }>(f.owner.id, "select id from sale_items where sale_id = $1", [s1.sale_id]);
    await rpc(f.owner.id, "process_refund", [{ client_uuid: uuid(), sale_id: s1.sale_id, shift_id: shift, reason: "Changed mind", restock: true,
      items: [{ sale_item_id: i1.id, qty: 1 }], payouts: [{ payment_method_id: f.methods.store_credit, amount: "40" }] }]);
    const s2 = await rpc<Checkout>(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 2 }], [
      { payment_method_id: f.methods.store_credit, amount: "40" }, { payment_method_id: f.methods.cash, amount: "40" }], { customer_id: c.id })]);
    let [cust] = await as<{ store_credit: string }>(f.owner.id, "select store_credit from customers where id = $1", [c.id]);
    expect(cust.store_credit).toBe("0.00");
    await rpc(f.owner.id, "void_sale", [s2.sale_id, "Rang up wrong customer", uuid()]);
    [cust] = await as<{ store_credit: string }>(f.owner.id, "select store_credit from customers where id = $1", [c.id]);
    expect(cust.store_credit).toBe("40.00");
    expect(await stockOf(v, f.warehouseId)).toBe(5);
    const [s] = await as<{ status: string }>(f.owner.id, "select status from sales where id = $1", [s2.sale_id]);
    expect(s.status).toBe("voided");
    const report = await rpc<{ expected_cash: string }>(f.owner.id, "shift_report", [shift]);
    expect(report.expected_cash).toBe(540); // 500 float + 40 cash (first sale) - 0 (refund to credit); void nets to zero
  });
});

describe("shift closeout", () => {
  it("computes expected cash, counts denominations, records variance and freezes the shift", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "108", stock: 10 });
    const shift = await openShift(f, f.owner.id, "1000");
    await rpc(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.cash, amount: "200" }])]);
    await rpc(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.card, amount: "108" }])]);
    await rpc(f.owner.id, "add_cash_movement", [shift, "cash_out", "50", "Ice delivery", uuid()]);
    await rpc(f.owner.id, "add_cash_movement", [shift, "cash_in", "20", "Change top-up", uuid()]);
    const x = await rpc<{ expected_cash: string; payment_methods: { method: string; in: string }[] }>(f.owner.id, "shift_report", [shift]);
    expect(x.expected_cash).toBe(1078); // 1000 + 108 - 50 + 20
    expect(x.payment_methods.find((m) => m.method === "Card")?.in).toBe(108);
    const z = await rpc<{ status: string; counted_cash: string; variance: string }>(f.owner.id, "close_shift", [
      shift, { "1000": 1, "50": 1, "20": 1, "5": 1, "1": 2 }, "Short by 1",
    ]);
    expect(z).toMatchObject({ status: "closed", counted_cash: 1077, variance: -1 });
    await expectError(rpc(f.owner.id, "add_cash_movement", [shift, "cash_in", "5", "late", uuid()]), "SHIFT_CLOSED");
    await expectError(as(f.owner.id, "update shifts set counted_cash = 1078 where id = $1", [shift]), "permission denied");
    await rpc(f.owner.id, "approve_shift", [shift, "Variance accepted"]);
    const again = await openShift(f);
    expect(again).toBeTruthy();
    await expectError(openShift(f), "SHIFT_ALREADY_OPEN");
  });
});

describe("tenant isolation and authorization", () => {
  it("prevents cross-tenant reads and writes", async () => {
    const a = await makeBusiness("Alpha");
    const b = await makeBusiness("Beta");
    const v = await makeProduct(a, { price: "10", stock: 5 });
    const shiftA = await openShift(a);
    await rpc(a.owner.id, "pos_checkout", [sale(a, shiftA, [{ variant_id: v, qty: 1 }], [{ payment_method_id: a.methods.cash, amount: "10" }])]);

    for (const table of ["products", "product_variants", "sales", "sale_items", "payments", "inventory_balances", "customers", "organizations", "outlets", "audit_logs"]) {
      const rows = await as(b.owner.id, `select * from ${table} where ${table === "organizations" ? "id" : "organization_id"} = $1`, [a.orgId]);
      expect(rows, table).toHaveLength(0);
    }
    await expectError(as(b.owner.id, "insert into products (organization_id, name) values ($1, 'Injected')", [a.orgId]), "row-level security");
    const upd = await as(b.owner.id, "update product_variants set retail_price = 0 where id = $1 returning id", [v]);
    expect(upd).toHaveLength(0);
    // RPCs re-derive the tenant from the register; B cannot use A's register or shift
    await expectError(rpc(b.owner.id, "pos_checkout", [sale(a, shiftA, [{ variant_id: v, qty: 1 }], [{ payment_method_id: a.methods.cash, amount: "10" }])]), "PERMISSION_DENIED");
    await expectError(rpc(b.owner.id, "adjust_stock", [{ organization_id: a.orgId, client_uuid: uuid(), warehouse_id: a.warehouseId, reason_code: "theft", items: [{ variant_id: v, qty_change: -5 }] }]), "PERMISSION_DENIED");
    await expectError(rpc(b.owner.id, "report_sales_summary", [a.orgId, today(), today(), null]), "PERMISSION_DENIED");
    // B cannot reference A's variant from its own register either
    const shiftB = await openShift(b);
    await expectError(rpc(b.owner.id, "pos_checkout", [sale(b, shiftB, [{ variant_id: v, qty: 1 }], [{ payment_method_id: b.methods.cash, amount: "10" }])]), "VARIANT_NOT_FOUND");
    expect(await stockOf(v, a.warehouseId)).toBe(4);
  });

  it("blocks direct writes to financial tables and protected columns", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "10", stock: 5 });
    const [c] = await as<{ id: string }>(f.owner.id, "insert into customers (organization_id, name) values ($1, 'X') returning id", [f.orgId]);
    await expectError(as(f.owner.id, "update customers set store_credit = 1000 where id = $1", [c.id]), "permission denied");
    await expectError(as(f.owner.id, "update inventory_balances set qty = 999 where variant_id = $1", [v]), "permission denied");
    await expectError(as(f.owner.id, "insert into inventory_movements (organization_id, warehouse_id, variant_id, movement_type, qty_change, qty_after, avg_cost_after) values ($1,$2,$3,'adjustment',5,5,0)", [f.orgId, f.warehouseId, v]), "permission denied");
    await expectError(as(f.owner.id, "delete from audit_logs where organization_id = $1", [f.orgId]), "permission denied");
    await expectError(as(f.owner.id, "update organizations set status = 'active', plan = 'enterprise' where id = $1", [f.orgId]), "permission denied");
  });

  it("restricts a cashier to selling within granted permissions and outlets", async () => {
    const f = await makeBusiness();
    const cashier = await addStaff(f, "cashier", [f.outletId]);
    const v = await makeProduct(f, { price: "25", stock: 5 });
    const shift = await openShift(f, cashier.id);
    await expectError(rpc(cashier.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1, unit_price: "1.00" }], [{ payment_method_id: f.methods.cash, amount: "1" }])]), "pos.price_override");
    await expectError(rpc(cashier.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1, discount_type: "percent", discount_value: 50 }], [{ payment_method_id: f.methods.cash, amount: "25" }])]), "pos.discount");
    await expectError(rpc(cashier.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.on_account, amount: "25" }])]), "CUSTOMER_REQUIRED");
    const ok = await rpc<Checkout>(cashier.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.cash, amount: "25" }])]);
    expect(ok.invoice_number).toBe("MAIN-000001");
    await expectError(rpc(cashier.id, "adjust_stock", [{ organization_id: f.orgId, client_uuid: uuid(), warehouse_id: f.warehouseId, reason_code: "damage", items: [{ variant_id: v, qty_change: -1 }] }]), "PERMISSION_DENIED");
    expect(await as(cashier.id, "select * from expenses where organization_id = $1", [f.orgId])).toHaveLength(0);
    await expectError(as(cashier.id, "update product_variants set retail_price = 1 where id = $1", [v]).then((r) => { if (r.length === 0) throw new Error("row-level security: no rows"); }), "row-level security");
    // a second outlet the cashier is not assigned to
    const other = await rpc<string>(f.owner.id, "create_outlet", [f.orgId, "Hulhumale", "HLM", null, "Hulhumale'", null, "Till 1"]);
    const [reg2] = await as<{ id: string }>(f.owner.id, "select id from registers where outlet_id = $1", [other]);
    await expectError(rpc(cashier.id, "open_shift", [reg2.id, "100"]), "OUTLET_ACCESS_DENIED");
  });

  it("protects the last owner and keeps platform admin separate", async () => {
    const f = await makeBusiness();
    const [m] = await as<{ id: string }>(f.owner.id, "select id from organization_users where organization_id = $1", [f.orgId]);
    const [cashierRole] = await as<{ id: string }>(f.owner.id, "select id from roles where organization_id = $1 and system_key = 'cashier'", [f.orgId]);
    await expectError(rpc(f.owner.id, "update_member", [m.id, cashierRole.id, null, "active", null]), "LAST_OWNER");
    await expectError(rpc(f.owner.id, "admin_overview", []), "platform admin");
    const admin = await createUser();
    await pool.query("insert into platform_admins (user_id) values ($1)", [admin.id]);
    const ov = await rpc<{ totals: { organizations: number } }>(admin.id, "admin_overview", []);
    expect(ov.totals.organizations).toBeGreaterThan(0);
    // platform admins do not get tenant data access through RLS
    expect(await as(admin.id, "select * from sales where organization_id = $1", [f.orgId])).toHaveLength(0);
  });
});

describe("purchasing, landed cost and transfers", () => {
  it("receives a PO in two parts with freight allocated into weighted-average cost", async () => {
    const f = await makeBusiness();
    const inv = await addStaff(f, "inventory");
    const v1 = await makeProduct(f, { name: "Rice 5kg", price: "120", cost: "80", stock: 10 });
    const v2 = await makeProduct(f, { name: "Sugar 1kg", price: "25", cost: "15", stock: 0 });
    const [sup] = await as<{ id: string }>(inv.id, "insert into suppliers (organization_id, name) values ($1, 'STO Wholesale') returning id", [f.orgId]);
    const po = await rpc<string>(inv.id, "save_purchase_order", [{ organization_id: f.orgId, supplier_id: sup.id, warehouse_id: f.warehouseId,
      items: [{ variant_id: v1, qty_ordered: 10, unit_cost: "90" }, { variant_id: v2, qty_ordered: 20, unit_cost: "15" }] }]);
    await expectError(rpc(inv.id, "set_purchase_order_status", [po, "approved"]), "purchases.approve");
    await rpc(f.owner.id, "set_purchase_order_status", [po, "approved"]);
    const items = await as<{ id: string; variant_id: string }>(inv.id, "select id, variant_id from purchase_order_items where purchase_order_id = $1", [po]);
    const line = (vid: string) => items.find((i) => i.variant_id === vid)!.id;
    // part 1: 10 rice @90 + 20 sugar @15 = 1200, freight 120 → allocated 90 / 30
    await rpc(inv.id, "receive_goods", [{ organization_id: f.orgId, client_uuid: uuid(), purchase_order_id: po, freight: "120",
      items: [{ purchase_order_item_id: line(v1), variant_id: v1, qty: 10, unit_cost: "90" }, { purchase_order_item_id: line(v2), variant_id: v2, qty: 10, unit_cost: "15" }] }]);
    let [p] = await as<{ status: string }>(inv.id, "select status from purchase_orders where id = $1", [po]);
    expect(p.status).toBe("partial");
    const [b1] = await as<{ qty: string; avg_cost: string }>(inv.id, "select qty, avg_cost from inventory_balances where variant_id = $1", [v1]);
    // (10*80 + 10*(90 + 9.6)) / 20 ; freight share for rice = 120 * 900/1050 = 102.86 → 10.286/unit
    expect(Number(b1.qty)).toBe(20);
    expect(Number(b1.avg_cost)).toBeCloseTo((800 + 900 + 102.86) / 20, 3);
    await rpc(inv.id, "receive_goods", [{ organization_id: f.orgId, client_uuid: uuid(), purchase_order_id: po,
      items: [{ purchase_order_item_id: line(v2), variant_id: v2, qty: 10, unit_cost: "15" }] }]);
    [p] = await as<{ status: string }>(inv.id, "select status from purchase_orders where id = $1", [po]);
    expect(p.status).toBe("received");
    expect(await stockOf(v2, f.warehouseId)).toBe(20);
    const summary = await as<{ landed_value: string }>(f.owner.id, "select * from report_supplier_purchases($1, $2, $3)", [f.orgId, today(), today()]);
    expect(Number(summary[0].landed_value)).toBe(900 + 150 + 120 + 150);
  });

  it("moves stock between locations through request → approve → issue → receive", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "10", cost: "4", stock: 30 });
    const [wh] = await as<{ id: string }>(f.owner.id, "insert into warehouses (organization_id, name) values ($1, 'Thilafushi warehouse') returning id", [f.orgId]);
    const t = await rpc<string>(f.owner.id, "request_transfer", [{ organization_id: f.orgId, from_warehouse_id: f.warehouseId, to_warehouse_id: wh.id, items: [{ variant_id: v, qty: 12 }] }]);
    await expectError(rpc(f.owner.id, "advance_transfer", [t, "issue", null]), "INVALID_TRANSITION");
    await rpc(f.owner.id, "advance_transfer", [t, "approve", null]);
    await rpc(f.owner.id, "advance_transfer", [t, "issue", null]);
    expect(await stockOf(v, f.warehouseId)).toBe(18);
    expect(await stockOf(v, wh.id)).toBe(0);
    const [item] = await as<{ id: string }>(f.owner.id, "select id from stock_transfer_items where transfer_id = $1", [t]);
    await rpc(f.owner.id, "advance_transfer", [t, "receive", JSON.stringify([{ item_id: item.id, qty: 11 }])]);
    expect(await stockOf(v, wh.id)).toBe(11);
    const [bal] = await as<{ avg_cost: string }>(f.owner.id, "select avg_cost from inventory_balances where warehouse_id = $1", [wh.id]);
    expect(Number(bal.avg_cost)).toBe(4);
  });

  it("records every stock change in the movement ledger", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "10", stock: 7 });
    await rpc(f.owner.id, "adjust_stock", [{ organization_id: f.orgId, client_uuid: uuid(), warehouse_id: f.warehouseId, reason_code: "damage", items: [{ variant_id: v, qty_change: -2 }] }]);
    await expectError(rpc(f.owner.id, "adjust_stock", [{ organization_id: f.orgId, client_uuid: uuid(), warehouse_id: f.warehouseId, reason_code: "damage", items: [{ variant_id: v, qty_change: -99 }] }]), "INSUFFICIENT_STOCK");
    const [{ ledger }] = await as<{ ledger: string }>(f.owner.id, "select sum(qty_change) as ledger from inventory_movements where variant_id = $1", [v]);
    expect(Number(ledger)).toBe(await stockOf(v, f.warehouseId));
    const shr = await as<{ reason: string; qty: string }>(f.owner.id, "select * from report_shrinkage($1, $2, $3)", [f.orgId, today(), today()]);
    expect(shr[0]).toMatchObject({ reason: "damage", qty: "2.000" });
  });
});

describe("reports", () => {
  it("derives KPIs from persisted sales, refunds and expenses", async () => {
    const f = await makeBusiness();
    const v = await makeProduct(f, { price: "108", cost: "50", stock: 20 });
    const shift = await openShift(f);
    for (let i = 0; i < 3; i++) {
      await rpc(f.owner.id, "pos_checkout", [sale(f, shift, [{ variant_id: v, qty: 1 }], [{ payment_method_id: f.methods.card, amount: "108" }])]);
    }
    const [cat] = await as<{ id: string }>(f.owner.id, "select id from expense_categories where organization_id = $1 and name = 'Rent'", [f.orgId]);
    await as(f.owner.id, "insert into expenses (organization_id, outlet_id, category_id, amount, expense_date) values ($1, $2, $3, 40, $4)", [f.orgId, f.outletId, cat.id, today()]);
    const rep = await rpc<{ current: Record<string, string | number> }>(f.owner.id, "report_sales_summary", [f.orgId, today(), today(), null]);
    expect(rep.current).toMatchObject({ orders: 3, sales_total: 324, tax: 24, net_sales: 300, cogs: 150,
      gross_profit: 150, expenses: 40, operating_profit: 110, aov: 108 });
    const tax = await rpc<{ net_tax: string; rates: { rate: string; net_taxable: string }[] }>(f.owner.id, "report_tax_summary", [f.orgId, today(), today(), null]);
    expect(Number(tax.net_tax)).toBe(24);
    expect(Number(tax.rates[0].net_taxable)).toBe(300);
    const series = await as<{ orders: string }>(f.owner.id, "select * from report_sales_timeseries($1, $2, $3, null, 'hour')", [f.orgId, today(), today()]);
    expect(series).toHaveLength(24);
    expect(series.reduce((s, r) => s + Number(r.orders), 0)).toBe(3);
  });
});

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Indian/Maldives" }).format(new Date());
}
