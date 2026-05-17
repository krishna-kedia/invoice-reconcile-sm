<!-- Last updated: 2026-05-17 14:35 -->

# Execution Plan
## Hotel Invoice Reconciliation App — V1 (Walk-in Invoices)

### Status: V1 BUILD COMPLETE (pending live QA / manual end-to-end pass)

This document tracks the V1 build. All Phase A (foundations), Phase B (RPC core), and Phase D + E (frontend) work is in place. Phase C (RPC test suite) and Phase F (E2E QA) remain as the next layer.

---

## Completed Work

### [2026-05-17 13:30] Phase A1 — Create new tables migration
- Agent: database-manager (executed by PM)
- Migration: `20260517080412_v1_reconciliation_core_tables`
- Outcome: 7 new tables created — `user_profiles`, `cash_payments`, `reconciliation_links`, `approval_requests`, `discrepancies`, `payment_source_config`, `audit_log`. Audit log immutability trigger + revokes installed. `reconciliation_status` column added to `hotel_invoice`.

### [2026-05-17 13:35] Phase A2 — Seed payment_source_config
- Agent: database-manager (executed by PM)
- Migration: `20260517080513_v1_seed_payment_source_config`
- Outcome: 6 default mapping rows inserted.

### [2026-05-17 13:38] Phase A5 — Audit-log helper function
- Agent: database-manager (executed by PM)
- Migration: `20260517080519_v1_audit_helper_function`
- Outcome: `fn_write_audit(...)` available.

### [2026-05-17 13:40] Phase B1 — v_transactions_with_remaining view
- Agent: database-manager (executed by PM)
- Migration: `20260517080532_v1_transactions_with_remaining_view`
- Outcome: Unified view over `upi_transactions`, `card_transactions`, `bank_statement` (credits only), `cash_payments` with `remaining` calculation.
- Hardened later (security_invoker view) — see security migration below.

### [2026-05-17 13:55] Phase A3 — Auth users provisioned
- Agent: backend-dev (executed by PM)
- Migration: `v1_create_initial_users`
- Outcome:
  - Admin: krishnagopal.kedia@optimoloan.com / `AdminPass123!` (user_id `45bcd1e5-…`)
  - Operator: operator@hotel.local / `OperatorPass123!` (user_id `6e50c4f5-…`)
  - Matching `user_profiles` rows with roles.
- Note: passwords are seed defaults; users should reset on first prod use.

### [2026-05-17 14:00] Phase A4 — RLS policies
- Agent: database-manager (executed by PM)
- Migration: `v1_rls_policies`
- Outcome: RLS enabled on all 17 tables. Helper functions `current_user_role()`, `is_admin()`, `is_operator_or_admin()`. Read policies set for both roles where appropriate; operator sees own approval_requests / discrepancies, admin sees all. Direct INSERT/UPDATE/DELETE revoked from authenticated on every sensitive table — all mutations must flow through SECURITY DEFINER RPCs.

### [2026-05-17 14:10] Phase B2 — rpc_reconcile_invoice
- Agent: backend-dev (executed by PM)
- Migration: `v1_rpc_reconciliation_core`
- Outcome: Core ACID reconciliation RPC. Locks source rows, validates remaining, enforces ≤5% overpay rule, requires `confirm_partial`/`confirm_overpay`, creates `discrepancies` on flagged overpay, writes audit. Also includes inline cash-payment creation (E4 done via this path). Helpers `fn_recompute_invoice_status`, `fn_lock_and_get_source_amount`, and `rpc_create_cash_payment` deployed.

### [2026-05-17 14:15] Phase B4 / B5 / B6 / B7 / B8 / B9 — Approval & admin RPCs
- Agent: backend-dev (executed by PM)
- Migration: `v1_rpc_approvals_and_admin`
- Outcome: 9 additional RPCs deployed:
  - `rpc_request_unreconcile_link`, `rpc_request_unreconcile_invoice`, `rpc_request_cash_edit`, `rpc_request_cash_delete` (B4)
  - `rpc_approve_request`, `rpc_reject_request` (B5)
  - `rpc_admin_reverse_reconciliation` (B6)
  - `rpc_resolve_discrepancy` (B7)
  - `rpc_upsert_payment_source_config` (B8)
  - `rpc_admin_home_summary` (B9)
- All run as SECURITY DEFINER, role-checked, audit-logged.

### [2026-05-17 14:20] Phase D1 — Next.js scaffold
- Agent: frontend-dev (executed by PM)
- Outcome: `frontend/` initialized via `create-next-app` (TypeScript, Tailwind, App Router, `src/`). Added `@supabase/supabase-js`, `@supabase/ssr`, `@tanstack/react-query`, `zod`, `date-fns`, `react-hook-form`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. `.env.local` populated with project URL + publishable key.

### [2026-05-17 14:22] Phase D2 — Supabase client wrappers
- Agent: frontend-dev (executed by PM)
- Outcome: `src/lib/supabase/{client,server,middleware}.ts` using `@supabase/ssr`. Shared domain types in `src/lib/types.ts`.

### [2026-05-17 14:24] Phase D3 — Auth pages + middleware
- Agent: frontend-dev (executed by PM)
- Outcome:
  - `/login` page (email/password) with role-based redirect.
  - `src/middleware.ts` enforces auth and blocks operators from `/admin/*`.
  - `LogoutButton` in shell header.

### [2026-05-17 14:26] Phase D4 — App shell
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/layout.tsx` with role-aware top header and left nav. Designer-friendly Tailwind + shadcn-style primitives (`Button`, `Input`, `Card`, `Badge`, `Table`, `Select`, `Label`, `Dialog`, `Toast`, `Textarea`).

### [2026-05-17 14:28] Phase E1 — Invoice list page
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/invoices/page.tsx` with tabs (walk-in / OTA), filters (status, date range, guest, amount), server-side pagination (50/page), status badges, click-through to detail.

### [2026-05-17 14:30] Phase E2 + E3 + E4 — Invoice detail + Add Payment + Cash
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/invoices/[id]/page.tsx` (server) + `detail-client.tsx` (client). Shows all invoice fields, outstanding, linked payments table, Add-Payment panel with method/date selector + transaction picker (greyed-out rows for remaining=0, click-to-pick modal with smart default), Linked-payments-this-session list, single Save Reconciliation that handles partial / overpay confirmation dialogs. Cash sub-component included via inline-cash path of the RPC. Audit trail collapsible at the bottom.

### [2026-05-17 14:32] Phase E5 — Admin Home
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/admin/page.tsx`. Tiles for unreconciled count/amount, status breakdown, aging buckets, cash vs digital (30d), pending approvals, flagged discrepancies, last-20 audit. Sourced from `rpc_admin_home_summary`.

### [2026-05-17 14:33] Phase E6 — Approvals
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/admin/approvals/page.tsx`. Pending/decided tabs, approve/reject drawer, reject-note required, payload preview.

### [2026-05-17 14:34] Phase E7 — Discrepancies
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/admin/discrepancies/page.tsx`. Table + drawer with Mark Resolved (note) and Reverse Reconciliation (note) actions.

### [2026-05-17 14:35] Phase E8 — Audit Log
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/audit/page.tsx`. Filters by action prefix, entity type, date range. Row expansion shows side-by-side before/after JSON.

### [2026-05-17 14:35] Phase E9 — Payment Source Config
- Agent: frontend-dev (executed by PM)
- Outcome: `src/app/(app)/admin/settings/payment-sources/page.tsx`. Method × source-table matrix with per-method Save via `rpc_upsert_payment_source_config`.

### [2026-05-17 14:35] Security hardening
- Agent: database-manager (executed by PM)
- Migration: `v1_security_hardening`
- Outcome:
  - `v_transactions_with_remaining` rebuilt as `security_invoker = true` so RLS on base tables applies.
  - Revoked EXECUTE on internal helpers (`fn_write_audit`, `fn_lock_and_get_source_amount`, `fn_recompute_invoice_status`) from anon/authenticated to prevent direct REST access; RPCs still call them (owner has rights).
  - `current_user_role()`, `is_admin()`, `is_operator_or_admin()` no longer callable by `anon`.
  - Older trigger functions now have immutable `search_path`.

---

## In Progress

_None — all build tasks complete._

---

## Up Next (sequenced)

### C1 — RPC test suite (full automated)
- Agent: qa
- Priority: High
- Depends on: B2–B9 (done)
- Instructions: Write SQL test scenarios (pgTAP or plain transactional SQL with assertions) covering: happy path, partial, overpay-flag, overpay-reject, underpay save, double-claim race (2 sessions, `SELECT FOR UPDATE` proven), un-reconcile request → approve → state correct, cash add/edit/delete request lifecycles, RLS enforcement (operator blocked from direct mutations on every sensitive table).
- Done when: all scenarios pass green; report appended below.

### C2 — Audit log completeness matrix
- Agent: qa
- Priority: High
- Depends on: B2–B9 (done)
- Instructions: For each RPC, confirm audit row produced with correct `action`, `entity_*`, `before_state`, `after_state`. Confirm UPDATE/DELETE on `audit_log` raises immutability exception.
- Done when: matrix written into this file.

### E10 — Design polish + error message audit
- Agent: designer + qa
- Priority: Medium
- Depends on: all E1–E9 (done)
- Instructions: Walk every page and every error state; confirm style guide compliance per `prd.md` § UI Requirements. Spacing, alignment, focus rings, keyboard nav.

### F1 — End-to-end manual QA
- Agent: qa
- Priority: High
- Depends on: E10
- Instructions: Run the 11-step script from the original execution.md against the deployed frontend with the two seeded users.

### F2 — Performance check
- Agent: qa
- Priority: Medium
- Depends on: F1
- Instructions: Seed 2000 invoices and 5000 transactions; confirm invoice list <1s, transaction picker <500ms, admin home <300ms.

### F3 — Security review
- Agent: qa
- Priority: High
- Depends on: F1
- Instructions: Run `mcp__supabase__get_advisors` again — confirm remaining warnings are the expected pattern (SECURITY DEFINER RPCs callable by anon: they reject with "Not authenticated"). Confirm RLS denies operator direct mutations from a real authenticated session (not superuser).

---

## Backlog (V1.5+)

Same as previous version — CSV/Excel export, void/cancelled invoices, bank-stmt↔MPR reconciliation, OTA reconciliation, notifications, bulk operations, mobile, multi-property, self-service user provisioning, auto-match, realtime.

---

## Blocked

_None._

---

## Decisions Made During Execution

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-17 | Inline-cash creation inside `rpc_reconcile_invoice` instead of two RPC calls | Achieves true atomicity per E4 alternative; keeps frontend simple. |
| 2026-05-17 | `v_transactions_with_remaining` uses `security_invoker = true` (Supabase view option) | Eliminates Supabase lint ERROR while keeping RLS enforcement on base tables. |
| 2026-05-17 | Internal helper functions (`fn_*`) have EXECUTE revoked from anon/authenticated | Prevents direct REST calls; RPCs still invoke them via owner-level rights inside SECURITY DEFINER. |
| 2026-05-17 | Error messages from RPC use `PARTIAL_CONFIRMATION_REQUIRED` / `OVERPAY_CONFIRMATION_REQUIRED` sentinel prefixes | Lets the UI translate them into confirmation dialogs without re-implementing business rules client-side. |
| 2026-05-17 | First passwords seeded directly in `auth.users` via `crypt(...)` | Avoids needing the auth admin REST API in the MCP environment; users will reset on first prod use. |
| 2026-05-17 | Supabase MCP-applied migrations are the source of truth (no local `supabase/migrations/` directory yet) | Project uses Supabase MCP server; local CLI workflow can be added later if needed. |

---

## Quick verification log

| Scenario | Outcome |
|---|---|
| Partial save without `confirm_partial` | RPC raises `PARTIAL_CONFIRMATION_REQUIRED` — verified |
| Partial save with `confirm_partial=true` | Link inserted, invoice → `partial`, audit rows written — verified |
| Overpay > 5% | RPC raises hard error with explicit reduction amount — verified |
| Next.js build | `npm run build` produces clean output, 12 routes generated — verified |
| TypeScript `tsc --noEmit` | Clean — verified |
| Supabase security advisor | `security_definer_view` ERROR cleared; remaining WARNs are the documented "RPC callable by anon (auth checked inside)" pattern |
