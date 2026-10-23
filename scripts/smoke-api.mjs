// End-to-end API smoke test through @supabase/supabase-js (same client the app uses).
// Usage: VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/smoke-api.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL ?? "http://localhost:54321";
const anon = process.env.VITE_SUPABASE_ANON_KEY;
if (!anon) throw new Error("VITE_SUPABASE_ANON_KEY is required");

const fail = (step, error) => {
  console.error(`✗ ${step}: ${error?.message ?? error}`);
  process.exit(1);
};

const sb = createClient(url, anon, { auth: { persistSession: false } });
const email = `smoke${Date.now()}@example.mv`;
const { data: su, error: e1 } = await sb.auth.signUp({ email, password: "Smoke#Test12345" });
if (e1 || !su.session) fail("sign up (needs auto-confirm on local stacks)", e1 ?? "no session");
console.log("✓ signed up", email);

const { data: orgId, error: e2 } = await sb.rpc("create_organization", {
  payload: { name: "Smoke Shop", outlet: { name: "Main", code: "MAIN" }, taxes: [{ name: "GST", rate: 8, is_default: true }] },
});
if (e2) fail("create organization", e2);
console.log("✓ organization", orgId);

const { data: outlets, error: e3 } = await sb.from("outlets").select("id, default_warehouse_id").eq("organization_id", orgId);
if (e3 || outlets.length !== 1) fail("read outlets", e3 ?? "unexpected outlet count");
const { data: reg } = await sb.from("registers").select("id").eq("organization_id", orgId).single();
const { data: cash } = await sb.from("payment_methods").select("id").eq("organization_id", orgId).eq("kind", "cash").single();

const { data: productId, error: e4 } = await sb.rpc("create_product", {
  payload: { organization_id: orgId, name: "Smoke water 500ml", variants: [{ retail_price: "5.40", barcodes: ["0000000000017"],
    opening_stock: [{ warehouse_id: outlets[0].default_warehouse_id, qty: 10, unit_cost: "2" }] }] },
});
if (e4) fail("create product", e4);
const { data: variant } = await sb.from("product_variants").select("id").eq("product_id", productId).single();
const { data: shiftId, error: e5 } = await sb.rpc("open_shift", { p_register: reg.id, p_opening_float: 100 });
if (e5) fail("open shift", e5);
const { data: sale, error: e6 } = await sb.rpc("pos_checkout", {
  payload: { client_uuid: crypto.randomUUID(), register_id: reg.id, shift_id: shiftId,
    items: [{ variant_id: variant.id, qty: 2 }], payments: [{ payment_method_id: cash.id, amount: "20" }] },
});
if (e6) fail("checkout", e6);
console.log("✓ sale", sale.invoice_number, "total", sale.total, "change", sale.change_given);

const anonClient = createClient(url, anon, { auth: { persistSession: false } });
const { data: leak, error: e7 } = await anonClient.from("sales").select("id");
if (!e7 && leak.length > 0) fail("anonymous isolation", "anon could read sales");
console.log("✓ anonymous client sees no tenant data");
console.log("API smoke test passed");
