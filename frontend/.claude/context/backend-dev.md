# Backend Dev Context
<!-- Last updated: 2026-05-23 09:30 -->

## What I've Built

### [2026-05-17] Phase B2 — rpc_reconcile_invoice + helpers
- Migration: `v1_rpc_reconciliation_core`
- Core ACID reconciliation RPC. Locks source rows, validates remaining, enforces ≤5% overpay rule, requires `confirm_partial`/`confirm_overpay`, creates `discrepancies` on flagged overpay, writes audit. Inline cash-payment creation (E4). Helpers: `fn_recompute_invoice_status`, `fn_lock_and_get_source_amount`, `rpc_create_cash_payment`.

### [2026-05-17] Phase B4–B9 — Approval, admin, and utility RPCs
- Migration: `v1_rpc_approvals_and_admin`
- 9 RPCs: `rpc_request_unreconcile_link`, `rpc_request_unreconcile_invoice`, `rpc_request_cash_edit`, `rpc_request_cash_delete`, `rpc_approve_request`, `rpc_reject_request`, `rpc_admin_reverse_reconciliation`, `rpc_resolve_discrepancy`, `rpc_upsert_payment_source_config`, `rpc_admin_home_summary`.

### [2026-05-17] Phase A3 — Users
- Admin: krishnagopal.kedia@optimoloan.com — user_id `45bcd1e5-e628-4480-b9c6-08d4b8d936c9`
- Operator: operator@hotel.local — user_id `6e50c4f5-94f4-40ab-b7b3-9919f6138a57`

### [2026-05-17] Phase MMT-2 — MMT JSON ingestion pipeline
- Files: `src/processors/json_processor.py`, `src/database/mmt_payout_inserter.py`
- Wired into factory, config.yaml, main.py, drive client.

### [2026-05-17] Phase M2 — MMT Direct Reconcile RPCs
- Migrations: `mmt_direct_reconcile_rpcs`, `mmt_direct_reconcile_rpcs_role_guard_fix`
- 5 RPCs: `rpc_get_mmt_reconcile_candidates`, `rpc_get_mmt_reconcile_detail`, `rpc_update_mmt_invoice_fields`, `rpc_update_mmt_bookings_payout_fields`, `rpc_reconcile_mmt_invoice`.

### [2026-05-23] Phase RI-2 — Issue Report RPCs
- Migration: `v1_rpc_issue_reports`
- 3 RPCs: `rpc_create_issue_report`, `rpc_withdraw_issue_report`, `rpc_resolve_issue_report`
- 2 helpers: `fn_classify_invoice_source`, `fn_issue_category_allowed`
- Auto-resolve trigger on `hotel_invoice`
- View: `v_invoice_list_with_issue`
- All 11 smoke scenarios passed.

### [2026-05-23] Phase PF-2 — Payment Folio RPCs + resolve guard + consume hooks
- Migrations: `pf_rpcs_payment_folio`, `pf_rpcs_payment_folio_fix_status`, `pf_rpcs_payment_folio_fix_conflict`
- **`rpc_upload_payment_folio(p_file_name TEXT, p_file_size_bytes INT, p_sha256 TEXT, p_rows JSONB) RETURNS jsonb`**
  - Role-guarded (operator/admin). Validates each row (date, amount, type). Derives `payment_method` from `payment_type` with OTA hint detection in `reference_text`. Pre-checks dedup against unique index expression. Returns `{upload_id, inserted, skipped_duplicates, total, invalid_count, warnings}`.
  - Inserts into `payment_folio_uploads` (status='completed' to satisfy CHECK constraint) then updates counts after loop.
- **`rpc_get_payment_suggestions(p_invoice_id UUID) RETURNS jsonb`**
  - Role-guarded. Looks up invoice's `booking_id` and `invoice_number`. Returns unconsumed `payment_entries` matching either key. Max 20 rows, ordered by `received_date DESC, created_at DESC`. Returns `match_type: "booking_id" | "invoice_number"`.
- **`rpc_resolve_issue_report` — updated** with `INVOICE_NOT_RECONCILED` guard: checks `hotel_invoice.reconciliation_status` for the report's invoice; raises if `unreconciled` or NULL.
- **`rpc_reconcile_invoice` — updated**: calls `fn_consume_payment_entry(p_invoice_id, last_link_id)` after recomputing status, wrapped in best-effort EXCEPTION block.
- **`rpc_reconcile_mmt_invoice` — updated**: calls `fn_consume_payment_entry(p_hotel_invoice_id, v_new_link_id)` before audit write.
- **`rpc_reconcile_yatra_invoice` — updated**: same consume hook.
- **`rpc_reconcile_agoda_invoice` — updated**: same consume hook.

## Current State

### APIs / RPCs
| RPC | Purpose | Auth |
|-----|---------|------|
| `rpc_reconcile_invoice` | Walk-in reconcile (multi-link) | operator/admin |
| `rpc_reconcile_mmt_invoice` | MMT payout reconcile | operator/admin |
| `rpc_reconcile_yatra_invoice` | Yatra payout reconcile | operator/admin |
| `rpc_reconcile_agoda_invoice` | Agoda payout reconcile | operator/admin |
| `rpc_create_cash_payment` | Inline cash payment create | operator/admin |
| `rpc_request_unreconcile_link` | Operator unreconcile request | operator/admin |
| `rpc_request_unreconcile_invoice` | Operator unreconcile request | operator/admin |
| `rpc_request_cash_edit` | Cash edit request | operator/admin |
| `rpc_request_cash_delete` | Cash delete request | operator/admin |
| `rpc_approve_request` | Admin approve | admin |
| `rpc_reject_request` | Admin reject | admin |
| `rpc_admin_reverse_reconciliation` | Admin hard reverse | admin |
| `rpc_resolve_discrepancy` | Admin mark discrepancy resolved | admin |
| `rpc_upsert_payment_source_config` | Update method→table mapping | admin |
| `rpc_admin_home_summary` | Dashboard summary | admin |
| `rpc_get_mmt_reconcile_candidates` | MMT candidate bookings | operator/admin |
| `rpc_get_mmt_reconcile_detail` | MMT booking detail | operator/admin |
| `rpc_update_mmt_invoice_fields` | Edit MMT invoice line items | operator/admin |
| `rpc_update_mmt_bookings_payout_fields` | Edit MMT payout line items | operator/admin |
| `rpc_get_bank_statement_view` | Bank statement paginated view | operator/admin |
| `rpc_get_bank_statement_drilldown` | Drill into bank row | operator/admin |
| `rpc_get_yatra_reconcile_candidates` | Yatra candidate vouchers | operator/admin |
| `rpc_get_yatra_reconcile_detail` | Yatra voucher detail | operator/admin |
| `rpc_update_yatra_bookings_payout_fields` | Edit Yatra payout fields | operator/admin |
| `rpc_create_issue_report` | File issue on invoice | operator/admin |
| `rpc_withdraw_issue_report` | Withdraw own issue report | operator/admin |
| `rpc_resolve_issue_report` | Admin resolve report (with INVOICE_NOT_RECONCILED guard) | admin |
| `rpc_upload_payment_folio` | Bulk-insert payment_entries from Excel parse | operator/admin |
| `rpc_get_payment_suggestions` | Return unconsumed payment_entries for invoice | operator/admin |

### Key schema facts (payment_entries)
- Actual column names: `payment_type_raw`, `received_date`, `invoice_number_raw` (NOT `payment_type`, `transaction_date`, `invoice_number`)
- Consumed tracking: `consumed_for_invoice_id` / `consumed_link_id` / `consumed_at` (NOT `is_consumed`)
- Unique index `uq_payment_entries_dedup` is an **expression index** (not a named UNIQUE constraint). Must use pre-check SELECT EXISTS for duplicate detection, NOT `ON CONFLICT ON CONSTRAINT`.
- `payment_folio_uploads.status` CHECK only allows: `completed`, `partial`, `failed` (no `processing`).
- `fn_consume_payment_entry(p_invoice_id, p_link_id)` was already created in PF-1 by database-manager.

### Integrations live
- Supabase project via MCP
- Google Drive ingestion pipeline (Python, src/)
- MMT JSON ingestion pipeline (src/)

## Pending / In Progress
- PF-3 (QA gate on PF-1 + PF-2) — NEXT
- RI-3 (QA gate on RI-1 + RI-2) — NEXT (parallel)
- Y3 RPCs for Yatra — after Y1/Y2

## Decisions Log

### [2026-05-17] Inline cash creation inside rpc_reconcile_invoice
- Achieves true atomicity; keeps frontend simple.

### [2026-05-17] fn_* helpers have EXECUTE revoked from anon/authenticated
- Prevents direct REST calls; RPCs still call them via owner-level rights.

### [2026-05-17] Error sentinels use prefix pattern (PARTIAL_CONFIRMATION_REQUIRED etc.)
- Lets UI translate to confirmation dialogs without re-implementing business logic.

### [2026-05-23] payment_folio_uploads.status='completed' on insert (not 'processing')
- The CHECK constraint only allows completed/partial/failed. We insert with 'completed' and update counts at end of row-loop, which is safe (one upload record per call, not concurrent).

### [2026-05-23] Dedup via SELECT EXISTS, not ON CONFLICT ON CONSTRAINT
- `uq_payment_entries_dedup` is a unique expression index, not a named UNIQUE constraint. `ON CONFLICT ON CONSTRAINT <name>` only works for named constraints. Pre-check SELECT EXISTS matching all 6 COALESCE expressions is functionally equivalent.

### [2026-05-23] fn_consume_payment_entry wrapped in best-effort EXCEPTION block in all 4 reconcile RPCs
- Consumption is an ancillary side-effect; should never fail a reconciliation. RAISE WARNING logs but does not roll back.

### [2026-05-23] rpc_upload_payment_folio signature has 4 params (not 1)
- Task spec described a simplified `(p_rows jsonb)` signature, but the real `payment_folio_uploads` table has NOT NULL columns for `file_name`, `file_size_bytes`, `sha256`. Full signature: `(p_file_name TEXT, p_file_size_bytes INT, p_sha256 TEXT, p_rows JSONB)`.

## Notes for Product Manager

- **PF-2 migration naming**: Three migrations applied (`pf_rpcs_payment_folio`, `pf_rpcs_payment_folio_fix_status`, `pf_rpcs_payment_folio_fix_conflict`) due to iterative fixes during schema discovery. All are in place and the final function versions are correct.
- **rpc_upload_payment_folio signature differs from task spec**: The task spec said `(p_rows jsonb)` but the real DB table requires file metadata (name, size, sha256). Frontend must pass all 4 params. The PF-4 frontend spec already has the correct 4-param call.
- **Pre-existing security advisor ERRORs**: All 27 ERRORs were pre-existing (pipeline tables with intentionally disabled RLS — mmt_payouts, yatra_bookings_payout, agoda_bookings_payout, etc.). No new errors introduced by PF-2.
- **Verification results**:
  - All 3 new RPCs present: PASS
  - Insert 1 UPI row: inserted=1, skipped_duplicates=0: PASS
  - Re-insert same row: inserted=0, skipped_duplicates=1: PASS
  - resolve_issue_report on unreconciled invoice: INVOICE_NOT_RECONCILED raised: PASS
