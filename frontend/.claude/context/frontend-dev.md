# Frontend Dev Context
<!-- Last updated: 2026-07-19 (MRR-4 pending_invoices section) -->
<!-- Previous: 2026-06-20 18:00 -->

## What I've Built

### [2026-06-20 18:00] CDW-4: Mark as Commission / TDS button on invoice detail
- Modified `/src/app/(app)/invoices/[id]/detail-client.tsx`:
  - Added `MarkAsCommissionTdsButton` component (rendered immediately below "Add Payment Manually" div)
  - Visibility: only shown when `outstanding > 0.0001` AND source does not include "walk" or "by phone"
  - Modal fields: Type (radio: Commission/TDS), Party (select: MMT / Goibibo, Agoda, Yatra, Others), free-text input revealed when "Others" selected, Amount (pre-filled with remaining gap, hard-capped at remaining gap), Note (optional textarea)
  - On submit: calls `rpc_submit_manual_payment_entry` with `p_payment_type`, `p_party_name` ("Others: {text}" for custom), `p_amount`, `p_transaction_date` (today ISO), `p_note`
  - Inline error mapping: `WRITEOFF_EXCEEDS_GAP` → "Amount exceeds the remaining gap", `PARTY_REQUIRED` → "Please select a party", `WRITEOFF_SOURCE_NOT_ELIGIBLE` → "Commission write-offs are not available…"
  - On success: toast + invalidates `["manual_entries", invoiceId]` + closes modal
  - Added `party_name` display in `ManualEntryRow` for commission/TDS entries (shown between date and submitter)
  - Added `note` display in `ManualEntryRow` for commission/TDS entries (slate-tinted box below main row)
  - `grandTotal` prop accepted by `MarkAsCommissionTdsButton` (passed from parent, not used internally — remaining gap drives the cap)
- Build: zero TypeScript errors, `npm run build` clean

### [2026-06-20 18:00] CDW-5: /reports/deductions page
- Created `/src/app/(app)/reports/deductions/page.tsx` — full deductions report page
  - Filters: Date From (default: Jan 1 of current year), Date To (default: today), Type (All/Commission/TDS), Party (text input)
  - Filters applied on "Apply filters" button click to avoid cascading re-fetches while typing
  - Table columns: Invoice # (link to /invoices/[id]), Guest, Source, Type badge (Commission/TDS), Party, Amount (₹), Approved Date
  - Summary totals section: two Cards (Commission + TDS), each with per-party breakdown and grand total row; only shown when totals data is non-empty
  - All 4 UI states: loading skeleton (4 animated rows), empty (friendly message), error (red banner + Retry button), success table
  - Data fetched via `rpc_get_deductions_report(p_date_from, p_date_to, p_type, p_party)` with TanStack Query
  - `TypeBadge` component renders info/warning Badge by payment_type
- Modified `/src/app/(app)/layout.tsx`:
  - Added `{ href: "/reports/deductions", label: "Deductions" }` to `adminLinks` (after Manual Payments)
  - Added same link to `operatorLinks` (after Payment Folio)
- Middleware confirmed: only blocks `/admin/*` for operators; `/reports/*` is accessible to both roles (no change needed)

### [2026-06-20 16:00] MPE-5: Admin Manual Payments page
- Created `/src/app/(app)/admin/manual-payments/page.tsx` — full admin review page for manual payment entries
- Three tabs: Pending / Approved / Rejected; each calls `rpc_get_pending_manual_payments(p_status)`
- Table columns: Invoice # (link to /invoices/[id]), Guest, Type badge, Amount (INR), Transaction Date, Submitted by, Warning flags
- Pending tab: Approve button per row (calls `rpc_approve_manual_payment_entry`); inline red error for `MANUAL_UPI_EXCEEDS_BANK_CREDIT` / `WRITEOFF_EXCEEDS_GAP`; success toast + row removed via query invalidation
- Reject flow: button opens `RejectDialog` (requires non-empty reason, submit disabled if empty); calls `rpc_reject_manual_payment_entry`; success toast + row removed
- `FlagChips` renders `admin_flags` as amber Badge chips; `NO_BANK_CREDIT` → "No bank credit found", `MPR_LINK_UNVERIFIED` → "MPR link unverified", unknown codes shown as-is
- `AdminManualPaymentEntry` extends `ManualPaymentEntry` with `invoice_number` and `guest_name` fields for admin view
- All 4 UI states handled: loading skeleton (8 columns, 4 rows), empty (tab-specific copy), error (with retry), populated table
- Added `{ href: "/admin/manual-payments", label: "Manual Payments" }` to `adminLinks` in `/src/app/(app)/layout.tsx` (after MIS Report, before Audit Log)
- Middleware at `/src/middleware.ts` already blocks operators from `/admin/*` — confirmed working
- Build: zero TypeScript errors (`npx tsc --noEmit` clean), `npm run build` clean

### [2026-06-20 10:00] MPE-4: Add Payment Manually button + modal + Manual Payment Entries list
- Modified `/src/lib/types.ts` — added `ManualPaymentType`, `ManualPaymentStatus`, `ManualPaymentEntry` interfaces
- Modified `/src/app/(app)/invoices/[id]/detail-client.tsx`:
  - Added `ManualPaymentType` to type imports
  - Added `<AddPaymentManuallyButton invoiceId={inv.id} />` rendered above the Linked Payments section (always visible, regardless of reconciliation status)
  - Added `<ManualPaymentEntriesSection invoiceId={inv.id} />` rendered below the bottom Linked Payments section, before InvoiceAudit
  - Added `AddPaymentManuallyButton` component: standalone button that opens a Dialog; form with payment type radio (UPI / Another Machine); UPI shows 5 fields (amount, transaction date, settlement date, VPA, UPI txn ID); Another Machine shows 2 fields (amount, transaction date); calls `rpc_submit_manual_payment_entry` via supabase RPC; inline error mapping for MANUAL_UPI_FIELDS_REQUIRED, MANUAL_UPI_EXCEEDS_BANK_CREDIT, AMOUNT_MUST_BE_POSITIVE; success toast + info banners for admin_flags; invalidates `["manual_entries", invoiceId]` query on success
  - Added `ManualPaymentEntriesSection` component: queries `rpc_get_manual_payment_entries` via react-query (key: `["manual_entries", invoiceId]`); all 4 UI states (loading skeleton, empty, error banner, entries list)
  - Added `ManualEntryRow` component: type badge (UPI / Another Machine), status badge (pending=amber, approved=green, rejected=slate), amount (₹), transaction date, submitted by email, reviewed_at for approved, rejection_reason for rejected, admin_flags as amber warning chips
- Build: zero TypeScript errors, `npm run build` passes clean

### [2026-05-23 11:00] BS-v2-2: "Reconciled To" column + sub-row tints in bank-statement drill-down
- Modified `/src/lib/types.ts` — added `BankStatementDrillReconciledInvoice` interface; added `reconciled_invoices`, `applied_total`, `base_amount` fields to `BankStatementDrillUpi`, `BankStatementDrillCard`, and `BankStatementDrillMmt`
- Modified `/src/app/(app)/bank-statement/bank-statement-client.tsx`:
  - Imported `BankStatementDrillReconciledInvoice` type
  - Added `ReconciledToCell` component: renders `—` for empty, single `<Link>` for 1 invoice, stacked `<div>`-wrapped `<Link>`s for 2+ invoices; all links use `stopPropagation`
  - Added `drillRowTintClass` helper: returns `bg-green-50` when `|applied_total - base_amount| < 1`, `bg-amber-50` when partial, empty string when no applied amount
  - Replaced the old "Invoice" column header with "Reconciled To" in all three drill tables (UPI, Card, MMT)
  - Replaced old invoice link cells with `<ReconciledToCell>` in all three drill tables
  - Replaced old per-row `className` tint logic (was `invoice_id ?` / `is_reconciled ?`) with `drillRowTintClass(applied_total, base_amount)` via `cn()`
- Build: zero TypeScript errors, `npm run build` passes clean

### [2026-05-23 10:00] Payment Folio Upload + Auto-select suggestions
- Created `/src/lib/xls/parse-payment-folio.ts` — BIFF8/xlsx parser using `xlsx` npm package; `parsePaymentFolio()` returns typed `PaymentFolioRow[]`; `sha256Hex()` computes file checksum via Web Crypto API
- Created `/src/hooks/use-payment-suggestions.ts` — TanStack Query hook wrapping `rpc_get_payment_suggestions`; 30s staleTime
- Created `/src/app/(app)/payment-folio/page.tsx` — full upload page with drag-and-drop zone, 10-row preview table, upload button, result/error cards; accessible to both admin and operator
- Modified `/src/app/(app)/layout.tsx` — added "Payment Folio" nav link in both `adminLinks` and `operatorLinks`, positioned after "Bank Statement"
- Modified `/src/lib/types.ts` — added `PaymentSuggestion` interface
- Modified `/src/app/(app)/invoices/[id]/detail-client.tsx` — imported `usePaymentSuggestions`; added suggestions section (blue-bordered card) between `IssueReportCard` and reconcile panels; passes `invoiceStatus` to `IssueReportCard`
- Modified `/src/components/issue/issue-report-card.tsx` — added `invoiceStatus` prop to `IssueReportCardProps`; Resolve button disabled with tooltip "Invoice must be reconciled first" when `invoiceStatus === 'unreconciled'`; `handleResolve` handles `INVOICE_NOT_RECONCILED` sentinel with inline error inside dialog; added `resolveError` state
- Build: zero TypeScript errors, zero build errors (`npm run build` passes clean)

### [2026-05-19 12:00] Yatra Payout Reconcile panel
- Created `/src/app/(app)/invoices/[id]/yatra-reconcile-panel.tsx` — new component
- Added `YatraBookingPayout`, `YatraReconcileCandidate`, `YatraReconcileCandidatesResponse` types to `/src/lib/types.ts`
- Modified `/src/app/(app)/invoices/[id]/detail-client.tsx`:
  - Added `isYatraSource()` helper alongside `isMmtSource()`
  - Added `isYatra` constant
  - Renders `<YatraReconcilePanel>` below `<MmtReconcilePanel>` for Yatra invoices
  - Updated outstanding label for Yatra invoices
  - `AddPaymentPanel` now defaults closed for both MMT and Yatra invoices
- Build passes with zero TypeScript errors

### [2026-05-17 15:00] Admin MIS Report page at /admin/mis
- Created `/src/app/(app)/admin/mis/page.tsx` — client component
- Fetches `v_mis_monthly_summary` (queryKey: `["mis.summary"]`) and `v_mis_payment_detail` (queryKey: `["mis.detail"]`) with TanStack Query on page load
- Summary bar: 4 stat tiles (Total Invoiced, Total Received, Same-Month Received, Total Pending) aggregated across all months; shows skeleton loading state
- Main table: one row per invoice_month; columns Invoice Month | Invoices | Total Invoiced | Total Received | Same Month | Other Months | Pending | Collection % | expand toggle
- Collection % coloured green (≥90%), amber (50–89%), red (<50%)
- Expandable rows: clicking a row toggles a `React.Fragment`-based inline expansion; only one row open at a time (`expandedMonth: string | null`)
- Sub-table pivot: filters detail rows by `invoice_month`, groups by `payment_month` x `payment_method`, shows UPI / Card / Bank Transfer / Cash columns; labels same-month rows with a green badge; sorted descending by payment_month
- All four UI states handled: loading skeletons, empty state with helpful message, error with retry button, success table
- Added "MIS Report" to `adminLinks` array in `/src/app/(app)/layout.tsx` (admin-only, href `/admin/mis`)
- TypeScript: zero errors (`npx tsc --noEmit` passes)

### [2026-05-17 14:00] Fix payment_method filter + auto-detect latest date in AddPaymentPanel
- Changed txQ query from `.eq("payment_method", method)` to `.in("payment_method", methodsForQuery)` so UPI selections include bank_transfer rows and Card selections include bank_transfer rows
- Added `methodsForQuery` useMemo that derives the correct set of methods per selection (upi→["upi","bank_transfer"], card→["card","bank_transfer"], other→[method])
- Added `latestDateQ` useQuery (key: `["txn.latest_date", method]`) that fetches the most recent `payment_date` for the selected method set, so the date picker never defaults to a day with no data
- Added a useEffect that applies `latestDateQ.data` to both `date` and `debouncedDate` (bypassing debounce delay) when the query resolves or method changes
- Replaced static helper text ("Pick the date the payment was received…") under the date input with a dynamic hint: "Latest available: DD MMM YYYY" (with loading/not-found states; hidden entirely for Cash)
- Build verified: `npm run build` passes with zero TypeScript errors

### [2026-05-17] Add Payment panel date picker fixes
- Changed default date from `invoice.arrival_time` to today's date (`new Date().toISOString().slice(0, 10)`)
- Added helper text below the date input explaining to pick the payment received date, not the arrival date
- Improved empty-state message in the transactions table: now amber-tinted, method-specific, and instructs the user to try April–May 2026 or check if the MPR file has been uploaded
- Debounced the date input with a `useEffect` + 400 ms `setTimeout` pattern — introduced a `debouncedDate` state variable so queries only fire when the user has stopped typing a fully-formed `YYYY-MM-DD` date

## Component Inventory

- `/src/app/(app)/reports/deductions/page.tsx` — Commission & TDS Deductions report page
  - `DeductionsPage` — page root; filter state, apply-on-button pattern; TanStack Query with key `["deductions_report", ...]`
  - `TypeBadge` — renders info/warning Badge for commission/TDS
  - Local interfaces: `DeductionRow`, `DeductionTotal`, `DeductionsReportResponse`, `DeductionTypeFilter`

- `/src/app/(app)/admin/manual-payments/page.tsx` — Admin Manual Payments review page
  - `ManualPaymentsPage` — page root; three tabs (pending/approved/rejected); per-row approve/reject actions; query key `["admin.manual_payments", tab]`
  - `AdminManualPaymentEntry` — local interface extending `ManualPaymentEntry` with `invoice_number` and `guest_name`
  - `FlagChips` — renders admin_flags array as amber Badge chips with human-readable labels
  - `RejectDialog` — small dialog requiring a non-empty reason before submitting rejection
  - `SkeletonRows` — loading skeleton rows for the table
  - `paymentTypeLabel` — maps payment_type code to display string
  - `flagLabel` — maps flag code to human-readable string (falls back to raw code)
  - `prettifyError` — strips Postgres sentinel prefixes

- `/src/lib/xls/parse-payment-folio.ts` — `parsePaymentFolio(buffer)` + `sha256Hex(buffer)` utilities; no UI
- `/src/hooks/use-payment-suggestions.ts` — `usePaymentSuggestions(invoiceId)` hook; wraps `rpc_get_payment_suggestions`
- `/src/app/(app)/payment-folio/page.tsx` — Payment Folio upload page (client component); drag-and-drop file input, preview table, upload via `rpc_upload_payment_folio`

- `/src/app/(app)/invoices/[id]/yatra-reconcile-panel.tsx` — Yatra Payout Reconcile panel
  - `YatraReconcilePanel` — top-level; takes `invoiceId` + `onReconciled` callback
  - Voucher searchable combobox with auto-select on guest name match; amber/blue match badges
  - Left column: all 9 numeric fields editable on blur, saved via `rpc_update_yatra_bookings_payout_fields`; `yatra_to_pay_hotel` highlighted in blue
  - Right column: read-only booking context (guest name, check-in/out, email date, prepay badge)
  - Transaction picker: method toggle (upi/card/bank_transfer only), date with latest-date auto-detect, table of transactions, amount dialog
  - Reconcile button calls `rpc_reconcile_yatra_invoice`; handles CONFIRM_PARTIAL_REQUIRED and OVERPAY_NOT_ALLOWED dialogs
  - YATRA_VOUCHER_NOT_FOUND renders amber "payout not received yet" message
  - Already-reconciled vouchers show green badge and disabled button
  - `DetailRow` — reusable label/value pair helper
  - `prettifyYatraError` — strips Postgres prefixes and sentinel codes

- `/src/app/(app)/admin/mis/page.tsx` — Monthly MIS Report page (client component)
  - `MisReportPage` — page root; fetches both Supabase views, manages `expandedMonth` state
  - `StatTile` — reusable stat card tile (title + large value)
  - `PaymentBreakdownTable` — sub-table shown inside expanded rows; receives raw detail rows and invoice_month, builds pivot internally
  - `buildPivot` — pure function: filters + groups detail rows into `PivotRow[]` keyed by payment_month
  - `formatMonthLabel` — formats "2026-04-01" → "Apr 2026"
  - `collectionRateClass` — returns Tailwind colour class based on collection rate threshold

- `/src/app/(app)/invoices/[id]/detail-client.tsx` — Invoice detail page client component
  - `InvoiceDetailClient` — top-level wrapper, fetches invoice + links, renders all child sections
  - `Field` — tiny presentational helper for label/value pairs
  - `LinkedPayments` — shows existing reconciliation links with un-reconcile request flow
  - `AddPaymentPanel` — payment method + date picker, transaction list (UPI/Card/Bank Transfer), cash entry, pending session list, save button with partial/overpay confirmation dialogs
  - `AddPaymentManuallyButton` — standalone "Add Payment Manually" button that opens a modal; supports UPI (5 fields) and Another Machine (2 fields) payment types; calls `rpc_submit_manual_payment_entry`; shows admin_flags as info banners post-submit
  - `MarkAsCommissionTdsButton` — shown when outstanding > 0 and source is not walk-in/by-phone; modal with Type radio, Party select (with Others free-text), Amount (pre-filled/capped at gap), Note; calls `rpc_submit_manual_payment_entry` with commission/tds type
  - `ManualPaymentEntriesSection` — queries `rpc_get_manual_payment_entries`; shows loading skeleton, empty, error, or list of `ManualEntryRow` cards
  - `ManualEntryRow` — displays one manual entry: type badge, status badge, amount, date, party_name (for commission/TDS), submitter email, note (for commission/TDS), rejection reason, admin_flag chips
  - `InvoiceAudit` — collapsible audit log for the invoice
  - `prettifyError` — strips Postgres error prefixes into user-friendly text

## Current State

- Deductions report page live at `/reports/deductions` (both admin and operator)
- Commission/TDS button live on invoice detail page (OTA invoices with outstanding balance only)
- Admin Manual Payments page live at `/admin/manual-payments` (admin only via middleware)
- Payment Folio upload page is fully functional at `/payment-folio` (both roles)
- Payment suggestions auto-appear on invoice detail when folio matches booking_id or invoice_number
- IssueReportCard Resolve button gated by invoice reconciliation status
- Admin MIS Report page is fully functional at `/admin/mis`
- Invoice detail page is fully functional
- All four UI states (loading, empty, error, success) handled throughout
- AddPaymentPanel: date defaults to today, queries debounced, empty state is actionable

## Pending / In Progress

- None at this time

## Decisions Log

### [2026-06-20] MPE-5: Per-row inline errors for approve, not a modal
- `MANUAL_UPI_EXCEEDS_BANK_CREDIT` and `WRITEOFF_EXCEEDS_GAP` are kept inline below the action buttons on that row — the admin needs to see the row context (amount, flags) while reading the error message
- A toast would lose the context; a modal would add unnecessary indirection
- `approveErrors` is a `Record<string, string>` keyed by entry id so multiple rows can independently show their errors without interfering

### [2026-06-20] MPE-5: RejectDialog resets reason on open
- `useEffect` resets `reason` state whenever `open` flips to true, so re-opening the dialog after cancelling starts fresh
- Avoids stale rejection text being accidentally submitted for a different entry

### [2026-06-20] MPE-4: AddPaymentManuallyButton placed above LinkedPayments using a wrapper div
- The button is a sibling `<div>` above the LinkedPayments Card (not inside it), keeping concerns separate
- After successful submit with admin_flags, the modal stays open showing info banners; "Close" replaces the Submit/Cancel footer so the operator reads the flags before dismissing
- ManualPaymentEntriesSection uses a divide-y list instead of a Table, since each entry can have variable-height content (rejection reason, flag chips)
- `rejected` status uses `variant="default"` (grey) rather than `destructive` (red) — red would be alarming; slate/grey conveys "inactive" more accurately for a rejected entry

## Decisions Log

### [2026-05-23] BS-v2-2: Replaced old `invoice_id`/`is_reconciled` tint with `applied_total`/`base_amount`
- Old logic tinted green whenever any invoice was linked at all (even for partial amounts)
- New logic uses the numeric `applied_total` vs `base_amount` comparison: fully matched = green, partial = amber, nothing = no tint
- This is more accurate — a row reconciled to multiple invoices summing to the full amount shows green; one partially reconciled shows amber
- `drillRowTintClass` helper is pure so it is unit-testable without rendering

## Decisions Log

### [2026-05-17] UPI/Card queries include bank_transfer rows
- A UPI payment or card payment creates a credit entry in the bank statement as well
- Filtering by exact method meant operators could not find the bank_transfer counterpart of a UPI payment
- Using `.in()` with ["upi", "bank_transfer"] / ["card", "bank_transfer"] surfaces both sources
- The source_table column still distinguishes the row origin in the UI

### [2026-05-17] Latest-date auto-detection replaces static default
- Static "today" default was always wrong because MPR data lags by 1-3 days
- A lightweight single-row query (`limit(1)` + `order desc`) finds the real latest date per method
- Both `date` and `debouncedDate` are set together on resolution to prevent a redundant 400 ms debounce delay when just switching methods
- The dynamic "Latest available" hint replaces the old static instructional copy, giving operators immediate signal about data freshness

### [2026-05-17] Default date changed to today
- Operators enter payments on the day they process them, not the guest's arrival date
- Arrival date defaulting caused "No transactions" confusion on nearly every invoice open

### [2026-05-17] Debounce via useEffect + debouncedDate state
- Used `useEffect` + `setTimeout` (400 ms) rather than `useDeferredValue` because we also need to gate on a regex check (`/^\d{4}-\d{2}-\d{2}$/`) before firing
- `useDeferredValue` doesn't support conditional firing; the effect approach is cleaner here

### [2026-05-17] Empty state styled amber instead of plain muted text
- Gives the operator a visual cue that something needs action (pick a different date / upload MPR)
- Not using red (error) because an empty result is not a system error

## Decisions Log

### [2026-05-23] Payment Folio parse uses `xlsx` package, not a custom BIFF8 parser
- `xlsx` npm package is already installed and handles both `.xls` (BIFF8) and `.xlsx`
- `XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true })` correctly opens the OLE compound document without a custom parser
- Writing a full BIFF8 OLE parser in TypeScript would be several hundred lines for no practical benefit here

### [2026-05-23] Resolve button uses `<span title={...}>` wrapper for tooltip on disabled button
- `disabled` HTML buttons do not fire mouse events, so `title` tooltip doesn't work on the button itself
- Wrapping in a `<span title={...}>` surfaces the native browser tooltip on hover even when button is disabled
- No dependency on a tooltip component library needed

### [2026-05-23] Suggestions section renders only when data.length > 0 — no loading state shown
- Suggestions are supplementary/contextual — there is no user expectation that they always appear
- Showing a loading spinner for suggestions would be visually noisy; the section simply appears when data arrives
- If the RPC errors, it is silently swallowed by TanStack Query (data stays empty array); an error state here would be misleading

## Notes for Product Manager

- CDW-5: The page calls `rpc_get_deductions_report(p_date_from, p_date_to, p_type, p_party)`. The RPC must return `{ rows: [...], totals: [...] }`. If the RPC returns a flat array instead of an object, update the `queryFn` cast in `deductions/page.tsx` accordingly.
- CDW-5: Middleware does not restrict `/reports/*` — confirmed in `src/middleware.ts` (only `/admin/*` is gated). No change needed.
- CDW-4: The "Mark as Commission / TDS" button is hidden for walk-in and "By Phone" sources (checked via `source.toLowerCase().includes("walk")` and `source.toLowerCase().includes("by phone")`). If other direct-booking source names need to be excluded, add them to the same check in `InvoiceDetailClient`.
- CDW-4: The `MarkAsCommissionTdsButton` accepts a `grandTotal` prop (passed from parent) but does not use it internally — the remaining gap (`outstanding`) is the operative cap. `grandTotal` is available for future use (e.g., showing a "% of total" breakdown).
- CDW-4: The "Others" party name is stored as `"Others: {text}"` in `party_name`. The admin review page and deductions report will show it verbatim. Consider normalising this on the backend if reporting by party is needed.

- MPE-5: The page calls `rpc_get_pending_manual_payments(p_status)` with 'pending'/'approved'/'rejected'. The RPC must return `invoice_number` and `guest_name` columns alongside the `ManualPaymentEntry` fields — if those are missing from the RPC response the cells will show "—" gracefully (no crash).
- MPE-5: The `commission` and `tds` payment types are in the `ManualPaymentType` union and will display if returned, but the operator-side `AddPaymentManuallyButton` only exposes `upi` and `another_machine`. If those types are added to the submit form, no frontend changes are needed here.
- MPE-5: Middleware blocks operators from `/admin/*` — no frontend role check is needed in the page itself.

- MPE-4: The "Add Payment Manually" button is visible to all roles on every invoice — if you want to restrict it to operators only (or admin only), a one-line role check in `detail-client.tsx` suffices.
- MPE-4: The modal for "Received in Another Machine" only collects amount + transaction date. If you need party name or notes for that type, add those fields to the form and pass them to the RPC.
- MPE-4: `admin_flags` from the RPC are surfaced as info banners in the modal (post-submit) and as amber chips in the entries list. The two codes mapped explicitly are `NO_BANK_CREDIT_FOUND` and `MPR_UNVERIFIED`; any other code falls back to showing the raw code string — add more mappings as new flag codes are introduced.
- MPE-4: `ManualPaymentEntriesSection` always renders (not gated by status) so operators can see historical entries regardless of reconciliation state.



- Payment Folio page (`/payment-folio`): the page is accessible to both operator and admin — no role gate. If you want to restrict upload to admin only, a one-line change to layout.tsx (move the link back to `adminLinks` only) is sufficient.
- Payment Folio suggestions on the invoice detail page are informational only — they show matching folio entries but the operator still needs to reconcile via the AddPaymentPanel or OTA panel. The suggestion cards do not auto-link anything.
- IssueReportCard Resolve button: disabled with tooltip when invoice is `unreconciled`. The `invoiceStatus` prop is passed from `detail-client.tsx` as `inv.reconciliation_status ?? 'unreconciled'`. If the DB returns null for status, it will treat it as unreconciled (safe default).

- Yatra panel: the transaction picker only allows UPI, Card, Bank Transfer — Cash and MMT Payout are blocked per RPC spec. If operators need cash reconciliation for Yatra, it must go through the standard AddPaymentPanel.
- Yatra panel: unlike MMT (which auto-matches a bank statement row from inside the RPC), Yatra lets the operator manually pick the transaction. This is by design — Yatra payouts are batched differently to MMT.
- The `AddPaymentPanel` now defaults closed for Yatra invoices (same as MMT) since operators should use the dedicated reconcile panel first.
- The "Latest available: ..." hint in the date field now reflects the actual latest date in the DB for the selected payment method — no more hardcoded date ranges. The empty-state amber message still says "April–May 2026"; that copy can be removed or updated once the dynamic hint makes the range obvious.
- The `invoice.arrival_time` default removal is intentional — confirm with ops team that the auto-detected latest-available date is the right default for all hotel types (walk-in vs OTA pre-payment scenarios may differ).
- UPI/Card now queries bank_transfer rows too. If an operator sees duplicate-looking entries (one from upi_transactions and one from bank_statement for the same payment), that is expected — they should pick the one they want to reconcile against. Consider adding a visual separator or sub-header in the transactions table to group by source_table.

### [2026-07-19] MRR-4: Section 4 — Pending Reconciliation on `/reports/reconciliation/[month]`
- Modified `frontend/src/lib/types.ts`:
  - Added `PendingReconciliationInvoice` interface: `{id, invoice_number, guest_name, checkout_date, source, grand_total, received, outstanding, status: "unreconciled" | "partial"}`.
  - Added `pending_invoices: PendingReconciliationInvoice[]` to `ReconciliationMonthDetail`.
- Modified `frontend/src/app/(app)/reports/reconciliation/[month]/reconciliation-detail-client.tsx`:
  - Imported `PendingReconciliationInvoice` from `@/lib/types`.
  - Added Section 4 after the Payment Timing card. Hidden when `pending_invoices.length === 0`.
  - Card title shows "Pending Reconciliation" with amber pill badge (count).
  - Table columns: Invoice #, Guest, Check-out (dd MMM), Source, Amount, Received, Outstanding (amber text), Status (pill badge: red=Unreconciled, yellow=Partial), Reconcile → link to `/invoices/[id]`.
  - `checkout_date` parsed as `new Date(inv.checkout_date + "T00:00:00")` to avoid UTC midnight shift.
  - Outstanding uses `roundOutstanding(zero(inv.outstanding))` — sub-₹1 displays as ₹0.
  - `tsc --noEmit` passes clean.
