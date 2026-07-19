# Designer Context
<!-- Last updated: 2026-07-18 12:00 -->

## Design System

### Colors

**Status badges (ManualPaymentEntry.status):**
- `pending` → `variant="warning"` → `bg-amber-100 text-amber-900`
- `approved` → `variant="success"` → `bg-green-100 text-green-800`
- `rejected` → `variant="default"` → `bg-secondary text-secondary-foreground` (grey/slate)

**Type badges (ManualPaymentEntry.payment_type):**
- `upi` → `bg-blue-100 text-blue-800`
- `another_machine` → `bg-slate-100 text-slate-600`
- `commission` → `bg-orange-100 text-orange-800`
- `tds` → `bg-purple-100 text-purple-700`

**Warning / admin flag chips:**
- `inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700`
- Note: `rounded-full` (pill shape), no `font-medium` weight, softer `text-amber-700`

**Summary card tints:**
- Commission card: `bg-orange-50` on `<Card>`
- TDS card: `bg-purple-50` on `<Card>`

**Existing badge variants (badge.tsx):**
- `default`: `bg-secondary text-secondary-foreground`
- `outline`: `border border-border text-foreground`
- `destructive`: `bg-red-100 text-red-800`
- `success`: `bg-green-100 text-green-800`
- `warning`: `bg-amber-100 text-amber-900`
- `info`: `bg-purple-100 text-purple-800`

### Typography
- Page heading: `text-xl font-semibold`
- Card titles: `CardTitle` component (inherited)
- Table cells: `text-xs` for muted context, `text-sm` for primary content
- Labels: `Label` component

### Spacing
- Modal field gap: `space-y-3` (previously `space-y-4` — changed for tighter modal rhythm)
- Card internal padding: `p-4` or `CardContent` default
- Between stacked buttons: `mt-2` on second button wrapper

### Component Patterns

**Stacked action buttons (invoice detail):**
- Both "Add Payment Manually" and "Mark as Commission / TDS" are wrapped in a single `<div className="flex flex-col items-end gap-0">` 
- "Add Payment Manually": `<Button variant="outline">`
- "Mark as Commission / TDS": `<Button variant="outline" className="text-muted-foreground">` inside `<div className="mt-2">`
- The muted foreground colour on the second button visually subordinates it without hiding it

**Admin queue table rows:**
- Pending rows: `<TR className="border-l-2 border-amber-400">` — the amber left border signals "needs action"
- Approved/Rejected rows: no extra class
- Approve button: `<Button size="sm">` (default/primary variant)
- Reject button: `<Button size="sm" variant="outline" className="text-red-700 border-red-200 hover:bg-red-50">`
- Inline approve error: `text-xs text-red-600 mt-1`

**Type badge pattern:**
- Do NOT use `variant="outline"` for type badges — type must be visually distinct per category
- Use `<Badge className={TYPE_BADGE_CLASS[type]}>` with the colour map above
- The colour map lives as a module-level const so it can be reused

**Warning flag chips:**
- Use `<span>` not `<Badge>` — Badge has `rounded-md`; chips need `rounded-full` for the pill shape
- Class: `inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700`

**Modal layout rhythm:**
- `space-y-3` between fields (not `space-y-4`)
- Add Payment Manually: Type → Amount → Transaction Date → (UPI fields: Settlement Date, VPA, UPI Txn ID)
- Mark as Commission/TDS: Type → Party → (Other party input, conditional) → Amount → Note

## What I've Styled

### [2026-06-20 19:00] MPE-6 + CDW-6: Polish pass on manual payment UI
**Files changed:**
- `frontend/src/app/(app)/invoices/[id]/detail-client.tsx`
- `frontend/src/app/(app)/admin/manual-payments/page.tsx`
- `frontend/src/app/(app)/reports/deductions/page.tsx`

**What was styled:**

`detail-client.tsx`:
- Wrapped "Add Payment Manually" and "Mark as Commission/TDS" buttons in a single `flex flex-col items-end` container; second button has `mt-2` and `text-muted-foreground` to visually subordinate it
- Added `TYPE_BADGE_CLASS` const mapping all four payment types to distinct colour classes
- `ManualEntryRow` type badge changed from `variant="outline"` (neutral) to coloured `className` overrides
- Admin flag chips: changed from `<Badge variant="warning">` to `<span>` with `rounded-full border-amber-200 bg-amber-50 text-amber-700` (pill shape, softer colour)
- Both modal `space-y-4` → `space-y-3` for tighter field rhythm

`manual-payments/page.tsx`:
- Added `PAYMENT_TYPE_CLASS` const with same colour map
- Pending `<TR>` rows get `border-l-2 border-amber-400` left accent
- Type badge in table changed from `variant="outline"` to coloured `className`
- `FlagChips` component: replaced `<Badge variant="warning">` with amber pill `<span>`
- Inline approve error: `text-red-700` → `text-red-600 mt-1`

`reports/deductions/page.tsx`:
- `TypeBadge`: Commission changed from `variant="info"` (purple) to `bg-orange-100 text-orange-800`; TDS changed from `variant="warning"` (amber) to `bg-purple-100 text-purple-700`
- Commission summary card: `<Card className="bg-orange-50">`
- TDS summary card: `<Card className="bg-purple-50">`

### [2026-05-19 09:00] BS-Polish-1 (Bank Statement Visual Polish Spec)
- Output spec only (no file edits) — see spec in the section below
- Confirmed layout is already full-width
- Specced filter chip classes, row tints, clickable row focus ring, left-border removal, split-row tint fix

### [2026-07-18 12:00] MRR-3: Polish pass on reconciliation report pages
**Files changed:**
- `frontend/src/app/(app)/reports/reconciliation/reconciliation-summary-client.tsx`
- `frontend/src/app/(app)/reports/reconciliation/[month]/reconciliation-detail-client.tsx`

**What was styled:**

`reconciliation-summary-client.tsx`:
- `showOrDash()` now returns `<span className="text-muted-foreground">—</span>` for zero values instead of a plain string, so em dashes are visually muted across all zero cells
- Added `outstandingClass()` helper: negative = `text-green-700 dark:text-green-400`, zero = `text-muted-foreground`, positive = no class (default text)
- Data row "Total Received" and "Total Deductions" cells: `font-medium` → `font-semibold` to visually signal they are subtotals
- Totals row: `bg-gray-50 dark:bg-gray-800` → `bg-muted/40 border-t` to use design system tokens and add a visual separator

`reconciliation-detail-client.tsx`:
- `SummaryCard` value: `font-semibold` → `font-bold` (matches task spec)
- Summary cards grid: `md:grid-cols-4` → `lg:grid-cols-4` on both loading and success states
- Outstanding card: value wrapped in `<span>` with amber (> 0) or green (≤ 0) conditional color
- Added `SkeletonRows` component matching actual column counts (8 cols for booking type, 3 for payment timing)
- Loading skeleton card content: replaced blob divs with `p-0` CardContent + proper `<table><TBody><SkeletonRows /></TBody></table>` structure
- Pending row in payment timing: moved text color from per-cell to TR level (`text-amber-700 dark:text-amber-400`), fixed dark class from `dark:bg-amber-900/20` → `dark:bg-amber-950/20`

## Pending / In Progress
- None

## Decisions Log

### [2026-06-20] MPE-6: `rounded-full` for flag chips, not `rounded-md`
- `Badge` uses `rounded-md` by design (square-ish pill for labels)
- Warning flags are a different semantic element — shorter, contextual alerts that read better as full pills
- Using `<span>` directly avoids fighting Badge's border radius

### [2026-06-20] MPE-6: `text-muted-foreground` on "Mark as Commission/TDS" button
- Both buttons are `variant="outline"` — they would look identical without differentiation
- "Mark as Commission/TDS" is a less-common action than "Add Payment Manually"; muted text signals secondary priority without hiding the button
- Hotel staff on OTA invoices with a gap will see both; the muted colour guides them toward the primary action first

### [2026-06-20] MPE-6: Commission=orange, TDS=purple (type badge palette)
- Commission is an OTA deduction (a cost borne by the hotel) — orange signals "expense/deduction" without red (which is reserved for errors)
- TDS is a tax withholding — purple is already the `info` variant, appropriate for regulatory/informational entries
- UPI=blue (informational, digital) and Another Machine=slate (neutral, physical) follow existing badge palette logic

### [2026-06-20] MPE-6: `space-y-3` in modals instead of `space-y-4`
- Both modals have 4-6 fields; `space-y-4` pushes them far enough apart that the modal grows tall on mobile
- `space-y-3` (12px) is sufficient for label-input pairs with 16px labels; the visual separation remains clear

### [2026-05-19] BS-Polish-1 Spec decisions
- Chose chip row treatment (A) over popover — multi-select is immediately legible from visual state
- Confirmed layout is already full-width — no code change needed
- Tints: `bg-green-50 hover:bg-green-100` (fully applied), `bg-amber-50 hover:bg-amber-100` (partial)
- Amber left-border on unreconciled rows dropped (no replacement — absence of tint is sufficient signal)

## Notes for Product Manager

- MPE-6: The `TYPE_BADGE_CLASS` and `PAYMENT_TYPE_CLASS` consts are duplicated across `detail-client.tsx` and `manual-payments/page.tsx`. If a third screen needs type badges, extract them to a shared helper in `src/components/ui/badge.tsx` or `src/lib/payment-type.ts`.
- MPE-6: The "Mark as Commission/TDS" button is now visually subordinated (muted text) to "Add Payment Manually". If user testing shows operators miss it, remove `text-muted-foreground` — the button is still fully visible and functional.
- CDW-6: The `TypeBadge` in the deductions report now correctly shows Commission=orange and TDS=purple. The previous `variant="info"` (purple) for Commission was incorrect — it made Commission and TDS look identical in colour, which is confusing in a report that compares both.

## BS-Polish Spec (2026-05-19)

### 1. Full-width container (`layout.tsx`)
No structural change needed — layout already full-width.

### 2. Filter control treatment
Chose (A) refined chip row. Inactive chip: `rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. Active chip: `rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.

### 3. Row tints
Green (fully applied): `bg-green-50 hover:bg-green-100`. Amber (partial): `bg-amber-50 hover:bg-amber-100`. Unreconciled: no class.

### 4. Clickable rows
`tabIndex={0}` + `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset` + `onKeyDown` for Enter/Space.

### 5. Drop amber left-border
Remove `borderCls` entirely. No replacement.

### 6. Split-row tint coherence
Remove `if (r.split_index > 1) return ""` guard from `rowColorClass()`.

READY FOR FRONTEND-DEV
