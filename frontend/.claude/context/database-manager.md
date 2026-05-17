# Database Manager Context
<!-- Last updated: 2026-05-17 -->

## Schema Inventory

### Tables (public schema)
- **hotel_invoice** (237 rows, RLS off): hotel guest invoices. Key cols: `id` (uuid pk), `file_id`, `guest_name`, `source`, `arrival_time` (date), `departure_time` (date — checkout, drives MIS invoice_month), `booking_id`, `booking_date`, `taxable_amount`, `cgst`, `sgst`, `grand_total`, `invoice_number`, `reconciliation_status`, `created_at`.
- **mmt_invoice** (11 rows, RLS off): MakeMyTrip OTA invoices.
- **bank_statement** (161 rows, RLS off): bank statement rows. Key cols: `id`, `file_id`, `date`, `narration`, `chq_ref_no`, `value_dt`, `withdrawal_amt`, `deposit_amt`, `closing_balance`, `row_number`.
- **card_settlement** (44 rows, RLS off): card settlement batches.
- **card_transactions** (79 rows, RLS off): card txn lines. Key cols: `id`, `card_settlement_id`, `transaction_date`, `settlement_date`, `gross_amount`, `mdr_percent`.
- **upi_transactions** (80 rows, RLS off): UPI txn lines. Key cols: `id`, `card_settlement_id`, `transaction_date`, `settlement_date`, `amount`, `vpa`, `upi_transaction_id`.
- **cash_payments** (0 rows, RLS ON): manual cash entries. Key cols: `id`, `payment_date`, `amount`, `created_by`.
- **reconciliation_links** (4 rows, RLS ON): junction. One row = one (invoice, source_transaction) pairing. Cols: `id`, `invoice_id` -> hotel_invoice.id, `source_table` (text discriminator: 'upi_transactions'|'card_transactions'|'bank_statement'|'cash_payments'), `source_id` (uuid pointing at one of those tables), `payment_method` (text: 'upi'|'card'|'bank_transfer'|'cash'), `amount_applied` (numeric), `created_by`, `created_at`.
- **user_profiles** (2 rows, RLS ON): hotel staff profiles extending auth.users; role drives RLS/RPC.
- **approval_requests** (0 rows, RLS ON), **discrepancies** (0 rows, RLS ON), **payment_source_config** (6 rows, RLS ON), **audit_log** (7 rows, RLS ON).
- **files**, **ocr_outputs**, **extractions**, **processing_logs**: document/OCR pipeline tables (RLS off).

### Views
- **v_mis_monthly_summary** (security_invoker=true): one row per invoice_month with invoice_count, total_invoiced, total_received, same_month_received, other_month_received, pending. Ordered by invoice_month DESC.
- **v_mis_payment_detail** (security_invoker=true): one row per (invoice_month, payment_month, payment_method) with amount_received. Ordered by invoice_month DESC, payment_month DESC, payment_method ASC.
- **transactions_with_remaining** (from earlier migration): per-source remaining balances.

### Relationships
- `reconciliation_links.invoice_id` -> `hotel_invoice.id` (many-to-one)
- `reconciliation_links.source_id` -> one of {`upi_transactions.id`, `card_transactions.id`, `bank_statement.id`, `cash_payments.id`} based on `source_table` discriminator.
- One invoice can have many links; one source txn can have many links (many-to-many).
- `card_transactions.card_settlement_id` -> `card_settlement.id`.

## Migration History

### [2026-05-17] v1_mis_monthly_views
- Created two views to drive the Hotel MIS monthly report:
  - `v_mis_monthly_summary` — aggregates per invoice_month (departure_time truncated to month).
  - `v_mis_payment_detail` — aggregates per (invoice_month, payment_month, payment_method).
- Both views use `WITH (security_invoker = true)` so they honour RLS on base tables when queried as a Supabase user.
- Invoices with NULL departure_time are excluded.
- Invoices with zero payments still appear via LEFT JOIN; pending = grand_total in that case.
- Payment month is derived per source: upi/card -> settlement_date; bank_statement -> date; cash_payments -> payment_date. All truncated to month start.
- File: applied via Supabase MCP `apply_migration` with name `v1_mis_monthly_views`.
- Rollback: `DROP VIEW IF EXISTS public.v_mis_payment_detail; DROP VIEW IF EXISTS public.v_mis_monthly_summary;`

### Prior migrations (chronological)
- 20260517055712 initial_schema
- 20260517055730 document_type_tables
- 20260517055919 add_row_number_to_bank_statement
- 20260517060746 add_card_transactions_table
- 20260517060935 add_upi_transactions_table
- 20260517080412 v1_reconciliation_core_tables
- 20260517080513 v1_seed_payment_source_config
- 20260517080519 v1_audit_helper_function
- 20260517080532 v1_transactions_with_remaining_view
- 20260517081303 v1_create_initial_users
- 20260517081337 v1_rls_policies
- 20260517081516 v1_rpc_reconciliation_core
- 20260517081631 v1_rpc_approvals_and_admin
- 20260517082559 v1_security_hardening

## RLS Policies
- Views inherit access from base tables thanks to `security_invoker = true`. No view-level policies required.
- Existing RLS lives on user_profiles, cash_payments, reconciliation_links, approval_requests, discrepancies, payment_source_config, audit_log (set by v1_rls_policies).

## Index Inventory
- No new indexes added in this migration. The views aggregate on already-keyed columns (`reconciliation_links.invoice_id`, source-table PKs, `hotel_invoice.departure_time`).
- Future optimization candidate: `CREATE INDEX ON hotel_invoice (departure_time);` if MIS reports get slow.

## Pending / In Progress
- 10 tables still have RLS disabled (advisory from Supabase): files, ocr_outputs, extractions, processing_logs, hotel_invoice, mmt_invoice, card_settlement, bank_statement, card_transactions, upi_transactions. Enabling RLS without policies would break the views since the underlying SELECTs would return zero rows. Needs a deliberate RLS-policy design pass before flipping the switch.

## Decisions Log

### [2026-05-17] Use a single CASE per source_table to compute payment_month
- Chose a LEFT JOIN to all four source tables and a CASE on `source_table` to pick the right date. Keeps the views self-contained and avoids needing a helper SQL function.
- Alternative considered: a SQL function `payment_month_for(source_table, source_id)`. Rejected — costlier per-row, less optimizer-friendly.

### [2026-05-17] Compute total_invoiced via correlated sub-aggregate
- Because the LEFT JOIN to payments multiplies invoice rows when an invoice has >1 payment, summing `grand_total` directly would double-count. Used a sub-aggregate over `invoice_base` for total_invoiced (and the pending formula).
- `invoice_count` uses `COUNT(DISTINCT invoice_id)` for the same reason.

### [2026-05-17] security_invoker = true on both views
- Required by the spec. Means RLS on base tables is honoured when a non-superuser queries the views. Important when RLS gets turned on for hotel_invoice and the txn tables.

## Notes for Product Manager
- MIS views verified on live data: 2 invoice months present (2026-04 and 2026-05). April: 155 invoices, 1,234,953 invoiced, 45,202 received (all same-month — 15,498 card + 29,704 upi), 1,189,751 pending. May: 82 invoices, 684,223 invoiced, 0 received, 684,223 pending.
- Only 4 reconciliation_links exist so far; the views will get more interesting as reconciliation activity grows.
- If MIS UI needs to filter by hotel/property, the views currently aggregate across all invoices. Easy to add a `hotel_id` column once that exists on `hotel_invoice`.
