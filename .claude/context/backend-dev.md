# Backend Dev Context
<!-- Last updated: 2026-06-20 (BUG-001 fix_classify_invoice_source_fallthrough) -->
<!-- Previous: 2026-06-20 (DUP-2 applied) -->

## [2026-06-20] BUG-001 — Fix fn_classify_invoice_source fallthrough — COMPLETED

### What was built
Migration `fix_classify_invoice_source_fallthrough` deployed via `mcp__supabase__apply_migration`.

Two changes in one migration:

#### Change 1: `fn_classify_invoice_source`
- Added explicit `'phone'` bucket: matches `%by phone%`, `%direct%phone%`, `%phone%`.
- Separated the `%direct%` branch: now returns `'walk_in'` only when it does NOT match `%walk%` or `%phone%` first (ordering of IF blocks handles this — walk checked before phone, phone before plain direct).
- Changed fallthrough `ELSE` from `'walk_in'` to `'other'`. Root cause of BUG-001.
- Behaviour preserved for all known OTA sources (mmt/goibibo/makemytrip, yatra/desiya, agoda), walk-in patterns, and blank/null (still `'walk_in'`).

#### Change 2: `rpc_submit_manual_payment_entry` commission eligibility block
- Before: `v_source_bucket IN ('walk_in') OR lower(v_invoice.source) ILIKE '%by phone%' OR ...` — mixed fn + raw ILIKE, phone patterns duplicated.
- After: `v_source_bucket IN ('walk_in', 'phone')` — single call to `fn_classify_invoice_source`, phone patterns now live only in the classifier. Unrecognised sources (`'other'`) are eligible.

### Test results (all PASS)
| Input | Result | Expected |
|---|---|---|
| `'AsiaTech'` | `other` | NOT walk_in |
| `'Direct - Walk-In'` | `walk_in` | walk_in |
| `'Direct - By Phone'` | `phone` | phone |
| `'Cleartrip'` | `other` | other |
| `'Expedia'` | `other` | other |
| `'MakeMyTrip'` | `mmt` | mmt |
| `'Yatra Online'` | `yatra` | yatra |
| `'Agoda'` | `agoda` | agoda |
| `''` (empty) | `walk_in` | walk_in |
| `NULL` | `walk_in` | walk_in |
| `'Direct'` (alone) | `walk_in` | walk_in |
| `'Corporate Travel'` | `other` | other |

### Files changed (DB only — no source files)
- Supabase migration: `fix_classify_invoice_source_fallthrough`
- Functions updated: `fn_classify_invoice_source`, `rpc_submit_manual_payment_entry`

### Sentinel errors unchanged
- `WRITEOFF_SOURCE_NOT_ELIGIBLE` still raised for `walk_in` and `phone` buckets only.

## [2026-06-20] DUP-2 — Atomic File Pickup + Duplicate Invoice Guard — COMPLETED

### What was built
Two separate race-condition fixes for the 8-worker parallel pipeline.

#### 2a. `rpc_claim_next_files(p_limit int)` — Supabase migration `dup2_claim_next_files_rpc`
- `RETURNS SETOF files` (all columns) so `FileRecord.from_dict` works unchanged.
- `SECURITY DEFINER`, `search_path = public, pg_temp`, `GRANT EXECUTE TO service_role`.
- Body: CTE selects `status='pending'` rows ordered by `created_at LIMIT p_limit FOR UPDATE SKIP LOCKED`, then UPDATEs those rows to `status='processing', updated_at=NOW()`, RETURNING `f.*`.
- Workers that lose the lock race skip those rows immediately (SKIP LOCKED) rather than blocking.

#### 2b. `get_pending_files` updated — `src/database/client.py`
- **Before:** plain `SELECT * FROM files WHERE status='pending'` — all 8 workers fetched the same list simultaneously.
- **After:** calls `self.client.rpc('rpc_claim_next_files', {'p_limit': batch_limit})`. Each worker invocation returns only rows it has atomically claimed.
- Failed-files path unchanged (plain SELECT on terminal rows — no race risk).
- `batch_limit=100` default; matches expected daily volume.
- `process_file`'s `update_file_status(PROCESSING)` at the top is now a no-op for claimed rows (idempotent).

#### 2c. `DuplicateInvoiceError` + catch in `insert_document_extraction` — `src/database/client.py`
- New exception class `DuplicateInvoiceError(invoice_number, file_id)` defined at module level.
- In `insert_document_extraction`: when `main_table_name == 'hotel_invoice'` and the exception message contains `'hotel_invoice_invoice_number_unique'` or `'23505'` (PG UNIQUE violation code), emits structured `logger.warning("DUPLICATE_INVOICE_INSERT_SKIPPED", extra={file_id, invoice_number, constraint, table})` then raises `DuplicateInvoiceError`.
- Re-export added to `src/database/__init__.py`.

#### 2d. `DuplicateInvoiceError` handler in `process_file` — `src/main.py`
- New `except DuplicateInvoiceError as dup_err:` block BEFORE the generic `except Exception`.
- Logs `logger.warning("DUPLICATE_INVOICE_SKIPPED", extra={file_id, file_name, invoice_number, constraint})`.
- Writes `processing_logs` row with `duplicate_invoice_number` detail.
- Calls `update_file_status(FAILED, error_message="Duplicate invoice_number: X", increment_retry=False)`.
- Does NOT re-raise — worker continues to next file.
- Import: `from database.client import DatabaseClient, DuplicateInvoiceError`.

### Smoke tests
- RPC `SECURITY DEFINER=true`, `search_path=[public,pg_temp]` — PASS (verified via `pg_proc`).
- `SELECT count(*) FROM rpc_claim_next_files(0)` — returns 0, no error — PASS.
- Constraint name `hotel_invoice_invoice_number_unique` confirmed on `hotel_invoice` table — PASS.

### Files changed
- `src/database/client.py` — `get_pending_files` rewrite, `DuplicateInvoiceError` class, `insert_document_extraction` duplicate catch
- `src/database/__init__.py` — re-export `DuplicateInvoiceError`
- `src/main.py` — import `DuplicateInvoiceError`, new handler in `process_file`
- Supabase migration: `dup2_claim_next_files_rpc`

### Known limitations / notes
- The `failed`-files path still uses a plain SELECT. A race between two runs retrying the same `failed` row is low-risk (last-writer-wins on the `processing` status transition) and would ultimately be caught by the `DuplicateInvoiceError` guard anyway.
- PostgREST wraps PG exceptions as plain Python exceptions. The duplicate detector checks both the constraint name string and the `23505` code string in the exception message. If PostgREST changes its error serialization format this detection logic would need updating.

---

## [2026-06-20] MPE-2 + CDW-2 — Manual Payment Entry RPCs — COMPLETED
- Migration `mpe_cdw_rpcs` applied via Supabase MCP `apply_migration`.
- 6 new SECURITY DEFINER RPCs (all owned by postgres, search_path=public,pg_temp, EXECUTE granted to authenticated):

### RPCs built:
1. **`rpc_submit_manual_payment_entry(p_invoice_id, p_payment_type, p_amount, p_transaction_date, [p_settlement_date, p_vpa, p_upi_transaction_id, p_party_name, p_note]) RETURNS jsonb`**
   - Any operator or admin may call.
   - Branches on payment_type: upi | another_machine | commission | tds.
   - UPI: requires settlement_date + vpa + upi_transaction_id; cross-checks bank_statement (AYH059 UPI SETTLEMENT narration) and infers card_settlement_id from existing upi_transactions; populates admin_flags with NO_BANK_CREDIT and/or MPR_LINK_UNVERIFIED.
   - another_machine: no UPI fields needed; inserts pending entry.
   - commission/tds: requires party_name; commission blocks walk_in source via fn_classify_invoice_source; checks remaining gap from reconciliation_links.
   - Returns {entry_id, status:'pending', admin_flags:[...]}.

2. **`rpc_approve_manual_payment_entry(p_entry_id, [p_note]) RETURNS jsonb`**
   - Admin only.
   - UPI with valid card_settlement_id: inserts into upi_transactions, links to reconciliation_links (source_table='upi_transactions').
   - UPI with NULL card_settlement_id (MPR_LINK_UNVERIFIED flag): links to reconciliation_links (source_table='manual_payment_entries') — cannot insert upi_transactions because card_settlement_id is NOT NULL on that table.
   - another_machine: links to reconciliation_links (source_table='manual_payment_entries', payment_method='upi').
   - commission/tds: re-checks gap; links to reconciliation_links (payment_method = entry.payment_type).
   - All paths: calls fn_recompute_invoice_status, writes audit manual_payment.approve.
   - Returns {entry_id, status:'approved'}.

3. **`rpc_reject_manual_payment_entry(p_entry_id, p_reason) RETURNS jsonb`**
   - Admin only. Requires non-empty reason. Raises ENTRY_NOT_PENDING if not pending.
   - Returns {entry_id, status:'rejected'}.

4. **`rpc_get_manual_payment_entries(p_invoice_id) RETURNS jsonb`**
   - Any authenticated user. Enforces same visibility logic as RLS policy (submitted_by = auth.uid() OR is_admin()) explicitly inside SECURITY DEFINER body.
   - Joins auth.users for submitter_email.
   - Returns {entries:[...]} ordered by submitted_at DESC.

5. **`rpc_get_pending_manual_payments([p_status='pending']) RETURNS jsonb`**
   - Admin only. Accepts any status value for flexibility (e.g. 'rejected' for audit review).
   - Joins hotel_invoice for invoice_number + guest_name, auth.users for submitter_email.
   - Returns {entries:[...]} ordered by submitted_at DESC.

6. **`rpc_get_deductions_report([p_date_from, p_date_to, p_type, p_party]) RETURNS jsonb`**
   - Any authenticated operator or admin.
   - Filters approved commission/tds entries; supports date range on reviewed_at, type filter, party ILIKE.
   - Returns {rows:[{invoice_number, guest_name, source, payment_type, party_name, amount, approved_date}], totals:[{payment_type, party_name, total}]}.

### Key schema discoveries:
- `upi_transactions.card_settlement_id` is NOT NULL (FK to card_settlement). When card_settlement_id cannot be inferred (MPR_LINK_UNVERIFIED case), the approve path falls back to source_table='manual_payment_entries' instead of inserting a upi_transactions row.
- `reconciliation_links` has 8 columns: id, invoice_id, source_table, source_id, payment_method, amount_applied, created_by (NOT NULL), created_at.
- `fn_classify_invoice_source` returns 'walk_in' (with underscore) — consistent with RI-3 update.

### Smoke tests (all PASS):
- All 6 functions: SECURITY DEFINER=true, search_path=[public,pg_temp] — PASS.
- Grants: EXECUTE on authenticated — PASS; auth guard rejects auth.uid()=NULL with 'Not authenticated' — PASS.
- commission/tds/another_machine table inserts: 3 entries inserted + rolled back cleanly — PASS.
- E2E approval flow (direct): commission entry inserted, reconciliation_link created (commission method, manual_payment_entries source), fn_recompute_invoice_status called, cleanup restored invoice to partial — PASS.
- rpc_get_deductions_report query shape: returns {rows:[], totals:[]} for empty state — PASS.
- rpc_get_pending_manual_payments query shape: returns {entries:[]} for empty state — PASS.
- Zero leftover smoke data — PASS.

### Sentinel errors:
- `INVALID_PAYMENT_TYPE`
- `AMOUNT_MUST_BE_POSITIVE`
- `MANUAL_UPI_FIELDS_REQUIRED`
- `MANUAL_UPI_EXCEEDS_BANK_CREDIT`
- `PARTY_REQUIRED`
- `WRITEOFF_SOURCE_NOT_ELIGIBLE`
- `WRITEOFF_EXCEEDS_GAP`
- `ENTRY_NOT_PENDING`
- `REASON_REQUIRED`
- `Not authenticated`
- `Not authorized`

## Status
MPE-2 + CDW-2 DONE 2026-06-20. Frontend MPE-3 / CDW-3 unblocked.

---

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
