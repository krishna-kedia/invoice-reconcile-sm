<!-- Last updated: 2026-05-23 (Phase PF dispatched) -->
<!-- Previous: 2026-05-23 (RI-1 + RI-2 done) -->
<!-- Previous: 2026-05-19 18:30 -->

# Execution Plan
## Hotel Invoice Reconciliation App — V1 (Walk-in Invoices)

### Status: V1 BUILD COMPLETE — MMT payout ingestion DONE — MMT Direct Reconcile DONE — Bank Statement View IN PROGRESS — Yatra Reconcile QUEUED — Bank Statement Redesign v2 QUEUED — Phase RI (Report an Issue) DISPATCHING

This document tracks the V1 build. All Phase A (foundations), Phase B (RPC core), and Phase D + E (frontend) work is in place. Phase C (RPC test suite) and Phase F (E2E QA) remain as the next layer.

The most recent slice — **Phase M (MMT Direct Reconcile)** — adds a new reconciliation surface for MMT/Goibibo invoices that talks directly to the existing payout chain. See FR-059..FR-066 in `prd.md`.

Two new work-streams added 2026-05-19:
- **Phase BS-v2** — extends the Bank Statement page with drill-down invoice attribution + per-sub-row status tint, on top of the in-flight BS-Polish work. See FR-087 in `prd.md`.
- **Phase Y-v2** — extends the existing Yatra plan (Y1..Y6) to store ALL JSON fields, drop the `UNIQUE(voucher_no)` constraint, log-and-skip duplicates in the inserter, and add a `v_yatra_monthly_deductions` view. See FR-076 v2 / FR-078 v2 / FR-088 in `prd.md`.

---

## Completed Work

### [2026-05-17 13:30] Phase A1 — Create new tables migration
- Agent: database-manager (executed by PM)
- Migration: `20260517080412_v1_reconciliation_core_tables`
- Outcome: 7 new tables created — `user_profiles`, `cash_payments`, `reconciliation_links`, `approval_requests`, `discrepancies`, `payment_source_config`, `audit_log`. Audit log immutability trigger + revokes installed. `reconciliation_status` column added to `hotel_invoice`.

### [2026-05-17 13:35] Phase A2 — Seed payment_source_config
- Agent: database-manager (executed by PM)
- Migration: `20260517080513_v1_seed_payment_source_config`
- Outcome: 6 default mapping rows inserted.

### [2026-05-17 13:38] Phase A5 — Audit-log helper function
- Agent: database-manager (executed by PM)
- Migration: `20260517080519_v1_audit_helper_function`
- Outcome: `fn_write_audit(...)` available.

### [2026-05-17 13:40] Phase B1 — v_transactions_with_remaining view
- Agent: database-manager (executed by PM)
- Migration: `20260517080532_v1_transactions_with_remaining_view`
- Outcome: Unified view over `upi_transactions`, `card_transactions`, `bank_statement` (credits only), `cash_payments` with `remaining` calculation.
- Hardened later (security_invoker view) — see security migration below.

### [2026-05-17 13:55] Phase A3 — Auth users provisioned
- Agent: backend-dev (executed by PM)
- Migration: `v1_create_initial_users`
- Outcome:
  - Admin: krishnagopal.kedia@optimoloan.com / `AdminPass123!` (user_id `45bcd1e5-…`)
  - Operator: operator@hotel.local / `OperatorPass123!` (user_id `6e50c4f5-…`)
  - Matching `user_profiles` rows with roles.
- Note: passwords are seed defaults; users should reset on first prod use.

### [2026-05-17 14:00] Phase A4 — RLS policies
- Agent: database-manager (executed by PM)
- Migration: `v1_rls_policies`
- Outcome: RLS enabled on all 17 tables. Helper functions `current_user_role()`, `is_admin()`, `is_operator_or_admin()`. Read policies set for both roles where appropriate; operator sees own approval_requests / discrepancies, admin sees all. Direct INSERT/UPDATE/DELETE revoked from authenticated on every sensitive table — all mutations must flow through SECURITY DEFINER RPCs.

### [2026-05-17 14:10] Phase B2 — rpc_reconcile_invoice
- Agent: backend-dev (executed by PM)
- Migration: `v1_rpc_reconciliation_core`
- Outcome: Core ACID reconciliation RPC. Locks source rows, validates remaining, enforces ≤5% overpay rule, requires `confirm_partial`/`confirm_overpay`, creates `discrepancies` on flagged overpay, writes audit. Also includes inline cash-payment creation (E4 done via this path). Helpers `fn_recompute_invoice_status`, `fn_lock_and_get_source_amount`, and `rpc_create_cash_payment` deployed.

### [2026-05-17 14:15] Phase B4 / B5 / B6 / B7 / B8 / B9 — Approval & admin RPCs
- Agent: backend-dev (executed by PM)
- Migration: `v1_rpc_approvals_and_admin`
- Outcome: 9 additional RPCs deployed:
  - `rpc_request_unreconcile_link`, `rpc_request_unreconcile_invoice`, `rpc_request_cash_edit`, `rpc_request_cash_delete` (B4)
  - `rpc_approve_request`, `rpc_reject_request` (B5)
  - `rpc_admin_reverse_reconciliation` (B6)
  - `rpc_resolve_discrepancy` (B7)
  - `rpc_upsert_payment_source_config` (B8)
  - `rpc_admin_home_summary` (B9)
- All run as SECURITY DEFINER, role-checked, audit-logged.

### [2026-05-17 14:20] Phase D1 — Next.js scaffold
- Agent: frontend-dev (executed by PM)
- Outcome: `frontend/` initialized via `create-next-app` (TypeScript, Tailwind, App Router, `src/`). Added `@supabase/supabase-js`, `@supabase/ssr`, `@tanstack/react-query`, `zod`, `date-fns`, `react-hook-form`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. `.env.local` populated with project URL + publishable key.

### [2026-05-17 14:22] Phase D2 — Supabase client wrappers
- Agent: frontend-dev (executed by PM)
- Outcome: `src/lib/supabase/{client,server,middleware}.ts` using `@supabase/ssr`. Shared domain types in `src/lib/types.ts`.

### [2026-05-17 14:24] Phase D3 — Auth pages + middleware
- Agent: frontend-dev (executed by PM)
- Outcome:
  - `/login` page (email/password) with role-based redirect.
  - `src/middleware.ts` enforces auth and blocks operators from `/admin/*`.
  - `LogoutButton` in shell header.

### [2026-05-17 14:26] Phase D4 — App shell
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/layout.tsx` with role-aware top header and left nav. Designer-friendly Tailwind + shadcn-style primitives (`Button`, `Input`, `Card`, `Badge`, `Table`, `Select`, `Label`, `Dialog`, `Toast`, `Textarea`).

### [2026-05-17 14:28] Phase E1 — Invoice list page
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/invoices/page.tsx` with tabs (walk-in / OTA), filters (status, date range, guest, amount), server-side pagination (50/page), status badges, click-through to detail.

### [2026-05-17 14:30] Phase E2 + E3 + E4 — Invoice detail + Add Payment + Cash
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/invoices/[id]/page.tsx` (server) + `detail-client.tsx` (client). Shows all invoice fields, outstanding, linked payments table, Add-Payment panel with method/date selector + transaction picker (greyed-out rows for remaining=0, click-to-pick modal with smart default), Linked-payments-this-session list, single Save Reconciliation that handles partial / overpay confirmation dialogs. Cash sub-component included via inline-cash path of the RPC. Audit trail collapsible at the bottom.

### [2026-05-17 14:32] Phase E5 — Admin Home
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/admin/page.tsx`. Tiles for unreconciled count/amount, status breakdown, aging buckets, cash vs digital (30d), pending approvals, flagged discrepancies, last-20 audit. Sourced from `rpc_admin_home_summary`.

### [2026-05-17 14:33] Phase E6 — Approvals
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/admin/approvals/page.tsx`. Pending/decided tabs, approve/reject drawer, reject-note required, payload preview.

### [2026-05-17 14:34] Phase E7 — Discrepancies
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/admin/discrepancies/page.tsx`. Table + drawer with Mark Resolved (note) and Reverse Reconciliation (note) actions.

### [2026-05-17 14:35] Phase E8 — Audit Log
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/audit/page.tsx`. Filters by action prefix, entity type, date range. Row expansion shows side-by-side before/after JSON.

### [2026-05-17 14:35] Phase E9 — Payment Source Config
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/admin/settings/payment-sources/page.tsx`. Method × source-table matrix with per-method Save via `rpc_upsert_payment_source_config`.

### [2026-05-17] MMT-1 — Schema migration for MMT payouts
- Agent: database-manager (executed by PM)
- Migration: `mmt_payouts_and_bookings_payout_tables` (Supabase MCP)
- Outcome: `mmt_payouts` (PK `transaction_no`, FK to `files`) and `mmt_bookings_payout` (FK to `mmt_payouts(transaction_no)` ON DELETE CASCADE, `UNIQUE(transaction_no, booking_id)`). Indexes on `file_id`, `transaction_date`, `subject_ref`, `booking_id`, `check_in`, `check_out`. RLS explicitly disabled — pipeline tables, consistent with the rest of the OCR-side schema.

### [2026-05-17] MMT-2 — JSON ingestion pipeline build
- Agent: backend-dev (executed by PM)
- Files added: `src/processors/json_processor.py`, `src/database/mmt_payout_inserter.py`.
- Files modified: `src/processors/factory.py`, `src/database/client.py`, `src/main.py`, `src/drive/client.py`, `src/drive/discovery.py`, `src/database/table_manager.py`, `src/config/loader.py`, `config.yaml`, `.env`.
- Outcome:
  - New `mmt_payout` document type wired in `config.yaml` (`json_direct_insert: true`, `file_types: [json]`, drive folder `MMT_PAYOUTS=1fhefZhFL81mth-UyeZonug0cfVxUX5-p`).
  - `JsonProcessor` registered first in factory routing; handles UTF-8 BOM and raises on malformed JSON.
  - `insert_mmt_payout_json(file_id, parsed_json)` performs an idempotent insert of the payout + bookings using a pre-check + `ON CONFLICT`-safe per-row fallback for race conditions.
  - `main.py` `json_direct_insert` branch added; on success → file `completed`; on any exception → file `failed`.
  - Drive list query now ORs MIME + name filters so JSON files uploaded as `text/plain` are still picked up.
  - End-to-end dry-run against live Supabase (`9999999999-TEST` row, then cleaned up) PASSED: run 1 inserted; run 2 was idempotent.

### [2026-05-17 21:35] Phase M — MMT Direct Reconcile

#### M1 — Schema additions
- Agent: database-manager (executed by PM)
- Migration: `mmt_direct_reconcile_schema`
- Outcome:
  - `mmt_invoice` + `mmt_bookings_payout` each gained `reconciled_at TIMESTAMPTZ NULL` and `reconciled_link_id UUID NULL REFERENCES reconciliation_links(id) ON DELETE SET NULL`.
  - `reconciliation_links.payment_method` and `payment_source_config.payment_method` CHECK constraints extended to include `'mmt_payout'`.
  - Seeded `payment_source_config` with `('mmt_payout','bank_statement', true)`.
  - `trg_mmt_clear_reconciled_at_on_link_delete` AFTER DELETE trigger on `reconciliation_links` clears both back-pointers when a link is removed, automatically making the booking available again.
  - Partial indexes `idx_mmt_invoice_unreconciled` and `idx_mmt_bookings_payout_unreconciled` for fast dropdown queries.

#### M2 — RPCs
- Agent: backend-dev (executed by PM)
- Migrations: `mmt_direct_reconcile_rpcs`, `mmt_direct_reconcile_rpcs_role_guard_fix`
- Outcome: 5 new RPCs deployed, all SECURITY DEFINER, all role-checked, all audit-logged:
  - `rpc_get_mmt_reconcile_candidates(p_hotel_invoice_id uuid)` — FR-061
  - `rpc_get_mmt_reconcile_detail(p_booking_id text)` — FR-062 (sentinels: MMT_INVOICE_NOT_FOUND, MMT_PAYOUT_NOT_FOUND, MMT_PAYOUT_AMBIGUOUS, MMT_BANK_NOT_FOUND, MMT_BANK_AMBIGUOUS)
  - `rpc_update_mmt_invoice_fields(p_id uuid, p_fields jsonb)` — FR-063
  - `rpc_update_mmt_bookings_payout_fields(p_id uuid, p_fields jsonb)` — FR-064
  - `rpc_reconcile_mmt_invoice(p_hotel_invoice_id, p_mmt_invoice_id, p_mmt_bookings_payout_id, p_bank_statement_id, p_confirm_partial, p_confirm_overpay)` — FR-065 (re-uses partial/overpay sentinel pattern)
- Smoke-test (as authenticated operator): SUCCESS on booking `NH12101480322876`. Detail RPC returned computed_payable=3999.60, payout_payable=4000.00, diff=-0.40, match_within_tolerance=true, bank deposit ₹4000 with ₹4000 remaining.

#### M3 — Frontend MmtReconcilePanel
- Agent: frontend-dev (executed by PM)
- Files added: `frontend/src/app/(app)/invoices/[id]/mmt-reconcile-panel.tsx`
- Files modified: `frontend/src/lib/types.ts` (new `mmt_payout` PaymentMethod + 5 new MMT types), `frontend/src/app/(app)/invoices/[id]/detail-client.tsx` (conditional render under AddPaymentPanel for MakeMyTrip/Goibibo sources).
- Outcome: `npm run build` clean (13 routes), `tsc --noEmit` clean. UI implements:
  - Booking dropdown (unreconciled candidates, default-selected if match found)
  - Inline-editable line items on both sides (debounced commit on blur via update RPCs)
  - Live "match within ₹1" indicator
  - Bank statement callout with remaining preview
  - Reconcile button gated by match + bank-row sufficient remaining
  - Partial/Overpay sentinel handling identical to AddPaymentPanel
  - All 5 friendly error states (MMT_INVOICE_NOT_FOUND, MMT_PAYOUT_NOT_FOUND, MMT_PAYOUT_AMBIGUOUS, MMT_BANK_NOT_FOUND, MMT_BANK_AMBIGUOUS)

### [2026-05-17 14:35] Security hardening
- Agent: database-manager (executed by PM)
- Migration: `v1_security_hardening`
- Outcome:
  - `v_transactions_with_remaining` rebuilt as `security_invoker = true` so RLS on base tables applies.
  - Revoked EXECUTE on internal helpers (`fn_write_audit`, `fn_lock_and_get_source_amount`, `fn_recompute_invoice_status`) from anon/authenticated to prevent direct REST access; RPCs still call them (owner has rights).
  - `current_user_role()`, `is_admin()`, `is_operator_or_admin()` no longer callable by `anon`.
  - Older trigger functions now have immutable `search_path`.

---

## In Progress

### Phase BS — Bank Statement View (FR-067..FR-074)

- BS-1 RPCs: DONE — migration `bank_statement_view_rpcs` applied. Both `rpc_get_bank_statement_view` and `rpc_get_bank_statement_drilldown` deployed, smoke-tested as operator. Card-settlement drill on `28e7940c-…` (₹82402.16) returned 5 transactions with `net_after_mdr` computed correctly (e.g., ₹4095 × 0.985 = ₹4033.58). MMT drill on `d32e08ce-…` returned 2 bookings linked by `transaction_no` substring match.
- BS-2 frontend: DONE — `bank-statement/page.tsx` + `bank-statement-client.tsx` + `DrillDown` component; nav entry added for both roles; `xlsx@0.18.5` installed; `BankStatementRow` / drill types added to `lib/types.ts`. `npm run build` clean (14 routes, `/bank-statement` 6.62 kB), `tsc --noEmit` clean.
- BS-3 QA: PENDING — needs manual click-through as both operator and admin.

Sequence: BS-1 (RPCs) → BS-2 (frontend page + nav) → BS-3 (QA).

### Phase BS-Polish — Bank Statement Visual Polish (no FR; UX refinement)
Target repo: `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-frontend` (Next.js app at `frontend/`).

Scope (locked with user 2026-05-19):
1. Drop `max-w-7xl` from both the header and main container in `frontend/src/app/(app)/layout.tsx` so all pages go full-width. Keep horizontal padding/spacing tasteful.
2. Polish the Method and Drill-down filter controls on `/bank-statement` so they look consistent with the date/text/amount inputs above them. Behaviour stays multi-select; designer picks final treatment (polished chip row OR popover trigger with checkbox list).
3. Add row tint, computed once per `bank_id` from the sum of `amount_applied` across all splits of that `bank_id`:
   - sum === 0 → no tint
   - sum within ₹1 of `deposit_amt` → pastel green
   - 0 < sum < deposit_amt → pastel yellow
4. Make the whole row clickable to expand the drill-down (only where `canExpand`). `stopPropagation` on the invoice `<Link>` so it still navigates to `/invoices/[id]`. `cursor-pointer` + subtle hover bg on clickable rows. Keep chevron as visual cue.
5. Remove the amber left-border on unreconciled rows; tint is the single status signal.
6. All split rows of the same `bank_id` share the same tint (computed at the `bank_id` level, applied to every row in the group).

- BS-Polish-1 designer spec: IN PROGRESS — designer agent to produce exact Tailwind classes for tints (must compose with `<TR>`'s `hover:bg-muted/30`), the chosen filter-control treatment, clickable-row hover/cursor styling, and full-width container padding.
- BS-Polish-2 implementation: QUEUED — frontend-dev applies the spec in `layout.tsx` and `bank-statement-client.tsx`.
- BS-Polish-3 QA: QUEUED — manual click-through plus quick visual check that no other page broke from `max-w-7xl` removal.

DB join paths verified live (2026-05-18):
- `upi_transactions.card_settlement_id` → `card_settlement.id` (NOT NULL, FK present).
- `card_transactions.card_settlement_id` → `card_settlement.id` (NOT NULL, FK present).
- `card_settlement.card` and `.upi` are NULL for all 44 existing rows — settlement type is classified via `bank_statement.narration` substring instead.
- Bank↔settlement amount match: `bank_statement.deposit_amt = card_settlement.net_amount` AND `card_settlement.mpr_date BETWEEN bank_statement.date - 3 days AND bank_statement.date` (observed 0–2 day gap; 3-day window for safety).
- `bank_statement` has 110 deposit rows and 51 withdrawal rows (2026-04-01 to 2026-05-16).

### Phase M — MMT Direct Reconcile (FR-059..FR-066)
- M1 schema migration: DONE — `mmt_direct_reconcile_schema`.
- M2 RPCs: DONE — `mmt_direct_reconcile_rpcs` + `mmt_direct_reconcile_rpcs_role_guard_fix` (NULL-safe role guards).
- M3 frontend: DONE — `MmtReconcilePanel` component + integrated into `detail-client.tsx`. `npm run build` clean, `tsc --noEmit` clean.
- M4 QA: PENDING — needs a manual click-through against a real MMT invoice with booking_id present in `mmt_invoice` (e.g. `NH12101480322876`). Smoke test via SQL has already proven: candidates RPC works, detail RPC returns correct computed payable + bank match + remaining for booking `NH12101480322876` (computed ₹3999.60, payable ₹4000, diff -₹0.40, match within tolerance, bank chq_ref `0000001598568899` with ₹4000 deposit and ₹4000 remaining).

---

## Up Next (sequenced)

> Newly inserted 2026-05-19: **Phase BS-v2** (drill-down attribution + sub-row tint) and **Phase Y-v2** (full-JSON schema + log-and-skip inserter + Yatra deductions view). Sequence is documented below; the previously-queued Y1..Y6 blocks are amended in place to incorporate the v2 spec.

---

### BS-v2-1 — Backend: extend drill-down RPC with `reconciled_invoices` + `applied_total` per sub-row
- Agent: database-manager
- Priority: High
- Depends on: BS-1 (DONE), BS-Polish-1/2 (parallel-safe — pure server-side addition)
- Repo (cwd): `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm` (Supabase MCP)
- Migration name: `bank_statement_drilldown_attribution_v2`
- FR reference: FR-087.
- Instructions:
  1. Replace `rpc_get_bank_statement_drilldown(p_bank_statement_id uuid, p_drill_type text) RETURNS jsonb` so each sub-row in the returned array additionally includes:
     - `reconciled_invoices`: `jsonb` array of `{hotel_invoice_id, invoice_number, amount_applied}` — one entry per `reconciliation_links` row whose `source_table`+`source_id` matches the sub-row's identity. For MMT and Yatra drill types, also follow the back-pointer chain (`reconciled_link_id` on `mmt_bookings_payout` / `yatra_bookings_payout` → `reconciliation_links.id`).
     - `applied_total`: `numeric` — sum of those amounts, NULL when empty.
     - `base_amount`: `numeric` — per FR-087:
       - UPI: `upi_transactions.amount`
       - Card: `gross_amount × (1 − mdr_percent/100)`
       - MMT: `mmt_bookings_payout.payable`
       - Yatra: `yatra_bookings_payout.yatra_to_pay_hotel`
  2. Preserve existing columns (no breaking change for any frontend consumer that already works).
  3. Keep SECURITY DEFINER + role guard + no audit write (read-only).
  4. SQL smoke tests:
     - UPI drill on a settlement row known to contain at least one reconciled UPI transaction (use existing settlement `d4bb2dbd-…`) — verify `reconciled_invoices` is non-empty for that sub-row.
     - Card drill on `28e7940c-…` — verify reconciled vs unreconciled sub-rows return different `reconciled_invoices` shapes.
     - MMT drill on `d32e08ce-…` — verify the reconciled booking (`NH12101480322876`) shows the linked invoice while the other booking in the same payout shows `reconciled_invoices: []`.
- Done when: migration applied, advisors clean, all 3 SQL smoke tests pass, returned shape documented in the RPC comment block.

### BS-v2-2 — Frontend: drill-down "Reconciled To" column + sub-row tints
- Agent: frontend-dev
- Priority: High
- Depends on: BS-v2-1, BS-Polish-2 (so the tint classes already exist in `bank-statement-client.tsx`)
- Repo (cwd): `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-frontend`
- Files to modify:
  - `frontend/src/lib/types.ts` — extend `BankStatementDrillUpi`, `BankStatementDrillCard`, `BankStatementDrillMmt`, `BankStatementDrillYatra` (the latter from Y5) with `reconciled_invoices: Array<{ hotel_invoice_id: string; invoice_number: string; amount_applied: number }>`, `applied_total: number | null`, `base_amount: number`.
  - `frontend/src/app/(app)/bank-statement/bank-statement-client.tsx` — update the `DrillDown` component:
    - Add a "Reconciled To" column to each drill table (last column before any future actions column).
    - When a sub-row has `reconciled_invoices.length > 1`, render one row per invoice with the remaining columns repeated in `text-muted-foreground` — mirror the main row-splitting visual pattern from FR-068.
    - For each invoice entry render a `<Link href={"/invoices/" + id} onClick={(e) => e.stopPropagation()}>` showing `invoice_number`.
    - Compute the sub-row tint from `applied_total` vs `base_amount` using the same Tailwind classes the BS-Polish designer spec produced for the main rows (pastel green / pastel yellow / none). Tolerance ₹1 for green.
    - When `reconciled_invoices` is empty render `—` and no tint.
- Behaviour:
  - Sub-row clicks do nothing (only the outer parent row is clickable per BS-Polish point 4).
  - The invoice link is the only clickable element inside a sub-row; `e.stopPropagation()` is mandatory.
- Done when: `npm run build` and `tsc --noEmit` both clean; a manual click-through shows the new column populated correctly on UPI / Card / MMT drills (Yatra will light up once Y4/Y5 land).

### BS-v2-3 — QA: drill-down attribution + tints
- Agent: qa
- Priority: High
- Depends on: BS-v2-2
- Instructions:
  - For each drill type with real data, expand and verify the "Reconciled To" column renders the expected invoice link (or `—`).
  - Verify a split sub-row (one transaction → multiple invoices) renders multiple drill rows with the muted-secondary visual.
  - Verify the green tint appears only when `applied_total ≈ base_amount` (±₹1).
  - Verify the yellow tint appears only when `0 < applied_total < base_amount`.
  - Verify the invoice link `stopPropagation` works (clicking it navigates, does NOT toggle the parent row).
  - Confirm backend overpayment guard (BR-038): attempt via SQL to insert a `reconciliation_links` row that would push `sum(amount_applied)` over `bank_statement.deposit_amt` — expect rejection.
- Done when: matrix below ticks all green; no regressions on existing BS-Polish behaviour.

---

### Y1 — Schema: `yatra_bookings_payout` table (v2 with all JSON fields, no UNIQUE constraint)
- Agent: database-manager
- Priority: High
- Depends on: existing schema only
- Repo (cwd): `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm` (Supabase MCP)
- Migration name: `yatra_bookings_payout_v2_schema`
- FR reference: FR-076 v2, FR-077.
- Instructions:
  1. Create `yatra_bookings_payout` table per FR-076 v2 schema:
     - Base fields: `id`, `file_id`, `voucher_no`, `booking_id`, `guest_name`, `hotel_name`, `check_in`, `check_out`, `booking_date`, `is_pre_pay`, `email_date`, `exported_at`, `reconciled_at`, `reconciled_link_id`, `created_at`.
     - Commercials (base): `total_tariff`, `service_tax`, `yatra_commission_pct`, `yatra_commission_amt`, `tds_pct`, `tds_amt`, `gst_on_commission`, `yatra_to_pay_hotel`.
     - Guest contact: `guest_email`, `guest_phone`.
     - Extended booking context: `number_of_rooms`, `adults`, `children`, `room_name`, `room_type`, `rate_plan_type`.
     - Extended commercials: `other_charges`, `hotel_gross_charges`, `yatra_commission_with_gst`, `tcs_amt`.
     - Provenance: `raw_json`, `source_file_name`, `drive_file_id`, `parsed_at`.
     - **NO `UNIQUE (voucher_no)` constraint.**
  2. Indexes: `voucher_no`, `lower(guest_name)`, `email_date`, partial index on `(voucher_no) WHERE reconciled_at IS NULL`.
  3. RLS DISABLED on the table (pipeline pattern, same as `mmt_bookings_payout`).
  4. CREATE TRIGGER `trg_yatra_clear_reconciled_at_on_link_delete` AFTER DELETE on `reconciliation_links` (per FR-077). The MMT trigger already exists; this one operates on the Yatra table.
- Done when: migration applied; advisors clean; an SQL smoke insert + SELECT confirms all 30+ columns exist with correct types.

### Y2 — Backend: Yatra JSON ingester (log-and-skip duplicates)
- Agent: backend-dev
- Priority: High
- Depends on: Y1
- Repo (cwd): `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm`
- FR reference: FR-078 v2.
- Files to add:
  - `src/database/yatra_payout_inserter.py` — `insert_yatra_payout_json(file_id, parsed_json)`:
    1. Map JSON fields to all schema columns (commercials, booking, guest, room data, raw envelope).
    2. Pre-insert duplicate check: `SELECT id FROM yatra_bookings_payout WHERE voucher_no = $1 LIMIT 1`.
    3. If duplicate: `logger.warning("yatra_payout: duplicate voucher_no=%s already present (existing_id=%s, file_id=%s) — skipping", ...)` and return `None` (caller marks file `completed`).
    4. Otherwise: plain `INSERT` (no `ON CONFLICT`). Store the entire incoming envelope in `raw_json`.
    5. Return new row id.
- Files to modify:
  - `src/processors/factory.py` — register `yatra_payout` document type → existing `JsonProcessor`.
  - `src/database/client.py` — wire the new inserter into the `json_direct_insert` dispatch (parallel to `insert_mmt_payout_json`).
  - `src/main.py` — `json_direct_insert` branch for `yatra_payout` (success → file `completed`; exception → file `failed`).
  - `src/database/table_manager.py` — register `yatra_bookings_payout`.
  - `config.yaml`:
    ```yaml
    yatra_payout:
      json_direct_insert: true
      file_types: [json]
      drive_folder_env: YATRA_PAYOUTS
      fields: []
    ```
  - `.env.example` — add `YATRA_PAYOUTS=<drive_folder_id>` documentation. Real value (`11VRWMBTfYJY10s9kXTKm-wq0Yq6QjnL1`) goes into `.env` only.
- Idempotency contract: running the pipeline twice over the same JSON produces one row + one warning log line; file is marked `completed` both times.
- Done when:
  - End-to-end dry-run against a synthetic Yatra JSON inserts exactly one `yatra_bookings_payout` row populated across all 30+ columns.
  - Re-running the same file logs the duplicate warning, inserts nothing, file → `completed`.
  - Malformed JSON path correctly marks the file `failed`.

### Y3 — RPCs: candidates / detail / field-edit / atomic reconcile (4 RPCs)
- Agent: backend-dev (executed by PM)
- Priority: High
- Depends on: Y1
- Migration name: `yatra_payout_reconcile_rpcs`
- Instructions: One migration defining four RPCs, all `SECURITY DEFINER`, all role-checked via `current_user_role()` (operator or admin), `GRANT EXECUTE TO authenticated`:
  1. `rpc_get_yatra_reconcile_candidates(p_hotel_invoice_id uuid) RETURNS jsonb` — FR-079. Returns `default_voucher_no` (lowercased exact guest-name match, NULL if no match) and `available_vouchers` array (unreconciled rows, ordered with default first, then by `email_date DESC NULLS LAST, created_at DESC`). No audit write.
  2. `rpc_get_yatra_reconcile_detail(p_voucher_no text) RETURNS jsonb` — FR-080. Returns the full `yatra_bookings_payout` row plus `is_already_reconciled` and `linked_invoice_id` / `linked_invoice_number` when applicable. Sentinel `YATRA_VOUCHER_NOT_FOUND` for missing voucher. No audit write.
  3. `rpc_update_yatra_bookings_payout_fields(p_id uuid, p_fields jsonb)` — FR-081 v2. Whitelisted editable fields: all eight base commercials + the four extended commercials (`other_charges`, `hotel_gross_charges`, `yatra_commission_with_gst`, `tcs_amt`) + booking context fields (`guest_name`, `guest_email`, `guest_phone`, `hotel_name`, `check_in`, `check_out`, `booking_date`, `is_pre_pay`, `email_date`, `number_of_rooms`, `adults`, `children`, `room_name`, `room_type`, `rate_plan_type`). Explicitly NOT editable: `voucher_no`, `file_id`, `exported_at`, `reconciled_at`, `reconciled_link_id`, `id`, `created_at`, `raw_json`, `source_file_name`, `drive_file_id`, `parsed_at`. Sentinel `YATRA_PAYOUT_LOCKED` if `reconciled_at IS NOT NULL`. Writes audit row `action='yatra_bookings_payout.update'` with before/after JSON.
  4. `rpc_reconcile_yatra_invoice(p_hotel_invoice_id uuid, p_yatra_bookings_payout_id uuid, p_source_table text, p_source_id uuid, p_payment_method text, p_amount_applied numeric, p_confirm_partial bool, p_confirm_overpay bool) RETURNS jsonb` — FR-082. Atomic. Re-uses `fn_lock_and_get_source_amount`, `fn_recompute_invoice_status`, `fn_write_audit`. Enforces source/method scoping, the 5% overpay rule, the partial/overpay sentinel pattern, and rejects `p_payment_method='cash'` via `YATRA_CASH_NOT_ALLOWED`. Inserts ONE `reconciliation_links` row carrying the **real underlying method**, then sets `yatra_bookings_payout.reconciled_at = now(), reconciled_link_id = <new>`. Audit `action='reconcile.create.yatra'`.
- Smoke tests required: happy path (insert a test invoice + voucher, reconcile against a synthetic UPI transaction, verify all back-pointers), each error sentinel (`YATRA_VOUCHER_NOT_FOUND`, `YATRA_PAYOUT_LOCKED`, `YATRA_CASH_NOT_ALLOWED`, `PARTIAL_CONFIRMATION_REQUIRED`, `OVERPAY_CONFIRMATION_REQUIRED`).
- Done when: all 4 RPCs deployed, all 5 smoke tests pass, audit rows produced for every mutation.

### Y4 — Frontend: `YatraReconcilePanel` + detail-client integration + types
- Agent: frontend-dev (executed by PM)
- Priority: High
- Depends on: Y3
- Repo (cwd): `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-frontend` (Next.js app at `frontend/`)
- Files to add:
  - `frontend/src/app/(app)/invoices/[id]/yatra-reconcile-panel.tsx` — implements FR-083 (two-column layout, searchable voucher dropdown, editable commercials, standard transaction picker scoped to UPI/Card/BankTransfer, sentinel handling).
- Files to modify:
  - `frontend/src/app/(app)/invoices/[id]/detail-client.tsx` — render `<YatraReconcilePanel />` below `<AddPaymentPanel />` and below `<MmtReconcilePanel />` when `inv.source.toLowerCase().includes('yatra')`.
  - `frontend/src/lib/types.ts` — add `YatraBookingPayout`, `YatraReconcileCandidates`, `YatraReconcileDetail`, `YatraUpdatableFields` types. **DO NOT** add a `'yatra_payout'` to `PaymentMethod` (Option B keeps it out of the enum).
- Behaviour:
  - Searchable dropdown of unreconciled vouchers, auto-defaulted by guest-name match.
  - Eight editable commercials fields with 400ms debounced commit via `rpc_update_yatra_bookings_payout_fields`. Refetch detail after each successful edit so the "amount to apply" indicator updates.
  - Right side: standard transaction picker. Method dropdown limited to `upi`, `card`, `bank_transfer` (Cash hidden). Date input pre-suggests `email_date` ±3 days.
  - "Reconcile" button gated by: voucher selected, transaction picked, transaction remaining ≥ `yatra_to_pay_hotel` (or partial-confirm path).
  - Handle all sentinels with friendly UI: `YATRA_VOUCHER_NOT_FOUND` (amber), `YATRA_PAYOUT_LOCKED` (red), `YATRA_CASH_NOT_ALLOWED` (red — should be impossible from UI but defensive), `PARTIAL_CONFIRMATION_REQUIRED` / `OVERPAY_CONFIRMATION_REQUIRED` (existing dialog pattern).
  - After successful Reconcile: collapse panel, re-fetch parent invoice. The new row appears in the Linked Payments table with the real method (e.g., `upi`).
- Done when:
  - `npm run build` clean.
  - `tsc --noEmit` clean.
  - Manual click-through reaches success on a synthetic Yatra invoice + voucher.
  - All five sentinels render correctly.

### Y5 — Bank Statement View drill-down: Yatra extension (FR-085)
- Agent: backend-dev + frontend-dev (executed by PM)
- Priority: Medium
- Depends on: Y3 (RPCs in place so a Yatra-reconciled link can exist)
- Backend changes:
  - Extend `rpc_get_bank_statement_view` to detect `drill_type='yatra_payout'` for any `bank_statement` row that has a `reconciliation_links` row whose `id` is the `reconciled_link_id` of some `yatra_bookings_payout` row. Add `yatra_count` to the per-row drill summary.
  - Extend `rpc_get_bank_statement_drilldown(p_bank_statement_id uuid, p_drill_type text)` to handle `p_drill_type='yatra_payout'`. Return rows: `{voucher_no, guest_name, hotel_name, yatra_to_pay_hotel, hotel_invoice_id, hotel_invoice_number}`.
- Frontend changes (in `frontend/src/app/(app)/bank-statement/bank-statement-client.tsx` and `DrillDown` component):
  - Add a `yatra_payout` branch to the drill-down renderer with columns: voucher_no, guest_name, hotel_name, `yatra_to_pay_hotel` (formatted ₹), and a clickable "Hotel invoice" link.
  - Update `BankStatementRow.drill_type` typing and the filter-bar multi-select to include `yatra_payout`.
  - Update types in `frontend/src/lib/types.ts` (`BankStatementDrillYatra`).
- Done when: a Yatra-reconciled bank row shows the chevron, expanding reveals the voucher + guest + hotel + amount with the invoice link working; `npm run build` clean; `tsc --noEmit` clean.

### Y6 — MIS report + QA (FR-086 + end-to-end)
- Agent: database-manager + qa (executed by PM)
- Priority: Medium
- Depends on: Y3, Y5
- Sub-tasks:
  1. **MIS view update** (database-manager):
     - Drop + recreate `v_mis_monthly_summary` and `v_mis_payment_detail` (or add a sibling view `v_mis_yatra_monthly`) so Yatra appears as a distinct source breakdown alongside MakeMyTrip, Goibibo, Walk-in, BookingDotCom. Classification rule: `source ILIKE '%Yatra%'` OR linked via `yatra_bookings_payout.reconciled_link_id`.
     - Run `mcp__supabase__get_advisors` after the change.
  2. **QA sweep** (qa agent):
     - Walk all 6 documented panel states (no voucher selected, YATRA_VOUCHER_NOT_FOUND, locked edit, cash rejected, partial confirm, overpay confirm, success).
     - Verify audit rows: `reconcile.create.yatra`, `yatra_bookings_payout.update`.
     - Verify un-reconcile via `rpc_admin_reverse_reconciliation` clears `yatra_bookings_payout.reconciled_at` via the new trigger.
     - Verify Linked Payments table shows method as `upi`/`card`/`bank_transfer` (NOT `yatra_payout`) and the Yatra context is reachable via the back-pointer.
     - Verify Bank Statement View drill-down (Y5) on a Yatra-reconciled row.
     - Verify MIS report shows Yatra as a separate row in the source breakdown.
     - Verify idempotency: re-ingest the same JSON file → no duplicate row, file → `completed`.
- Done when: matrix below ticks all states green; MIS view shows Yatra row; advisors clean.

### Y7 — `v_yatra_monthly_deductions` view + dashboard tab
- Agent: database-manager + frontend-dev
- Priority: Medium
- Depends on: Y1 (schema in place)
- FR reference: FR-088.
- Sub-tasks:
  1. **DB view** (database-manager, migration `v_yatra_monthly_deductions`):
     - Create `v_yatra_monthly_deductions` (`SECURITY INVOKER` view) aggregating `yatra_bookings_payout` rows where `reconciled_at IS NOT NULL`, grouped by `(date_trunc('month', email_date), hotel_name)`. Columns: `year`, `month`, `hotel_name`, `bookings_count`, `total_tariff_sum`, `service_tax_sum`, `yatra_commission_amt_sum`, `tds_amt_sum`, `gst_on_commission_sum`, `yatra_to_pay_hotel_sum`, `other_charges_sum`, `hotel_gross_charges_sum`, `yatra_commission_with_gst_sum`, `tcs_amt_sum`.
     - If RLS blocks operator/admin SELECT, wrap with `rpc_get_yatra_monthly_deductions()` SECURITY DEFINER per the existing MMT pattern.
     - Run `mcp__supabase__get_advisors` after the change.
  2. **Frontend tab** (frontend-dev):
     - Add a Yatra tab/filter alongside the existing MMT deductions table on the dashboard page.
     - Columns: month, hotel, bookings, total tariff, commission (with GST), TDS, GST on commission, TCS, net to hotel.
     - Reuse the existing MMT dashboard styling.
- Done when: view returns rows for any reconciled Yatra payout; dashboard shows the Yatra tab populated; build clean.

---

### BS-Polish-1 — Designer spec for Bank Statement polish
- Agent: designer
- Priority: High
- Depends on: nothing
- Repo (cwd): `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-frontend`
- Files to study: `frontend/src/app/(app)/layout.tsx`, `frontend/src/app/(app)/bank-statement/bank-statement-client.tsx`, `frontend/src/app/globals.css`, `frontend/src/components/ui/{table,badge,button,input,label}.tsx`.
- Instructions:
  1. Specify exact Tailwind classes for the two pastel row tints (green = fully applied, yellow = partial). Must:
     - Compose cleanly with `<TR>`'s existing `hover:bg-muted/30`.
     - Remain readable in both states.
     - Be subtle enough not to fight the method badge colours.
     - Cover BOTH the primary row and its split rows (same tint for the whole `bank_id` group).
     - State a fallback for the hover state (so hovering still gives feedback over the tint).
  2. Choose and specify the filter-control treatment for Method + Drill-down. Options:
     - (A) Polished chip row — same multi-select buttons, but refined sizing/spacing/active state to match the other inputs.
     - (B) Popover trigger button labelled "Method (n selected) ▾" / "Drill-down (n selected) ▾" with a checkbox list inside.
     Pick ONE based on which feels cleaner and more consistent with the rest of the Filters card; justify briefly in the spec.
  3. Specify the clickable-row treatment: `cursor-pointer`, hover background that works WITH the tint, focus ring for keyboard users. Note that the invoice `<Link>` inside the row must `stopPropagation`.
  4. Specify the new container padding/max for `(app)/layout.tsx` once `max-w-7xl` is dropped. Header + main should align; suggest `px-6` (or whatever matches the rest of the codebase). Sidebar width stays at `w-52`.
  5. Confirm the amber left-border is dropped on unreconciled rows.
- Output: write the spec into `.claude/context/designer.md` under a new section "BS-Polish Spec (2026-05-19)". Include exact class strings the frontend can paste.
- Done when: spec is complete, unambiguous, and copy-pasteable into the frontend code.

### BS-Polish-2 — Implement Bank Statement polish
- Agent: frontend-dev
- Priority: High
- Depends on: BS-Polish-1
- Repo (cwd): `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-frontend`
- Files to edit:
  - `frontend/src/app/(app)/layout.tsx` — remove `max-w-7xl` from both `<header>` inner div and the outer main wrapper; apply the padding/container the designer specifies.
  - `frontend/src/app/(app)/bank-statement/bank-statement-client.tsx` — apply tints, clickable rows (with stopPropagation on the invoice link), filter-control treatment, drop the amber border.
- Instructions:
  1. Read `.claude/context/designer.md` § "BS-Polish Spec (2026-05-19)" first; paste the classes the designer wrote.
  2. Compute the tint at the `bank_id` level: pre-aggregate `rows` into a `Map<bank_id, sumAppliedAcrossSplits>` once, then apply the resulting tint class to every row sharing that `bank_id`. Tolerance for "fully applied" = `Math.abs(sum - deposit_amt) < 1`.
  3. Make the row clickable only when `canExpand` (i.e., `split_index === 1 && drill_type !== null`). On click, toggle `expanded[r.bank_id]`. Add `onClick={(e) => { e.stopPropagation(); }}` to the invoice `<Link>` so it still navigates. Keep the chevron button working as well.
  4. Remove `borderCls` (amber border) entirely from the row rendering.
  5. Implement the filter-control treatment exactly as the designer specified (A or B).
  6. Run `npm run build` and `tsc --noEmit` in `frontend/`; both must be clean.
- Done when: build clean, `/bank-statement` matches the spec on all states (loading / empty / error / data / mixed split tints / hover / clicked row).

### BS-1 — RPCs for Bank Statement View
- Agent: database-manager (executed by PM)
- Priority: High
- Depends on: existing schema only (no new tables)
- Migration name: `bank_statement_view_rpcs`
- Instructions:
  1. Create `rpc_get_bank_statement_view(p_date_from date, p_date_to date, p_narration text, p_chq_ref text, p_methods text[], p_invoice_number text, p_amount_min numeric, p_amount_max numeric, p_drill_types text[], p_page int, p_page_size int) RETURNS jsonb` per FR-067..FR-072.
  2. Create `rpc_get_bank_statement_drilldown(p_bank_statement_id uuid, p_drill_type text) RETURNS jsonb` per FR-070.
  3. Both SECURITY DEFINER, role-checked via `current_user_role()`, GRANT EXECUTE to authenticated, no audit writes (read-only).
- Done when: both RPCs deployed, smoke-tested via SQL on the 2026-05-16 UPI settlement row (`d4bb2dbd-…`, ₹26817.82) and the 2026-05-16 cards settlement row (`28e7940c-…`, ₹82402.16).

### BS-2 — Frontend: /bank-statement page + nav entry
- Agent: frontend-dev (executed by PM)
- Priority: High
- Depends on: BS-1
- Files to add:
  - `frontend/src/app/(app)/bank-statement/page.tsx` (server wrapper)
  - `frontend/src/app/(app)/bank-statement/bank-statement-client.tsx` (client component)
- Files to modify:
  - `frontend/src/app/(app)/layout.tsx` — add Bank Statement nav entry between Invoices and Audit Log for both roles.
  - `frontend/src/lib/types.ts` — add `BankStatementRow`, `BankStatementDrillUpi`, `BankStatementDrillCard`, `BankStatementDrillMmt` types.
  - `frontend/package.json` — add `xlsx` dep.
- Implements FR-067..FR-074: filters, row-splitting visuals, inline accordion drill-down (lazy), Excel export of filtered set capped at 10k.
- Done when: `npm run build` clean, `tsc --noEmit` clean, an UPI / Card / MMT row each expand to show real sub-rows, Excel download succeeds.

### BS-3 — QA: end-to-end smoke + error-state coverage
- Agent: qa
- Priority: High
- Depends on: BS-2
- Done when: state matrix below ticked green.

---

### M1 — Schema migration: reconciled_at + reconciled_link_id columns, payment_method enum extension, source_config seed, un-reconcile trigger
- Agent: database-manager (executed by PM)
- Priority: High
- Depends on: existing `mmt_invoice`, `mmt_bookings_payout`, `reconciliation_links`, `payment_source_config`
- Instructions:
  1. ALTER `mmt_invoice` ADD `reconciled_at TIMESTAMPTZ NULL`, ADD `reconciled_link_id UUID NULL REFERENCES reconciliation_links(id) ON DELETE SET NULL`.
  2. ALTER `mmt_bookings_payout` ADD `reconciled_at TIMESTAMPTZ NULL`, ADD `reconciled_link_id UUID NULL REFERENCES reconciliation_links(id) ON DELETE SET NULL`.
  3. Drop + recreate the CHECK constraint on `reconciliation_links.payment_method` to include `'mmt_payout'`.
  4. Drop + recreate the CHECK constraint on `payment_source_config.payment_method` to include `'mmt_payout'`.
  5. INSERT into `payment_source_config`: `('mmt_payout','bank_statement', true)` (ON CONFLICT DO NOTHING).
  6. CREATE TRIGGER `trg_mmt_clear_reconciled_at_on_link_delete` AFTER DELETE on `reconciliation_links` that, for the deleted row, sets `mmt_invoice.reconciled_at = NULL, reconciled_link_id = NULL` WHERE `reconciled_link_id = OLD.id` (same for `mmt_bookings_payout`).
  7. CREATE INDEX `idx_mmt_invoice_unreconciled` ON `mmt_invoice (booking_id) WHERE reconciled_at IS NULL`.
  8. CREATE INDEX `idx_mmt_bookings_payout_unreconciled` ON `mmt_bookings_payout (booking_id) WHERE reconciled_at IS NULL`.
- Done when: migration applied successfully; advisors pass.

### M2 — RPCs: candidates / detail / field edits / atomic reconcile
- Agent: backend-dev (executed by PM)
- Priority: High
- Depends on: M1
- Instructions: Create one migration `v1_mmt_direct_reconcile_rpcs` defining:
  - `rpc_get_mmt_reconcile_candidates(p_hotel_invoice_id uuid) RETURNS jsonb` — FR-061.
  - `rpc_get_mmt_reconcile_detail(p_booking_id text) RETURNS jsonb` — FR-062. Error sentinels: `MMT_INVOICE_NOT_FOUND`, `MMT_PAYOUT_NOT_FOUND`, `MMT_PAYOUT_AMBIGUOUS`, `MMT_BANK_NOT_FOUND`, `MMT_BANK_AMBIGUOUS`.
  - `rpc_update_mmt_invoice_fields(p_id uuid, p_fields jsonb)` — FR-063.
  - `rpc_update_mmt_bookings_payout_fields(p_id uuid, p_fields jsonb)` — FR-064.
  - `rpc_reconcile_mmt_invoice(p_hotel_invoice_id uuid, p_mmt_invoice_id uuid, p_mmt_bookings_payout_id uuid, p_bank_statement_id uuid, p_confirm_partial bool, p_confirm_overpay bool) RETURNS jsonb` — FR-065. Reuses `fn_lock_and_get_source_amount`, `fn_recompute_invoice_status`, `fn_write_audit`. Emits `PARTIAL_CONFIRMATION_REQUIRED` / `OVERPAY_CONFIRMATION_REQUIRED` sentinels in line with existing RPC error contract.
  - All 5 RPCs `SECURITY DEFINER`, role-checked (operator/admin), audit-logged. Grant EXECUTE to `authenticated`.
- Done when: 5 RPCs deployed, smoke-tested via SQL (happy path + each error sentinel).

### M3 — Frontend: MmtReconcilePanel component + integration into invoice detail page
- Agent: frontend-dev (executed by PM)
- Priority: High
- Depends on: M2
- Instructions:
  - New file `frontend/src/app/(app)/invoices/[id]/mmt-reconcile-panel.tsx` implementing FR-066.
  - Edit `frontend/src/app/(app)/invoices/[id]/detail-client.tsx` to render `<MmtReconcilePanel />` below the existing `<AddPaymentPanel />` when `inv.source === 'MakeMyTrip' || inv.source === 'Goibibo'`.
  - Add a new `PaymentMethod` value `'mmt_payout'` and any new types in `frontend/src/lib/types.ts`.
  - Implement the two-column edit UI, debounced field-update mutations, match indicator, bank statement callout, confirmation dialogs for partial/overpay sentinels.
  - Use existing `Card`, `Input`, `Button`, `Select`, `Dialog`, `useToast`, `prettifyError` patterns.
- Done when: `npm run build` clean, `tsc --noEmit` clean, manual click-through reaches success path on a real MMT invoice.

### M4 — QA: end-to-end smoke + error-state coverage on Phase M
- Agent: qa
- Priority: High
- Depends on: M3
- Instructions: Walk the 6 documented states (no booking selected, MMT_INVOICE_NOT_FOUND, MMT_PAYOUT_NOT_FOUND, MMT_BANK_NOT_FOUND, ambiguous bank, success). Verify audit rows for reconcile.create.mmt, mmt_invoice.update, mmt_bookings_payout.update. Verify un-reconcile via `rpc_admin_reverse_reconciliation` clears `reconciled_at` on both tables via the trigger. Verify the new payment_method appears correctly on Linked Payments table.
- Done when: matrix below this section ticks all states green.

---

### C1 — RPC test suite (full automated)
- Agent: qa
- Priority: High
- Depends on: B2–B9 (done)
- Instructions: Write SQL test scenarios (pgTAP or plain transactional SQL with assertions) covering: happy path, partial, overpay-flag, overpay-reject, underpay save, double-claim race (2 sessions, `SELECT FOR UPDATE` proven), un-reconcile request → approve → state correct, cash add/edit/delete request lifecycles, RLS enforcement (operator blocked from direct mutations on every sensitive table).
- Done when: all scenarios pass green; report appended below.

### C2 — Audit log completeness matrix
- Agent: qa
- Priority: High
- Depends on: B2–B9 (done)
- Instructions: For each RPC, confirm audit row produced with correct `action`, `entity_*`, `before_state`, `after_state`. Confirm UPDATE/DELETE on `audit_log` raises immutability exception.
- Done when: matrix written into this file.

### E10 — Design polish + error message audit
- Agent: designer + qa
- Priority: Medium
- Depends on: all E1–E9 (done)
- Instructions: Walk every page and every error state; confirm style guide compliance per `prd.md` § UI Requirements. Spacing, alignment, focus rings, keyboard nav.

### F1 — End-to-end manual QA
- Agent: qa
- Priority: High
- Depends on: E10
- Instructions: Run the 11-step script from the original execution.md against the deployed frontend with the two seeded users.

### F2 — Performance check
- Agent: qa
- Priority: Medium
- Depends on: F1
- Instructions: Seed 2000 invoices and 5000 transactions; confirm invoice list <1s, transaction picker <500ms, admin home <300ms.

### F3 — Security review
- Agent: qa
- Priority: High
- Depends on: F1
- Instructions: Run `mcp__supabase__get_advisors` again — confirm remaining warnings are the expected pattern (SECURITY DEFINER RPCs callable by anon: they reject with "Not authenticated"). Confirm RLS denies operator direct mutations from a real authenticated session (not superuser).

---

## Backlog (V1.5+)

Same as previous version — CSV/Excel export, void/cancelled invoices, bank-stmt↔MPR reconciliation, OTA reconciliation, notifications, bulk operations, mobile, multi-property, self-service user provisioning, auto-match, realtime.

---

## Blocked

_None._

---

## Decisions Made During Execution

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-17 | Inline-cash creation inside `rpc_reconcile_invoice` instead of two RPC calls | Achieves true atomicity per E4 alternative; keeps frontend simple. |
| 2026-05-17 | `v_transactions_with_remaining` uses `security_invoker = true` (Supabase view option) | Eliminates Supabase lint ERROR while keeping RLS enforcement on base tables. |
| 2026-05-17 | Internal helper functions (`fn_*`) have EXECUTE revoked from anon/authenticated | Prevents direct REST calls; RPCs still invoke them via owner-level rights inside SECURITY DEFINER. |
| 2026-05-17 | Error messages from RPC use `PARTIAL_CONFIRMATION_REQUIRED` / `OVERPAY_CONFIRMATION_REQUIRED` sentinel prefixes | Lets the UI translate them into confirmation dialogs without re-implementing business rules client-side. |
| 2026-05-17 | First passwords seeded directly in `auth.users` via `crypt(...)` | Avoids needing the auth admin REST API in the MCP environment; users will reset on first prod use. |
| 2026-05-17 | Supabase MCP-applied migrations are the source of truth (no local `supabase/migrations/` directory yet) | Project uses Supabase MCP server; local CLI workflow can be added later if needed. |

---

## Quick verification log

| Scenario | Outcome |
|---|---|
| Partial save without `confirm_partial` | RPC raises `PARTIAL_CONFIRMATION_REQUIRED` — verified |
| Partial save with `confirm_partial=true` | Link inserted, invoice → `partial`, audit rows written — verified |
| Overpay > 5% | RPC raises hard error with explicit reduction amount — verified |
| Next.js build | `npm run build` produces clean output, 12 routes generated — verified |
| TypeScript `tsc --noEmit` | Clean — verified |
| Supabase security advisor | `security_definer_view` ERROR cleared; remaining WARNs are the documented "RPC callable by anon (auth checked inside)" pattern |
| Phase M role guard (NULL-safe) | `rpc_get_mmt_reconcile_candidates` raises `Not authorized` for null role — verified |
| Phase M happy path (as operator) | Candidates RPC returns default + 494 unreconciled candidates; detail RPC for `NH12101480322876` matches within ₹1 with bank credit found — verified |
| Phase M frontend build | `npm run build` clean, 13 routes; `tsc --noEmit` clean — verified |

---

## Phase RI — Report an Issue (FR-089..FR-098)
<!-- Last updated: 2026-05-23 -->

### Scope
Source-aware operator-reported issue tracking on invoices. Informational (does not block reconcile). Auto-resolves when invoice becomes `fully_reconciled`. Admin-only manual resolution. Operator can withdraw their own.

### Sequenced tasks

#### RI-1 — Schema: `invoice_issue_reports` table + RLS + helper fn
- Agent: database-manager
- Priority: High
- Depends on: nothing
- Instructions:
  - Apply migration `v1_invoice_issue_reports` creating `public.invoice_issue_reports` per FR-090 (full DDL in PRD).
  - CHECK constraint on `category` MUST list all FR-089 codes verbatim.
  - Partial unique index `uq_invoice_issue_reports_one_open_per_invoice` on `(invoice_id) WHERE status='open'`.
  - Enable RLS. SELECT policy: `reported_by = auth.uid() OR is_admin()`. Revoke INSERT/UPDATE/DELETE from `authenticated`.
  - Add `updated_at` BEFORE UPDATE trigger.
  - Create helper `fn_auto_resolve_issue_reports(p_invoice_id uuid, p_actor uuid)` — SECURITY DEFINER, owned by postgres, marks all `open` rows for `p_invoice_id` as `resolved_by_reconciliation`, sets `resolved_at=now()`, `resolved_by=p_actor`, and writes one `issue_report_auto_resolved` audit row per affected row. EXECUTE revoked from anon/authenticated; only callable by the SECURITY DEFINER reconcile RPCs.
  - Run `mcp__supabase__get_advisors` after — no new errors.
- Done when: migration applied; advisors clean; manual `SELECT` from `invoice_issue_reports` as operator returns empty (RLS pass); direct INSERT as authenticated raises permission denied.

#### RI-2 — RPCs: create / withdraw / resolve + reconcile-RPC hook
- Agent: backend-dev
- Priority: High
- Depends on: RI-1
- Instructions:
  - Read `.claude/context/backend-dev.md` first.
  - Apply migration `v1_rpc_issue_reports`. Create:
    - `rpc_create_issue_report(p_invoice_id uuid, p_category text, p_notes text) RETURNS uuid` — FR-091.
    - `rpc_withdraw_issue_report(p_report_id uuid) RETURNS void` — FR-092.
    - `rpc_resolve_issue_report(p_report_id uuid, p_resolution_notes text) RETURNS void` — FR-093.
  - All SECURITY DEFINER, owned by postgres, search_path locked.
  - Category-to-source validation: hard-code the source mapping from FR-089 in a CASE inside the RPC. `other` and the "applies to all" categories pass for any source.
  - Sentinel errors: `ISSUE_ALREADY_OPEN`, `REPORT_NOT_OPEN`, `Not authorized`, `Invalid category for source`, `Notes required for category 'other'`.
  - Hook auto-resolve into reconcile RPCs: edit `rpc_reconcile_invoice`, `rpc_reconcile_mmt_invoice`, `rpc_reconcile_yatra_invoice` to call `fn_auto_resolve_issue_reports(p_invoice_id, auth.uid())` immediately after `fn_recompute_invoice_status` IFF the recomputed status is `fully_reconciled`. Do NOT add the hook to `rpc_admin_reverse_reconciliation` (BR-047).
  - Add `has_open_issue` boolean to the invoice list query the frontend already calls. If list goes through a view, extend the view. If list is REST-driven, expose a view `v_invoice_list_with_issue` that left-joins the partial-open existence and adds the boolean column.
  - Write end-to-end smoke (via MCP `execute_sql` impersonating operator/admin): create report, attempt duplicate (rejected), withdraw, create again, admin resolve, file again, reconcile via `rpc_reconcile_invoice` → verify auto-resolution to `resolved_by_reconciliation`.
- Done when: migration applied; smoke scenarios all pass; audit_log shows the four new action types.

#### RI-3 — QA: RPC + RLS coverage
- Agent: qa
- Priority: High
- Depends on: RI-2
- Instructions:
  - Cases: (a) operator creates report happy path, (b) `other` without notes rejected, (c) MMT-only category on walk-in invoice rejected, (d) duplicate open rejected, (e) operator withdraws own → ok, (f) operator tries to withdraw someone else's → rejected, (g) operator tries to resolve → `Not authorized`, (h) admin resolves → ok, (i) admin resolves already-closed → `REPORT_NOT_OPEN`, (j) reconcile to `fully_reconciled` auto-resolves open report, (k) reconcile to `partial` does NOT auto-resolve, (l) reverse-reconciliation does NOT re-open, (m) RLS: operator A cannot see operator B's report via REST.
  - Verdict required before RI-4 starts.

#### RI-4 — Frontend: ReportIssueDialog + issue card on invoice detail
- Agent: frontend-dev
- Priority: High
- Depends on: RI-2 (need RPCs live), RI-3 PASS preferred but not blocking
- Repo: `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-frontend`
- Instructions:
  - Read `.claude/context/frontend-dev.md` first.
  - Add `IssueReport` and `IssueCategory` types in `src/lib/types.ts`. Add a single `ISSUE_CATEGORY_CATALOG` constant keyed by source returning `{code,label}[]` (mirror FR-089).
  - New component `src/components/issue/report-issue-dialog.tsx`:
    - Uses existing `Dialog`, `Select`, `Textarea`, `Button` primitives.
    - Source-aware dropdown built from `ISSUE_CATEGORY_CATALOG[invoice.source ?? 'walkin']` UNION the "all" categories.
    - Validation: `other` requires non-empty trimmed notes. Submit disabled otherwise.
    - Calls `rpc_create_issue_report`. On `ISSUE_ALREADY_OPEN`, surface inline message.
  - New component `src/components/issue/issue-report-card.tsx`:
    - Renders the existing report (any status) with category label, notes, reporter, timestamps, status badge.
    - Withdraw button (visible if `status='open' && viewer.id === report.reported_by`).
    - Resolve button (visible if `status='open' && viewer.role === 'admin'`) — opens a small inline confirm with optional resolution notes textarea, calls `rpc_resolve_issue_report`.
  - Integrate both into `src/app/(app)/invoices/[id]/detail-client.tsx`:
    - Query: `useQuery(['issue-report', invoiceId])` selecting the latest report for this invoice (most recent by `reported_at`, any status).
    - "Report an issue" button in the detail header (right of the title block). Disabled if an open report already exists; tooltip explains why.
    - Issue Report card rendered above the reconcile panels when a report exists.
    - Mutations invalidate both `['issue-report', invoiceId]` and the invoice list query.
  - Invoice list (`src/app/(app)/invoices/page.tsx`):
    - Consume the new `has_open_issue` boolean (added in RI-2).
    - Render a red "Issue reported" pill next to the status badge when true.
  - After edits: `npm run build` and `npx tsc --noEmit` must be clean.
- Done when: build clean; report flow works end-to-end against live Supabase; pill appears on list for invoices with open reports.

#### RI-5 — Frontend: Admin reports page (`/admin/issues`)
- Agent: frontend-dev
- Priority: Medium
- Depends on: RI-4
- Instructions:
  - New route `src/app/(app)/admin/issues/page.tsx` (admin-only; redirect operators to `/invoices` via middleware — middleware already gates `/admin/*`).
  - Tabs: Open (default) / Resolved / All. Filters: source, category, date range.
  - Server-side pagination (page size 50). Sort `reported_at desc`.
  - Each row links to `/invoices/[invoice_id]`. Inline "Resolve" on open rows opens the same confirm-with-notes dialog from RI-4.
  - Add nav entry "Issues" under admin section of sidebar.
  - Build clean.
- Done when: admin can browse, filter, and resolve from this page; operator hitting URL is redirected.

#### RI-6 — Designer: polish pass on report dialog + card + admin page
- Agent: designer
- Priority: Medium
- Depends on: RI-4, RI-5
- Instructions:
  - Confirm pill color (red), status badge palette (open=red, resolved_by_admin=green, resolved_by_reconciliation=green, withdrawn_by_operator=slate), focus rings, spacing rhythm matches the rest of the app (16px card padding, 4/8/16/24 grid).
  - Provide exact Tailwind class strings for any tweaks; frontend-dev applies in same session if minor.

#### RI-7 — QA: end-to-end on UI + visual states
- Agent: qa
- Priority: High
- Depends on: RI-5, RI-6
- Instructions: full operator + admin flow on the deployed frontend. Verify pill disappears after auto-resolve. Verify admin page filters, pagination, resolve. Verify withdraw flow. Verify error states (network failure, race on duplicate open).

### Sequencing summary
RI-1 → RI-2 → RI-3 (gate) → RI-4 → RI-5 → RI-6 → RI-7 (gate).

### Completed (Phase RI)

#### [2026-05-23] RI-1 — DONE
- Agent: database-manager (PM-driven via Supabase MCP).
- Migration `v1_invoice_issue_reports` applied.
- Outcome: `public.invoice_issue_reports` table + partial unique index + RLS + `fn_auto_resolve_issue_reports` helper. Advisors clean — no new errors.

#### [2026-05-23] RI-2 — DONE
- Agent: backend-dev (PM-driven via Supabase MCP).
- Migration `v1_rpc_issue_reports` applied.
- Outcome: 3 SECURITY DEFINER RPCs (`rpc_create_issue_report`, `rpc_withdraw_issue_report`, `rpc_resolve_issue_report`), 2 helpers (`fn_classify_invoice_source`, `fn_issue_category_allowed`), auto-resolve trigger on `hotel_invoice` (cleaner than editing 3 reconcile RPCs), view `v_invoice_list_with_issue`.
- 11/11 smoke scenarios pass. Audit log shows all 4 action types.

### Status
RI-1 + RI-2 DONE. RI-3 (QA gate) NEXT — then RI-4 (frontend).

---

## Phase PF — Payment Folio Upload + Auto-select + Resolve Guard (FR-099..FR-107)
<!-- Last updated: 2026-05-23 -->

### Scope
Three coupled features:
1. New `payment_entries` + `payment_folio_uploads` tables; admin uploads PMS "Payment Folio" `.xls`; rows ingested with duplicate-skip; no auto-reconciliation.
2. Auto-select pre-fills payment method / date / amount on all four reconcile panels (walk-in, MMT, Yatra, Agoda) from matching `payment_entries` rows. Manual click-to-reconcile preserved.
3. `rpc_resolve_issue_report` gains an `INVOICE_NOT_RECONCILED` guard; frontend Resolve buttons disabled with tooltip when invoice is `unreconciled`.

PM-locked design decisions (FR-099 § "Locked design decisions"):
- Upload UI at `/admin/payment-folio` (NEW admin-only page).
- Auto-select applies to ALL four reconcile surfaces.
- "Reconciled" for the resolve guard = `partial` OR `fully_reconciled` (NOT just fully).
- New `corporate_credit` payment_method for `Bill To Company`.
- BIFF8 parser in TypeScript (frontend) + Python sidecar (backend, for future Drive ingestion). LibreOffice NOT used.
- Duplicate = exact 6-column tuple match with NULL-canonicalisation.

### Sequenced tasks

#### PF-1 — Schema: `payment_entries` + `payment_folio_uploads` + `corporate_credit` CHECK extension + consume helper + reverse-consume trigger
- Agent: database-manager
- Priority: High
- Depends on: nothing
- Repo: `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm` (Supabase MCP)
- Migration name: `pf_payment_folio_schema`
- FR reference: FR-099, FR-100, FR-101, BR-049.
- Instructions:
  1. Read `.claude/context/database-manager.md` first.
  2. Apply migration `pf_payment_folio_schema` creating:
     - Table `public.payment_folio_uploads` per FR-100 DDL exactly (PK, FK uploaded_by → user_profiles, RLS enabled, SELECT policy `is_admin() OR uploaded_by = (select auth.uid())`, INSERT/UPDATE/DELETE revoked from authenticated + anon).
     - Table `public.payment_entries` per FR-099 DDL exactly. RLS enabled, SELECT TO authenticated USING (true). INSERT/UPDATE/DELETE revoked.
     - Unique index `uq_payment_entries_dedup` on the canonicalized 6-tuple expression.
     - 3 supporting indexes per FR-099.
  3. ALTER the CHECK constraint on `reconciliation_links.payment_method` to add `'corporate_credit'`. Drop + recreate the constraint with the full updated value list. Same for `payment_source_config.payment_method`.
  4. Create helper `fn_consume_payment_entry(p_invoice_id uuid, p_link_id uuid) RETURNS int` — SECURITY DEFINER, owned by postgres, EXECUTE revoked from anon/authenticated:
     - Resolves invoice's `booking_id` and `invoice_number` from `hotel_invoice`.
     - For each `payment_entries` row where `consumed_for_invoice_id IS NULL` AND (`booking_id = inv.booking_id` (both non-NULL) OR `invoice_number_raw = inv.invoice_number` (both non-NULL)), set `consumed_for_invoice_id = p_invoice_id`, `consumed_at = now()`, `consumed_link_id = p_link_id`.
     - Returns number of rows consumed.
     - Writes one `payment_entry_consumed` audit row per affected entry via `fn_write_audit`.
  5. Create trigger `trg_payment_entries_clear_consumed_on_link_delete` AFTER DELETE on `reconciliation_links` that clears `consumed_for_invoice_id`, `consumed_at`, `consumed_link_id` on any `payment_entries` row whose `consumed_link_id = OLD.id`. Writes one `payment_entry_unconsumed` audit row per affected.
  6. Run `mcp__supabase__get_advisors` — no new errors.
- Done when: migration applied; advisors clean; manual SELECT from `payment_entries` as operator returns empty; direct INSERT as authenticated raises permission denied; the CHECK constraints accept `'corporate_credit'`.
- Return: COMPLETED / MIGRATIONS / RLS / ROLLBACK / CONTEXT UPDATED.

#### PF-2 — RPC: `rpc_upload_payment_folio` + resolve-guard patch on `rpc_resolve_issue_report` + auto-consume hook in all 4 reconcile RPCs
- Agent: backend-dev (executed by PM)
- Priority: High
- Depends on: PF-1
- Repo: `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm` (Supabase MCP)
- Migration name: `pf_rpcs_and_hooks`
- FR reference: FR-102, FR-106 (server-side hook), FR-107.
- Instructions:
  1. Read `.claude/context/backend-dev.md` first.
  2. Create `rpc_upload_payment_folio(p_file_name TEXT, p_file_size_bytes INT, p_sha256 TEXT, p_rows JSONB) RETURNS jsonb`:
     - SECURITY DEFINER, owned by postgres, search_path locked, GRANT EXECUTE to authenticated.
     - Role guard: operator or admin (use `current_user_role()`).
     - Insert one `payment_folio_uploads` row up-front, capture id.
     - Loop over `p_rows` jsonb array. For each element:
       - Parse fields. Validate: `received_date` not null, `payment_amount > 0`, `payment_type` non-empty.
       - On validation failure: append `{row_index, message}` to a `parse_warnings` jsonb array; increment invalid_count.
       - On success: compute `payment_method` per the FR-099 mapping CASE block (CASE on payment_type_raw, with ILIKE checks on reference_text for OTA collector hints).
       - Try `INSERT INTO payment_entries (...) ON CONFLICT ON CONSTRAINT uq_payment_entries_dedup DO NOTHING RETURNING id`. If RETURNING id is null → conflict → increment skipped_count. Else → increment inserted_count.
     - After loop: UPDATE the `payment_folio_uploads` row with final counts + warnings + status='completed'.
     - Write one `payment_folio.upload` audit row with before=null, after={counts, file_name, sha256}.
     - Return `{ upload_id, row_count, inserted_count, skipped_count, invalid_count, warnings }`.
  3. ALTER `rpc_resolve_issue_report` (drop+recreate via CREATE OR REPLACE):
     - After existing role + status checks, fetch `hotel_invoice.reconciliation_status` for the report's invoice_id.
     - If status NOT IN ('partially_reconciled','fully_reconciled') → raise: `'INVOICE_NOT_RECONCILED: Invoice must be at least partially reconciled before resolving this issue report.'`
     - All other behaviour unchanged.
  4. Hook auto-consume into the 4 reconcile RPCs (CREATE OR REPLACE each):
     - `rpc_reconcile_invoice` — after `fn_recompute_invoice_status`, BEFORE the audit write, call `fn_consume_payment_entry(p_invoice_id, v_new_link_id)` for EACH newly-inserted link (loop the inserted link ids).
     - `rpc_reconcile_mmt_invoice` — same pattern, single link.
     - `rpc_reconcile_yatra_invoice` — same pattern, single link.
     - Agoda reconcile RPC (whatever it is named — check via `mcp__supabase__list_migrations`) — same pattern.
     - Wrap each call in a `BEGIN ... EXCEPTION WHEN OTHERS THEN ... END` block that logs but does NOT fail the parent reconcile (consumption is best-effort).
  5. SQL smoke tests (via MCP `execute_sql`):
     - Upload a synthetic 5-row payload (mix of valid + 1 dup + 1 invalid) → verify counts.
     - Re-upload same payload → all 5 should skip (well, the 4 valid ones; the invalid one re-warns).
     - Reconcile an invoice whose booking_id matches one `payment_entries` row → verify that row's `consumed_for_invoice_id` is set.
     - Reverse-reconcile via `rpc_admin_reverse_reconciliation` → verify the `payment_entries` row's consumed fields are CLEARED via the AFTER DELETE trigger.
     - Attempt `rpc_resolve_issue_report` on a report whose invoice is `unreconciled` → expect `INVOICE_NOT_RECONCILED` exception.
     - Attempt same on a `partial` invoice → expect success.
- Done when: migration applied; all 5 smoke scenarios PASS; audit_log shows `payment_folio.upload`, `payment_entry_consumed`, `payment_entry_unconsumed` action types as expected.
- Return: COMPLETED / FILES CHANGED / CONTEXT UPDATED / NEXT.

#### PF-3 — QA gate on PF-1 + PF-2
- Agent: qa
- Priority: High
- Depends on: PF-2
- Instructions:
  - Cases:
    (a) Upload happy path (3 valid rows). Counts correct.
    (b) Duplicate upload (same 3 rows again). All 3 skipped.
    (c) Invalid row in payload (missing date, negative amount, blank payment_type). Each accumulates a warning entry and increments invalid_count; valid rows in same upload still go through.
    (d) Method mapping correctness: `UPI`→upi, `Cash`→cash, `Credit Card`/`Debit Card`→card, `Bank Transfer` + reference "Collected By -MakeMyTrip"→mmt_payout, `Bank Transfer` plain→bank_transfer, `IMPS`→bank_transfer, `Payment Gateway`→bank_transfer, `Bill To Company`→corporate_credit, `Other`→NULL.
    (e) Reconcile invoice with matching `payment_entries` row → consume; reverse-reconcile → unconsume.
    (f) Resolve issue report when invoice unreconciled → rejected; when partial → ok; when fully_reconciled → ok.
    (g) RLS: operator can SELECT `payment_entries` (true), operator can SELECT `payment_folio_uploads` only their own, operator cannot INSERT/UPDATE/DELETE directly on either table.
  - Verdict required before PF-4 starts.

#### PF-4 — Frontend: BIFF8 TS reader + upload page + auto-select on all 4 panels + resolve-button disable
- Agent: frontend-dev
- Priority: High
- Depends on: PF-2 (PF-3 PASS preferred but not blocking — frontend can be coded against the deployed RPCs in parallel)
- Repo: `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm` (frontend at `frontend/`)
- FR reference: FR-104, FR-105, FR-106, FR-107.
- Instructions:
  1. Read `.claude/context/frontend-dev.md` first.
  2. Add `frontend/src/lib/xls/biff8.ts` — pure-TypeScript BIFF8 OLE reader. Exports `parsePaymentFolio(buffer: ArrayBuffer): Promise<PaymentFolioRow[]>` where:
     ```ts
     type PaymentFolioRow = {
       row_index: number;
       booking_id: string | null;
       payment_type: string;
       received_date: string; // ISO YYYY-MM-DD
       reference_text: string | null;
       payment_amount: number;
       invoice_number: string | null;
     };
     ```
     Implementation notes:
     - Use `DataView` for binary reads.
     - Walk the OLE compound document structure: read header at offset 0 (`D0CF11E0...` signature), parse FAT, find the "Workbook" stream (UTF-16LE name), reassemble its sectors.
     - On the workbook stream, walk BIFF records: each is `[u16 type][u16 length][...bytes]`. Records to handle: `BOF (0x0809)`, `EOF (0x000A)`, `BoundSheet8 (0x0085)`, `SST (0x00FC)` + `Continue (0x003C)`, `Row (0x0208)`, `LABELSST (0x00FD)`, `RK (0x027E)`, `MULRK (0x00BD)`, `NUMBER (0x0203)`, `LABEL (0x0204)`, `FORMAT (0x041E)`, `XF (0x00E0)`, `BLANK (0x0201)`, `MULBLANK (0x00BE)`.
     - SST string decoding: 16-bit length-prefix + flags byte (compressed=Latin-1, else UTF-16LE).
     - RK number: 4 bytes, low 2 bits = flags (bit0 = ×100, bit1 = integer-shifted).
     - Date detection: an XF whose format index points to a format string containing 'd', 'm', or 'y' → cell is a date. Excel epoch 1900-01-01 with the 1900-leap-year bug → date = epoch + (serial - 2) days.
     - Header row detection: first row whose cells contain ALL of (case-insensitive substring): "booking id", "payment type", "received date", "reference text", "payment amount", "invoice number". Capture column indices.
     - Data rows: continue until first row where all 6 target cells are empty/blank.
     - On parse error: throw `PaymentFolioParseError` with a friendly message.
  3. Add `frontend/src/app/(app)/admin/payment-folio/page.tsx` (admin-only — middleware already gates `/admin/*`):
     - Drag-and-drop zone + file picker (accept `.xls` only).
     - On drop: read into ArrayBuffer, call `parsePaymentFolio`, render a preview table (first 20 rows) + total row count.
     - SHA-256 of file body (use `crypto.subtle.digest('SHA-256', buffer)`).
     - "Upload" button → call `supabase.rpc('rpc_upload_payment_folio', { p_file_name, p_file_size_bytes, p_sha256, p_rows })`.
     - Display result panel: inserted_count (green), skipped_count (slate badge "duplicates"), invalid_count (amber badge — expandable list of `parse_warnings`).
     - Below: "Recent uploads" table (last 20 from `payment_folio_uploads`).
     - States: idle / parsing / preview / uploading / success / partial / error.
  4. Add nav entry "Payment Folio" under admin sidebar in `frontend/src/app/(app)/layout.tsx`. Place between "Issues" and "Issue Categories" (or wherever fits the existing alphabetical/grouping pattern).
  5. Add `PaymentEntry` and `PaymentFolioUpload` types in `frontend/src/lib/types.ts`. Add `'corporate_credit'` to the `PaymentMethod` union.
  6. Auto-select on reconcile panels:
     - Create a shared hook `frontend/src/lib/hooks/usePaymentFolioMatches.ts` that takes an invoice and queries `payment_entries`:
       ```ts
       useQuery({
         queryKey: ['payment-folio-matches', invoice.id],
         queryFn: async () => {
           const filters: string[] = [];
           if (invoice.booking_id) filters.push(`booking_id.eq.${invoice.booking_id}`);
           if (invoice.invoice_number) filters.push(`invoice_number_raw.eq.${invoice.invoice_number}`);
           if (filters.length === 0) return [];
           const { data, error } = await supabase
             .from('payment_entries')
             .select('*')
             .is('consumed_for_invoice_id', null)
             .or(filters.join(','))
             .order('received_date', { ascending: false })
             .limit(10);
           if (error) throw error;
           return data as PaymentEntry[];
         },
       });
       ```
     - Tie-break sort applied on the client: exact invoice_number match > exact booking_id match > recency.
     - Wire into:
       - `AddPaymentPanel` (`frontend/src/app/(app)/invoices/[id]/detail-client.tsx`) — at the top of the panel, show a chip strip "From Payment Folio (N matches)" when matches exist. Clicking a chip sets `method`, `date`, and pre-fills `pickAmount` (and, if the (method,date,amount) maps to a row in `v_transactions_with_remaining`, auto-opens the picker on that row).
       - `MmtReconcilePanel` (`mmt-reconcile-panel.tsx`) — show suggestion banner if any match has `payment_method='mmt_payout'`. Pre-select the matched booking dropdown entry where applicable.
       - `YatraReconcilePanel` (`yatra-reconcile-panel.tsx`) — same pattern. Pre-fill method (limited to upi/card/bank_transfer per existing Yatra rules) + date + amount.
       - `AgodaReconcilePanel` (`agoda-reconcile-panel.tsx`) — same pattern.
     - When exactly one match exists, auto-apply silently (no chip needed) and show a dismissible info banner "Pre-filled from Payment Folio entry of {date} • ₹{amount} • {method}".
  7. Resolve-button disable (FR-107):
     - In `frontend/src/components/issue/issue-report-card.tsx`: the `Resolve` button must read the invoice's `reconciliation_status` (currently the card doesn't have it — extend its props OR have the card fetch the invoice). Disable button when status = `'unreconciled'`. Wrap in a tooltip span: "Reconcile the invoice (at least partially) before resolving the report."
     - In `frontend/src/app/(app)/admin/issues/page.tsx`: the inline Resolve button on the open-reports table also needs `reconciliation_status`. Update the list query to JOIN `hotel_invoice.reconciliation_status` (use a view or extend the select). Disable + tooltip identically.
     - Both surfaces: catch the `INVOICE_NOT_RECONCILED` error from `rpc_resolve_issue_report` and toast: "Reconcile the invoice first (at least partially) before resolving this report."
  8. Build hygiene: `npm run build` and `npx tsc --noEmit` must be clean.
- Done when: all of (a) upload page works end-to-end on the real `excel_exports/Payment_Folio_1779523853.xls`; (b) re-uploading skips all rows; (c) opening an invoice with a matching `payment_entries` row pre-fills the reconcile panel; (d) Resolve button is disabled on `unreconciled` invoices with the tooltip; (e) build clean.
- Return: COMPLETED / FILES CHANGED / CONTEXT UPDATED / NEXT.

#### PF-5 — Designer: polish pass on upload page + auto-select chip strip + disabled button tooltip
- Agent: designer
- Priority: Medium
- Depends on: PF-4
- Instructions:
  - Drag-drop zone visual states (idle/hover/dragover/parsing/error).
  - Result panel: ensure inserted/skipped/invalid badge colors match the rest of the app palette (green/slate/amber).
  - Auto-select chip strip: spacing, max-width, truncation rules for long reference_text.
  - Disabled Resolve button: ensure tooltip visible via `disabled` state on the wrapping span (button itself disabled).
  - Recent uploads table: row-density consistent with `/admin/issues`.
- Output: append a "Phase PF Design Spec (2026-05-23)" section to `.claude/context/designer.md` with exact Tailwind class strings.

#### PF-6 — QA: end-to-end on UI + real-file upload
- Agent: qa
- Priority: High
- Depends on: PF-4, PF-5
- Instructions:
  - Upload `excel_exports/Payment_Folio_1779523853.xls` — verify all rows ingest with correct method mapping (spot-check 5 rows across UPI / Cash / Card / Bank Transfer / Bill To Company).
  - Re-upload same file → all rows skip.
  - Open an invoice known to have a matching `booking_id` in the folio → verify pre-fill banner appears.
  - Reconcile that invoice → verify `payment_entries.consumed_*` populated.
  - Reverse-reconcile → verify consumed fields cleared.
  - File an issue report on an `unreconciled` invoice → verify Resolve button disabled + tooltip.
  - Reconcile partially → Resolve button enabled.
  - All 4 reconcile panels (walk-in, MMT, Yatra, Agoda): verify auto-select fires for at least one match each.

### Sequencing summary
PF-1 → PF-2 → PF-3 (QA gate) → PF-4 → PF-5 → PF-6 (QA gate).

### Status
PF-1 DISPATCHING to database-manager now.
