# Database Manager Context
<!-- Last updated: 2026-05-23 (Y5: yatra_payout drill) -->

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

### [2026-05-23] yatra_payout_bank_statement_drill (Y5)
- Extended `public.rpc_get_bank_statement_view(...)` to detect a fourth drill type, `yatra_payout`:
  - Added to the `classified` CASE ladder (after `mmt_payout`): a bank_statement row classifies as `yatra_payout` when at least one `yatra_bookings_payout.reconciled_link_id` points to a `reconciliation_links` row with `source_table='bank_statement'` AND `source_id = bank_statement.id`.
  - Added `yatra_count` to `drill_counts` CTE (count of such yatra payouts per bank row).
  - Added `yatra` key to the `drill_count` jsonb object in the returned rows (alongside `upi`, `card`, `mmt`).
  - Precedence: existing types win (UPI/Card narration patterns, MMT chq_ref pattern) — yatra is only classified when none of those match.
- Extended `public.rpc_get_bank_statement_drilldown(p_bank_statement_id uuid, p_drill_type text)` with a new `ELSIF p_drill_type = 'yatra_payout'` branch:
  - Selects `yatra_bookings_payout` rows joined via `reconciled_link_id` to `reconciliation_links` filtered to `source_table='bank_statement' AND source_id = p_bank_statement_id`.
  - LEFT JOIN to `hotel_invoice` via `rl.invoice_id` for the linked invoice number.
  - Emits per-sub-row fields: `id, voucher_no, guest_name, hotel_name (NULL — yatra_bookings_payout has no hotel_name column), check_in, check_out, yatra_to_pay_hotel, hotel_invoice_id, hotel_invoice_number, reconciled_at, reconciled_link_id, is_reconciled, reconciled_invoices (single-element jsonb array), applied_total = rl.amount_applied, base_amount = ybp.yatra_to_pay_hotel`.
- SECURITY DEFINER, role guard (`current_user_role() IN ('operator','admin')`), no audit write, EXECUTE granted to authenticated.
- Smoke tests:
  - Drilldown query for `bank_statement_id='0ce554f3-1a76-4ad4-b83a-f81a84294303'` (only existing yatra-reconciled bank credit, NEFT CR-YATRA ONLINE, 5930.00) returned 1 sub-row: voucher_no=`0011929675`, guest=`Shree shaila Thiperappa Swamy`, base_amount=5930.22, applied_total=5930, reconciled_invoices=[{invoice_number:`INV1988260114`, hotel_invoice_id:`b4212707-...`, amount_applied:5930}].
  - Classification: same bank row now reports `drill_type='yatra_payout'` and `yatra_count=1`.
- Advisors: no new errors. The 4 function-mention WARNs for `rpc_get_bank_statement_view` and `rpc_get_bank_statement_drilldown` are the pre-existing `anon/authenticated_security_definer_function_executable` pattern affecting all SECURITY DEFINER RPCs (intentional, role guard inside denies anon).
- Rollback: re-apply the previous definitions from migration `20260523_bank_statement_drilldown_attribution_v2` via `CREATE OR REPLACE FUNCTION` — that version classifies only `upi_settlement / card_settlement / mmt_payout`, has no `yatra_count` in drill_counts, and rejects `p_drill_type='yatra_payout'` with "Unknown drill_type".

### [2026-05-23] bank_statement_drilldown_attribution_v2
- Extended `public.rpc_get_bank_statement_drilldown(uuid, text)` to add per-sub-row attribution:
  - `reconciled_invoices`: jsonb array of `{hotel_invoice_id, invoice_number, amount_applied}` from `reconciliation_links` keyed on source_table+source_id (UPI/Card) or via `mmt_bookings_payout.reconciled_link_id` (MMT).
  - `applied_total`: numeric sum of `amount_applied`, NULL when array empty.
  - `base_amount`: UPI -> `upi_transactions.amount`; Card -> `gross_amount * (1 - mdr_percent/100)`; MMT -> `mmt_bookings_payout.payable`.
- Backward compatible: all prior fields preserved (`invoice_id`, `invoice_number`, `net_after_mdr`, etc.). For UPI/Card sub-rows the existing scalar `invoice_id`/`invoice_number` now reflect the FIRST link (by created_at,id); previously each sub-row could appear duplicated when a single txn had multiple links. Each UPI/Card txn now emits exactly one sub-row containing the full attribution array.
- SECURITY DEFINER, role guard (`current_user_role() IN ('operator','admin')`), no audit write, EXECUTE granted to authenticated.
- Smoke tests run:
  - UPI: bank_id `eb67085a-9aa8-46b3-979e-8b5b18014c18` returned 2 sub-rows; first had reconciled_invoices=[6930,2874] (sum=9804=base_amount), second had empty array + null applied_total.
  - Card: bank_id `af55eaa2-e812-41c5-93fe-826a43a43179` returned 1 sub-row; base_amount=4236.53 (net), applied_total=4275, 1 invoice.
  - MMT: bank_id `07d12605-8e64-4fbc-a821-9dc08fb236c2` returned 3 sub-rows; 2 reconciled (single-entry array each), 1 unreconciled (empty array, null applied_total).
- Advisors: no new errors. The only function-mention WARNs (`anon_security_definer_function_executable`, `authenticated_security_definer_function_executable`) are the project-wide pattern affecting all 34 SECURITY DEFINER RPCs — intentional, role guard inside the function denies anon.
- Rollback: re-apply the prior definition from migration `20260518192611` (`bank_statement_attribution_and_total_applied`) via `CREATE OR REPLACE FUNCTION` — that version did not have `reconciled_invoices`, `applied_total`, or `base_amount`.

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
- 20260523_yatra_payout_bank_statement_drill
- 20260523_bank_statement_drilldown_attribution_v2
- 20260523092150 fix_payment_entries_add_manual_method
- 20260523090649 pf_rpcs_payment_folio_fix_conflict
- 20260523090608 pf_rpcs_payment_folio_fix_status
- 20260523090508 pf_rpcs_payment_folio
- 20260523085108 pf_payment_folio_schema
- 20260523074615 v1_issue_categories_lock_function_grants
- 20260523074514 v1_issue_categories_configurable
- 20260523072811 v1_rpc_issue_reports
- 20260523072618 v1_invoice_issue_reports
- 20260521185259 agoda_bookings_payout_pipeline
- 20260521182217 bank_statement_upload_rpc
- 20260521181215 bank_statement_fix_payment_method_cast
- 20260521175410 yatra_reconcile_status_vs_net_receivable
- 20260521173451 yatra_reconcile_allow_desiya_source
- 20260521172932 yatra_bookings_payout_disable_rls
- 20260518195715 bank_statement_child_reconciliation_attribution
- 20260518192727 yatra_rpcs
- 20260518192632 yatra_payout_schema
- 20260518192611 bank_statement_attribution_and_total_applied
- 20260518185432 v1_drilldown_add_mmt_reconciled_fields
- 20260518180648 fix_bank_statement_upi_drill_matching
- 20260518175119 bank_statement_view_rpcs
- 20260517173805 fix_v_transactions_use_settlement_date
- 20260517170801 mmt_candidates_name_automatch
- 20260517164232 mmt_net_receivable_and_monthly_deductions
- 20260517161339 mmt_direct_reconcile_rpcs_role_guard_fix
- 20260517160843 mmt_direct_reconcile_rpcs
- 20260517160707 mmt_direct_reconcile_schema
- 20260517153039 mmt_payouts_and_bookings_payout_tables
- 20260517141640 v1_mis_monthly_views
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

### [2026-05-23] Bank Statement Drilldown Attribution v2
- The drill-down RPC now returns per-sub-row attribution arrays. Frontend can stop separately fetching reconciliation_links to render UPI/Card/MMT drill-downs.
- For UPI/Card sub-rows: any single transaction can be split across multiple invoices. The `reconciled_invoices` array preserves that 1-to-many fidelity; `applied_total` gives the total applied (compare against `base_amount` for partial detection).
- For MMT: one booking maps to at most one reconciliation link (via `mmt_bookings_payout.reconciled_link_id`). The array is 0-or-1 element.
- Possible follow-up: enable RLS on `upi_transactions`, `card_transactions`, `mmt_bookings_payout`, `hotel_invoice`, `bank_statement` — currently the RPC is the only access path so it would not change behavior, but the security advisor still flags these tables as RLS-disabled (pre-existing).

### [2026-05-23] Yatra payout bank statement drill (Y5)
- Bank statement view now classifies a fourth drill type, `yatra_payout`, used when a `yatra_bookings_payout` row has been reconciled to a hotel invoice via a `reconciliation_links` row whose source is the bank credit itself (`source_table='bank_statement'`).
  - This is the inverse direction from MMT: MMT detection is via `chq_ref_no` pattern against `mmt_bookings_payout.transaction_no`, while Yatra detection is via the existing reconciliation link (Yatra reconciliation already stores `bank_statement.id` in `reconciliation_links.source_id`).
  - Implication: only Yatra payouts that have been reconciled appear as `drill_type='yatra_payout'`. Unreconciled yatra payouts arriving as bank credits will NOT be drillable yet — they'll appear with `drill_type=null` until reconciled. (This differs from MMT, where the chq_ref linkage is detectable pre-reconcile.) A future enhancement could add a chq_ref/voucher_no detector for yatra similar to MMT if Yatra payouts have a transaction id that appears in `bank_statement.chq_ref_no`.
- `BankStatementRow.drill_count` shape changed from `{upi, card, mmt}` to `{upi, card, mmt, yatra}`. Existing frontend reads via optional chaining (`r.drill_count?.upi ?? 0`) are unaffected; types updated accordingly.
- `BankStatementDrillYatra` shape: voucher_no (the natural Yatra identifier — there's no Yatra equivalent of MMT's booking_id/PNR pair), guest_name, hotel_name (currently always null — `yatra_bookings_payout` schema does not have a hotel_name column), check_in/out, yatra_to_pay_hotel (= base_amount), hotel_invoice_id/number, is_reconciled, reconciled_invoices, applied_total, base_amount.
