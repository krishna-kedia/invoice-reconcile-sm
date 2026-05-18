<!-- Last updated: 2026-05-18 10:00 -->

# Product Requirements Document
## Hotel Invoice Reconciliation App — V1 (Walk-in Invoices)

---

## Overview

A no-nonsense internal web application for a single hotel to reconcile walk-in guest invoices against payments received via Cash, UPI, Card, and Bank Transfer. The app sits on top of an existing Python OCR backend that already extracts hotel invoices, MMT invoices, HDFC Merchant Payment Reports (MPR), and HDFC bank statements into a Supabase database. V1 delivers the reconciliation layer plus the frontend on top, with strong emphasis on **audit visibility, ACID-safe reconciliation, and operator-friendly error messages**.

The app is for two roles: **Operator** (reconciles invoices day-to-day) and **Admin** (the hotel owner/manager — approves changes, reviews discrepancies, configures payment sources, sees the home dashboard).

---

## Problem Statement

Today, reconciling each walk-in invoice against payment evidence (UPI/card/bank/cash) is manual, ad-hoc, and error-prone. There is no system that:

- Prevents the **same payment transaction** from being counted against two different invoices.
- Enforces **all-or-nothing** updates so a half-saved reconciliation can never leave the books inconsistent.
- Gives **management visibility** into what is unreconciled, what is partial, and where discrepancies sit.
- Maintains a **tamper-proof audit trail** of every reconciliation action.
- Prevents an operator from silently making destructive changes (un-reconciling, deleting cash entries) without admin approval.

V1 removes manual reconciliation and replaces it with a controlled, auditable workflow.

---

## Goals

- [ ] Operator can reconcile any walk-in `hotel_invoice` against one or more payment transactions in under 60 seconds for the typical case.
- [ ] Every reconciliation save is ACID-atomic — partial saves are impossible.
- [ ] Zero double-counting: no transaction (or any portion of it) can be reconciled against more invoices than its remaining unused amount.
- [ ] 100% of reconciliation actions (create, remove, approve, reject) are written to an immutable audit log.
- [ ] Admin can see at-a-glance status of unreconciled invoices, discrepancies, and pending approval requests from the Admin Home screen on login.
- [ ] All error messages are operator-friendly and explain exactly what is wrong and how to fix it.

---

## Out of Scope (V1)

- OTA invoices (`mmt_invoice`) — shown read-only only, not reconcilable.
- Void / cancelled / refunded invoices — not modelled. **Documented as future scope.**
- CSV / Excel export — **deferred to V1.5**.
- Notifications (email, Slack, SMS).
- Bulk reconciliation operations (always one invoice at a time in V1).
- Mobile / responsive layout (desktop only in V1).
- Bank-statement-to-MPR reconciliation (separate concern, not in V1).
- Multi-property support (single property in V1).
- Auto-matching / ML suggestions for transaction selection.
- Draft reconciliations (every save is a final commit).
- Keyword-based bank-statement parsing to distinguish UPI vs Card credits (V1 shows all day's credits; user picks).

---

## Users & Roles

| Role | Capabilities |
|---|---|
| **Operator** ("User") | View invoice list. Open an invoice. Add payment links (reconcile). Submit a request to un-reconcile an invoice. Submit a request to edit/delete a cash entry. Cannot directly delete or modify anything already saved. |
| **Admin** | All Operator capabilities. Plus: see Admin Home dashboard. Approve / reject Operator requests. Review and resolve flagged discrepancies. View full audit log. Configure payment-source mapping. Create user accounts (manually via SQL/code for V1). |

Both roles are authenticated via Supabase Auth. Row-Level Security (RLS) policies enforce the boundary.

---

## User Flows

### Flow 1 — Operator reconciles an invoice (happy path)

1. Operator logs in. Lands on Invoice List.
2. Default view: unreconciled invoices, newest first.
3. Operator clicks an invoice → Invoice Detail page opens.
4. Detail page shows: guest name, booking ID, dates, grand total, current reconciliation status, list of already-linked payments (if any), and an **"Add Payment"** panel.
5. In Add Payment: payment method is pre-filled with OCR-suggested method (if available); operator can override.
6. Operator picks a **date** (defaults to invoice date).
7. System fetches transactions matching `(method, date)` per the Admin's payment-source config.
   - For UPI: rows from `upi_transactions` on that date + credit rows from `bank_statement` on that date.
   - For Card: rows from `card_transactions` on that date + credit rows from `bank_statement` on that date.
   - For Bank Transfer: credit rows from `bank_statement` on that date.
   - For Cash: no fetch — operator types amount manually.
8. Transactions show in a table with columns: time, identifier (VPA / last-4 / narration), original amount, used amount, **remaining amount**.
9. Fully-used transactions are greyed out and unselectable. Partially-used are normal-coloured and selectable.
10. Operator clicks a transaction → inline modal: **"How much of this ₹X (₹Y remaining) goes to this invoice?"** Default = `min(remaining, invoice_outstanding)`. Operator can override.
11. Operator confirms → row added to "Linked payments (this session)" list with a remove (×) button. Running total updates.
12. Operator repeats steps 6–11 across as many date/method combinations as needed.
13. Operator clicks **Save Reconciliation**.
14. System validates atomically:
    - If `linked_total = invoice_outstanding` (within rounding tolerance ₹1) → save, mark invoice `fully_reconciled`.
    - If `linked_total < invoice_outstanding` AND user has confirmed partial → save, mark invoice `partial`.
    - If `linked_total > invoice_outstanding` by ≤5% → save with `flagged_for_review = true`, surface as discrepancy on Admin Home.
    - If `linked_total > invoice_outstanding` by >5% OR `linked_total > invoice_outstanding` AND user did not confirm → **hard error**, do not save, show clear message.
    - If any selected transaction's remaining is exceeded by the requested portion → **hard error**, do not save.
15. On success: confirmation toast, invoice status badge updates, audit entry written.

### Flow 2 — Operator reconciles cash payment

1. Same as Flow 1 through step 4.
2. Operator selects method = Cash.
3. Operator types date + amount manually.
4. Clicks **Add** → a synthetic row appears in "Linked payments (this session)" with method = Cash.
5. Continues as in Flow 1 from step 12.
6. On save, a row is created in `cash_payments` table AND a `reconciliation_links` row pointing to it.

### Flow 3 — Operator partially reconciles, returns later

1. Operator follows Flow 1 but links only ₹5,000 of a ₹10,000 invoice.
2. Confirms partial save — invoice status = `partial`.
3. Days later, opens the same invoice. Previously-linked payments show in "Linked payments" section.
4. "Outstanding: ₹5,000" displayed prominently.
5. Operator uses Add Payment panel to link more. Save commits the new links.
6. When `linked_total = grand_total`, invoice auto-flips to `fully_reconciled`.

### Flow 4 — Operator requests un-reconciliation

1. Operator opens an already-reconciled invoice.
2. Clicks the (×) next to a linked payment, OR clicks **"Request to un-reconcile entire invoice"**.
3. Modal asks for a reason (required, free text).
4. System creates an `approval_request` of type `unreconcile_link` or `unreconcile_invoice`.
5. Operator sees confirmation: "Request submitted. Waiting on admin approval."
6. The link / invoice remains reconciled until admin acts.
7. Audit entry written for the request.

### Flow 5 — Admin approves / rejects a request

1. Admin lands on Admin Home. Sees tile "Pending approval requests: N".
2. Clicks → Approvals page with table of requests (operator, type, target, reason, requested at).
3. Admin clicks a row → request detail with current state and proposed effect.
4. Admin clicks **Approve** or **Reject** (rejection requires a note).
5. On approve:
   - For `unreconcile_link`: the `reconciliation_links` row is deleted, transaction's used amount is decremented, invoice status recalculated (could go to `partial` or `unreconciled`).
   - For `unreconcile_invoice`: all `reconciliation_links` for that invoice are deleted, all touched transactions have used amounts decremented, invoice status → `unreconciled`.
   - For `cash_edit` / `cash_delete`: the proposed change is applied.
6. All of the above happens atomically in a single transaction.
7. Audit entries written.

### Flow 6 — Admin reviews a flagged discrepancy

1. Admin Home tile: "Flagged discrepancies: N".
2. Clicks → Discrepancies page.
3. Each row shows: invoice ID, grand total, linked total, difference (₹ and %), operator, when flagged.
4. Admin opens a row → can either (a) **Mark resolved with note** (discrepancy is acknowledged, no data change) or (b) **Reverse the reconciliation** (creates an admin-initiated un-reconcile, atomic).
5. Audit entries written.

### Flow 7 — Admin configures payment sources

1. Admin → Settings → Payment Sources.
2. Page shows current mapping (e.g., UPI → [`upi_transactions`, `bank_statement` credits], Card → [`card_transactions`, `bank_statement` credits], Bank Transfer → [`bank_statement` credits], Cash → manual).
3. Admin can add/remove a source for any method.
4. Save → atomic update + audit entry.

### Error states (apply throughout)

| Situation | Behaviour |
|---|---|
| Operator selects a transaction whose remaining = 0 | Selection blocked; tooltip: "This transaction has been fully reconciled against other invoices." |
| Operator tries to claim more than remaining | Inline error: "Only ₹Y available on this transaction. Reduce the amount or pick another transaction." |
| Operator tries to save with `linked_total > grand_total` by ≤5% | Confirmation dialog: "You're linking ₹X but the invoice is ₹Y. This is an overpayment of ₹Z (W%). This will be flagged for admin review. Continue?" |
| Operator tries to save with `linked_total > grand_total` by >5% | Hard block: "Cannot save: linked payments exceed invoice amount by more than 5%. Please remove ₹Z of linked payments. If this is correct, ask admin for help." |
| Operator tries to save with `linked_total < grand_total` and has not confirmed partial | Confirmation dialog: "You've linked ₹X of ₹Y. ₹Z will remain outstanding. Save as partial reconciliation?" |
| Same transaction selected twice in one session | UI prevents — second click toggles off the first. |
| Concurrent reconciliation race (two operators grab the same transaction at the same time) | DB-level lock; second save returns: "This transaction was just used by another reconciliation. Please refresh and try again." |
| Network failure mid-save | No partial write — DB transaction rolls back. UI shows: "Save failed — nothing was changed. Please try again." |

---

## Functional Requirements

### Invoice list
- **FR-001** System shall display a paginated list of `hotel_invoice` records.
- **FR-002** Default sort: newest unreconciled first.
- **FR-003** Filters: reconciliation status (multi-select), invoice date range, guest name (substring), grand total range.
- **FR-004** Each row shows: invoice number, guest name, check-in/out dates, grand total, status badge, amount reconciled so far.
- **FR-005** `mmt_invoice` rows are shown in a separate "OTA Invoices (read-only)" tab. Clicking opens a read-only view.

### Invoice detail
- **FR-006** Shows all `hotel_invoice` fields (guest_name, source, arrival_time, departure_time, booking_id, booking_date, taxable_amount, cgst, sgst, grand_total, invoice_number).
- **FR-007** Shows `outstanding_amount = grand_total − sum(reconciliation_links.amount_applied)`.
- **FR-008** Shows current reconciliation status: `unreconciled` / `partial` / `fully_reconciled` / `flagged_for_review`.
- **FR-009** Shows already-linked payments with: method, source transaction ID, original amount, amount applied to this invoice, date, who linked it, when.
- **FR-010** Each linked payment has a (×) button → triggers Flow 4 (un-reconcile request).

### Add Payment panel
- **FR-011** Payment method selector with values: UPI, Card, Bank Transfer, Cash.
- **FR-012** OCR-suggested method (if extracted from invoice) is pre-selected; operator can override.
- **FR-013** Date picker (defaults to invoice date).
- **FR-014** For non-cash methods: system queries Admin-configured source tables for that `(method, date)` and renders a transactions table.
- **FR-015** Transactions table columns: identifier, time, original amount, used amount, remaining amount.
- **FR-016** Greys out (and disables selection of) transactions where `remaining = 0`.
- **FR-017** On click: prompt for amount-to-apply (defaults to `min(remaining, outstanding)`, operator can change).
- **FR-018** For cash: only date + amount inputs.
- **FR-019** Session-level "Linked payments" list with running total and remove buttons.
- **FR-020** **Save Reconciliation** button enforces all validation rules from "Error states" above.

### Reconciliation save (atomic)
- **FR-021** All inserts/updates from one save action execute inside a single Postgres transaction via an RPC function.
- **FR-022** Row-level locks (`SELECT ... FOR UPDATE`) are taken on each source transaction being claimed.
- **FR-023** After save: invoice's `reconciliation_status` is recomputed.
- **FR-024** Audit entry written before transaction commits (in the same transaction).

### Admin Home
- **FR-025** Total unreconciled invoice count.
- **FR-026** Total unreconciled invoice amount (₹).
- **FR-027** Count by status: unreconciled / partial / fully_reconciled / flagged_for_review.
- **FR-028** Aging buckets: 0–7 / 8–30 / 30+ days since invoice date for unreconciled and partial.
- **FR-029** Cash vs digital split (last 30 days).
- **FR-030** Pending approval requests count (link to Approvals page).
- **FR-031** Flagged discrepancies count (link to Discrepancies page).
- **FR-032** Recent audit log entries (last 20, with link to full log).

### Approvals
- **FR-033** Admin can view all pending requests in a table.
- **FR-034** Admin can approve (no note required) or reject (note required).
- **FR-035** Approval applies the change atomically + writes audit entry.

### Discrepancies
- **FR-036** Lists all reconciliations with `flagged_for_review = true`.
- **FR-037** Admin can mark resolved (with note) or reverse the reconciliation.

### Audit log
- **FR-038** Every mutation in the system writes an `audit_log` row.
- **FR-039** Audit log is append-only (no UPDATE/DELETE allowed; enforced by RLS + trigger).
- **FR-040** Audit log UI: filter by user, action type, date range, target entity (invoice/transaction/etc.).
- **FR-041** Each row expandable → shows before/after JSON.
- **FR-042** Both roles can read audit log; only Admin can filter by user.

### Payment-source configuration
- **FR-043** Admin UI to map each payment method to one or more source tables.
- **FR-044** Default seed: UPI → [upi_transactions, bank_statement], Card → [card_transactions, bank_statement], Bank Transfer → [bank_statement], Cash → manual.
- **FR-045** Changes are atomic + audited.

### Cash payments
- **FR-046** A `cash_payments` table stores manual cash entries (date, amount, created_by, created_at).
- **FR-047** Cash entries are surfaced uniformly through `reconciliation_links` (one link per usage).
- **FR-048** Operator cannot edit/delete a saved cash entry directly — must submit an approval request.

### Auth & roles
- **FR-049** Supabase Auth (email/password).
- **FR-050** A `user_profiles` table stores `role` (`admin` | `operator`).
- **FR-051** RLS policies on every table enforce role boundaries.
- **FR-052** Users are provisioned manually (admin runs SQL or Supabase Studio) for V1.

---

## Non-Functional Requirements

- **NFR-001 ACID:** every reconciliation save, approval, or admin action is one DB transaction.
- **NFR-002 Audit completeness:** no mutation path exists that does not write to `audit_log`.
- **NFR-003 Performance:** invoice list with 1000+ invoices loads in <1s (server-side pagination).
- **NFR-004 Transaction picker:** transactions table for any (method, date) loads in <500ms.
- **NFR-005 Error clarity:** every error visible to operators is plain language, no stack traces, no codes, and tells them what to do next.
- **NFR-006 Security:** RLS enforced on every reconciliation-related table. No service-role keys ever shipped to the browser.
- **NFR-007 Immutability of audit log:** enforced at DB level via revoked privileges + a `BEFORE UPDATE/DELETE` trigger that raises an exception.
- **NFR-008 Browser support:** latest Chrome and Safari on desktop only.

---

## Data Model

Existing tables (already in DB, untouched by V1 unless noted):
- `hotel_invoice` — walk-in invoices.
- `mmt_invoice` — OTA invoices (read-only in UI).
- `card_settlement`, `card_transactions`, `upi_transactions` — from HDFC MPR.
- `bank_statement` — HDFC bank statement rows.
- `files`, `extractions` — OCR/audit (existing).

### New tables (V1)

```sql
-- 1. User profiles (extends supabase.auth.users)
create table user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin','operator')),
  created_at timestamptz not null default now()
);

-- 2. Cash payments (manual entries)
create table cash_payments (
  id uuid primary key default gen_random_uuid(),
  payment_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  created_by uuid not null references user_profiles(user_id),
  created_at timestamptz not null default now()
);

-- 3. Reconciliation links (the heart of the system)
-- One row = one (invoice, source_transaction) pairing with the amount applied.
create table reconciliation_links (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references hotel_invoice(id) on delete restrict,
  source_table text not null check (source_table in (
    'upi_transactions','card_transactions','bank_statement','cash_payments'
  )),
  source_id uuid not null,                  -- FK enforced via trigger per source_table
  payment_method text not null check (payment_method in ('upi','card','bank_transfer','cash')),
  amount_applied numeric(14,2) not null check (amount_applied > 0),
  created_by uuid not null references user_profiles(user_id),
  created_at timestamptz not null default now()
);

create index on reconciliation_links (invoice_id);
create index on reconciliation_links (source_table, source_id);

-- 4. Approval requests
create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in (
    'unreconcile_link','unreconcile_invoice','cash_edit','cash_delete'
  )),
  target_invoice_id uuid references hotel_invoice(id),
  target_link_id uuid references reconciliation_links(id),
  target_cash_id uuid references cash_payments(id),
  payload jsonb,                            -- proposed change (e.g., new amount/date for cash_edit)
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null references user_profiles(user_id),
  requested_at timestamptz not null default now(),
  decided_by uuid references user_profiles(user_id),
  decided_at timestamptz,
  decision_note text
);

create index on approval_requests (status, requested_at);

-- 5. Discrepancies (one row per flagged reconciliation event)
create table discrepancies (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references hotel_invoice(id),
  invoice_total numeric(14,2) not null,
  linked_total numeric(14,2) not null,
  diff_amount numeric(14,2) not null,
  diff_percent numeric(6,3) not null,
  status text not null default 'open' check (status in ('open','resolved','reversed')),
  flagged_by uuid not null references user_profiles(user_id),
  flagged_at timestamptz not null default now(),
  resolved_by uuid references user_profiles(user_id),
  resolved_at timestamptz,
  resolution_note text
);

-- 6. Payment-source configuration
create table payment_source_config (
  id uuid primary key default gen_random_uuid(),
  payment_method text not null check (payment_method in ('upi','card','bank_transfer','cash')),
  source_table text not null check (source_table in (
    'upi_transactions','card_transactions','bank_statement','cash_payments'
  )),
  is_active boolean not null default true,
  unique (payment_method, source_table)
);

-- 7. Audit log (append-only)
create table audit_log (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references user_profiles(user_id),
  actor_role text,
  action text not null,                     -- e.g. 'reconcile.create','reconcile.remove','approval.approve' ...
  entity_type text not null,                -- 'invoice','reconciliation_link','cash_payment','approval_request', etc
  entity_id text,
  before_state jsonb,
  after_state jsonb,
  context jsonb                             -- IP, user agent, request id
);

create index on audit_log (occurred_at desc);
create index on audit_log (entity_type, entity_id);
create index on audit_log (actor_user_id);

-- Immutability: revoke update/delete + raise trigger
revoke update, delete on audit_log from public, authenticated, anon, service_role;
create function audit_log_block_mutation() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger no_update before update on audit_log
  for each row execute function audit_log_block_mutation();
create trigger no_delete before delete on audit_log
  for each row execute function audit_log_block_mutation();
```

### Derived: invoice reconciliation status

`reconciliation_status` for a `hotel_invoice` is computed on read (view or function):
- `linked_total = sum(reconciliation_links.amount_applied where invoice_id = X)`
- If `linked_total = 0` → `unreconciled`
- If `0 < linked_total < grand_total` → `partial`
- If `linked_total ≈ grand_total` (within ₹1) → `fully_reconciled`
- If `linked_total > grand_total` AND a `discrepancies` row exists with `status='open'` → `flagged_for_review`

A materialized column on `hotel_invoice` (`reconciliation_status text`) is updated by the `reconcile_invoice` RPC after every save, so list views avoid joins.

### Per-transaction `remaining` calculation

For a row in `upi_transactions` / `card_transactions` / `bank_statement` / `cash_payments`:
```
remaining = original_amount − sum(reconciliation_links.amount_applied
                                  where source_table = X and source_id = Y)
```
Exposed via a SQL view `v_transactions_with_remaining` per source table.

---

## API Contract (Supabase RPC + REST)

All client access goes through Supabase JS client. Mutations use **RPC functions** for atomicity.

### REST (auto-generated from tables, governed by RLS)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/hotel_invoice` | GET | both | Invoice list (with filters/sort/pagination) |
| `/hotel_invoice?id=eq.X` | GET | both | Invoice detail |
| `/mmt_invoice` | GET | both | OTA invoice read-only |
| `/reconciliation_links?invoice_id=eq.X` | GET | both | Linked payments for an invoice |
| `/v_transactions_for_method` | GET | both | Transactions for (method, date) with remaining |
| `/audit_log` | GET | both | Audit log (filtered by RLS) |
| `/approval_requests` | GET | both | Operator sees own; admin sees all |
| `/discrepancies` | GET | both | Admin sees all; operator sees own |
| `/payment_source_config` | GET | both | Read mapping |

### RPC functions (mutations, all atomic)

| Function | Caller | Effect |
|---|---|---|
| `rpc_reconcile_invoice(invoice_id, links jsonb, confirm_partial bool, confirm_overpay bool)` | operator/admin | Validates, inserts `reconciliation_links` rows, updates invoice status, writes audit, creates `discrepancies` row if overpay ≤5%. Hard error if overpay >5% or other invariants violated. |
| `rpc_request_unreconcile_link(link_id, reason)` | operator | Creates `approval_requests` row + audit. |
| `rpc_request_unreconcile_invoice(invoice_id, reason)` | operator | Creates `approval_requests` row + audit. |
| `rpc_request_cash_edit(cash_id, new_payload, reason)` | operator | Creates `approval_requests` row + audit. |
| `rpc_request_cash_delete(cash_id, reason)` | operator | Creates `approval_requests` row + audit. |
| `rpc_approve_request(request_id, note)` | admin | Applies the requested change atomically + audit. |
| `rpc_reject_request(request_id, note)` | admin | Marks rejected + audit. |
| `rpc_admin_reverse_reconciliation(invoice_id, note)` | admin | Removes all links for invoice + audit. |
| `rpc_resolve_discrepancy(discrepancy_id, note)` | admin | Marks `discrepancies.status='resolved'` + audit. |
| `rpc_create_cash_payment(payment_date, amount)` | operator/admin | Inserts `cash_payments` row + audit. |
| `rpc_upsert_payment_source_config(payment_method, source_tables jsonb)` | admin | Replaces mapping for a method + audit. |
| `rpc_admin_home_summary()` | admin | Returns the dashboard aggregates as one JSONB. |

All RPCs:
1. Run as `SECURITY DEFINER` with strict input validation.
2. Take row-level locks where needed.
3. Write to `audit_log` before commit.
4. Raise human-readable Postgres exceptions on invariant violation — the frontend maps these to operator-friendly toasts.

---

## UI Requirements

### Screens

1. **Login** — Supabase Auth email/password. No self-signup.
2. **Invoice List** (operator default landing).
   - Tab switcher: "Walk-in Invoices" (default) | "OTA Invoices (read-only)".
   - Filters bar: status (multi-select), date range, guest search, amount range.
   - Sortable columns: invoice number, guest, check-in, grand total, status, reconciled amount.
   - Status badges colour-coded: red (unreconciled), amber (partial), green (fully reconciled), purple (flagged).
   - Pagination (server-side, page size 50).
3. **Invoice Detail** — header (guest, dates, totals, status badge); "Linked Payments" panel; "Add Payment" panel; "Audit trail (this invoice only)" collapsible.
4. **Admin Home** (admin default landing) — tiles for FR-025 through FR-032.
5. **Approvals** — table + detail drawer.
6. **Discrepancies** — table + detail drawer.
7. **Audit Log** — table with filters; row expansion shows before/after JSON in a diff view.
8. **Settings → Payment Sources** (admin only) — matrix UI for the mapping.

### Component library
- shadcn/ui for primitives (Button, Dialog, Table, Tabs, Badge, Toast, Sheet, DataTable).
- Tailwind for layout/spacing/colour.
- TanStack Query for data fetching/caching.
- `zod` for client-side input validation (matched to server-side rules).
- `date-fns` for dates.

### Critical UI states
- **Empty:** "No invoices match your filters" / "No transactions on this date for this method — try another date."
- **Loading:** skeleton tables / spinners on tiles.
- **Error:** red banner at top of card explaining what's wrong and the action to take.
- **Success:** green toast (3s) confirming what just happened.

### Error message style guide
- Always tell the operator (a) what happened, (b) why, (c) what to do next.
- Examples:
  - Good: "Cannot save: this transaction has only ₹2,000 remaining, but you're trying to apply ₹5,000. Reduce the amount or pick another transaction."
  - Bad: "Validation failed."
  - Good: "This invoice already has ₹3,000 linked. Adding ₹8,000 would exceed the invoice total of ₹10,000 by more than 5%. Please reduce the amount you're applying."
  - Bad: "Overpayment threshold exceeded."

---

## Business Rules

- **BR-001** Walk-in invoices come from `hotel_invoice`. OTA invoices (`mmt_invoice`) are read-only.
- **BR-002** Amount to reconcile = `hotel_invoice.grand_total`.
- **BR-003** A single transaction's total `amount_applied` across all invoices ≤ its original amount.
- **BR-004** An invoice's `linked_total` may equal, be less than, or exceed `grand_total` (only with admin-reviewable flag and only if within 5%).
- **BR-005** Reconciliation status is computed; never edited directly.
- **BR-006** Discrepancy thresholds:
  - `|linked_total − grand_total| ≤ ₹1` → exact match (`fully_reconciled`).
  - `linked_total < grand_total` (anything below) → `partial`. Allowed.
  - `0 < linked_total − grand_total ≤ 5% of grand_total` → save with `discrepancies` row; `reconciliation_status = flagged_for_review`.
  - `linked_total − grand_total > 5% of grand_total` → **hard error**, do not save.
- **BR-007** No date constraint between invoice and transaction.
- **BR-008** Operator may never directly delete/update a saved `reconciliation_link`, `cash_payment`, or any audit row. All mutations to existing records go through `approval_requests`.
- **BR-009** Admin may un-reconcile or reverse anything atomically without needing an approval.
- **BR-010** Cash entries are on trust; no cross-checks against bank statement.
- **BR-011** "Payment link" terminology: a row in `reconciliation_links` representing one (invoice, transaction, amount) pairing. Removing one after save = requires admin approval (operator path) or is immediate (admin path).
- **BR-012** Concurrent reconciliation attempts on the same source transaction are serialised by Postgres row locks; second loser gets a clear "refresh and try again" error.
- **BR-013** Audit log is append-only and visible to both roles (admin can filter by user; operator sees their own actions plus system-wide reconciliations).
- **BR-014** All RPC functions reject calls from users whose role does not match the allowed roles for that function.

---

## Open Questions

None. All resolved.

---

## Addendum — MMT Payouts ingestion (2026-05-17)

This addendum adds a new data-pipeline document type to the existing OCR backend (`src/`). It does **not** change the V1 reconciliation app surface.

### Goal
The hotel receives one JSON file per MMT payout in a dedicated Google Drive folder. Each file is the parsed body of one MMT settlement email, containing:
- A single `transfer` object — the bank-leg of the payout (one bank credit).
- A `bookings[]` array — the individual MMT bookings included in that payout.

V1 ingestion needs to:
1. Discover JSON files in the Drive folder `1fhefZhFL81mth-UyeZonug0cfVxUX5-p`.
2. Parse the JSON deterministically (no LLM).
3. Insert one row into `mmt_payouts` and N rows into `mmt_bookings_payout`.
4. Be idempotent — re-running on the same file inserts nothing new.

### FR-053 — `mmt_payouts` table (the bank-leg of a payout)
Columns:
- `transaction_no TEXT PRIMARY KEY` — `transfer.transactionNo` (natural key).
- `file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE`.
- `subject_ref TEXT` — `subjectRef` (email subject ref like `HTLDOM0006832`).
- `email_date TIMESTAMPTZ` — `emailDate`.
- `exported_at TIMESTAMPTZ` — `exportedAt`.
- `processing_date TEXT NULL` — `transfer.processingDate` (often empty in source).
- `total_amount NUMERIC(15,2) NOT NULL` — `transfer.totalAmount`.
- `bank_name TEXT` — `transfer.bankName`.
- `beneficiary TEXT` — `transfer.beneficiary`.
- `account_number TEXT` — `transfer.accountNumber`.
- `transaction_date DATE` — `transfer.transactionDate` (`DD/MM/YYYY` in source).
- `total_bookings INTEGER` — `summary.totalBookings`.
- `total_payable_amount NUMERIC(15,2)` — `summary.totalPayableAmount`.
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.

Indexes: `(file_id)`, `(transaction_date)`, `(subject_ref)`.

### FR-054 — `mmt_bookings_payout` table (one row per booking in a payout)
Columns:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- `file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE`.
- `transaction_no TEXT NOT NULL REFERENCES mmt_payouts(transaction_no) ON DELETE CASCADE`.
- `booking_id TEXT NOT NULL` — `bookings[].bookingId` (same format as `mmt_invoice.booking_id`).
- `booking_pnr TEXT` — `bookings[].bookingPNR`.
- `client_name TEXT` — `bookings[].clientName`.
- `hotel_name TEXT` — `bookings[].hotelName`.
- `hotel_city TEXT` — `bookings[].hotelCity`.
- `check_in DATE` — `bookings[].checkIn`.
- `check_out DATE` — `bookings[].checkOut`.
- `original_cost NUMERIC(15,2)` — `bookings[].originalCost`.
- `payable NUMERIC(15,2)` — `bookings[].payable`.
- `booking_type TEXT` — `bookings[].bookingType`.
- `brand TEXT` — `bookings[].brand`.
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.

Constraints / indexes:
- `UNIQUE (transaction_no, booking_id)` — same booking in same payout exactly once. (A booking can legitimately appear in two different payouts; that's allowed.)
- Index on `(booking_id)` — supports cross-reference to `mmt_invoice.booking_id`.
- Index on `(transaction_no)` — FK lookups.
- Index on `(check_in)`, `(check_out)` — reporting.

### FR-055 — JSON processor (new)
A new `JsonProcessor` class in `src/processors/json_processor.py` that:
- Implements the `BaseProcessor` interface.
- Supports file extension `json`.
- `process()` parses bytes → dict and returns `raw_text = json.dumps(obj, indent=2)` plus metadata.
- Registered in `ProcessorFactory` so `factory.get_processor("json")` returns it.

### FR-056 — `json_direct_insert` pipeline path
In `src/main.py`, after the OCR output is stored, add a branch analogous to `excel_direct_insert`:
- Trigger when `file_type == 'json'` AND `doc_type_config.json_direct_insert == True`.
- The processor returns the parsed dict; the pipeline calls a new DB method `db.insert_mmt_payout_json(file_id, parsed_json)` that:
  - Parses `transfer.transactionDate` (`DD/MM/YYYY`) into ISO date.
  - Inserts `mmt_payouts` row with `ON CONFLICT (transaction_no) DO NOTHING`.
  - Inserts all `bookings[]` rows with `ON CONFLICT (transaction_no, booking_id) DO NOTHING`.
  - Returns `{success, payout_inserted, bookings_inserted, bookings_skipped, errors}`.
- On full success → file status = `completed`. On any exception → file status = `failed` (matches existing pattern).

### FR-057 — Config wiring
A new entry in `config.yaml`:
```yaml
  - document_type: mmt_payout
    drive_folder_id: "${MMT_PAYOUTS}"
    file_types: [json]
    json_direct_insert: true
    # fields list kept for table-manager compatibility; tables created by migration, not auto-DDL.
    fields: []
```
And in `.env`:
```
MMT_PAYOUTS=1fhefZhFL81mth-UyeZonug0cfVxUX5-p
```

### FR-058 — Drive discovery for JSON files
`drive/client.py` MIME-type map already supports common MIME types but JSON is missing. Add `'json' → 'application/json'`. Also ensure the discovery query falls through to the `name contains '.json'` filter if MIME-by-type returns nothing (Drive sometimes uploads `.json` as `text/plain`).

### Non-functional
- **Idempotency:** running the pipeline twice over the same file produces no duplicates and is not an error. (Existing discovery already skips known `drive_file_id`s; the `ON CONFLICT` is the second layer of defence.)
- **Atomicity:** payout + all its bookings are inserted in a single Supabase transaction-ish call sequence. Since supabase-py does not expose multi-statement transactions cleanly, the order is: insert payout first; if that succeeds (or hits conflict on an existing payout with identical body), insert bookings. A failure on bookings leaves the payout row intact and the file is marked `failed` so a retry replays cleanly under the `ON CONFLICT` guard.
- **No FK to `mmt_invoice`:** the payout JSON often arrives before the MMT invoice PDF is OCR'd, so a hard FK would cause race failures. A best-effort join in views/queries via `mmt_bookings_payout.booking_id = mmt_invoice.booking_id` is sufficient.

### Out of scope for this addendum
- UI for browsing payouts (V1.5).
- Reconciling payouts to `mmt_invoice` / `bank_statement` (V1.5 — that's the OTA-leg reconciliation deferred earlier).
- A separate `mmt_payout_reconciliation_links` table.

---

## Addendum — MMT/Goibibo invoice reconciliation via payout (2026-05-17)

This addendum brings MMT/Goibibo invoices **into the V1 reconciliation surface** (they were originally read-only). It adds a new, dedicated reconciliation panel that operates against the `mmt_invoice` + `mmt_bookings_payout` + `bank_statement` chain — co-existing with the existing UPI/Card/BankTransfer/Cash picker for those invoices.

### Goal
Operator opens a `hotel_invoice` where `source IN ('MakeMyTrip','Goibibo')`. Alongside the regular Add Payment panel, a second **"MMT Payout Reconcile"** panel appears that:
1. Lets the user pick a `booking_id` from `mmt_invoice` (dropdown, uniques, unreconciled-only).
2. Shows the line-item breakdown from `mmt_invoice` on one side, the `payable` from `mmt_bookings_payout` on the other.
3. Computes the expected payable from `mmt_invoice` line items via the formula
   `room_charges + extra_adult_child_charges + property_taxes − (go_mmt_commission + gst_on_commission + tcs + tds)`.
4. Allows **direct edits** of both sides (persists to `mmt_invoice` and `mmt_bookings_payout` rows immediately) until amounts match within ₹1.
5. Locates the corresponding `bank_statement` row via case-insensitive substring match `chq_ref_no ILIKE '%' || mmt_bookings_payout.transaction_no || '%'`.
6. On Reconcile: inserts one `reconciliation_links` row (`source_table='bank_statement'`, `payment_method='mmt_payout'`, `amount_applied = payable`), marks `mmt_invoice.reconciled_at` + `mmt_bookings_payout.reconciled_at`, and runs the same validation/lock/audit chain as the standard reconcile path.

The existing `rpc_admin_reverse_reconciliation` / approval flow handles un-reconciliation transparently because reconciliation is recorded via `reconciliation_links` exactly like every other method.

### FR-059 — Source-channel scoping
- The MMT Payout Reconcile panel renders ONLY when the open `hotel_invoice.source` is exactly `'MakeMyTrip'` or `'Goibibo'`. For all other sources, the panel is not rendered.
- For these invoices, the existing AddPaymentPanel (UPI/Card/BankTransfer/Cash) is **also rendered**. Operator chooses which to use.

### FR-060 — Schema additions
- Add to `mmt_invoice`:
  - `reconciled_at TIMESTAMPTZ NULL`
  - `reconciled_link_id UUID NULL REFERENCES reconciliation_links(id) ON DELETE SET NULL`
- Add to `mmt_bookings_payout`:
  - `reconciled_at TIMESTAMPTZ NULL`
  - `reconciled_link_id UUID NULL REFERENCES reconciliation_links(id) ON DELETE SET NULL`
- Add `'mmt_payout'` to the allowed values of `reconciliation_links.payment_method` CHECK constraint.
- Add `'mmt_payout'` to the allowed values of `payment_source_config.payment_method` CHECK constraint (so it can appear in the existing Source Config matrix; mapping is conceptual — the actual data source is always `bank_statement`).
- Seed one row into `payment_source_config`: `('mmt_payout','bank_statement', true)`.

### FR-061 — `rpc_get_mmt_reconcile_candidates(p_hotel_invoice_id uuid)` (RPC)
Returns, as JSON:
- `default_booking_id` — the `hotel_invoice.booking_id` if a matching `mmt_invoice` row exists (unreconciled), else null.
- `available_booking_ids` — array of `{booking_id, guest_name_hint, mmt_invoice_id}` for all `mmt_invoice` rows where `reconciled_at IS NULL`, ordered with the matching booking_id first if present, then by `mmt_invoice.created_at DESC`.

### FR-062 — `rpc_get_mmt_reconcile_detail(p_booking_id text)` (RPC)
Returns, as JSON:
- The full `mmt_invoice` row (latest by `created_at` if duplicates) — if none exists, error `MMT_INVOICE_NOT_FOUND` with friendly message "Invoice hasn't been processed yet. Please upload the MMT invoice PDF first."
- The matched `mmt_bookings_payout` row (filtered by `booking_id` AND `reconciled_at IS NULL`) — if zero rows, error `MMT_PAYOUT_NOT_FOUND` with message "Payment not in system yet. The MMT payout for this booking hasn't been received."
- If multiple unreconciled `mmt_bookings_payout` rows exist with that booking_id, error `MMT_PAYOUT_AMBIGUOUS` with the list.
- The matched `bank_statement` row: `WHERE chq_ref_no ILIKE '%' || payout.transaction_no || '%'`. Zero matches → error `MMT_BANK_NOT_FOUND`. >1 matches → error `MMT_BANK_AMBIGUOUS` with the list.
- Computed payable from formula vs. `mmt_bookings_payout.payable` — also returned with `match_within_tolerance` boolean (|diff| ≤ ₹1).
- Bank statement `deposit_amt`, `used_amount` (from existing remaining view), and `remaining` — caller uses this to know if the row has enough left.

### FR-063 — `rpc_update_mmt_invoice_fields(p_id uuid, p_fields jsonb)` (RPC)
- Operator/admin can update any of `room_charges`, `extra_adult_child_charges`, `property_taxes`, `service_charge`, `go_mmt_commission`, `gst_on_commission`, `tcs`, `tds` on `mmt_invoice`.
- Persists; writes audit row (`action='mmt_invoice.update'`, before/after).
- Rejected if `mmt_invoice.reconciled_at IS NOT NULL`.

### FR-064 — `rpc_update_mmt_bookings_payout_fields(p_id uuid, p_fields jsonb)` (RPC)
- Operator/admin can update `payable` on `mmt_bookings_payout`.
- Persists; writes audit row.
- Rejected if `mmt_bookings_payout.reconciled_at IS NOT NULL`.

### FR-065 — `rpc_reconcile_mmt_invoice(p_hotel_invoice_id uuid, p_mmt_invoice_id uuid, p_mmt_bookings_payout_id uuid, p_bank_statement_id uuid)` (RPC, ACID)
Atomic operation. All-or-nothing.
Validations (raise human-readable Postgres exception on any failure):
1. Caller is operator or admin.
2. `hotel_invoice.source ∈ ('MakeMyTrip','Goibibo')`.
3. `mmt_invoice.reconciled_at IS NULL` (SELECT FOR UPDATE).
4. `mmt_bookings_payout.reconciled_at IS NULL` (SELECT FOR UPDATE).
5. `mmt_bookings_payout.booking_id = mmt_invoice.booking_id`.
6. Computed payable from `mmt_invoice` formula matches `mmt_bookings_payout.payable` within ₹1.
7. `bank_statement.chq_ref_no ILIKE '%' || mmt_bookings_payout.transaction_no || '%'` (lock the row).
8. `bank_statement.deposit_amt - used = remaining`, and `remaining ≥ mmt_bookings_payout.payable` (with ₹1 tolerance).
9. Sum of all existing `reconciliation_links.amount_applied` for this `hotel_invoice` PLUS the new `payable` does NOT exceed `hotel_invoice.grand_total` by more than 5% — otherwise hard error (re-uses BR-006).
   - If 0 < overage ≤ 5%, allow but caller must pass `p_confirm_overpay=true`; sentinel `OVERPAY_CONFIRMATION_REQUIRED` raised otherwise.
   - If underpay (linked_total < grand_total after this save), allow but caller must pass `p_confirm_partial=true`; sentinel `PARTIAL_CONFIRMATION_REQUIRED` raised otherwise.

Effects on success:
- Insert one row into `reconciliation_links`: `source_table='bank_statement'`, `source_id=p_bank_statement_id`, `payment_method='mmt_payout'`, `amount_applied=payable`, `created_by=auth.uid()`.
- `UPDATE mmt_invoice SET reconciled_at=now(), reconciled_link_id=<new>` WHERE id=p_mmt_invoice_id.
- `UPDATE mmt_bookings_payout SET reconciled_at=now(), reconciled_link_id=<new>` WHERE id=p_mmt_bookings_payout_id.
- Recompute `hotel_invoice.reconciliation_status` via existing `fn_recompute_invoice_status`.
- Create `discrepancies` row if overpay branch taken (existing pattern).
- Audit row written (action `reconcile.create.mmt`, `before_state` includes the matched IDs and computed amounts).

Note on un-reconciliation: when `rpc_admin_reverse_reconciliation` (or approved unreconcile-link request) deletes the `reconciliation_links` row, the `ON DELETE SET NULL` on `reconciled_link_id` clears the back-pointer automatically. A small trigger (`trg_mmt_clear_reconciled_at_on_link_delete`) on `reconciliation_links` AFTER DELETE clears `reconciled_at` on the matched `mmt_invoice` and `mmt_bookings_payout` rows so they become available again.

### FR-066 — UI: MmtReconcilePanel
- Rendered on `invoices/[id]` ONLY when `hotel_invoice.source ∈ ('MakeMyTrip','Goibibo')`.
- Placed BELOW the existing AddPaymentPanel (visually distinct heading: "MMT Payout Reconcile").
- States:
  - **No booking_id selected yet** → dropdown of candidates from FR-061; helper text "Pick the MMT booking ID for this invoice."
  - **Loading** → spinner on detail card.
  - **MMT_INVOICE_NOT_FOUND** → amber inline card with explanation + link "Upload invoice via OCR queue" (no nav target needed in V1, just textual).
  - **MMT_PAYOUT_NOT_FOUND** → amber card: "Payment not in system yet."
  - **MMT_BANK_NOT_FOUND** → amber card: "No bank credit found matching this payout's transaction number."
  - **MMT_BANK_AMBIGUOUS / MMT_PAYOUT_AMBIGUOUS** → red card with bullet list of matches and "Resolve with admin before proceeding."
  - **Success state (all four sides loaded)** → two-column layout:
    - Left: editable fields for `mmt_invoice` (formula fields only) + computed-payable readout at bottom.
    - Right: editable `payable` for `mmt_bookings_payout` + transaction_no readout.
    - Between them: green check + "Amounts match (₹X)" or red X + "Amounts differ by ₹Y. Edit either side to match."
    - Below: callout card "Bank statement: ₹X deposit on YYYY-MM-DD (chq ref: ZZZ). Remaining after this knockoff: ₹W."
    - "Reconcile" button (primary). Disabled until amounts match within ₹1.
- On Reconcile click: call `rpc_reconcile_mmt_invoice`. Handle `PARTIAL_CONFIRMATION_REQUIRED` / `OVERPAY_CONFIRMATION_REQUIRED` sentinels with the same dialog pattern used in `AddPaymentPanel`.
- Field edits trigger debounced (400ms) `rpc_update_mmt_invoice_fields` / `rpc_update_mmt_bookings_payout_fields` calls; refetch the detail RPC after success so the match indicator updates.

### Business rules (this feature)
- **BR-015** MMT Payout Reconcile applies only to `hotel_invoice.source ∈ ('MakeMyTrip','Goibibo')`.
- **BR-016** Each `mmt_invoice.id` and each `mmt_bookings_payout.id` may participate in at most one active reconciliation at a time (enforced via `reconciled_at` UNIQUE-ish check and the `SELECT FOR UPDATE` in the RPC).
- **BR-017** Bank-statement substring match: `chq_ref_no ILIKE '%transaction_no%'`. Zero or >1 matches is a hard error.
- **BR-018** Field edits on `mmt_invoice` / `mmt_bookings_payout` are direct (no approval queue) and audit-logged.
- **BR-019** ₹1 rounding tolerance for amount match.
- **BR-020** Computed payable formula = `room_charges + extra_adult_child_charges + property_taxes − (go_mmt_commission + gst_on_commission + tcs + tds)`. `service_charge` is intentionally excluded.
- **BR-021** Re-reconciliation: a booking_id whose `mmt_invoice.reconciled_at IS NOT NULL` (or its payout's `reconciled_at IS NOT NULL`) is excluded from the dropdown.
- **BR-022** Un-reconciliation: handled by the existing reverse/un-reconcile flow. `ON DELETE SET NULL` on the reconciled-link FK + AFTER DELETE trigger clears `reconciled_at` on both linked rows.

### Out of scope for this addendum
- Multi-payout (split) reconciliation of a single mmt_invoice.
- Reconciling `mmt_invoice` rows whose corresponding `hotel_invoice` doesn't exist yet (the entry point is always a `hotel_invoice`).
- Auto-suggesting a booking_id beyond the simple `hotel_invoice.booking_id ↔ mmt_invoice.booking_id` match.

---

## Addendum — Bank Statement View (2026-05-18)

This addendum adds a **read-only, transactions-first ledger view** of the uploaded HDFC bank statement, with reconciled-invoice attribution, inline drill-downs into the card/UPI/MMT sub-transactions that constitute each bank credit, filters, and Excel export. It does NOT change the reconciliation workflow itself — mutations still happen on the invoice detail page.

### Goal
The operator/admin opens one place to see what the bank has actually credited (or debited) and what invoice(s) those credits have been reconciled against. The bank statement is the canonical base; everything else — card settlements, UPI settlements, MMT payouts — is shown as nested context against the bank line.

### FR-067 — Route, role access, layout
- New route: `/bank-statement`, rendered inside the existing `(app)` layout.
- Visible to BOTH `operator` and `admin` roles.
- Added as a new top-level item in the left nav between "Invoices" and "Audit Log", label "Bank Statement".
- Page is **read-only** in V1. No mutations on this page. Drill-down rows and links to invoice detail pages are clickable.

### FR-068 — Row scope and base query
- The base dataset is `bank_statement` rows where `deposit_amt > 0` (credits only). Withdrawals are NOT shown in V1.
- One screen row per `(bank_statement, reconciliation_link)` pair when the bank row has one or more `reconciliation_links` rows (i.e., **row-splitting** by invoice). A bank row with N linked invoices renders as N rows.
- A bank row with zero `reconciliation_links` renders as a single row with the linked-invoice column blank and an amber 2px left border (to signal "unreconciled").

### FR-069 — Columns shown (main table, in this order)
1. Date (`bank_statement.date`)
2. Narration (`bank_statement.narration`)
3. Cheque / Ref no (`bank_statement.chq_ref_no`)
4. Deposit amount (`bank_statement.deposit_amt`, formatted ₹)
5. Amount applied to invoice (`reconciliation_links.amount_applied` — only on split rows; blank on unreconciled)
6. Linked invoice (`hotel_invoice.invoice_number` clickable to `/invoices/{id}`; for `payment_method='mmt_payout'`, ALSO show the `mmt_bookings_payout.booking_id`; blank on unreconciled rows)
7. Method (`reconciliation_links.payment_method` — capitalised pill: `upi`, `card`, `bank_transfer`, `cash`, `mmt_payout`)
8. Closing balance (`bank_statement.closing_balance`)
9. Drill-down toggle (a `▸ / ▾` chevron on rows that have constituent transactions — see FR-070)

For "split" rows (row index ≥ 2 within the same bank row), columns 1–4, 8 are visually de-emphasised (`text-muted-foreground`) with a small `↳ split` tag in the Date cell; the drill-down chevron renders only on row index 1.

### FR-070 — Inline accordion drill-down classifier
A bank-statement row gets a chevron and is expandable if it falls into one of these classes (matched server-side):
- **UPI settlement**: `narration ILIKE '%UPI SETTLEMENT%'`. Drill-down lists all `upi_transactions` rows joined via `upi_transactions.card_settlement_id = card_settlement.id` where `card_settlement.net_amount = bank_statement.deposit_amt` AND `card_settlement.mpr_date BETWEEN bank_statement.date - INTERVAL '3 days' AND bank_statement.date`. Columns: `transaction_date`, `settlement_date`, `vpa`, `upi_transaction_id`, `amount`.
- **Card settlement**: `narration ILIKE '%CARDS SETTL%'`. Drill-down lists all `card_transactions` rows from the matching `card_settlement` (same join: `card_transactions.card_settlement_id = card_settlement.id` and matching by `net_amount = deposit_amt` AND `mpr_date BETWEEN date - 3 days AND date`). Columns: `transaction_date`, `settlement_date`, `gross_amount`, `mdr_percent`, **`net_after_mdr = gross_amount × (1 − mdr_percent/100)`** (computed in SQL).
- **MMT payout**: `chq_ref_no` non-empty AND there exists a `mmt_bookings_payout` row where `mmt_bookings_payout.transaction_no` is contained in `bank_statement.chq_ref_no` (case-insensitive substring, matches FR-062 logic). Drill-down lists all matching `mmt_bookings_payout` rows. Columns: `booking_id`, `client_name`, `hotel_name`, `check_in`, `check_out`, `payable`, and a "Hotel invoice" link if a `hotel_invoice` row exists with that `booking_id`.
- **None of the above**: no chevron, no drill-down (bank transfer / NEFT / cash deposit credits).

Classifier is exposed by the main RPC as a `drill_type ∈ ('upi_settlement','card_settlement','mmt_payout',null)` field per row, plus a count summary. The actual drill-down rows are fetched lazily on chevron click via a second RPC.

### FR-071 — Filters bar (above table)
- Date from / Date to (defaults: today − 30 days through today).
- Narration substring (`ILIKE '%term%'`).
- Cheque / Ref no substring.
- Method (multi-select: any of `upi / card / bank_transfer / cash / mmt_payout / unreconciled`). "Unreconciled" filters to bank rows with `link_count = 0`.
- Linked invoice number substring.
- Min amount / Max amount (applied to `deposit_amt`).
- Drill-down type (multi-select: `upi_settlement / card_settlement / mmt_payout / none`).
- "Clear filters" button resets to defaults (last-30 date window only).

### FR-072 — Sort, pagination, performance
- Default sort: `bank_statement.date DESC, value_dt DESC, bank_statement.id` for stable ties.
- Server-side pagination: 100 rows per page.
- The main RPC `rpc_get_bank_statement_view(...)` returns: paginated rows, total count, and per-row `drill_count` summary (a JSON blob `{upi_count, card_count, mmt_count}` so the UI can show "▸ 4 card transactions" without a round-trip).
- The drill-down RPC `rpc_get_bank_statement_drilldown(p_bank_statement_id uuid, p_drill_type text)` returns the nested rows on demand.
- Both RPCs are SECURITY DEFINER, role-checked (operator or admin), and **do NOT write audit log** — read-only operations are explicitly out of audit scope per existing pattern.

### FR-073 — Excel export
- "Export to Excel" button at the top-right of the page.
- Exports the **currently filtered** result set (across all pages, not just the visible page). Uses the same RPC with `p_page=null, p_page_size=null` to fetch the full unpaginated dataset, capped at 10,000 rows (V1 ceiling — surface a warning if hit).
- One row per split (so totals tie out). Columns: all 8 main columns from FR-069, PLUS `drill_type`, `upi_count`, `card_count`, `mmt_count`.
- Filename: `bank-statement_{date_from}_to_{date_to}.xlsx`.
- Implementation: client-side via `xlsx` (SheetJS), already a viable Next.js dep; the frontend agent installs it during M3.

### FR-074 — Empty / loading / error states
- **Loading**: skeleton rows on the table; spinner on the export button.
- **Empty (no rows match filters)**: "No bank-statement deposits match your filters. Try widening the date range or clearing filters."
- **Empty (no data uploaded)**: "No bank-statement rows have been uploaded yet. Upload an HDFC statement via the OCR pipeline first."
- **Error**: red banner explaining what failed and "Try refreshing the page."
- **Drill-down empty**: inside the expanded row, "No matching settlement found in our records — this bank credit may pre-date settlement ingestion or the amount/date doesn't tie out."

### Business rules (this feature)
- **BR-023** Bank Statement View shows only `deposit_amt > 0` rows. Withdrawals deferred (V1.5).
- **BR-024** Row-splitting: one screen row per `reconciliation_links` row attached to the bank row. Bank columns repeat with visual de-emphasis on splits.
- **BR-025** Drill-down classifier uses narration substring (`UPI SETTLEMENT`, `CARDS SETTL`) and MMT chq_ref_no substring match — NOT the `card_settlement.card`/`upi` columns (which are NULL in current data).
- **BR-026** Bank ↔ card_settlement join: `net_amount = deposit_amt AND mpr_date BETWEEN date - 3 days AND date`. If multiple settlements match, show ALL their constituent transactions in the drill-down (no error — the bank credit IS the union).
- **BR-027** This page is read-only. Mutations live on `/invoices/{id}`.
- **BR-028** Excel export uses the currently active filter set, capped at 10,000 rows.

### Out of scope for this addendum (V1.5)
- Withdrawal rows.
- Reconciling directly from this page (would require a "select bank row → pick invoice" inline flow; defer).
- Bank-statement ↔ MPR settlement reconciliation (already explicitly deferred per the V1 PRD § Out of Scope).
- Saved filter presets.
- CSV export (Excel only in V1).

---

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-18 | Bank Statement View is read-only in V1; no inline reconcile | Keeps scope focused; mutation surface stays at `/invoices/{id}` per V1 architecture. |
| 2026-05-18 | Deposits only (no withdrawals) | User-specified for V1. Withdrawals don't carry invoice attribution. |
| 2026-05-18 | Row-split per `reconciliation_links` row, bank cols de-emphasised on splits | User-specified: "if one transaction reconciles with multiple invoices, the row should just be split". |
| 2026-05-18 | Drill-down is inline accordion, not side panel/modal | User-specified; matches Excel-like density. |
| 2026-05-18 | Default date range = last 30 days | User-confirmed. |
| 2026-05-18 | Excel export in V1 | User-confirmed. SheetJS, client-side, full filtered set capped at 10k rows. |
| 2026-05-18 | Settlement classifier uses narration substring, not `card_settlement.card`/`upi` flags | DB reality check: both flag columns are NULL across all 44 settlement rows. |
| 2026-05-18 | Bank↔settlement join window = `mpr_date BETWEEN date−3 days AND date` | Real data shows bank credits land 0–2 days after MPR; 3-day window is safe without over-matching. |
| 2026-05-17 | Frontend: Next.js 14 + TypeScript + Tailwind + shadcn/ui talking directly to Supabase (with RLS), no FastAPI in the hot path | Fastest path; ACID via Postgres RPC; existing Python OCR backend keeps its scope; audit logic centralised at DB layer. |
| 2026-05-17 | OTA invoices (`mmt_invoice`) read-only, walk-in only reconcilable | V1 scope per user. |
| 2026-05-17 | Void/cancelled/refunded invoices not modelled in V1 | Deferred; will revisit when business adds the concept formally. |
| 2026-05-17 | Many-to-many transactions↔invoices supported via `reconciliation_links` with per-link `amount_applied` | Required by user; one transaction can be split across multiple invoices. |
| 2026-05-17 | Partial reconciliation allowed; saves commit immediately, no drafts | Simpler model; user confirmed. |
| 2026-05-17 | Discrepancy: ≤5% over = soft flag; >5% over = hard error; under = partial (always allowed) | User-specified threshold. |
| 2026-05-17 | Operator cannot directly mutate saved records; all changes via approval requests | User-specified for audit/checks. |
| 2026-05-17 | Bank statement contributes credit rows for UPI/Card/BankTransfer methods; no keyword-based filtering — show all day's credits | User-specified to keep simple. |
| 2026-05-17 | Cash purely on trust, no cross-checks | User-specified. |
| 2026-05-17 | Audit log immutable at DB level (revoke + trigger) | "No-nonsense" + "big focus on audit logs" mandate. |
| 2026-05-17 | Export deferred to V1.5 | User-specified. |
| 2026-05-17 | Notifications deferred (out of scope V1) | User-specified. |
| 2026-05-17 | Mobile deferred — desktop only | User-specified. |
| 2026-05-17 | Single property; multi-property deferred | User-specified. |
| 2026-05-17 | "Payment link" = one row in `reconciliation_links`. Removing after save requires admin approval (for operator). | Clarification per user. |
| 2026-05-17 | Admin Home dashboard (lightweight, 8 tiles) included in V1 | User-confirmed. |
| 2026-05-17 | Users provisioned manually (no self-signup, no admin "create user" UI) in V1 | User-specified. |
| 2026-05-17 | MMT payout JSON ingested as a new `mmt_payout` document type with `json_direct_insert: true` — no LLM, deterministic parse | Pattern mirrors `excel_direct_insert`; JSON is already structured. |
| 2026-05-17 | `mmt_payouts.transaction_no` is the natural PK; `mmt_bookings_payout` uses `UNIQUE(transaction_no, booking_id)` for dedup | One bank-transaction-ID per payout; a booking can be in at most one payout (typically) but two payouts is allowed (refunds/adjustments). |
| 2026-05-17 | No FK from `mmt_bookings_payout.booking_id` to `mmt_invoice.booking_id` | OCR of invoice PDFs and ingestion of payout JSONs race; an index suffices for join performance. |
| 2026-05-17 | Use `INSERT ... ON CONFLICT DO NOTHING` for both inserts | Makes re-runs idempotent without a separate "seen" check. |
| 2026-05-17 | RLS disabled on `mmt_payouts` / `mmt_bookings_payout` (pipeline tables, like other extraction tables) | Existing pattern — only V1 reconciliation tables have RLS on. |
| 2026-05-17 | MMT-reconcile panel co-exists with the standard AddPaymentPanel for `source IN ('MakeMyTrip','Goibibo')` — not a replacement | User-specified; some MMT invoices may settle outside the payout flow. |
| 2026-05-17 | MMT field edits (mmt_invoice formula fields, payout payable) persist directly with no approval gate | User-specified; pipeline tables are outside the approval boundary. |
| 2026-05-17 | `service_charge` intentionally excluded from the MMT payable formula | User-confirmed; MMT does not pay service charge through to hotel. |
| 2026-05-17 | Bank match by case-insensitive substring `chq_ref_no ILIKE '%transaction_no%'` | User-specified. Zero or >1 matches = hard error. |
| 2026-05-17 | Single `reconciliation_links` row per MMT reconcile (`source_table='bank_statement'`, `payment_method='mmt_payout'`) — no new link rows for mmt_invoice/payout | Keeps existing remaining/locking/audit logic untouched. |
| 2026-05-17 | New `reconciled_at` + `reconciled_link_id` columns on both `mmt_invoice` and `mmt_bookings_payout` | Fast dropdown filtering + clean back-pointer for un-reconcile cascade. |
| 2026-05-17 | V1 of this feature is one-to-one only (one mmt_invoice ↔ one mmt_bookings_payout ↔ one bank_statement) | Multi-payout split deferred. |
