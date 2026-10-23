# Viyafaariveriyaa

Cloud point of sale and business management for Maldivian retailers. Multi-business SaaS: each business
manages its own outlets, registers, stock, staff and reports, isolated from every other business by
PostgreSQL row-level security.

React 19 + TypeScript + Vite · Tailwind v4 · Supabase (Postgres, Auth, Storage) · TanStack Query ·
Zustand · Dexie (offline) · Recharts · Vitest · Playwright · installable PWA.

---

## Quick start (fully local, no Docker needed)

Requirements: Node 20+, PostgreSQL 15/16 server binaries (`initdb`, `pg_ctl`) and `psql`, `curl`.

```bash
npm install
npm run stack:start          # Postgres :54322 + Supabase Auth + PostgREST + API gateway :54321, runs migrations
npm run stack:seed           # optional demo business (local/demo only)
npm run stack:keys           # prints VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
cp .env.example .env.local   # paste the two values in
npm run dev                  # http://localhost:5173
```

`stack:start` downloads the official Supabase Auth and PostgREST release binaries from GitHub on first
run, so the same `supabase-js` client code runs locally and in production. If you run as root, set
`STACK_RUN_AS=<user>` (Postgres refuses to run as root). Storage and Realtime are not part of the local
stack — receipt/logo uploads need hosted Supabase or `npx supabase start`.

**With Docker** you can use the official CLI instead: `npx supabase start` applies the same
`supabase/migrations`, then load the seed with
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/seed/demo.sql`.

### Demo accounts (after `stack:seed`)

| Email | Role | Notes |
|---|---|---|
| owner@demo.mv | Owner | everything |
| manager@demo.mv | Manager | all permissions except owner-only staff changes |
| cashier@demo.mv | Cashier | Maafushi Main outlet only; no discounts, price overrides, refunds or reports |
| platform@demo.mv | Platform admin | `/admin` only; no access to tenant data |

Password for all: `Demo#2026pos`. The demo business is fictional ("Maafushi Mart (Demo)") with
~30 products, variants, two outlets, a bulk warehouse, suppliers, credit customers, 14 days of sales,
shifts (one with a variance), pending bank transfers, expenses and an in-progress transfer.
**Never run `supabase/seed/demo.sql` against production.**

---

## Deploying

### 1. Supabase project
1. Create a project (region: Singapore is closest to the Maldives).
2. Apply migrations in order: `npx supabase link --project-ref <ref> && npx supabase db push`
   (or paste each file in `supabase/migrations` into the SQL editor, in filename order).
3. Auth → URL configuration: set Site URL to your app URL and add `<app>/reset-password` and
   `<app>/onboarding` to redirect URLs. Configure SMTP so confirmation and reset emails are delivered.
4. Make yourself a platform admin (optional):
   `insert into public.platform_admins (user_id) select id from auth.users where email = 'you@…';`
5. Turn on Point-in-Time Recovery / daily backups (see *Backup and recovery*).

The `org-files` storage bucket and its policies are created by migration `…0800_storage.sql`.

### 2. Vercel
1. Import the repository; framework preset **Vite** (`vercel.json` sets SPA rewrites, security
   headers and caching).
2. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the anon/publishable key).
3. Deploy. The service-role key is never needed by the app and must never be added to a `VITE_` variable.

---

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | type-check + production build (PWA service worker included) |
| `npm run typecheck` / `npm run lint` | TypeScript / oxlint |
| `npm test` | unit tests (money, pricing parity, tenders, CSV, offline queue) |
| `npm run test:db` | database integration tests against `TEST_DATABASE_URL` |
| `npm run test:e2e` | Playwright against a running app with the demo seed (`CHROMIUM_PATH` to use a system Chromium) |
| `npm run smoke:api` | sign-up → onboarding → product → shift → sale through `supabase-js` |
| `npm run verify` | typecheck + lint + unit tests + build |
| `npm run stack:*` | `start`, `stop`, `reset`, `seed`, `keys` for the local stack |

### Test coverage of the critical paths

`tests/db` (28 tests, real Postgres, each call made as the `authenticated` role with JWT claims exactly as
PostgREST does):

- normal checkout: inclusive tax, change, stock deduction, cost snapshot, invoice numbering
- **simultaneous last-unit purchase**: 6 concurrent checkouts for 1 unit → exactly 1 succeeds
- **double-submit / retry**: 3 concurrent submissions of one payload → 1 sale, 1 payment, 1 stock movement
- partial refunds with rounding absorbed by the final unit, over-refund blocked, restock at original cost
- voids restoring stock and store credit; refunds/voids require permission and a reason
- **cash closeout**: X report, cash in/out, denomination count, variance, frozen closed shift, approval
- **tenant isolation**: reads, inserts, updates and RPC calls across businesses all refused
- direct writes to financial tables, balances, ledgers and protected columns refused
- cashier restrictions (price override, discount, credit sale, outlet scope), last-owner protection,
  platform admin separation, suspended businesses
- credit limits and receivables ageing, bank transfers pending until verified
- PO partial receiving with freight allocated into weighted-average cost, transfers, purchase returns,
  shrinkage, all report functions
- server pricing matches the client pricing engine to the laari in both tax modes

`tests/e2e`: a cashier sells by barcode with cash change and receipt (desktop and tablet widths); a new
owner signs up, completes onboarding, creates a product with opening stock and sells it; role gating;
seeded dashboards and reports.

---

## Architecture

```
src/
  app/            auth + organisation context (memberships, permissions, outlets, config)
  components/     UI kit, app shell, receipts, charts, shared pickers/exports
  pages/          one folder per module (pos, sales, products, inventory, purchases, customers, …)
  lib/            money (BigInt laari), pricing engine, errors, dates (Indian/Maldives), exports, i18n
  offline/        Dexie database, sync engine, hooks
supabase/
  migrations/     0001 foundation · 0002 catalog/inventory · 0003 sales/shifts · 0004 purchasing
                  0005 expenses/onboarding/admin · 0006 reports · 0007 RLS & grants · 0008 storage
  seed/demo.sql   demo data (local only)
scripts/local-stack/  Postgres + Supabase Auth + PostgREST runner
tests/db, tests/e2e
```

### Security model

- **Tenant isolation**: every tenant row carries `organization_id`; composite foreign keys
  `(organization_id, id)` make cross-tenant references impossible at the schema level. RLS is enabled
  on every table; reads require membership plus the relevant permission (customer PII needs
  `customers.view`, costs need `reports.financial`/`purchases.view`).
- **Writes**: master data (products, customers, settings) can be written directly, but only whitelisted
  columns (column-level grants) and only with the right permission (RLS). Sales, payments, refunds,
  stock balances and movements, shifts, ledgers and audit logs have **no client write privileges**;
  they change only inside `SECURITY DEFINER` functions that derive the user from `auth.uid()`, re-check
  permissions and outlet access, and never trust a client-supplied organisation id.
- **Prices and totals are computed on the server**. Client totals are previews. A changed price needs
  `pos.price_override`, a discount needs `pos.discount`, credit needs `pos.credit_sale` — all audited.
- **Immutability**: audit logs, stock movements, cash movements and customer ledger rows cannot be updated
  or deleted; payments can only move from `pending` to verified/rejected; closed shifts are frozen;
  document sequences only move forward.
- Roles: Owner, Manager, Cashier, Inventory, Accountant, plus custom roles built from 31 permissions.
  Staff can be limited to specific outlets. Users can belong to several businesses.
- No card data is stored. Bank transfers (BML/MIB) are recorded with the customer's reference and stay
  **pending** until someone with `payments.verify` confirms them against the statement — there is no bank
  integration and the app never claims automatic reconciliation.
- Platform admins (`platform_admins` table) see tenant metadata and aggregates only, and every change
  they make is audit-logged. They have no RLS access to tenant transactions.

When adding migrations: create functions in `public` only when they're meant to be called by the app,
always `revoke execute … from anon`, use `security definer set search_path = ''`, and call
`private.require_perm(...)` first.

### Money, tax and rounding

- Money is `numeric(14,2)` in the database and BigInt laari in the browser — never floating point.
- Quantities are `numeric(14,3)` (weights such as 0.755 kg).
- Rounding: half away from zero, per line. Line discount first, then the cart discount is spread by line
  value with the remainder on the last line, then tax. Inclusive: `tax = amount × r / (100 + r)`;
  exclusive: `tax = amount × r / 100`.
- Tax rates are configured per business (no rate is hard-coded); each sale line stores the rate charged.

### Stock and costing

Balances (`inventory_balances`) are a cache of the immutable ledger (`inventory_movements`) and are only
changed by `private.post_movement`, which locks the balance row and writes the movement in the same
transaction. Checkout locks variants in sorted order, which is deadlock-safe and prevents overselling
(unless the business turns on "allow selling below zero"). Receipts update the weighted-average cost,
including freight, duty and handling allocated by line value; each sale line snapshots its unit cost, so
historical COGS never changes.

### Reporting definitions

| KPI | Definition |
|---|---|
| Gross sales | Σ qty × unit price before discounts (price basis) |
| Discounts | Σ item + cart discounts |
| Sales total | Σ amount charged |
| Refunds | Σ refunds created in the period (voids excluded) |
| Net sales | (sales total − sales tax) − (refunds − refund tax) — excludes tax |
| Orders / AOV | completed sales; sales total ÷ orders |
| COGS | Σ sale line cost snapshots − cost of restocked refunded units |
| Gross profit | net sales − COGS |
| Operating profit | gross profit − expenses dated in the period |

Voided sales are excluded everywhere. Dates are business days in Indian/Maldives time. Expenses are kept
separate from purchases: stock purchases flow into COGS via cost, expenses do not.

### Offline selling — what it does and doesn't do

- Opt-in **per device** ("Allow offline selling on this device" in the register menu). The device then
  keeps a snapshot of the outlet's catalogue, prices and stock in IndexedDB — no customer data.
- Offline, the register shows a banner with the snapshot time; stock may be stale. Only payment types
  marked "allowed offline" (cash, card by default) can be taken. Customers, credit, store credit, bank
  transfers, refunds, quotations and shift changes need a connection.
- Offline sales are queued with a client-generated UUID and submitted through the **same** idempotent
  checkout RPC when back online, so a sale can't be posted twice. Receipts printed offline say
  PROVISIONAL; the invoice number is issued on sync.
- Conflicts (shift closed in the meantime, insufficient stock, price permission) are shown in the
  Offline sales panel. A manager can post to the current shift, retry, accept and record negative stock
  (needs `inventory.adjust`, audited), or discard. Nothing is oversold silently.
- If the connection drops *during* checkout, the cashier can retry safely or keep the sale as an offline
  sale (on enabled devices).
- **Shared-device limits**: signing out removes the cached catalogue but keeps unsynced sales until they
  sync. The browser profile is not encrypted by the app; on shared computers leave offline selling off.

### Localisation

English today. Layout uses logical CSS properties (start/end) so it mirrors for RTL, and `src/lib/i18n.ts`
provides `t()` and `setLocale("dv")` for a future Dhivehi dictionary.

---

## Status

### Implemented and tested
Onboarding wizard · roles and permissions · staff invitations · outlet/register/warehouse management ·
products with variants, variant matrix, barcodes, outlet prices, wholesale/customer-group pricing, CSV
import with validation and preview · stock ledger, reason-coded adjustments, low-stock alerts, transfers
(request → approve → issue → receive) · POS: barcode-first (keyboard-wedge scanners captured globally),
search, categories, favourites, variants, weighed items, line and cart discounts, price overrides,
park/recall, quotations → sale, customer attach, split tender with change, store credit, credit sales with
limits, bank-transfer references, 58/80 mm and A4 receipts, PDF and email-ready receipt, keyboard shortcuts,
mobile/tablet layouts · refunds (partial, restock or write-off, to cash/card/transfer/store credit/account)
and voids · shifts with float, cash in/out, X/Z reports, MVR denomination count, variance and approval ·
purchasing: POs, approval, partial receiving, landed costs, batch/expiry capture, purchase returns,
reorder suggestions, PO PDF · customers: history, lifetime value, statements (PDF), collections, receivables
ageing · expenses with receipt uploads · dashboard and reports (sales over time with prior-period
comparison, breakdowns, top/slow products, inventory valuation, ageing, shrinkage, supplier purchases,
shift closeouts, GST summary) with CSV/XLSX/PDF export · audit log · data export · platform admin ·
dark mode · installable PWA with offline selling.

### Needs external configuration
- **Email delivery** (sign-up confirmation, password reset): configure SMTP in Supabase Auth. Staff
  invitations are created in-app; share the sign-up link — no invitation email is sent.
- **File storage** (logos, expense receipts) needs hosted Supabase Storage or `supabase start`.
- **Receipt email** opens the device's mail app (`mailto:`) with the receipt text; sending directly needs
  an email provider.

### Not implemented yet (roadmap)
- MIRA-specific filing formats. The GST page is a summary of output tax by rate; it has **not** been
  verified against MIRA's current return format, and input tax is not included.
- Batch/expiry/serial allocation at the point of sale (batch and expiry are captured on receipt only),
  stock counts with count sheets, layaway, loyalty points and gift cards, supplier payment ledger,
  recurring expenses, multi-currency selling.
- Payment-gateway or bank API integration (BML/MIB) and any automatic reconciliation.
- Restaurant/table service, online ordering, Realtime-driven live updates between registers.
- Dhivehi translation strings.

---

## Backup and recovery

- **Production**: enable Supabase daily backups and Point-in-Time Recovery (Pro plan and above). Test a
  restore into a branch or new project at least quarterly.
- **Logical backup**: `pg_dump --no-owner --schema=public --schema=private "$DATABASE_URL" > backup.sql`
  (also back up `auth` and `storage.objects` metadata; download the `org-files` bucket separately).
- **Restore drill**: create a fresh project, apply `supabase/migrations`, then restore data with
  `psql -f backup.sql`; verify with `npm run test:db` against a copy, never production.
- Per-business CSV extracts are available to owners under Settings → Data export.
- Financial history is append-only (ledgers, movements, audit), so point-in-time restores can be checked
  for consistency: every `inventory_balances.qty` equals the sum of its movements.
