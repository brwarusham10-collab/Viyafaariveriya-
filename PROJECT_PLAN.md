# VIYAFAARIVERIYAA — Project Plan

Cloud POS and business management for Maldivian retailers. Multi-tenant SaaS on Supabase
(Postgres + Auth + RLS) with a React/TypeScript PWA front end.

Ewity (ewity.com, public feature pages for POS and Inventory & Purchasing) was reviewed as a
functional reference only: split tenders, parked bills, quotations, X/Z shift reports with
denomination counts, refunds against the original bill, weighted-average cost per location,
request→approve→issue→receive transfers, landed-cost allocation, MIRA GST reporting and BML
transfer tracking. No branding, copy, assets or code were reused.

## Architecture decisions

| Area | Decision |
|---|---|
| Tenancy | `organization_id` on every tenant row. RLS `is_org_member()` for reads; writes to financial/stock tables only through `SECURITY DEFINER` RPCs that re-derive the caller from `auth.uid()` and check permissions. Client-supplied org IDs are always re-verified. |
| Roles | Per-org `roles` with a `permissions text[]` drawn from a fixed `permissions` catalog. System roles: owner, admin, cashier, inventory, accountant. Custom roles allowed. Optional per-member outlet restriction. |
| Locations | `outlets` (selling sites) and `warehouses` (stock-holding). Every outlet gets a default warehouse; standalone warehouses are allowed. Stock lives per warehouse. |
| Catalog | `products` (parent) → `product_variants` (sellable SKU; every product has ≥1). Barcodes in `product_barcodes`. Optional per-outlet price overrides. |
| Money | `numeric(14,2)`; quantities `numeric(14,3)`. Half-away-from-zero rounding at line level; cart discount allocated proportionally with the remainder on the last line. Server recomputes every total; client values are previews only. |
| Tax | `tax_rates` per org, no hard-coded rates. Org-wide inclusive/exclusive pricing switch. Tax computed and stored per line. |
| Stock | `inventory_balances` (qty, avg_cost) changed only inside RPCs that also insert an `inventory_movements` row. Row locks (`FOR UPDATE`, ordered) prevent overselling. Weighted average cost; sale lines snapshot `unit_cost`. |
| Checkout | `pos_checkout(payload)` — one transaction: idempotency on `(organization_id, client_uuid)`, open-shift check, price/permission validation, stock locks, server-side invoice number, payments, customer ledger, audit. Retries return the original sale. |
| Sequences | `document_sequences` row per org/outlet/doc type, locked `FOR UPDATE`. |
| Offline | Dexie cache of catalog/price/stock snapshot per device; offline sales queued with client UUIDs and synced through the same idempotent RPC. Electronic tenders are blocked offline except card (recorded as provisional). Conflicts surface in a sync panel. |
| Bank transfers | Recorded with reference, status `pending` until a user with `payments.verify` confirms. No simulated bank confirmation. |

## Phases

- [x] 0. Inspect workspace (empty), review Ewity public pages, write this plan
- [x] 1. Scaffold Vite/React/TS, Tailwind v4, UI kit, brand, routing, auth screens
- [x] 2. Schema + RLS + RPCs (tenancy, catalog, inventory ledger, checkout, refunds, shifts, purchasing, transfers, customers/credit, expenses, reports, audit, platform admin)
- [x] 3. SQL integration tests against local Postgres (Supabase auth shim)
- [x] 4. Onboarding wizard, products/variants, inventory, adjustments, transfers
- [x] 5. POS register: scan/search, variants, discounts, tax, park/recall, quotations, split tender, receipts (58/80mm, A4), PDF
- [x] 6. Sales history, refunds/voids, customers & credit, purchasing & receiving, expenses, shifts (X/Z), reports & exports
- [x] 7. Staff invitations & roles, outlets/registers/warehouses, settings, audit log, platform admin
- [x] 8. Offline catalog cache + sale queue + sync, PWA
- [x] 9. Demo seed (separate script), README, deployment notes, verification

## Verification status (2026-10-24)

| Check | Result |
|---|---|
| `npm run typecheck` / `npm run lint` | clean (0 warnings) |
| `npm test` (unit) | 15 passed |
| `npm run test:db` (Postgres integration, RLS as `authenticated`) | 28 passed |
| `npm run test:e2e` (Playwright, desktop + tablet) | 5 passed |
| `npm run smoke:api` (supabase-js end to end) | passed |
| `npm run build` | passed, PWA generated, no chunk > 500 kB |
| Seeded data consistency | every stock balance = Σ ledger; every completed sale's payments = total |

## Roadmap (not implemented — see README "Not implemented yet")

Batch/expiry/serial allocation on sale, stock counts with count sheets, loyalty points & gift
cards, layaway, recurring expenses, supplier payments ledger, email delivery (needs SMTP),
restaurant/table service, online ordering, payment-gateway or bank API reconciliation,
Dhivehi/RTL strings (i18n structure is in place).

## Design system

- Palette: Reef ink `#0D2B33` (sidebar, totals), Lagoon `#0E8C7F` (primary actions),
  Dhoni saffron `#E9A23B` (attention, pending), Paper `#F4F6F5` (work area), Slate `#2B3A3F` (text),
  Coral `#D9534A` (destructive).
- Type: Bricolage Grotesque (brand, headings, the POS total), Figtree (UI). Tabular figures for money.
- One memorable element: the POS tender panel — a deep reef-ink slab with the large MVR total and a
  torn-receipt edge. Everything else stays quiet: compact tables, hairline borders, restrained radius.
