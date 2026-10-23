// Integration-test helpers. Every call runs inside its own transaction as the Postgres
// `authenticated` role with Supabase-style JWT claims, exactly as PostgREST would.
import pg from "pg";
import { randomUUID } from "node:crypto";

export const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54322/postgres";

export const pool = new pg.Pool({ connectionString: DB_URL, max: 12 });

export async function createUser(email = `${randomUUID().slice(0, 8)}@test.mv`): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  await pool.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                             raw_app_meta_data, raw_user_meta_data)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now(), '{}', '{}')`,
    [id, email],
  );
  return { id, email };
}

export class DbError extends Error {
  constructor(public original: Error & { detail?: string; code?: string }) {
    super(original.message);
  }
  get code() {
    return this.original.code;
  }
  get detail() {
    return this.original.detail;
  }
}

/** Run `sql` as the given user (or anon when userId is null). */
export async function as<T = Record<string, unknown>>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
    ]);
    const res = await client.query(sql, params);
    await client.query("commit");
    return res.rows as T[];
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw new DbError(e as Error);
  } finally {
    client.release();
  }
}

export async function rpc<T = unknown>(userId: string, fn: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await as<{ r: T }>(userId, `select public.${fn}(${placeholders}) as r`, args);
  return rows[0].r;
}

export async function expectError(p: Promise<unknown>, match: string | RegExp) {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (typeof match === "string" ? msg.includes(match) : match.test(msg)) return e as DbError;
    throw new Error(`Expected error matching ${match}, got: ${msg}`);
  }
  throw new Error(`Expected error matching ${match}, but call succeeded`);
}

export const uuid = randomUUID;

export interface Fixture {
  owner: { id: string; email: string };
  orgId: string;
  outletId: string;
  warehouseId: string;
  registerId: string;
  methods: Record<string, string>;
  taxId: string;
}

/** Onboard a fresh business with GST 8% (tax-inclusive pricing) and return its key ids. */
export async function makeBusiness(name = "Test Mart", opts: { inclusive?: boolean } = {}): Promise<Fixture> {
  const owner = await createUser();
  const orgId = await rpc<string>(owner.id, "create_organization", [
    {
      name,
      display_name: "Owner",
      prices_include_tax: opts.inclusive ?? true,
      outlet: { name: "Main", code: "MAIN", island: "Male'" },
      taxes: [
        { name: "GST 8%", rate: 8, is_default: true },
        { name: "Zero rated", rate: 0 },
      ],
    },
  ]);
  const [outlet] = await as<{ id: string; default_warehouse_id: string }>(
    owner.id,
    "select id, default_warehouse_id from outlets where organization_id = $1",
    [orgId],
  );
  const [register] = await as<{ id: string }>(owner.id, "select id from registers where organization_id = $1", [orgId]);
  const pm = await as<{ id: string; kind: string }>(owner.id, "select id, kind from payment_methods where organization_id = $1", [orgId]);
  const [tax] = await as<{ id: string }>(owner.id, "select id from tax_rates where organization_id = $1 and is_default", [orgId]);
  return {
    owner,
    orgId,
    outletId: outlet.id,
    warehouseId: outlet.default_warehouse_id,
    registerId: register.id,
    methods: Object.fromEntries(pm.map((m) => [m.kind, m.id])),
    taxId: tax.id,
  };
}

export async function makeProduct(
  f: Fixture,
  opts: { name?: string; price: string; cost?: string; stock?: number; trackStock?: boolean; barcode?: string },
): Promise<string> {
  const productId = await rpc<string>(f.owner.id, "create_product", [
    {
      organization_id: f.orgId,
      name: opts.name ?? "Item",
      track_stock: opts.trackStock ?? true,
      variants: [
        {
          name: "Default",
          sku: `SKU-${uuid().slice(0, 6)}`,
          retail_price: opts.price,
          cost_price: opts.cost ?? "0",
          barcodes: opts.barcode ? [opts.barcode] : [],
          opening_stock: opts.stock ? [{ warehouse_id: f.warehouseId, qty: opts.stock, unit_cost: opts.cost ?? "0" }] : [],
        },
      ],
    },
  ]);
  const [v] = await as<{ id: string }>(f.owner.id, "select id from product_variants where product_id = $1", [productId]);
  return v.id;
}

export async function openShift(f: Fixture, userId = f.owner.id, float = "500"): Promise<string> {
  return rpc<string>(userId, "open_shift", [f.registerId, float]);
}

export async function stockOf(variantId: string, warehouseId: string): Promise<number> {
  const r = await pool.query("select qty from inventory_balances where variant_id = $1 and warehouse_id = $2", [variantId, warehouseId]);
  return r.rows[0] ? Number(r.rows[0].qty) : 0;
}

/** Invite + accept a staff member with the given system role. */
export async function addStaff(f: Fixture, systemKey: "cashier" | "inventory" | "accountant" | "admin", outletIds: string[] | null = null) {
  const user = await createUser();
  const [role] = await as<{ id: string }>(f.owner.id, "select id from roles where organization_id = $1 and system_key = $2", [
    f.orgId,
    systemKey,
  ]);
  const invId = await rpc<string>(f.owner.id, "invite_staff", [f.orgId, user.email, role.id, outletIds, systemKey]);
  await rpc(user.id, "accept_invitation", [invId]);
  return user;
}
