# Database Manager Context
<!-- Last updated: 2026-07-19 (MRR-2 mrr_rpc_include_unreconciled + MRR-4 mrr_rpc_pending_invoices + MRR-D data fixes) -->
<!-- Previous: 2026-07-18 (MRR-1 + mrr_pending_formula_fix applied) -->
<!-- Previous: 2026-06-20 16:45 (BUG-002 applied) -->
<!-- Previous: 2026-06-20 16:30 (DUP-1 applied) -->
<!-- Previous: 2026-06-20 16:15 (CDW-1 applied) -->
<!-- Previous: 2026-06-20 (MPE-1 applied) -->
<!-- Previous: 2026-05-23 (PF-1 applied) -->

## [2026-07-19] MRR-2 — Remove `unreconciled` filter from both RPCs (`mrr_rpc_include_unreconciled`) — COMPLETED
- Migration `mrr_rpc_include_unreconciled` applied via Supabase MCP. `CREATE OR REPLACE` on both RPCs; no schema/table changes.
- **Change:** In both `rpc_get_reconciliation_monthly_summary` and `rpc_get_reconciliation_month_detail`, the `inv` CTE previously filtered `AND hi.reconciliation_status <> 'unreconciled'`. That line was removed so ALL invoices (fully_reconciled + partial + unreconciled) now appear in the report aggregates.
- **Why:** GST file for June 2026 had 113 invoices; the app showed 100. The 13 missing were `unreconciled` invoices that existed in DB but were silently excluded. Removing the filter makes the report match the hotel's GST records (PRD FR-135 / BR-078 updated).
- **Effect on June 2026:** 100 → 113 invoices; gross_billed increases accordingly. Outstanding correctly reflects what is genuinely unpaid, including unreconciled invoices.
- Verification: `rpc_get_reconciliation_monthly_summary` June 2026 → 113 invoices (79 fully_reconciled + 21 partial + 13 unreconciled = ₹9,76,168 gross). PASS.

## [2026-07-19] MRR-D — Data fix: MMT May 2026 duplicate commission (INV1988260167) — COMPLETED
- **Root cause:** INV1988260167 (Thirumala Rao V, ₹4,590) had the MMT payout row deduct ₹1,004.30 via the `mmt_invoice` CTE (correct). Additionally, a manual commission `reconciliation_links` row was created on 2026-07-06 (id `ad4679e8-33c2-4923-af9c-e770c00317ec`) pointing at a `manual_payment_entries` row (id `4bc884e2-e30a-407c-a715-7d9bca2f1628`, amount ₹1,004). This double-counted the commission → `net_receivable` was ₹1,004 too low → outstanding = 17.78 + (−1,004.30) = **−₹986.52**.
- **Fix (direct SQL, no migration):**
  ```sql
  DELETE FROM reconciliation_links WHERE id = 'ad4679e8-33c2-4923-af9c-e770c00317ec';
  DELETE FROM manual_payment_entries WHERE id = '4bc884e2-e30a-407c-a715-7d9bca2f1628';
  ```
- **Post-fix:** MMT May 2026 outstanding corrected. INV1988260167 outstanding = +₹17.78 (single remaining OTA deduction via mmt_invoice).
- Also resolved in bugs.md.

## [2026-07-19] MRR-4 — Add `pending_invoices` to month detail RPC (`mrr_rpc_pending_invoices`) — COMPLETED
- Migration `mrr_rpc_pending_invoices` applied via Supabase MCP. `CREATE OR REPLACE` on `rpc_get_reconciliation_month_detail` only.
- **Changes to the RPC:**
  1. `inv` CTE: added `invoice_number`, `guest_name`, `departure_time::date AS checkout_date`, `reconciliation_status` columns (previously only numeric aggregates were projected).
  2. `inv_ext` CTE: propagated all four new columns.
  3. New `pending_inv` CTE:
     ```sql
     pending_inv AS (
       SELECT id, invoice_number, guest_name, checkout_date,
              src_label AS source, grand_total, received,
              round(grand_total - ota_ded - received, 2) AS outstanding,
              reconciliation_status
       FROM inv_ext
       WHERE reconciliation_status IN ('unreconciled', 'partial')
     )
     ```
  4. Final `jsonb_build_object`: added `'pending_invoices', COALESCE((SELECT jsonb_agg(row_to_json(p) ORDER BY p.checkout_date, p.invoice_number) FROM pending_inv p), '[]'::jsonb)`.
- **Return shape addition:** `pending_invoices: PendingReconciliationInvoice[]` where each element has `{id, invoice_number, guest_name, checkout_date, source, grand_total, received, outstanding, reconciliation_status}`.
- Ordered by `checkout_date, invoice_number` ascending.
- Frontend type (`PendingReconciliationInvoice`) added to `frontend/src/lib/types.ts`; `ReconciliationMonthDetail` interface updated to include `pending_invoices`.
- Section 4 added to `reconciliation-detail-client.tsx` (hidden when `pending_invoices.length === 0`). See frontend-dev.md for UI details.

## Status
MRR-2 + MRR-D + MRR-4 DONE 2026-07-19 (mrr_rpc_include_unreconciled + direct data fix + mrr_rpc_pending_invoices). Idle. (Prev: MRR-1 DONE 2026-07-18.)

## [2026-07-18] MRR-1 — Monthly Reconciliation Report RPCs (`mrr_rpcs`) — COMPLETED
- Migration `mrr_rpcs` applied via Supabase MCP. Two read-only functions, no schema/table changes.
- Objects created (both `CREATE OR REPLACE`, so rollback = DROP):
  - `public.rpc_get_reconciliation_monthly_summary(p_date_from date, p_date_to date) RETURNS jsonb` — SECURITY DEFINER, owner postgres, `SET search_path=''`, admin-gated via `public.is_admin()` (raises `Not authorized`, SQLSTATE 42501), no audit. EXECUTE revoked from PUBLIC/anon, granted to `authenticated`. Returns JSON array ordered `invoice_month DESC`, one element per calendar month of `hotel_invoice.departure_time`.
  - `public.rpc_get_reconciliation_month_detail(p_month_start date) RETURNS jsonb` — same security profile. Returns `{summary, booking_type_breakdown[], payment_timing[]}` for one month.
- **Key implementation facts (for whoever maintains these):**
  - All table refs schema-qualified (`public.`) because `search_path=''`. `date_trunc`/`extract`/`round`/`to_char`/`jsonb_build_object` resolve from pg_catalog.
  - `mmt_invoice` has 49 booking_ids with >1 row (multi-room). Pre-aggregated by `booking_id` (CTE `mi_agg`) BEFORE joining to `mmt_bookings_payout` to avoid deduction fan-out. Verified `reconciled_link_id` is unique (0 dupes) in mmt/yatra/agoda payout tables, so those back-pointer joins do not fan out.
  - OTA deduction attribution chain: `payout.reconciled_link_id = reconciliation_links.id` → `reconciliation_links.invoice_id`. MMT/Goibibo deductions from `mmt_invoice` (go_mmt_commission, gst_on_commission, tds, tcs); Yatra `= yatra_commission_with_gst - gst` as commission, `gst` as gst_on_commission, tds, tcs; Agoda `commission`, `tds_withholding_tax` as tds. Manual write-offs = reconciliation_links `payment_method IN ('commission','tds')`. MDR = `card_transactions.gross_amount * mdr_percent / 100` (NULL-safe).
  - Received channel classification is a single mutually-exclusive CASE. `mmt`/`goibibo` require `payment_method='mmt_payout'` AND `brand ILIKE`; MMT settlements that arrive as `bank_transfer` links land in the bank_transfer channel (their deductions still attach via the mbp back-pointer). In current data `received.mmt`/`goibibo` are mostly 0 for that reason — expected, not a bug.
  - `source_id` is already `uuid` — joined directly (no `::uuid` cast needed despite spec text).
  - Booking-type source labels (detail RPC): custom CASE on `hotel_invoice.source` → MakeMyTrip / Goibibo / Yatra(+Desiya) / Agoda / Walk-in / Phone / Other. Splits MMT vs Goibibo (which `fn_classify_invoice_source` collapses to `mmt`).
  - Payment-timing bucket offset uses `(yr*12+mon)` month arithmetic. `pay_date IS NULL` or `mo<=0` → `same_month` (prepaid/undated folded into same-month bucket). 5 rows always emitted.
- Smoke (as admin via `set_config('request.jwt.claim.sub', <admin uid>, false)`):
  1. `rpc_get_reconciliation_monthly_summary('2026-01-01','2026-07-01')` → 4 months (Apr–Jul 2026), DESC. `outstanding = gross_billed − received.total − deductions.total` holds for every row. PASS.
  2. `rpc_get_reconciliation_month_detail('2026-06-01')` → all 3 sections, TOTAL row present, summary matches RPC1 June. **After the `mrr_pending_formula_fix` migration (see below), payment_timing sums to net_receivable exactly (₹856,674.82) and pct totals 100.0 — acceptance #2 PASS.**
  3. Advisors: MRR-1 adds NO new ERROR. My functions appear only as `authenticated_security_definer_function_executable` WARN (the shared project pattern) and are absent from the `anon_*` list (anon EXECUTE revoked). ERROR total is 28 = 15 rls_disabled_in_public + 11 policy_exists_rls_disabled + 1 sensitive_columns_exposed + 1 `security_definer_view` (`v_invoice_list_with_issue` — a pre-existing VIEW I did not create; not from MRR-1). PASS.
  4. Operator / non-admin session → `Not authorized`. PASS.
- **Decisions (all resolved by team-lead 2026-07-18):**
  - **Role gate = `is_admin()`** (admin-only) — CONFIRMED (user confirmed admin-only explicitly). PRD §14D.6 prose says `is_operator_or_admin()` but that's an internal PRD contradiction that was overruled; §14D.3 / brief / execution.md win. No change.
  - **Payment-timing "pending" — RESOLVED via follow-up migration `mrr_pending_formula_fix`.** Original spec pinned pending to `gross − Σ all amount_applied`, but OTA commission/TDS/TCS and MDR are *computed* deductions (not reconciliation_links), so that formula overshot net_receivable by the OTA+MDR total (₹13,106.20 for Jun 2026). Team-lead chose option (a): **`pending = net_receivable − Σ period_bucket_amounts`.** Now the payment_timing table sums exactly to net_receivable and pct sums to 100. This changed only `rpc_get_reconciliation_month_detail` (the monthly summary RPC was untouched — it never had this issue).
  - **Negative values: NOT clamped** — CONFIRMED. Show actual values (negative TDS, Agoda negative total_deductions, Walk-in negative outstanding from MDR-on-fully-received) as data signals for the admin.

### [2026-07-18] MRR-1 follow-up — `mrr_pending_formula_fix` migration
- `CREATE OR REPLACE` of `public.rpc_get_reconciliation_month_detail(date)` only. Changed the `timing_rows` pending row from `total_billed − Σ all_applied` to `(total_billed − total_deductions) − Σ timing_agg.amount`. Removed the now-unused `all_applied` CTE. Security profile, signature, grants unchanged.
- Re-verified: `rpc_get_reconciliation_month_detail('2026-06-01')` → payment_timing sums to net_receivable ₹856,674.82 exactly; pct sum = 100.0; pending = ₹36,794.58.

- Rollback (drops both functions; the pending-formula fix has no separate rollback since it's a REPLACE — dropping the function removes it entirely):
  ```sql
  DROP FUNCTION IF EXISTS public.rpc_get_reconciliation_month_detail(date);
  DROP FUNCTION IF EXISTS public.rpc_get_reconciliation_monthly_summary(date, date);
  ```

## [2026-06-20 16:45] BUG-002 — manual_payment_entries.admin_flags NOT NULL DEFAULT '[]'::jsonb — COMPLETED
- Migration `fix_mpe_admin_flags_default` applied via Supabase MCP (PRD § 14A.5). Fixes MPE-1 deviation where `admin_flags` was created nullable with no default.
- Pre-state (information_schema): `admin_flags` jsonb, is_nullable=YES, column_default=NULL. **0 rows had NULL admin_flags** — backfill UPDATE was a safe no-op but kept in the migration for correctness/idempotency.
- Migration body (single tx): (1) `UPDATE ... SET admin_flags='[]'::jsonb WHERE admin_flags IS NULL;` (2) `ALTER COLUMN admin_flags SET DEFAULT '[]'::jsonb, SET NOT NULL;`
- Post-state verified (information_schema): is_nullable=**NO**, column_default=**`'[]'::jsonb`**. PASS.
- Rollback:
  ```sql
  ALTER TABLE public.manual_payment_entries
    ALTER COLUMN admin_flags DROP NOT NULL,
    ALTER COLUMN admin_flags DROP DEFAULT;
  -- (backfilled rows are indistinguishable from genuine '[]'::jsonb; no data restore needed)
  ```

## [2026-06-20 16:30] DUP-1 — Dedup hotel_invoice + UNIQUE(invoice_number) — COMPLETED
- Migration `dup_hotel_invoice_unique_constraint` applied atomically via Supabase MCP (single migration = one tx).
- Background: an earlier run found **8** duplicate `invoice_number` pairs (not 4), blocked, rolled back. This run re-confirmed all ids fresh, then deduped.
- **Pre-flight findings (key — deviated from task brief assumptions):**
  - 8 dup pairs: INV1988260204/215/216/230/283/284/285/286. Each has one "keeper" (has reconciliation_links + consumed payment_entries) and one zero-link "orphan" — EXCEPT INV1988260283 where BOTH rows were zero-link.
  - Keeper is NOT always the earlier `created_at` row. For 204 the earlier row is the keeper; for 215/216/230 the LATER row is the keeper. The orphan set was identified by **zero links**, not by timestamp.
  - INV1988260283 (both zero-link): keeper = earlier `55203eed…` (user decision), orphan = `77e93590…`.
  - **All 8 orphans each had exactly 1 OPEN issue report.** Plus the 283 keeper `55203eed` already had its OWN open report (`5dfc9159`, payment_not_received). The other 7 keepers had zero reports.
- **Orphan → keeper re-parent map (issue report id in parens):**
  - 38a7bdf1 (45f5886b) → a8e93c2d  [204]
  - a74d6958 (66609580) → 78e862f7  [215]
  - fb7e3faf (71ca1a92) → 39c7af07  [216]
  - 66ce5006 (c564adf4) → 061fd1de  [230]
  - 77e93590 (938bef37) → 55203eed  [283]
  - ce6de73b (cc425a29) → 6db28ecc  [284]
  - 86e5219a (7952fd55) → 110f00cd  [285]
  - 1545774d (ebf35de9) → 7f43a878  [286]
- **What happened to each issue report (audit trail preserved — recommended option):** all 8 orphan reports were UPDATEd to point at their keeper sibling and set `status='resolved_by_admin'`, `resolved_at=now()`. None deleted.
  - **Deviation from task pseudo-SQL:** brief used `status='resolved'`, which is NOT a valid value. `invoice_issue_reports_status_chk` allows `{open, resolved_by_admin, resolved_by_reconciliation, withdrawn_by_operator}`. Used `resolved_by_admin` (this is an admin dedup, not a reconciliation auto-resolve). `resolved_by` left NULL — system migration has no specific admin actor uuid; column is nullable; fabricating an auth.users id would be wrong.
  - **Why resolve (not leave open):** the keeper for 283 already had an open report. Re-parenting the orphan's report while leaving it `open` would give 283 two open reports → violates partial unique index `uq_invoice_issue_reports_one_open_per_invoice (invoice_id) WHERE status='open'`. Resolving the moved report avoids the collision. The 283 keeper retains its own single OPEN report.
- In-tx guards before constraint add: (A) no keeper has >1 open report post-reparent; (B) no orphan retains ANY referencing row across all 6 FK tables (reconciliation_links, invoice_issue_reports, manual_payment_entries, payment_entries.consumed_for_invoice_id, approval_requests.target_invoice_id, discrepancies.invoice_id); (C) 0 orphans remain after delete; (D) 0 duplicate invoice_numbers remain. Then `ADD CONSTRAINT hotel_invoice_invoice_number_unique UNIQUE (invoice_number)`.
- **Acceptance (all PASS):**
  1. 8 orphan ids gone (count 0).
  2. 0 duplicate invoice_numbers (341 rows total).
  3. UNIQUE constraint `hotel_invoice_invoice_number_unique` present.
  4. 8 re-parented reports survive with `status='resolved_by_admin'` + `resolved_at` set; 283 keeper still has its own 1 open report.
  5. Duplicate clone-insert (rolled back in a DO block) raised `unique_violation`. (Note: minimal inserts hit other NOT NULL columns first — file_id/guest_name/etc; tested by cloning a full existing row with a fresh PK so invoice_number was the only collision.)
  6. Advisors: 27 ERRORs — identical to CDW-1 baseline (rls_disabled_in_public ×15, policy_exists_rls_disabled ×11, sensitive_columns_exposed ×1). No new ERROR. The 2 hotel_invoice ERRORs are pre-existing RLS-disabled lints, untouched by DUP-1.
- **Rollback** (note: deleted orphan rows + their pre-reparent linkage are NOT auto-restorable; drop constraint + un-resolve reports below; full row restore needs PITR/backup if ever required):
  ```sql
  ALTER TABLE public.hotel_invoice DROP CONSTRAINT hotel_invoice_invoice_number_unique;
  -- Optionally revert the 8 re-parented reports to OPEN on their keeper (cannot restore deleted orphan parent rows):
  UPDATE invoice_issue_reports SET status='open', resolved_at=NULL
    WHERE id IN ('45f5886b-b794-4cd1-88ac-a5d19e9b4d3c','66609580-c1a1-49ff-84bf-fd87a610b00e',
      '71ca1a92-8433-4ceb-b040-8d26c73a5863','c564adf4-fd1f-4b54-a2aa-d177c169ffa1',
      '938bef37-0058-4aec-acab-2c9bbd8614f5','cc425a29-3dba-4ac4-a2f6-bdfcc6d190cf',
      '7952fd55-b631-4d19-a980-46db282b70f5','ebf35de9-8714-4296-8c08-0975d4917791');
  -- WARNING: do not run the UPDATE above as-is if a keeper already has an open report
  -- (would violate uq_invoice_issue_reports_one_open_per_invoice) — e.g. 55203eed/938bef37.
  ```

## Notes for Product Manager (DUP-1)
- `hotel_invoice.invoice_number` is now UNIQUE — the OCR/ingest pipeline can no longer insert a second row for the same invoice number. Any ingest path that blindly re-inserts must switch to UPSERT or pre-check. Flag to backend if the duplicate rows came from a re-run of extraction.
- Duplicates were caused by re-ingestion creating a second row that picked up NO reconciliation links; the originally-linked row was kept. The 8 "duplicate_booking" issue reports operators had filed against the orphan copies are now marked `resolved_by_admin` and moved onto the surviving invoice — operators will see them as resolved history on the correct invoice.
- INV1988260283 had two un-reconciled copies and two separate open reports; per your decision we kept the earlier copy and its own open report (`payment_not_received`) remains OPEN for follow-up. The duplicate_booking report from the deleted copy is now resolved on the keeper.
- Deleted orphan rows are gone (no soft-delete); restoring them would require PITR. The keepers retain all reconciliation/payment linkage, so reconciliation state is intact.

## [2026-06-20 16:15] CDW-1 — Commission & TDS Write-off schema — COMPLETED
- Migration `cdw_schema` applied via Supabase MCP. Extends MPE-1 objects (single combined MPE/DUP/CDW release).
- Changes:
  1. Added `party_name TEXT NULL` + `note TEXT NULL` to `public.manual_payment_entries` (submitter free-text per PRD § 14C.5). Used `ADD COLUMN IF NOT EXISTS`.
  2. Extended `manual_payment_entries_payment_type_check`: dropped + re-added. Final: `payment_type IN ('upi','another_machine','commission','tds')`. The separate `upi_fields_required` conditional CHECK is untouched (commission/tds rows leave UPI columns NULL, which the `payment_type <> 'upi'` branch already permits).
  3. Extended `reconciliation_links_payment_method_check`: dropped + re-added with all existing values PLUS `'commission'`,`'tds'`. Final: `{upi, card, bank_transfer, cash, mmt_payout, corporate_credit, commission, tds}`.
  4. `reconciliation_links_source_table_check` already included `'manual_payment_entries'` (added by MPE-1) — verified pre-flight, NO change made. Final unchanged: `{upi_transactions, card_transactions, bank_statement, cash_payments, manual_payment_entries}`.
- Acceptance (all PASS, behavioral inserts inside a rolled-back DO block):
  1. `party_name` + `note` columns present (both TEXT, nullable).
  2. `payment_type` accepts `commission` + `tds`; rejects `garbage` (caught `check_violation`).
  3. `reconciliation_links` rows with `payment_method='commission'` and `'tds'` + `source_table='manual_payment_entries'` insert without CHECK violation (created_by FK satisfied with a user_profiles id). 0 leftover rows confirmed afterward.
  4. Advisors: no new ERRORs. 27 ERRORs total — identical pre-existing baseline (`rls_disabled_in_public` ×15, `policy_exists_rls_disabled` ×11, `sensitive_columns_exposed` ×1). None reference manual_payment_entries / reconciliation_links / the new columns. WARN count 76 (baseline).
- Rollback:
  ```sql
  ALTER TABLE public.reconciliation_links DROP CONSTRAINT reconciliation_links_payment_method_check;
  ALTER TABLE public.reconciliation_links ADD CONSTRAINT reconciliation_links_payment_method_check
    CHECK (payment_method = ANY (ARRAY['upi','card','bank_transfer','cash','mmt_payout','corporate_credit']));
  ALTER TABLE public.manual_payment_entries DROP CONSTRAINT manual_payment_entries_payment_type_check;
  ALTER TABLE public.manual_payment_entries ADD CONSTRAINT manual_payment_entries_payment_type_check
    CHECK (payment_type = ANY (ARRAY['upi','another_machine']));
  ALTER TABLE public.manual_payment_entries DROP COLUMN IF EXISTS note;
  ALTER TABLE public.manual_payment_entries DROP COLUMN IF EXISTS party_name;
  -- source_table CHECK left as-is (owned by MPE-1 rollback).
  ```

## Notes for Product Manager (CDW-1)
- Backend CDW-2 (`cdw_rpcs`) is unblocked: `payment_method='commission'|'tds'` links and `payment_type='commission'|'tds'` entries can now be written. The write-off link path mirrors MPE-2's another-machine path (`source_table='manual_payment_entries'`, `source_id=entry.id`, no source-remaining lock).
- Deviation note: `reconciliation_links.created_by` is NOT NULL (references `user_profiles`). CDW-2's approve RPC must set it (the SECURITY DEFINER RPC supplies the actor) — same as every other reconcile RPC. Not a CDW concern but flagged since the bare acceptance insert needed it.
- No `used` immutability trigger added (consistent with MPE-1; lifecycle is via `status`).

## [2026-06-20] MPE-1 — Manual Payment Entries schema — COMPLETED
- Migration `mpe_schema` applied successfully via Supabase MCP.
- New objects:
  - Table `public.manual_payment_entries` — PK uuid `id` (gen_random_uuid). 18 columns.
    - FKs: `invoice_id` → hotel_invoice(id) NOT NULL; `submitted_by` → auth.users(id) NOT NULL; `reviewed_by` → auth.users(id); `card_settlement_id` → card_settlement(id); `upi_transaction_ref` → upi_transactions(id); `reconciliation_link_ref` → reconciliation_links(id) ON DELETE SET NULL.
    - CHECKs: `payment_type IN ('upi','another_machine')`; `status IN ('pending','approved','rejected')` default 'pending'; `amount > 0`; `upi_fields_required` (payment_type='upi' requires settlement_date + vpa + upi_transaction_id all NOT NULL).
    - Timestamps: `submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `reviewed_at TIMESTAMPTZ`. `transaction_date DATE NOT NULL`, `settlement_date DATE`.
  - 4 indexes: `idx_mpe_invoice_id`(invoice_id), `idx_mpe_status_pending`(status) WHERE status='pending', `idx_mpe_submitted_by`(submitted_by), `idx_mpe_settlement_date`(settlement_date) WHERE payment_type='upi'.
  - RLS enabled. Policy `mpe_select` FOR SELECT USING `submitted_by = auth.uid() OR is_admin()`. INSERT/UPDATE/DELETE revoked from `authenticated`.
  - Extended `reconciliation_links_source_table_check`: dropped + recreated to add `'manual_payment_entries'`. Final allowed list: `{upi_transactions, card_transactions, bank_statement, cash_payments, manual_payment_entries}`.
- Acceptance (all PASS):
  1. 18 columns present (id, invoice_id, payment_type, status, submitted_by, reviewed_by, submitted_at, reviewed_at, amount, transaction_date, settlement_date, vpa, upi_transaction_id, card_settlement_id, admin_flags, rejection_reason, upi_transaction_ref, reconciliation_link_ref).
  2. RLS enabled (rowsecurity = true).
  3. Insert of `source_table='manual_payment_entries'` into reconciliation_links succeeded inside a rolled-back DO block; 0 leftover rows; new CHECK def confirmed with all 5 values.
  4. Advisors: no new ERRORs. The 27 ERROR security lints are all pre-existing baseline (OCR pipeline tables w/ RLS disabled). None reference manual_payment_entries. Performance: new MPE entries are only INFO (unused index x4, unindexed nullable secondary FKs x4) + 1 WARN `auth_rls_initplan` on `mpe_select` — same pattern as every other table; matches task spec which used bare `auth.uid()`.
- Rollback:
  ```sql
  ALTER TABLE public.reconciliation_links DROP CONSTRAINT reconciliation_links_source_table_check;
  ALTER TABLE public.reconciliation_links ADD CONSTRAINT reconciliation_links_source_table_check
    CHECK (source_table = ANY (ARRAY['upi_transactions','card_transactions','bank_statement','cash_payments']));
  DROP TABLE IF EXISTS public.manual_payment_entries;  -- drops table, indexes, policy together
  ```

## Notes for Product Manager (MPE-1)
- `manual_payment_entries` allows operators to submit manual UPI / another-machine card payments for admin review (pending → approved/rejected). RLS lets an operator see only their own submissions; admins see all.
- Mutations are revoked from `authenticated` — inserts/approvals/rejections must go through SECURITY DEFINER RPCs (not yet built; presumably MPE-2 backend work). The `business rule "used = true must not be modifiable"` is not yet enforced at DB level for this table; there is no `used` flag here — the lifecycle is via `status` + `reconciliation_link_ref`. Flag if an immutability trigger is required.
- 4 nullable secondary FKs (reviewed_by, card_settlement_id, upi_transaction_ref, reconciliation_link_ref) are unindexed by design (not in task's index list). Add covering indexes later if these become hot join/filter columns.

## [2026-05-23] PF-1 — COMPLETED
- Migration `pf_payment_folio_schema` applied. Advisors: no new errors related to PF-1 objects (baseline pre-existing `policy_exists_rls_disabled` items unchanged).
- New objects:
  - Table `public.payment_folio_uploads` — PK uuid id, FK uploaded_by → user_profiles, RLS enabled. Policy: admin OR self. INSERT/UPDATE/DELETE revoked from authenticated + anon. 2 indexes (uploaded_by, uploaded_at DESC).
  - Table `public.payment_entries` — PK uuid id, FK upload_id → payment_folio_uploads (CASCADE), FK consumed_for_invoice_id → hotel_invoice (SET NULL), FK consumed_link_id → reconciliation_links (SET NULL). RLS enabled. SELECT TO authenticated USING (true). INSERT/UPDATE/DELETE revoked from authenticated + anon.
  - Unique index `uq_payment_entries_dedup` on `(COALESCE(booking_id,''), payment_type_raw, received_date, COALESCE(reference_text,''), payment_amount, COALESCE(invoice_number_raw,''))` — enforces FR-099 duplicate-skip rule with NULL canonicalisation.
  - 4 supporting indexes: booking_id (partial), invoice_number_raw (partial), unconsumed (partial), consumed_link (partial), upload_id.
  - CHECK constraint extensions on `reconciliation_links.payment_method` and `payment_source_config.payment_method` — both now accept `corporate_credit`. Final allowed list: `{upi, card, bank_transfer, cash, mmt_payout, corporate_credit}`.
  - Helper `fn_consume_payment_entry(p_invoice_id uuid, p_link_id uuid) RETURNS int` — SECURITY DEFINER, owned by postgres, EXECUTE revoked from anon/authenticated/PUBLIC. Resolves invoice booking_id + invoice_number, canonicalises empty strings → NULL, then `FOR UPDATE` loops `payment_entries` rows whose `booking_id` matches OR `invoice_number_raw` matches AND `consumed_for_invoice_id IS NULL`. Marks each consumed. Writes one `payment_entry_consumed` audit row per affected via `fn_write_audit`. Returns count.
  - Trigger `trg_payment_entries_clear_consumed_on_link_delete` AFTER DELETE on `reconciliation_links` → `fn_payment_entries_clear_consumed_on_link_delete()` clears `consumed_for_invoice_id`, `consumed_at`, `consumed_link_id` on any `payment_entries` row whose `consumed_link_id = OLD.id`. Writes one `payment_entry_unconsumed` audit row per affected.
- Rollback:
  ```sql
  DROP TRIGGER IF EXISTS trg_payment_entries_clear_consumed_on_link_delete ON public.reconciliation_links;
  DROP FUNCTION IF EXISTS public.fn_payment_entries_clear_consumed_on_link_delete();
  DROP FUNCTION IF EXISTS public.fn_consume_payment_entry(uuid, uuid);
  ALTER TABLE public.payment_source_config DROP CONSTRAINT payment_source_config_payment_method_check;
  ALTER TABLE public.payment_source_config ADD CONSTRAINT payment_source_config_payment_method_check
    CHECK (payment_method = ANY (ARRAY['upi','card','bank_transfer','cash','mmt_payout']));
  ALTER TABLE public.reconciliation_links DROP CONSTRAINT reconciliation_links_payment_method_check;
  ALTER TABLE public.reconciliation_links ADD CONSTRAINT reconciliation_links_payment_method_check
    CHECK (payment_method = ANY (ARRAY['upi','card','bank_transfer','cash','mmt_payout']));
  DROP TABLE IF EXISTS public.payment_entries;
  DROP TABLE IF EXISTS public.payment_folio_uploads;
  ```

## Inbound Task — PF-1 (Payment Folio schema + corporate_credit + consume helper + reverse-consume trigger) [DONE — applied directly by PM via Supabase MCP]
- Issued by PM: 2026-05-23
- Spec: `prd.md` § "Addendum — Payment Folio Upload + Auto-select + Resolve Guard (2026-05-23)" — FR-099, FR-100, FR-101.
- Migration name: `pf_payment_folio_schema`.
- Acceptance:
  1. `public.payment_entries` + `public.payment_folio_uploads` tables exist with the exact DDL in FR-099 / FR-100. ✅
  2. Unique index `uq_payment_entries_dedup` on the 6-tuple expression. ✅
  3. RLS enabled. Mutations revoked from authenticated + anon. ✅
  4. CHECK constraints on `reconciliation_links.payment_method` and `payment_source_config.payment_method` accept `corporate_credit`. ✅
  5. `fn_consume_payment_entry(uuid, uuid)` exists, SECURITY DEFINER, owned by postgres, EXECUTE revoked from anon/authenticated/PUBLIC. Writes `payment_entry_consumed` audit row per affected. ✅
  6. AFTER DELETE trigger on `reconciliation_links` clears consumed fields and writes `payment_entry_unconsumed` audit row per affected. ✅
  7. `mcp__supabase__get_advisors` shows no new errors. ✅
- Coordination: backend-dev PF-2 is unblocked.
- Return: COMPLETED / MIGRATIONS / RLS / ROLLBACK / CONTEXT UPDATED.

## Last Tasks Completed
- A1 Create new tables (`20260517080412_v1_reconciliation_core_tables`)
- A2 Seed `payment_source_config` (`20260517080513_v1_seed_payment_source_config`)
- A4 RLS policies on all tables (`v1_rls_policies`)
- A5 Audit helper function (`20260517080519_v1_audit_helper_function`)
- B1 `v_transactions_with_remaining` view (`20260517080532_v1_transactions_with_remaining_view`, hardened in `v1_security_hardening`)
- Security hardening (`v1_security_hardening`)
- MMT-1 `mmt_payouts_and_bookings_payout_tables` — new pipeline tables for MMT payout JSON ingestion. `mmt_payouts.transaction_no` is PK; `mmt_bookings_payout` has `UNIQUE(transaction_no, booking_id)` and FK to `mmt_payouts(transaction_no)` on delete cascade. RLS explicitly disabled. Indexes on (file_id), (transaction_date), (subject_ref), (booking_id), (transaction_no), (check_in), (check_out).
- [2026-05-19] `v1_drilldown_add_mmt_reconciled_fields` — `CREATE OR REPLACE` of `public.rpc_get_bank_statement_drilldown(uuid,text)`. The `mmt_payout` branch now also emits `reconciled_at` and `reconciled_link_id` in each row of the returned JSONB. No schema (column/table) changes; signature, security, and search_path unchanged. Rollback: re-run `CREATE OR REPLACE FUNCTION` with the pre-change `jsonb_build_object` (omit the two new keys).

## Schema State (canonical V1)
- New tables: `user_profiles`, `cash_payments`, `reconciliation_links`, `approval_requests`, `discrepancies`, `payment_source_config`, `audit_log`
- `hotel_invoice.reconciliation_status` text column added (values: `unreconciled` | `partial` | `fully_reconciled` | `flagged_for_review`)
- `v_transactions_with_remaining` is `security_invoker = true` so RLS on base tables applies

## RLS Strategy
- All 17 tables have RLS enabled
- Helpers: `current_user_role()`, `is_admin()`, `is_operator_or_admin()` (SECURITY DEFINER, anon revoked)
- Both roles can SELECT invoice/transaction/audit data
- `approval_requests`/`discrepancies`: operator sees their own; admin sees all
- All sensitive INSERT/UPDATE/DELETE revoked from `authenticated`; mutations only via SECURITY DEFINER RPCs

## Audit Log
- Append-only enforced by trigger `audit_log_block_mutation` (BEFORE UPDATE/DELETE raises exception)
- INSERT also revoked from authenticated at table level; only SECURITY DEFINER RPCs (owned by postgres) can insert

## Open Items
- Performance lints (unindexed FK on `decided_by`/`requested_by`, RLS `auth.uid()` not wrapped in `(select …)`) are nice-to-have for scale; not blocking V1.
- No local `supabase/migrations/` directory in the repo; all migrations applied via MCP server.

## [2026-05-23] RI-1 — COMPLETED
- Migration: `v1_invoice_issue_reports` applied.
- New objects:
  - Table `public.invoice_issue_reports` (PK uuid id, FK invoice_id → hotel_invoice ON DELETE CASCADE, FK reported_by/resolved_by → auth.users).
  - CHECK constraints: `invoice_issue_reports_status_chk` (4 values), `invoice_issue_reports_category_chk` (18 codes per FR-089).
  - Partial unique index `uq_invoice_issue_reports_one_open_per_invoice` on `(invoice_id) WHERE status='open'`.
  - 3 regular indexes (status, invoice, reported_by).
  - Trigger `trg_invoice_issue_reports_set_updated_at` + function `fn_invoice_issue_reports_set_updated_at` (BEFORE UPDATE, SECURITY DEFINER, EXECUTE revoked).
  - RLS enabled. Policy `invoice_issue_reports_select` for `authenticated`: `reported_by = (select auth.uid()) OR is_admin()`.
  - INSERT/UPDATE/DELETE revoked from anon + authenticated. SELECT granted to authenticated.
  - Helper `fn_auto_resolve_issue_reports(p_invoice_id uuid, p_actor uuid) RETURNS int` — SECURITY DEFINER, owned by postgres, EXECUTE revoked from anon/authenticated. Writes one `issue_report_auto_resolved` audit row per affected row via `fn_write_audit`.
- Advisors: no new errors / warnings introduced. Existing baseline unchanged (same pre-existing items as 2026-05-19).
- Rollback:
  ```sql
  DROP FUNCTION IF EXISTS public.fn_auto_resolve_issue_reports(uuid, uuid);
  DROP TRIGGER IF EXISTS trg_invoice_issue_reports_set_updated_at ON public.invoice_issue_reports;
  DROP FUNCTION IF EXISTS public.fn_invoice_issue_reports_set_updated_at();
  DROP TABLE IF EXISTS public.invoice_issue_reports;
  ```

## Inbound Task — RI-1 (Report an Issue: schema + RLS + auto-resolve helper) [DONE]
- Issued by PM: 2026-05-23
- Spec: see `prd.md` § "Addendum — Report an Issue (2026-05-23)" — FR-090, FR-094.
- Migration name: `v1_invoice_issue_reports`.
- Acceptance:
  1. `public.invoice_issue_reports` table exists with the exact DDL in FR-090. CHECK constraint on `category` lists ALL FR-089 codes verbatim. Partial unique index `uq_invoice_issue_reports_one_open_per_invoice` on `(invoice_id) WHERE status='open'`.
  2. RLS enabled. SELECT policy: `reported_by = auth.uid() OR is_admin()`. INSERT/UPDATE/DELETE revoked from `authenticated`.
  3. BEFORE UPDATE trigger maintains `updated_at`.
  4. Helper `fn_auto_resolve_issue_reports(p_invoice_id uuid, p_actor uuid)` exists, SECURITY DEFINER, owned by `postgres`, EXECUTE revoked from anon/authenticated. Marks every `open` row for the invoice → `resolved_by_reconciliation` with `resolved_at=now()`, `resolved_by=p_actor`. Writes one `issue_report_auto_resolved` audit row per affected row via `fn_write_audit`.
  5. `mcp__supabase__get_advisors` shows no new errors (existing patterns OK).
- Coordination: backend-dev RI-2 is blocked on this. Update your context file with the migration name and call out any deviations.
- Return: COMPLETED / MIGRATIONS / RLS / ROLLBACK / CONTEXT UPDATED.

## [2026-05-23 14:15] RI-3 — Configurable issue categories — COMPLETED
- Migrations applied:
  - `v1_issue_categories_configurable`
  - `v1_issue_categories_lock_function_grants` (follow-up: revoke EXECUTE from PUBLIC/anon on new functions)
- New objects:
  - Table `public.issue_categories` (PK uuid, UNIQUE code, applies_to TEXT[] CHECK subset of {all,mmt,yatra,agoda,walk_in}, code shape `^[a-z][a-z0-9_]*$`, is_active, sort_order, created_at/updated_at). RLS enabled. Policy `issue_categories_select` for `authenticated` USING `is_active OR current_user_role()='admin'`. INSERT/UPDATE/DELETE revoked from anon+authenticated (mutations only via SECURITY DEFINER RPCs).
  - Index `idx_issue_categories_is_active_sort`, plus PK + UNIQUE(code).
  - Trigger `trg_issue_categories_set_updated_at` + function `fn_issue_categories_set_updated_at` (SECURITY DEFINER, locked to postgres only).
- Seeded 18 categories (5 universal + 3 mmt + 3 yatra + 2 agoda + 4 walk_in + `other`).
- `invoice_issue_reports`:
  - Dropped `invoice_issue_reports_category_chk` (also handled `_check` defensively).
  - Added FK `fk_issue_reports_category` (category → issue_categories.code) ON UPDATE CASCADE ON DELETE RESTRICT.
  - Added `idx_invoice_issue_reports_category`.
- Function changes:
  - `fn_issue_category_allowed(p_category text, p_source text)` — dropped+recreated (signature arg renamed from `p_source_bucket` to `p_source`; reads applies_to from `issue_categories`; SECURITY DEFINER; EXECUTE for `authenticated`, PUBLIC/anon revoked). Existing caller `rpc_create_issue_report` passes positionally so unaffected.
  - **Deviation:** `fn_classify_invoice_source` updated to return `'walk_in'` (was `'walkin'`). Only `fn_issue_category_allowed` referenced the old literal, which is also rewritten here, so no other callers affected. This aligns with the FR vocabulary {mmt,yatra,agoda,walk_in}.
  - New admin RPCs:
    - `rpc_upsert_issue_category(p_id uuid, p_code text, p_label text, p_applies_to text[], p_is_active boolean, p_sort_order integer) RETURNS uuid` — admin-only via `user_profiles.role='admin'`. Validates code regex, label non-empty, applies_to non-empty and subset of {all,mmt,yatra,agoda,walk_in}. Blocks deactivation if category has open reports (raises `CATEGORY_HAS_OPEN_REPORTS`). Returns new UUID on insert, p_id on update.
    - `rpc_delete_issue_category(p_id uuid) RETURNS void` — admin-only. Raises `CATEGORY_IN_USE` if any `invoice_issue_reports` row references the category.
  - All new SECURITY DEFINER functions: PUBLIC/anon revoked, `authenticated` granted (admin gate inside).
- Verification (all PASS): 18 rows seeded; FK present; old CHECK dropped; updated_at trigger present; RLS enabled; select policy present; `fn_issue_category_allowed('amount_mismatch','walk_in')`=true; `('mmt_payout_missing','yatra')`=false; `('mmt_payout_missing','mmt')`=true.
- Advisors: new functions appear under `anon/authenticated_security_definer_function_executable` only for `authenticated` (matches project baseline for all RPCs). After the lockdown migration, anon no longer has EXECUTE on any new function. Two new "unused index" INFO entries (`idx_issue_categories_is_active_sort`, `idx_invoice_issue_reports_category`) — expected for freshly-created indexes.
- Rollback (apply in reverse order):
  ```sql
  -- 1. Drop new RPCs and lockdown migration is auto-reverted by dropping the functions
  DROP FUNCTION IF EXISTS public.rpc_delete_issue_category(uuid);
  DROP FUNCTION IF EXISTS public.rpc_upsert_issue_category(uuid, text, text, text[], boolean, integer);

  -- 2. Recreate the original fn_issue_category_allowed (hard-coded list, p_source_bucket arg)
  DROP FUNCTION IF EXISTS public.fn_issue_category_allowed(text, text);
  CREATE OR REPLACE FUNCTION public.fn_issue_category_allowed(p_category text, p_source_bucket text)
  RETURNS boolean LANGUAGE plpgsql IMMUTABLE
  SET search_path = 'public','pg_temp' AS $$
  BEGIN
    IF p_category IN ('amount_mismatch','guest_name_mismatch','dates_mismatch','payment_not_received','duplicate_booking','other') THEN RETURN TRUE; END IF;
    IF p_source_bucket = 'mmt'   AND p_category IN ('booking_not_found_in_mmt','mmt_payout_missing','mmt_commission_mismatch') THEN RETURN TRUE; END IF;
    IF p_source_bucket = 'yatra' AND p_category IN ('voucher_not_found_in_yatra','yatra_payout_missing','yatra_to_pay_amount_wrong') THEN RETURN TRUE; END IF;
    IF p_source_bucket = 'agoda' AND p_category IN ('agoda_booking_not_found','agoda_payout_missing') THEN RETURN TRUE; END IF;
    IF p_source_bucket = 'walkin' AND p_category IN ('cash_not_deposited','upi_txn_not_found','card_settlement_missing','bank_transfer_not_found') THEN RETURN TRUE; END IF;
    RETURN FALSE;
  END; $$;

  -- 3. Revert fn_classify_invoice_source to return 'walkin'
  CREATE OR REPLACE FUNCTION public.fn_classify_invoice_source(p_source text)
  RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = 'public','pg_temp' AS $$
  DECLARE v_s TEXT;
  BEGIN
    v_s := lower(coalesce(p_source,''));
    IF v_s = '' THEN RETURN 'walkin'; END IF;
    IF v_s LIKE '%mmt%' OR v_s LIKE '%goibibo%' OR v_s LIKE '%makemytrip%' THEN RETURN 'mmt'; END IF;
    IF v_s LIKE '%yatra%' OR v_s LIKE '%desiya%' THEN RETURN 'yatra'; END IF;
    IF v_s LIKE '%agoda%' THEN RETURN 'agoda'; END IF;
    IF v_s LIKE '%walk%' OR v_s LIKE '%direct%' THEN RETURN 'walkin'; END IF;
    RETURN 'walkin';
  END; $$;

  -- 4. Drop FK + index, then restore old CHECK
  DROP INDEX IF EXISTS public.idx_invoice_issue_reports_category;
  ALTER TABLE public.invoice_issue_reports DROP CONSTRAINT IF EXISTS fk_issue_reports_category;
  ALTER TABLE public.invoice_issue_reports
    ADD CONSTRAINT invoice_issue_reports_category_chk CHECK (category IN (
      'amount_mismatch','guest_name_mismatch','dates_mismatch','payment_not_received','duplicate_booking',
      'booking_not_found_in_mmt','mmt_payout_missing','mmt_commission_mismatch',
      'voucher_not_found_in_yatra','yatra_payout_missing','yatra_to_pay_amount_wrong',
      'agoda_booking_not_found','agoda_payout_missing',
      'cash_not_deposited','upi_txn_not_found','card_settlement_missing','bank_transfer_not_found',
      'other'));

  -- 5. Drop issue_categories table + trigger + trigger fn
  DROP TRIGGER IF EXISTS trg_issue_categories_set_updated_at ON public.issue_categories;
  DROP FUNCTION IF EXISTS public.fn_issue_categories_set_updated_at();
  DROP TABLE IF EXISTS public.issue_categories;
  ```

## Notes for Product Manager
- The applies_to vocabulary is now {all, mmt, yatra, agoda, walk_in} (underscore form). `fn_classify_invoice_source` now returns `walk_in` to match — previously returned `walkin`. Any UI / backend code that hard-coded `'walkin'` must be updated to `'walk_in'`. Currently only `fn_issue_category_allowed` referenced the old literal (already rewritten).
- Admin UI for category management can now call `rpc_upsert_issue_category` and `rpc_delete_issue_category`. Frontend should surface error codes `CATEGORY_HAS_OPEN_REPORTS` (on attempted deactivation) and `CATEGORY_IN_USE` (on attempted delete) as user-friendly messages.
- For category listing, the SELECT policy already filters inactive rows for non-admins. Admins see everything.

## [2026-05-23] Y7 — Yatra monthly deductions view — COMPLETED
- Migration applied: `y7_rewrite_v_yatra_monthly_deductions_v2`.
- Approach: **VIEW** (not RPC). `yatra_bookings_payout` has RLS disabled (pipeline table); a `security_invoker = true` VIEW is sufficient and respects any future RLS on the base table. The original spec offered an RPC fallback — not needed here.
- Pre-state: `v_yatra_monthly_deductions` already existed (legacy shape: grouped by `check_in` across ALL rows incl. unreconciled, columns `month, booking_count, total_room_charges, hotel_gross_charges, yatra_commission, yatra_commission_with_gst, gst_on_commission, tcs, tds, net_receivable`).
- DROP + CREATE was required because the first column rename (`month` → `month_start`) is rejected by `CREATE OR REPLACE VIEW`.
- New view definition:
  - Bucketed by `date_trunc('month', email_date)::date AS month_start`
  - Filter: `reconciled_at IS NOT NULL AND email_date IS NOT NULL`
  - Columns: `month_start (date), year (int), month (int), bookings_count (bigint), total_tariff_sum, yatra_commission_amt_sum, yatra_commission_with_gst_sum, tds_amt_sum, gst_on_commission_sum, tcs_amt_sum, yatra_to_pay_hotel_sum, other_charges_sum, hotel_gross_charges_sum` (all numeric, COALESCE'd to 0)
  - GRANT SELECT to `authenticated`
- **Deviations from Y7 task spec**:
  - **No `hotel_name` column** — `yatra_bookings_payout` is single-hotel; no `hotel_name` column exists.
  - **No `service_tax_sum` column** — `yatra_bookings_payout` has no `service_tax` column. Omitted entirely (frontend table doesn't list it either).
  - **Column mapping** — spec used `*_amt` field names that don't exist on base table; mapped to actual columns:
    - `yatra_commission_amt_sum` ← `SUM(yatra_commission)`
    - `tds_amt_sum` ← `SUM(tds)`
    - `gst_on_commission_sum` ← `SUM(gst)` (the base column is just `gst`)
    - `tcs_amt_sum` ← `SUM(tcs)`
    - `total_tariff_sum` ← `SUM(total_room_charges)` (closest analogue to "tariff")
- Verified: `SELECT * FROM v_yatra_monthly_deductions` returns the single reconciled row (1 of 8 yatra rows, Apr 2026 bucket).
- Advisors: no new entries reference `v_yatra_monthly_deductions`.
- Frontend changes (out of scope for DB manager but for record): `/admin/mis` now has 2-tab UI ("Monthly Summary" | "Yatra Deductions"). `YatraMonthlyDeduction` interface added to `frontend/src/lib/types.ts`. TypeScript check clean.
- Rollback:
  ```sql
  DROP VIEW IF EXISTS public.v_yatra_monthly_deductions;
  CREATE VIEW public.v_yatra_monthly_deductions AS
  SELECT date_trunc('month'::text, COALESCE(check_in, created_at::date)::timestamp with time zone) AS month,
    count(*) AS booking_count,
    COALESCE(sum(total_room_charges), 0::numeric) AS total_room_charges,
    COALESCE(sum(hotel_gross_charges), 0::numeric) AS hotel_gross_charges,
    COALESCE(sum(yatra_commission), 0::numeric) AS yatra_commission,
    COALESCE(sum(yatra_commission_with_gst), 0::numeric) AS yatra_commission_with_gst,
    COALESCE(sum(gst), 0::numeric) AS gst_on_commission,
    COALESCE(sum(tcs), 0::numeric) AS tcs,
    COALESCE(sum(tds), 0::numeric) AS tds,
    COALESCE(sum(yatra_to_pay_hotel), 0::numeric) AS net_receivable
  FROM yatra_bookings_payout
  GROUP BY date_trunc('month'::text, COALESCE(check_in, created_at::date)::timestamp with time zone)
  ORDER BY date_trunc('month'::text, COALESCE(check_in, created_at::date)::timestamp with time zone) DESC;
  ```

## Notes for Product Manager (Y7)
- The Yatra MIS section is filtered to **reconciled bookings only** and bucketed by `email_date` (the date Yatra emailed the booking, not check-in). This matches the Y7 task spec — confirm this is the intended semantic. Alternative would be bucketing by `check_in` like the legacy view did.
- `service_tax` and `hotel_name` were dropped from the spec because the columns don't exist on `yatra_bookings_payout`. The system appears to be single-hotel; if multi-hotel is on the roadmap, we'll need a `hotels` table and an FK on the payout tables.
- There is no `v_mmt_monthly_deductions` consumption in the frontend yet — the existing MMT view (created earlier) is currently unused. Future MIS tabs can adopt the same pattern as the new Yatra tab.

## Status
MRR-1 DONE 2026-07-18 (mrr_rpcs + mrr_pending_formula_fix — 2 read-only report RPCs; all 4 smoke checks PASS after team-lead confirmed pending = net_receivable − Σ periods). Idle. (Prev: BUG-002 DONE 2026-06-20 16:45; DUP-1 DONE 2026-06-20 16:30; CDW-1 DONE 2026-06-20 16:15; MPE-1 DONE 2026-06-20; Y7 DONE 2026-05-23.)
