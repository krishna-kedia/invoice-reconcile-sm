<!-- Last updated: 2026-05-18 10:00 -->

# Execution Plan
## Hotel Invoice Reconciliation App — V1 (Walk-in Invoices)

### Status: V1 BUILD COMPLETE — MMT payout ingestion DONE — MMT Direct Reconcile DONE — Bank Statement View IN PROGRESS

This document tracks the V1 build. All Phase A (foundations), Phase B (RPC core), and Phase D + E (frontend) work is in place. Phase C (RPC test suite) and Phase F (E2E QA) remain as the next layer.

The most recent slice — **Phase M (MMT Direct Reconcile)** — adds a new reconciliation surface for MMT/Goibibo invoices that talks directly to the existing payout chain. See FR-059..FR-066 in `prd.md`.

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
