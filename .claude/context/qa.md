# QA Context
<!-- Last updated: 2026-07-18 -->

## Test History

### [2026-07-18] MRR-4 — Monthly Reconciliation Report QA Sweep (9 checks)
All 9 PRD §14D checks run against built frontend code (no interactive browser run).

| # | Check | Verdict |
|---|---|---|
| 1 | Build (`npm run build`) exits 0, 20 routes; `tsc --noEmit` exits 0 with no errors | PASS |
| 2 | Middleware blocks `/reports/reconciliation*` for non-admin; `/reports/deductions` not blocked | PASS |
| 3 | `adminLinks` has both Reconciliation Report + Deductions; `operatorLinks` has Deductions only | PASS |
| 4 | Summary RPC call uses correct params; default range 12 months; detail `p_month_start` = `YYYY-MM-01` | PASS |
| 5 | All 6 required types present in `types.ts` | PASS |
| 6 | Two-row thead with correct colSpans; 9 Received sub-cols; 6 Deductions sub-cols; zero→dash; month link; totals row | PASS |
| 7 | 4 summary cards; outstanding amber/>0 green/≤0; booking table 8 cols + font-semibold TOTAL row; payment timing amber pending row; back link | PASS |
| 8 | Both pages handle all 4 UI states: loading (skeleton), empty, error (with retry), success | PASS |
| 9 | FR-135/FR-138 RPC-enforced; frontend adds no additional filtering or re-categorisation | PASS |

Verdict: **PASS** — all 9 checks pass.

---

### [2026-06-20 17:15] MPE-3 / CDW-3 — Manual Payment Entry + Commission/TDS RPCs
All 6 RPCs tested live against Supabase using `execute_sql` with operator JWT
(`6e50c4f5`) for submit and admin JWT (`45bcd1e5`) for approve/reject/admin-only reads.
Test data created and cleaned up (entries + links + upi_transactions deleted;
invoice statuses restored via `fn_recompute_invoice_status`).

#### Scenario results

| # | Scenario | Verdict |
|---|---|---|
| 1 | Valid UPI submit under bank credit tolerance | PASS |
| 2 | Missing settlement_date/vpa/upi_transaction_id → `MANUAL_UPI_FIELDS_REQUIRED` | PASS |
| 3 | Amount exceeds bank_credit × 1.01 → `MANUAL_UPI_EXCEEDS_BANK_CREDIT` | PASS |
| 4 | No bank credit for settlement_date → pending + `NO_BANK_CREDIT` flag | PASS |
| 5 | No upi_transactions for transaction_date → pending + `MPR_LINK_UNVERIFIED` flag | PASS |
| 6 | Valid another_machine submit → pending, no UPI fields required | PASS |
| 7 | Valid commission on OTA (Desiya/Yatra) invoice, amount ≤ gap → pending | PASS (BUG-001 now fixed) |
| 8 | Commission amount > remaining gap → `WRITEOFF_EXCEEDS_GAP` | PASS |
| 9 | Missing party_name for commission → `PARTY_REQUIRED` | PASS |
| 10 | Commission on Direct Walk-In → `WRITEOFF_SOURCE_NOT_ELIGIBLE` | PASS |
| 11 | TDS on Direct Walk-In invoice → pending (TDS allowed on walk-in per RPC) | PASS (BUG-003 resolved-by-design) |
| 12 | Missing party_name for TDS → `PARTY_REQUIRED` | PASS |
| 13 | Approve UPI entry (happy path): upi_transactions created, reconciliation_link created, invoice status recomputed, refs set | PASS |
| 14 | Approve when gap shrunk (commission → `WRITEOFF_EXCEEDS_GAP`, entry stays pending) | PASS |
| 15 | Approve already-approved entry → `ENTRY_NOT_PENDING` | PASS |
| 16 | Approve another_machine → `source_table='manual_payment_entries'`, no upi_transactions row | PASS |
| 16b | Approve UPI with MPR_LINK_UNVERIFIED (card_settlement_id=NULL) → fallback to `source_table='manual_payment_entries'`, no upi_transactions row | PASS |
| 17 | Reject with reason → rejected, reason stored, reviewed_by/at set | PASS |
| 18 | Reject without reason → `REASON_REQUIRED` | PASS |
| 19 | Reject already-rejected → `ENTRY_NOT_PENDING` | PASS |
| 20 | `rpc_get_manual_payment_entries(invoice_id)` → all entries, all statuses, ordered submitted_at DESC, includes submitter_email | PASS |
| 21 | `rpc_get_pending_manual_payments('pending')` → pending entries with invoice_number + guest_name + submitter_email | PASS |
| 22 | `rpc_get_deductions_report` → rows + party totals for approved commission/TDS | PASS |
| 23 | Audit log has manual_payment.submit, manual_payment.approve, manual_payment.reject entries | PASS |
| 24 | RLS policy `mpe_select` = `submitted_by = auth.uid() OR is_admin()` in place; operator sees own entries | PASS |
| - | Admin-only guard on approve/reject/pending-queue rejects operator with `Not authorized` | PASS |
| - | Unauthenticated call → `Not authenticated` | PASS |

Verdict: **PASS** — all critical paths pass including post-fix regression suite.

---

### [2026-06-20 17:45] BUG-001 + BUG-002 Regression + End-to-End Happy Path
Targeted regression suite after backend-dev fixed BUG-001 and database-manager fixed BUG-002.
BUG-003 resolved-by-design (PM confirmed TDS on walk-in is intentionally allowed).
All 11 targeted tests run live against Supabase. Test data cleaned up.

#### Test invoices used
- `11ec0ba1-cfdf-4d21-a30a-318d20f4f047` — `INV1988260057`, source=`AsiaTech`, grand_total=₹4,830, status=partial (₹4,659 linked pre-test)
- `11180aa3-043b-4208-82b6-c6621afa7196` — `INV1988260197`, source=`Direct - Walk-In`, grand_total=₹3,465, status=unreconciled

#### Results

| Test | Description | Expected | Actual | Verdict |
|---|---|---|---|---|
| 1 | `fn_classify_invoice_source('AsiaTech')` | NOT 'walk_in' | `'other'` | PASS |
| 2 | `fn_classify_invoice_source('Direct - Walk-In')` | `'walk_in'` | `'walk_in'` | PASS |
| 3 | `fn_classify_invoice_source('Direct - By Phone')` | `'phone'` | `'phone'` | PASS |
| 4 | Commission submit on AsiaTech invoice | `pending` (not WRITEOFF_SOURCE_NOT_ELIGIBLE) | `pending`, entry_id=`5c32c516` | PASS |
| 5 | TDS submit on Direct Walk-In invoice | `pending` (allowed) | `pending`, entry_id=`ab3e0088` | PASS |
| 6 | Commission submit on Direct Walk-In invoice | `WRITEOFF_SOURCE_NOT_ELIGIBLE` | raised `WRITEOFF_SOURCE_NOT_ELIGIBLE: Commission not allowed for walk-in or phone bookings` | PASS |
| 7 | `admin_flags` column schema | default=`'[]'::jsonb`, is_nullable=`NO` | column_default=`'[]'::jsonb`, is_nullable=`NO` | PASS |
| 8 | UPI submit with no matching bank/MPR → admin_flags NOT NULL | flags stored as jsonb array, never NULL | `is_null=false`, `json_type=array` for all 3 entries; commission/TDS entries store `[]`, UPI stores populated array | PASS |
| 9 | Commission on AsiaTech partial invoice → pending (same as test 4, confirmed pre-approve) | pending | pending | PASS |
| 10 | Approve AsiaTech commission → reconciliation_link with payment_method='commission', invoice status recomputed | link created, status stays partial (₹71 still outstanding) | link `3b0ca6f4` created, `source_table='manual_payment_entries'`, `payment_method='commission'`, `amount_applied=100`; invoice linked_total ₹4,659 → ₹4,759 (partial, correct) | PASS |
| 11 | `rpc_get_deductions_report` shows approved commission row | row with party/amount/source/invoice | `rows=[{amount:100, source:'AsiaTech', party_name:'QA-AsiaTech-Commission-Test', payment_type:'commission', invoice_number:'INV1988260057'}]`, `totals=[{total:100, party_name:'QA-AsiaTech-Commission-Test', payment_type:'commission'}]` | PASS |

**All 11 tests: PASS**

Cleanup: all 3 test entries deleted, reconciliation_link deleted, invoice statuses verified restored to pre-test values.

---

### [2026-06-20 18:30] MPE-7 + CDW-7 — Final QA Sweep (DB schema, RPCs, frontend, E2E, retroactive invoices)

Full sweep of 16 checks per the MPE-7/CDW-7 QA specification.

#### DB Checks

| # | Check | Expected | Actual | Verdict |
|---|---|---|---|---|
| 1 | `manual_payment_entries` table exists with all columns incl. `party_name`, `note`, `admin_flags NOT NULL DEFAULT '[]'` | All columns present | 20 columns confirmed: id, invoice_id, payment_type, status, submitted_by, reviewed_by, submitted_at, reviewed_at, amount, transaction_date, settlement_date, vpa, upi_transaction_id, card_settlement_id, admin_flags (NOT NULL, default `'[]'::jsonb`), rejection_reason, upi_transaction_ref, reconciliation_link_ref, party_name, note | PASS |
| 2 | `hotel_invoice_invoice_number_unique` UNIQUE constraint exists | constraint_type=UNIQUE | Confirmed present | PASS |
| 3 | `reconciliation_links.payment_method` CHECK includes 'commission' and 'tds' | CHECK includes 'commission','tds' | CHECK = `{upi, card, bank_transfer, cash, mmt_payout, corporate_credit, commission, tds}` | PASS |
| 4 | `reconciliation_links.source_table` CHECK includes 'manual_payment_entries' | CHECK includes 'manual_payment_entries' | CHECK = `{upi_transactions, card_transactions, bank_statement, cash_payments, manual_payment_entries}` | PASS |
| 5 | No duplicate invoice_numbers: `GROUP BY invoice_number HAVING count(*) > 1` | Zero rows | Zero rows returned | PASS |
| 6 | Three retroactive invoices are `partial` (pre-closure) | All three `partial` | INV1988260052=partial, INV1988260060=partial, INV1988260059=partial | PASS |

#### RPC Checks

| # | Check | Expected | Actual | Verdict |
|---|---|---|---|---|
| 7 | All 6 RPCs exist matching `rpc_%manual%` or `rpc_%deduction%` | 6 RPCs | rpc_approve_manual_payment_entry, rpc_get_deductions_report, rpc_get_manual_payment_entries, rpc_get_pending_manual_payments, rpc_reject_manual_payment_entry, rpc_submit_manual_payment_entry | PASS |
| 8 | `rpc_claim_next_files` exists (DUP-2 pipeline locking RPC) | 1 row | Confirmed present | PASS |
| 9 | `fn_classify_invoice_source('AsiaTech')` returns NOT 'walk_in' | NOT 'walk_in' | `'other'` | PASS |
| 10 | `fn_classify_invoice_source('Direct - Walk-In')` returns 'walk_in' | `'walk_in'` | `'walk_in'` | PASS |

#### Frontend Checks

| # | Check | Expected | Actual | Verdict |
|---|---|---|---|---|
| 11 | `detail-client.tsx` contains "Add Payment Manually" button, "Mark as Commission / TDS" button, and ManualPaymentEntriesSection | All three present | Found at lines 1101, 1493, 406 respectively | PASS |
| 12 | `admin/manual-payments/page.tsx` exists | File exists | Confirmed present | PASS |
| 13 | `reports/deductions/page.tsx` exists | File exists | Confirmed present | PASS |
| 14 | `layout.tsx` has "Manual Payments" in admin nav and "Deductions" in both admin and operator nav | Both present in both nav arrays | Manual Payments at line 29 (admin only), Deductions at line 30 (admin) and line 40 (operator) | PASS |

#### End-to-End SQL Checks

| # | Check | Expected | Actual | Verdict |
|---|---|---|---|---|
| 15 | Submit commission write-off on partial OTA invoice (INV1988260269, gap=₹23.40) → approve → verify link payment_method='commission' → verify deductions report returns it | Link created, invoice=fully_reconciled, deductions report shows row | link_id=`7533d2bc`, source_table='manual_payment_entries', payment_method='commission', amount_applied=23.40; invoice flipped to fully_reconciled; deductions report returned correct row + party total. Cleanup: link + entry deleted, invoice restored to partial. | PASS |
| 16 | Three retroactive invoices can be closed via commission/TDS mechanism — submit + approve write-offs for each; verify they flip to fully_reconciled | All three fully_reconciled after approval | INV1988260052: commission ₹167, AsiaTech, fully_reconciled; INV1988260060: commission ₹483, AsiaTech, fully_reconciled; INV1988260059: TDS ₹2,000, Raj Path Infracon, fully_reconciled. All three `manual_payment_entries` rows status=approved, `reconciliation_link_ref` set, links have correct payment_method. Per task instructions: retroactive entries LEFT in place (approved, not cleaned up). | PASS |

**All 16 checks: PASS**

---

## Open Bugs
None. BUG-001 and BUG-002 verified fixed. BUG-003 resolved-by-design.

---

## Verified & Closed Bugs

### BUG-001 [2026-06-20] fn_classify_invoice_source misclassifies major OTA/corporate sources as walk_in
- **Fix:** `fn_classify_invoice_source` now returns `'other'` for unrecognised sources instead of `'walk_in'`.
  The commission eligibility block in `rpc_submit_manual_payment_entry` only fires for `walk_in` and `phone`.
- **Verified:** `fn_classify_invoice_source('AsiaTech')` → `'other'` (not `'walk_in'`).
  Commission submit on AsiaTech invoice → `pending` (not blocked).
- **Verified on:** 2026-06-20 17:45

### BUG-002 [2026-06-20] `admin_flags` column is nullable with no default
- **Fix:** Column altered to `NOT NULL DEFAULT '[]'::jsonb`.
- **Verified:** `column_default='[]'::jsonb`, `is_nullable='NO'` in `information_schema.columns`.
  Newly submitted entries store `[]` (not NULL) when no flags are triggered.
- **Verified on:** 2026-06-20 17:45

### BUG-003 [2026-06-20] PRD ambiguity: TDS on Direct Walk-In
- **Resolution:** PM confirmed TDS on walk-in is INTENTIONALLY allowed. PRD § 14C.7 text was ambiguous.
  The RPC's current behaviour (only blocks commission on walk-in/phone, not TDS) is correct.
- **Verified on:** 2026-06-20 17:45

---

## Coverage Gaps

- **Tolerance boundary condition (exactly 1% over):** Not tested — `existing_upi + amount == bank_credit * 1.01` edge case. Should PASS (tolerance is inclusive).
- **UPI revalidation at approval with concurrent pending entries:** Partial coverage. Full concurrent UPI test would require two pending UPI entries on same settlement date.
- **`rpc_get_deductions_report` filters (date range, type filter, party ILIKE):** Only tested the no-filter and party-filter paths. Date range and type filter paths not explicitly tested.
- **Operator cannot call `rpc_reject_manual_payment_entry`:** Verified implicitly via `rpc_approve` operator rejection. Should be tested explicitly for reject too.
- **`NOT NULL` check on `p_reason` when NULL is passed (vs empty string):** Only tested with empty string `''`. NULL case untested.
- **`upi_transaction_ref` is NULL on MPR_LINK_UNVERIFIED approved UPI entry:** Confirmed correct (falls back to manual_payment_entries source) — expected deviation from spec documented in backend-dev.md.
- **C1 full RPC test suite (original backlog item) for older RPCs** — still outstanding.
- **`fn_classify_invoice_source` broader regression:** Only 'AsiaTech', 'Direct - Walk-In', 'Direct - By Phone' tested. Other sources ('BookingDotCom', 'Cleartrip', 'Corporate Travel - *', 'Expedia') not retested post-fix but should also return 'other' given the fix logic.
- **Frontend UI QA (MPE-7/CDW-7 UI-level):** All checks in this sweep were DB-level SQL. The frontend was verified structurally (file existence + text search). Full interactive UI QA (form validation, modal behaviour, status badge rendering, admin queue approve/reject flow) remains to be done in a browser session.
- **DUP-2 pipeline locking (`rpc_claim_next_files`):** RPC existence confirmed (check 8 PASS). Actual Python pipeline integration (concurrent worker test, duplicate-insert logging) was not re-exercised in this sweep — that is backend-dev territory per the execution log.
- **MRR live DB test:** MRR-4 checks were all static code analysis + build. The two new RPCs (`rpc_get_reconciliation_monthly_summary`, `rpc_get_reconciliation_month_detail`) were not exercised against live Supabase data. A live SQL test confirming correct aggregation for a known month would close this gap.
- **MRR interactive browser QA:** The reconciliation report UI was not tested in a browser session. Date-range picker behaviour, clickable row navigation, and responsive layout are untested interactively.

---

## Notes for Product Manager

1. **All three retroactive invoices are now CLOSED.** INV1988260052 (commission ₹167, AsiaTech), INV1988260060 (commission ₹483, AsiaTech), and INV1988260059 (TDS ₹2,000, Raj Path Infracon) are all `fully_reconciled` per PRD § 14C.12. The approved `manual_payment_entries` rows are retained for audit.

2. **The full MPE-7 + CDW-7 sweep is PASS across all 16 checks.** Schema, constraints, RPCs, frontend structure, and the E2E submit→approve→fully_reconciled flow all verified against the live database.

3. **No open bugs at this time.** All prior bugs (BUG-001, BUG-002) remain fixed; BUG-003 remains resolved-by-design.

4. **Frontend UI interactive testing (forms, modals, browser)** was not part of this SQL-level QA sweep. If designer polish (MPE-6, CDW-6) has been applied, a browser-level smoke pass would be the logical next step before declaring the feature shipped to end users.

---

## Reference
- Seed admin user: krishnagopal.kedia@optimoloan.com / `AdminPass123!` (id: `45bcd1e5-e628-4480-b9c6-08d4b8d936c9`)
- Seed operator user: operator@hotel.local / `OperatorPass123!` (id: `6e50c4f5-94f4-40ab-b7b3-9919f6138a57`)
- Test invoices: `INV1988260057` (AsiaTech, partial), `INV1988260197` (Direct Walk-In, unreconciled)
- E2E test invoice (MPE-7 check 15): `INV1988260269` (Travel Agency - Travelstack, ₹23.40 gap) — test data cleaned up; invoice restored to partial
- Retroactive invoices (left as fully_reconciled per task instructions):
  - `INV1988260052` (id: `63c0e94c-76dc-457a-807c-08f40899440e`) — entry `9295b799`, link approved, commission ₹167
  - `INV1988260060` (id: `2a489016-c5a4-4b4c-a3a2-fd3e56fc9818`) — entry `3ba80c33`, link approved, commission ₹483
  - `INV1988260059` (id: `3dfbcaf3-7813-4e50-813d-ea0d76afc73e`) — entry `d0a47976`, link approved, TDS ₹2,000

## Status
BUG-001, BUG-002, BUG-003: all closed. No open bugs.
Last full QA pass: 2026-06-20 18:30 (MPE-7 + CDW-7 final sweep, 16/16 checks PASS).
