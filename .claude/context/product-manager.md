# Product Manager Context
<!-- Last updated: 2026-05-23 (Phase PF dispatched) -->
<!-- Previous: 2026-05-23 -->
<!-- Previous: 2026-05-19 18:30 -->

## Current Phase
Phase 4 (Execution) — THIRD workstream kicking off today:

- **Phase PF** — Payment Folio Upload + Auto-select on reconcile + Resolve guard on issue reports (FR-099..FR-107). 6 sequenced tasks PF-1..PF-6.
  - PF-1 DISPATCHING to database-manager now (schema + corporate_credit CHECK ext + consume helper + reverse-consume trigger).
  - PF-2 queued for backend-dev after PF-1 (upload RPC + resolve-guard patch + 4-RPC consume hook).
  - PF-3 QA gate.
  - PF-4 to frontend-dev (TS BIFF8 reader + upload page + auto-select on all 4 panels + Resolve-button disable).
  - PF-5 designer polish.
  - PF-6 final QA.

Plus the prior workstreams still in flight:
- **Phase BS-v2** — Bank Statement drill-down attribution + per-sub-row tint (FR-087). Layers on top of in-flight BS-Polish.
- **Phase Y-v2** — Yatra reconcile pipeline with v2 schema (all JSON fields, no UNIQUE constraint, log-and-skip duplicates) + `v_yatra_monthly_deductions` view (FR-076 v2, FR-078 v2, FR-088). Supersedes earlier Y1/Y2 stub specs.

Prior context still applicable:
- BS-Polish (full-width app shell, row tints, clickable rows, drop amber border) — designer spec IN PROGRESS, frontend impl QUEUED.
- BS-1 (RPCs) DONE, BS-2 (frontend) DONE, BS-3 (QA) PENDING.
- Phase M (MMT Direct Reconcile) DONE except M4 (QA pending).

## Agent Status Summary

### database-manager
- Last task: BS-1 (`bank_statement_view_rpcs` migration) — 2026-05-18.
- Current status: idle, about to be handed BS-v2-1 (drill-down attribution RPC) and Y1 (Yatra schema v2).
- Key context: existing migrations include `bank_statement_view_rpcs`, `mmt_direct_reconcile_schema`, `mmt_direct_reconcile_rpcs`. Supabase MCP is the source of truth (no local `supabase/migrations/` directory). Always run `mcp__supabase__get_advisors` after every migration.

### backend-dev
- Last task: Phase M (MMT Direct Reconcile RPCs) — 2026-05-17.
- Current status: idle, queued for Y2 (Yatra inserter with log-and-skip) after Y1 lands.
- Key context: MMT inserter pattern (`src/database/mmt_payout_inserter.py`) is the template. Yatra inserter must NOT use `ON CONFLICT (voucher_no)` because the UNIQUE constraint is being dropped — duplicate detection moves to the app layer with a `logger.warning` skip path.

### frontend-dev
- Last task: BS-2 (`/bank-statement` page + nav + xlsx install) — 2026-05-18. Build clean.
- Current status: idle, two tasks queued: BS-Polish-2 (apply designer's spec for tints/clickable rows/full-width) and BS-v2-2 (drill-down attribution column + sub-row tints). BS-v2-2 depends on BS-Polish-2 so the tint Tailwind classes already exist.
- Key context: frontend repo is a SEPARATE repo at `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-frontend`, Next.js app at `frontend/`. Build + tsc must be clean after every change.

### qa
- Last task: idle.
- Open bugs: none.
- Pending QA: M4 (MMT Direct Reconcile), BS-3 (Bank Statement V1), BS-Polish-3 (visual regression), BS-v2-3 (drill-down attribution + tints), Y6 (Yatra end-to-end).

### designer
- Last task: none yet — BS-Polish-1 IN PROGRESS as of 2026-05-19 morning.
- Current status: must produce final spec for: pastel green/yellow tint classes, filter-control treatment (chip row vs popover trigger), clickable-row hover state, container padding after `max-w-7xl` removal. The same tint classes will be reused by BS-v2-2 for drill-down sub-rows.

## Phase BS-v2 — Scope (locked 2026-05-19)
Drill-down attribution + per-sub-row status tint, consistent across all drill types (UPI / Card / MMT / Yatra).

1. Backend extends `rpc_get_bank_statement_drilldown` to return `reconciled_invoices`, `applied_total`, `base_amount` per sub-row.
2. Frontend adds a "Reconciled To" column to every drill-down. One row per invoice when a sub-transaction is split across multiple invoices. Each invoice rendered as a clickable Link with `stopPropagation`.
3. Each sub-row gets the same pastel green/yellow/none tint logic the main rows use, but computed from the sub-row's own base amount.
4. Backend overpayment guard (BR-038) is reverified — sum(amount_applied) for any bank_statement row CANNOT exceed deposit_amt; existing reconcile RPCs already enforce via `fn_lock_and_get_source_amount`.

## Phase Y-v2 — Scope (locked 2026-05-19)
Yatra reconcile pipeline with material refinements vs the 2026-05-19 morning spec:

1. **Schema v2** (FR-076 v2): table stores ALL JSON fields (commercials + booking + guest + room data + raw envelope). `UNIQUE (voucher_no)` constraint DROPPED.
2. **Inserter v2** (FR-078 v2): pre-insert duplicate check + `logger.warning` + skip when duplicate voucher_no exists. No `ON CONFLICT`. File still marked `completed` on skip.
3. **Field-edit RPC** (FR-081 v2): editable whitelist expanded to include all the new fields. Provenance fields (`raw_json`, `source_file_name`, `drive_file_id`, `parsed_at`) NOT editable.
4. **Auto-match**: guest-name only (no booking_id linkage). Fallback is the searchable voucher dropdown.
5. **Methods**: UPI / Card / Bank Transfer only. Cash explicitly rejected (`YATRA_CASH_NOT_ALLOWED` sentinel).
6. **`yatra_to_pay_hotel`**: trusted as-is. Auto-fills payment amount. Editable.
7. **PrePay/PostPay**: identical flow. `is_pre_pay = true` does NOT exclude from outstanding receivables.
8. **No narration-based bank match**: Yatra reconciles via manual transaction picker only. Bank drill-down classifier kicks in AFTER reconciliation lands (via back-pointer chain, FR-085).
9. **`v_yatra_monthly_deductions` view** (FR-088): mirrors `v_mmt_monthly_deductions`. Surfaced on the same dashboard page as MMT deductions with a tab/filter.
10. **Cancellation handling**: OUT of V1 scope.
11. **Drive folder**: `11VRWMBTfYJY10s9kXTKm-wq0Yq6QjnL1` (env var `YATRA_PAYOUTS`).

## Recent Handoffs

### [2026-05-23] Phase PF (Payment Folio + Auto-select + Resolve guard) — PRD + execution.md addendum written
- New FRs: FR-099..FR-107.
- PM-locked design calls (user authorized "work without stopping"):
  1. Upload UI at `/admin/payment-folio` (admin-only, NEW page).
  2. Auto-select applies to all 4 reconcile panels (walk-in, MMT, Yatra, Agoda).
  3. Resolve guard accepts `partially_reconciled` OR `fully_reconciled` (NOT just fully).
  4. New `corporate_credit` payment_method for `Bill To Company`.
  5. BIFF8 parser is TypeScript in the frontend; Python parser also added for future Drive ingestion path.
  6. Duplicate = exact 6-tuple match with NULL canonicalisation (UNIQUE expression index).
  7. `payment_entries` is a SUGGESTION SURFACE — reconciliation still links to `upi_transactions`/`card_transactions`/`bank_statement`/`cash_payments`.
  8. Consumption tracking: `consumed_for_invoice_id` set when an invoice with matching booking_id/invoice_number is reconciled; cleared via AFTER DELETE trigger on `reconciliation_links`.

### [2026-05-23] PF-1 → database-manager — DONE (PM-driven via Supabase MCP)
- Migration `pf_payment_folio_schema` applied successfully.
- Verified: 2 new tables, unique dedup index, 4 supporting indexes, CHECK constraint extensions for `corporate_credit`, `fn_consume_payment_entry` helper, AFTER DELETE trigger.
- Advisors: no new errors related to PF-1 objects.

### [2026-05-23] PF-2 → backend-dev — DISPATCHED
- Inbound brief written to `.claude/context/backend-dev.md`.
- Migration name: `pf_rpcs_and_hooks`.
- Scope: `rpc_upload_payment_folio` (FR-102) + resolve guard on `rpc_resolve_issue_report` (FR-107) + auto-consume hooks into 4 reconcile RPCs (FR-106).
- Critical correction noted in brief: `reconciliation_status` values are `unreconciled | partial | fully_reconciled | flagged_for_review` (NOT `partially_reconciled`). Resolve guard accepts the 3 non-`unreconciled` values.
- 8 smoke scenarios required before completion.

### [2026-05-23] PF-4 → frontend-dev — QUEUED (blocked on PF-2)
- Inbound brief written to `.claude/context/frontend-dev.md`.
- Scope: TS BIFF8 OLE parser (`src/lib/xls/biff8.ts`), upload page (`/admin/payment-folio`), `usePaymentFolioMatches` hook, auto-select wired into all 4 reconcile panels, Resolve-button disable + tooltip + `INVOICE_NOT_RECONCILED` toast.

### [2026-05-23] Phase RI (Report an Issue) — PRD + execution.md addendum written
- New FRs: FR-089..FR-098 (catalog, schema, 3 RPCs, auto-resolve hook, UI, admin page, audit).
- Locked design decisions made by PM (user authorized "work without stopping for clarifying questions"):
  1. Static catalog of 18 categories (6 common + 3 MMT + 3 Yatra + 2 Agoda + 4 walk-in). `other` requires notes.
  2. Reports are INFORMATIONAL — do NOT block reconcile.
  3. Auto-resolve on `fully_reconciled` only (not on partial). Reverse-recon does NOT re-open (BR-047).
  4. One open report per invoice (DB-enforced partial unique index).
  5. Admin-only manual resolve. Operator may withdraw their own.
  6. Visibility: operator sees own + admin sees all (RLS).

### [2026-05-23] RI-1 → database-manager — DONE
- Migration `v1_invoice_issue_reports` + helper `fn_auto_resolve_issue_reports`. Advisors clean.

### [2026-05-23] RI-2 → backend-dev — DONE
- Migration `v1_rpc_issue_reports`: 3 RPCs + 2 helpers + auto-resolve trigger + `v_invoice_list_with_issue` view.
- Implementation note: chose AFTER UPDATE trigger on `hotel_invoice.reconciliation_status` instead of editing 3 reconcile RPCs. Same behaviour, lower-risk change.
- All 11 smoke tests PASS. Audit log confirmed.

### [2026-05-23] RI-4 + RI-5 → frontend-dev — QUEUED (after RI-2)
- ReportIssueDialog, IssueReportCard, list pill, `/admin/issues` page.

### [2026-05-19 09:00] BS-Polish-1 → designer — IN PROGRESS
Producing tint + filter-control spec in `.claude/context/designer.md`.

### [2026-05-19 09:00] BS-Polish-2 → frontend-dev — QUEUED (after designer)
Apply spec to `(app)/layout.tsx` and `bank-statement-client.tsx`.

### [2026-05-19 18:30] Locked BS-v2 + Y-v2 scope; PRD + execution updated
Added FR-087 (drill-down attribution + sub-row tint), FR-088 (Yatra monthly deductions view), FR-076 v2 (full-JSON schema + no UNIQUE), FR-078 v2 (log-and-skip duplicates), FR-081 v2 (expanded editable whitelist). Added BS-v2-1/2/3 and revised Y1..Y6 + new Y7 in execution.md.

## Decisions Log

### [2026-05-19] Drill-down attribution applies to ALL drill types uniformly
One pattern for UPI, Card, MMT, Yatra — adding a future payment type is mechanical.

### [2026-05-19] Drop `UNIQUE (voucher_no)` constraint
App-level dedup via inserter (log-and-skip). Allows future amendments/cancellations as new rows for human review. First-imported row remains canonical until manually changed.

### [2026-05-19] Store ALL JSON fields, including unused-in-V1
Future-proofing. `raw_json` column carries the verbatim envelope.

### [2026-05-19] `v_yatra_monthly_deductions` is a dedicated view (FR-088)
Separate from the MIS extension (FR-086). Surfaced alongside MMT deductions on the dashboard with a tab/filter.

### [2026-05-19] Backend overpayment guard reverified (BR-038)
`sum(reconciliation_links.amount_applied) > bank_statement.deposit_amt` is rejected by all reconcile RPCs. Frontend tinting assumes this invariant holds.

### [2026-05-19] Sub-row tint reuses the same Tailwind classes as main-row tint
No new design tokens. Designer's BS-Polish spec is the single source of class strings.

### Previous decisions (still in force)
- 2026-05-19: Full-width app shell app-wide (`max-w-7xl` dropped in `(app)/layout.tsx`).
- 2026-05-19: Row tint is the single status signal; amber left-border dropped.
- 2026-05-19: Tint computed at bank_id granularity, applied to all split rows in the group.
- 2026-05-19: Yatra reconciliation uses Option B — `reconciliation_links.payment_method` carries the REAL underlying method (`upi`/`card`/`bank_transfer`), never `yatra_payout`.
- 2026-05-19: Yatra source match is `ILIKE '%Yatra%'`.
- 2026-05-19: `yatra_to_pay_hotel` trusted as-is.
- 2026-05-19: Yatra single `reconciliation_links` row per reconcile (pattern mirrors MMT).
- 2026-05-19: New `reconciled_at` + `reconciled_link_id` columns on `yatra_bookings_payout`; back-pointer cleared via AFTER DELETE trigger.

## Open Questions
- None for Phase RI. PM made all 4 design calls (catalog list, non-blocking, admin-only resolve, free-text notes optional except `other`). User can override any of these via a fast follow.

## Decisions Log — Phase RI (2026-05-23)
- **Catalog is static** (hard-coded in DB CHECK + frontend const). Adding a category in V1.5+ is a 2-file change.
- **One open report per invoice** (DB partial unique index). Operator must withdraw before refiling.
- **Auto-resolve only on `fully_reconciled`**. Partial reconcile leaves the report open.
- **Reverse-reconciliation does NOT re-open** auto-resolved reports (BR-047). Admin re-files if needed.
- **`v_invoice_list_with_issue`** is the cleanest spot for the `has_open_issue` boolean — no need to change the list RPC signature.
- **AFTER UPDATE trigger on hotel_invoice** replaces the originally-planned RPC-side hook. Single point of enforcement, no edit to 3 existing reconcile RPCs. `auth.uid()` reads from session JWT so attribution is preserved.

## Next Actions (sequenced)

### Immediate (this session can dispatch now)
1. **BS-Polish-1** → designer (already in flight; complete tint + filter spec).
2. **Y1** → database-manager (Yatra schema v2 migration; can run in parallel with BS-Polish-1 — no overlap).
3. **BS-v2-1** → database-manager (drill-down attribution RPC; can run in parallel with Y1 — different RPC, no schema overlap).

### After Y1
4. **Y2** → backend-dev (Yatra inserter with log-and-skip).
5. **Y3** → backend-dev (Yatra reconcile RPCs).

### After BS-Polish-1
6. **BS-Polish-2** → frontend-dev (apply designer spec; produces the reusable tint classes).

### After BS-Polish-2 + BS-v2-1
7. **BS-v2-2** → frontend-dev (drill-down attribution column + sub-row tints).

### After Y3
8. **Y4** → frontend-dev (YatraReconcilePanel + detail integration).

### After Y4
9. **Y5** → backend-dev + frontend-dev (Bank Statement drill-down: Yatra extension; will combine with BS-v2 attribution since both touch the same RPC and client).

### After Y5
10. **Y6** → database-manager + qa (MIS view update + end-to-end QA).
11. **Y7** → database-manager + frontend-dev (`v_yatra_monthly_deductions` view + dashboard tab).

### Cross-cutting QA
12. **BS-v2-3** after BS-v2-2.
13. **BS-Polish-3** after BS-Polish-2.
14. **BS-3** (original BS QA) still pending.
15. **M4** (MMT Direct Reconcile QA) still pending.
