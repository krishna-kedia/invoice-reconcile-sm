# Product Requirements Document
## Hotel Invoice Reconciliation System

<!-- Last updated: 2026-07-19 -->

---

## 1. Overview

A no-nonsense internal web application for a single hotel to reconcile guest invoices against payments received via Cash, UPI, Card, Bank Transfer, MMT payouts, Yatra payouts, Agoda payouts, and Corporate Credit. The app sits on top of an existing Python OCR backend that already extracts hotel invoices, MMT invoices/payouts, Yatra payouts, Agoda payouts, HDFC Merchant Payment Reports (MPR), and HDFC bank statements into a Supabase database. V1 delivers:

- Walk-in invoice reconciliation (UPI / Card / Bank Transfer / Cash).
- MMT/Goibibo payout reconciliation (bank-statement-anchored).
- Yatra payout reconciliation (UPI / Card / Bank Transfer; never cash).
- Agoda payout reconciliation (same pattern as Yatra).
- A read-only Bank Statement ledger with drill-down attribution and Excel export.
- Operator-reported invoice issues (auto-resolved on full reconciliation, manually resolvable by admin once partially reconciled).
- Payment Folio (.xls) upload from the hotel PMS, with auto-select pre-fill on every reconcile panel.
- An MIS dashboard with monthly summaries and source-level deduction breakdowns for MMT and Yatra.
- An immutable audit log of every mutation in the system.

Two roles: **operator** (day-to-day reconciler) and **admin** (owner — approves operator requests, reviews discrepancies and issue reports, configures payment sources and issue categories, uploads Payment Folios, sees the home dashboard).

---

## 2. Problem Statement

Reconciling each invoice against payment evidence (UPI / Card / bank / cash / OTA payout) was manual, ad-hoc, and error-prone. There was no system that:
- Prevented the same payment transaction from being counted against two different invoices.
- Enforced all-or-nothing updates so a half-saved reconciliation could not leave the books inconsistent.
- Gave management visibility into what is unreconciled, partial, or flagged for review.
- Maintained a tamper-proof audit trail of every reconciliation action.
- Prevented an operator from silently making destructive changes without admin approval.
- Tied bank-statement credits, OTA payouts, and the PMS-side payment folio into one reconciliation surface.

This system removes manual reconciliation and replaces it with a controlled, auditable workflow.

---

## 3. Users & Roles

| Role | Capabilities |
|---|---|
| **operator** | View invoice list. Open an invoice. Reconcile via any of the four panels (walk-in, MMT, Yatra, Agoda). Submit requests to un-reconcile (link or invoice) or edit/delete cash entries. File invoice issue reports; withdraw their own. View Bank Statement page. Upload Payment Folio. Read audit log. Cannot directly mutate any saved record. |
| **admin** | All operator capabilities. Plus: Admin Home dashboard. Approve/reject operator requests. Resolve discrepancies. Reverse reconciliations atomically without approval. Resolve issue reports. Configure payment-source mapping and issue categories. View MIS reports. |

Both roles authenticate via Supabase Auth (email/password). RLS policies plus SECURITY DEFINER role-checked RPCs enforce the boundary. Users are provisioned manually by an admin (no self-signup in V1).

Seed accounts (V1):
- **Admin** — `krishnagopal.kedia@optimoloan.com` (`45bcd1e5-e628-4480-b9c6-08d4b8d936c9`).
- **Operator** — `operator@hotel.local` (`6e50c4f5-94f4-40ab-b7b3-9919f6138a57`).

---

## 4. Tech Stack

- **Database / Auth / RLS / RPC** — Supabase (Postgres). Migrations applied via Supabase MCP `apply_migration` (no local `supabase/migrations/` directory in V1).
- **Frontend** — Next.js 14 App Router, TypeScript, Tailwind, shadcn-style primitives, `@supabase/ssr` for cookie auth, `@tanstack/react-query` for data fetching, `zod` + `react-hook-form` for forms, `date-fns` for dates, `lucide-react` for icons, `xlsx` (SheetJS) for Bank Statement export.
- **OCR pipeline (separate Python service in `src/`)** — extracts hotel invoices, MMT invoices, MMT payouts (JSON), Yatra payouts (JSON), Agoda payouts (JSON), card settlements, UPI transactions, card transactions, HDFC bank statements into the same Supabase project.
- **Deployment** — Vercel for the Next.js app. GitHub Actions for backend pipeline.
- **Browser** — Latest Chrome and Safari on desktop only.

Environment variables (frontend `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
Environment variables (backend `.env`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MMT_PAYOUTS`, `YATRA_PAYOUTS`, `AGODA_PAYOUTS`, plus Google Drive folder IDs.

---

## 5. Data Model

All tables live in the `public` schema. Tables marked **RLS on** are policy-protected; tables marked **RLS off** are pipeline tables accessed only by SECURITY DEFINER RPCs (see § 13).

### 5.1 OCR / pipeline tables (RLS off)

#### `files` (904 rows)
File-level metadata for everything pulled from Google Drive. Columns: `id`, `drive_file_id` (UNIQUE), `drive_folder_id`, `document_type`, `file_name`, `file_type`, `file_size`, `drive_created_at`, `drive_modified_at`, `status` (`pending|processing|completed|failed`), `ocr_retry_count`, `error_message`, `created_at`, `updated_at`.

#### `ocr_outputs` (945 rows)
Raw OCR text per file. Columns: `id`, `file_id → files`, `raw_text`, `ocr_metadata jsonb`, `created_at`.

#### `extractions` (831 rows)
LLM-extracted structured fields per file. Columns: `id`, `file_id`, `document_type`, `extracted_fields jsonb`, `extraction_metadata jsonb`, `created_at`.

#### `processing_logs` (3883 rows)
Per-file pipeline events. Columns: `id`, `file_id`, `operation` (`discovery|download|ocr|extraction|error`), `status` (`success|failure`), `details jsonb`, `created_at`.

### 5.2 Invoice tables (RLS off — accessed via REST under existing access pattern; admin should enable RLS in V1.5)

#### `hotel_invoice` (237 rows)
The reconciliation target. One row per guest invoice (walk-in or OTA).
- `id uuid pk`, `file_id → files`, `guest_name text`, `source text` (e.g. `MakeMyTrip`, `Goibibo`, `Yatra`, `Agoda`, NULL or other = walk-in), `arrival_time date`, `departure_time date` (drives MIS `invoice_month`), `booking_id text`, `booking_date date`, `taxable_amount numeric`, `cgst numeric`, `sgst numeric`, `grand_total numeric`, `invoice_number text`, `reconciliation_status text` (CHECK: `unreconciled | partial | fully_reconciled | flagged_for_review`, default `unreconciled`), `created_at`.

#### `mmt_invoice` (537 rows)
MMT/Goibibo OTA invoice with the commercial line items used by the MMT formula.
- `id`, `file_id`, `primary_guest_details`, `booking_id`, `booked_on`, `check_in`, `check_out`, `room_charges`, `extra_adult_child_charges`, `property_taxes`, `service_charge`, `property_gross_charges`, `go_mmt_commission`, `gst_on_commission`, `tcs`, `tds`, `created_at`, `reconciled_at`, `reconciled_link_id → reconciliation_links`.

### 5.3 Payment / bank source tables (RLS off)

#### `bank_statement` (1563 rows)
HDFC bank statement rows.
- `id`, `file_id`, `date`, `narration`, `chq_ref_no`, `value_dt`, `withdrawal_amt`, `deposit_amt`, `closing_balance`, `row_number`, `created_at`.

#### `card_settlement` (46 rows)
Settlement batches from HDFC MPR. `id`, `file_id`, `gross_amount`, `discount`, `gst_amount`, `net_amount`, `mpr_date`, `card`, `upi`, `created_at`. Note: `card`/`upi` are always NULL in live data; classification done via narration substring on `bank_statement`.

#### `card_transactions` (82 rows)
Card swipe lines. `id`, `card_settlement_id`, `transaction_date`, `settlement_date`, `gross_amount`, `mdr_percent`, `created_at`. `net_after_mdr = gross_amount × (1 − mdr_percent/100)`.

#### `upi_transactions` (86 rows)
UPI receipts. `id`, `card_settlement_id`, `transaction_date`, `settlement_date`, `amount`, `vpa`, `upi_transaction_id`, `created_at`.

### 5.4 OTA payout tables (RLS off)

#### `mmt_payouts` (31 rows)
Bank leg of an MMT settlement. PK `transaction_no text`. `file_id`, `subject_ref`, `email_date`, `exported_at`, `processing_date`, `total_amount`, `bank_name`, `beneficiary`, `account_number`, `transaction_date`, `total_bookings`, `total_payable_amount`, `created_at`.

#### `mmt_bookings_payout` (51 rows)
One row per booking inside a payout.
- `id`, `file_id`, `transaction_no → mmt_payouts`, `booking_id`, `booking_pnr`, `client_name`, `hotel_name`, `hotel_city`, `check_in`, `check_out`, `original_cost`, `payable`, `booking_type`, `brand`, `created_at`, `reconciled_at`, `reconciled_link_id → reconciliation_links`. `UNIQUE (transaction_no, booking_id)`.

#### `yatra_bookings_payout` (8 rows)
Yatra payout commercials. `UNIQUE (voucher_no)` was dropped per FR-076 v2; duplicate detection lives in the inserter (log-and-skip).
- `id`, `file_id`, `voucher_no`, `guest_name`, `guest_email`, `guest_phone`, `email_date`, `is_pre_pay`, `booking_date`, `check_in`, `check_out`, `number_of_rooms`, `adults`, `children`, `room_name`, `room_type`, `rate_plan_type`, `total_room_charges`, `other_charges`, `hotel_gross_charges`, `yatra_commission`, `yatra_commission_with_gst`, `gst`, `tcs`, `tds`, `yatra_to_pay_hotel` (canonical reconcile amount), `reconciled_at`, `reconciled_link_id → reconciliation_links`, `created_at`.

#### `agoda_bookings_payout` (18 rows)
Agoda payout per booking (one row per booking).
- `id`, `file_id`, `booking_id`, `email_date`, `status`, `iata`, `guest_name`, `country_of_residence`, `check_in`, `check_out`, `other_guests`, `room_rate`, `reference_sell_rate`, `extra_bed_rate`, `commission`, `compensation`, `other_programs`, `tds_withholding_tax`, `net_rate` (canonical reconcile amount), `booked_and_payable_by`, `reconciled_at`, `reconciled_link_id → reconciliation_links`, `created_at`.

### 5.5 Reconciliation core (RLS on)

#### `user_profiles` (2 rows)
Hotel staff profile extending `auth.users`. PK `user_id`, `display_name`, `role` (CHECK `admin | operator`), `created_at`.

#### `cash_payments` (2 rows)
Manual cash entries. `id`, `payment_date`, `amount` (>0), `created_by → user_profiles`, `created_at`. Surfaced through `reconciliation_links` like any other source.

#### `reconciliation_links` (21 rows)
**The heart of the system.** One row = one `(invoice, source_transaction)` pairing with an amount applied.
- `id`, `invoice_id → hotel_invoice`, `source_table text` (CHECK: `upi_transactions | card_transactions | bank_statement | cash_payments`), `source_id uuid`, `payment_method text` (CHECK: `upi | card | bank_transfer | cash | mmt_payout | corporate_credit`), `amount_applied numeric` (>0), `created_by → user_profiles`, `created_at`.
- Indexes: `(invoice_id)`, `(source_table, source_id)`.
- FK back-pointers from `mmt_invoice`, `mmt_bookings_payout`, `yatra_bookings_payout`, `agoda_bookings_payout` via `reconciled_link_id` (`ON DELETE SET NULL`).

#### `approval_requests` (0 rows in V1)
Operator-submitted change requests pending admin decision. `id`, `request_type` (CHECK: `unreconcile_link | unreconcile_invoice | cash_edit | cash_delete`), `target_invoice_id`, `target_link_id`, `target_cash_id`, `payload jsonb`, `reason`, `status` (`pending|approved|rejected`), `requested_by`, `requested_at`, `decided_by`, `decided_at`, `decision_note`.

#### `discrepancies` (0 rows in V1)
Soft-overpay flags (≤5%). `id`, `invoice_id`, `invoice_total`, `linked_total`, `diff_amount`, `diff_percent`, `status` (`open|resolved|reversed`), `flagged_by`, `flagged_at`, `resolved_by`, `resolved_at`, `resolution_note`.

#### `payment_source_config` (7 rows)
Admin-managed mapping of payment method → allowed source tables.
- `id`, `payment_method` (CHECK includes `corporate_credit`), `source_table`, `is_active`, `UNIQUE(payment_method, source_table)`.
- Seed: `upi → upi_transactions`, `upi → bank_statement`, `card → card_transactions`, `card → bank_statement`, `bank_transfer → bank_statement`, `cash → cash_payments`, `mmt_payout → bank_statement`.

#### `audit_log` (59 rows; append-only)
Every mutation in the system writes one row.
- `id bigserial`, `occurred_at`, `actor_user_id → user_profiles`, `actor_role`, `action text` (e.g. `reconcile.create`, `reconcile.create.mmt`, `reconcile.create.yatra`, `reconcile.create.agoda`, `payment_folio.upload`, `payment_entry_consumed`, `payment_entry_unconsumed`, `issue_report_created`, `issue_report_resolved`, `issue_report_withdrawn`, `issue_report_auto_resolved`, `mmt_invoice.update`, `mmt_bookings_payout.update`, `yatra_bookings_payout.update`, `agoda_bookings_payout.update`, `approval.approve`, `approval.reject`, `cash.create`, `discrepancy.resolve`, `reverse.invoice`), `entity_type`, `entity_id`, `before_state jsonb`, `after_state jsonb`, `context jsonb`.
- Immutability: `REVOKE UPDATE, DELETE` from every role; BEFORE UPDATE/DELETE trigger `audit_log_block_mutation` raises `audit_log is append-only`.

### 5.6 Issue reports (RLS on)

#### `invoice_issue_reports` (2 rows)
Operator-reported issues on invoices. Informational — does NOT block reconciliation.
- `id`, `invoice_id → hotel_invoice ON DELETE CASCADE`, `source_snapshot text`, `category text` (FK to `issue_categories.code`), `notes text`, `status` (CHECK: `open | resolved_by_admin | resolved_by_reconciliation | withdrawn_by_operator`), `reported_by → auth.users`, `reported_at`, `resolved_by → auth.users`, `resolved_at`, `resolution_notes`, `created_at`, `updated_at`.
- Partial unique index `uq_invoice_issue_reports_one_open_per_invoice` on `(invoice_id) WHERE status='open'`.
- RLS SELECT: `reported_by = auth.uid() OR is_admin()`. INSERT/UPDATE/DELETE revoked from `authenticated`.
- BEFORE UPDATE trigger maintains `updated_at`.

#### `issue_categories` (18 rows)
The dropdown catalog used by the report dialog. Configurable in V1 via admin UI.
- `id`, `code text UNIQUE` (regex `^[a-z][a-z0-9_]*$`), `label text`, `applies_to text[]` (subset of `{all, mmt, yatra, agoda, walk_in}`, ≥1 element), `is_active`, `sort_order`, `created_at`, `updated_at`.

Seeded codes (FR-089): `amount_mismatch`, `guest_name_mismatch`, `dates_mismatch`, `payment_not_received`, `duplicate_booking`, `booking_not_found_in_mmt`, `mmt_payout_missing`, `mmt_commission_mismatch`, `voucher_not_found_in_yatra`, `yatra_payout_missing`, `yatra_to_pay_amount_wrong`, `agoda_booking_not_found`, `agoda_payout_missing`, `cash_not_deposited`, `upi_txn_not_found`, `card_settlement_missing`, `bank_transfer_not_found`, `other`.

### 5.7 Payment Folio tables (RLS on)

#### `payment_folio_uploads` (2 rows)
One row per admin/operator upload of the PMS `.xls`.
- `id`, `uploaded_by → user_profiles`, `uploaded_at`, `file_name`, `file_size_bytes`, `sha256`, `row_count`, `inserted_count`, `skipped_count`, `invalid_count`, `status` (`completed|partial|failed`), `error_text`, `parse_warnings jsonb`.
- RLS SELECT: `is_admin() OR uploaded_by = auth.uid()`. Mutations revoked.

#### `payment_entries` (295 rows)
Suggestion surface, not a reconciliation source.
- `id`, `upload_id → payment_folio_uploads`, `source_row_index`, `booking_id text`, `payment_type_raw text`, `received_date date`, `reference_text text`, `payment_amount numeric` (>0), `invoice_number_raw text`, `payment_method text` (CHECK: `upi | card | bank_transfer | cash | mmt_payout | agoda_payout | yatra_payout | corporate_credit | manual`), `collector_hint text`, `consumed_for_invoice_id → hotel_invoice ON DELETE SET NULL`, `consumed_at`, `consumed_link_id → reconciliation_links ON DELETE SET NULL`, `created_at`.
- Unique expression index `uq_payment_entries_dedup` on `(COALESCE(booking_id,''), payment_type_raw, received_date, COALESCE(reference_text,''), payment_amount, COALESCE(invoice_number_raw,''))` — NULL-canonicalised 6-tuple match for skip-on-duplicate.
- Indexes: `(booking_id) WHERE NOT NULL`, `(invoice_number_raw) WHERE NOT NULL`, `(consumed_for_invoice_id) WHERE NULL`.
- RLS SELECT: TO authenticated USING (true). Mutations revoked.

---

## 6. Database Views

All views use `WITH (security_invoker = true)` so base-table RLS applies to the calling user.

### `v_transactions_with_remaining`
Unified view over `upi_transactions`, `card_transactions`, `bank_statement` (credits only), `cash_payments`. Per-row `remaining = original_amount − sum(reconciliation_links.amount_applied where source_table=X and source_id=Y)`. Used by the walk-in transaction picker. Key columns: `source_table`, `source_id`, `payment_date` (UPI/Card → `transaction_date`; bank → `date`; cash → `payment_date`), `original_amount`, `used_amount`, `remaining`, `identifier_text`, `time_text`, `payment_method`.

### `v_mis_monthly_summary`
One row per `invoice_month` (`departure_time` truncated to month). Columns: `invoice_month`, `invoice_count`, `total_invoiced`, `total_received`, `same_month_received`, `other_month_received`, `pending`. Ordered `invoice_month DESC`. NULL `departure_time` excluded.

### `v_mis_payment_detail`
One row per `(invoice_month, payment_month, payment_method)`. `amount_received`. Payment month per source: upi/card → `settlement_date`; bank_statement → `date`; cash_payments → `payment_date`.

### `v_mmt_monthly_deductions`
One row per `(year, month, hotel_name)` over reconciled MMT bookings. Aggregates: `bookings_count`, `total_tariff_sum`, `service_tax_sum`, `mmt_commission_amt_sum`, `tds_amt_sum`, `gst_on_commission_sum`, `mmt_to_pay_hotel_sum`. Drives the MMT tab on `/admin/mis`.

### `v_yatra_monthly_deductions`
Mirror of the MMT view for Yatra. Columns: `month_start`, `year`, `month`, `bookings_count`, `total_tariff_sum`, `yatra_commission_amt_sum`, `yatra_commission_with_gst_sum`, `tds_amt_sum`, `gst_on_commission_sum`, `tcs_amt_sum`, `yatra_to_pay_hotel_sum`, `other_charges_sum`, `hotel_gross_charges_sum`.

### `v_invoice_list_with_issue`
`hotel_invoice` columns + `EXISTS(open issue report)` as `has_open_issue boolean`. The Invoice list page selects from this view.

---

## 7. RPCs

All mutation RPCs are `SECURITY DEFINER`, owned by `postgres`, search_path locked, EXECUTE granted to `authenticated`, role-checked via `current_user_role()`, and write to `audit_log` before commit. Read-only RPCs explicitly skip audit.

### 7.1 Helper functions (EXECUTE revoked from anon/authenticated)

| Function | Purpose |
|---|---|
| `current_user_role()` | Returns the calling user's role from `user_profiles`. |
| `is_admin()`, `is_operator_or_admin()` | Role-guard helpers. |
| `fn_write_audit(actor uuid, action text, entity_type text, entity_id text, before jsonb, after jsonb, context jsonb)` | Append-only audit-log insert. |
| `fn_lock_and_get_source_amount(source_table text, source_id uuid)` | `SELECT FOR UPDATE` the source row; returns `(original_amount, used_amount, remaining)`. |
| `fn_recompute_invoice_status(invoice_id uuid)` | Re-derives `hotel_invoice.reconciliation_status` from links + discrepancies. |
| `fn_auto_resolve_issue_reports(invoice_id uuid, actor uuid)` | Marks all `open` reports on the invoice as `resolved_by_reconciliation`; called by `trg_hotel_invoice_after_status_change`. |
| `fn_classify_invoice_source(source text) → text` | Returns `mmt | yatra | agoda | walk_in`. |
| `fn_issue_category_allowed(category text, source_bucket text) → bool` | Catalog-aware category validator. |
| `fn_consume_payment_entry(invoice_id uuid, link_id uuid) → int` | Marks matching `payment_entries` rows as consumed; called from each reconcile RPC. |
| `fn_mmt_clear_reconciled_at_on_link_delete()` / `fn_yatra_clear_reconciled_at_on_link_delete()` / `fn_payment_entries_clear_consumed_on_link_delete()` | AFTER DELETE trigger functions on `reconciliation_links` clearing back-pointers / consumption. |
| `fn_hotel_invoice_after_status_change()` | AFTER UPDATE trigger: when `reconciliation_status` transitions to `fully_reconciled`, invokes `fn_auto_resolve_issue_reports`. |
| `fn_invoice_issue_reports_set_updated_at()`, `fn_issue_categories_set_updated_at()`, `update_updated_at_column()` | BEFORE UPDATE triggers maintaining `updated_at`. |
| `audit_log_block_mutation()` | BEFORE UPDATE/DELETE trigger on `audit_log` raising `audit_log is append-only`. |

### 7.2 Reconciliation RPCs

| RPC | Signature | Role | Purpose |
|---|---|---|---|
| `rpc_reconcile_invoice` | `(p_invoice_id uuid, p_links jsonb, p_confirm_partial bool, p_confirm_overpay bool) → jsonb` | operator/admin | Core walk-in atomic reconciliation. Validates each link, locks sources via `fn_lock_and_get_source_amount`, enforces 5% overpay rule, supports inline cash creation (`source_table='cash_payments', source_id=null, cash_payment_date=YYYY-MM-DD`), creates discrepancies on soft overpay, writes audit, calls `fn_consume_payment_entry` for each new link. Sentinels: `PARTIAL_CONFIRMATION_REQUIRED`, `OVERPAY_CONFIRMATION_REQUIRED`. |
| `rpc_reconcile_mmt_invoice` | `(p_hotel_invoice_id uuid, p_mmt_invoice_id uuid, p_mmt_bookings_payout_id uuid, p_bank_statement_id uuid, p_confirm_partial bool, p_confirm_overpay bool) → jsonb` | operator/admin | Atomic MMT reconciliation. Locks `mmt_invoice`, `mmt_bookings_payout`, `bank_statement` rows. Inserts ONE `reconciliation_links` row (`source_table='bank_statement'`, `payment_method='mmt_payout'`, amount = `payable`), sets back-pointers, calls `fn_consume_payment_entry`. |
| `rpc_reconcile_yatra_invoice` | `(p_hotel_invoice_id uuid, p_yatra_bookings_payout_id uuid, p_source_table text, p_source_id uuid, p_payment_method text, p_amount_applied numeric, p_confirm_partial bool, p_confirm_overpay bool) → jsonb` | operator/admin | Atomic Yatra reconciliation. `p_payment_method` must be `upi | card | bank_transfer` (cash rejected via `YATRA_CASH_NOT_ALLOWED`). Inserts one `reconciliation_links` row with the **real underlying method** (never `yatra_payout`). Sets `yatra_bookings_payout.reconciled_at` + `reconciled_link_id`. |
| `rpc_reconcile_agoda_invoice` | `(p_hotel_invoice_id uuid, p_agoda_bookings_payout_id uuid, p_source_table text, p_source_id uuid, p_payment_method text, p_amount_applied numeric, p_confirm_partial bool, p_confirm_overpay bool) → jsonb` | operator/admin | Same pattern as Yatra. |
| `rpc_admin_reverse_reconciliation` | `(p_invoice_id uuid, p_note text)` | admin | Deletes all `reconciliation_links` rows for the invoice. AFTER DELETE triggers cascade-clear MMT/Yatra/Agoda back-pointers and `payment_entries.consumed_*`. Writes audit. Does NOT re-open auto-resolved issue reports (BR-047). |

### 7.3 Detail / candidate RPCs (read-only, role-checked, no audit)

| RPC | Returns |
|---|---|
| `rpc_get_mmt_reconcile_candidates(p_hotel_invoice_id uuid)` | `{hotel_invoice_booking_id, hotel_invoice_guest_name, default_booking_id, match_type, candidates[]}` — unreconciled `mmt_invoice` rows ordered with default first. Default match: booking_id, then guest_name. |
| `rpc_get_mmt_reconcile_detail(p_booking_id text)` | `{mmt_invoice, mmt_bookings_payout, bank_statement, computed_payable, payout_payable, amount_diff, match_within_tolerance, tolerance_rupees}`. Sentinels: `MMT_INVOICE_NOT_FOUND`, `MMT_PAYOUT_NOT_FOUND`, `MMT_PAYOUT_AMBIGUOUS`, `MMT_BANK_NOT_FOUND`, `MMT_BANK_AMBIGUOUS`. |
| `rpc_get_yatra_reconcile_candidates(p_hotel_invoice_id uuid)` | `{hotel_invoice_guest_name, default_voucher_no, match_type, candidates[]}`. Auto-match is `lower(guest_name)` exact. |
| `rpc_get_yatra_reconcile_detail(p_voucher_no text)` | Full `yatra_bookings_payout` row + `is_already_reconciled`, `linked_invoice_id`, `linked_invoice_number`. Sentinel: `YATRA_VOUCHER_NOT_FOUND`. |
| `rpc_get_agoda_reconcile_candidates(p_hotel_invoice_id uuid)` | Same shape as Yatra; auto-match by guest_name. |
| `rpc_get_agoda_reconcile_detail(p_booking_id text)` | Full `agoda_bookings_payout` row + reconciled-link context. Sentinel: `AGODA_BOOKING_NOT_FOUND`. |
| `rpc_get_payment_suggestions(p_invoice_id uuid)` | Returns unconsumed `payment_entries` rows that match the invoice on `booking_id` or `invoice_number_raw`, ordered by `match_type` (`invoice_number > booking_id`) then `received_date DESC`. |
| `rpc_get_bank_statement_view(p_date_from, p_date_to, p_narration, p_chq_ref, p_methods text[], p_invoice_number, p_amount_min, p_amount_max, p_drill_types text[], p_page int, p_page_size int) → jsonb` | Paginated bank-statement rows with row-splitting per `reconciliation_links`. Each row carries `drill_type` (`upi_settlement | card_settlement | mmt_payout | yatra_payout | null`) and `drill_count {upi, card, mmt, yatra}`. |
| `rpc_get_bank_statement_drilldown(p_bank_statement_id uuid, p_drill_type text) → jsonb` | Lazy drill-down. Each sub-row carries `reconciled_invoices[]`, `applied_total`, `base_amount` for per-sub-row attribution + tinting (FR-087). |
| `rpc_admin_home_summary()` | Aggregates: `unreconciled_count/amount`, `status_breakdown`, `aging {0-7, 8-30, 30+}`, `cash_vs_digital_30d`, `pending_approvals`, `flagged_discrepancies`, `recent_audit[20]`. |

### 7.4 Field-edit RPCs (operator/admin; direct edit, no approval queue)

| RPC | Editable fields | Sentinels |
|---|---|---|
| `rpc_update_mmt_invoice_fields(p_id uuid, p_fields jsonb)` | `room_charges`, `extra_adult_child_charges`, `property_taxes`, `service_charge`, `go_mmt_commission`, `gst_on_commission`, `tcs`, `tds` | `MMT_LOCKED` if `reconciled_at IS NOT NULL`. |
| `rpc_update_mmt_bookings_payout_fields(p_id uuid, p_fields jsonb)` | `payable` | `MMT_LOCKED`. |
| `rpc_update_yatra_bookings_payout_fields(p_id uuid, p_fields jsonb)` | All eight base commercials + extended (`other_charges`, `hotel_gross_charges`, `yatra_commission_with_gst`, `tcs`) + booking context (`guest_name/email/phone`, `hotel_name`, `check_in/out`, `booking_date`, `is_pre_pay`, `email_date`, `number_of_rooms`, `adults`, `children`, `room_name`, `room_type`, `rate_plan_type`). Not editable: `voucher_no`, `file_id`, `reconciled_*`, `id`, `created_at`, `raw_json`, `source_file_name`, `drive_file_id`, `parsed_at`. | `YATRA_PAYOUT_LOCKED`. |
| `rpc_update_agoda_bookings_payout_fields(p_id uuid, p_fields jsonb)` | Whitelisted Agoda commercials + booking context. | `AGODA_PAYOUT_LOCKED`. |

### 7.5 Approval / admin RPCs

| RPC | Caller | Effect |
|---|---|---|
| `rpc_request_unreconcile_link(p_link_id uuid, p_reason text)` | operator | Creates `approval_requests` row + audit. |
| `rpc_request_unreconcile_invoice(p_invoice_id uuid, p_reason text)` | operator | Creates `approval_requests` row + audit. |
| `rpc_request_cash_edit(p_cash_id uuid, p_new_payload jsonb, p_reason text)` | operator | Creates `approval_requests` row + audit. |
| `rpc_request_cash_delete(p_cash_id uuid, p_reason text)` | operator | Creates `approval_requests` row + audit. |
| `rpc_approve_request(p_request_id uuid, p_note text)` | admin | Atomically applies the change + audit. |
| `rpc_reject_request(p_request_id uuid, p_note text)` | admin | Marks rejected + audit. |
| `rpc_resolve_discrepancy(p_discrepancy_id uuid, p_note text)` | admin | Marks resolved + audit. |
| `rpc_create_cash_payment(p_payment_date date, p_amount numeric)` | operator/admin | Inline-cash path (also reachable via `rpc_reconcile_invoice`). |
| `rpc_upsert_payment_source_config(p_payment_method text, p_source_tables jsonb)` | admin | Replaces source mapping for a method + audit. |

### 7.6 Issue report RPCs

| RPC | Caller | Effect / Sentinels |
|---|---|---|
| `rpc_create_issue_report(p_invoice_id uuid, p_category text, p_notes text)` | operator/admin | Insert; validates catalog + source match; rejects on existing open. Sentinels: `ISSUE_ALREADY_OPEN`, `Invalid category for source`, `Notes required for category 'other'`. Audit `issue_report_created`. |
| `rpc_withdraw_issue_report(p_report_id uuid)` | reporter or admin | Sets `withdrawn_by_operator`. Sentinel `REPORT_NOT_OPEN`. Audit `issue_report_withdrawn`. |
| `rpc_resolve_issue_report(p_report_id uuid, p_resolution_notes text)` | admin only | Sets `resolved_by_admin`. **Guard (FR-107):** rejects if `hotel_invoice.reconciliation_status = 'unreconciled'` → sentinel `INVOICE_NOT_RECONCILED`. Audit `issue_report_resolved`. |
| `rpc_upsert_issue_category(p_id uuid, p_code, p_label, p_applies_to text[], p_is_active, p_sort_order)` | admin | Configurable catalog CRUD. |
| `rpc_delete_issue_category(p_id uuid)` | admin | Deletes a category (admin-only). |

### 7.7 Payment Folio RPCs

| RPC | Caller | Effect |
|---|---|---|
| `rpc_upload_payment_folio(p_file_name text, p_file_size_bytes int, p_sha256 text, p_rows jsonb) → jsonb` | operator/admin | Inserts one `payment_folio_uploads` row; iterates `p_rows`; validates each row (`received_date`, `payment_amount > 0`, `payment_type` non-empty); derives `payment_method` via FR-099 CASE; `INSERT … ON CONFLICT ON CONSTRAINT uq_payment_entries_dedup DO NOTHING RETURNING id`; updates upload counts + warnings. Returns `{upload_id, row_count, inserted_count, skipped_count, invalid_count, warnings[]}`. Audit `payment_folio.upload`. |
| `rpc_upload_bank_statement(p_rows jsonb)` | admin | Bulk inserts HDFC bank statement rows from frontend upload. |

### 7.8 Triggers

| Trigger | Table | When | Action |
|---|---|---|---|
| `audit_log_block_mutation` | `audit_log` | BEFORE UPDATE/DELETE | Raise `audit_log is append-only`. |
| `trg_mmt_clear_reconciled_at_on_link_delete` | `reconciliation_links` | AFTER DELETE | Clear `mmt_invoice.reconciled_at/link_id` and `mmt_bookings_payout.reconciled_at/link_id` where `reconciled_link_id = OLD.id`. |
| `trg_yatra_clear_reconciled_at_on_link_delete` | `reconciliation_links` | AFTER DELETE | Clear `yatra_bookings_payout.reconciled_at/link_id`. |
| `trg_agoda_clear_reconciled_at_on_link_delete` | `reconciliation_links` | AFTER DELETE | Clear `agoda_bookings_payout.reconciled_at/link_id`. |
| `trg_payment_entries_clear_consumed_on_link_delete` | `reconciliation_links` | AFTER DELETE | Clear `payment_entries.consumed_*` where `consumed_link_id = OLD.id`; audit `payment_entry_unconsumed`. |
| `trg_hotel_invoice_after_status_change` | `hotel_invoice` | AFTER UPDATE OF `reconciliation_status` | If new value is `fully_reconciled` (transition), call `fn_auto_resolve_issue_reports`. |

---

## 8. User Flows

### Flow 1 — Operator reconciles a walk-in invoice (happy path)
1. Operator logs in → Invoice List.
2. Default view: unreconciled invoices newest first.
3. Click an invoice → `/invoices/[id]` detail.
4. Page shows: guest, dates, totals, current status, linked payments (if any), `AddPaymentPanel`, optional MMT/Yatra/Agoda panel by `source` (see Flow 8/9/10), `IssueReportCard` (if any), `Report an issue` button.
5. In `AddPaymentPanel`: pick method (UPI/Card/Bank Transfer/Cash) + date.
6. System fetches matching transactions from `v_transactions_with_remaining` for `(method, date)` per `payment_source_config`.
7. Greyed-out rows where `remaining=0`. Click a row → "How much of ₹X (₹Y remaining)?" modal; default = `min(remaining, outstanding)`.
8. Confirm → row added to "Linked payments (this session)" with × to remove. Running total updates.
9. Repeat for as many (method, date) combos as needed.
10. Click **Save Reconciliation** → `rpc_reconcile_invoice` runs atomically:
    - `linked_total ≈ grand_total` (±₹1) → `fully_reconciled`.
    - `linked_total < grand_total` & operator confirmed partial → `partial`.
    - `0 < linked_total − grand_total ≤ 5%` & operator confirmed overpay → `flagged_for_review` + `discrepancies` row.
    - `linked_total − grand_total > 5%` → hard error; do not save.
    - Any source remaining exceeded → hard error.
11. On success: toast, status badge updates, audit entry written, any matching unconsumed `payment_entries` row is marked consumed.

### Flow 2 — Inline cash payment
Same as Flow 1 with method = Cash. Operator enters date + amount manually; on Save the RPC creates the `cash_payments` row + a `reconciliation_links` row in the same transaction.

### Flow 3 — Partial then return
1. Operator links only ₹5,000 of a ₹10,000 invoice → `partial`.
2. Later, opens the invoice; previously-linked payments show in the Linked Payments table. "Outstanding ₹5,000" prominent.
3. Adds more links via `AddPaymentPanel`. On final save, status auto-flips to `fully_reconciled` → trigger auto-resolves any open issue report.

### Flow 4 — Operator requests un-reconciliation
1. Operator clicks (×) on a linked payment row, or "Request to un-reconcile entire invoice".
2. Modal asks for reason.
3. `rpc_request_unreconcile_link` / `rpc_request_unreconcile_invoice` creates an `approval_requests` row.
4. Toast: "Request submitted. Waiting on admin approval." Link/invoice stays reconciled until admin acts.

### Flow 5 — Admin approves / rejects a request
1. Admin Home → tile "Pending approval requests: N".
2. `/admin/approvals` → table → drawer.
3. Approve: `rpc_approve_request` runs atomically — deletes link(s), AFTER DELETE triggers clear OTA back-pointers and `payment_entries.consumed_*`, status recomputed via `fn_recompute_invoice_status`, audit written.
4. Reject requires a note: `rpc_reject_request`.

### Flow 6 — Admin reviews a flagged discrepancy
1. Admin Home → tile "Flagged discrepancies: N".
2. `/admin/discrepancies` → drawer: (a) Mark Resolved with note (`rpc_resolve_discrepancy`) or (b) Reverse Reconciliation (`rpc_admin_reverse_reconciliation`).

### Flow 7 — Admin configures payment sources
`/admin/settings/payment-sources` → method × source-table matrix → per-method Save via `rpc_upsert_payment_source_config`.

### Flow 8 — Operator reconciles an MMT/Goibibo invoice
1. Open invoice where `source ∈ ('MakeMyTrip','Goibibo')`. Both `AddPaymentPanel` and `MmtReconcilePanel` render.
2. `MmtReconcilePanel` calls `rpc_get_mmt_reconcile_candidates` → dropdown of unreconciled `mmt_invoice` rows; auto-defaults by `booking_id` or `guest_name`.
3. Pick booking → `rpc_get_mmt_reconcile_detail`. Shows: `mmt_invoice` line items (editable, debounced commit), `mmt_bookings_payout.payable` (editable), live "Amounts match within ₹1" indicator. Bank statement callout (looked up via `chq_ref_no ILIKE '%transaction_no%'`) with remaining preview.
4. Click **Reconcile** → `rpc_reconcile_mmt_invoice` runs atomically.
5. Sentinels handled: `MMT_INVOICE_NOT_FOUND`, `MMT_PAYOUT_NOT_FOUND`, `MMT_PAYOUT_AMBIGUOUS`, `MMT_BANK_NOT_FOUND`, `MMT_BANK_AMBIGUOUS`, plus partial/overpay.

### Flow 9 — Operator reconciles a Yatra invoice
1. Open invoice where `source ILIKE '%Yatra%'`. `YatraReconcilePanel` renders alongside `AddPaymentPanel`.
2. `rpc_get_yatra_reconcile_candidates` → searchable voucher dropdown; auto-default by `lower(guest_name)`.
3. Pick voucher → `rpc_get_yatra_reconcile_detail`. Left side: editable commercials (debounced). Right side: standard transaction picker scoped to UPI / Card / Bank Transfer (Cash hidden). Date default `email_date ±3`.
4. Click **Reconcile** → `rpc_reconcile_yatra_invoice`. The `reconciliation_links` row carries the **real underlying method**, never `yatra_payout`.
5. Sentinels: `YATRA_VOUCHER_NOT_FOUND`, `YATRA_PAYOUT_LOCKED`, `YATRA_CASH_NOT_ALLOWED`, partial/overpay.

### Flow 10 — Operator reconciles an Agoda invoice
Same as Yatra. Cash also disallowed (`AGODA_CASH_NOT_ALLOWED`).

### Flow 11 — Operator/admin uploads Payment Folio
1. `/payment-folio` page → drag `.xls` → frontend parses via `frontend/src/lib/xls/parse-payment-folio.ts` (BIFF8 OLE reader, header autodetect, BIFF date conversion, RK/MULRK numbers, SST strings).
2. Preview first 20 rows + total count.
3. Click **Upload** → `rpc_upload_payment_folio(p_file_name, p_file_size_bytes, p_sha256, p_rows)`.
4. Result panel: green inserted count, slate skipped count (duplicates), amber invalid count with warnings.
5. Recent uploads table shows last 20 from `payment_folio_uploads`.

### Flow 12 — Auto-select on reconcile
On panel mount, `usePaymentFolioMatches(invoice)` queries `payment_entries` where `consumed_for_invoice_id IS NULL` and `booking_id` OR `invoice_number_raw` matches. Sorted: exact `invoice_number` > exact `booking_id` > `received_date DESC`. UI:
- 1 match → auto-prefill + dismissible info banner.
- 2–10 matches → chip strip; clicking a chip prefills.
- 0 matches → render nothing.

### Flow 13 — Operator files an issue report
1. On invoice detail, click **Report an issue** (disabled with tooltip if an open report exists).
2. Dialog: source-aware dropdown from `issue_categories` filtered by `applies_to`. Notes optional except `other` (required).
3. Submit → `rpc_create_issue_report`. Sentinels: `ISSUE_ALREADY_OPEN`, `Invalid category for source`, `Notes required for category 'other'`.
4. Invoice list shows a red "Issue reported" pill next to status; invoice detail shows an `IssueReportCard` above reconcile panels.

### Flow 14 — Withdraw / resolve an issue report
- **Operator** (reporter only) clicks Withdraw on the open report card → `rpc_withdraw_issue_report` → status `withdrawn_by_operator`.
- **Admin** clicks Resolve (open report on a `partial / fully_reconciled / flagged_for_review` invoice) → notes dialog → `rpc_resolve_issue_report` → status `resolved_by_admin`. Disabled with tooltip when `unreconciled` (FR-107).
- **Auto-resolve**: any open report on an invoice that transitions to `fully_reconciled` is set to `resolved_by_reconciliation` via `trg_hotel_invoice_after_status_change`. Reverse-reconciliation does NOT re-open (BR-047).

### Flow 15 — Bank Statement ledger view
`/bank-statement` page (both roles). Filters: date range (default last 30 days), narration, chq_ref, methods multi-select, invoice number, amount range, drill types multi-select. Table: deposits only, row-split by `reconciliation_links` (bank cols repeat with muted style on splits). Each row may have a chevron — expanding fires `rpc_get_bank_statement_drilldown` and shows constituent UPI / Card / MMT / Yatra sub-transactions, each with a "Reconciled To" column (clickable invoice links with `stopPropagation`), tinted green when `applied_total ≈ base_amount`, yellow when partially applied. Excel export uses the same RPC unpaginated (cap 10k).

---

## 9. Frontend Pages & Components

Routes are under `src/app/(app)/` (authenticated layout); the layout reads `user_profiles` and shows role-aware nav.

### 9.1 Pages

| Route | File | Purpose | Roles |
|---|---|---|---|
| `/login` | `src/app/login/page.tsx` | Email/password sign-in via Supabase Auth. Redirects by role on success. | unauthenticated |
| `/` | `src/app/page.tsx` | Server redirect to `/admin` (admin) or `/invoices` (operator). | both |
| `/invoices` | `src/app/(app)/invoices/page.tsx` | Server-side paginated list (50/page) from `v_invoice_list_with_issue`. Tabs: walk-in / OTA. Filters: status multi-select, date range, guest substring, grand total range. Status badges color-coded; red "Issue reported" pill if `has_open_issue`. | both |
| `/invoices/[id]` | `src/app/(app)/invoices/[id]/page.tsx` (server) + `detail-client.tsx` (client, 1056 LOC) | Header (guest, dates, totals, status badge, "Report an issue"); `IssueReportCard` (if any); `AddPaymentPanel`; conditional `MmtReconcilePanel` / `YatraReconcilePanel` / `AgodaReconcilePanel` by `source`; "Linked payments" table with (×) un-reconcile requests; collapsible audit trail. | both |
| `/admin` | `src/app/(app)/admin/page.tsx` | Tiles from `rpc_admin_home_summary`: unreconciled count/amount, status breakdown, aging buckets, cash-vs-digital 30d, pending approvals, flagged discrepancies, last-20 audit. | admin |
| `/admin/approvals` | `src/app/(app)/admin/approvals/page.tsx` | Pending / decided tabs; approve / reject drawer; reject-note required; payload preview. | admin |
| `/admin/discrepancies` | `src/app/(app)/admin/discrepancies/page.tsx` | Table + drawer with Mark Resolved (note) and Reverse Reconciliation (note). | admin |
| `/admin/issues` | `src/app/(app)/admin/issues/page.tsx` | Tabs Open / Resolved / All. Filters: source, category, date range. 50/page paginated, `reported_at desc`. Inline Resolve on open rows (disabled when invoice `unreconciled`). | admin |
| `/admin/mis` | `src/app/(app)/admin/mis/page.tsx` | MIS dashboard from `v_mis_monthly_summary`, `v_mis_payment_detail`, `v_mmt_monthly_deductions`, `v_yatra_monthly_deductions`. Tabs for monthly summary, payment detail, MMT deductions, Yatra deductions. | admin |
| `/admin/settings/payment-sources` | `src/app/(app)/admin/settings/payment-sources/page.tsx` | Method × source-table matrix; per-method Save via `rpc_upsert_payment_source_config`. | admin |
| `/admin/settings/issue-categories` | `src/app/(app)/admin/settings/issue-categories/page.tsx` | Full CRUD for `issue_categories` (`code` immutable on edit; `applies_to` multi-select checkboxes). Uses `rpc_upsert_issue_category` and `rpc_delete_issue_category`. | admin |
| `/audit` | `src/app/(app)/audit/page.tsx` | Filters by action prefix, entity type, date range. Row expansion shows before/after JSON side-by-side. | both |
| `/bank-statement` | `src/app/(app)/bank-statement/page.tsx` (server) + `bank-statement-client.tsx` (client) | Read-only ledger: filters, row-splitting, lazy drill-down accordion (UPI / Card / MMT / Yatra), per-sub-row "Reconciled To" column with `stopPropagation`-guarded invoice links, pastel green/yellow tints, Excel export (≤10k rows). | both |
| `/payment-folio` | `src/app/(app)/payment-folio/page.tsx` (305 LOC) | Drag-drop `.xls` upload; client-side BIFF8 parse; SHA-256; preview; `rpc_upload_payment_folio`; result panel; recent uploads (last 20). | both (admin-led ingestion in practice) |

### 9.2 Reconcile panels (under `src/app/(app)/invoices/[id]/`)

- `detail-client.tsx` — the orchestrator; renders header, `IssueReportCard`, `AddPaymentPanel`, conditional MMT/Yatra/Agoda panels by source, `LinkedPaymentsTable`, audit trail.
- `mmt-reconcile-panel.tsx` — MMT/Goibibo flow. Two-column edit UI, debounced field updates, match indicator, bank-callout, partial/overpay dialogs.
- `yatra-reconcile-panel.tsx` — Yatra flow. Voucher dropdown, editable commercials, transaction picker (UPI/Card/Bank Transfer; cash hidden).
- `agoda-reconcile-panel.tsx` — Agoda flow. Same pattern as Yatra.

### 9.3 Components

- `src/components/ui/{badge,button,card,dialog,input,label,select,table,textarea,toast}.tsx` — shadcn-style primitives.
- `src/components/logout-button.tsx` — header sign-out.
- `src/components/providers.tsx` — TanStack Query + Toast providers.
- `src/components/issue/report-issue-dialog.tsx` — trigger button (disabled with tooltip if open report exists) + dialog with source-filtered catalog + notes (required for `other`) + `ISSUE_ALREADY_OPEN` inline handling.
- `src/components/issue/issue-report-card.tsx` — status badge (red/green/slate), Withdraw button (reporter + open), Resolve button (admin + open; **disabled with tooltip when invoice `unreconciled`** per FR-107), confirm dialog with optional resolution notes.

### 9.4 Lib / hooks

- `src/lib/supabase/{client,server,middleware}.ts` — `@supabase/ssr` clients.
- `src/middleware.ts` — auth gate; redirects unauthenticated to `/login`, blocks operators from `/admin/*`.
- `src/lib/types.ts` — domain types (see § 5 for shape parity with DB; also `IssueReport`, `IssueCategory`, `IssueReportStatus`, `PaymentEntry`, `PaymentFolioUpload`, `PaymentMethod` union, `classifyInvoiceSource()`).
- `src/lib/utils.ts` — `formatINR`, `formatDate`, `formatDateTime`, `cn` Tailwind merger.
- `src/lib/xls/parse-payment-folio.ts` — BIFF8 OLE reader exporting `parsePaymentFolio(buf: ArrayBuffer): Promise<PaymentFolioRow[]>` (header autodetect, date serial conversion with 1900-bug, RK/MULRK, SST, Continue).
- `src/hooks/use-payment-suggestions.ts` — TanStack Query hook around `rpc_get_payment_suggestions` (also queries `payment_entries` directly for auto-select).

### 9.5 Critical UI states (apply to every page)
- **Empty** — explanatory copy with the action to take ("No invoices match your filters" / "No transactions on this date for this method — try another date").
- **Loading** — skeleton rows on tables, spinner on tiles/buttons.
- **Error** — red banner explaining what happened + what to do.
- **Success** — green toast (3s).

### 9.6 Error message style guide
Every operator-facing message must say (a) what happened, (b) why, (c) what to do next. Examples:
- Good: "Cannot save: this transaction has only ₹2,000 remaining, but you're trying to apply ₹5,000. Reduce the amount or pick another transaction."
- Good: "Reconcile the invoice (at least partially) before resolving this report."
- Bad: "Validation failed."

---

## 10. Functional Requirements (FR catalog)

### Invoice list
- **FR-001** Paginated list of invoices via `v_invoice_list_with_issue`.
- **FR-002** Default sort: newest unreconciled first.
- **FR-003** Filters: reconciliation_status multi-select, date range, guest substring, grand total range.
- **FR-004** Each row: invoice number, guest, dates, grand total, status badge, amount reconciled, "Issue reported" pill if `has_open_issue`.
- **FR-005** OTA invoices in a separate read-only tab.

### Invoice detail
- **FR-006** All `hotel_invoice` fields rendered.
- **FR-007** Outstanding = `grand_total − sum(reconciliation_links.amount_applied)`.
- **FR-008** Current status badge.
- **FR-009** Linked payments table: method, source id, original amount, applied amount, date, who, when.
- **FR-010** (×) per link → un-reconcile request flow (Flow 4).

### Add Payment panel
- **FR-011** Method selector: UPI / Card / Bank Transfer / Cash.
- **FR-012** OCR-suggested method pre-selected.
- **FR-013** Date picker default = invoice date.
- **FR-014** For non-cash: query `v_transactions_with_remaining` for `(method, date)` per `payment_source_config`.
- **FR-015** Columns: identifier, time, original, used, remaining.
- **FR-016** Grey out rows where `remaining=0`.
- **FR-017** Click → amount-to-apply modal; default `min(remaining, outstanding)`.
- **FR-018** Cash: date + amount only.
- **FR-019** Session "Linked payments" list with running total + remove.
- **FR-020** Save Reconciliation enforces every rule in § 11.

### Reconciliation save
- **FR-021** Single Postgres transaction via `rpc_reconcile_invoice`.
- **FR-022** `SELECT … FOR UPDATE` via `fn_lock_and_get_source_amount` on each source.
- **FR-023** `fn_recompute_invoice_status` after save.
- **FR-024** Audit written before commit.

### Admin Home
- **FR-025**..**FR-032** Eight tiles (unreconciled count/amount, status breakdown, aging, cash-vs-digital 30d, pending approvals, flagged discrepancies, last-20 audit).

### Approvals
- **FR-033**..**FR-035** Admin views, approves (no note), rejects (note required). Atomic + audit.

### Discrepancies
- **FR-036**, **FR-037** List flagged reconciliations; admin Mark Resolved / Reverse.

### Audit log
- **FR-038**..**FR-042** Append-only. Filter by user (admin), action type, date range, entity. Row expansion shows before/after JSON. Both roles can read.

### Payment source config
- **FR-043**..**FR-045** Admin UI matrix; atomic via `rpc_upsert_payment_source_config`; seeded per § 5.5.

### Cash payments
- **FR-046**..**FR-048** Stored in `cash_payments`; surfaced uniformly via `reconciliation_links`. Operator cannot edit/delete a saved cash entry — must submit `rpc_request_cash_edit` / `rpc_request_cash_delete`.

### Auth & roles
- **FR-049**..**FR-052** Supabase Auth email/password; `user_profiles.role` ∈ {`admin`, `operator`}; RLS on every reconciliation table; manual provisioning.

### MMT payouts (data pipeline)
- **FR-053** `mmt_payouts` table (transaction_no PK, payout commercials).
- **FR-054** `mmt_bookings_payout` (one row per booking; `UNIQUE(transaction_no, booking_id)`).
- **FR-055** `JsonProcessor` registered first in `ProcessorFactory`.
- **FR-056** `json_direct_insert` pipeline branch in `src/main.py`.
- **FR-057** Config entry `mmt_payout` in `config.yaml` with drive folder env `MMT_PAYOUTS`.
- **FR-058** Drive discovery falls back to `name contains '.json'` when MIME-by-type misses.

### MMT direct reconcile
- **FR-059** Panel scope: `source ∈ ('MakeMyTrip','Goibibo')`. Coexists with `AddPaymentPanel`.
- **FR-060** Schema additions: `reconciled_at`/`reconciled_link_id` on `mmt_invoice` and `mmt_bookings_payout`; `'mmt_payout'` added to `reconciliation_links.payment_method` and `payment_source_config.payment_method` CHECK constraints; seed `('mmt_payout','bank_statement', true)`.
- **FR-061** `rpc_get_mmt_reconcile_candidates`.
- **FR-062** `rpc_get_mmt_reconcile_detail` with the 5 sentinels.
- **FR-063** `rpc_update_mmt_invoice_fields` (whitelisted formula fields; locked after reconcile).
- **FR-064** `rpc_update_mmt_bookings_payout_fields` (`payable`).
- **FR-065** `rpc_reconcile_mmt_invoice` — atomic; partial/overpay sentinels; `chq_ref_no ILIKE '%transaction_no%'` bank-match.
- **FR-066** UI: `MmtReconcilePanel` rendered below `AddPaymentPanel` when source matches.

### Bank Statement view
- **FR-067** Route `/bank-statement` for both roles.
- **FR-068** Deposits only; row-split by `reconciliation_links`; unreconciled rows have `link_count=0`.
- **FR-069** Columns: date, narration, chq_ref, deposit, amount applied, linked invoice (clickable), method pill, closing_balance, chevron.
- **FR-070** Drill-down classifier: UPI/Card by narration substring; MMT by `chq_ref_no ILIKE '%transaction_no%'`. Lazy via `rpc_get_bank_statement_drilldown`.
- **FR-071** Filters bar (date, narration, chq_ref, methods multi-select, invoice number, amount, drill types multi-select).
- **FR-072** Default sort `date DESC, value_dt DESC, id`. Server-side pagination 100/page. `drill_count` returned per row.
- **FR-073** Excel export of filtered set (≤10k); `xlsx` SheetJS client-side.
- **FR-074** Empty / loading / error / drill-empty states.

### Yatra reconcile
- **FR-075** Panel scope: `source ILIKE '%Yatra%'`. Backend RPC also source-guarded.
- **FR-076 v2** `yatra_bookings_payout` schema with ALL JSON fields + `raw_json`/`source_file_name`/`drive_file_id`/`parsed_at`. `UNIQUE(voucher_no)` DROPPED.
- **FR-077** AFTER DELETE trigger on `reconciliation_links` clears Yatra back-pointers.
- **FR-078 v2** JSON inserter: pre-insert duplicate check + log-and-skip on duplicate `voucher_no`; raw envelope stored in `raw_json`.
- **FR-079** `rpc_get_yatra_reconcile_candidates` (guest-name match).
- **FR-080** `rpc_get_yatra_reconcile_detail` with `YATRA_VOUCHER_NOT_FOUND`.
- **FR-081 v2** `rpc_update_yatra_bookings_payout_fields` with expanded whitelist; `YATRA_PAYOUT_LOCKED`.
- **FR-082** `rpc_reconcile_yatra_invoice` — atomic; cash rejected via `YATRA_CASH_NOT_ALLOWED`; link carries real underlying method.
- **FR-083** UI: `YatraReconcilePanel` with searchable voucher dropdown, editable commercials, UPI/Card/Bank Transfer picker (cash suppressed).
- **FR-084** Historical backfill = advisory CSV only.
- **FR-085** Bank Statement drill-down: Yatra extension via back-pointer chain.
- **FR-086** MIS report: Yatra as a separate source breakdown.
- **FR-087** Per-sub-row "Reconciled To" column + tint on every drill type (UPI/Card/MMT/Yatra) computed from `applied_total` vs `base_amount`.
- **FR-088** `v_yatra_monthly_deductions` view + dashboard tab.

### Issue reports
- **FR-089** Issue category catalog (now configurable in V1 via `issue_categories` table + admin UI; initial seed is the static list).
- **FR-090** `invoice_issue_reports` schema with partial unique on `(invoice_id) WHERE status='open'`.
- **FR-091** `rpc_create_issue_report` with catalog + source validation.
- **FR-092** `rpc_withdraw_issue_report`.
- **FR-093** `rpc_resolve_issue_report` (admin only) — with FR-107 guard.
- **FR-094** Auto-resolve via AFTER UPDATE trigger on `hotel_invoice.reconciliation_status = 'fully_reconciled'`.
- **FR-095** `ReportIssueDialog` (operator + admin).
- **FR-096** Pill on list + `IssueReportCard` on detail.
- **FR-097** Admin reports page `/admin/issues`.
- **FR-098** Audit log actions: `issue_report_created`, `issue_report_withdrawn`, `issue_report_resolved`, `issue_report_auto_resolved`.

### Payment Folio
- **FR-099** `payment_entries` table (suggestion surface; never a reconciliation source).
- **FR-100** `payment_folio_uploads` table (RLS: admin sees all, uploader sees own).
- **FR-101** `corporate_credit` added to `payment_method` CHECK on `reconciliation_links` and `payment_source_config`.
- **FR-102** `rpc_upload_payment_folio` (validate, dedupe via 6-tuple unique, audit).
- **FR-103** Backend Python BIFF8 parser (`src/parsers/payment_folio_xls.py`) for future Drive ingestion (not exercised in V1 upload flow).
- **FR-104** Frontend BIFF8 TS reader (`frontend/src/lib/xls/parse-payment-folio.ts`) — same algorithm as FR-103.
- **FR-105** Upload UI at `/payment-folio` (drag-drop, preview, result panel, recent uploads).
- **FR-106** Auto-select on all four reconcile panels via `payment_entries` lookup; consume via `fn_consume_payment_entry` from each reconcile RPC; unconsume via AFTER DELETE trigger on `reconciliation_links`.
- **FR-107** Resolve guard on `rpc_resolve_issue_report`: rejects with `INVOICE_NOT_RECONCILED` when `reconciliation_status = 'unreconciled'`. Frontend disables Resolve button with tooltip.

---

## 11. Business Rules

- **BR-001** Walk-in invoices come from `hotel_invoice`. OTA invoices reconcile via dedicated panels keyed by `source`.
- **BR-002** Amount to reconcile = `hotel_invoice.grand_total`.
- **BR-003** A single transaction's total `amount_applied` ≤ its original amount.
- **BR-004** Invoice `linked_total` may equal, be less than, or exceed `grand_total` (only with admin-reviewable flag and only if within 5%).
- **BR-005** `reconciliation_status` is computed; never edited directly.
- **BR-006** Discrepancy thresholds: `|linked − grand| ≤ ₹1` → `fully_reconciled`; `linked < grand` → `partial`; `0 < linked − grand ≤ 5%` → `flagged_for_review` + `discrepancies` row; `> 5%` → hard error.
- **BR-007** No date constraint between invoice and transaction.
- **BR-008** Operator may never directly delete/update a saved `reconciliation_link`, `cash_payment`, or audit row — all changes via `approval_requests`.
- **BR-009** Admin may un-reconcile or reverse anything atomically without approval.
- **BR-010** Cash entries are on trust; no cross-checks against bank statement.
- **BR-011** "Payment link" = one row in `reconciliation_links`. Removing one after save requires admin approval (operator path) or is immediate (admin path).
- **BR-012** Concurrent reconciliation is serialised by `SELECT FOR UPDATE`; second loser gets "refresh and try again".
- **BR-013** Audit log is append-only and readable by both roles.
- **BR-014** RPCs reject calls whose role does not match.
- **BR-015** MMT Payout Reconcile applies only to `source ∈ ('MakeMyTrip','Goibibo')`.
- **BR-016** Each `mmt_invoice.id` and each `mmt_bookings_payout.id` participates in at most one active reconciliation.
- **BR-017** MMT bank match: `chq_ref_no ILIKE '%transaction_no%'`. Zero / >1 = hard error.
- **BR-018** MMT field edits persist directly (no approval queue) and are audit-logged.
- **BR-019** ₹1 rounding tolerance for amount match.
- **BR-020** MMT computed payable = `room_charges + extra_adult_child_charges + property_taxes − (go_mmt_commission + gst_on_commission + tcs + tds)`. `service_charge` excluded.
- **BR-021** Re-reconciliation excluded by `reconciled_at IS NULL` filter.
- **BR-022** Un-reconciliation cleans MMT back-pointers via AFTER DELETE trigger.
- **BR-023**..**BR-028** Bank Statement view: deposits only; row-split per link; classifier via narration / chq_ref substring; bank↔settlement join window `mpr_date BETWEEN date − 3 AND date`; read-only; Excel export ≤10k rows.
- **BR-029**..**BR-037** Yatra: `source ILIKE '%Yatra%'`; one active recon per payout; cash disallowed; `yatra_to_pay_hotel` trusted as-is; direct edits + audit; re-sends log-and-skipped at app layer; `reconciliation_links.payment_method` carries the real method; drill-down via back-pointer; MIS separate breakdown.
- **BR-038** Backend rejects any reconciliation that pushes `sum(reconciliation_links.amount_applied) > bank_statement.deposit_amt`. Enforced by every reconcile RPC via the shared remaining check.
- **BR-039** Drill-down sub-row tint computed identically across all drill types (per-type `base_amount` per FR-087).
- **BR-040** Yatra duplicate voucher re-import = log + skip at app layer.
- **BR-041** `yatra_bookings_payout.raw_json` preserved verbatim on every successful insert.
- **BR-042** Issue reports do NOT block reconciliation.
- **BR-043** Only ONE open report per invoice (DB partial unique).
- **BR-044** Only admin can manually resolve. Operator may withdraw their own.
- **BR-045** Category must apply to invoice source.
- **BR-046** `other` requires non-empty notes.
- **BR-047** Reverse-reconciliation does NOT re-open auto-resolved reports.
- **BR-048** `payment_entries` is a suggestion surface; reconciliations always link to `upi_transactions / card_transactions / bank_statement / cash_payments`.
- **BR-049** A `payment_entries` row is consumed iff a `reconciliation_link` is inserted on an invoice whose `booking_id` matches (when both non-NULL) OR whose `invoice_number` matches `invoice_number_raw` (when both non-NULL). One-shot consumption; cleared on link delete.
- **BR-050** Duplicate `payment_entries` upload rows are SKIPPED (not errored). Skip key = the 6 raw columns with NULL canonicalised to empty string.
- **BR-051** Invalid `payment_entries` rows (negative amount, missing date, blank type) are SKIPPED with a warning. Upload still completes.
- **BR-052** Admin cannot resolve an issue report unless `reconciliation_status ∈ {partial, fully_reconciled, flagged_for_review}`. Sentinel `INVOICE_NOT_RECONCILED`.
- **BR-053** `Bill To Company` from PMS → `corporate_credit` payment method (no reconciliation surface in V1).
- **BR-054** `Other` payment type from PMS → `payment_method = NULL` (`manual` allowed in CHECK); parked for human review.
- **BR-055** Auto-select tie-break: exact `invoice_number` > exact `booking_id` > most recent `received_date` > most recent `created_at`.
- **BR-056** Agoda reconciliation never uses Cash. `reconciliation_links.payment_method` carries the real underlying method (mirrors Yatra).

---

## 12. Error States & Sentinel Values

| Sentinel prefix | Raised by | Meaning / UI behaviour |
|---|---|---|
| `PARTIAL_CONFIRMATION_REQUIRED: …` | `rpc_reconcile_*` | UI shows partial-save dialog. |
| `OVERPAY_CONFIRMATION_REQUIRED: …` | `rpc_reconcile_*` | UI shows overpay-flag dialog. |
| `MMT_INVOICE_NOT_FOUND` | `rpc_get_mmt_reconcile_detail` | Amber inline: "Invoice hasn't been processed yet." |
| `MMT_PAYOUT_NOT_FOUND` | `rpc_get_mmt_reconcile_detail` | Amber inline: "Payment not in system yet." |
| `MMT_PAYOUT_AMBIGUOUS` | `rpc_get_mmt_reconcile_detail` | Red list. |
| `MMT_BANK_NOT_FOUND` | `rpc_get_mmt_reconcile_detail` | Amber inline. |
| `MMT_BANK_AMBIGUOUS` | `rpc_get_mmt_reconcile_detail` | Red list. |
| `MMT_LOCKED` | `rpc_update_mmt_*_fields` | Red: cannot edit after reconcile. |
| `YATRA_VOUCHER_NOT_FOUND` | `rpc_get_yatra_reconcile_detail` | Amber inline. |
| `YATRA_PAYOUT_LOCKED` | `rpc_update_yatra_bookings_payout_fields` | Red. |
| `YATRA_CASH_NOT_ALLOWED` | `rpc_reconcile_yatra_invoice` | Red (defensive — UI hides cash already). |
| `AGODA_BOOKING_NOT_FOUND` / `AGODA_PAYOUT_LOCKED` / `AGODA_CASH_NOT_ALLOWED` | Agoda RPCs | Same pattern as Yatra. |
| `ISSUE_ALREADY_OPEN: …` | `rpc_create_issue_report` | Inline dialog message + "View existing report" link. |
| `REPORT_NOT_OPEN: …` | `rpc_withdraw_issue_report`, `rpc_resolve_issue_report` | Toast. |
| `Invalid category for source: …` | `rpc_create_issue_report` | Toast. |
| `Notes required for category 'other'` | `rpc_create_issue_report` | Inline validation. |
| `INVOICE_NOT_RECONCILED: …` | `rpc_resolve_issue_report` | Toast: "Reconcile the invoice first (at least partially) before resolving this report." Resolve button disabled with tooltip beforehand. |
| `Not authorized` | every role-gated RPC | Red banner. |
| `Not authenticated` | every RPC reached without session | Red banner / redirect to `/login`. |

---

## 13. Integrations

### 13.1 Supabase (Postgres + Auth + RLS + RPC)
- Project URL + publishable key in `frontend/.env.local`.
- All mutations flow through SECURITY DEFINER RPCs called via `supabase.rpc(...)`.
- Migrations applied via Supabase MCP `apply_migration`. List of applied migrations stored in `supabase_migrations.schema_migrations` (Supabase managed). No local `supabase/migrations/` directory in V1.
- RLS enabled on: `user_profiles`, `cash_payments`, `reconciliation_links`, `approval_requests`, `discrepancies`, `payment_source_config`, `audit_log`, `invoice_issue_reports`, `issue_categories`, `payment_folio_uploads`, `payment_entries`.
- RLS disabled (V1.5 follow-up flagged by Supabase advisory): `files`, `ocr_outputs`, `extractions`, `processing_logs`, `hotel_invoice`, `mmt_invoice`, `card_settlement`, `bank_statement`, `card_transactions`, `upi_transactions`, `mmt_payouts`, `mmt_bookings_payout`, `yatra_bookings_payout`, `agoda_bookings_payout`. These are pipeline tables accessed via SECURITY DEFINER RPCs in practice.

### 13.2 GitHub Actions
- Backend pipeline runs scheduled OCR/JSON ingestion against the Google Drive folders configured in `config.yaml`.
- Repo: `invoice-reconcile-sm`. Branch: `main`.

### 13.3 Vercel
- The Next.js frontend at `frontend/` is deployed to Vercel.
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### 13.4 OCR pipeline (Python `src/`)
- `src/main.py` — orchestrator with `excel_direct_insert` and `json_direct_insert` branches.
- `src/processors/factory.py` — `JsonProcessor` registered first; routes by file_type.
- `src/processors/json_processor.py` — UTF-8 BOM tolerant, raises on malformed JSON.
- `src/database/client.py` — Supabase client + insert dispatch.
- `src/database/mmt_payout_inserter.py` — `insert_mmt_payout_json(file_id, parsed_json)`.
- `src/database/yatra_payout_inserter.py` — `insert_yatra_payout_json(file_id, parsed_json)` with pre-insert duplicate check + log-and-skip.
- `src/database/agoda_payout_inserter.py` — agoda ingestion.
- `src/database/table_manager.py` — skips tables with `json_direct_insert: true` or empty fields (their schema is owned by explicit migrations).
- `src/drive/{client,discovery}.py` — Google Drive listing with `application/json → json` MIME fallback and `name contains '.json'` filter.
- `src/parsers/payment_folio_xls.py` — pure-Python BIFF8 reader for the PMS Payment Folio (not exercised in V1 upload UI; reserved for future Drive ingestion).
- `config.yaml` — document_type entries: `hotel_invoice`, `mmt_invoice`, `mmt_payout`, `yatra_payout`, `agoda_payout`, `bank_statement`, `card_mpr`, `upi_mpr`.

---

## 14. Decisions Log (chronological excerpt)

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-17 | Frontend = Next.js 14 + TS + Tailwind talking directly to Supabase (with RLS); no FastAPI in the hot path | Fastest path; ACID via Postgres RPC; audit centralised at DB layer. |
| 2026-05-17 | OTA invoices read-only initially; walk-in only reconcilable | V1 scope. Later expanded with MMT/Yatra/Agoda dedicated panels. |
| 2026-05-17 | Many-to-many transactions↔invoices via `reconciliation_links` with `amount_applied` | Required: one transaction can be split across multiple invoices. |
| 2026-05-17 | Partial allowed; no drafts; every save is final commit | Simpler model. |
| 2026-05-17 | Discrepancy: ≤5% over = soft flag; >5% over = hard error; under = always-allowed partial | User-specified threshold. |
| 2026-05-17 | Operator cannot directly mutate saved records; all changes via `approval_requests` | Audit/checks. |
| 2026-05-17 | Cash on trust, no bank cross-check | User-specified. |
| 2026-05-17 | Audit log immutable at DB level (revoke + trigger) | "Big focus on audit logs". |
| 2026-05-17 | `v_transactions_with_remaining` uses `security_invoker = true` | Eliminates Supabase ERROR while keeping RLS enforcement on base tables. |
| 2026-05-17 | Inline-cash creation inside `rpc_reconcile_invoice` | True atomicity per E4 alternative; keeps frontend simple. |
| 2026-05-17 | Internal helper `fn_*` functions: EXECUTE revoked from anon/authenticated | Prevents direct REST calls; RPCs invoke via owner rights. |
| 2026-05-17 | Sentinel error prefixes (`PARTIAL_CONFIRMATION_REQUIRED`, etc.) | UI translates to dialogs without re-implementing business rules. |
| 2026-05-17 | Supabase MCP migrations are source of truth in V1 | Local CLI workflow deferred. |
| 2026-05-17 | MMT payout JSON via new `mmt_payout` doc_type with `json_direct_insert: true`, no LLM | Pattern mirrors `excel_direct_insert`; JSON is structured. |
| 2026-05-17 | `mmt_payouts.transaction_no` is natural PK; bookings dedup via `UNIQUE(transaction_no, booking_id)` | One bank-transaction-ID per payout. |
| 2026-05-17 | RLS disabled on `mmt_payouts` / `mmt_bookings_payout` (pipeline tables) | Existing pattern. |
| 2026-05-17 | MMT-reconcile panel coexists with `AddPaymentPanel` for those invoices | Some MMT invoices may settle outside payout. |
| 2026-05-17 | MMT field edits persist directly (no approval gate) | Pipeline tables are outside approval boundary. |
| 2026-05-17 | `service_charge` excluded from MMT payable formula | MMT does not pay service charge through. |
| 2026-05-17 | MMT bank match by `chq_ref_no ILIKE '%transaction_no%'`, zero/>1 = hard error | User-specified. |
| 2026-05-17 | Single `reconciliation_links` row per MMT reconcile | Keeps existing remaining/locking/audit logic untouched. |
| 2026-05-18 | Bank Statement view read-only in V1 | Mutation surface stays at `/invoices/{id}`. |
| 2026-05-18 | Deposits only (no withdrawals) | V1. |
| 2026-05-18 | Row-split per `reconciliation_links` row, bank cols de-emphasised on splits | User-specified. |
| 2026-05-18 | Inline accordion drill-down, not side panel/modal | Excel-like density. |
| 2026-05-18 | Default date range = last 30 days | User-confirmed. |
| 2026-05-18 | Excel export client-side via SheetJS, capped at 10k rows | V1 ceiling. |
| 2026-05-18 | Settlement classifier uses narration substring | DB reality: `card_settlement.card/upi` are NULL. |
| 2026-05-18 | Bank↔settlement join window = `mpr_date BETWEEN date − 3 AND date` | 0–2 day gap observed; 3 for safety. |
| 2026-05-19 | Yatra reconciliation Option B: `reconciliation_links.payment_method` carries the **real** method (`upi`/`card`/`bank_transfer`), not `yatra_payout` | Avoids enum pollution; context lives on the back-pointed payout row. |
| 2026-05-19 | Yatra source match = `ILIKE '%Yatra%'` | Tolerates pipeline variants. |
| 2026-05-19 | `yatra_to_pay_hotel` trusted as-is; no formula recompute | Operator-confirmed. |
| 2026-05-19 | Cash NOT allowed for Yatra (BR-031) | Yatra never pays out via cash. |
| 2026-05-19 | Drop `UNIQUE(voucher_no)` on `yatra_bookings_payout`; dedup at app layer (log-and-skip) | Allows future amendments/cancellations as new rows for human review. |
| 2026-05-19 | Store ALL JSON fields on `yatra_bookings_payout` incl. `raw_json` | Future-proofing; absolute reproducibility. |
| 2026-05-19 | Drill-down attribution applies to ALL drill types uniformly | One pattern; adding a future payment type is mechanical. |
| 2026-05-19 | Drill-down sub-row tint reuses main-row Tailwind classes (no new tokens) | Single source of class strings. |
| 2026-05-19 | Backend overpayment guard reverified (BR-038) | Frontend tinting assumes invariant holds. |
| 2026-05-19 | Full-width app shell app-wide (drop `max-w-7xl` from `(app)/layout.tsx`) | "7x global standard" — full-width layout app-wide. |
| 2026-05-19 | Yatra auto-match guest-name only | `hotel_invoice.booking_id` is not populated with Yatra data. |
| 2026-05-23 | Issue reports informational; do NOT block reconcile | Pragmatic. |
| 2026-05-23 | One open report per invoice (DB partial unique) | Operator withdraws before refiling. |
| 2026-05-23 | Auto-resolve only on `fully_reconciled` (not partial) | Cleaner signal. |
| 2026-05-23 | Reverse-reconciliation does NOT re-open auto-resolved reports (BR-047) | Avoid noisy resurrections. |
| 2026-05-23 | AFTER UPDATE trigger on `hotel_invoice.reconciliation_status` replaces editing 3 reconcile RPCs | Single enforcement point. |
| 2026-05-23 | `issue_categories` made configurable via admin UI (still seeded with the FR-089 list) | Easier evolution; admin-only. |
| 2026-05-23 | Payment Folio upload UI at `/payment-folio` (was `/admin/payment-folio` in spec; deployed under top-level for simpler nav) | Pragmatic; nav exposes it to both roles, RLS enforces admin-only ingestion. |
| 2026-05-23 | Auto-select applies to ALL four reconcile panels (walk-in, MMT, Yatra, Agoda) | One pattern; mechanical extension. |
| 2026-05-23 | "Reconciled" for the resolve guard = `partial / fully_reconciled / flagged_for_review` (only `unreconciled` blocks) | Partial signals triage has begun. |
| 2026-05-23 | New `corporate_credit` payment method for `Bill To Company` | Distinct settlement channel. |
| 2026-05-23 | BIFF8 parser is TypeScript in the frontend; Python sidecar exists for future Drive ingestion | No LibreOffice; in-runtime parse. |
| 2026-05-23 | Duplicate `payment_entries` = exact 6-column tuple with NULL canonicalisation (`COALESCE(_, '')`) | User's stated rule; NULL-aware unique expression index. |
| 2026-05-23 | `payment_entries` is a SUGGESTION surface — reconciliation still links to existing source tables | Single reconciliation model. |
| 2026-05-23 | Consumption tracking on `payment_entries` via `consumed_for_invoice_id` + AFTER DELETE trigger on `reconciliation_links` | One-shot suggestion experience. |

---

## 14A. Feature — Manual Payment Entry (with Admin Approval)

<!-- Added 2026-06-20 -->

### 14A.1 Overview & Problem

The OCR pipeline ingests HDFC Bank MPR (Merchant Payment Report) PDFs to extract UPI and card transactions into `upi_transactions` / `card_transactions`. OCR occasionally fails (e.g. OpenAI vision refuses a page), so a real transaction can be missing from the DB. During invoice reconciliation an operator may discover a payment that has no matching source row to link against. This feature lets a user **manually enter the missing payment** from the invoice reconciliation page — but never silently. Every manual entry lands in a **pending admin-approval queue**, is validated against the bank statement before and at approval, and only becomes a real reconciliation once an admin approves it.

This is the operator-facing escape hatch for OCR gaps, with the same audit/approval discipline the rest of the system enforces (BR-008: operators never directly mutate reconciliation state).

### 14A.2 Scope

In scope (V1 of this feature):
- A new `manual_payment_entries` table holding pending/approved/rejected submissions.
- An **"Add Payment Manually"** entry point on `/invoices/[id]` inside the "Add Payment / Reconcile" section, directly above "Linked Payments".
- Two payment types: **UPI Transaction** and **Received in Another Machine**.
- Submission-time validation (bank-statement tolerance check for UPI; warning flags otherwise).
- A pending queue in the existing admin area; approve / reject with re-validation on approve.
- On approval the entry becomes a real `reconciliation_links` row (and, for UPI, a real `upi_transactions` row), driving the invoice's `reconciliation_status` exactly like any other reconcile.
- Visibility of all entries (pending / approved / rejected) for an invoice, to both the submitter and any admin.

Out of scope (this feature): editing a submitted entry (resubmit instead), bulk approval, manual entry of card transactions (only UPI and another-machine in V1), manual entry from any surface other than the invoice detail page.

### 14A.3 Roles

| Role | Capabilities |
|---|---|
| operator | Open the "Add Payment Manually" modal; submit a UPI or another-machine entry against the open invoice; view all entries (pending/approved/rejected) for that invoice; see warning flags on their own pending entries. Cannot approve. |
| admin | All of the above, plus: see the global pending queue; approve (triggers re-validation + materialisation) or reject (with reason) any entry. |

### 14A.4 Entry Point & UI

**Trigger.** On `/invoices/[id]`, in the "Add Payment / Reconcile" section, render a button **"Add Payment Manually"** immediately above the "Linked Payments" table. Visible to operator and admin. Opens a modal.

**Modal — type selector.** Radio / segmented control: `UPI Transaction` | `Received in Another Machine`.

**Modal — UPI Transaction form.** All fields required:
- Transaction Date — date picker, displayed DD-MM-YYYY (the MPR format). Stored as `DATE`.
- Settlement Date — date picker, displayed DD-MM-YYYY. **Not auto-derived** — the user reads it off the physical PDF. Stored as `DATE`.
- Amount — numeric > 0.
- VPA — payer VPA string (free text).
- UPI Transaction ID — free text.

**Modal — Received in Another Machine form.** Fields:
- Amount — numeric > 0.
- Transaction Date — date picker.
No settlement date, VPA, UPI id, bank validation, or MPR inference.

**Modal — submit result.** On success, show a confirmation that the entry is pending admin approval, plus any warning flags returned by the validation RPC (e.g. "No bank statement credit found for this settlement date" / "MPR link unverified"). The entry is NOT counted toward reconciliation yet.

**Entries list on the invoice page.** Below "Linked Payments" (or as a labelled sub-section), render a **"Manual Payment Entries"** list for the invoice: type, amount, dates, status badge (pending = amber, approved = green, rejected = slate/red), submitted_by, submitted_at, reviewed_by/at, rejection reason (if rejected), and warning flags. Both operator (any, not only own — per requirement both submitter and admin see all entries for an invoice) and admin see this list.

**Admin queue.** In the existing admin area, a page `/admin/manual-payments` lists all `pending` entries across invoices (with tabs/filters for approved and rejected). Each row links to its invoice and exposes Approve / Reject. Reject requires a reason. Warning flags are shown prominently as non-blocking badges; a hard-block validation failure on approve surfaces as a red error and the entry stays pending.

All four critical UI states (empty / loading / error / success) apply per § 9.5, and error copy follows § 9.6.

### 14A.5 Data Model — `manual_payment_entries` (RLS on)

One row per manual submission.

- `id uuid pk default gen_random_uuid()`
- `invoice_id uuid not null references hotel_invoice(id)`
- `payment_type text not null` CHECK (`'upi' | 'another_machine'`)
- `status text not null default 'pending'` CHECK (`'pending' | 'approved' | 'rejected'`)
- `submitted_by uuid not null references auth.users(id)`
- `reviewed_by uuid null references auth.users(id)`
- `submitted_at timestamptz not null default now()`
- `reviewed_at timestamptz null`
- `amount numeric(15,2) not null` CHECK (`amount > 0`)
- `transaction_date date not null`
- `settlement_date date null` (required iff `payment_type='upi'`)
- `vpa text null` (UPI only)
- `upi_transaction_id text null` (UPI only)
- `card_settlement_id uuid null references card_settlement(id)` (inferred for UPI; NULL if unresolvable)
- `admin_flags jsonb not null default '[]'::jsonb` (array of warning objects, e.g. `[{"code":"NO_BANK_CREDIT","message":"…"}]`)
- `rejection_reason text null`
- `upi_transaction_ref uuid null references upi_transactions(id)` (set on approval for UPI type)
- `reconciliation_link_ref uuid null references reconciliation_links(id) on delete set null` (set on approval)
- `created_at timestamptz not null default now()`

Suggested CHECKs: `payment_type='upi'` ⇒ `settlement_date IS NOT NULL AND vpa IS NOT NULL AND upi_transaction_id IS NOT NULL`. Indexes: `(invoice_id)`, `(status) WHERE status='pending'`, `(submitted_by)`, `(settlement_date) WHERE payment_type='upi'`.

**RLS.**
- SELECT: `submitted_by = auth.uid() OR is_admin()`. (Per requirement, the submitter sees all of their entries — pending, approved, rejected — for an invoice; admin sees everything. The invoice page list is therefore complete for both audiences.)
- INSERT / UPDATE / DELETE: revoked from `authenticated`. All writes flow through SECURITY DEFINER RPCs.

### 14A.6 Existing tables touched

- `reconciliation_links` — a row is inserted on approval. **CHECK extension required (confirmed):** `source_table` CHECK currently allows only `upi_transactions | card_transactions | bank_statement | cash_payments`; it must be extended to include `'manual_payment_entries'` so the another-machine approval can write `source_table='manual_payment_entries'`. For UPI approvals, the link uses `source_table='upi_transactions', source_id=<new upi_transactions.id>, payment_method='upi'`. For another-machine approvals, `source_table='manual_payment_entries', source_id=<entry id>, payment_method='upi'` (no truer method known; documented in Decisions Log).
- `upi_transactions` — UPI approval inserts a row (`card_settlement_id` = inferred or NULL, `transaction_date`, `settlement_date`, `amount`, `vpa`, `upi_transaction_id`).
- `hotel_invoice` — `reconciliation_status` recomputed on approval via `fn_recompute_invoice_status`.
- `bank_statement` — read-only validation source (`narration ILIKE '%UPI SETTLEMENT%AYH059%' AND date = settlement_date`; confirmed 311 such rows exist).
- `card_settlement` / `upi_transactions` — MPR inference: find the `card_settlement` whose existing `upi_transactions` share the same `transaction_date`.

### 14A.7 Validation Rules (UPI type)

At **submission** time (RPC `rpc_submit_manual_payment_entry`):
1. Look up the bank-statement UPI settlement credit for the entered `settlement_date`: `SELECT … FROM bank_statement WHERE narration ILIKE '%UPI SETTLEMENT%AYH059%' AND date = p_settlement_date`. Use the credit amount (`deposit_amt`). If multiple rows, sum the matching credits for that date.
2. Sum all **existing `upi_transactions`** where `settlement_date = p_settlement_date` (the already-materialised UPI for that settlement).
3. Tolerance check: `existing_sum + new_amount ≤ bank_credit × 1.01` (1% tolerance).
4. If exceeded → **hard block**: raise `MANUAL_UPI_EXCEEDS_BANK_CREDIT: …`, do not insert.
5. If no bank-statement credit found for that `settlement_date` → **allow** submission but append `admin_flags` warning `{code:"NO_BANK_CREDIT", message:"No bank statement credit found for this settlement date"}`.
6. Infer `card_settlement_id`: find the `card_settlement` whose `upi_transactions` rows share `transaction_date = p_transaction_date`. If exactly one → set it. If none → leave NULL and append `admin_flags` warning `{code:"MPR_LINK_UNVERIFIED", message:"No existing UPI transactions found for transaction_date — MPR link unverified"}`. (If multiple distinct settlements match, pick none and flag `MPR_LINK_UNVERIFIED` as well, since the link is ambiguous.)
7. Insert the row with `status='pending'`.

At **approval** time (RPC `rpc_approve_manual_payment_entry`, UPI type) — **re-validation is mandatory** because other pending entries for the same `settlement_date` may have been approved in the interim:
- Re-run steps 1–4 above using the **current** `upi_transactions` sum for that settlement date (which now includes anything approved since submission). If the tolerance check fails now → **hard block** the approval: raise `MANUAL_UPI_EXCEEDS_BANK_CREDIT`, leave the entry `pending`, surface a red error to the admin. The admin can reject it instead.
- Only if re-validation passes: INSERT into `upi_transactions`, capture its id into `upi_transaction_ref`; INSERT a `reconciliation_links` row (`source_table='upi_transactions'`, `source_id=upi_transaction_ref`, `payment_method='upi'`, `amount_applied=amount`) reusing the shared remaining/lock logic; capture link id into `reconciliation_link_ref`; recompute invoice status; mark entry `approved`, set `reviewed_by/reviewed_at`; write audit.

Another-machine type has **no** bank validation at submission or approval. On approval: INSERT a `reconciliation_links` row (`source_table='manual_payment_entries'`, `source_id=entry.id`, `payment_method='upi'`, `amount_applied=amount`), capture link id, recompute status, mark approved, audit. (Note: because the link's source is the entry itself, the standard `v_transactions_with_remaining` / remaining-check path does not apply to another-machine links; the approval RPC inserts the link directly without a source-remaining lock.)

**Reject** (`rpc_reject_manual_payment_entry`): set `status='rejected'`, `rejection_reason`, `reviewed_by/at`; never materialise anything; write audit. Row kept for audit trail.

### 14A.8 Approval Flow (summary)

1. Submission → `manual_payment_entries` row, `status='pending'`. Not counted in reconciliation; nothing inserted into `upi_transactions`/`reconciliation_links` yet.
2. Admin sees all pending entries at `/admin/manual-payments`.
3. Approve → (UPI) re-validate (hard block on failure) → INSERT `upi_transactions` → INSERT `reconciliation_links` → recompute invoice status → mark approved. (Another-machine) INSERT `reconciliation_links` → recompute → mark approved.
4. Reject → mark rejected + reason; kept for audit.
5. Both submitter and admin can see all entries (any status) for an invoice.

### 14A.9 Functional Requirements

- **FR-108** New `manual_payment_entries` table per § 14A.5, RLS on (SELECT: submitter or admin; mutations revoked).
- **FR-109** Extend `reconciliation_links.source_table` CHECK to include `'manual_payment_entries'`.
- **FR-110** `rpc_submit_manual_payment_entry(p_invoice_id uuid, p_payment_type text, p_amount numeric, p_transaction_date date, p_settlement_date date, p_vpa text, p_upi_transaction_id text) → jsonb` — operator/admin; validates per § 14A.7; infers `card_settlement_id`; appends `admin_flags`; inserts `pending`; hard-blocks UPI over-tolerance with `MANUAL_UPI_EXCEEDS_BANK_CREDIT`. Returns `{entry_id, status, admin_flags[]}`. Audit `manual_payment.submit`.
- **FR-111** `rpc_approve_manual_payment_entry(p_entry_id uuid) → jsonb` — admin only; re-validates UPI tolerance (hard block, entry stays pending on failure); materialises `upi_transactions` (UPI) + `reconciliation_links` (both types); recomputes invoice status; marks `approved`. Audit `manual_payment.approve` + the resulting `reconcile.create` style audit on the link.
- **FR-112** `rpc_reject_manual_payment_entry(p_entry_id uuid, p_reason text) → jsonb` — admin only; marks `rejected` with reason; no materialisation. Audit `manual_payment.reject`. Sentinel `REASON_REQUIRED` if blank.
- **FR-113** `rpc_get_manual_payment_entries(p_invoice_id uuid) → jsonb` — read-only; returns all entries (any status) for the invoice, RLS-scoped. Drives the invoice-page list.
- **FR-114** `rpc_get_pending_manual_payments() → jsonb` — admin only; global pending queue (+ optional status filter for approved/rejected tabs).
- **FR-115** Invoice-page "Add Payment Manually" button + modal with the two type forms (§ 14A.4); shows warning flags on submit; refreshes the entries list and (on later approval) the linked-payments/status.
- **FR-116** Invoice-page "Manual Payment Entries" list (all statuses) with badges, flags, submitter/reviewer, rejection reason.
- **FR-117** Admin page `/admin/manual-payments` — pending/approved/rejected tabs, approve/reject actions, reject-reason required, warning-flag badges, hard-block error surfacing on approve.
- **FR-118** Audit actions `manual_payment.submit`, `manual_payment.approve`, `manual_payment.reject`.
- **FR-119** On UPI approval, the materialised `upi_transactions` row is indistinguishable from a pipeline-ingested one (same columns), so it flows through `v_transactions_with_remaining`, bank-statement drill-down, and MIS exactly like OCR-sourced UPI.

### 14A.10 Business Rules

- **BR-057** A manual payment entry is never counted toward reconciliation until an admin approves it; pending entries do not create `reconciliation_links` or `upi_transactions`.
- **BR-058** UPI manual entries are hard-blocked at both submission and approval if `existing_upi_sum(settlement_date) + amount > bank_credit(settlement_date) × 1.01`.
- **BR-059** Re-validation at approval uses the live `upi_transactions` sum (which may have grown since submission), specifically to prevent two pending entries from jointly overshooting one settlement credit.
- **BR-060** A missing bank-statement credit or an unresolved MPR link is a **warning to the admin, never a block** (stored in `admin_flags`).
- **BR-061** `card_settlement_id` is inferred by matching `transaction_date` against existing `upi_transactions`; ambiguous or absent matches leave it NULL and flag `MPR_LINK_UNVERIFIED`.
- **BR-062** Another-machine entries skip all bank validation and MPR inference; their approval link uses `source_table='manual_payment_entries'`, `payment_method='upi'`.
- **BR-063** Rejected entries are retained (never deleted) for audit; rejection requires a reason.
- **BR-064** Both the submitting user and any admin can see every entry (pending/approved/rejected) for an invoice (RLS: `submitted_by = auth.uid() OR is_admin()`).
- **BR-065** On approval, the resulting `reconciliation_links` row participates in the existing AFTER DELETE trigger machinery; reversing the reconciliation via `rpc_admin_reverse_reconciliation` deletes the link and (via `reconciliation_link_ref ON DELETE SET NULL`) detaches it from the entry. (The approved entry itself remains `approved` for audit; the manually-inserted `upi_transactions` row is left in place — documented limitation.)

### 14A.11 New Sentinels

| Sentinel | Raised by | UI behaviour |
|---|---|---|
| `MANUAL_UPI_EXCEEDS_BANK_CREDIT: …` | `rpc_submit_manual_payment_entry`, `rpc_approve_manual_payment_entry` | Red error: "This UPI amount would exceed the bank settlement credit for {date}. Existing ₹X + ₹Y > ₹Z (+1%). Reduce the amount or pick the correct settlement date." On approve, entry stays pending. |
| `REASON_REQUIRED` | `rpc_reject_manual_payment_entry` | Inline validation: reason required to reject. |
| `INVALID_PAYMENT_TYPE` | `rpc_submit_manual_payment_entry` | Defensive; UI restricts to the two types. |
| `MANUAL_UPI_FIELDS_REQUIRED` | `rpc_submit_manual_payment_entry` | Inline: settlement date / VPA / UPI id required for UPI type. |
| `ENTRY_NOT_PENDING` | approve/reject RPCs | Toast: entry already decided. |

### 14A.12 Decisions Log (this feature)

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-20 | Manual entries land in a pending queue, never directly reconciled | Mirrors BR-008; OCR-gap escape hatch must stay auditable. |
| 2026-06-20 | UPI tolerance check re-run at approval against live `upi_transactions` sum | Two pending entries could otherwise jointly overshoot one settlement credit. |
| 2026-06-20 | Missing bank credit / unresolved MPR link are warnings, not blocks | The operator legitimately sees payments the OCR missed; admin judgement decides. |
| 2026-06-20 | Extend `reconciliation_links.source_table` CHECK with `manual_payment_entries` (for another-machine) | Confirmed the existing CHECK rejects it; another-machine has no real source row. |
| 2026-06-20 | UPI approval materialises a real `upi_transactions` row, then links to it | Keeps the manual UPI indistinguishable downstream (views, drill-down, MIS). |
| 2026-06-20 | Another-machine link uses `payment_method='upi'` with `source_table='manual_payment_entries'` | No truer underlying method is known; keeps it inside the existing method enum without polluting it with a manual-only value. |

---

## 14B. Feature — Duplicate Invoice Prevention (Pipeline Race Condition)

<!-- Added 2026-06-20 -->

### 14B.1 Overview & Problem Statement

The OCR/extraction pipeline for Sai Maa Hotel and Residency pulls invoice PDFs from Google Drive and processes them through a parallel worker pool (`config.yaml: max_parallel_workers: 8`). Each worker discovers a `files` row, downloads + OCRs + extracts it, and inserts a `hotel_invoice` row.

A **race condition** was discovered: when two or more workers pick up the *same* `files` row at the same time, both run the full pipeline and both insert a `hotel_invoice` row for the same `invoice_number`. Because there was no uniqueness guarantee on `hotel_invoice.invoice_number`, this produced **duplicate invoice rows** — the same invoice appearing twice in the invoice list, inflating totals and corrupting reconciliation.

On **2026-05-17, 4 duplicate pairs** were found in `hotel_invoice` (8 rows for 4 real invoices). In each pair one row carries reconciliation evidence and the other has zero `reconciliation_links` (an unused orphan from the losing worker).

### 14B.2 Root Cause

1. **No DB-level uniqueness on `hotel_invoice.invoice_number`.** Nothing stopped two inserts for the same invoice number.
2. **No worker-level mutual exclusion on file pickup.** The file-pickup query did not lock the `files` row it selected, so two workers could both read the same `pending` row, both flip it to `processing`, and both proceed — a classic lost-update / double-pickup race amplified by 8-way parallelism.

### 14B.3 The Fix (three parts)

**Part 1 — Database UNIQUE constraint.** Add a UNIQUE constraint on `hotel_invoice.invoice_number` so the database is the final backstop: a duplicate insert can never succeed regardless of pipeline timing.

Before the constraint can be applied, the existing duplicate rows must be removed. The 4 orphan rows (each with zero `reconciliation_links`) to delete:

| `hotel_invoice.id` | `invoice_number` |
|---|---|
| `38a7bdf1-452f-4ff6-b70b-f111530645e5` | `INV1988260204` |
| `a74d6958-eee1-468d-abb6-7879fea96c66` | `INV1988260215` |
| `fb7e3faf-df94-4830-a70a-07c6a1f20f9c` | `INV1988260216` |
| `66ce5006-f4e0-449d-80e1-a86ab559a7bc` | `INV1988260230` |

```sql
ALTER TABLE hotel_invoice
  ADD CONSTRAINT hotel_invoice_invoice_number_unique UNIQUE (invoice_number);
```

**Part 2 — Pipeline mutual exclusion via `SELECT … FOR UPDATE SKIP LOCKED`.** The pipeline's file-pickup query (the query that selects the next `pending` file(s) to process) must use `SELECT … FOR UPDATE SKIP LOCKED`. This makes Postgres hand each candidate row to exactly one worker: the first worker to read a row holds a row lock; any concurrent worker `SKIP LOCKED`s past it entirely and picks a different file. The second worker never sees, never processes, and never inserts a duplicate for the same file. The status flip to `processing` happens inside the same transaction that holds the lock.

**Part 3 — Logging on UNIQUE-constraint violation.** Even with Parts 1 and 2, a defensive layer remains: if a worker ever does attempt a duplicate insert (e.g. the same invoice arriving as two distinct `files` rows from Drive), the UNIQUE constraint raises. The pipeline must **catch the unique-violation on `hotel_invoice.invoice_number`** and emit a structured log entry through the existing pipeline logging mechanism (not a new table). The log entry must include:

- `file_id` of the file being processed,
- the `invoice_number` that collided,
- a timestamp,
- which worker / pipeline run attempted the duplicate insert.

This makes duplicate attempts observable/monitorable while the constraint silently prevents the bad data.

### 14B.4 Functional Requirements

- **FR-120** Delete the 4 zero-link duplicate `hotel_invoice` rows listed in § 14B.3 prior to constraint creation. Pre-verify each has zero `reconciliation_links` before deleting.
- **FR-121** Add UNIQUE constraint `hotel_invoice_invoice_number_unique` on `hotel_invoice (invoice_number)` via a migration applied through Supabase MCP `apply_migration`.
- **FR-122** Change the pipeline file-pickup query to `SELECT … FOR UPDATE SKIP LOCKED` so only one worker holds a given `files` row; concurrent workers skip locked rows and pick different files. Status transition to `processing` occurs in the same locking transaction.
- **FR-123** Catch the `hotel_invoice.invoice_number` UNIQUE-constraint violation in the invoice insert path and emit a structured pipeline log (existing logging mechanism) with `file_id`, duplicate `invoice_number`, timestamp, and worker/run identifier. The violation must not crash the worker; the file is marked appropriately (e.g. `failed` or skipped) and the run continues.

### 14B.5 Business Rules

- **BR-066** `hotel_invoice.invoice_number` is globally unique; the database rejects any second insert for an existing invoice number.
- **BR-067** Each `pending` file is processed by at most one worker at a time, enforced by `FOR UPDATE SKIP LOCKED` row locking on the pickup query.
- **BR-068** A caught duplicate-insert attempt is logged (structured) and never silently swallowed; it does not abort the parallel run.
- **BR-069** When deduplicating before the constraint, only rows with zero `reconciliation_links` are eligible for deletion (the reconciled row of each pair is always retained).

### 14B.6 New Sentinels / Log Codes

| Code | Emitted by | Meaning |
|---|---|---|
| `DUPLICATE_INVOICE_INSERT_SKIPPED` | pipeline invoice insert path | Structured log on caught UNIQUE violation; carries `file_id`, `invoice_number`, timestamp, worker/run id. |

### 14B.7 Decisions Log (this feature)

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-20 | Defence in depth: DB UNIQUE constraint + `FOR UPDATE SKIP LOCKED` + structured logging | Constraint is the guaranteed backstop; SKIP LOCKED prevents the wasteful double-processing; logging makes residual collisions observable. |
| 2026-06-20 | Delete only the zero-link duplicate of each pair before adding the constraint | The reconciled row is the source of truth; the orphan is the losing worker's artefact. |
| 2026-06-20 | Log duplicate attempts to the existing pipeline logging, not a new table | Keeps monitoring in one place; no schema sprawl for an exceptional event. |

---

## 14C. Feature — Commission & TDS Write-off at Reconciliation

<!-- Added 2026-06-20 -->

### 14C.1 Overview & Problem Statement

When reconciling OTA (Online Travel Agency) bookings and corporate-direct bookings for Sai Maa Hotel and Residency, the amount actually received is frequently **less than the invoice `grand_total`** because the OTA or corporate client deducted their **commission** or **TDS** before paying out. Today the system has no way to account for that deduction: the gap is left unexplained and the invoice sits in `partial` status permanently, even though the books are in fact settled. There is no clean, auditable mechanism to "write off" the commission/TDS portion and close the invoice.

This feature lets a user mark the remaining gap on a reconciliation as either a **Commission deduction** or a **TDS deduction**. The write-off goes through the same admin-approval discipline as a manual payment entry (Phase MPE). On approval, a `reconciliation_links` row is created that accounts for the gap, and the invoice flips to `fully_reconciled`.

Three invoices in live data are to be retroactively closed once this ships:

| `invoice_number` | Gap | Type | Party |
|---|---|---|---|
| `INV1988260052` | ₹167 | Commission | AsiaTech (via OTA) |
| `INV1988260060` | ₹483 | Commission | AsiaTech (via OTA) |
| `INV1988260059` | ₹2,000 | TDS | Raj Path Infracon |

### 14C.2 Scope

In scope (V1 of this feature):
- Reusing the **Phase MPE** `manual_payment_entries` table (no new table) with two new `payment_type` values: `'commission'` and `'tds'`, plus a new `party_name` column.
- A **"Mark as Commission / TDS"** entry point on `/invoices/[id]`, directly below the "Add Payment Manually" button, shown only when there is a remaining gap and the invoice source is OTA / corporate-direct (not Direct Walk-In / Direct By Phone).
- Submission-time validation (amount capped at the remaining gap; party required; source eligibility).
- Approval/rejection via the existing manual-payment admin queue (`/admin/manual-payments`), which now also surfaces commission/TDS entries.
- On approval, a `reconciliation_links` row with `payment_method='commission'` or `'tds'`, `source_table='manual_payment_entries'`, driving the invoice to `fully_reconciled`.
- A reporting page `/reports/deductions` listing commission and TDS deductions with party-level totals.

Out of scope (this feature): editing a submitted write-off (resubmit instead), bulk approval, write-off on Direct Walk-In / Direct By Phone invoices, partial-then-more write-offs beyond the single remaining gap, automated party detection from the OTA source.

### 14C.3 Roles

| Role | Capabilities |
|---|---|
| operator | Open the "Mark as Commission / TDS" modal on an eligible invoice; submit a commission or TDS write-off against the remaining gap; view all such entries (pending/approved/rejected) for that invoice; view `/reports/deductions`. Cannot approve. |
| admin | All of the above, plus: approve / reject commission & TDS write-offs from the existing manual-payment queue. |

### 14C.4 Entry Point & UI

**Trigger.** On `/invoices/[id]`, when `grand_total − sum(linked reconciliation_links.amount_applied) > 0` (a remaining gap exists) AND the invoice `source` is **not** Direct Walk-In / Direct By Phone, render a button **"Mark as Commission / TDS"** immediately **below** the "Add Payment Manually" button in the Add Payment / Reconcile section. Eligible sources: MMT, Goibibo, Agoda, Yatra, and corporate-direct bookings. Visible to operator and admin. Opens a modal.

**Modal fields.**
- **Type** — radio / select: `Commission` | `TDS`.
- **Party** — dropdown: `MMT` | `Goibibo` | `Agoda` | `Yatra` | `Others`. When `Others` is selected, a free-text field appears for the party name. Required.
- **Amount** — numeric, **pre-filled with the remaining gap** and **capped at the remaining gap** (cannot exceed it). Must be > 0.
- **Note** — optional free text.

**Modal — submit result.** On success, confirmation that the write-off is pending admin approval. The gap is NOT closed until approved.

**Entries list on the invoice page.** The existing "Manual Payment Entries" list (§ 14A.4) also renders commission/TDS write-offs (type badge `Commission` / `TDS`, party, amount, note, status badge, submitter/reviewer). Both submitter and admin see all such entries for the invoice.

**Admin queue.** The existing `/admin/manual-payments` queue surfaces pending commission/TDS write-offs alongside UPI/another-machine entries, with the same approve/reject affordances. Party and type are shown on each row.

**Reporting page.** New page `/reports/deductions` — see § 14C.8.

All four critical UI states (empty / loading / error / success) apply per § 9.5; error copy follows § 9.6.

### 14C.5 Data Model — `manual_payment_entries` extensions (RLS on)

No new table. Extend the Phase MPE `manual_payment_entries` table (§ 14A.5):

- **Add column** `party_name text null` — the selected party (`MMT` / `Goibibo` / `Agoda` / `Yatra`) or, when `Others` is chosen, the free-text party name. Required (non-NULL) for `payment_type ∈ {'commission','tds'}`.
- **Extend `payment_type` CHECK** from `{'upi','another_machine'}` to `{'upi','another_machine','commission','tds'}`.
- The existing `amount` (> 0), `admin_flags`, `status`, `submitted_by`, `reviewed_by`, `rejection_reason`, `reconciliation_link_ref`, and audit fields are reused as-is. The optional **Note** is stored in `rejection_reason`? No — Note is a submitter-supplied note; store it in `admin_flags`-adjacent free text. (Implementation note: reuse the existing column set; the Note maps to a dedicated free-text path — backend may store it in a `note text null` column added alongside `party_name`, or in the entry's audit context. The chosen storage is documented in the Decisions Log.)
- For commission/TDS entries, the UPI-only columns (`settlement_date`, `vpa`, `upi_transaction_id`, `card_settlement_id`, `upi_transaction_ref`) remain NULL; `transaction_date` is set to the submission date (or invoice date) for ordering.

### 14C.6 Existing tables touched

- `manual_payment_entries` — `party_name` column added; `payment_type` CHECK extended (§ 14C.5).
- `reconciliation_links`:
  - `payment_method` CHECK **extended** to include `'commission'` and `'tds'` (currently allows `upi | card | bank_transfer | cash | mmt_payout | corporate_credit`).
  - `source_table` CHECK must include `'manual_payment_entries'` — **already covered by FR-109 (Phase MPE)**; verify it is in place (if MPE-1 has not yet shipped, this feature depends on that CHECK extension).
- `hotel_invoice` — `reconciliation_status` recomputed on approval via `fn_recompute_invoice_status`; flips to `fully_reconciled` once the gap is zero.

### 14C.7 Validation Rules

At **submission** time (extension of `rpc_submit_manual_payment_entry`, or a dedicated path, for `payment_type ∈ {'commission','tds'}`):
1. `amount > 0` and `amount ≤ remaining gap` where remaining gap = `grand_total − sum(reconciliation_links.amount_applied for the invoice)`. Over the gap → **hard block** `WRITEOFF_EXCEEDS_GAP`.
2. `party_name` provided (required) → else `PARTY_REQUIRED`.
3. Invoice `source` must **not** be Direct Walk-In / Direct By Phone for `payment_type='commission'` (enforced server-side) → else `WRITEOFF_SOURCE_NOT_ELIGIBLE`. (TDS may apply to corporate-direct; commission is OTA/corporate only — both excluded from walk-in/phone.)
4. Insert with `status='pending'`.

At **approval** time (extension of `rpc_approve_manual_payment_entry`):
- Re-check the remaining gap against **current** `reconciliation_links` (other write-offs/payments may have been approved since submission). If `amount > current remaining gap` → **hard block** `WRITEOFF_EXCEEDS_GAP`, leave entry `pending`.
- Insert a `reconciliation_links` row: `source_table='manual_payment_entries'`, `source_id=entry.id`, `payment_method='commission'` or `'tds'`, `amount_applied=amount`. No source-remaining lock (the source is the entry itself, mirroring the another-machine path § 14A.7).
- Capture link id into `reconciliation_link_ref`; run `fn_recompute_invoice_status` (invoice flips to `fully_reconciled` if gap now zero); mark entry `approved`, set reviewer fields; write audit.

**Reject** (extension of `rpc_reject_manual_payment_entry`): set `status='rejected'`, `rejection_reason`, reviewer fields; never materialise; audit. Row kept for audit trail.

### 14C.8 Reporting Page — `/reports/deductions`

New page accessible to all logged-in users (operator + admin). Driven by a read-only RPC (`rpc_get_deductions_report`) or a view over approved commission/TDS `reconciliation_links` joined to `manual_payment_entries` + `hotel_invoice`.

- **Filters:** date range (approval date), type (Commission / TDS), party.
- **Table columns:** Invoice #, Guest, Source, Type (Commission/TDS), Party, Amount, Approved date.
- **Summary totals:** total commission by party; total TDS by party.
- All four UI states per § 9.5.

### 14C.9 Functional Requirements

- **FR-124** Add `party_name text` column to `manual_payment_entries`; extend its `payment_type` CHECK to include `'commission'` and `'tds'`.
- **FR-125** Extend `reconciliation_links.payment_method` CHECK to include `'commission'` and `'tds'`. Verify `'manual_payment_entries'` is in `reconciliation_links.source_table` CHECK (FR-109 / Phase MPE).
- **FR-126** Extend `rpc_submit_manual_payment_entry` (or add a dedicated submit path) to handle `payment_type ∈ {'commission','tds'}`: validate amount ≤ remaining gap (`WRITEOFF_EXCEEDS_GAP`), `party_name` required (`PARTY_REQUIRED`), source not Direct Walk-In/Phone for commission (`WRITEOFF_SOURCE_NOT_ELIGIBLE`); insert `pending`. Audit `manual_payment.submit`.
- **FR-127** Extend `rpc_approve_manual_payment_entry` to handle commission/TDS approval: re-check remaining gap (hard block, entry stays pending on failure); INSERT `reconciliation_links` (`payment_method='commission'|'tds'`, `source_table='manual_payment_entries'`, `source_id=entry.id`, `amount_applied=amount`); run `fn_recompute_invoice_status`; mark `approved`. Audit `manual_payment.approve` + reconcile-create style link audit.
- **FR-128** Reject path (`rpc_reject_manual_payment_entry`) handles commission/TDS entries identically to other types (reason required, retained for audit).
- **FR-129** Invoice-page **"Mark as Commission / TDS"** button + modal (Type, Party dropdown with Others+freetext, Amount pre-filled & capped, Note). Shown only when remaining gap > 0 AND invoice source is not Direct Walk-In / Direct By Phone.
- **FR-130** Invoice-page "Manual Payment Entries" list also renders pending/approved/rejected commission & TDS entries (type, party, amount, note, status, submitter/reviewer).
- **FR-131** Reporting page `/reports/deductions` with date-range / type / party filters, the columns of § 14C.8, and party-level commission & TDS totals; accessible to all logged-in users.

### 14C.10 Business Rules

- **BR-070** A commission/TDS write-off is never counted toward reconciliation until an admin approves it; pending write-offs create no `reconciliation_links`.
- **BR-071** A write-off amount must be `> 0` and `≤` the invoice's remaining gap, enforced at both submission and approval (`WRITEOFF_EXCEEDS_GAP`); the gap is re-checked against live `reconciliation_links` at approval.
- **BR-072** `party_name` is required for commission/TDS entries; `Others` requires the free-text party name.
- **BR-073** Commission write-offs are not allowed on Direct Walk-In / Direct By Phone invoices (source eligibility enforced server-side).
- **BR-074** On approval, the write-off becomes a `reconciliation_links` row with `payment_method='commission'` or `'tds'` and `source_table='manual_payment_entries'`; the invoice flips to `fully_reconciled` when the gap reaches zero.
- **BR-075** Reversing the reconciliation (`rpc_admin_reverse_reconciliation`) deletes the write-off link; `reconciliation_link_ref ON DELETE SET NULL` detaches it from the entry, which remains `approved` for audit.
- **BR-076** `/reports/deductions` is readable by both roles; it reflects only approved commission/TDS links.

### 14C.11 New Sentinels

| Sentinel | Raised by | UI behaviour |
|---|---|---|
| `WRITEOFF_EXCEEDS_GAP: …` | `rpc_submit_manual_payment_entry`, `rpc_approve_manual_payment_entry` | Red error: "This write-off (₹X) exceeds the remaining gap (₹Y) on this invoice. Reduce the amount." On approve, entry stays pending. |
| `PARTY_REQUIRED` | `rpc_submit_manual_payment_entry` | Inline validation: party required (and party name when Others). |
| `WRITEOFF_SOURCE_NOT_ELIGIBLE: …` | `rpc_submit_manual_payment_entry` | Red error: commission/TDS write-off not allowed on Direct Walk-In / Direct By Phone invoices. |

### 14C.12 Retroactive cleanup (manual admin task after deploy)

After this feature ships, an admin closes the three legacy invoices using the new mechanism (submit + approve a commission/TDS write-off for each):

| `invoice_number` | Amount | Type | Party |
|---|---|---|---|
| `INV1988260052` | ₹167 | Commission | AsiaTech (or relevant OTA) |
| `INV1988260060` | ₹483 | Commission | AsiaTech (or relevant OTA) |
| `INV1988260059` | ₹2,000 | TDS | Raj Path Infracon |

### 14C.13 Decisions Log (this feature)

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-20 | Reuse `manual_payment_entries` for commission/TDS rather than a new table | Same submit → pending → approve discipline as MPE; one queue, one audit path. |
| 2026-06-20 | Write-off link uses `source_table='manual_payment_entries'` (mirrors another-machine) | No real payment source row exists for a deduction; the entry is the source. |
| 2026-06-20 | New `payment_method` values `'commission'` and `'tds'` on `reconciliation_links` | Keeps the deduction visible and filterable in reports/drill-down without overloading an existing method. |
| 2026-06-20 | Amount hard-capped at the remaining gap, re-checked at approval | A write-off can only close a gap, never create an overpay; other approvals may have shrunk the gap since submission. |
| 2026-06-20 | Commission write-offs barred on Direct Walk-In / Direct By Phone sources | Those invoices have no OTA/corporate commission to deduct. |
| 2026-06-20 | TDS write-off is allowed on all invoice sources (including Direct Walk-In and Direct By Phone). Commission write-off is restricted to OTA and corporate sources only (not Direct Walk-In / Direct By Phone). | Confirmed by user 2026-06-20. |
| 2026-06-20 | `/reports/deductions` readable by both roles | Visibility into commission/TDS leakage is a shared concern, not admin-only. |

---

## 14D. Feature — Monthly Reconciliation Report

<!-- Added 2026-07-18 -->

### 14D.1 Overview & Problem Statement

Finance currently has no single-screen view of month-on-month payment reconciliation. The existing `/admin/mis` page gives aggregate monthly totals, but does not break down how much was received per payment channel, what deductions (commission, TDS, MDR, etc.) reduced the receivable, or when money for a given checkout month actually landed in the bank. This feature adds a dedicated **Monthly Reconciliation Report** giving complete visibility into billing vs. receipt vs. deductions — broken out by channel and booking source — with a payment-timing breakdown that shows how long it takes for a month's checkouts to convert into settled cash.

### 14D.2 Scope

In scope (V1):
- A new **Page 1 — Monthly Summary** at `/reports/reconciliation` listing one row per month, with billing, received-by-channel, deductions, and outstanding columns. A date-range picker filters the months shown.
- A new **Page 2 — Month Drill-down** at `/reports/reconciliation/[month]` reachable by clicking any month row on Page 1. Shows summary cards, a booking-type breakdown table, and a payment-timing table for that month's invoices.
- Both pages are read-only and accessible to both roles (operator and admin).
- **Only reconciled invoices** are included (any `reconciliation_status != 'unreconciled'`).
- Month = calendar month of `hotel_invoice.departure_time` (checkout date).

Out of scope (this feature): per-invoice drill-down, export, write operations.

### 14D.3 Roles

**Admin only.** The report is only accessible to admin users. Operators cannot view it. Middleware gates `/reports/*` the same way it gates `/admin/*` — operators attempting to access the route are redirected. No mutations are exposed.

### 14D.4 Page 1 — Monthly Summary

**Route:** `/reports/reconciliation`

**Date range picker.** Defaults to the last 12 calendar months. User can shift the window to any range. The picker filters which months appear as rows.

**Table.** One row per calendar month (ordered newest first). A "Totals" row pinned at the bottom sums all visible months.

| Column group | Column | Source |
|---|---|---|
| **Month** | Month (e.g. Jun 2026) | `DATE_TRUNC('month', departure_time)` |
| **Invoices** | # | Count of included invoices |
| **Billed** | Gross | `SUM(grand_total)` |
| | Taxable | `SUM(taxable_amount)` |
| | GST | `SUM(cgst + sgst)` |
| **Received — by channel** | MMT | `SUM(rl.amount_applied)` for `payment_method='mmt_payout'` + `mmt_bookings_payout.brand` = MMT |
| | Goibibo | Same, brand = Goibibo |
| | Card | `payment_method='card'`, `source_table='card_transactions'` |
| | UPI | `payment_method='upi'`, `source_table='upi_transactions'` (pipeline only; excludes another-machine) |
| | Cash | `payment_method='cash'` |
| | Bank Transfer | `payment_method='bank_transfer'` |
| | Another Machine | `source_table='manual_payment_entries'`, `payment_method='upi'` |
| | Other | All other non-deduction links |
| | **Total Received** | Sum of the above |
| **Deductions** | OTA Commission | `go_mmt_commission` (MMT/Goibibo) + `yatra_commission` (Yatra) + `agoda_bookings_payout.commission` (Agoda) + manual write-offs with `payment_method='commission'` |
| | GST on Commission | `gst_on_commission` (MMT/Goibibo) + `yatra_bookings_payout.gst` (Yatra) |
| | TDS | `mmt_invoice.tds` + `yatra_bookings_payout.tds` + `agoda_bookings_payout.tds_withholding_tax` + manual write-offs with `payment_method='tds'` |
| | TCS | `mmt_invoice.tcs` + `yatra_bookings_payout.tcs` |
| | MDR | `SUM(card_transactions.gross_amount × mdr_percent / 100)` for card links on these invoices |
| | **Total Deductions** | Sum of the above |
| **Outstanding** | | `Gross − Total Received − Total Deductions` |

**Received columns definition.** Received amounts are `reconciliation_links.amount_applied` values filtered to non-deduction payment methods. `payment_method IN ('commission', 'tds')` links are counted in the Deductions section, not Received. Manual write-offs of type commission/TDS are treated as deductions.

**Deduction attribution.** OTA deductions are pulled from the relevant OTA payout table linked to each invoice via the back-pointer chain: `reconciliation_links.id = mmt_bookings_payout.reconciled_link_id → mmt_bookings_payout.transaction_no → mmt_payouts → (commission/TDS fields from mmt_invoice)`. Yatra and Agoda analogously. MDR is attributed to the invoice whose reconciliation_link points to the card_transaction.

**Row click.** Clicking any data row navigates to `/reports/reconciliation/[YYYY-MM]` (Page 2).

### 14D.5 Page 2 — Month Drill-down

**Route:** `/reports/reconciliation/[month]` where `[month]` is `YYYY-MM` (e.g. `2026-06`).

**Back navigation.** A "← Back to Monthly Summary" link at the top.

#### Section 1 — Summary Cards (4 cards)

| Card | Value |
|---|---|
| Total Billed | `SUM(grand_total)` for all included invoices in this month |
| Net Receivable | `SUM(grand_total) − Total Deductions` |
| Total Received | `SUM(rl.amount_applied)` for non-deduction links |
| Outstanding | `Net Receivable − Total Received` |

#### Section 2 — Booking Type Breakdown Table

One row per distinct booking source (Walk-in, MMT, Goibibo, Yatra, Agoda, Phone, Other). Sources derived via `fn_classify_invoice_source` logic extended to split MMT from Goibibo based on `hotel_invoice.source`.

| Column | Definition |
|---|---|
| Source | Source label (MakeMyTrip, Goibibo, Yatra, Agoda, Walk-in, Phone, Other) |
| # Invoices | Count of included invoices for this source |
| Gross Billed | `SUM(grand_total)` |
| GST | `SUM(cgst + sgst)` (GST collected on the hotel invoice — what the guest paid) |
| Net Receivable | `SUM(grand_total) − source-level deductions` |
| Total Deductions | Sum of commission + GST-on-commission + TDS + TCS + MDR attributed to invoices of this source |
| Received | `SUM(rl.amount_applied)` for non-deduction links on these invoices |
| Outstanding | `Net Receivable − Received` |

A totals row pinned at the bottom.

#### Section 3 — Payment Timing Table

**Definition.** For invoices with checkout in this month, shows when the associated payments arrived relative to the checkout month. Grouped summary only — no individual invoice rows.

**Payment date per link type:**
- `source_table='bank_statement'`: `bank_statement.date`
- `source_table='card_transactions'`: `card_transactions.settlement_date`
- `source_table='upi_transactions'`: `upi_transactions.settlement_date`
- `source_table='cash_payments'`: `cash_payments.payment_date`
- `source_table='manual_payment_entries'`: `manual_payment_entries.transaction_date`

**Buckets.** Offset = `DATE_TRUNC('month', payment_date) − DATE_TRUNC('month', invoice.departure_time)` (in months):

| Period label | Offset |
|---|---|
| Same Month (Month X) | 0 |
| Month X+1 | 1 |
| Month X+2 | 2 |
| Month X+3 or later | ≥ 3 |
| Still Pending | No reconciliation link yet (outstanding amount) |

"Still Pending" amount = `SUM(grand_total) − SUM(all rl.amount_applied including deductions)` for invoices in this month. Commission/TDS write-offs ARE included in the already-received total for this calculation (they close the gap even though they are not cash received).

Columns: Period | Amount | % of Net Receivable.

### 14D.6 New RPCs

#### `rpc_get_reconciliation_monthly_summary(p_date_from date, p_date_to date) → jsonb`

Read-only, role-checked (`is_operator_or_admin()`), no audit. Returns a JSON array ordered newest-month-first. Each element:

```jsonc
{
  "invoice_month": "2026-06-01",    // DATE_TRUNC('month', ...)
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

Filters: `DATE_TRUNC('month', hi.departure_time)` between `DATE_TRUNC('month', p_date_from)` and `DATE_TRUNC('month', p_date_to)`. Only invoices with `reconciliation_status != 'unreconciled'` and non-NULL `departure_time`.

#### `rpc_get_reconciliation_month_detail(p_month_start date) → jsonb`

`p_month_start` is the first day of the month (`YYYY-MM-01`). Returns:

```jsonc
{
  "summary": {
    "total_billed": 350000, "net_receivable": 326060,
    "total_received": 247000, "outstanding": 79060
  },
  "booking_type_breakdown": [
    {
      "source": "MakeMyTrip", "invoice_count": 12,
      "gross_billed": 95000, "gst": 8600, "net_receivable": 78500,
      "total_deductions": 8100, "received": 78500, "outstanding": 0
    }
    // ... one row per source present in this month
  ],
  "payment_timing": [
    { "period": "same_month",      "label": "Jun 2026", "amount": 200000, "pct": 81.3 },
    { "period": "month_plus_1",    "label": "Jul 2026", "amount": 30000,  "pct": 12.2 },
    { "period": "month_plus_2",    "label": "Aug 2026", "amount": 10000,  "pct": 4.1  },
    { "period": "month_plus_3",    "label": "Sep 2026+","amount": 7000,   "pct": 2.8  },
    { "period": "pending",         "label": "Still Pending","amount":3060,"pct": ...  }
  ]
}
```

### 14D.7 Frontend Pages

**Route structure:**
- `src/app/(app)/reports/reconciliation/page.tsx` — Page 1 summary (server/client split)
- `src/app/(app)/reports/reconciliation/[month]/page.tsx` — Page 2 drill-down (server/client split)

**Navigation.** Add "Reconciliation Report" nav entry in the **admin** sidebar only, under a "Reports" group (or alongside the existing MIS Report entry). Route: `/reports/reconciliation`. Operators do not see this nav entry.

**Page 1 UI components:** Date range picker (shadcn `Popover` + `Calendar` or a date-range input), summary table with sticky totals row, loading skeletons on each row, clickable rows with hover state.

**Page 2 UI components:** Back link, 4 summary stat cards (same card style as admin home tiles), booking-type table with totals row, payment-timing table, pending reconciliation list (Section 4 — hidden when empty).

All four critical UI states (empty / loading / error / success) per § 9.5. Error copy per § 9.6.

### 14D.8 Functional Requirements

- **FR-132** New route `/reports/reconciliation` (and `/reports/reconciliation/[month]`) accessible to **admin only**; middleware gates `/reports/*` for operators (same redirect as `/admin/*`).
- **FR-133** Page 1: date range picker defaulting to last 12 months; table with one row per month (ordered newest first) and a totals row.
- **FR-134** Page 1 columns: Month, # Invoices, Gross Billed, Taxable, GST, Received by channel (MMT / Goibibo / Card / UPI / Cash / Bank Transfer / Another Machine / Other / Total), Deductions (Commission / GST on Commission / TDS / TCS / MDR / Total), Outstanding.
- **FR-135** ~~Only invoices with `reconciliation_status != 'unreconciled'`~~ **All** invoices with non-NULL `departure_time` are included in both summary and drill-down pages. Unreconciled invoices contribute to Gross Billed and Outstanding (received = 0, deductions = 0). *(Updated 2026-07-19 — original filter removed so totals match the GST report.)*
- **FR-136** Month = `DATE_TRUNC('month', hotel_invoice.departure_time)`.
- **FR-137** Channel split for MMT vs. Goibibo uses `mmt_bookings_payout.brand` field via the `reconciled_link_id` back-pointer.
- **FR-138** `payment_method IN ('commission', 'tds')` links are counted in Deductions, not in Received channels.
- **FR-139** MDR sourced from `card_transactions.gross_amount × mdr_percent / 100` for card links on the relevant invoices.
- **FR-140** Clicking a month row navigates to `/reports/reconciliation/[YYYY-MM]` (Page 2).
- **FR-141** Page 2: summary cards (Total Billed, Net Receivable, Total Received, Outstanding); booking-type breakdown table; payment-timing table. All grouped summary — no per-invoice rows.
- **FR-142** Booking-type table columns: Source, # Invoices, Gross Billed, GST, Net Receivable, Total Deductions, Received, Outstanding; totals row pinned at bottom.
- **FR-143** Payment-timing buckets: Same Month, Month+1, Month+2, Month+3+, Still Pending; each with amount and % of Net Receivable.
- **FR-144** Payment date per link type: bank_statement → `date`; card_transactions → `settlement_date`; upi_transactions → `settlement_date`; cash_payments → `payment_date`; manual_payment_entries → `transaction_date`.
- **FR-145** `rpc_get_reconciliation_monthly_summary(p_date_from date, p_date_to date)` — read-only, role-checked, no audit. Returns array per § 14D.6.
- **FR-146** `rpc_get_reconciliation_month_detail(p_month_start date)` — read-only, role-checked, no audit. Returns object per § 14D.6.
- **FR-147** Nav entry "Reconciliation Report" added to the **admin** sidebar only; operators do not see it.
- **FR-148** Page 2 Section 4 — **Pending Reconciliation**: below the payment-timing table, show a list of all invoices for the month with `reconciliation_status IN ('unreconciled', 'partial')`. Columns: Invoice #, Guest Name, Check-out Date, Source, Amount, Status, and a "Reconcile →" link that navigates to `/invoices/[id]`.
- **FR-149** "Pending Reconciliation" section is hidden when there are no pending invoices for the month.
- **FR-150** The "Reconcile →" link opens the invoice's existing detail page (`/invoices/[id]`) where the reconcile panels live. No new page or modal needed.

### 14D.9 Business Rules

- **BR-077** Month boundary is checkout date (`departure_time`); invoices with NULL `departure_time` are excluded.
- **BR-078** ~~Only reconciled invoices (status ≠ `unreconciled`) contribute to any aggregate.~~ **All** invoices (any status) contribute to Gross Billed and Outstanding on both pages. Unreconciled invoices have received = 0 and deductions = 0. *(Updated 2026-07-19.)*
- **BR-079** Outstanding = `Gross Billed − Total Received − Total Deductions`. A write-off that is approved (commission/TDS) closes the gap in both the Deductions total and the Outstanding figure.
- **BR-080** Received channels exclude commission/TDS write-offs; those are counted only in Deductions.
- **BR-081** Payment timing "Still Pending" = `SUM(grand_total) − SUM(all rl.amount_applied)` including write-offs, because write-offs close the booking gap even without cash.
- **BR-082** Report is admin-only. RPCs are role-checked (`is_admin()`). Middleware gates `/reports/*` for operators. No write operations are exposed.

### 14D.10 Decisions Log (this feature)

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-18 | Month = checkout (`departure_time`) date | Confirmed by user: "month is calculated on checkout date." |
| 2026-07-18 | Only reconciled invoices included | Confirmed by user: "only reconciled." Unreconciled invoices have no payment evidence — mixing them would distort the received amounts. |
| 2026-07-18 | Commission/TDS write-offs appear only in Deductions, not Received | They are not cash receipts; treating them as received would inflate the received total. Outstanding correctly closes to zero once a write-off is approved. |
| 2026-07-18 | MDR as a standalone deduction column | MDR is deducted by the bank before settlement; it explains the difference between what the guest paid by card and what the hotel received. |
| 2026-07-18 | GST column in booking-type table = hotel_invoice GST (not OTA GST on commission) | User confirmed: "GST collected on hotel invoice." |
| 2026-07-18 | Payment timing "Still Pending" includes commission/TDS write-offs in "already closed" denominator | A write-off closes the booking gap from an accounting perspective; only truly unreceived cash should be "pending." |
| 2026-07-18 | Payment timing grouped summary only, no per-invoice rows | Confirmed by user: "only grouped summary." |
| 2026-07-18 | Separate page for drill-down (`/reports/reconciliation/[month]`) rather than inline accordion | Volume of data (3 sections) warrants a dedicated page; clicking a row navigates there. |
| 2026-07-18 | Admin-only access | Confirmed by user mid-implementation: "this should be visible only to the admin." |
| 2026-07-19 | Remove unreconciled filter from both RPCs | GST report has 113 invoices; app was showing 100 (excluding 13 unreconciled). User confirmed all invoices should appear so totals match GST report. |
| 2026-07-19 | MDR is a P&L deduction, not a hidden bank cut | User: "wherever there are MDR charges, it needs to come under deductions since when I make the final P&L, it will come as an expense." Card received = post-MDR net; MDR appears as its own deduction column. |
| 2026-07-19 | Sub-₹1 outstanding differences display as ₹0 | User: "if there is a difference of less than 1rs in this — the difference should be marked as 0." Frontend `roundOutstanding()` helper: `Math.abs(v) < 1 ? 0 : v`. |
| 2026-07-19 | Section 4 — Pending Reconciliation list on Page 2 | User: "I want a list of all the unreconciled invoices, and an option to open and reconcile." Include both `unreconciled` and `partial`. Link to existing `/invoices/[id]` page. |

---

## 15. Out of Scope / Backlog (V1.5+)

- CSV / Excel export beyond Bank Statement.
- Void / cancelled / refunded invoices (not modelled).
- Notifications (email / Slack / SMS) on new approval / discrepancy / issue report.
- Bulk reconciliation operations.
- Mobile / responsive layout (desktop only in V1).
- Bank-statement ↔ MPR settlement reconciliation as its own page.
- Multi-property support.
- Self-service user provisioning UI.
- ML / auto-match for transaction selection.
- Draft reconciliations.
- Yatra cancellation/amendment workflow.
- Bank statement withdrawal rows in `/bank-statement`.
- Re-uploading a corrected Payment Folio that supersedes an earlier upload (admin can delete via SQL).
- Editing a `payment_entries` row post-upload.
- Drive-folder auto-ingest of payment folios.
- Reconciling `corporate_credit` payments.
- Operator-side "my open reports" dedicated page.
- Per-category SLAs or aging buckets for issue reports.
- Admin-side bulk resolve of issue reports.
- Auto-merging duplicate Yatra rows for the same `voucher_no`.
- Enable RLS on the 14 pipeline tables currently advisory-flagged (needs a deliberate policy design pass).
