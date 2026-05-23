<!-- Last updated: 2026-05-23 (Phase PF — Payment Folio Upload + Auto-select + Resolve guard) -->
<!-- Previous: 2026-05-23 (RI-1 + RI-2 built — FR-094 finalized to trigger approach) -->
<!-- Previous: 2026-05-19 18:30 -->

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

## Addendum — Yatra payout reconciliation (2026-05-19)

This addendum brings **Yatra-sourced `hotel_invoice` rows into the V1 reconciliation surface** via a dedicated panel that mirrors the MMT Direct Reconcile flow (FR-059..FR-066). Yatra payouts arrive as structured email-derived JSON (one JSON file per booking, voucher-keyed) and are credited into the HDFC bank account exactly like every other UPI/card/bank_transfer payment — there is no separate Yatra payout bank-line concept (unlike MMT).

The reconciliation chain is therefore: `hotel_invoice` (source contains "Yatra") ↔ `yatra_bookings_payout` (commercials JSON) ↔ a bank-statement transaction picked manually by the operator (same UX as the walk-in transaction picker, scoped to UPI / Card / Bank Transfer — **never Cash**).

### Goal
Operator opens a `hotel_invoice` where `source ILIKE '%Yatra%'`. Alongside the regular Add Payment panel, a second **"Yatra Payout Reconcile"** panel appears that:
1. Lets the operator pick the matching `voucherNo` from `yatra_bookings_payout` via a searchable dropdown of unreconciled bookings (auto-default by case-insensitive guest-name match against `hotel_invoice.guest_name`).
2. Shows the full Yatra commercials breakdown (read-only summary + a small set of editable deduction fields, identical pattern to MMT).
3. Trusts `yatra_to_pay_hotel` as the canonical reconcile amount (no formula recomputation — the value as supplied by Yatra is what the bank credit must equal).
4. Lets the operator pick the actual bank credit from the standard transaction picker (UPI / Card / Bank Transfer methods), filtered to the day the payout was emailed (`emailDate`) ±3 days, with the standard remaining-amount/used-flag rules.
5. On Reconcile: inserts one `reconciliation_links` row with `source_table` set to the actual underlying source (`upi_transactions` / `card_transactions` / `bank_statement`) and `payment_method` set to the **real underlying method** (`upi` / `card` / `bank_transfer`) — **NOT** a new `yatra_payout` value (per Decision 2026-05-19, Option B). Marks `yatra_bookings_payout.reconciled_at` + `reconciled_link_id` for back-pointer. Runs the same validation / lock / overpay / partial / audit chain as the standard reconcile path.

The existing `rpc_admin_reverse_reconciliation` / approval flow handles un-reconciliation transparently because reconciliation is recorded via `reconciliation_links` exactly like every other method. The Yatra back-pointer cleanup uses the same `ON DELETE SET NULL` + AFTER DELETE trigger pattern proven on the MMT side.

### FR-075 — Source-channel scoping
- The Yatra Payout Reconcile panel renders ONLY when the open `hotel_invoice.source` matches `ILIKE '%Yatra%'` (case-insensitive substring; tolerates any prefix/suffix variant the OCR pipeline produces). For all other sources, the panel is not rendered.
- For Yatra invoices, the existing AddPaymentPanel (UPI/Card/BankTransfer/Cash) is **also rendered**. Operator chooses which to use.
- This source-test is exposed both in the frontend (gating render of the panel) and the backend (an RPC role-and-source guard, so a malicious operator cannot reconcile a non-Yatra invoice through the Yatra RPC).

### FR-076 — Schema: `yatra_bookings_payout` table (new)
Single new table. RLS disabled (pipeline table, same pattern as `mmt_bookings_payout`).

```sql
CREATE TABLE yatra_bookings_payout (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id               UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  voucher_no            TEXT NOT NULL,               -- e.g. "10004069119091"
  booking_id            TEXT NULL,                   -- raw booking reference from email body, if present
  guest_name            TEXT NULL,                   -- as supplied by Yatra
  hotel_name            TEXT NULL,                   -- from hotel.name in JSON
  check_in              DATE NULL,                   -- booking.checkIn
  check_out             DATE NULL,                   -- booking.checkOut
  booking_date          DATE NULL,                   -- booking.bookingDate
  is_pre_pay            BOOLEAN NULL,                -- booking.isPrePay
  email_date            DATE NULL,                   -- emailDate (when the payout email was sent)
  exported_at           TIMESTAMPTZ NULL,            -- exportedAt timestamp from JSON
  -- Commercials (all numeric, all editable per FR-079):
  total_tariff          NUMERIC NULL,
  service_tax           NUMERIC NULL,
  yatra_commission_pct  NUMERIC NULL,
  yatra_commission_amt  NUMERIC NULL,
  tds_pct               NUMERIC NULL,
  tds_amt               NUMERIC NULL,
  gst_on_commission     NUMERIC NULL,
  yatra_to_pay_hotel    NUMERIC NOT NULL,            -- canonical reconcile amount; trusted as-is
  -- Reconcile back-pointers:
  reconciled_at         TIMESTAMPTZ NULL,
  reconciled_link_id    UUID NULL REFERENCES reconciliation_links(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT yatra_bookings_payout_voucher_unique UNIQUE (voucher_no)
);

CREATE INDEX idx_yatra_bookings_payout_voucher_no ON yatra_bookings_payout (voucher_no);
CREATE INDEX idx_yatra_bookings_payout_guest_lower ON yatra_bookings_payout (lower(guest_name));
CREATE INDEX idx_yatra_bookings_payout_email_date ON yatra_bookings_payout (email_date);
CREATE INDEX idx_yatra_bookings_payout_unreconciled ON yatra_bookings_payout (voucher_no) WHERE reconciled_at IS NULL;
```

- `voucher_no` is the **natural dedup key** (each booking has exactly one voucher across the life of a reconciliation). On re-send (amendment / cancellation), the inserter uses `ON CONFLICT (voucher_no) DO NOTHING` — re-sends are silently ignored (mirrors MMT behaviour).
- No FK from `yatra_bookings_payout` to `hotel_invoice` — same race-avoidance reasoning as MMT.
- No `payment_source_config` enum extension needed for `'yatra_payout'` — per Decision 2026-05-19 (Option B), Yatra payouts always reconcile under their real underlying method (`upi`/`card`/`bank_transfer`), which is already in the existing config. We DO add a seed row of `('yatra_bookings_payout','available_for_reconcile')` only if/when a future Source Config screen treats Yatra as a context source; in V1 this is unnecessary and Y1 explicitly skips it.

### FR-077 — Schema: trigger for un-reconcile cascade
Add an AFTER-DELETE trigger on `reconciliation_links` (or extend the existing `trg_mmt_clear_reconciled_at_on_link_delete` to also cover Yatra) that, for the deleted row, clears `yatra_bookings_payout.reconciled_at = NULL, reconciled_link_id = NULL` WHERE `reconciled_link_id = OLD.id`. Name: `trg_yatra_clear_reconciled_at_on_link_delete`.

### FR-078 — Backend: Yatra payout JSON ingestion
New ingester mirrors the MMT pattern:
- New document type `yatra_payout` in `config.yaml` with `json_direct_insert: true`, `file_types: [json]`, drive folder env var `YATRA_PAYOUTS` (Drive folder ID to be supplied in `.env`).
- New module `src/database/yatra_payout_inserter.py` with `insert_yatra_payout_json(file_id, parsed_json)` that:
  1. Parses the JSON envelope. Expected top-level keys (operator-confirmed): `voucherNo`, `bookingId` (optional), `guestName` (optional), `emailDate`, `exportedAt`, `isPrePay`, `hotel: {name}`, `booking: {checkIn, checkOut, bookingDate}`, plus all commercials fields.
  2. Performs a single `INSERT ... ON CONFLICT (voucher_no) DO NOTHING` into `yatra_bookings_payout`. Re-sends are ignored without error.
  3. Returns the inserted row id (or NULL when the conflict path was taken — caller marks the file `completed` either way).
- Factory routing (`src/processors/factory.py`) recognises the new type and routes to the existing `JsonProcessor` (no new processor class needed; JSON parsing is shared).
- Discovery: same JSON MIME-type fallthrough as FR-058 (already implemented).
- Pipeline is idempotent under re-run — running the same JSON file twice produces no duplicates and no errors.

### FR-079 — `rpc_get_yatra_reconcile_candidates(p_hotel_invoice_id uuid)` (RPC)
Returns, as JSON:
- `default_voucher_no` — the `yatra_bookings_payout.voucher_no` of the unreconciled row whose `lower(guest_name)` best matches `lower(hotel_invoice.guest_name)` (exact match preferred; if none, NULL — no fuzzy matching in V1).
- `available_vouchers` — array of `{voucher_no, guest_name, hotel_name, check_in, check_out, yatra_to_pay_hotel, email_date}` for all `yatra_bookings_payout` rows where `reconciled_at IS NULL`, ordered with the matching voucher first (if present), then by `email_date DESC NULLS LAST`, then `created_at DESC`.
- Role-checked (operator or admin). `SECURITY DEFINER`. No audit write (read-only).

### FR-080 — `rpc_get_yatra_reconcile_detail(p_voucher_no text)` (RPC)
Returns, as JSON, the full `yatra_bookings_payout` row plus:
- `is_already_reconciled` boolean (caller renders a friendly read-only state if true).
- `linked_invoice_id` / `linked_invoice_number` if a `reconciliation_links` row exists for the back-pointed link (best-effort join via `reconciled_link_id`).
- If voucher does not exist: error sentinel `YATRA_VOUCHER_NOT_FOUND` with message "Payout for this voucher hasn't been received yet. Please wait for the Yatra payout email or upload the JSON manually."

Role-checked. `SECURITY DEFINER`. No audit write.

### FR-081 — `rpc_update_yatra_bookings_payout_fields(p_id uuid, p_fields jsonb)` (RPC)
- Operator/admin can update any of the editable commercials fields: `total_tariff`, `service_tax`, `yatra_commission_pct`, `yatra_commission_amt`, `tds_pct`, `tds_amt`, `gst_on_commission`, `yatra_to_pay_hotel`. Plus the contextual fields `guest_name`, `hotel_name`, `check_in`, `check_out`, `booking_date`, `is_pre_pay`, `email_date`. **NOT editable:** `voucher_no` (it is the natural key), `file_id`, `exported_at`, `reconciled_at`, `reconciled_link_id`, `id`, `created_at`.
- Persists directly (no approval queue — same pattern as MMT field edits, BR-018).
- Writes audit row: `action='yatra_bookings_payout.update'`, `entity_type='yatra_bookings_payout'`, `entity_id=p_id`, with before/after JSON.
- Rejected with sentinel `YATRA_PAYOUT_LOCKED` if `reconciled_at IS NOT NULL`.
- Role-checked (operator or admin). `SECURITY DEFINER`.

Note: there is intentionally **one** field-edit RPC (not two like MMT) because Yatra reconciliation only edits the payout table — there is no separate "yatra_invoice" entity. The `hotel_invoice` row is edited (when needed) through existing operator/admin flows already in V1.

### FR-082 — `rpc_reconcile_yatra_invoice(p_hotel_invoice_id uuid, p_yatra_bookings_payout_id uuid, p_source_table text, p_source_id uuid, p_payment_method text, p_amount_applied numeric, p_confirm_partial bool, p_confirm_overpay bool)` (RPC, ACID)
Atomic. All-or-nothing.

Inputs:
- `p_source_table` ∈ `('upi_transactions','card_transactions','bank_statement')`.
- `p_payment_method` ∈ `('upi','card','bank_transfer')` — **`cash` is rejected** (per Decision 2026-05-19, FR-075 scope).
- `p_amount_applied` = the amount the operator wants to apply (typically `yatra_to_pay_hotel` itself, but the panel allows partial-fill against an under-credit).

Validations (raise human-readable Postgres exception on any failure):
1. Caller is operator or admin.
2. `hotel_invoice.source ILIKE '%Yatra%'`.
3. `yatra_bookings_payout.reconciled_at IS NULL` (SELECT FOR UPDATE).
4. `p_payment_method` ≠ `'cash'` — sentinel `YATRA_CASH_NOT_ALLOWED` otherwise.
5. `(p_source_table, p_payment_method)` is an active row in `payment_source_config` (re-uses existing validation).
6. The source row at `(p_source_table, p_source_id)` has `remaining ≥ p_amount_applied` (re-uses `fn_lock_and_get_source_amount` for SELECT FOR UPDATE + remaining check).
7. The same overpay rule as the V1 RPC: sum of all existing `reconciliation_links.amount_applied` for this `hotel_invoice` PLUS the new `p_amount_applied` does NOT exceed `hotel_invoice.grand_total` by more than 5%. Sentinels `OVERPAY_CONFIRMATION_REQUIRED` / hard error per BR-006 — identical contract to the V1 core RPC.
8. If under-pay (linked_total < grand_total after this save), require `p_confirm_partial=true`; sentinel `PARTIAL_CONFIRMATION_REQUIRED` otherwise.

Effects on success:
- Insert one row into `reconciliation_links`: `source_table=p_source_table`, `source_id=p_source_id`, `payment_method=p_payment_method`, `hotel_invoice_id=p_hotel_invoice_id`, `amount_applied=p_amount_applied`, `created_by=auth.uid()`.
- `UPDATE yatra_bookings_payout SET reconciled_at=now(), reconciled_link_id=<new>` WHERE id=p_yatra_bookings_payout_id.
- Recompute `hotel_invoice.reconciliation_status` via `fn_recompute_invoice_status`.
- Create `discrepancies` row if overpay branch taken (existing pattern).
- Audit row: `action='reconcile.create.yatra'`, `entity_type='hotel_invoice'`, `entity_id=p_hotel_invoice_id`, `before_state` includes the matched IDs, voucher_no, source method, and amounts.

Role-checked. `SECURITY DEFINER`. `GRANT EXECUTE TO authenticated`.

### FR-083 — UI: YatraReconcilePanel
- Rendered on `invoices/[id]` ONLY when `hotel_invoice.source ILIKE '%Yatra%'`.
- Placed BELOW the existing AddPaymentPanel (visually distinct heading: "Yatra Payout Reconcile"). When both Yatra and MMT criteria match (impossible by data, but defensive), Yatra panel sorts after MMT panel.
- States:
  - **No voucher selected yet** → searchable dropdown of candidates from FR-079; helper text "Pick the Yatra voucher for this invoice. We've auto-selected the closest guest-name match." Default value is `default_voucher_no` if present.
  - **Loading** → spinner on detail card.
  - **YATRA_VOUCHER_NOT_FOUND** → amber inline card: "Payout for this voucher hasn't been received yet. Please wait for the Yatra payout email or upload the JSON manually."
  - **Already reconciled** → read-only summary with the linked invoice number and a back-link.
  - **Success state (voucher loaded, unreconciled)** → two-column layout:
    - Left: editable Yatra commercials block (the eight numeric fields from FR-081) + booking context (guest, hotel, check-in/out, email date) — all editable, debounced commit on blur, audit-logged.
    - Right: the standard **transaction picker** (UPI / Card / Bank Transfer only — Cash is suppressed). Same UX as the walk-in flow: method dropdown, date input (defaulted to `email_date` ±3 days suggestion text), `rpc_search_transactions_with_remaining` listing with greyed-out rows for `remaining=0`, click-to-pick modal.
    - Between them: green check + "Will apply ₹X" or red X + "Pick a transaction with remaining ≥ ₹Y" (Y = `yatra_to_pay_hotel`).
    - Below: "Reconcile" button (primary). Disabled until a transaction is picked AND `remaining ≥ yatra_to_pay_hotel` (or the operator explicitly toggles a partial-fill input).
- On Reconcile click: call `rpc_reconcile_yatra_invoice`. Handle `PARTIAL_CONFIRMATION_REQUIRED` / `OVERPAY_CONFIRMATION_REQUIRED` / `YATRA_CASH_NOT_ALLOWED` sentinels with the same dialog pattern used in `AddPaymentPanel` and `MmtReconcilePanel`.
- Field edits trigger debounced (400ms) `rpc_update_yatra_bookings_payout_fields` calls; refetch the detail RPC after success so the "amount to apply" indicator updates.
- After successful Reconcile: collapse the panel and re-fetch the parent invoice detail (the new reconciliation_links row will surface in the Linked Payments table with method = `upi` / `card` / `bank_transfer`, NOT `yatra_payout`).

### Error sentinels (this feature)
| Sentinel | Source | Meaning |
|---|---|---|
| `YATRA_VOUCHER_NOT_FOUND` | `rpc_get_yatra_reconcile_detail` | Voucher not present in `yatra_bookings_payout`. |
| `YATRA_PAYOUT_LOCKED` | `rpc_update_yatra_bookings_payout_fields` | Edit attempt against an already-reconciled payout row. |
| `YATRA_CASH_NOT_ALLOWED` | `rpc_reconcile_yatra_invoice` | Caller passed `p_payment_method='cash'`. |
| `PARTIAL_CONFIRMATION_REQUIRED` | `rpc_reconcile_yatra_invoice` | Under-pay path needs explicit confirmation (re-uses V1 contract). |
| `OVERPAY_CONFIRMATION_REQUIRED` | `rpc_reconcile_yatra_invoice` | Soft overpay (≤5%) needs explicit confirmation. |

### Business rules (this feature)
- **BR-029** Yatra Payout Reconcile applies only to `hotel_invoice.source ILIKE '%Yatra%'`. The match is case-insensitive substring (operator-confirmed: tolerates pipeline source-string variants).
- **BR-030** Each `yatra_bookings_payout.id` may participate in at most one active reconciliation at a time (enforced via `reconciled_at` + `SELECT FOR UPDATE` in the RPC).
- **BR-031** Yatra reconciliation **never uses Cash**. Allowed methods are `upi`, `card`, `bank_transfer` only.
- **BR-032** `yatra_to_pay_hotel` is trusted as-is. No recomputation cross-check against the deduction breakdown — operators can edit any field including `yatra_to_pay_hotel` directly.
- **BR-033** Field edits on `yatra_bookings_payout` are direct (no approval queue) and audit-logged.
- **BR-034** Re-sends of the same voucher (amendment / cancellation) are silently ignored via `ON CONFLICT (voucher_no) DO NOTHING`. Operator must manually edit fields if Yatra corrects a value.
- **BR-035** `reconciliation_links.payment_method` for a Yatra reconciliation always carries the **real underlying method** (`upi` / `card` / `bank_transfer`) — never a new `yatra_payout` value. Yatra context lives on the `yatra_bookings_payout` row via the back-pointer.
- **BR-036** Bank Statement View drill-down for Yatra-reconciled rows: show `voucher_no` + `guest_name` as the drill content (same accordion class as the MMT drill, see FR-070 and FR-085).
- **BR-037** MIS report breaks out Yatra as a separate source (alongside MMT, Walk-in, etc.) — see FR-086.

### FR-084 — Historical backfill (one-shot)
A separate one-shot script (`scripts/backfill_yatra_payouts.py` or a SQL migration) that, when Yatra payout JSONs are first ingested:
- For each existing `hotel_invoice` row where `source ILIKE '%Yatra%'` AND `reconciliation_status = 'unreconciled'`, attempt to auto-match against `yatra_bookings_payout` by:
  1. `lower(yatra_bookings_payout.guest_name) = lower(hotel_invoice.guest_name)` AND
  2. `yatra_bookings_payout.reconciled_at IS NULL`.
- Reports matches as a CSV (NOT an auto-reconcile) for the operator to review and reconcile through the UI. **No automatic insert of `reconciliation_links`** — backfill is advisory, the actual reconciliation goes through the standard RPC so audit trail is intact.
- At time of writing (2026-05-19), the DB contains zero Yatra-sourced `hotel_invoice` rows, so this script is a no-op until Yatra JSONs land. It is included for completeness.

### FR-085 — Bank Statement View drill-down: Yatra extension
Extend the drill-down classifier (FR-070) so that for any `bank_statement` row reconciled via a `reconciliation_links` row whose `reconciled_link_id` back-points from a `yatra_bookings_payout` row, the drill content additionally shows:
- `voucher_no`
- `guest_name`
- `hotel_name`
- `yatra_to_pay_hotel`
- A "Hotel invoice" link to `/invoices/{id}` (the linked invoice).

Implementation: the existing `rpc_get_bank_statement_drilldown` learns a new `drill_type` branch (`'yatra_payout'`) and a new server-side classifier rule:
- A `bank_statement` row is classified as `yatra_payout`-drillable when at least one of its `reconciliation_links` rows has a back-pointer chain `reconciliation_links.id = yatra_bookings_payout.reconciled_link_id`.
- The classifier returns `drill_type='yatra_payout'` with `yatra_count = N` in the per-row drill summary so the UI can show "▸ N Yatra vouchers".

### FR-086 — MIS report: Yatra as a separate source
Extend the existing `v_mis_monthly_summary` / `v_mis_payment_detail` views (or add a sibling view) so that Yatra-sourced reconciled invoices appear as their own source breakdown row. The classification rule:
- A reconciled `hotel_invoice` is attributed to "Yatra" when its `source ILIKE '%Yatra%'` OR when any of its `reconciliation_links` rows links back to a `yatra_bookings_payout` row.
- The breakdown sits alongside "MakeMyTrip", "Goibibo", "BookingDotCom", "Walk-in", etc., with the same column set (count, gross, reconciled, unreconciled, partial).

### Out of scope for this addendum
- Multi-voucher (split) reconciliation against a single `hotel_invoice` in one click — operator can chain via the standard partial flow (existing pattern).
- Auto-reconciling backfilled matches without operator review (FR-084 is advisory only).
- A new `yatra_payout` value in the `payment_method` enum (rejected per Decision 2026-05-19, Option B).
- Including `cash` as an allowed reconcile method (explicitly disallowed per BR-031).
- A separate "Yatra invoice" entity equivalent to `mmt_invoice` (Yatra's invoice data IS the payout JSON; no PDF-OCR side ingestion).
- Auto-suggesting the bank statement transaction from `voucher_no` (operator-confirmed: `voucher_no` never appears in narration/`chq_ref_no`, so we use the standard date-bounded transaction picker, exactly like walk-in).

---

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-19 | Yatra reconciliation uses Option B: `reconciliation_links.payment_method` carries the **real underlying method** (`upi`/`card`/`bank_transfer`), NOT a new `yatra_payout` enum value | Avoids polluting the method enum; Yatra context lives on the back-pointed `yatra_bookings_payout` row. Cleaner downstream reporting. |
| 2026-05-19 | Yatra source match is `ILIKE '%Yatra%'` (case-insensitive substring) | Tolerates pipeline source-string variants ("Yatra", "Yatra.com", etc.) without coupling to one exact spelling. |
| 2026-05-19 | `yatra_to_pay_hotel` is trusted as-is — no formula recomputation cross-check | Operator-confirmed; the Yatra-supplied final payable is the canonical reconcile amount. Operators can edit it directly if needed. |
| 2026-05-19 | Cash is NOT a permitted reconcile method for Yatra (BR-031) | Yatra never pays out via cash; allowed methods are `upi`/`card`/`bank_transfer`. |
| 2026-05-19 | Yatra re-sends (amendment/cancellation) handled via `ON CONFLICT (voucher_no) DO NOTHING` | Mirrors MMT idempotency contract. Operator edits fields manually if a correction is needed. |
| 2026-05-19 | Yatra auto-match by guest-name only (no booking_id linkage) | `hotel_invoice.booking_id` is not populated with Yatra data; lowercased exact-match on `guest_name` is the only deterministic signal in V1. |
| 2026-05-19 | Single `reconciliation_links` row per Yatra reconcile (linking to the actual underlying transaction) — no separate Yatra link row | Same pattern as MMT (single link row); keeps existing remaining/locking/audit logic untouched. |
| 2026-05-19 | New `reconciled_at` + `reconciled_link_id` columns on `yatra_bookings_payout`; back-pointer cleared via AFTER DELETE trigger on `reconciliation_links` | Same proven pattern as MMT (FR-077). |
| 2026-05-19 | One field-edit RPC for Yatra (`rpc_update_yatra_bookings_payout_fields`), not two | There is no "yatra_invoice" entity equivalent to `mmt_invoice` — all editable Yatra data lives on the single payout row. |
| 2026-05-19 | Historical backfill is advisory CSV only — not auto-reconcile | Keeps the audit trail intact; operator reviews each match through the UI / RPC. |
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
| 2026-05-19 | **Drop the `UNIQUE (voucher_no)` constraint on `yatra_bookings_payout`** (supersedes earlier FR-076 spec). Duplicate voucher imports are detected at the app layer in the inserter, the duplicate is **skipped and logged**, NOT silently ignored. | User-specified: "Skip and flag (log) if same voucher re-imported." Allows future amendments/cancellations to be re-imported as new rows for human review without DB-level rejection. |
| 2026-05-19 | **Store ALL fields from the Yatra payout JSON** in `yatra_bookings_payout`, including fields not used in V1 UI (guest.email, guest.phone, booking.numberOfRooms, booking.adults, booking.children, booking.roomName, booking.roomType, booking.ratePlanType, commercials.otherCharges, commercials.hotelGrossCharges, commercials.yatraCommissionWithGST, commercials.tcs). | User-specified: "Store ALL fields from JSON. Even if not used in UI." Future-proofing; raw JSON also kept in `raw_json` for absolute reproducibility. |
| 2026-05-19 | Bank Statement drill-downs (UPI / Card / MMT / Yatra) now show a per-sub-row "Reconciled To" column with the linked invoice number(s), one row per invoice if a sub-transaction is split across multiple invoices. | User-specified: "the attribution of payment against the invoice number should happen across all payment and invoice types." Makes drill-downs actionable and cross-linkable. |
| 2026-05-19 | Drill-down sub-rows visually reflect their own reconciliation state — pastel green tint when the specific sub-transaction is fully applied, pastel yellow when partially applied, no tint when unreconciled. Consistent treatment across UPI, Card, MMT, Yatra. | User-specified: addresses the "MMT payout drill-down all bookings look the same" bug; generalises to all drill types for consistency. |
| 2026-05-19 | Add a dedicated `v_yatra_monthly_deductions` view (mirrors `v_mmt_monthly_deductions`), in addition to the broader MIS source-breakdown change in FR-086. | User-specified: dashboard surfaces both MMT and Yatra deductions with a filter/tab. |
| 2026-05-19 | Yatra reconciliation auto-match is **guest-name only** (no `booking_id`/`voucher_no` linkage to `hotel_invoice`). Fallback is the searchable voucher dropdown — same pattern as MMT `booking_id` selection. | User-confirmed; `hotel_invoice.booking_id` is not populated with Yatra data. |
| 2026-05-19 | `yatra_to_pay_hotel` auto-fills the payment amount in the YatraReconcilePanel; the field remains editable for operator override. | User-confirmed; matches MMT pattern. |
| 2026-05-19 | `is_pre_pay = true` (Yatra has already paid the hotel) does NOT exclude the booking from outstanding receivable — reconciliation flow is identical for prepay and postpay. | User-specified: "Prepay bookings still need to be reconciled in the system." |
| 2026-05-19 | Yatra bank credits are NOT auto-classified into a drill-down by narration. Yatra payments are reconciled exclusively via the manual transaction picker on the invoice detail page. Drill-down still works *after* a Yatra reconciliation lands (FR-085) — the classifier identifies it from the back-pointer chain. | User-confirmed: no reliable Yatra narration pattern. |
| 2026-05-19 | Cancellation handling for Yatra bookings is OUT of V1 scope. | User-specified. |
| 2026-05-19 | Backend MUST reject any reconciliation that would make `sum(reconciliation_links.amount_applied) > bank_statement.deposit_amt` for the bank row. Frontend assumes this invariant when tinting (green = sum == deposit, yellow = 0 < sum < deposit). | User-specified verification request: "verify backend prevents overpayment". |
| 2026-05-19 | Full-width app shell: drop `max-w-7xl` from `(app)/layout.tsx` header and main container; apply to **every** page (not bank-statement only). | User-specified: "7x global standard" — full-width layout app-wide. |

---

## Addendum — Bank Statement Drill-down Attribution + Sub-row Status (2026-05-19)

This addendum supersedes the relevant parts of FR-070 / FR-085 and adds two cross-cutting requirements to every drill-down type (UPI, Card, MMT, Yatra). It captures the second half of the Bank Statement redesign agreed with the user 2026-05-19.

### Goal
Today, when a bank-statement row is expanded, the drill-down lists the constituent sub-transactions (UPI / card swipes / MMT bookings / Yatra vouchers) but does NOT show which invoice each sub-transaction has been reconciled to, and visually treats reconciled and unreconciled sub-rows identically. This addendum:
1. Adds invoice attribution to every drill-down.
2. Adds row-level visual status (green = reconciled, yellow = partial, none = unreconciled) to every drill-down sub-row.
3. Makes the treatment consistent across all drill types so adding a new payment type later is a mechanical extension.

### FR-087 — Drill-down "Reconciled To" column + per-sub-row tint
Applies to all four drill types: `upi_settlement`, `card_settlement`, `mmt_payout`, `yatra_payout`.

**Backend (`rpc_get_bank_statement_drilldown`)**
- For every drill-down row returned, add two new fields:
  - `reconciled_invoices`: array of `{hotel_invoice_id, invoice_number, amount_applied}` — one entry per `reconciliation_links` row whose `source_table` + `source_id` matches the sub-transaction's identity (or, for MMT and Yatra, the back-pointer chain).
  - `applied_total`: numeric — sum of `amount_applied` across all entries in `reconciled_invoices` (NULL if none).
- The sub-transaction's "base amount" used to classify status is:
  - **UPI sub-row**: `upi_transactions.amount` for that row.
  - **Card sub-row**: `card_transactions.gross_amount × (1 − mdr_percent/100)` (the `net_after_mdr` already computed).
  - **MMT booking sub-row**: `mmt_bookings_payout.payable` for that row.
  - **Yatra voucher sub-row**: `yatra_bookings_payout.yatra_to_pay_hotel` for that row.
- One sub-row may map to multiple invoices (e.g., one UPI transaction split across two invoices). The RPC returns one entry in `reconciled_invoices` per link.

**Frontend (`bank-statement-client.tsx` DrillDown component)**
- Each drill-down table gains a new last-or-second-to-last column: **"Reconciled To"**.
  - Render one row per invoice when a sub-transaction is split across multiple invoices (so a UPI transaction split 60/40 produces two drill rows, each with one invoice link). The remaining columns repeat with `text-muted-foreground` on the second+ entries — same visual pattern used in the main row-splitting (FR-068, BR-024).
  - When `reconciled_invoices` is empty (sub-transaction not reconciled), the cell renders `—`.
  - When non-empty, each entry renders as a clickable link to `/invoices/{hotel_invoice_id}` displaying `invoice_number`. The `<Link>` calls `e.stopPropagation()` so it doesn't toggle the parent expansion.
- Each drill-down sub-row receives a tint computed from `applied_total` vs `base_amount`:
  - `applied_total IS NULL` (zero links) → no tint.
  - `Math.abs(applied_total − base_amount) < 1` → pastel green (consistent with FR-067 main-row green).
  - `0 < applied_total < base_amount` → pastel yellow (consistent with FR-067 main-row yellow).
- The same tint Tailwind classes specified in the BS-Polish designer spec (`.claude/context/designer.md`) are reused — no new classes.

### FR-088 — `v_yatra_monthly_deductions` view
A dedicated reporting view mirroring `v_mmt_monthly_deductions`:
- Granularity: one row per `(year, month, hotel_name)`.
- Aggregates over `yatra_bookings_payout` rows where `reconciled_at IS NOT NULL`, grouped by month-of-`email_date`.
- Columns:
  - `year`, `month`, `hotel_name`
  - `bookings_count` (`COUNT(*)`)
  - `total_tariff_sum`, `service_tax_sum`, `yatra_commission_amt_sum`, `tds_amt_sum`, `gst_on_commission_sum`, `yatra_to_pay_hotel_sum`
  - `other_charges_sum`, `hotel_gross_charges_sum`, `yatra_commission_with_gst_sum`, `tcs_sum` (the extended commercials fields per FR-076 v2)
- `SECURITY INVOKER` view; readable by `operator` and `admin` per existing RLS pattern (or guarded via a `SECURITY DEFINER` RPC wrapper if RLS gets in the way — same approach as MMT view).
- Frontend exposure: same dashboard page that surfaces `v_mmt_monthly_deductions`, with a filter or tab to switch between MMT and Yatra (and any future OTA deductions).

### FR-076 v2 — Schema additions: store all JSON fields, drop voucher_no uniqueness
Supersedes FR-076 (the original schema spec from 2026-05-19 morning). The `yatra_bookings_payout` table gets ALL of the following columns. Existing columns from FR-076 v1 stay as-is unless explicitly changed:

```sql
ALTER TABLE yatra_bookings_payout
  -- Drop the unique constraint; allow multiple rows per voucher_no (amendments, re-imports).
  DROP CONSTRAINT IF EXISTS yatra_bookings_payout_voucher_unique,
  -- Guest contact details (from JSON guest.*)
  ADD COLUMN IF NOT EXISTS guest_email           TEXT NULL,
  ADD COLUMN IF NOT EXISTS guest_phone           TEXT NULL,
  -- Extended booking context (from JSON booking.*)
  ADD COLUMN IF NOT EXISTS number_of_rooms       INT NULL,
  ADD COLUMN IF NOT EXISTS adults                INT NULL,
  ADD COLUMN IF NOT EXISTS children              INT NULL,
  ADD COLUMN IF NOT EXISTS room_name             TEXT NULL,
  ADD COLUMN IF NOT EXISTS room_type             TEXT NULL,
  ADD COLUMN IF NOT EXISTS rate_plan_type        TEXT NULL,
  -- Extended commercials (from JSON commercials.*)
  ADD COLUMN IF NOT EXISTS other_charges                NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS hotel_gross_charges          NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS yatra_commission_with_gst    NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS tcs_amt                      NUMERIC NULL,
  -- Raw JSON preserved verbatim for absolute reproducibility / future fields:
  ADD COLUMN IF NOT EXISTS raw_json              JSONB NULL,
  ADD COLUMN IF NOT EXISTS source_file_name      TEXT NULL,
  ADD COLUMN IF NOT EXISTS drive_file_id         TEXT NULL,
  ADD COLUMN IF NOT EXISTS parsed_at             TIMESTAMPTZ NULL DEFAULT now();
```

- `UNIQUE (voucher_no)` is DROPPED. Duplicate detection now lives in the inserter (FR-078 v2): if a row with the same `voucher_no` already exists, the inserter LOGS the duplicate (structured WARN line with both file IDs and voucher_no) and SKIPS the insert. No exception, no DB-level conflict.
- An index on `voucher_no` is RETAINED (for fast lookups and the existing `idx_yatra_bookings_payout_voucher_no` definition stays valid).
- An index on `lower(guest_name)` is RETAINED for the auto-match flow (FR-079).
- The `parsed_at` column doubles as both an audit timestamp and (when combined with `voucher_no`) lets the inserter prefer the most recently-parsed row when multiple exist for the same voucher.

### FR-078 v2 — Inserter behaviour update
Supersedes the `ON CONFLICT (voucher_no) DO NOTHING` clause in FR-078. New inserter contract:
1. Parse JSON envelope. Extract all fields per the v2 schema above (commercials + booking + guest + room data + raw envelope).
2. **Pre-insert duplicate check**: `SELECT id FROM yatra_bookings_payout WHERE voucher_no = $1 LIMIT 1`.
3. If row exists: write `logger.warning("yatra_payout: duplicate voucher_no=%s already present (existing_id=%s, file_id=%s) — skipping", voucher_no, existing_id, file_id)` AND mark the file `completed` (skip is success). No exception.
4. If row does not exist: plain `INSERT` (no `ON CONFLICT` clause needed). Return new id.
5. The `raw_json` column gets the full incoming envelope (no redaction) so future code can re-derive any field without re-fetching.
6. Idempotency under re-run is preserved by the application-layer duplicate check; the DB no longer enforces it.

### Updates to existing FRs
- **FR-076 (Schema)**: `UNIQUE (voucher_no)` constraint REMOVED. See FR-076 v2 above for the full set of additional columns.
- **FR-078 (Inserter)**: Now uses pre-insert duplicate check + log + skip instead of `ON CONFLICT DO NOTHING`. See FR-078 v2 above.
- **FR-081 (Field-edit RPC)**: Editable-fields whitelist EXPANDED to include the new schema columns (guest_email, guest_phone, number_of_rooms, adults, children, room_name, room_type, rate_plan_type, other_charges, hotel_gross_charges, yatra_commission_with_gst, tcs_amt). `raw_json`, `source_file_name`, `drive_file_id`, `parsed_at` are NOT editable (immutable provenance).
- **FR-085 (Bank Statement drill-down for Yatra)**: now also returns the FR-087 fields (`reconciled_invoices`, `applied_total`) per sub-row.
- **BR-034**: Re-sends are now **logged-and-skipped**, NOT silently ignored. The duplicate detection log line is the auditable trace.

### Business rules (this addendum)
- **BR-038** Backend MUST reject any reconciliation that would push `sum(reconciliation_links.amount_applied)` for a given bank_statement row above its `deposit_amt`. Enforced by `rpc_reconcile_invoice`, `rpc_reconcile_mmt_invoice`, `rpc_reconcile_yatra_invoice`, and any future reconcile RPCs via the shared `fn_lock_and_get_source_amount` invariant.
- **BR-039** Drill-down sub-row tint is computed identically across all drill types. The base amount for "fully applied" comparison is per-type (FR-087).
- **BR-040** A Yatra payout JSON re-imported with the same `voucher_no` is **logged and skipped** at the application layer. The first-imported row remains canonical; the operator manually edits fields via `rpc_update_yatra_bookings_payout_fields` if a correction is required.
- **BR-041** The full JSON envelope is preserved in `yatra_bookings_payout.raw_json` for every successful insert.

### Out of scope for this addendum
- Auto-merging duplicate Yatra rows for the same voucher_no (kept manual to preserve audit trail).
- A separate cancellation/amendment workflow (deferred — see Decisions Log 2026-05-19).
- Drill-down attribution for the bank-statement main rows themselves (already covered by the FR-068/FR-069 split-row UI — this addendum only adds it to drill-down SUB-rows).

---

## Addendum — Report an Issue (2026-05-23)
<!-- Last updated: 2026-05-23 -->

### Goal
Give operators a lightweight, source-aware way to flag invoices they cannot reconcile, so admins can triage and resolve. Reports are informational (do NOT block reconciliation); successful reconciliation auto-closes any open report on the same invoice.

### FR-089 — Issue category catalog (source-aware dropdown)
A single static catalog keyed by `source`. Frontend renders a Source-aware dropdown on the report dialog. Backend validates the category against the catalog for the invoice's source. Catalog (V1, final list):

| Code | Label | Applies to source(s) |
|---|---|---|
| `amount_mismatch` | Amount on invoice does not match payment | all |
| `guest_name_mismatch` | Guest name does not match | all |
| `dates_mismatch` | Check-in / check-out dates do not match | all |
| `payment_not_received` | No payment found against this invoice | all |
| `duplicate_booking` | Duplicate booking / invoice exists | all |
| `booking_not_found_in_mmt` | Booking ID not present in any MMT payout | MMT |
| `mmt_payout_missing` | MMT payout JSON not yet ingested for this booking | MMT |
| `mmt_commission_mismatch` | MMT commission / TCS / TDS values look wrong | MMT |
| `voucher_not_found_in_yatra` | Voucher not present in any Yatra payout | Yatra |
| `yatra_payout_missing` | Yatra payout JSON not yet ingested for this voucher | Yatra |
| `yatra_to_pay_amount_wrong` | `yatra_to_pay_hotel` value looks wrong | Yatra |
| `agoda_booking_not_found` | Booking not present in any Agoda payout | Agoda |
| `agoda_payout_missing` | Agoda payout / statement missing | Agoda |
| `cash_not_deposited` | Cash collected but not visible in bank | walk-in |
| `upi_txn_not_found` | Operator cannot find the UPI transaction on the date | walk-in |
| `card_settlement_missing` | Card swipe present, settlement missing | walk-in |
| `bank_transfer_not_found` | Bank transfer not visible in bank statement | walk-in |
| `other` | Something else (free-text required) | all |

Notes:
- "walk-in" source covers any invoice whose `source` is NULL or matches the existing walk-in detection (no OTA channel).
- `other` REQUIRES a non-empty `notes` field; backend enforces.
- Catalog is hard-coded in V1 (not a config table). Adding a new category = code change + migration of CHECK constraint. Acceptable for V1.

### FR-090 — Schema: `invoice_issue_reports` table (new)
```sql
CREATE TABLE public.invoice_issue_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES public.hotel_invoice(id) ON DELETE CASCADE,
  source_snapshot TEXT NULL,             -- snapshot of invoice.source at report time (for audit)
  category        TEXT NOT NULL,          -- one of FR-089 codes
  notes           TEXT NULL,              -- operator notes (required if category = 'other')
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','resolved_by_admin','resolved_by_reconciliation','withdrawn_by_operator')),
  reported_by     UUID NOT NULL REFERENCES auth.users(id),
  reported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by     UUID NULL REFERENCES auth.users(id),
  resolved_at     TIMESTAMPTZ NULL,
  resolution_notes TEXT NULL,             -- admin's notes when manually resolving
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open report per invoice at a time (operator cannot stack duplicates):
CREATE UNIQUE INDEX uq_invoice_issue_reports_one_open_per_invoice
  ON public.invoice_issue_reports (invoice_id) WHERE status = 'open';

CREATE INDEX idx_invoice_issue_reports_status ON public.invoice_issue_reports(status);
CREATE INDEX idx_invoice_issue_reports_invoice ON public.invoice_issue_reports(invoice_id);
CREATE INDEX idx_invoice_issue_reports_reported_by ON public.invoice_issue_reports(reported_by);
```
- RLS enabled.
- SELECT: operator sees own reports + admin sees all. (Same pattern as `approval_requests`.)
- All INSERT/UPDATE/DELETE revoked from `authenticated`; mutations go only through SECURITY DEFINER RPCs.
- CHECK constraint on `category` enforces the FR-089 catalog codes (full enum list, hard-coded).
- Trigger maintains `updated_at`.

### FR-091 — `rpc_create_issue_report(p_invoice_id uuid, p_category text, p_notes text)` (RPC)
- SECURITY DEFINER. Caller must be operator or admin.
- Validates: invoice exists; category in catalog; if `category = 'other'` then `notes` must be non-empty trimmed.
- Validates category applies to invoice's source (per FR-089 mapping). Common-to-all categories always allowed.
- Rejects if an open report already exists for the invoice (DB unique partial index also enforces). Raises `ISSUE_ALREADY_OPEN: An open report already exists for this invoice`.
- Inserts row with `status='open'`, `reported_by=auth.uid()`, `source_snapshot=invoice.source`.
- Writes audit row (`fn_write_audit`) with action `issue_report_created`.
- Returns the new report `id`.

### FR-092 — `rpc_withdraw_issue_report(p_report_id uuid)` (RPC)
- SECURITY DEFINER. Caller must be the original reporter OR an admin.
- Report must be in `status='open'`. Otherwise raises `REPORT_NOT_OPEN`.
- Sets `status='withdrawn_by_operator'`, `resolved_at=now()`, `resolved_by=auth.uid()`. (Field name `resolved_by` is overloaded — captures the closing actor regardless of close reason.)
- Writes audit row `issue_report_withdrawn`.

### FR-093 — `rpc_resolve_issue_report(p_report_id uuid, p_resolution_notes text)` (RPC)
- SECURITY DEFINER. Caller must be `admin`. Operators are rejected with `Not authorized`.
- Report must be `status='open'`. Otherwise raises `REPORT_NOT_OPEN`.
- Sets `status='resolved_by_admin'`, `resolved_at=now()`, `resolved_by=auth.uid()`, `resolution_notes=p_resolution_notes` (may be null/empty — optional).
- Writes audit row `issue_report_resolved`.

### FR-094 — Auto-resolve on reconciliation (DB trigger, FINAL)
- When an invoice transitions to `reconciliation_status='fully_reconciled'`, any `invoice_issue_reports` rows for that invoice with `status='open'` are auto-set to:
  - `status='resolved_by_reconciliation'`
  - `resolved_at=now()`
  - `resolved_by = auth.uid()` of the reconciler (read inside the trigger from the session JWT)
- Implementation: **AFTER UPDATE trigger** `trg_hotel_invoice_after_status_change` on `hotel_invoice.reconciliation_status`. Fires only when `OLD.reconciliation_status IS DISTINCT FROM NEW.reconciliation_status AND NEW.reconciliation_status = 'fully_reconciled'`. Calls helper `fn_auto_resolve_issue_reports(NEW.id, auth.uid())`.
- This replaces the originally-considered "edit each reconcile RPC" approach — single point of enforcement, applies to any present or future code path that lands an invoice in `fully_reconciled`.
- Reverse-reconcile (`rpc_admin_reverse_reconciliation`) transitions AWAY from `fully_reconciled`, so the trigger does NOT fire; auto-resolved reports stay resolved (BR-047). Admin manually files a new report if needed.
- Writes one audit row `issue_report_auto_resolved` per affected report (inside the helper, via `fn_write_audit`).
- Partial reconciliation does NOT auto-resolve. Only `fully_reconciled`.

### FR-095 — UI: ReportIssueDialog (operator + admin)
- Trigger: a "Report an issue" button on the invoice detail page (`/invoices/[id]`). Visible to both operator and admin. Disabled (with tooltip "An open report already exists") if one is already open.
- Dialog content:
  - Source-aware dropdown (FR-089 catalog filtered by invoice source).
  - Notes textarea (optional, required when `other`).
  - Submit / Cancel.
- On success: invalidate the `issue-report` query for the invoice; toast "Issue reported"; dialog closes.
- On `ISSUE_ALREADY_OPEN` error: show inline message + a "View existing report" link that scrolls to the report card.

### FR-096 — UI: Issue tag/badge surface
- **Invoice list (`/invoices`)** — every row with an `open` report shows a red "Issue reported" pill next to the status badge. Operator and admin both see it. Implementation: list query joins/aggregates the existence of an open report per invoice (single boolean column `has_open_issue` returned by the list endpoint).
- **Invoice detail (`/invoices/[id]`)** — when a report exists (any status), render an "Issue Report" card above the reconcile panels showing:
  - Category (label, not code).
  - Notes (if any).
  - Reporter + reported_at.
  - Status badge (open=red, resolved_by_admin=green, resolved_by_reconciliation=green, withdrawn_by_operator=slate).
  - If `open` and viewer is the reporter: a "Withdraw" button. If `open` and viewer is admin: "Resolve" button (opens a small dialog for optional resolution notes).
  - If resolved: show `resolved_by` + `resolved_at` + `resolution_notes`.
- **Admin reports list (`/admin/issues`)** — new admin-only page. Table of all open reports (default tab) and resolved (tab). Columns: invoice link, guest, source, category, reporter, reported_at, action (Resolve).
- Once an invoice is `fully_reconciled` AND the open report auto-resolves, the red "Issue reported" pill disappears from list and detail (replaced by the green resolved card on detail; nothing on list).

### FR-097 — Admin reports page (`/admin/issues`)
- Route: `/admin/issues`. Admin only. Operator hitting this URL is redirected to `/invoices`.
- Tabs: `Open` (default), `Resolved`, `All`.
- Filters: source (MMT/Yatra/Agoda/walk-in/all), category, date range on `reported_at`.
- Server-side pagination (default page size 50). Sort by `reported_at desc` by default.
- Click a row → navigates to `/invoices/[invoice_id]` where the admin can act.
- "Resolve" inline button on each open row → opens the same dialog as on the detail page.

### FR-098 — Audit log entries (this feature)
- `issue_report_created` — actor = reporter, entity_id = report_id, payload = `{ invoice_id, category, notes }`.
- `issue_report_withdrawn` — actor = withdrawer.
- `issue_report_resolved` — actor = admin, payload = `{ resolution_notes }`.
- `issue_report_auto_resolved` — actor = reconciler, payload = `{ via: 'rpc_reconcile_invoice'|'rpc_reconcile_mmt_invoice'|'rpc_reconcile_yatra_invoice' }`.

### Business rules (this feature)
- **BR-042** A report does NOT block reconciliation. Operator can still reconcile any invoice that has an open report; on `fully_reconciled` the report auto-resolves (FR-094).
- **BR-043** Only ONE open report per invoice at any time (DB-enforced).
- **BR-044** Only admin can manually resolve. Operator can only withdraw their own open report. Once closed (any close reason), nobody can mutate the row — to "re-open" admin must create a new report (which they may file on behalf of triage).
- **BR-045** Category must apply to invoice source (per FR-089 mapping). Backend enforces; frontend filters proactively to prevent the error path.
- **BR-046** `other` category requires non-empty `notes`. Frontend validates before submit; backend re-validates.
- **BR-047** Reverse-reconciliation (`rpc_admin_reverse_reconciliation`) does NOT re-open previously auto-resolved reports. Admin may file a fresh report if the reversal warrants it.

### Out of scope for this addendum
- Email / Slack / push notifications to admin on new reports (deferred to V1.5).
- Operator-side filtering of "my open reports" as a dedicated page (operator sees reports on each invoice detail; list page is enough for now).
- Per-category SLAs or aging buckets.
- Admin-side bulk resolve.
- Editing a submitted report (operator must withdraw + file new).

---

## Addendum — Payment Folio Upload + Auto-select on Reconcile + Resolve Guard (2026-05-23)

This addendum adds three tightly-coupled features:

1. **Payment Folio Upload** — operator/admin can upload the hotel PMS "Payment Folio" Excel export. Rows ingest into a new `payment_entries` table. Duplicates SKIPPED. No auto-reconciliation.
2. **Auto-select on reconcile panels** — when opening any reconcile surface (walk-in `AddPaymentPanel`, `MmtReconcilePanel`, `YatraReconcilePanel`, `AgodaReconcilePanel`) on an invoice whose `booking_id` or `invoice_number` matches one or more rows in `payment_entries`, the panel pre-fills method / date / amount from the best-matching entry. Operator still clicks Reconcile manually.
3. **Resolve guard on issue reports** — admin's `rpc_resolve_issue_report` now rejects unless `hotel_invoice.reconciliation_status IN ('partially_reconciled','fully_reconciled')`. Frontend Resolve button disabled with tooltip when this is not the case.

### Locked design decisions (2026-05-23, PM authority under "work without stopping" directive)

| # | Decision | Rationale |
|---|---|---|
| D-PF-1 | Upload UI lives at a new admin page `/admin/payment-folio`. | Bookkeeping ingestion is distinct from `/bank-statement` (a read-only reconciled-view surface). Operators don't need direct access in V1; admin-only matches the rest of the ingestion patterns. |
| D-PF-2 | Auto-select applies to ALL four reconcile panels (walk-in, MMT, Yatra, Agoda). | One pattern, mechanical extension. The matching key is `booking_id` (if present on the invoice) OR `invoice_number` (if present). |
| D-PF-3 | "Reconciled" for the resolve guard = `reconciliation_status IN ('partial','fully_reconciled','flagged_for_review')`. Only `unreconciled` blocks. | A partial / flagged reconcile means *some* payment is on the invoice — sufficient signal that the underlying triage has begun. Stricter (fully_reconciled-only) would block admins from acknowledging legitimately-resolved partial / discrepancy-flagged cases. |
| D-PF-4 | Add NEW payment method `corporate_credit` for the PMS value `Bill To Company`. | Distinct settlement channel (B2B credit invoicing). Collapsing into `bank_transfer` would muddy the data. Manual entry surface (like `cash` — no source table). |
| D-PF-5 | Duplicate definition for skip = exact tuple match on `(booking_id, payment_type_raw, received_date, reference_text, payment_amount, invoice_number_raw)`. NULLs treated as equal via canonicalization (empty string ↔ NULL collapsed to empty before compare). | The user's stated rule. NULL-aware DB UNIQUE handled via a normalized expression-based unique index. |
| D-PF-6 | Parser uses a pure-Python BIFF8 OLE parser checked into the backend repo. NO `soffice` / no LibreOffice. | LibreOffice not available in dev environments; the BIFF8 parser is ~150 LoC and is the same shape across all hotel PMS exports we've seen. |
| D-PF-7 | Suggested payment-method mapping done in the upload RPC, NOT in the parser. Parser ships raw values; RPC translates with reference-text heuristics for OTA channels. | Keeps parsing dumb. Easy to evolve mapping rules without re-uploading. |
| D-PF-8 | Auto-select shows up to 5 matching entries as a suggestion strip. If exactly one match, it is pre-applied (operator can still edit). | The data shows ~45-55% rows have `booking_id` and ~43% have `invoice_number`; multi-match is real (e.g., card auth + final settlement under same booking). |
| D-PF-9 | Reconciliation flow is unchanged: existing reconcile RPCs are NOT modified. Auto-select is a frontend-only convenience reading from `payment_entries`. | `payment_entries` is a SUGGESTION SURFACE, not a reconciliation source. Once user reconciles, the link is still to `upi_transactions` / `card_transactions` / `bank_statement` / `cash_payments` per the existing model. |
| D-PF-10 | Used flag on `payment_entries` rows: a new boolean `consumed_for_invoice_id UUID NULL` set the moment a reconciliation completes on an invoice whose `booking_id` or `invoice_number` matched the entry. Cleared via the existing reverse-reconcile trigger pattern (or null-out on un-reconcile of the link). | Single-use suggestion experience — once an entry is consumed, do not re-suggest it for another invoice. |

### Payment Folio source data shape (locked 2026-05-23)

Sample file: `excel_exports/Payment_Folio_1779523853.xls` (BIFF8 OLE Composite Document, ~36 KB). The header row is detected by scanning for the first row containing all six expected column names (in any order):

| Column | Type | Notes |
|---|---|---|
| `Booking ID` | text | ~45% filled. Blank for walk-in / front-desk rows. |
| `Payment Type` | text | One of: `UPI`, `Cash`, `Credit Card`, `Debit Card`, `Bank Transfer`, `IMPS`, `Payment Gateway`, `Bill To Company`, `Other`. |
| `Received Date` | date (BIFF date serial) | Convert via Excel epoch (1900-01-01 with 1900-bug compensation). |
| `Reference Text` | text | Free-form. Encodes channel hints (`Collected By -MakeMyTrip`, `Collected By -Agoda`, etc.) AND collector name. Parser stores raw; RPC parses. |
| `Payment Amount` | numeric | INR. Always positive. |
| `Invoice Number` | text | ~43% filled. PMS-side invoice id; may or may not match `hotel_invoice.invoice_number`. |

### Payment Type → system `payment_method` mapping (applied at INSERT time)

| Raw `Payment Type` | Reference Text contains | → `payment_method` |
|---|---|---|
| `UPI` | (any) | `upi` |
| `Cash` | (any) | `cash` |
| `Credit Card` | (any) | `card` |
| `Debit Card` | (any) | `card` |
| `Bank Transfer` | `Collected By -MakeMyTrip` (ILIKE) | `mmt_payout` |
| `Bank Transfer` | `Collected By -Agoda` (ILIKE) | `agoda_payout` (FUTURE — see note) |
| `Bank Transfer` | `Collected By -Yatra` / `Desiya` (ILIKE) | `yatra_payout` (FUTURE — see note) |
| `Bank Transfer` | (none of the above) | `bank_transfer` |
| `IMPS` | (any) | `bank_transfer` |
| `Payment Gateway` | (any) | `bank_transfer` |
| `Bill To Company` | (any) | `corporate_credit` (NEW) |
| `Other` | (any) | NULL (manual review required) |

Notes:
- `mmt_payout` already exists in the CHECK constraint.
- `agoda_payout` and `yatra_payout` are NOT in V1 CHECK; for FR-099 we store the mapped method as a TEXT column on `payment_entries` (no CHECK against `reconciliation_links` because `payment_entries` does not itself become a `reconciliation_links` row).
- `corporate_credit` IS added to the CHECK constraint on `reconciliation_links.payment_method` and `payment_source_config.payment_method` since corporate credit may eventually be reconcilable.

### FR-099 — `payment_entries` table

```sql
CREATE TABLE payment_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Source file traceability
  upload_id UUID NOT NULL REFERENCES payment_folio_uploads(id) ON DELETE CASCADE,
  source_row_index INTEGER NOT NULL,  -- 1-indexed row in the Excel sheet for traceability

  -- Raw fields from Excel
  booking_id TEXT NULL,                -- raw 'Booking ID' (trimmed; NULL if blank)
  payment_type_raw TEXT NOT NULL,      -- raw 'Payment Type' verbatim
  received_date DATE NOT NULL,
  reference_text TEXT NULL,            -- raw 'Reference Text'
  payment_amount NUMERIC(14,2) NOT NULL CHECK (payment_amount > 0),
  invoice_number_raw TEXT NULL,        -- raw 'Invoice Number'

  -- Derived fields
  payment_method TEXT NULL CHECK (payment_method IN (
    'upi','card','bank_transfer','cash','mmt_payout','agoda_payout','yatra_payout','corporate_credit'
  )) ,
  collector_hint TEXT NULL,            -- extracted from reference_text (best-effort)

  -- Consumption tracking (FR-101)
  consumed_for_invoice_id UUID NULL REFERENCES hotel_invoice(id) ON DELETE SET NULL,
  consumed_at TIMESTAMPTZ NULL,
  consumed_link_id UUID NULL REFERENCES reconciliation_links(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Normalized-tuple unique index (D-PF-5). Treats NULLs as empty strings for the duplicate-skip rule.
CREATE UNIQUE INDEX uq_payment_entries_dedup ON payment_entries (
  COALESCE(booking_id,''),
  payment_type_raw,
  received_date,
  COALESCE(reference_text,''),
  payment_amount,
  COALESCE(invoice_number_raw,'')
);

CREATE INDEX idx_payment_entries_booking_id ON payment_entries (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_payment_entries_invoice_number_raw ON payment_entries (invoice_number_raw) WHERE invoice_number_raw IS NOT NULL;
CREATE INDEX idx_payment_entries_unconsumed ON payment_entries (consumed_for_invoice_id) WHERE consumed_for_invoice_id IS NULL;

-- RLS: SELECT for both roles; mutations only via SECURITY DEFINER RPCs.
ALTER TABLE payment_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_entries_select ON payment_entries FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON payment_entries FROM authenticated, anon;
```

### FR-100 — `payment_folio_uploads` table (audit/traceability)

```sql
CREATE TABLE payment_folio_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by UUID NOT NULL REFERENCES user_profiles(user_id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  file_name TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,                 -- hex digest of file body for traceability
  row_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','partial','failed')),
  error_text TEXT NULL,
  parse_warnings JSONB NULL              -- array of {row_index, message}
);

ALTER TABLE payment_folio_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY pf_uploads_select ON payment_folio_uploads FOR SELECT TO authenticated USING (is_admin() OR uploaded_by = (select auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON payment_folio_uploads FROM authenticated, anon;
```

### FR-101 — `payment_method` CHECK constraint extension

- Add `'corporate_credit'` to the CHECK constraints on:
  - `reconciliation_links.payment_method`
  - `payment_source_config.payment_method`
- Seed `payment_source_config`: `('corporate_credit', NULL_or_manual, true)` — since corporate credit has no source table, follow the same pattern as `cash` (no source row, manual entry via the existing cash path generalised). For V1 we DO NOT add a reconciliation surface for `corporate_credit`; the method is added so reconciliation_links can carry it once the surface is built.

### FR-102 — `rpc_upload_payment_folio(p_file_name TEXT, p_file_size_bytes INT, p_sha256 TEXT, p_rows JSONB)` (RPC)

- Caller: operator or admin (role-checked).
- `p_rows` is a JSONB array of `{ row_index, booking_id, payment_type, received_date, reference_text, payment_amount, invoice_number }` — pre-parsed by backend (FR-103).
- Behavior:
  1. Insert one `payment_folio_uploads` row (status pending).
  2. For each row:
     - Derive `payment_method` per FR-099 mapping table (CASE block).
     - Attempt `INSERT INTO payment_entries (...) ON CONFLICT (normalized-tuple) DO NOTHING`. Detect conflict via `RETURNING id`.
     - If conflict → increment skipped_count.
     - If inserted → increment inserted_count.
     - If validation fails (e.g., `received_date` NULL or `payment_amount` ≤ 0 or `payment_type` empty) → append to `parse_warnings`, increment invalid_count.
  3. Update the `payment_folio_uploads` row with final counts + status (`completed` always, since invalid rows are skipped not fatal).
  4. Write audit row `payment_folio.upload`.
  5. Return `{ upload_id, row_count, inserted_count, skipped_count, invalid_count, warnings: [...] }`.
- SECURITY DEFINER, search_path locked, EXECUTE granted to authenticated.

### FR-103 — Backend Excel parser (Python, BIFF8 OLE, no LibreOffice)

- New module `src/parsers/payment_folio_xls.py` exposing `parse_payment_folio(bytes) -> list[dict]`.
- Implementation: pure-Python BIFF8 reader using `olefile` (already an `xlrd` transitive dep) OR a vendored mini-reader. Read records `BOF (0x0809)`, `BoundSheet8 (0x0085)`, `SST (0x00FC)`, `Row (0x0208)`, `LABELSST (0x00FD)`, `RK (0x027E)`, `MULRK (0x00BD)`, `NUMBER (0x0203)`, `LABEL (0x0204)`. Date cells detected by xf format index pointing to a date format string in the workbook's format records.
- The parser:
  1. Detects header row by finding the first row that contains all of `Booking ID`, `Payment Type`, `Received Date`, `Reference Text`, `Payment Amount`, `Invoice Number` (case-insensitive substring).
  2. Maps column letters to canonical keys.
  3. Reads subsequent rows until the first row where ALL six cells are empty.
  4. Returns list of dicts (NULLs for blanks, ISO-format date strings, raw text fields trimmed).
- Edge cases: SST string ref, RK number encoding (×100, integer-shift), MulRK runs, date serial conversion (1900-bug compensation), UTF-16LE strings, formulas (read cached value), shared strings table, missing columns (raise `PaymentFolioParseError`).

### FR-104 — Upload API endpoint (Next.js server-side) or direct RPC call

Two paths possible; chosen path:
- Frontend uses `FileReader` to read the file as ArrayBuffer, POSTs to a Next.js API route `/api/payment-folio/upload` which:
  1. Computes SHA-256.
  2. Invokes the Python parser via a Node-side BIFF8 mini-parser (TypeScript port of FR-103 — keeps everything within the Next.js runtime; backend Python parser exists separately for any future Drive-folder-ingestion pathway).
  3. Calls `rpc_upload_payment_folio` with the parsed rows.
  4. Returns the RPC's summary JSON to the client.

**Implementation choice for V1:** Backend parser is the SINGLE source of truth. Frontend uploads the raw file to a tiny Next.js Route Handler that streams the bytes to a new server-side Python sidecar OR uses a vendored TS BIFF8 reader. Picking one:

- **PICKED:** TypeScript BIFF8 reader in `frontend/src/lib/xls/biff8.ts`. ~250 lines. Same algorithm as FR-103 but in TS. Pros: no Python sidecar, no LibreOffice, runs in the Next.js server runtime cleanly, no extra deployment surface. The Python `src/parsers/payment_folio_xls.py` is built ALSO for any future Drive-folder ingestion path but is NOT exercised in V1 upload flow.

This means the frontend-dev owns the parser. Backend-dev owns the RPC. Both must agree on the canonical row shape (FR-102 `p_rows` contract).

### FR-105 — Upload UI (`/admin/payment-folio`)

- Route: `/admin/payment-folio`. Admin-only. Operator hitting URL is redirected to `/invoices` by middleware.
- Page sections:
  1. **Upload zone** — drag-and-drop OR file picker. Accepts `.xls` (BIFF8) only in V1. On drop, parses client-side, shows row preview (first 20 rows), and an "Upload" button.
  2. **Upload result panel** — on success, shows `inserted / skipped (as duplicates) / invalid (with warnings)` counts plus a collapsible details list.
  3. **Recent uploads table** — last 20 uploads from `payment_folio_uploads` with: file_name, uploaded_by display_name, uploaded_at, row_count, inserted_count, skipped_count, status. Click a row to open a drawer with the full warnings list.
- Nav: new admin sidebar entry "Payment Folio" under the existing Settings / admin grouping.
- States: idle / parsing / preview / uploading / success / partial-success / error.

### FR-106 — Auto-select on reconcile panels

- Applies to all four reconcile surfaces. On panel mount, the panel queries:
  ```
  SELECT * FROM payment_entries
   WHERE consumed_for_invoice_id IS NULL
     AND (
           (booking_id IS NOT NULL AND booking_id = $invoice.booking_id)
        OR (invoice_number_raw IS NOT NULL AND invoice_number_raw = $invoice.invoice_number)
     )
   ORDER BY received_date DESC, created_at DESC
   LIMIT 10;
  ```
- Behavior:
  - If 0 matches → no banner, panel renders normally.
  - If 1 match → auto-populate method + date + amount fields, show a dismissible info banner: "Pre-filled from Payment Folio entry of {date} • ₹{amount} • {method}".
  - If 2-10 matches → show a "Pick from Payment Folio (N matches)" chip strip at top of panel. Clicking a chip pre-fills the form. The first chip is the "best" candidate by these tie-breakers (in order): exact `invoice_number` match > exact `booking_id` match > most recent `received_date`.
- This is a FRONTEND-ONLY convenience. The actual `Reconcile` button still goes through the existing reconcile RPCs (`rpc_reconcile_invoice`, `rpc_reconcile_mmt_invoice`, `rpc_reconcile_yatra_invoice`, agoda equivalent). The pre-fill populates: method dropdown, date input, amount input, and (for the standard `AddPaymentPanel`) auto-selects the matching transaction in the picker IF an exact `(method, date, amount)` match exists in `v_transactions_with_remaining`.
- After successful reconcile, the existing reconcile RPCs are modified to also call a new helper `fn_consume_payment_entry(p_invoice_id, p_link_id)` which marks the matched `payment_entries` rows (by booking_id OR invoice_number) as consumed. Reverse-reconcile clears via the existing AFTER DELETE trigger pattern on `reconciliation_links`.

### FR-107 — Resolve guard on issue reports

- In `rpc_resolve_issue_report(p_report_id uuid, p_resolution_notes text)`:
  - After the existing role + status checks, fetch the invoice row:
    ```
    SELECT reconciliation_status INTO v_status
      FROM hotel_invoice
     WHERE id = (SELECT invoice_id FROM invoice_issue_reports WHERE id = p_report_id);
    ```
  - If `v_status NOT IN ('partially_reconciled','fully_reconciled')` → raise exception:
    ```
    RAISE EXCEPTION 'INVOICE_NOT_RECONCILED: Invoice must be at least partially reconciled before resolving this issue report.';
    ```
- Frontend (`IssueReportCard` resolve button + `/admin/issues` inline Resolve):
  - Disable the button when `invoice.reconciliation_status = 'unreconciled'`.
  - Tooltip: "Reconcile this invoice (at least partially) before resolving the report."
  - Card needs the invoice's `reconciliation_status` — already available on the invoice detail context; for `/admin/issues` the list query must JOIN `hotel_invoice.reconciliation_status` (add to `v_admin_issues_list` or extend the existing select).
  - Backend sentinel `INVOICE_NOT_RECONCILED` mapped to friendly toast: "Reconcile the invoice first (at least partially) before resolving this report."

### Business rules (this addendum)

- **BR-048** A `payment_entries` row is a SUGGESTION, never a reconciliation source. Reconciliation always links to `upi_transactions` / `card_transactions` / `bank_statement` / `cash_payments`.
- **BR-049** A row is "consumed" iff some `reconciliation_links` row was inserted on an invoice whose `booking_id` matches the entry's `booking_id` (when both non-NULL) OR whose `invoice_number` matches `invoice_number_raw` (when both non-NULL). Consumption is one-shot per entry; a future invoice with the same `booking_id` will NOT match a consumed entry.
- **BR-050** Duplicates are SKIPPED (not errored) on upload. Skip key = all 6 raw columns, NULLs canonicalised to empty string.
- **BR-051** Invalid rows on upload (e.g., negative amount, missing date) are SKIPPED with a warning entry; the upload still completes.
- **BR-052** Admin cannot resolve an issue report unless `reconciliation_status IN ('partially_reconciled','fully_reconciled')`. Sentinel `INVOICE_NOT_RECONCILED`.
- **BR-053** `Bill To Company` from PMS = `corporate_credit` payment_method in our system. No reconciliation surface in V1.
- **BR-054** `Other` payment type from PMS → `payment_method = NULL` and the entry is parked for human review (auto-select still shows it as a chip with method "Other / manual" so the operator can pick a real method).
- **BR-055** Auto-select tie-break order: exact `invoice_number` > exact `booking_id` > most recent `received_date` > most recent `created_at`.

### Out of scope for this addendum

- Reconciling `corporate_credit` payments (no UI surface in V1; the method exists for forward compatibility).
- Re-uploading a corrected Payment Folio that supersedes an earlier upload (V1.5 — admin can delete via SQL if needed; no UI delete in V1).
- Editing a `payment_entries` row post-upload (no edit RPC in V1).
- Drive-folder auto-ingest of payment folios (V1.5).
- Per-`payment_entries`-row reverse linkage on un-reconcile (the AFTER DELETE trigger clears consumed flags; that's enough).

### Open Questions
None for this addendum. PM made all 10 design calls per "work without stopping" directive. User may override any in a fast follow.
