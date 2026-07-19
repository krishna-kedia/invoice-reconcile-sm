# Execution Log
## Hotel Invoice Reconciliation System

<!-- Last updated: 2026-07-19 -->

### Status: V1 BUILD COMPLETE on all major surfaces.
- Walk-in / MMT / Yatra / Agoda reconcile panels live.
- Bank Statement view (BS-1/BS-2) shipped with drill-down attribution v2 (BS-v2) and visual polish (BS-Polish).
- Phase RI (Report an Issue) live end-to-end including configurable categories.
- Phase PF (Payment Folio Upload + Auto-select + Resolve guard) live end-to-end.
- MIS dashboard with MMT and Yatra monthly deductions live.
- 51 SECURITY DEFINER RPCs deployed (`rpc_*`). 12 helper functions. 7 triggers including append-only audit log immutability and auto-resolve on full reconciliation.
- 6 views: `v_transactions_with_remaining`, `v_mis_monthly_summary`, `v_mis_payment_detail`, `v_mmt_monthly_deductions`, `v_yatra_monthly_deductions`, `v_invoice_list_with_issue`.
- Frontend: Next.js 14 app at `frontend/`, 17 routes, build clean, `tsc --noEmit` clean.
- Deployed to Vercel; GitHub Actions running the OCR backend.

Pending: QA sweeps on PF-3, PF-6, M4, BS-3, BS-Polish-3, BS-v2-3, Y6. RLS hardening on 14 pipeline tables. Designer-polish passes on issue UI + payment-folio upload (RI-6, PF-5).

---

## Completed Work (chronological)

### Phase A — Foundations (2026-05-17 13:30 – 14:35)

#### [2026-05-17 13:30] A1 — `v1_reconciliation_core_tables`
- Agent: database-manager (PM-driven via Supabase MCP).
- Created 7 V1 tables: `user_profiles`, `cash_payments`, `reconciliation_links`, `approval_requests`, `discrepancies`, `payment_source_config`, `audit_log`.
- Added `reconciliation_status text` column to `hotel_invoice` (default `unreconciled`).
- `audit_log` REVOKE UPDATE/DELETE from public/authenticated/anon/service_role + BEFORE UPDATE/DELETE trigger `audit_log_block_mutation` raising `audit_log is append-only`.

#### [2026-05-17 13:35] A2 — `v1_seed_payment_source_config`
- 6 default mapping rows inserted (UPI/Card/Bank Transfer/Cash with their canonical source tables).

#### [2026-05-17 13:38] A5 — `v1_audit_helper_function`
- `fn_write_audit(actor, action, entity_type, entity_id, before, after, context)` deployed.

#### [2026-05-17 13:40] B1 — `v1_transactions_with_remaining_view`
- `v_transactions_with_remaining` over `upi_transactions`, `card_transactions`, `bank_statement` (credits only), `cash_payments` with `remaining` calc.
- Later hardened to `WITH (security_invoker = true)` via `v1_security_hardening`.

#### [2026-05-17 13:55] A3 — `v1_create_initial_users`
- Admin `krishnagopal.kedia@optimoloan.com / AdminPass123!` (uid `45bcd1e5-…`).
- Operator `operator@hotel.local / OperatorPass123!` (uid `6e50c4f5-…`).
- Matching `user_profiles` rows; reset on first prod use.

#### [2026-05-17 14:00] A4 — `v1_rls_policies`
- RLS enabled on all 17 V1 tables.
- Helpers `current_user_role()`, `is_admin()`, `is_operator_or_admin()`.
- Read policies for both roles where appropriate; operator sees own `approval_requests`/`discrepancies`, admin sees all.
- Direct INSERT/UPDATE/DELETE revoked from `authenticated` on every sensitive table — mutations flow through SECURITY DEFINER RPCs.

#### [2026-05-17 14:10] B2 — `v1_rpc_reconciliation_core`
- Core ACID `rpc_reconcile_invoice(p_invoice_id, p_links jsonb, p_confirm_partial, p_confirm_overpay)`.
- Helpers `fn_lock_and_get_source_amount`, `fn_recompute_invoice_status`.
- Inline-cash path via `rpc_create_cash_payment` and the `cash_payments` arm of `rpc_reconcile_invoice` (E4 alternative — single-call atomicity).

#### [2026-05-17 14:15] B4..B9 — `v1_rpc_approvals_and_admin`
- `rpc_request_unreconcile_link`, `rpc_request_unreconcile_invoice`, `rpc_request_cash_edit`, `rpc_request_cash_delete`.
- `rpc_approve_request`, `rpc_reject_request`.
- `rpc_admin_reverse_reconciliation`, `rpc_resolve_discrepancy`.
- `rpc_upsert_payment_source_config`, `rpc_admin_home_summary`.
- All SECURITY DEFINER, role-checked, audit-logged.

#### [2026-05-17 14:35] Security hardening — `v1_security_hardening`
- `v_transactions_with_remaining` rebuilt as `security_invoker = true`.
- EXECUTE on `fn_write_audit`, `fn_lock_and_get_source_amount`, `fn_recompute_invoice_status` revoked from anon/authenticated; RPCs invoke them via owner rights.
- `current_user_role()`, `is_admin()`, `is_operator_or_admin()` no longer callable by `anon`.
- Older trigger functions now have immutable `search_path`.

### Phase D + E — Frontend scaffold + all V1 pages (2026-05-17 14:20 – 14:35)

#### D1 — Next.js scaffold
- `create-next-app` (TS, Tailwind, App Router, `src/`).
- Deps: `@supabase/supabase-js`, `@supabase/ssr`, `@tanstack/react-query`, `zod`, `date-fns`, `react-hook-form`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`.
- `.env.local` populated.

#### D2 — Supabase client wrappers
- `src/lib/supabase/{client,server,middleware}.ts` using `@supabase/ssr`.
- Shared domain types in `src/lib/types.ts`.

#### D3 — Auth pages + middleware
- `/login` with role-based redirect.
- `src/middleware.ts` enforces auth, blocks operators from `/admin/*`.
- `LogoutButton` in shell header.

#### D4 — App shell
- `src/app/(app)/layout.tsx` with role-aware top header + left nav.
- shadcn-style primitives: `Button`, `Input`, `Card`, `Badge`, `Table`, `Select`, `Label`, `Dialog`, `Toast`, `Textarea`.

#### E1..E9 — All V1 pages
- E1: `invoices/page.tsx` — paginated list, tabs (walk-in / OTA), filters, server pagination 50/page, status badges, click-through.
- E2 + E3 + E4: `invoices/[id]/page.tsx` (server) + `detail-client.tsx` (client) — all invoice fields, outstanding calc, linked-payments table, `AddPaymentPanel` with method/date selector, transaction picker (greyed for `remaining=0`, click-to-pick modal, smart default), session linked-payments list, single Save with partial/overpay dialogs. Cash via inline-cash RPC path. Audit collapsible at bottom.
- E5: `admin/page.tsx` — 8 tiles from `rpc_admin_home_summary`.
- E6: `admin/approvals/page.tsx` — pending/decided tabs, approve/reject drawer.
- E7: `admin/discrepancies/page.tsx` — Mark Resolved / Reverse Reconciliation drawer.
- E8: `audit/page.tsx` — filters + row expansion with before/after JSON.
- E9: `admin/settings/payment-sources/page.tsx` — method × source-table matrix.

### Phase MMT — OCR pipeline for MMT payout JSON (2026-05-17)

#### MMT-1 — `mmt_payouts_and_bookings_payout_tables` migration
- `mmt_payouts` (PK `transaction_no`, FK `files`).
- `mmt_bookings_payout` (FK `mmt_payouts(transaction_no)` ON DELETE CASCADE, `UNIQUE(transaction_no, booking_id)`).
- Indexes on `file_id`, `transaction_date`, `subject_ref`, `booking_id`, `check_in`, `check_out`.
- RLS explicitly disabled (pipeline tables).

#### MMT-2 — JSON ingestion pipeline
- New: `src/processors/json_processor.py`, `src/database/mmt_payout_inserter.py`.
- Modified: `src/processors/factory.py`, `src/database/client.py`, `src/main.py`, `src/drive/client.py`, `src/drive/discovery.py`, `src/database/table_manager.py`, `src/config/loader.py`, `config.yaml`, `.env`.
- `JsonProcessor` registered first; handles UTF-8 BOM; raises on malformed JSON.
- `insert_mmt_payout_json(file_id, parsed_json)` — idempotent insert of payout + bookings with pre-check + `ON CONFLICT`-safe per-row fallback.
- `json_direct_insert` branch in `main.py`: success → file `completed`, exception → `failed`.
- Drive list query ORs MIME + name filters so JSON uploaded as `text/plain` is picked up.
- End-to-end dry-run against live Supabase (synthetic `9999999999-TEST` row, cleaned up) PASSED — run 1 inserted, run 2 idempotent.

### Phase M — MMT Direct Reconcile (2026-05-17 21:35)

#### M1 — `mmt_direct_reconcile_schema`
- `mmt_invoice` + `mmt_bookings_payout` each get `reconciled_at TIMESTAMPTZ NULL` and `reconciled_link_id UUID NULL REFERENCES reconciliation_links(id) ON DELETE SET NULL`.
- `reconciliation_links.payment_method` and `payment_source_config.payment_method` CHECK extended with `'mmt_payout'`.
- Seed `('mmt_payout','bank_statement', true)` into `payment_source_config`.
- AFTER DELETE trigger `trg_mmt_clear_reconciled_at_on_link_delete` clears both back-pointers when a link is removed.
- Partial indexes `idx_mmt_invoice_unreconciled` and `idx_mmt_bookings_payout_unreconciled` for dropdown speed.

#### M2 — `mmt_direct_reconcile_rpcs` + `_role_guard_fix`
- 5 RPCs deployed (all SECURITY DEFINER, role-checked, audit-logged):
  - `rpc_get_mmt_reconcile_candidates(p_hotel_invoice_id uuid)`
  - `rpc_get_mmt_reconcile_detail(p_booking_id text)` — 5 sentinels.
  - `rpc_update_mmt_invoice_fields(p_id uuid, p_fields jsonb)`.
  - `rpc_update_mmt_bookings_payout_fields(p_id uuid, p_fields jsonb)`.
  - `rpc_reconcile_mmt_invoice(...)` — atomic; partial/overpay sentinels; bank-row `chq_ref_no ILIKE '%transaction_no%'` match.
- Role-guard fix migration patched NULL-safe role checks.
- Smoke (as authenticated operator): SUCCESS on `NH12101480322876`. Detail RPC returned `computed_payable=3999.60, payout_payable=4000.00, diff=-0.40, match_within_tolerance=true`, bank deposit ₹4000 with ₹4000 remaining.

#### M3 — Frontend `MmtReconcilePanel`
- New: `frontend/src/app/(app)/invoices/[id]/mmt-reconcile-panel.tsx`.
- Modified: `frontend/src/lib/types.ts` (added `mmt_payout` PaymentMethod + 5 MMT types), `detail-client.tsx` (conditional render for MMT/Goibibo).
- `npm run build` clean (13 routes); `tsc --noEmit` clean.

#### Follow-ups (2026-05-17 16:42, 17:08)
- `mmt_candidates_name_automatch` migration — guest-name fallback for `default_booking_id`.
- `mmt_net_receivable_and_monthly_deductions` migration — `v_mmt_monthly_deductions` view.

### Phase BS — Bank Statement View (2026-05-18)

#### BS-1 — `bank_statement_view_rpcs`
- `rpc_get_bank_statement_view(p_date_from, p_date_to, p_narration, p_chq_ref, p_methods text[], p_invoice_number, p_amount_min, p_amount_max, p_drill_types text[], p_page int, p_page_size int)` — FR-067..FR-072.
- `rpc_get_bank_statement_drilldown(p_bank_statement_id uuid, p_drill_type text)` — FR-070.
- Both SECURITY DEFINER, role-checked, no audit (read-only). EXECUTE granted to `authenticated`.
- Smoke: UPI settlement (`d4bb2dbd-…`, ₹26817.82) and Card settlement (`28e7940c-…`, ₹82402.16) — drill-downs returned correct constituent transactions with `net_after_mdr` computed (e.g., ₹4095 × 0.985 = ₹4033.58). MMT drill on `d32e08ce-…` returned 2 bookings linked by `transaction_no` substring.

#### BS-2 — `/bank-statement` page
- New: `frontend/src/app/(app)/bank-statement/page.tsx` (server) + `bank-statement-client.tsx` (client) + `DrillDown` component.
- Nav entry added for both roles between Invoices and Audit Log.
- `xlsx@0.18.5` installed for Excel export.
- `BankStatementRow` + drill types added to `lib/types.ts`.
- `npm run build` clean (14 routes, `/bank-statement` 6.62 kB); `tsc --noEmit` clean.

#### BS-Polish — `(2026-05-19)`
- Drop `max-w-7xl` from `(app)/layout.tsx` header + main container — full-width app-wide.
- Designer-spec Tailwind classes for pastel green / yellow row tints.
- Row-level click toggles expansion (with `stopPropagation` on the invoice `<Link>` so navigation still works); cursor-pointer hover.
- Amber left-border dropped — tint is the single status signal.
- Tint computed at `bank_id` level (one `Map<bank_id, sum/deposit>`), applied to all split rows in the group.
- Filter-control treatment polished to match input rhythm.

### Phase BS-v2 — Drill-down attribution (2026-05-19 + 2026-05-23)

#### `bank_statement_attribution_and_total_applied` (2026-05-18)
- First pass at attribution + total applied on drill-down rows.

#### `bank_statement_drilldown_attribution_v2` (2026-05-23)
- `rpc_get_bank_statement_drilldown` returns per-sub-row `reconciled_invoices[] {hotel_invoice_id, invoice_number, amount_applied}`, `applied_total numeric`, `base_amount numeric`.
- `base_amount` per type: UPI `upi_transactions.amount`; Card `gross_amount × (1 − mdr_percent/100)`; MMT `mmt_bookings_payout.payable`; Yatra `yatra_bookings_payout.yatra_to_pay_hotel`.
- Backward-compatible: all prior fields preserved. UPI/Card sub-rows now emit exactly one row containing the full attribution array (previously could duplicate).
- Smoke: UPI bank_id `eb67085a-…` returned 2 sub-rows (first reconciled to 2 invoices, sum=base_amount; second empty). Card bank_id `af55eaa2-…` returned 1 sub-row (`base_amount=4236.53, applied_total=4275`). MMT bank_id `07d12605-…` returned 3 sub-rows (2 reconciled, 1 unreconciled).
- Frontend `bank-statement-client.tsx` DrillDown updated to render the new "Reconciled To" column + sub-row tints reusing the BS-Polish classes.

### Phase Y — Yatra reconcile (2026-05-18 → 2026-05-19)

#### Y1 — `yatra_payout_schema` (2026-05-18) + RLS-disable migration
- `yatra_bookings_payout` table per FR-076 v2 with ALL JSON fields incl. `raw_json`, `source_file_name`, `drive_file_id`, `parsed_at`.
- Indexes: `voucher_no`, `lower(guest_name)`, `email_date`, partial `WHERE reconciled_at IS NULL`.
- RLS disabled (pipeline pattern).
- AFTER DELETE trigger `trg_yatra_clear_reconciled_at_on_link_delete`.
- **`UNIQUE(voucher_no)` constraint DROPPED** (supersedes the earlier morning spec).

#### Y2 — Yatra inserter (backend Python)
- `src/database/yatra_payout_inserter.py` — `insert_yatra_payout_json(file_id, parsed_json)`:
  1. Pre-insert duplicate check on `voucher_no`.
  2. If exists → `logger.warning` + skip + return None.
  3. Else → plain `INSERT` (no `ON CONFLICT`).
- Wired into `factory.py`, `client.py`, `main.py`, `table_manager.py`. `config.yaml` entry `yatra_payout` (`json_direct_insert: true`, drive folder env `YATRA_PAYOUTS`).

#### Y3 — `yatra_rpcs` migration (2026-05-18)
- 4 RPCs deployed (all SECURITY DEFINER, role-checked, audit-logged):
  - `rpc_get_yatra_reconcile_candidates(p_hotel_invoice_id uuid)`.
  - `rpc_get_yatra_reconcile_detail(p_voucher_no text)` — sentinel `YATRA_VOUCHER_NOT_FOUND`.
  - `rpc_update_yatra_bookings_payout_fields(p_id uuid, p_fields jsonb)` — full v2 whitelist; sentinel `YATRA_PAYOUT_LOCKED`.
  - `rpc_reconcile_yatra_invoice(...)` — atomic; rejects cash via `YATRA_CASH_NOT_ALLOWED`; link carries real underlying method.
- Smoke matrix: happy path + each sentinel passed.

#### Y4 — Frontend `YatraReconcilePanel`
- New: `frontend/src/app/(app)/invoices/[id]/yatra-reconcile-panel.tsx`.
- Modified: `detail-client.tsx` to conditionally render below MMT panel when `source ILIKE '%Yatra%'`.
- Modified: `lib/types.ts` — `YatraBookingPayout`, `YatraReconcileCandidate(s)`, `YatraReconcileDetail`, `YatraUpdatableFields` (no `'yatra_payout'` added to `PaymentMethod`).
- Build clean.

#### Y5 — Bank Statement Yatra extension
- `yatra_payout_bank_statement_drill` migration (2026-05-23): extended `rpc_get_bank_statement_view` to detect `drill_type='yatra_payout'` (via back-pointer chain `yatra_bookings_payout.reconciled_link_id → reconciliation_links`); added `yatra_count` to `drill_counts` and `yatra` key in `drill_count` jsonb.
- Extended `rpc_get_bank_statement_drilldown` with `ELSIF p_drill_type='yatra_payout'` branch returning `{voucher_no, guest_name, hotel_name (NULL), check_in, check_out, yatra_to_pay_hotel, hotel_invoice_id, hotel_invoice_number, is_reconciled, reconciled_invoices, applied_total, base_amount}`.
- Smoke: bank credit `0ce554f3-…` (NEFT CR-YATRA ONLINE ₹5930) returned 1 sub-row — voucher `0011929675`, guest "Shree shaila Thiperappa Swamy", `base_amount=5930.22`, `applied_total=5930`, reconciled to `INV1988260114`.

#### Y7 — `v_yatra_monthly_deductions` view + dashboard tab
- View applied with same shape as `v_mmt_monthly_deductions`. Dashboard `/admin/mis` page has Yatra tab populated alongside MMT.

### Phase RI — Report an Issue (2026-05-23)

#### RI-1 — `v1_invoice_issue_reports`
- `invoice_issue_reports` table per FR-090.
- Partial unique index `uq_invoice_issue_reports_one_open_per_invoice`.
- RLS enabled; SELECT `reported_by = auth.uid() OR is_admin()`; INSERT/UPDATE/DELETE revoked.
- BEFORE UPDATE trigger maintains `updated_at`.
- Helper `fn_auto_resolve_issue_reports(p_invoice_id uuid, p_actor uuid)` — SECURITY DEFINER, EXECUTE revoked from anon/authenticated.
- Advisors clean.

#### RI-2 — `v1_rpc_issue_reports`
- 3 SECURITY DEFINER RPCs: `rpc_create_issue_report`, `rpc_withdraw_issue_report`, `rpc_resolve_issue_report`.
- Helpers `fn_classify_invoice_source(text)` and `fn_issue_category_allowed(category, source_bucket)`.
- **Auto-resolve hook implemented as AFTER UPDATE trigger** `trg_hotel_invoice_after_status_change` on `hotel_invoice.reconciliation_status` (transition to `fully_reconciled`) — cleaner than editing 3 existing reconcile RPCs; `auth.uid()` preserved through session JWT.
- View `v_invoice_list_with_issue` (security_invoker=true) with `has_open_issue` boolean. Frontend invoice list switched to this view.
- 11/11 smoke scenarios PASS. All 4 new audit action types present (`issue_report_created`, `issue_report_withdrawn`, `issue_report_resolved`, `issue_report_auto_resolved`).
- Reverse-reconcile verified: flipping AWAY from `fully_reconciled` does NOT fire the trigger (BR-047 honoured).

#### RI-4 + RI-5 — Frontend (2026-05-23 12:00)
- `src/components/issue/issue-report-card.tsx` — status badge (red/green/slate), Withdraw (reporter + open), Resolve (admin + open).
- `src/components/issue/report-issue-dialog.tsx` — source-aware dropdown, optional/required notes, inline `ISSUE_ALREADY_OPEN` handling.
- `src/app/(app)/admin/issues/page.tsx` — admin-only, Open/Resolved/All tabs, filters (source, category, date range), 50/page paginated, inline Resolve.
- `src/app/(app)/admin/settings/issue-categories/page.tsx` — full CRUD for the catalog via `rpc_upsert_issue_category` and `rpc_delete_issue_category`. `code` immutable on edit; `applies_to` multi-select.
- Modified: `lib/types.ts` (added `IssueReport`, `IssueCategory`, `IssueReportStatus`, `classifyInvoiceSource()`).
- Modified: `invoices/[id]/detail-client.tsx` — `issueReportQ` query, IssueReportCard above reconcile panels, ReportIssueDialog in header.
- Modified: `invoices/page.tsx` — switched from `hotel_invoice` to `v_invoice_list_with_issue`; red "Issue reported" pill next to status badge when `has_open_issue`.
- Modified: `layout.tsx` — admin nav added "Issues" + "Issue Categories" links.
- Build: `npm run build` clean, `npx tsc --noEmit` clean. 16 routes.

#### `v1_issue_categories_configurable` + `_lock_function_grants` (2026-05-23)
- `issue_categories` table promoted from constant to DB-managed; CHECK regex on `code`; `applies_to text[]`; admin CRUD RPCs.
- FK `fk_issue_reports_category` on `invoice_issue_reports.category → issue_categories.code`.

### Phase PF — Payment Folio + Auto-select + Resolve guard (2026-05-23)

#### PF-1 — `pf_payment_folio_schema`
- `payment_folio_uploads` table per FR-100 (RLS: admin sees all, uploader sees own; mutations revoked).
- `payment_entries` table per FR-099 (RLS: SELECT true; mutations revoked).
- Unique expression index `uq_payment_entries_dedup` on the canonicalised 6-tuple.
- 3 supporting indexes (`booking_id WHERE NOT NULL`, `invoice_number_raw WHERE NOT NULL`, `consumed_for_invoice_id WHERE NULL`).
- CHECK constraint on `reconciliation_links.payment_method` and `payment_source_config.payment_method` extended with `'corporate_credit'`.
- Helper `fn_consume_payment_entry(p_invoice_id, p_link_id)` — SECURITY DEFINER, EXECUTE revoked, writes one `payment_entry_consumed` audit row per affected entry.
- AFTER DELETE trigger `trg_payment_entries_clear_consumed_on_link_delete` on `reconciliation_links` — clears `consumed_for_invoice_id`, `consumed_at`, `consumed_link_id`; writes `payment_entry_unconsumed` audit.
- Advisors: no new errors.

#### PF-2 — `pf_rpcs_payment_folio` + follow-up fix migrations
- `rpc_upload_payment_folio(p_file_name TEXT, p_file_size_bytes INT, p_sha256 TEXT, p_rows JSONB)` — validates each row; derives `payment_method` per FR-099 CASE (UPI / Cash / Credit Card / Debit Card / Bank Transfer with reference-text disambiguation for MMT/Agoda/Yatra collectors / IMPS / Payment Gateway / Bill To Company → corporate_credit / Other → NULL); `INSERT … ON CONFLICT ON CONSTRAINT uq_payment_entries_dedup DO NOTHING RETURNING id`; updates upload counts + warnings; writes `payment_folio.upload` audit.
- `rpc_resolve_issue_report` PATCHED (CREATE OR REPLACE) — added resolve guard: rejects if invoice `reconciliation_status = 'unreconciled'` with `INVOICE_NOT_RECONCILED: …`.
- Auto-consume hooks added to `rpc_reconcile_invoice` (loop over each new link id), `rpc_reconcile_mmt_invoice`, `rpc_reconcile_yatra_invoice`, `rpc_reconcile_agoda_invoice` — each wrapped in `BEGIN…EXCEPTION WHEN OTHERS THEN…END` so consume failure cannot fail the parent reconcile.
- Fix migrations:
  - `pf_rpcs_payment_folio_fix_status` — corrected the resolve guard to accept all three non-`unreconciled` values (`partial`, `fully_reconciled`, `flagged_for_review`).
  - `pf_rpcs_payment_folio_fix_conflict` — corrected the ON CONFLICT clause to match the actual unique index name.
  - `fix_payment_entries_add_manual_method` — added `'manual'` to the `payment_entries.payment_method` CHECK (was missing for `Other` rows that should be parked for human review).
- Smoke matrix (8 scenarios): all PASS.

#### PF-4 — Frontend Payment Folio UI + auto-select
- New: `frontend/src/lib/xls/parse-payment-folio.ts` — pure-TS BIFF8 OLE reader. Walks OLE compound document (signature `D0CF11E0…`), parses FAT, finds the Workbook stream, decodes SST (Latin-1 / UTF-16LE with Continue spillover), RK/MULRK/NUMBER/LABEL/LABELSST/BLANK records, XF→format map for date detection, BIFF date conversion with 1900-bug compensation. Auto-detects header row by scanning for the 6 expected columns case-insensitive.
- New: `frontend/src/app/(app)/payment-folio/page.tsx` — drag-drop `.xls`, `crypto.subtle.digest('SHA-256')`, preview first 20 rows, `rpc_upload_payment_folio` call, result panel (inserted green / skipped slate / invalid amber with expandable warnings), recent uploads (last 20).
- New: `frontend/src/hooks/use-payment-suggestions.ts` — TanStack Query around `rpc_get_payment_suggestions` (also pulls `payment_entries` directly for chip-strip auto-select).
- Modified: `lib/types.ts` — added `PaymentEntry`, `PaymentFolioUpload`, `'corporate_credit'` in `PaymentMethod` union, `PaymentSuggestion` type.
- Modified: `layout.tsx` — "Payment Folio" nav entry exposed to both roles (RLS gates ingestion to admin in practice).
- Modified: All four reconcile panels (`detail-client.tsx`, `mmt-reconcile-panel.tsx`, `yatra-reconcile-panel.tsx`, `agoda-reconcile-panel.tsx`) — auto-select banner / chip strip wired in.
- Modified: `issue-report-card.tsx` — Resolve button disabled with tooltip when invoice `unreconciled`; `INVOICE_NOT_RECONCILED` toast handling.
- Modified: `admin/issues/page.tsx` — same disable + tooltip on inline Resolve.
- Build: `npm run build` clean (17 routes); `tsc --noEmit` clean.

> Design-deviation note: the upload page is mounted at `/payment-folio` (under `(app)/payment-folio/`), not at `/admin/payment-folio` as the PRD spec proposed. The route is exposed to both roles via the nav, but ingestion is admin-led in practice. Middleware does NOT gate `/payment-folio`. RLS on `payment_folio_uploads` restricts SELECT to admin + uploader.

### Phase Agoda — Agoda payout reconcile (2026-05-21)

#### `agoda_bookings_payout_pipeline`
- `agoda_bookings_payout` table created.
- Inserter built in the Python pipeline (parallel to MMT and Yatra).
- AFTER DELETE trigger `trg_agoda_clear_reconciled_at_on_link_delete`.
- RPCs deployed: `rpc_get_agoda_reconcile_candidates`, `rpc_get_agoda_reconcile_detail`, `rpc_update_agoda_bookings_payout_fields`, `rpc_reconcile_agoda_invoice`.
- Frontend `agoda-reconcile-panel.tsx` integrated into `detail-client.tsx`.

### Phase Bank-Statement upload — `bank_statement_upload_rpc` + `_fix_payment_method_cast` (2026-05-21)
- `rpc_upload_bank_statement(p_rows jsonb)` added so admins can upload an HDFC bank statement Excel directly from the frontend (otherwise the Python pipeline still handles it from Drive).
- `bank_statement_fix_payment_method_cast` — corrected a casting bug between text and enum in the upload path.

### MIS — `v1_mis_monthly_views` (2026-05-17)
- Two views: `v_mis_monthly_summary` and `v_mis_payment_detail`. Both `security_invoker=true`.
- April 2026: 155 invoices, ₹1,234,953 invoiced, ₹45,202 received (all same-month — 15,498 card + 29,704 upi), ₹1,189,751 pending.
- May 2026: 82 invoices, ₹684,223 invoiced, ₹0 received, ₹684,223 pending.

### Yatra reconcile status vs net receivable (2026-05-21)
- `yatra_reconcile_status_vs_net_receivable` and `yatra_reconcile_allow_desiya_source` migrations — handle `Desiya` source variant (sub-brand of Yatra) and align the status comparison with `yatra_to_pay_hotel` (the true receivable, distinct from `total_tariff` etc.).

### Settlement-date fix — `fix_v_transactions_use_settlement_date` (2026-05-17 17:38:05)
- Bug: `v_transactions_with_remaining` was using `transaction_date` for card and UPI rows, but reconciled credits land on `settlement_date`. Operators saw the wrong day in the picker.
- Fix: card/UPI rows in the view now report `payment_date = settlement_date`. Bank rows continue to use `date`; cash continues to use `payment_date`.

### Drill-down UPI matching fix — `fix_bank_statement_upi_drill_matching` (2026-05-18 18:06)
- Bug: the UPI drill-down was missing rows where the same UPI settlement had multiple transactions due to a JOIN cardinality issue.
- Fix: rebuilt the drill-down query to walk `upi_transactions.card_settlement_id → card_settlement` first, then filter by `bank_statement.deposit_amt` and `mpr_date` window.

### MMT drilldown — `v1_drilldown_add_mmt_reconciled_fields` (2026-05-18 18:54)
- Added `is_reconciled`, `reconciled_invoices[]`, `applied_total`, `base_amount` to the MMT sub-row return. Fed by the back-pointer on `mmt_bookings_payout.reconciled_link_id`.

---

## Current State (as of 2026-05-23)

### Database
- **31 tables** total (`agoda_bookings_payout`, `approval_requests`, `audit_log`, `bank_statement`, `card_settlement`, `card_transactions`, `cash_payments`, `discrepancies`, `extractions`, `files`, `hotel_invoice`, `invoice_issue_reports`, `issue_categories`, `mmt_bookings_payout`, `mmt_invoice`, `mmt_payouts`, `ocr_outputs`, `payment_entries`, `payment_folio_uploads`, `payment_source_config`, `processing_logs`, `reconciliation_links`, `upi_transactions`, `user_profiles`, `yatra_bookings_payout`).
- **6 views** (`v_invoice_list_with_issue`, `v_mis_monthly_summary`, `v_mis_payment_detail`, `v_mmt_monthly_deductions`, `v_transactions_with_remaining`, `v_yatra_monthly_deductions`).
- **53 functions** (51 `rpc_*` + helpers): see § 7 of `prd.md` for the full inventory.
- **7 triggers**: `audit_log_block_mutation` × 2, `trg_mmt_clear_reconciled_at_on_link_delete`, `trg_yatra_clear_reconciled_at_on_link_delete`, `trg_agoda_clear_reconciled_at_on_link_delete`, `trg_payment_entries_clear_consumed_on_link_delete`, `trg_hotel_invoice_after_status_change`, plus the `updated_at` BEFORE UPDATE triggers on `invoice_issue_reports` and `issue_categories`.

### Frontend
- **17 routes** building cleanly.
- App shell full-width (`max-w-7xl` removed); role-aware nav with admin links: Home, Invoices, Bank Statement, Payment Folio, Approvals, Discrepancies, MIS Report, Audit Log, Issues, Settings, Issue Categories. Operator links: Invoices, Bank Statement, Payment Folio, Audit Log.
- Vercel deployment live; GitHub Actions running the Python backend pipeline.

### Live data snapshot
- `hotel_invoice` 237 rows.
- `mmt_invoice` 537 rows; `mmt_payouts` 31 rows; `mmt_bookings_payout` 51 rows.
- `yatra_bookings_payout` 8 rows.
- `agoda_bookings_payout` 18 rows.
- `bank_statement` 1563 rows (deposit + withdrawal mixed).
- `card_settlement` 46; `card_transactions` 82; `upi_transactions` 86.
- `reconciliation_links` 21.
- `cash_payments` 2.
- `audit_log` 59 entries.
- `invoice_issue_reports` 2 rows; `issue_categories` 18 rows.
- `payment_folio_uploads` 2 rows; `payment_entries` 295 rows.
- `files` 904; `ocr_outputs` 945; `extractions` 831; `processing_logs` 3883.

### Phase MRR — Monthly Reconciliation Report (2026-07-18 → 2026-07-19)

#### MRR-1 — `mrr_rpc_initial` — RPCs + frontend pages (2026-07-18)
- `rpc_get_reconciliation_monthly_summary(p_date_from, p_date_to)` deployed: month-wise billing, received-by-channel, deductions (commission/GST-on-commission/TDS/TCS/MDR), outstanding.
- `rpc_get_reconciliation_month_detail(p_month_start)` deployed: summary cards, booking-type breakdown, payment-timing buckets.
- Frontend: `frontend/src/app/(app)/reports/reconciliation/page.tsx` + `reconciliation-summary-client.tsx` (Page 1 — monthly summary table with date picker).
- Frontend: `frontend/src/app/(app)/reports/reconciliation/[month]/page.tsx` + `reconciliation-detail-client.tsx` (Page 2 — drill-down with 3 sections).
- Middleware updated: `/reports/reconciliation` gated to admin only.
- Nav entry "Reconciliation Report" added to admin sidebar.

#### MRR-2 — `mrr_rpc_deduction_fixes` (2026-07-18)
- **Bug**: `mmt_invoice` had multiple rows per `booking_id` (same booking uploaded multiple times). `mi_agg` CTE used `GROUP BY + SUM()` → 2–6× over-count of commission.
- **Fix**: Replaced `mi_agg` with `mi_dedup` using `DISTINCT ON (booking_id) ORDER BY booking_id, created_at DESC`.
- Also separated `ota_ded` and `mdr_ded` in detail RPC to allow MDR exclusion from net_receivable initially.

#### MRR-3 — `mrr_rpc_agoda_sign_fix` (2026-07-18)
- **Bug**: `agoda_bookings_payout.commission` and `tds_withholding_tax` are stored as **negative numbers** (e.g. -807.12). Using them as-is made `ota_ded` negative → net_receivable > gross_billed → positive spurious outstanding.
- **Fix**: Negated both fields in both RPCs: `-coalesce(abp.commission, 0)` and `-coalesce(abp.tds_withholding_tax, 0)`.

#### MRR-4 — `mrr_rpc_mdr_as_deduction` (2026-07-19)
- **Decision**: MDR is a P&L expense (user confirmed). Card received = post-MDR net; MDR appears as its own deduction.
- **Fix summary RPC**: `recv` CTE subtracts MDR from card links: `l.amount_applied - coalesce(ct.gross_amount * ct.mdr_percent / 100.0, 0)`. MDR back in outstanding formula.
- **Fix detail RPC**: `recv_inv` CTE same card post-MDR logic. `ded_inv` includes MDR in `ota_ded` and `total_ded`.

#### MRR-5 — Frontend `roundOutstanding` helper (2026-07-19)
- **Requirement**: Sub-₹1 outstanding differences should display as ₹0 (Yatra ±₹0.12 paise rounding).
- Added `roundOutstanding(v: number): number { return Math.abs(v) < 1 ? 0 : v; }` to both `reconciliation-summary-client.tsx` and `reconciliation-detail-client.tsx`.
- Applied to all outstanding cells and the summary card.

#### MRR-6 — Goibibo un-reconciliation (2026-07-19)
- Dilip Kumar Dalei's Goibibo booking was incorrectly reconciled as `bank_transfer` instead of `mmt_payout` (bypassing the Goibibo payout row and commission attribution).
- **Fix (direct SQL)**: `DELETE FROM reconciliation_links WHERE id = '0a7c2b50-71cf-408c-bc4f-3d1b926d8dbb'`; `UPDATE hotel_invoice SET reconciliation_status = 'unreconciled' WHERE id = '12707c48-bdff-4a89-80cf-bd93e96ca424'`.

#### MRR-7 — `mrr_rpc_include_unreconciled` (2026-07-19)
- **Requirement**: App showed 100 invoices/₹8,72,761 for June 2026; GST report has 113 invoices/₹9,76,168. Gap = 13 unreconciled invoices (₹1,03,407) excluded by `WHERE hi.reconciliation_status <> 'unreconciled'`.
- **Fix**: Removed the filter from both RPCs. All invoices (any status) now appear. Unreconciled ones show Received = ₹0, Outstanding = full gross.

#### MRR-8 — MMT May 2026 duplicate commission (2026-07-19)
- **Bug**: INV1988260167 (Thirumala Rao V, May 2026) had both an MMT payout deduction (₹1,004.30 via `mmt_invoice`) AND a manual `commission` reconciliation_link (₹1,004 via `manual_payment_entries`, added 2026-07-06). Double-counted → net_receivable ₹1,004 too low → outstanding -₹986.52 for all MMT May 2026.
- **Fix (direct SQL)**: `DELETE FROM reconciliation_links WHERE id = 'ad4679e8-33c2-4923-af9c-e770c00317ec'`; `DELETE FROM manual_payment_entries WHERE id = '4bc884e2-e30a-407c-a715-7d9bca2f1628'`.

#### MRR-P — Pending Reconciliation List on Page 2 (2026-07-19) — IN PROGRESS
- **Requirement**: Section 4 on `/reports/reconciliation/[month]` listing all invoices with `reconciliation_status IN ('unreconciled', 'partial')` with a link to `/invoices/[id]` to reconcile.
- **DB**: `rpc_get_reconciliation_month_detail` extended with `pending_invoices` array in returned JSON.
- **Types**: `PendingReconciliationInvoice` interface added; `ReconciliationMonthDetail.pending_invoices` added.
- **Frontend**: Section 4 added to `reconciliation-detail-client.tsx`; hidden when empty.

---

## Known Issues / Bugs Fixed (chronological)

| Date | Bug | Root cause | Fix |
|---|---|---|---|
| 2026-05-17 17:38 | `v_transactions_with_remaining` was using `transaction_date` for card + UPI rows; operators couldn't find transactions on the correct day. | View built before settlement-date semantics were finalised. | Migration `fix_v_transactions_use_settlement_date` switched card/UPI rows to `settlement_date`. Bank rows use `date`; cash uses `payment_date`. |
| 2026-05-17 (frontend) | `payment_sources` page crashed on render with `Cannot read property of undefined` because `payment_method` was sometimes returned as undefined from the RPC. | Frontend assumed the field always present. | Added safe-default + guard on render; only rendered rows where `payment_method` is set. |
| 2026-05-17 16:01 | `rpc_get_payment_suggestions` referenced `transaction_date` on `payment_entries`, but the column is `received_date`. | Cut-and-paste from `card_transactions` shape during prototyping. | Migration corrected the field name to `received_date`. |
| 2026-05-17 (frontend) | `AddPaymentPanel` had a `useState` initializer that depended on async data, so the first render saw stale state and the picker would not populate until the user blurred a field. | `useState(() => deriveFromAsyncData())` runs synchronously; the data isn't there yet on first render. | Refactored to a `useEffect` that resets state when the underlying query resolves. |
| 2026-05-18 18:06 | UPI drill-down on `/bank-statement` was missing rows when the same settlement had multiple UPI transactions (e.g. 2 transactions credited as 1 deposit). | JOIN cardinality issue: filtering on `bank_statement.deposit_amt` and `mpr_date` before joining to `upi_transactions` caused some rows to drop. | Migration `fix_bank_statement_upi_drill_matching` rewrote the join path: walk `upi_transactions.card_settlement_id → card_settlement` first, then filter on bank fields. |
| 2026-05-21 18:12 | `bank_statement` upload via the new `rpc_upload_bank_statement` failed with a cast error between text and the `payment_method` enum. | Implicit casting changed between Postgres versions; explicit cast missing in the RPC. | Migration `bank_statement_fix_payment_method_cast` added explicit `::text` casts at the boundary. |
| 2026-05-23 09:05 | `pf_rpcs_payment_folio` had a typo in the resolve-guard branch (only accepted `fully_reconciled`, not partial / flagged). | Implementer used PRD pre-PM-locked decision. | Migration `pf_rpcs_payment_folio_fix_status` updated the guard to accept `partial`, `fully_reconciled`, `flagged_for_review`. |
| 2026-05-23 09:06 | `pf_rpcs_payment_folio` referenced the wrong unique-index name in the `ON CONFLICT` clause. | Index was named `uq_payment_entries_dedup` but the RPC used `uq_payment_entries_dedup_v1`. | Migration `pf_rpcs_payment_folio_fix_conflict` corrected the constraint reference. |
| 2026-05-23 09:21 | `payment_entries.payment_method` CHECK constraint rejected `Other` rows (mapped to `manual` for human review). | CHECK enumerated `upi, card, bank_transfer, cash, mmt_payout, agoda_payout, yatra_payout, corporate_credit` only. | Migration `fix_payment_entries_add_manual_method` added `'manual'` to the CHECK. |

---

## Technical Decisions & Rationale

See § 14 of `prd.md` for the full chronological decisions log. The most consequential ones:

- **Supabase MCP as source of truth for migrations** (2026-05-17). No local `supabase/migrations/` directory in V1. All migrations applied via `mcp__supabase__apply_migration`. The list lives in `supabase_migrations.schema_migrations` (managed by Supabase).
- **RPC-only mutations + RLS revoke on every sensitive table** (2026-05-17 Phase A4). Every INSERT/UPDATE/DELETE flows through SECURITY DEFINER RPCs. The RPC layer is the only mutation surface.
- **`v_transactions_with_remaining` is `security_invoker = true`** (2026-05-17). Honours base-table RLS as the calling user.
- **Sentinel error prefixes** (`PARTIAL_CONFIRMATION_REQUIRED`, `OVERPAY_CONFIRMATION_REQUIRED`, etc.) — UI translates to confirmation dialogs without re-implementing business rules.
- **Inline-cash creation inside `rpc_reconcile_invoice`** — true atomicity per E4 alternative.
- **`reconciliation_links` is the single junction** — MMT / Yatra / Agoda all reconcile by inserting one row, never a new link type.
- **`payment_method` carries the real underlying method for Yatra and Agoda** (Option B, 2026-05-19) — link → upi/card/bank_transfer; context lives on the back-pointed payout row.
- **Drop `UNIQUE(voucher_no)` on `yatra_bookings_payout`** (FR-076 v2, 2026-05-19) — duplicate detection moves to the app layer (log-and-skip).
- **Drill-down attribution applies to ALL drill types uniformly** (FR-087, 2026-05-19) — one pattern; future payment types are mechanical extensions.
- **AFTER UPDATE trigger replaces editing 3 reconcile RPCs** for auto-resolving issue reports (RI-2, 2026-05-23) — single enforcement point; cleaner than the original plan.
- **Issue categories made configurable** (2026-05-23) — admin can add/remove categories without code change.
- **BIFF8 parser is TypeScript in the frontend** (PF-4, 2026-05-23) — no LibreOffice, in-runtime parse. Python sidecar exists for future Drive ingestion.
- **`payment_entries` is a suggestion surface, not a reconciliation source** (FR-099) — reconciliations still link to `upi_transactions / card_transactions / bank_statement / cash_payments`.
- **Backend overpay guard reverified** (BR-038, 2026-05-19) — `sum(amount_applied) > deposit_amt` is rejected by every reconcile RPC via the shared `fn_lock_and_get_source_amount`. Frontend tinting assumes this invariant holds.

---

## Pending / Backlog

### QA gates (need verdict before next phase moves)
- **M4** — MMT Direct Reconcile end-to-end QA on the deployed UI. Smoke via SQL already proved the RPC chain.
- **BS-3** — Bank Statement V1 click-through QA as both operator and admin.
- **BS-Polish-3** — visual regression check that `max-w-7xl` removal didn't break any other page.
- **BS-v2-3** — drill-down "Reconciled To" column + tints QA matrix.
- **Y6** — Yatra end-to-end QA (6 panel states, audit rows, un-reconcile via reverse, linked-payment method=`upi/card/bank_transfer`, MIS breakdown, idempotency).
- **PF-3** — Payment Folio upload + auto-select + resolve-guard QA matrix.
- **PF-6** — Full end-to-end Payment Folio QA on the real `excel_exports/Payment_Folio_1779523853.xls` file.
- **RI-3 / RI-7** — Issue report RPC + UI matrix.
- **C1 / C2** — Full RPC test suite + audit-log completeness matrix.
- **F1 / F2 / F3** — End-to-end manual QA / performance check (2000 invoices + 5000 txns) / security advisor re-run.

### Designer polish passes
- **RI-6** — confirmed pill colour, status badge palette, focus rings, spacing rhythm.
- **PF-5** — drag-drop visual states (idle/hover/dragover/parsing/error), result panel badge colours, auto-select chip strip spacing, disabled-Resolve tooltip.

### Hardening
- **RLS on 14 pipeline tables** — `files`, `ocr_outputs`, `extractions`, `processing_logs`, `hotel_invoice`, `mmt_invoice`, `card_settlement`, `bank_statement`, `card_transactions`, `upi_transactions`, `mmt_payouts`, `mmt_bookings_payout`, `yatra_bookings_payout`, `agoda_bookings_payout`. Needs a deliberate policy design pass before flipping the switch (the views and RPCs assume read access; naive enabling will return zero rows).
- **`search_path` lock on every SECURITY DEFINER function** — most already done; spot-check the older A-phase helpers.

### Feature backlog (V1.5+)
See § 15 of `prd.md`. Highlights: notifications, bulk operations, mobile, multi-property, OTA reconciliation surface for `corporate_credit`, Drive-folder auto-ingest of payment folios, withdrawal rows on `/bank-statement`, Yatra cancellation/amendment workflow.

---

## Blocked
None.

---

# Phase MRR — Monthly Reconciliation Report

<!-- Planned 2026-07-18 -->
### Status: COMPLETE (2026-07-18)

Implements PRD § 14D (FR-132..FR-147, BR-077..BR-082). Admin-only. Standard agent order: database-manager → frontend-dev → designer → qa.

**Pre-flight facts verified against live DB:**
- `mmt_bookings_payout` has `brand` field — used to split MMT vs. Goibibo within `payment_method='mmt_payout'` links.
- `mmt_bookings_payout.reconciled_link_id` FK back-pointer chain used to attribute OTA deductions to invoices.
- `card_transactions.mdr_percent` and `gross_amount` exist — MDR = `gross_amount × mdr_percent / 100`.
- `manual_payment_entries` table (Phase MPE) exists with `payment_type` CHECK including `'commission'`, `'tds'` (Phase CDW).
- `reconciliation_links.payment_method` CHECK includes `'commission'`, `'tds'`.
- `src/middleware.ts` currently gates `/admin/*` for operators. Must also gate `/reports/*`.

---

## MRR — Up Next (ordered)

### MRR-1 — `mrr_rpcs` migration (database-manager)

Agent: **database-manager** (FIRST). Read `.claude/context/database-manager.md` first. Also read PRD § 14D (in `prd.md`) in full before writing anything.

Build one migration via Supabase MCP `apply_migration`, name `mrr_rpcs`. Deploy two read-only SECURITY DEFINER RPCs (owned by `postgres`, `search_path` locked, EXECUTE granted to `authenticated`, role-checked via `is_admin()`, no audit):

---

**RPC 1: `rpc_get_reconciliation_monthly_summary(p_date_from date, p_date_to date) → jsonb`**

Returns a JSON array (ordered `invoice_month DESC`) of monthly aggregates for all months in `[DATE_TRUNC('month', p_date_from), DATE_TRUNC('month', p_date_to)]`.

**Included invoices filter:**
```sql
WHERE DATE_TRUNC('month', hi.departure_time) BETWEEN DATE_TRUNC('month', p_date_from)
                                               AND DATE_TRUNC('month', p_date_to)
  AND hi.reconciliation_status != 'unreconciled'
  AND hi.departure_time IS NOT NULL
```

**Billing aggregates (per invoice):** `SUM(grand_total)`, `SUM(taxable_amount)`, `SUM(cgst + sgst)`.

**Received by channel** — sum `reconciliation_links.amount_applied` for non-deduction links (`payment_method NOT IN ('commission', 'tds')`), categorised as:
- `mmt`: `rl.payment_method = 'mmt_payout'` AND `mbp.brand ILIKE '%makeMyTrip%'` (case-insensitive; join `mmt_bookings_payout mbp ON mbp.reconciled_link_id = rl.id`)
- `goibibo`: same join, `mbp.brand ILIKE '%goibibo%'`
- `card`: `rl.payment_method = 'card'` AND `rl.source_table = 'card_transactions'`
- `upi`: `rl.payment_method = 'upi'` AND `rl.source_table = 'upi_transactions'`
- `cash`: `rl.payment_method = 'cash'`
- `bank_transfer`: `rl.payment_method = 'bank_transfer'`
- `another_machine`: `rl.source_table = 'manual_payment_entries'` AND `rl.payment_method = 'upi'`
- `other`: everything else not matching the above and not a deduction

**Deductions** — sourced as follows:
- OTA commission/TDS/TCS from back-pointer chain (only for reconciled invoices in month):
  - MMT/Goibibo: `mmt_bookings_payout mbp JOIN mmt_invoice mi ON mi.booking_id = mbp.booking_id` where `mbp.reconciled_link_id IS NOT NULL` and `mbp.reconciled_link_id → reconciliation_links → invoice` is in scope. Fields: `mi.go_mmt_commission`, `mi.gst_on_commission`, `mi.tds`, `mi.tcs`.
  - Yatra: `yatra_bookings_payout ybp` where `ybp.reconciled_link_id → reconciliation_links → invoice` in scope. Fields: `ybp.yatra_commission_with_gst - ybp.gst` (commission net), `ybp.gst` (GST on commission), `ybp.tds`, `ybp.tcs`.
  - Agoda: `agoda_bookings_payout abp` where `abp.reconciled_link_id → reconciliation_links → invoice` in scope. Fields: `abp.commission` (as commission), `abp.tds_withholding_tax` (as TDS).
  - Manual write-offs: `reconciliation_links rl` where `rl.payment_method = 'commission'` → add to `commission`; `rl.payment_method = 'tds'` → add to `tds`.
- MDR: for `reconciliation_links rl` where `rl.source_table = 'card_transactions'`, join `card_transactions ct ON ct.id = rl.source_id::uuid`, compute `ct.gross_amount * ct.mdr_percent / 100` (NULL-safe: treat NULL mdr_percent as 0).

**Outstanding:** `gross_billed - received_total - deductions_total`

Each element of the returned array:
```jsonc
{
  "invoice_month": "2026-06-01",
  "invoice_count": 45,
  "gross_billed": 350000,
  "taxable_amount": 316000,
  "gst": 34000,
  "received": {
    "mmt": 85000, "goibibo": 32000, "card": 45000, "upi": 38000,
    "cash": 12000, "bank_transfer": 25000, "another_machine": 8000,
    "other": 2000, "total": 247000
  },
  "deductions": {
    "commission": 18000, "gst_on_commission": 3240,
    "tds": 900, "tcs": 450, "mdr": 1350, "total": 23940
  },
  "outstanding": 78060
}
```

---

**RPC 2: `rpc_get_reconciliation_month_detail(p_month_start date) → jsonb`**

`p_month_start` is the first day of the month. Same invoice filter as above but for a single month. Returns:

```jsonc
{
  "summary": { "total_billed": …, "net_receivable": …, "total_received": …, "outstanding": … },
  "booking_type_breakdown": [
    {
      "source": "MakeMyTrip",
      "invoice_count": 12,
      "gross_billed": 95000,
      "gst": 8600,
      "net_receivable": 78500,
      "total_deductions": 8100,
      "received": 78500,
      "outstanding": 0
    }
  ],
  "payment_timing": [
    { "period": "same_month",   "label": "Jun 2026", "amount": 200000, "pct": 81.3 },
    { "period": "month_plus_1", "label": "Jul 2026", "amount": 30000,  "pct": 12.2 },
    { "period": "month_plus_2", "label": "Aug 2026", "amount": 10000,  "pct": 4.1  },
    { "period": "month_plus_3", "label": "Sep 2026+","amount": 7000,   "pct": 2.8  },
    { "period": "pending",      "label": "Still Pending", "amount": 3060, "pct": 1.2 }
  ]
}
```

**Booking type breakdown:** Group by `hotel_invoice.source` (use the same classification as `fn_classify_invoice_source`, but also split MMT vs. Goibibo as distinct rows). For each source group, compute: `invoice_count`, `gross_billed`, `gst (cgst+sgst)`, `net_receivable (gross_billed − source_deductions)`, `total_deductions`, `received (non-deduction rl.amount_applied)`, `outstanding (net_receivable − received)`. Include a totals row with `source='TOTAL'`.

**Payment timing:** For each non-deduction `reconciliation_links` row on invoices in this month, determine the payment date:
- `source_table='bank_statement'`: join `bank_statement bs ON bs.id = rl.source_id::uuid`, use `bs.date`
- `source_table='card_transactions'`: join `card_transactions ct`, use `ct.settlement_date`
- `source_table='upi_transactions'`: join `upi_transactions ut`, use `ut.settlement_date`
- `source_table='cash_payments'`: join `cash_payments cp`, use `cp.payment_date`
- `source_table='manual_payment_entries'`: join `manual_payment_entries mpe`, use `mpe.transaction_date`

Bucket by `DATE_TRUNC('month', payment_date) - DATE_TRUNC('month', p_month_start)`:
- `= 0` → `same_month`
- `= 1 month` → `month_plus_1`
- `= 2 months` → `month_plus_2`
- `≥ 3 months` → `month_plus_3`

Pending bucket amount = `SUM(grand_total) − SUM(ALL rl.amount_applied including deductions)`. `pct` = amount / net_receivable × 100 (handle division-by-zero as 0).

**Acceptance smoke (run against live DB, roll back test data):**
1. `SELECT rpc_get_reconciliation_monthly_summary('2026-01-01', '2026-07-01')` — returns array with ≥1 month, all numeric fields non-negative, `outstanding = gross_billed - received.total - deductions.total` for each row.
2. `SELECT rpc_get_reconciliation_month_detail('2026-06-01')` — returns all three sections; booking_type_breakdown includes a `TOTAL` row; payment_timing `pending` amount + all period amounts = `net_receivable` (within ₹1 rounding).
3. Supabase advisor shows no new ERRORs.
4. Operator session calling either RPC → `Not authorized`.

Done when: both RPCs deployed, smoke passes, advisor clean, results logged to context file.

---

### MRR-2 — Frontend pages (frontend-dev)

Agent: **frontend-dev** (after MRR-1). Read `.claude/context/frontend-dev.md` first. Read PRD § 14D in `prd.md`. Read `execution.md` (MRR-1 results). Look at `src/app/(app)/admin/mis/page.tsx` for the existing MIS page pattern.

Build:

**1. Update `src/middleware.ts`**
Extend the existing operator block (which currently redirects `/admin/*`) to also redirect `/reports/*`. Pattern: `pathname.startsWith('/admin') || pathname.startsWith('/reports')`.

**2. Update `src/app/(app)/layout.tsx`**
Add "Reconciliation Report" to the **admin-only** nav links section (alongside MIS Report, Approvals, etc.). Route: `/reports/reconciliation`. Operators must NOT see this link.

**3. `src/app/(app)/reports/reconciliation/page.tsx` (Page 1 — Monthly Summary)**
Server component that passes date range from `searchParams` to a client component.

Client component (`reconciliation-summary-client.tsx`):
- Date range state (default: `DATE_TRUNC('month', today - 11 months)` to `today`).
- Two date inputs (month pickers or simple `<input type="month">`) with an "Apply" action — updates the query params and refetches.
- TanStack Query call to `rpc_get_reconciliation_monthly_summary(p_date_from, p_date_to)`.
- Table: columns per PRD § 14D.4. Wide table — wrap in `overflow-x: auto` container.
  - Month column: clickable link to `/reports/reconciliation/YYYY-MM` (format month as `2026-06`).
  - All numeric cells: `formatINR` from `lib/utils.ts`.
  - Totals row: pinned at bottom with `font-semibold`.
  - `null` / `0` values: display as `—` for currency columns to reduce visual noise.
- Loading: skeleton rows (same count as last fetch or 6 placeholders).
- Empty: "No reconciled invoices found for the selected date range."
- Error: red banner.

**4. `src/app/(app)/reports/reconciliation/[month]/page.tsx` (Page 2 — Drill-down)**
Server component extracts `params.month` (e.g. `"2026-06"`), converts to `p_month_start = "2026-06-01"`.

Client component (`reconciliation-detail-client.tsx`):
- Back link: `← Monthly Summary`.
- TanStack Query call to `rpc_get_reconciliation_month_detail(p_month_start)`.
- **Section 1 — Summary cards:** 4 cards in a 2×2 or 4-column grid (Total Billed, Net Receivable, Total Received, Outstanding). Use existing admin home tile style.
- **Section 2 — Booking Type Breakdown:** table per PRD § 14D.5, totals row.
- **Section 3 — Payment Timing:** table per PRD § 14D.5 (Period, Amount, %).
- All four UI states.

**5. `src/lib/types.ts`**
Add types: `ReconciliationMonthSummary`, `ReconciliationMonthDetail`, `BookingTypeBreakdownRow`, `PaymentTimingRow`.

**Acceptance:** `npm run build` + `tsc --noEmit` clean. Verify: admin can access both routes; operator hitting `/reports/reconciliation` is redirected by middleware; nav entry appears for admin only; table rows are clickable; numbers formatted as INR.

---

### MRR-3 — Designer polish (designer)

Agent: **designer** (after MRR-2). Read `.claude/context/designer.md` first. Inspect the built pages.

Polish:
- Table header rhythm: Received group and Deductions group need column-group headers (use `<th colSpan={…}>` with a bottom border separator).
- Zero / null deduction columns: suppress or dim them to reduce row density.
- Month link hover state (cursor-pointer, underline or bg-tint).
- Summary cards on Page 2: consistent with admin home tile style (border, rounded, p-4).
- Payment timing table: period column bold, `Still Pending` row amber-tinted.
- Responsive overflow: ensure the wide table scrolls horizontally without breaking the page layout.
- No new Tailwind tokens — reuse existing.

---

### MRR-4 — QA sweep (qa)

Agent: **qa** (after MRR-3). Read `.claude/context/qa.md` and PRD § 14D in full.

Verify:
1. Admin can navigate to `/reports/reconciliation`; nav entry visible.
2. Operator is redirected away from `/reports/reconciliation` and `/reports/reconciliation/any-month`.
3. Operator calling `rpc_get_reconciliation_monthly_summary` or `rpc_get_reconciliation_month_detail` directly → `Not authorized`.
4. Unreconciled invoices are excluded from all aggregates.
5. For a reconciled MMT invoice in the data: `received.mmt` includes its payout amount; deductions include its commission/TDS.
6. For a reconciled card invoice: `received.card` includes the amount; MDR appears in `deductions.mdr`.
7. Month row click navigates to the correct detail page.
8. Payment timing rows sum to net_receivable (within ₹1 rounding tolerance).
9. Totals row on both tables matches column sums.
10. Empty state when date range has no reconciled invoices.

Verdict gates feature completion.

---

## MRR Completion Summary (2026-07-18)

### Database (MRR-1)
- Migration `mrr_rpcs` deployed: `rpc_get_reconciliation_monthly_summary` + `rpc_get_reconciliation_month_detail`.
- Follow-up migration `mrr_pending_formula_fix`: pending = `net_receivable − Σ period buckets` (spec had a flaw; fixed).
- Both RPCs: SECURITY DEFINER, `is_admin()` gated, no audit. Smoke: 4 months returned, outstanding arithmetic verified, operator session rejected.

### Frontend (MRR-2)
- 3 new files: `reports/reconciliation/page.tsx`, `reports/reconciliation/reconciliation-summary-client.tsx`, `reports/reconciliation/[month]/page.tsx`, `reports/reconciliation/[month]/reconciliation-detail-client.tsx`.
- Middleware: `/reports/reconciliation` blocked for operators (narrowed from blanket `/reports/*` to avoid breaking `/reports/deductions`).
- Layout: "Reconciliation Report" in adminLinks only; "Deductions" in both.
- 6 new types in `lib/types.ts`.
- Build: 20 routes, clean.

### Designer (MRR-3)
- Two-row group header on summary table; zero values as muted `—`; subtotal columns bold; outstanding color-coded; pending row amber-tinted; summary cards responsive grid; TOTAL row separator.

### QA (MRR-4)
- All 9 checks PASS. Build + tsc clean. Middleware correct. Nav correct. RPC params correct. All UI states handled.

## MRR Execution Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-18 | Admin-only access (routes + RPCs) | Confirmed by user mid-session. |
| 2026-07-18 | Two targeted RPCs rather than a new view | Aggregations are too complex for a simple `security_invoker` view; RPCs allow multi-join deduction attribution logic. |
| 2026-07-18 | Deduction attribution via `reconciled_link_id` back-pointers | Already the canonical pattern in this codebase (mmt/yatra/agoda back-pointers). |
| 2026-07-18 | Page 2 as a dedicated route (`/reports/reconciliation/[month]`) | Three separate data sections make an inline accordion unwieldy; separate page is cleaner. |

---

# Phase MPE — Manual Payment Entry (with Admin Approval)

<!-- Planned 2026-06-20 14:30 -->
### Status: PLANNED — not yet started.

Implements PRD § 14A (FR-108..FR-119, BR-057..BR-065, sentinels in § 14A.11). Standard agent order: database-manager → backend-dev → qa → frontend-dev → designer → qa.

**Pre-flight facts verified against live DB (2026-06-20):**
- `reconciliation_links.source_table` CHECK = `{upi_transactions, card_transactions, bank_statement, cash_payments}` — MUST be extended for the another-machine link source. (MPE-1)
- `reconciliation_links.payment_method` CHECK already allows `upi` — reused for both types.
- `upi_transactions` columns: `id, card_settlement_id, transaction_date, settlement_date, amount, vpa, upi_transaction_id, created_at` — no `created_by`; a manual insert is shape-identical to a pipeline insert (FR-119).
- `card_settlement` columns: `id, file_id, gross_amount, discount, gst_amount, net_amount, mpr_date, card, upi, created_at`. MPR inference walks `upi_transactions.card_settlement_id → card_settlement` filtered by shared `transaction_date`.
- `bank_statement` has 311 rows matching `narration ILIKE '%UPI SETTLEMENT%AYH059%'` — validation lookup is viable; credit amount is `deposit_amt`, filter on `date = settlement_date`.

---

## Up Next (ordered)

### MPE-1 — `mpe_schema` migration
- Agent: **database-manager** (FIRST — feature touches the DB). Read `.claude/context/database-manager.md` first.
- Build (one migration via Supabase MCP `apply_migration`, name `mpe_schema`):
  1. Create `manual_payment_entries` table exactly per PRD § 14A.5 (all columns, CHECKs incl. the conditional UPI-fields CHECK, `amount > 0`, status/type CHECKs).
  2. Indexes: `(invoice_id)`, partial `(status) WHERE status='pending'`, `(submitted_by)`, partial `(settlement_date) WHERE payment_type='upi'`.
  3. FKs: `invoice_id → hotel_invoice(id)`, `submitted_by → auth.users(id)`, `reviewed_by → auth.users(id)`, `card_settlement_id → card_settlement(id)`, `upi_transaction_ref → upi_transactions(id)`, `reconciliation_link_ref → reconciliation_links(id) ON DELETE SET NULL`.
  4. Enable RLS. SELECT policy: `submitted_by = auth.uid() OR is_admin()`. REVOKE INSERT/UPDATE/DELETE from `authenticated`.
  5. **Extend `reconciliation_links.source_table` CHECK** to add `'manual_payment_entries'` (drop + re-add constraint; preserve the existing four values). FR-109.
- Acceptance: table exists with correct constraints; `\d manual_payment_entries` shows RLS enabled; Supabase advisor shows no new ERROR (RLS-on table); inserting a `source_table='manual_payment_entries'` row into `reconciliation_links` no longer violates the CHECK (verify via a rolled-back test insert).
- Rollback note: capture DROP TABLE + restore-old-CHECK statements in the context file.

### MPE-2 — `mpe_rpcs` migration (backend logic)
- Agent: **backend-dev** (after MPE-1). Read `.claude/context/backend-dev.md` and `.claude/context/database-manager.md` (table shape from MPE-1) first.
- Build five SECURITY DEFINER RPCs (owned by `postgres`, `search_path` locked, EXECUTE granted appropriately, role-checked via `current_user_role()`, audit-logged), following the existing `rpc_reconcile_*` patterns and reusing `fn_lock_and_get_source_amount`, `fn_recompute_invoice_status`, `fn_write_audit`:
  - **FR-110** `rpc_submit_manual_payment_entry(p_invoice_id, p_payment_type, p_amount, p_transaction_date, p_settlement_date, p_vpa, p_upi_transaction_id) → jsonb`. Validate per PRD § 14A.7: UPI field-presence (`MANUAL_UPI_FIELDS_REQUIRED`), type (`INVALID_PAYMENT_TYPE`), bank-credit tolerance hard block (`MANUAL_UPI_EXCEEDS_BANK_CREDIT`), `NO_BANK_CREDIT` warning, MPR inference + `MPR_LINK_UNVERIFIED` warning (ambiguous match ⇒ NULL + flag). Insert `pending`. Returns `{entry_id, status, admin_flags[]}`. Audit `manual_payment.submit`.
  - **FR-111** `rpc_approve_manual_payment_entry(p_entry_id) → jsonb` — admin only. Guard `ENTRY_NOT_PENDING`. UPI: **re-run tolerance check against current `upi_transactions` sum** for the settlement date (hard block `MANUAL_UPI_EXCEEDS_BANK_CREDIT`, leave pending); then INSERT `upi_transactions` (capture `upi_transaction_ref`), INSERT `reconciliation_links` (`source_table='upi_transactions'`, `source_id=ref`, `payment_method='upi'`, `amount_applied=amount`) via the shared lock/remaining path, capture `reconciliation_link_ref`. Another-machine: INSERT `reconciliation_links` directly (`source_table='manual_payment_entries'`, `source_id=entry.id`, `payment_method='upi'`, no source-remaining lock). Both: `fn_recompute_invoice_status`, mark `approved` + reviewer fields, audit `manual_payment.approve` (+ reconcile-create style audit on the link). All in ONE transaction.
  - **FR-112** `rpc_reject_manual_payment_entry(p_entry_id, p_reason)` — admin only; `REASON_REQUIRED` if blank; `ENTRY_NOT_PENDING` guard; set `rejected` + reason + reviewer fields; audit `manual_payment.reject`.
  - **FR-113** `rpc_get_manual_payment_entries(p_invoice_id) → jsonb` — read-only, role-checked, no audit; returns all RLS-visible entries for the invoice ordered `submitted_at DESC`.
  - **FR-114** `rpc_get_pending_manual_payments(p_status text default 'pending') → jsonb` — admin only; global list filtered by status, newest first, joined to invoice number/guest for the queue.
- Acceptance (SQL smoke as authenticated operator + admin, all rolled back or cleaned up):
  - Submit UPI under tolerance ⇒ pending, no warnings, `card_settlement_id` inferred when a same-`transaction_date` UPI exists.
  - Submit UPI with a `settlement_date` that has no bank credit ⇒ pending + `NO_BANK_CREDIT` flag.
  - Submit UPI with `transaction_date` having no existing UPI ⇒ pending + `MPR_LINK_UNVERIFIED`, `card_settlement_id` NULL.
  - Submit UPI over tolerance ⇒ `MANUAL_UPI_EXCEEDS_BANK_CREDIT`, no row.
  - Approve UPI happy path ⇒ `upi_transactions` row created, `reconciliation_links` row created with `payment_method='upi'`, invoice status recomputed, `upi_transaction_ref` + `reconciliation_link_ref` set, audit rows present.
  - Approve when a second pending entry would now overshoot ⇒ re-validation hard-blocks, entry stays pending.
  - Approve another-machine ⇒ link with `source_table='manual_payment_entries'`, status recomputed, no `upi_transactions` row.
  - Reject without reason ⇒ `REASON_REQUIRED`; with reason ⇒ rejected + reason retained.
  - Operator calling approve/reject ⇒ `Not authorized`.
- Done when: all RPCs deployed, smoke matrix passes, advisor clean.

### MPE-3 — QA backend sweep
- Agent: **qa** (after MPE-2). Read `.claude/context/qa.md`, PRD § 14A, and backend-dev's updated context.
- Run the full FR-110..FR-114 / BR-057..BR-065 / sentinel matrix against the deployed RPCs (operator + admin sessions). Verify audit completeness (`manual_payment.submit/approve/reject`), RLS scoping (operator cannot see another user's entry; admin sees all), and that reverse-reconciliation via `rpc_admin_reverse_reconciliation` detaches `reconciliation_link_ref` (ON DELETE SET NULL) per BR-065.
- Gate: no FR moves to done without QA PASS.

### MPE-4 — Frontend: invoice-page entry point + entries list
- Agent: **frontend-dev** (after MPE-3 PASS). Read `.claude/context/frontend-dev.md`, then look at `detail-client.tsx` for the "Add Payment / Reconcile" section layout.
- Build:
  - **FR-115** "Add Payment Manually" button in the Add Payment/Reconcile section, immediately above the Linked Payments table. Modal with type selector + the two forms per § 14A.4 (UPI: transaction date, settlement date DD-MM-YYYY, amount, VPA, UPI id — all required; another-machine: amount + transaction date). `react-hook-form` + `zod`. Calls `rpc_submit_manual_payment_entry`. On success: confirmation + render returned `admin_flags` as info banners; refresh the entries list. Surface `MANUAL_UPI_EXCEEDS_BANK_CREDIT` / `MANUAL_UPI_FIELDS_REQUIRED` per § 9.6 copy.
  - **FR-116** "Manual Payment Entries" list below Linked Payments via `rpc_get_manual_payment_entries`: type, amount, dates, status badge (pending amber / approved green / rejected slate), submitter, reviewer, reviewed_at, rejection reason, warning-flag chips.
  - Types in `lib/types.ts`: `ManualPaymentEntry`, `ManualPaymentType`, `ManualPaymentStatus`, `AdminFlag`.
  - All four UI states (loading skeleton, empty "No manual entries", error banner, success toast).
- Acceptance: `npm run build` + `tsc --noEmit` clean; button placed exactly above Linked Payments; both forms validate; flags render; list reflects all statuses for the invoice.

### MPE-5 — Frontend: admin queue `/admin/manual-payments`
- Agent: **frontend-dev** (can follow MPE-4). 
- Build **FR-117**: `src/app/(app)/admin/manual-payments/page.tsx` — Pending / Approved / Rejected tabs via `rpc_get_pending_manual_payments`. Each row: invoice link, type, amount, dates, submitter, warning-flag badges. Approve action (calls `rpc_approve_manual_payment_entry`; on `MANUAL_UPI_EXCEEDS_BANK_CREDIT` show red error, keep row pending). Reject action (reason-required dialog → `rpc_reject_manual_payment_entry`). Add admin nav entry "Manual Payments". Middleware already gates `/admin/*` for operators — confirm.
- Acceptance: build/tsc clean; approve/reject work; hard-block error surfaces without losing the row; reject reason enforced; nav entry visible to admin only.

### MPE-6 — Designer polish
- Agent: **designer** (after MPE-4/MPE-5 built). 
- Polish: status badge palette (reuse issue-report badge tokens), warning-flag chip styling, modal layout/spacing, DD-MM-YYYY date input affordance, admin-queue table rhythm, approve/reject button hierarchy, disabled/loading states. No new Tailwind tokens — reuse existing.

### MPE-7 — QA full-feature sweep
- Agent: **qa** (after MPE-4/5/6). 
- End-to-end on the deployed UI as operator and admin: submit both types, observe pending state, admin approve/reject, verify invoice status flips on approval, verify the approved UPI appears in `v_transactions_with_remaining` / bank-statement drill-down / MIS (FR-119), verify rejected entries persist with reason, verify both submitter and admin see the full entries list (BR-064). Verdict gates feature completion.

---

## MPE Execution Decisions Log
| Date | Decision | Rationale |
|---|---|---|
| 2026-06-20 | database-manager goes first to add the table + extend the `source_table` CHECK before any RPC work | The another-machine approval link cannot be written until the CHECK includes `manual_payment_entries`. |
| 2026-06-20 | Re-validation logic lives entirely in `rpc_approve_manual_payment_entry`, not the frontend | Pending entries from other users may have been approved between submit and approve; only a server-side check against live `upi_transactions` is safe. |
| 2026-06-20 | Approved manual UPI inserts a real `upi_transactions` row | Makes it indistinguishable downstream (views, drill-down, MIS) — no special-casing elsewhere. |

---

## Quick verification log

| Scenario | Outcome |
|---|---|
| Partial save without `confirm_partial` | RPC raises `PARTIAL_CONFIRMATION_REQUIRED` — verified |
| Partial save with `confirm_partial=true` | Link inserted, invoice → `partial`, audit rows written — verified |
| Overpay > 5% | RPC raises hard error with explicit reduction amount — verified |
| Overpay ≤ 5% with `confirm_overpay=true` | Link inserted + `discrepancies` row + audit — verified |
| Concurrent reconciliation race | `SELECT FOR UPDATE` serialises; second caller gets remaining-exceeded error — verified |
| `npm run build` | Clean output, 17 routes — verified |
| `tsc --noEmit` | Clean — verified |
| Supabase security advisor | Pre-existing pattern WARNs (SECURITY DEFINER RPCs callable by anon — auth checked inside); critical ERROR is the 14 pipeline tables with RLS disabled, documented in Pending. |
| Phase M happy path (operator) | Candidates RPC returns default + 494 unreconciled candidates; detail RPC for `NH12101480322876` matches within ₹1 with bank credit found — verified |
| Phase Y drill-down on bank credit `0ce554f3-…` | Returns voucher `0011929675`, guest "Shree shaila Thiperappa Swamy", base_amount 5930.22, applied_total 5930, reconciled to `INV1988260114` — verified |
| BS-v2 drill on UPI `eb67085a-…` | 2 sub-rows; first reconciled to 2 invoices, sum=base_amount; second empty array + null applied_total — verified |
| RI auto-resolve | Filing a report on an `unreconciled` invoice, then reconciling to `fully_reconciled` flips the report to `resolved_by_reconciliation` via trigger; reverse-reconcile does NOT re-open (BR-047) — verified 11/11 |
| PF upload happy path | 3 rows (UPI / Cash / Bill To Company) → 3 inserted, 0 skipped, 0 invalid; methods correctly `upi`, `cash`, `corporate_credit` — verified |
| PF duplicate skip | Re-upload of same 3 rows → 0 inserted, 3 skipped, 0 invalid — verified |
| PF auto-consume + reverse | Reconcile invoice with matching `payment_entries.booking_id` → `consumed_*` populated; reverse-reconcile clears them via AFTER DELETE trigger — verified |
| Resolve guard | Filing a report on `unreconciled` invoice + calling `rpc_resolve_issue_report` → `INVOICE_NOT_RECONCILED`; reconciling partially → resolve succeeds — verified |

---

# Phase DUP — Duplicate Invoice Prevention (Pipeline Race Condition)

<!-- Planned 2026-06-20 -->
### Status: PLANNED — not yet started.

Implements PRD § 14B (FR-120..FR-123, BR-066..BR-069, log code `DUPLICATE_INVOICE_INSERT_SKIPPED`). Standard agent order: database-manager → backend-dev → qa.

**Background facts:**
- Pipeline runs an 8-way parallel worker pool (`config.yaml: max_parallel_workers: 8`). Multiple workers picked up the same `files` row simultaneously → duplicate `hotel_invoice` rows for the same `invoice_number`.
- 4 duplicate pairs found 2026-05-17. The 4 zero-link orphan rows to delete (each verified to have NO `reconciliation_links`): `38a7bdf1-452f-4ff6-b70b-f111530645e5` (INV1988260204), `a74d6958-eee1-468d-abb6-7879fea96c66` (INV1988260215), `fb7e3faf-df94-4830-a70a-07c6a1f20f9c` (INV1988260216), `66ce5006-f4e0-449d-80e1-a86ab559a7bc` (INV1988260230).
- `hotel_invoice.invoice_number` currently has NO unique constraint.

---

## DUP — Up Next (ordered)

### DUP-1 — `dup_hotel_invoice_unique_constraint` migration
- Agent: **database-manager** (FIRST — feature touches the DB). Read `.claude/context/database-manager.md` first.
- Implements PRD FR-120, FR-121, BR-069.
- Build (one migration via Supabase MCP `apply_migration`, name `dup_hotel_invoice_unique_constraint`):
  1. **Pre-flight check:** for each of the 4 candidate ids, confirm `(SELECT count(*) FROM reconciliation_links WHERE invoice_id = <id>) = 0`. Abort if any has links (the wrong row of a pair).
  2. **Delete** the 4 verified zero-link duplicate rows:
     - `38a7bdf1-452f-4ff6-b70b-f111530645e5` (INV1988260204)
     - `a74d6958-eee1-468d-abb6-7879fea96c66` (INV1988260215)
     - `fb7e3faf-df94-4830-a70a-07c6a1f20f9c` (INV1988260216)
     - `66ce5006-f4e0-449d-80e1-a86ab559a7bc` (INV1988260230)
  3. **Verify no remaining duplicates:** `SELECT invoice_number FROM hotel_invoice GROUP BY invoice_number HAVING count(*) > 1` returns zero rows. Abort the constraint add if any remain.
  4. **Add constraint:** `ALTER TABLE hotel_invoice ADD CONSTRAINT hotel_invoice_invoice_number_unique UNIQUE (invoice_number);`
- Acceptance: 4 rows deleted; no duplicate invoice_numbers remain; constraint exists and a test duplicate insert (rolled back) raises a unique violation; Supabase advisor shows no new ERROR.
- Rollback note: capture `DROP CONSTRAINT hotel_invoice_invoice_number_unique` in the context file. (Deleted orphan rows are not restorable — they were zero-link artefacts.)
- Done when: constraint live, dedup verified, rollback documented in context file.

### DUP-2 — Pipeline file-pickup locking + duplicate-insert logging
- Agent: **backend-dev** (after DUP-1). Read `.claude/context/backend-dev.md` and `.claude/context/database-manager.md` (constraint name from DUP-1) first.
- Implements PRD FR-122, FR-123, BR-067, BR-068.
- Build (Python pipeline in `src/`):
  1. **FR-122 / BR-067** — Change the file-pickup query (the query that selects the next `pending` file(s) for a worker, in `src/main.py` / `src/database/client.py` / the discovery-to-processing handoff) to `SELECT … FOR UPDATE SKIP LOCKED`. Only one worker holds a given `files` row; concurrent workers skip locked rows and pick different files. The status flip to `processing` must happen inside the same transaction that holds the lock. Note: requires a transactional/row-locking access path — if the current pickup uses the Supabase REST client (which cannot hold a row lock across statements), implement the locked pickup via a SECURITY DEFINER RPC (e.g. `rpc_claim_next_files(p_limit int)` returning claimed file ids) or a direct psycopg/Postgres connection. Document the chosen mechanism in the context file.
  2. **FR-123 / BR-068 / log code `DUPLICATE_INVOICE_INSERT_SKIPPED`** — In the `hotel_invoice` insert path, catch the UNIQUE-constraint violation on `invoice_number` (`hotel_invoice_invoice_number_unique`). On catch: emit a structured log through the existing pipeline logging mechanism (`processing_logs` / the existing logger — match whatever the pipeline already uses; do NOT create a new table) including `file_id`, the duplicate `invoice_number`, a timestamp, and the worker/run identifier. The worker must not crash; mark the file appropriately (e.g. `failed` or skipped with `error_message`) and continue the run.
- Acceptance: pickup query uses `FOR UPDATE SKIP LOCKED` (or documented RPC equivalent); a forced duplicate insert is caught, logged with all four required fields, and does not abort the run; no behavioural regression on normal single-worker processing.
- Done when: code changed, locking mechanism documented, duplicate-catch path exercised in a dry run.

### DUP-3 — QA verification sweep
- Agent: **qa** (after DUP-2). Read `.claude/context/qa.md`, PRD § 14B, and backend-dev's + database-manager's updated context.
- Verify:
  1. **No duplicates exist** — `SELECT invoice_number, count(*) FROM hotel_invoice GROUP BY invoice_number HAVING count(*) > 1` returns zero rows; the 4 named orphan ids are gone; their reconciled counterparts remain.
  2. **Constraint rejects a duplicate** — attempt a test insert of an existing `invoice_number` (rolled back / cleaned up) → unique violation raised.
  3. **SKIP LOCKED under parallel load** — simulate ≥2 concurrent workers claiming files (e.g. two transactions calling the pickup query, or a parallel pipeline dry run); confirm no two workers claim the same `files` row and no duplicate `hotel_invoice` row is produced.
  4. **Duplicate-insert logging** — confirm a caught violation emits the structured log with `file_id`, `invoice_number`, timestamp, worker/run id, and the run does not abort.
- Gate: no FR moves to done without QA PASS.

---

## DUP Execution Decisions Log
| Date | Decision | Rationale |
|---|---|---|
| 2026-06-20 | database-manager runs first (dedup + UNIQUE constraint) before any pipeline change | The constraint is the guaranteed backstop and must exist before FR-123's catch path has anything to catch. |
| 2026-06-20 | Pickup locking may require an RPC or direct PG connection if the REST client can't hold a row lock | `FOR UPDATE SKIP LOCKED` needs a real transaction held across the read+status-update; the Supabase REST path is stateless. backend-dev documents the chosen mechanism. |
| 2026-06-20 | Duplicate attempts logged via existing pipeline logging, not a new table | Per PRD § 14B.3 Part 3 — keep monitoring in one place; no schema sprawl for an exceptional event. |

---

# Phase CDW — Commission & TDS Write-off at Reconciliation

<!-- Planned 2026-06-20 15:10 -->
### Status: PLANNED — not yet started.

Implements PRD § 14C (FR-124..FR-131, BR-070..BR-076, sentinels in § 14C.11). Reuses the Phase MPE `manual_payment_entries` table and admin queue. Standard agent order: database-manager → backend-dev → qa → frontend-dev → designer → qa.

**Relationship to Phase MPE (single combined release):**
- MPE, DUP, and CDW are built and deployed together in one release. The Phase MPE `manual_payment_entries` table and MPE RPCs are being built in this same release; CDW simply **extends** them (new `party_name` column, new `payment_type` values `'commission'`/`'tds'`, and extensions to the MPE RPCs `rpc_submit_manual_payment_entry`, `rpc_approve_manual_payment_entry`, `rpc_reject_manual_payment_entry`, `rpc_get_pending_manual_payments`, `rpc_get_manual_payment_entries`).
- Ordering within the release: **MPE-1 → CDW-1** (both database tasks done together), **MPE-2 → CDW-2** (both backend tasks done together).
- `reconciliation_links.source_table` CHECK must include `'manual_payment_entries'` (FR-109, added by MPE-1). CDW-1 verifies it is present.

**Pre-flight facts to verify against live DB before CDW-1:**
- `reconciliation_links.payment_method` CHECK current values = `{upi, card, bank_transfer, cash, mmt_payout, corporate_credit}` — MUST be extended with `'commission'` and `'tds'`. (CDW-1)
- `reconciliation_links.source_table` CHECK includes `'manual_payment_entries'`? (verify; add if missing — coordinate with MPE-1)
- `manual_payment_entries` (created by MPE-1 in this release) has `payment_type` CHECK `{upi, another_machine}` — CDW-1 extends it to add `commission`, `tds` and adds `party_name` + note storage column.
- The 3 retroactive invoices exist and are `partial`: `INV1988260052` (₹167), `INV1988260060` (₹483), `INV1988260059` (₹2,000).

---

## CDW — Up Next (ordered)

### CDW-1 — `cdw_schema` migration
- Agent: **database-manager** (FIRST — feature touches the DB). Read `.claude/context/database-manager.md` first.
- Implements PRD FR-124, FR-125.
- Build (one migration via Supabase MCP `apply_migration`, name `cdw_schema`):
  1. Add `party_name text null` column to `manual_payment_entries`. Add the note-storage column (`note text null`) alongside it (PRD § 14C.5 — Note is a submitter free-text note).
  2. Extend `manual_payment_entries.payment_type` CHECK to `{'upi','another_machine','commission','tds'}` (drop + re-add; preserve existing values + the conditional UPI-fields CHECK). The base table is created by MPE-1 in this same release; CDW-1 runs after MPE-1 and simply extends it.
  3. Extend `reconciliation_links.payment_method` CHECK to add `'commission'` and `'tds'` (drop + re-add; preserve all existing values).
  4. Verify `reconciliation_links.source_table` CHECK includes `'manual_payment_entries'`; if missing, add it (FR-109).
- Acceptance: `party_name` + `note` columns exist; `payment_type` CHECK accepts `commission`/`tds` and rejects garbage (rolled-back test inserts); a `reconciliation_links` row with `payment_method='commission'` and `source_table='manual_payment_entries'` inserts without CHECK violation (rolled-back test); Supabase advisor shows no new ERROR.
- Rollback note: capture DROP COLUMN + restore-old-CHECK statements in the context file.
- Done when: schema extended, constraints verified, rollback documented in context file.

### CDW-2 — `cdw_rpcs` migration (backend logic)
- Agent: **backend-dev** (after CDW-1). Read `.claude/context/backend-dev.md` and `.claude/context/database-manager.md` (schema from CDW-1) first. Reuse `fn_recompute_invoice_status`, `fn_write_audit`; mirror the another-machine link path from MPE-2 (no source-remaining lock).
- Implements PRD FR-126, FR-127, FR-128.
- Build (extend the MPE RPCs in place via CREATE OR REPLACE; the base RPCs are created by MPE-2 in this same release, and CDW-2 runs after MPE-2 to extend them):
  - **FR-126** Extend `rpc_submit_manual_payment_entry` (add `p_party_name text`, `p_note text` params, and accept `p_payment_type ∈ {'commission','tds'}`): validate `amount > 0 AND amount ≤ remaining_gap` where `remaining_gap = grand_total − sum(reconciliation_links.amount_applied)` (`WRITEOFF_EXCEEDS_GAP`); `party_name` required (`PARTY_REQUIRED`); for `commission`, invoice `source` must not be Direct Walk-In / Direct By Phone (`WRITEOFF_SOURCE_NOT_ELIGIBLE`) — reuse/extend `fn_classify_invoice_source` to distinguish walk-in/phone. Set `transaction_date` = submission/invoice date; UPI columns NULL. Insert `pending`. Returns `{entry_id, status}`. Audit `manual_payment.submit`.
  - **FR-127** Extend `rpc_approve_manual_payment_entry` for `payment_type ∈ {'commission','tds'}`: guard `ENTRY_NOT_PENDING`; **re-check** `amount ≤ current remaining_gap` against live `reconciliation_links` (hard block `WRITEOFF_EXCEEDS_GAP`, leave pending); INSERT `reconciliation_links` (`source_table='manual_payment_entries'`, `source_id=entry.id`, `payment_method = payment_type`, `amount_applied=amount`); capture `reconciliation_link_ref`; `fn_recompute_invoice_status`; mark `approved` + reviewer fields; audit `manual_payment.approve` + reconcile-create style audit on the link. One transaction.
  - **FR-128** `rpc_reject_manual_payment_entry` already handles any pending entry — verify it covers commission/TDS (reason required `REASON_REQUIRED`, `ENTRY_NOT_PENDING` guard, retained for audit). No change expected beyond confirmation.
  - Ensure `rpc_get_manual_payment_entries` and `rpc_get_pending_manual_payments` return `party_name`, `note`, and the new types so the invoice list + admin queue render them.
  - **FR-131 backing** — add a read-only RPC `rpc_get_deductions_report(p_date_from date, p_date_to date, p_type text, p_party text) → jsonb` (role-checked operator/admin, no audit): approved commission/TDS `reconciliation_links` joined to `manual_payment_entries` + `hotel_invoice`; returns rows (Invoice #, Guest, Source, Type, Party, Amount, Approved date) + party-level totals for commission and TDS. (Alternatively a `security_invoker` view + thin RPC — document the choice.)
- Acceptance (SQL smoke as authenticated operator + admin, rolled back or cleaned up):
  - Submit commission ≤ gap on an OTA invoice ⇒ pending, no error.
  - Submit amount > gap ⇒ `WRITEOFF_EXCEEDS_GAP`, no row.
  - Submit without party ⇒ `PARTY_REQUIRED`.
  - Submit commission on a Direct Walk-In invoice ⇒ `WRITEOFF_SOURCE_NOT_ELIGIBLE`.
  - Approve commission/TDS ⇒ `reconciliation_links` row with `payment_method='commission'|'tds'`, `source_table='manual_payment_entries'`; invoice flips to `fully_reconciled` when gap closes; `reconciliation_link_ref` set; audit rows present.
  - Approve when gap has shrunk below amount (another approval landed first) ⇒ `WRITEOFF_EXCEEDS_GAP`, entry stays pending.
  - Reject without reason ⇒ `REASON_REQUIRED`; with reason ⇒ rejected + retained.
  - Operator calling approve ⇒ `Not authorized`.
  - `rpc_get_deductions_report` returns correct rows + party totals; filters by date/type/party work.
- Done when: all RPCs deployed/updated, smoke matrix passes, advisor clean.

### CDW-3 — QA backend sweep
- Agent: **qa** (after CDW-2). Read `.claude/context/qa.md`, PRD § 14C, and backend-dev's updated context.
- Run the full FR-124..FR-128 / FR-131-backing / BR-070..BR-076 / sentinel matrix against the deployed RPCs (operator + admin). Verify: amount cap at submit AND approve; party required; source eligibility (commission blocked on walk-in/phone); approval creates the link and flips status to `fully_reconciled`; reverse-reconciliation detaches the link (`reconciliation_link_ref` SET NULL, BR-075); report RPC totals correct; audit completeness (`manual_payment.submit/approve/reject`); RLS scoping (submitter + admin see entries).
- Gate: no FR moves to done without QA PASS.

### CDW-4 — Frontend: invoice-page "Mark as Commission / TDS"
- Agent: **frontend-dev** (after CDW-3 PASS). Read `.claude/context/frontend-dev.md`; look at `detail-client.tsx` Add Payment / Reconcile section and the MPE "Add Payment Manually" button (placed above Linked Payments) — the new button sits **below** "Add Payment Manually".
- Implements PRD FR-129, FR-130.
- Build:
  - **FR-129** "Mark as Commission / TDS" button rendered below "Add Payment Manually", visible only when `grand_total − sum(linked amount_applied) > 0` AND invoice source is not Direct Walk-In / Direct By Phone (reuse `classifyInvoiceSource()` / source check). Modal with: Type (Commission | TDS) radio/select; Party dropdown (MMT/Goibibo/Agoda/Yatra/Others — Others reveals a free-text field); Amount (pre-filled with remaining gap, hard-capped client-side at the gap, > 0); Note (optional). `react-hook-form` + `zod`. Calls the extended `rpc_submit_manual_payment_entry` with `p_payment_type`, `p_party_name`, `p_note`. Surface `WRITEOFF_EXCEEDS_GAP` / `PARTY_REQUIRED` / `WRITEOFF_SOURCE_NOT_ELIGIBLE` per § 9.6 copy. On success: confirmation + refresh entries list.
  - **FR-130** The existing "Manual Payment Entries" list (MPE-4) renders commission/TDS entries: type badge (Commission/TDS), party, amount, note, status badge (pending amber / approved green / rejected slate), submitter/reviewer/reviewed_at, rejection reason.
  - Types in `lib/types.ts`: extend `ManualPaymentType` with `'commission' | 'tds'`; add `party_name`, `note` to `ManualPaymentEntry`.
  - All four UI states (loading skeleton, empty, error banner, success toast).
- Acceptance: `npm run build` + `tsc --noEmit` clean; button placed below "Add Payment Manually"; hidden on walk-in/phone invoices and when gap is zero; amount capped at gap; Others reveals free-text; list shows commission/TDS entries with all statuses.

### CDW-5 — Frontend: reporting page `/reports/deductions`
- Agent: **frontend-dev** (can follow CDW-4). Implements PRD FR-131.
- Build `src/app/(app)/reports/deductions/page.tsx`: filters (date range, type Commission/TDS, party); table (Invoice #, Guest, Source, Type, Party, Amount, Approved date) via `rpc_get_deductions_report`; summary totals (total commission by party, total TDS by party). Accessible to all logged-in users — add nav entry "Deductions" (both roles). Confirm middleware does not gate `/reports/*` for operators.
- Acceptance: build/tsc clean; filters work; table + party-level totals correct against seed data; nav entry visible to both roles; all four UI states.

### CDW-6 — Designer polish
- Agent: **designer** (after CDW-4/CDW-5 built).
- Polish: Commission/TDS type badge palette (reuse existing badge tokens), party chip styling, modal layout/spacing (Type → Party → Amount → Note rhythm), Others free-text reveal affordance, capped-amount input hint, `/reports/deductions` table rhythm + summary-totals card treatment. No new Tailwind tokens — reuse existing.

### CDW-7 — QA full-feature sweep + retroactive cleanup verification
- Agent: **qa** (after CDW-4/5/6).
- End-to-end on the deployed UI as operator and admin: submit commission + TDS write-offs on eligible invoices; confirm button hidden on Direct Walk-In/Phone and when gap is zero; amount cap enforced (cannot submit more than gap); admin approve/reject from `/admin/manual-payments`; verify invoice flips to `fully_reconciled` on approval; verify the write-off link appears with `payment_method='commission'|'tds'`; verify `/reports/deductions` rows + party totals are correct; verify the three retroactive invoices (`INV1988260052` ₹167 commission, `INV1988260060` ₹483 commission, `INV1988260059` ₹2,000 TDS) can be closed via this mechanism (PRD § 14C.12). Verdict gates feature completion.

---

## CDW Execution Decisions Log
| Date | Decision | Rationale |
|---|---|---|
| 2026-06-20 | Reuse `manual_payment_entries` + the MPE admin queue rather than a new table/queue | Commission/TDS is the same submit → pending → approve discipline; one audit path, one queue. MPE, DUP, and CDW ship together in one release; CDW extends the MPE table/RPCs (ordering: MPE-1 → CDW-1, MPE-2 → CDW-2). |
| 2026-06-20 | database-manager runs first to add `party_name`/`note` + extend `payment_type` and `payment_method` CHECKs | The approval link cannot write `payment_method='commission'|'tds'` until the CHECK includes them. |
| 2026-06-20 | Write-off link uses `source_table='manual_payment_entries'` (mirrors another-machine path) | A deduction has no real payment source row; the entry is the source. No source-remaining lock applies. |
| 2026-06-20 | Amount hard-capped at remaining gap, re-checked at approval | A write-off only closes a gap; other approvals may have shrunk it since submission. |
| 2026-06-20 | `/reports/deductions` exposed to both roles | Commission/TDS leakage visibility is a shared concern. |
