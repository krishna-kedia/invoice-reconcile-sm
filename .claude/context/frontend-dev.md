# Frontend Dev Context
<!-- Last updated: 2026-05-23 (PF-4 queued) -->
<!-- Previous: 2026-05-23 12:00 -->

## Inbound Task — PF-4 (Payment Folio upload UI + BIFF8 TS reader + Auto-select on all 4 reconcile panels + Resolve-button disable)
- Issued by PM: 2026-05-23
- Blocked on: PF-2 (backend-dev — `rpc_upload_payment_folio` RPC, `rpc_resolve_issue_report` resolve guard, auto-consume hook in 4 reconcile RPCs). PF-3 QA gate preferred but not strict — frontend can be built against the live RPCs in parallel.
- Repo: `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm` (frontend at `frontend/`)
- Spec: `prd.md` § "Addendum — Payment Folio Upload + Auto-select + Resolve Guard (2026-05-23)" — FR-104, FR-105, FR-106, FR-107. `execution.md` § "PF-4".

### Files to create
1. **`frontend/src/lib/xls/biff8.ts`** — pure-TypeScript BIFF8 OLE reader. Exports:
   ```ts
   export type PaymentFolioRow = {
     row_index: number;
     booking_id: string | null;
     payment_type: string;
     received_date: string; // ISO YYYY-MM-DD
     reference_text: string | null;
     payment_amount: number;
     invoice_number: string | null;
   };
   export class PaymentFolioParseError extends Error {}
   export async function parsePaymentFolio(buf: ArrayBuffer): Promise<PaymentFolioRow[]>;
   ```
   Implementation guide:
   - OLE compound document: signature `D0 CF 11 E0 A1 B1 1A E1` at offset 0. Parse the header → sector size (512 for major, default), FAT sector chain, mini-stream parameters.
   - Walk the Directory entries (root entry is the first stream). Find the entry named `Workbook` (UTF-16LE, length-prefixed, look at directory entries one sector at a time).
   - Reassemble the workbook stream by following the FAT chain. Streams smaller than `mini_stream_cutoff` (4096) are in the mini-FAT.
   - On the workbook stream, walk BIFF records: each is `[u16 type][u16 length][bytes...]`. Handle records:
     - `BOF (0x0809)` — sheet/workbook start.
     - `EOF (0x000A)` — stop.
     - `BoundSheet8 (0x0085)` — sheet name + stream offset.
     - `SST (0x00FC)` — shared string table; followed by `Continue (0x003C)` if it spills.
     - `LABELSST (0x00FD)` — string cell referencing SST.
     - `LABEL (0x0204)` — inline string cell (BIFF5-style).
     - `RK (0x027E)` — compact number cell. RK value: 4 bytes; bit0 = ×100, bit1 = integer-shifted; otherwise IEEE double upper 30 bits + 2 zero low bits.
     - `MULRK (0x00BD)` — run of RK cells.
     - `NUMBER (0x0203)` — IEEE 754 number cell.
     - `BLANK (0x0201)` / `MULBLANK (0x00BE)` — blank cells.
     - `FORMAT (0x041E)` — format string (e.g., `yyyy-mm-dd`).
     - `XF (0x00E0)` — cell formatting; maps to a format index. To know "this cell is a date", build XF→format map, check if format string contains `d`, `m`, or `y` (and no `#`/`0`/`%`).
     - `ROW (0x0208)` — row metadata (optional; we mainly track per-cell records).
   - String decoding (SST entries):
     - u16 char count + u8 flags. Flags bit 0: 0 = compressed (Latin-1, 1 byte/char), 1 = uncompressed (UTF-16LE, 2 bytes/char). Flags bit 2: rich text flag. Flags bit 3: phonetic flag. Skip rich-run/phonetic blocks.
     - SST can span `Continue` records; resume mid-string at the boundary (the Continue may flip compressed/uncompressed for the remainder — first byte of Continue is the new flag byte for the continuing string).
   - Date conversion: Excel epoch is 1900-01-01 (serial 1) BUT with the 1900-leap-year bug, so:
     - serial 60 = 1900-02-29 (fake) → treat as 1900-03-01.
     - For serial `s >= 61`: `Date.UTC(1899, 11, 30) + s * 86400000`.
     - For serial `s <= 59`: `Date.UTC(1899, 11, 31) + s * 86400000`.
   - Header detection: scan rows from top; the FIRST row containing all 6 of `booking id`, `payment type`, `received date`, `reference text`, `payment amount`, `invoice number` (case-insensitive substring on string-cell contents) is the header. Record column indices.
   - Data rows: starting at header_row + 1, parse rows until first row where ALL 6 mapped columns are empty/blank.
   - Errors throw `PaymentFolioParseError("...")` with a user-friendly message.

2. **`frontend/src/app/(app)/admin/payment-folio/page.tsx`** (admin-only — middleware already gates `/admin/*`):
   - Drag-and-drop zone + file picker (`accept=".xls"`).
   - On drop:
     - Read into `ArrayBuffer` via `file.arrayBuffer()`.
     - Compute SHA-256: `crypto.subtle.digest('SHA-256', buf)` → hex string.
     - Call `parsePaymentFolio(buf)` → `PaymentFolioRow[]`.
     - Render preview table (first 20 rows) + total count.
     - State machine: idle → parsing → preview → uploading → success | partial | error.
   - "Upload" button → `supabase.rpc('rpc_upload_payment_folio', { p_file_name, p_file_size_bytes, p_sha256, p_rows: rowsAsJson })`.
   - Display result panel: green inserted count, slate skipped count (label "duplicates"), amber invalid count with expandable warnings list.
   - "Recent uploads" table: last 20 from `payment_folio_uploads` (admin sees all). Click row → drawer with full warnings.

3. **`frontend/src/lib/hooks/usePaymentFolioMatches.ts`** — reusable hook:
   ```ts
   export type PaymentFolioMatch = PaymentEntry;
   export function usePaymentFolioMatches(invoice: { id: string; booking_id: string | null; invoice_number: string | null }) {
     // useQuery -> payment_entries WHERE consumed_for_invoice_id IS NULL AND (booking_id matches OR invoice_number_raw matches)
     // returns matches sorted by tie-break: exact invoice_number > exact booking_id > received_date DESC > created_at DESC
   }
   ```
   - Query via Supabase REST (no RPC needed; SELECT on `payment_entries` is allowed by RLS).
   - LIMIT 10.

### Files to edit
1. **`frontend/src/lib/types.ts`** — add:
   - `PaymentEntry` (matches the DB row shape).
   - `PaymentFolioUpload` (matches the DB row shape).
   - Add `'corporate_credit'` to the `PaymentMethod` union.

2. **`frontend/src/app/(app)/layout.tsx`** — add admin nav entry "Payment Folio" → `/admin/payment-folio`. Place near "Issues" / "Issue Categories" (admin section).

3. **`frontend/src/app/(app)/invoices/[id]/detail-client.tsx`** — wire `usePaymentFolioMatches` into the `AddPaymentPanel`:
   - At the TOP of the AddPaymentPanel render, show:
     - If matches.length === 1: a dismissible info banner "Pre-filled from Payment Folio entry of {date} • ₹{amount} • {method}" and auto-apply (set `method`, `date`, then auto-open the picker if `(method, date, amount)` matches a row in `v_transactions_with_remaining`).
     - If matches.length 2–10: a chip strip "From Payment Folio ({N} matches)" — each chip shows `{date} • ₹{amount} • {method}`. Click → apply.
     - If matches.length === 0: render nothing extra.

4. **`frontend/src/app/(app)/invoices/[id]/mmt-reconcile-panel.tsx`** — same hook, filter matches where `payment_method='mmt_payout'`. Show banner and pre-select the matched MMT booking.

5. **`frontend/src/app/(app)/invoices/[id]/yatra-reconcile-panel.tsx`** — same hook. Cash matches are filtered out (Yatra forbids cash). Pre-fill method (upi/card/bank_transfer/yatra_payout) + date + amount.

6. **`frontend/src/app/(app)/invoices/[id]/agoda-reconcile-panel.tsx`** — same hook.

7. **`frontend/src/components/issue/issue-report-card.tsx`** — extend props to accept `reconciliationStatus: HotelInvoice['reconciliation_status']` from the parent (`detail-client.tsx` already has it on `inv`). Disable the Resolve button when `reconciliationStatus === 'unreconciled'`. Wrap in a tooltip-bearing span (since `<Button disabled>` doesn't fire mouse events on the button itself): "Reconcile the invoice (at least partially) before resolving the report."
   - In `handleResolve` error handler, add `if (msg.includes('INVOICE_NOT_RECONCILED')) toast.show('error','Reconcile the invoice first (at least partially) before resolving this report.')`.

8. **`frontend/src/app/(app)/admin/issues/page.tsx`** — extend the list query to include `hotel_invoice.reconciliation_status` (Supabase JOIN syntax: `select=*,hotel_invoice(reconciliation_status)` or switch to a view). Disable inline Resolve button per row when status is `unreconciled` with the same tooltip. Same INVOICE_NOT_RECONCILED toast handling.

9. **`frontend/src/app/(app)/invoices/[id]/detail-client.tsx`** — pass `reconciliationStatus={inv.reconciliation_status}` into `<IssueReportCard>`.

### Build hygiene
- `npm run build` clean.
- `npx tsc --noEmit` clean.
- ESLint: existing relaxations in `frontend/.eslintrc.json` still apply.

### Done when
- Upload page works end-to-end against `excel_exports/Payment_Folio_1779523853.xls` (real PMS file). All 6 known payment types map correctly.
- Re-uploading the same file → all rows skip as duplicates.
- An invoice with a matching `payment_entries.booking_id` shows the pre-fill banner on the appropriate reconcile panel.
- Resolve button disabled with tooltip when invoice is `unreconciled`; enabled when `partial` / `fully_reconciled` / `flagged_for_review`.
- Build + tsc clean.
- Return: COMPLETED / FILES CHANGED / CONTEXT UPDATED / NEXT.

---



## Inbound Task — BS-Polish-2 (Bank Statement Visual Polish — Implementation)
- Issued by PM: 2026-05-19 09:00
- Blocked on: BS-Polish-1 (designer spec must land first in `.claude/context/designer.md` § "BS-Polish Spec (2026-05-19)")
- Repo (cwd): `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-frontend`
- Files to edit:
  - `frontend/src/app/(app)/layout.tsx` — drop `max-w-7xl` on both header inner and main wrapper; apply designer-spec padding.
  - `frontend/src/app/(app)/bank-statement/bank-statement-client.tsx` — all other changes.
- Locked behaviour:
  1. Pre-aggregate rows into a `Map<bank_id, { sum: number, deposit: number }>` once via `React.useMemo`, then derive the tint class for each row from its `bank_id`. Tolerance for "fully applied" = `Math.abs(sum - deposit) < 1`.
  2. Make the `<TR>` clickable when `canExpand`. On row click → `setExpanded(s => ({ ...s, [r.bank_id]: !s[r.bank_id] }))`. Apply `onClick={(e) => e.stopPropagation()}` on the invoice `<Link>` so navigation still works. Keep the chevron button working and also `stopPropagation` on it (so click on chevron doesn't double-toggle via row click).
  3. Drop `borderCls` (amber left-border) entirely.
  4. Implement the filter-control treatment (chip row OR popover) exactly per designer spec. Multi-select behaviour unchanged.
  5. After edits: run `npm run build` and `npx tsc --noEmit` inside `frontend/`; both must be clean.
- Done when: build clean, page renders correctly on all states (loading / empty / error / data / mixed tints / hovered row / clicked row / clicked invoice link), and one quick visual sanity-check of `/invoices` and `/admin` confirms full-width didn't break their layouts.


## What I've Built

### [2026-05-23 12:00] RI-4 + RI-5 — Report an Issue UI
- Created `src/components/issue/issue-report-card.tsx` — displays the latest report on an invoice with status badge (red/green/slate left border), withdraw button (reporter + open only), resolve button (admin + open only), confirm dialogs for both actions.
- Created `src/components/issue/report-issue-dialog.tsx` — trigger button (disabled if open report exists), dialog with source-filtered category dropdown, optional/required notes, inline error for ISSUE_ALREADY_OPEN and other sentinels.
- Created `src/app/(app)/admin/issues/page.tsx` — admin-only page with Open/Resolved tabs, filters (source, category, date range), 50/page pagination, inline Resolve button on open rows with notes dialog.
- Created `src/app/(app)/admin/settings/issue-categories/page.tsx` — full CRUD for issue_categories table via rpc_upsert_issue_category and rpc_delete_issue_category, code immutable on edit, applies_to multi-select checkboxes.
- Modified `src/lib/types.ts` — added IssueReport, IssueCategory, IssueReportStatus types, classifyInvoiceSource() helper.
- Modified `src/app/(app)/invoices/[id]/detail-client.tsx` — added issueReportQ (status-only query), IssueReportCard above reconcile panels, ReportIssueDialog in invoice header, both invalidate issue-report and invoices.walkin query keys.
- Modified `src/app/(app)/invoices/page.tsx` — switched from hotel_invoice to v_invoice_list_with_issue, added "Issue reported" destructive badge next to status badge when has_open_issue is true.
- Modified `src/app/(app)/layout.tsx` — added "Issues" (/admin/issues) and "Issue Categories" (/admin/settings/issue-categories) nav links to admin sidebar.
- Build: npm run build clean, npx tsc --noEmit clean. 16 routes.

## Last Tasks Completed
- D1 Scaffold Next.js 14 + Tailwind + TypeScript (`frontend/`)
- D2 Supabase clients (`src/lib/supabase/{client,server,middleware}.ts`) and domain types (`src/lib/types.ts`)
- D3 `/login` page + role-aware middleware redirect (`src/middleware.ts`)
- D4 App shell with role-aware navigation (`src/app/(app)/layout.tsx`)
- E1 Invoice list page with filters, server-side pagination, OTA tab
- E2 Invoice detail (server) + `detail-client.tsx`
- E3 Add Payment Panel (the big one) — method/date picker, transaction table, click-to-pick modal, session list, partial/overpay confirmation dialogs
- E4 Cash sub-component (inline-cash path through `rpc_reconcile_invoice`)
- E5 Admin Home (`/admin`)
- E6 Approvals (`/admin/approvals`)
- E7 Discrepancies (`/admin/discrepancies`)
- E8 Audit Log (`/audit`)
- E9 Payment Source Config (`/admin/settings/payment-sources`)

## Stack
- Next.js 14 app router, `src/` directory
- Tailwind + tiny shadcn-style primitives in `src/components/ui/*`
- `@supabase/ssr` for cookie-based auth
- `@tanstack/react-query` for data fetching/caching
- `zod` and `react-hook-form` available (not yet heavily used; forms are simple controlled inputs)
- `date-fns` for date helpers
- `lucide-react` available; not yet used (kept icon-light)

## Build status
- `npm run build` clean (12 routes); `tsc --noEmit` clean.
- ESLint relaxed for `no-explicit-any` and `_`-prefixed unused (frontend/.eslintrc.json).

## Component Inventory (additions from RI-4/RI-5)
- `src/components/issue/issue-report-card.tsx` — card shown on invoice detail with report status, actions
- `src/components/issue/report-issue-dialog.tsx` — trigger button + dialog for filing a new report
- `src/app/(app)/admin/issues/page.tsx` — admin issues browser (tabs, filters, pagination, inline resolve)
- `src/app/(app)/admin/settings/issue-categories/page.tsx` — category CRUD page

## File map (key files)
- `src/middleware.ts` — auth/role gate
- `src/lib/supabase/{client,server,middleware}.ts` — Supabase clients
- `src/lib/types.ts` — domain types
- `src/lib/utils.ts` — formatters (`formatINR`, `formatDate`, `formatDateTime`, `cn`)
- `src/components/ui/{button,input,card,badge,table,select,label,dialog,toast,textarea}.tsx`
- `src/components/providers.tsx` — TanStack Query + Toast
- `src/components/logout-button.tsx`
- `src/app/page.tsx` — root redirect by role
- `src/app/login/page.tsx`
- `src/app/(app)/layout.tsx` — header + sidebar shell (auth-gated)
- `src/app/(app)/invoices/page.tsx`
- `src/app/(app)/invoices/[id]/page.tsx` + `detail-client.tsx`
- `src/app/(app)/admin/page.tsx`
- `src/app/(app)/admin/approvals/page.tsx`
- `src/app/(app)/admin/discrepancies/page.tsx`
- `src/app/(app)/admin/settings/payment-sources/page.tsx`
- `src/app/(app)/audit/page.tsx`

## Known cleanup work (warnings, non-blocking)
- A few unused imports / placeholder props in `detail-client.tsx` flagged as warnings.

## Inbound Task — RI-4 + RI-5 (Report an Issue: dialog, card, list pill, admin page)
- Issued by PM: 2026-05-23
- Blocked on: RI-2 (backend RPCs + `v_invoice_list_with_issue` view live).
- Spec: `prd.md` § "Addendum — Report an Issue (2026-05-23)" — FR-095, FR-096, FR-097.
- Repo: `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-frontend`
- Files to create:
  - `frontend/src/components/issue/report-issue-dialog.tsx`
  - `frontend/src/components/issue/issue-report-card.tsx`
  - `frontend/src/app/(app)/admin/issues/page.tsx`
- Files to edit:
  - `frontend/src/lib/types.ts` — add `IssueReport`, `IssueCategory`, `ISSUE_CATEGORY_CATALOG` (a typed const keyed by source returning `{code,label}[]` per FR-089). Include union of "all" categories for every source.
  - `frontend/src/app/(app)/invoices/[id]/detail-client.tsx` — header "Report an issue" button (disabled if open report exists; tooltip explains); `useQuery(['issue-report', invoiceId])` selecting the latest report for this invoice; render `IssueReportCard` above reconcile panels when a report exists. Mutations invalidate `['issue-report', invoiceId]` AND the invoice list query.
  - `frontend/src/app/(app)/invoices/page.tsx` — switch list source to `v_invoice_list_with_issue` (or whatever name backend-dev confirms); render red "Issue reported" pill next to status badge when `has_open_issue = true`.
  - `frontend/src/app/(app)/layout.tsx` — add "Issues" nav item under the admin section.
- Behaviour locks:
  - `other` category → notes required and trimmed-non-empty before submit enables.
  - On `ISSUE_ALREADY_OPEN` error: inline message in the dialog plus a "View existing report" link that closes the dialog and scrolls to the card.
  - Status badge palette: open=red, resolved_by_admin=green, resolved_by_reconciliation=green, withdrawn_by_operator=slate.
  - Admin `/admin/issues` page: tabs (Open default / Resolved / All), filters (source, category, date range), server-side pagination (50), `reported_at desc`, row clicks navigate to `/invoices/[id]`, inline Resolve on open rows.
  - `npm run build` and `npx tsc --noEmit` must be clean after edits.
- Return: COMPLETED / FILES CHANGED / CONTEXT UPDATED / NEXT.

## Status
RI-4 + RI-5 DONE. Build clean (16 routes). Remaining: RI-6 (designer polish), RI-7 (QA).
