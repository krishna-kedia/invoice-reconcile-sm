# Frontend Dev Context
<!-- Last updated: 2026-05-17 15:00 -->

## What I've Built

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
  - `InvoiceAudit` — collapsible audit log for the invoice
  - `prettifyError` — strips Postgres error prefixes into user-friendly text

## Current State

- Admin MIS Report page is fully functional at `/admin/mis`
- Invoice detail page is fully functional
- All four UI states (loading, empty, error, success) handled throughout
- AddPaymentPanel: date defaults to today, queries debounced, empty state is actionable

## Pending / In Progress

- None at this time

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

## Notes for Product Manager

- The "Latest available: ..." hint in the date field now reflects the actual latest date in the DB for the selected payment method — no more hardcoded date ranges. The empty-state amber message still says "April–May 2026"; that copy can be removed or updated once the dynamic hint makes the range obvious.
- The `invoice.arrival_time` default removal is intentional — confirm with ops team that the auto-detected latest-available date is the right default for all hotel types (walk-in vs OTA pre-payment scenarios may differ).
- UPI/Card now queries bank_transfer rows too. If an operator sees duplicate-looking entries (one from upi_transactions and one from bank_statement for the same payment), that is expected — they should pick the one they want to reconcile against. Consider adding a visual separator or sub-header in the transactions table to group by source_table.
