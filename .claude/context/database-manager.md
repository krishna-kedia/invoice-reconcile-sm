# Database Manager Context
<!-- Last updated: 2026-05-23 (PF-1 applied) -->
<!-- Previous: 2026-05-23 14:15 -->

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
Y7 DONE 2026-05-23. Idle.
