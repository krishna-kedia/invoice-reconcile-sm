# Backend Dev Context
<!-- Last updated: 2026-05-23 (PF-2 dispatched) -->
<!-- Previous: 2026-05-17 -->

## Inbound Task — PF-2 (Payment Folio upload RPC + Resolve guard + 4-RPC auto-consume hook)
- Issued by PM: 2026-05-23
- Blocked on: PF-1 (DONE — `pf_payment_folio_schema` migration applied; `payment_entries` + `payment_folio_uploads` tables, `corporate_credit` CHECK ext, `fn_consume_payment_entry` helper, reverse-consume trigger all live).
- Spec: `prd.md` § "Addendum — Payment Folio Upload + Auto-select + Resolve Guard (2026-05-23)" — FR-102, FR-106 (server hook), FR-107. `execution.md` § "PF-2".
- Migration name: `pf_rpcs_and_hooks`.
- Reference seed users (still valid):
  - Admin: krishnagopal.kedia@optimoloan.com (`45bcd1e5-e628-4480-b9c6-08d4b8d936c9`)
  - Operator: operator@hotel.local (`6e50c4f5-94f4-40ab-b7b3-9919f6138a57`)

### Build these RPCs (all SECURITY DEFINER, owned by `postgres`, search_path locked):

1. **`rpc_upload_payment_folio(p_file_name TEXT, p_file_size_bytes INT, p_sha256 TEXT, p_rows JSONB) RETURNS jsonb`** — FR-102.
   - Role guard: operator or admin via `current_user_role()`. `RAISE EXCEPTION 'Not authorized'` otherwise.
   - Insert one `payment_folio_uploads` row up-front: `(uploaded_by=auth.uid(), file_name, file_size_bytes, sha256, status='completed', row_count=0)`. Capture `v_upload_id`.
   - Loop `FOR elem IN SELECT * FROM jsonb_array_elements(p_rows)`:
     - Extract `row_index, booking_id, payment_type, received_date, reference_text, payment_amount, invoice_number` via `->>`.
     - Validate: `received_date::date` must parse, `payment_amount::numeric > 0`, `payment_type` non-empty.
     - On invalid → append `{row_index, message}` to `v_warnings jsonb`; `v_invalid := v_invalid + 1`; CONTINUE.
     - Derive `v_method` via CASE block per FR-099 mapping table:
       ```
       CASE lower(payment_type)
         WHEN 'upi' THEN 'upi'
         WHEN 'cash' THEN 'cash'
         WHEN 'credit card' THEN 'card'
         WHEN 'debit card' THEN 'card'
         WHEN 'bank transfer' THEN
           CASE
             WHEN reference_text ILIKE '%makemytrip%' OR reference_text ILIKE '%collected by -mmt%' THEN 'mmt_payout'
             ELSE 'bank_transfer'
           END
         WHEN 'imps' THEN 'bank_transfer'
         WHEN 'payment gateway' THEN 'bank_transfer'
         WHEN 'bill to company' THEN 'corporate_credit'
         WHEN 'other' THEN NULL
         ELSE NULL
       END
       ```
       Note: `agoda_payout` / `yatra_payout` mappings are documented in PRD but NOT yet in the `payment_method` CHECK on `payment_entries`. Wait — they ARE in the CHECK on `payment_entries` (see PF-1: `'upi','card','bank_transfer','cash','mmt_payout','agoda_payout','yatra_payout','corporate_credit'`). So the CASE may emit those values. Add the Agoda/Yatra branches under `bank transfer`: ILIKE `%agoda%` → `agoda_payout`; ILIKE `%yatra%` OR `%desiya%` → `yatra_payout`.
     - INSERT into `payment_entries` with `ON CONFLICT ON CONSTRAINT uq_payment_entries_dedup DO NOTHING RETURNING id`.
     - If RETURNING returned null → conflict → `v_skipped := v_skipped + 1`. Else → `v_inserted := v_inserted + 1`.
   - UPDATE `payment_folio_uploads` SET counts + `parse_warnings = v_warnings`.
   - Write `fn_write_audit(auth.uid(), 'payment_folio.upload', 'payment_folio_upload', v_upload_id::text, NULL, jsonb_build_object('file_name', p_file_name, 'sha256', p_sha256, 'inserted', v_inserted, 'skipped', v_skipped, 'invalid', v_invalid), NULL)`.
   - RETURN jsonb: `{ upload_id, row_count, inserted_count, skipped_count, invalid_count, warnings }`.
   - GRANT EXECUTE TO authenticated.

2. **Patch `rpc_resolve_issue_report`** (CREATE OR REPLACE — preserve existing signature + behaviour) — FR-107.
   - After the existing role/status checks but BEFORE the UPDATE, fetch the invoice's reconciliation_status:
     ```sql
     SELECT reconciliation_status INTO v_status
       FROM public.hotel_invoice
      WHERE id = v_row.invoice_id;
     IF v_status NOT IN ('partial','fully_reconciled','flagged_for_review') THEN
       RAISE EXCEPTION 'INVOICE_NOT_RECONCILED: Invoice must be at least partially reconciled before resolving this issue report.';
     END IF;
     ```
   - **Status values are**: `unreconciled | partial | fully_reconciled | flagged_for_review`. Only `unreconciled` blocks.
   - All other behaviour identical to the existing function (see `pg_get_functiondef('rpc_resolve_issue_report')` for the canonical source).

3. **Auto-consume hooks** in 4 reconcile RPCs (CREATE OR REPLACE each):
   - `rpc_reconcile_invoice` (4 args) — after `fn_recompute_invoice_status` and AFTER the link inserts loop, call `fn_consume_payment_entry(p_invoice_id, v_link_id)` for EACH newly-inserted link. Since `rpc_reconcile_invoice` inserts multiple links per call, you must capture each new link id and call the helper per-link.
   - `rpc_reconcile_mmt_invoice` (6 args) — single link inserted; call once with that link id.
   - `rpc_reconcile_yatra_invoice` (8 args) — single link inserted; call once.
   - `rpc_reconcile_agoda_invoice` (8 args) — single link inserted; call once.
   - **Wrap each helper call in `BEGIN ... EXCEPTION WHEN OTHERS THEN ... END`** so a consume failure NEVER fails the parent reconcile transaction. Inside the EXCEPTION block, optionally `RAISE NOTICE 'fn_consume_payment_entry failed: %', SQLERRM` (but do nothing further).

### Smoke tests required (via MCP `execute_sql`, impersonating operator/admin):
- (a) Upload happy path: 3 rows mix of UPI / Cash / Bill To Company → 3 inserted, 0 skipped, 0 invalid. Verify `payment_entries.payment_method` = `upi, cash, corporate_credit`.
- (b) Re-upload same payload → 0 inserted, 3 skipped, 0 invalid (via unique index conflict).
- (c) Upload with an invalid row (negative amount) + valid rows → invalid row warned, valid rows inserted.
- (d) Method mapping spot-check: `Bank Transfer` + reference "Collected By -MakeMyTrip" → `mmt_payout`.
- (e) Insert a `payment_entries` row whose `booking_id` matches a real `hotel_invoice.booking_id`. Reconcile that invoice via `rpc_reconcile_invoice` (cash inline path is simplest). Verify the `payment_entries` row's `consumed_for_invoice_id`, `consumed_at`, `consumed_link_id` populated.
- (f) Reverse-reconcile via `rpc_admin_reverse_reconciliation` → verify the AFTER DELETE trigger cleared the consumed fields.
- (g) Resolve guard: file an issue report on an `unreconciled` invoice, then call `rpc_resolve_issue_report` → expect `INVOICE_NOT_RECONCILED`. Reconcile the invoice partially → call again → expect success.
- (h) `audit_log` shows `payment_folio.upload`, `payment_entry_consumed`, `payment_entry_unconsumed` action types.

### Done when:
- Migration applied; all 8 smoke scenarios PASS; advisors clean (run `mcp__supabase__get_advisors`).
- Context updated in this file.
- Return: COMPLETED / FILES CHANGED / CONTEXT UPDATED / NEXT.

---



## Last Tasks Completed
- A3 Auth users + `user_profiles` (`v1_create_initial_users`)
- B2 `rpc_reconcile_invoice` + `rpc_create_cash_payment` + helpers (`v1_rpc_reconciliation_core`)
- B4 Approval-request creation RPCs (4): `rpc_request_unreconcile_link`, `rpc_request_unreconcile_invoice`, `rpc_request_cash_edit`, `rpc_request_cash_delete`
- B5 Approval-decision RPCs: `rpc_approve_request`, `rpc_reject_request`
- B6 `rpc_admin_reverse_reconciliation`
- B7 `rpc_resolve_discrepancy`
- B8 `rpc_upsert_payment_source_config`
- B9 `rpc_admin_home_summary`
- (Migration `v1_rpc_approvals_and_admin`)
- MMT-2 MMT-payout JSON ingestion pipeline:
  - `src/processors/json_processor.py` (new) — `JsonProcessor` extends `BaseProcessor`, supports `.json`, handles UTF-8 BOM and raises on invalid JSON.
  - `src/processors/factory.py` — registers `JsonProcessor` first in the routing chain.
  - `src/database/mmt_payout_inserter.py` (new) — parses `transfer` + `bookings[]` and inserts into `mmt_payouts` + `mmt_bookings_payout` with idempotent `ON CONFLICT DO NOTHING` semantics. Handles `DD/MM/YYYY` (MMT), ISO, and BOM dates.
  - `src/database/client.py` — adds `insert_mmt_payout_json(file_id, parsed_json)`.
  - `src/main.py` — new `json_direct_insert` branch after OCR-output store; mirrors the `excel_direct_insert` pattern.
  - `src/drive/client.py` — query-builder now ORs MIME + name filters (needed for JSON which sometimes arrives as `text/plain`).
  - `src/drive/discovery.py` — adds `application/json → json` MIME map fallback.
  - `src/config/loader.py` — `json_direct_insert: true` relaxes the requirement for `extraction_prompt` and `fields`.
  - `src/database/table_manager.py` — `ensure_all_tables_exist` now skips doc types with `json_direct_insert: true` or empty fields (their schema is owned by an explicit migration).
  - `config.yaml` — new `mmt_payout` document type with `json_direct_insert: true`.
  - `.env` — `MMT_PAYOUTS=1fhefZhFL81mth-UyeZonug0cfVxUX5-p`.

## End-to-end dry-run (against live Supabase, then cleaned up)
- Created synthetic `files` row, called `insert_mmt_payout_json` twice with the provided sample.
- Run 1: payout_inserted=true, bookings_inserted=1.
- Run 2: payout_existed=true, bookings_skipped=1.
- Verified `mmt_payouts.transaction_date='2026-05-06'` (from `06/05/2026`), amounts persisted as numeric, subject_ref stored.

## RPC Contract
All RPCs:
- SECURITY DEFINER, owned by `postgres`
- Validate `auth.uid()` and role from `user_profiles` (operator/admin)
- Lock source rows via `fn_lock_and_get_source_amount` before mutation
- Use `fn_recompute_invoice_status` to derive `reconciliation_status`
- Call `fn_write_audit` to record changes (always inside the same transaction)
- Raise human-readable Postgres exceptions on invariant violations

### Sentinel error prefixes (frontend handles)
- `PARTIAL_CONFIRMATION_REQUIRED: <message>` → UI shows partial-save dialog
- `OVERPAY_CONFIRMATION_REQUIRED: <message>` → UI shows overpay-flag dialog
- Any other exception → red banner via `prettifyError`

## Inline-cash flow (E4)
The `rpc_reconcile_invoice` accepts a link of shape
`{ source_table: "cash_payments", source_id: null, payment_method: "cash", amount_applied: N, cash_payment_date: "YYYY-MM-DD" }`
and creates the cash row inline, then inserts the reconciliation_link — all in one atomic call.

## Seed Users
- Admin: krishnagopal.kedia@optimoloan.com / `AdminPass123!` (user_id `45bcd1e5-e628-4480-b9c6-08d4b8d936c9`)
- Operator: operator@hotel.local / `OperatorPass123!` (user_id `6e50c4f5-94f4-40ab-b7b3-9919f6138a57`)

## Verified Scenarios
- Partial without confirm → raises `PARTIAL_CONFIRMATION_REQUIRED`
- Partial with confirm → success, audit rows written
- Overpay > 5% → hard error with explicit reduction amount

## [2026-05-23] RI-2 — COMPLETED
- Migration `v1_rpc_issue_reports` applied. Smoke-tested with seeded operator + admin.
- New SECURITY DEFINER RPCs (all owned by postgres, search_path locked, EXECUTE granted to authenticated only):
  - `rpc_create_issue_report(p_invoice_id uuid, p_category text, p_notes text DEFAULT NULL) RETURNS uuid`
  - `rpc_withdraw_issue_report(p_report_id uuid) RETURNS void`
  - `rpc_resolve_issue_report(p_report_id uuid, p_resolution_notes text DEFAULT NULL) RETURNS void`
- New helper functions:
  - `fn_classify_invoice_source(text) → text` (returns 'mmt'|'yatra'|'agoda'|'walkin')
  - `fn_issue_category_allowed(category, source_bucket) → boolean`
- Auto-resolve hook: implemented as an **AFTER UPDATE trigger** `trg_hotel_invoice_after_status_change` on `hotel_invoice.reconciliation_status`. Fires only when OLD<>NEW AND NEW='fully_reconciled'. Calls `fn_auto_resolve_issue_reports(NEW.id, auth.uid())`. This is cleaner than editing 3 existing reconcile RPCs and naturally inherits the caller's `auth.uid()` because the reconcile RPCs run SECURITY DEFINER but `auth.uid()` reads from the session JWT, not the function owner.
- Reverse-reconcile path (BR-047): verified — flipping back to `unreconciled` does NOT re-open. Trigger fires only on the forward transition.
- New view `v_invoice_list_with_issue` (security_invoker=true): `SELECT hi.*, EXISTS(open report)` AS has_open_issue. Frontend should swap the list query to this view.
- Sentinel errors raised:
  - `ISSUE_ALREADY_OPEN: …`
  - `REPORT_NOT_OPEN: report status is …`
  - `Not authorized`
  - `Invalid category for source: <code> is not valid for <bucket>`
  - `Notes required for category 'other'`
  - `Not authenticated`
- Smoke matrix executed (all PASS): create happy path, duplicate rejected, 'other' without notes rejected, mmt-cat on walk-in rejected, operator-resolve rejected, withdraw + re-create, admin resolve happy path, re-resolve already-closed rejected, full-reconcile auto-resolve fired, reverse-reconcile did NOT re-open, view returns correct booleans, all 4 audit action types present.
- Smoke data deleted; invoice statuses restored. Audit_log entries from smoke kept (append-only by design).

## Inbound Task — RI-2 (Report an Issue: RPCs + reconcile-RPC hook) [DONE]
- Issued by PM: 2026-05-23
- Blocked on: RI-1 (database-manager migration `v1_invoice_issue_reports` and helper `fn_auto_resolve_issue_reports`).
- Spec: `prd.md` § "Addendum — Report an Issue (2026-05-23)" — FR-091, FR-092, FR-093, FR-094, FR-098.
- Migration name: `v1_rpc_issue_reports`.
- Build these RPCs (all SECURITY DEFINER, owned by `postgres`, search_path locked):
  1. `rpc_create_issue_report(p_invoice_id uuid, p_category text, p_notes text) RETURNS uuid` — FR-091.
     - Sentinels: `ISSUE_ALREADY_OPEN`, `Invalid category for source`, `Notes required for category 'other'`, `Not authorized`.
     - Category-to-source validation in a CASE block per FR-089. Hard-coded.
     - Writes audit `issue_report_created`.
  2. `rpc_withdraw_issue_report(p_report_id uuid) RETURNS void` — FR-092.
     - Sentinels: `REPORT_NOT_OPEN`, `Not authorized`.
     - Reporter OR admin only. Audit `issue_report_withdrawn`.
  3. `rpc_resolve_issue_report(p_report_id uuid, p_resolution_notes text) RETURNS void` — FR-093.
     - Admin only. Sentinels: `REPORT_NOT_OPEN`, `Not authorized`. Audit `issue_report_resolved`.
- Hook auto-resolve into existing reconcile RPCs:
  - In `rpc_reconcile_invoice`, `rpc_reconcile_mmt_invoice`, `rpc_reconcile_yatra_invoice`: AFTER `fn_recompute_invoice_status`, IF the recomputed status = `fully_reconciled`, CALL `fn_auto_resolve_issue_reports(invoice_id, auth.uid())`. Do NOT touch `rpc_admin_reverse_reconciliation` (BR-047).
- Frontend list integration:
  - Expose `has_open_issue` boolean on the invoice list. Cleanest path: create a `v_invoice_list_with_issue` view that selects from the existing list source + `EXISTS (SELECT 1 FROM invoice_issue_reports WHERE invoice_id = invoice.id AND status='open')` as `has_open_issue`. RLS-friendly. Frontend will query the view.
- Smoke tests (via MCP `execute_sql` impersonating operator/admin JWT):
  - Create → duplicate rejected → withdraw → re-create → admin resolve → re-create → reconcile fully → auto-resolved.
  - Cross-check `audit_log` has all four new action types written.
- Reference seed users (still valid):
  - Admin: krishnagopal.kedia@optimoloan.com (`45bcd1e5-e628-4480-b9c6-08d4b8d936c9`)
  - Operator: operator@hotel.local (`6e50c4f5-94f4-40ab-b7b3-9919f6138a57`)
- Return: COMPLETED / FILES CHANGED / CONTEXT UPDATED / NEXT.

## Status
RI-1 + RI-2 DONE 2026-05-23. Idle. Awaiting QA on RI-3 before frontend (RI-4/RI-5) is fired.
