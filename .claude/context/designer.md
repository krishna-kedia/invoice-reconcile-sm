# Designer Context
<!-- Last updated: 2026-05-19 09:00 -->

## Last Activity
N/A — Designer not yet invoked for any built work.

## Inbound Task — BS-Polish-1 (Bank Statement Visual Polish Spec)
- Issued by PM: 2026-05-19 09:00
- Repo (cwd): `/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-frontend`
- Files to read first:
  - `frontend/src/app/(app)/layout.tsx`
  - `frontend/src/app/(app)/bank-statement/bank-statement-client.tsx`
  - `frontend/src/app/globals.css` (theme tokens)
  - `frontend/src/components/ui/{table,badge,button,input,label,card}.tsx` (existing primitives)
- Scope (all 6 points are LOCKED by the user — do NOT debate them, only specify the visual treatment):
  1. **Full-width** — `(app)/layout.tsx` currently wraps header inner and main in `max-w-7xl mx-auto`. Both wrappers go full-width. Specify exact replacement classes (suggest `w-full px-6` on both, or `px-8` on wide screens — your call, but the header and main must visually align). Sidebar `w-52` stays.
  2. **Filter controls** on `/bank-statement` — current Method and Drill-down filters are a row of small `<button>` "pills" (multi-select toggles). The user wants them to look polished and consistent with the date/text/amount inputs in the same Filters card. Pick ONE treatment:
     - (A) Refined chip row — same multi-select buttons but better sizing/spacing/active state/focus ring; align baseline with the inputs.
     - (B) Popover trigger button labelled like "Method (2 selected) ▾" that opens a checkbox list.
     Justify your choice in one sentence. Provide exact Tailwind classes.
  3. **Row tints** for the bank-statement table. Tint is computed per `bank_id` from the sum of `amount_applied` across all its split rows:
     - sum === 0 → no tint (default)
     - |sum − deposit_amt| < 1 → pastel green (fully applied)
     - 0 < sum < deposit_amt → pastel yellow (partial)
     Constraints:
     - Must compose with the existing `<TR>` hover (`hover:bg-muted/30`).
     - All splits of one `bank_id` get the same tint.
     - Subtle enough to not fight the method badge palette (UPI=blue, Card=purple, Bank=slate, Cash=green, MMT=orange).
     - Spec a working hover variant so hover still gives feedback over a tinted row.
     - Suggested starting points: `bg-green-50 hover:bg-green-100` and `bg-amber-50 hover:bg-amber-100`. Adjust if you have a better recommendation given the theme; either way commit to one.
  4. **Clickable rows** — when `canExpand === true` (`split_index === 1 && drill_type !== null`), the entire row toggles expand on click. Spec:
     - `cursor-pointer` on the `<TR>`.
     - Hover bg that works WITH the tint (probably the same hover variants from point 3).
     - Focus ring (rows should be keyboard-focusable; consider `tabIndex={0}` + `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`).
     - Invoice `<Link>` keeps its current style but receives `onClick={(e) => e.stopPropagation()}`.
     - Chevron remains visible as a hint — spec whether it stays its own button (recommended) or just an icon span.
  5. **Drop amber left-border** on unreconciled rows (`isUnreconciled && !isSplit`). Confirm in spec; no replacement.
  6. **Split-row coherence** — implementation-side concern but designer should confirm tint applies to ALL splits of a bank_id identically.

- Output: replace the section below titled "BS-Polish Spec (2026-05-19)" with your actual spec. Include literal class strings the frontend can paste. End with a one-line "READY FOR FRONTEND-DEV" line.

## BS-Polish Spec (2026-05-19)

### 1. Full-width container (`layout.tsx`)

**Current state found:** The layout does NOT use `max-w-7xl` anywhere. The header inner `<div>` already has `px-6 py-3` with no max-width constraint. The body row already has `px-6 py-6` with no max-width constraint. The sidebar is `w-52 shrink-0` and main is `flex-1 min-w-0`. The layout is already effectively full-width.

**Required change:** No structural change needed. The existing classes are correct as-is:
- Header inner div: `flex items-center justify-between px-6 py-3` — keep exactly.
- Body row div: `flex gap-6 px-6 py-6` — keep exactly.
- Sidebar: `w-52 shrink-0` — keep.
- Main: `flex-1 min-w-0` — keep.

No code change required for item 1.

---

### 2. Filter control treatment (`bank-statement-client.tsx`)

**Current state found:** Method and Drill-down filters are `<button>` elements with `rounded-md border px-2 py-1 text-xs font-medium transition`. Active state: `border-primary bg-primary text-primary-foreground`. Inactive: `border-border hover:bg-muted`. They are sized smaller than the inputs (which are `h-10`) and sit on a separate row below the 7-column text/date/amount grid.

**Chosen treatment: (A) Refined chip row.**

Rationale: The multi-select behaviour is immediately understandable from visual state — a popover adds an interaction layer that slows down frequent-use filters for hotel staff scanning dozens of rows.

**Exact class strings:**

Inactive chip:
```
rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
```

Active chip:
```
rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
```

Notes:
- `border-input` on inactive chips matches the Input component's border, unifying the Filters card visually.
- `px-3 py-1.5` (vs the current `px-2 py-1`) gives a more comfortable tap/click target and aligns chip height closer to `h-10` inputs when label text wraps.
- `bg-background` on inactive chips gives a clean white surface matching the Input background.
- `hover:bg-accent hover:text-accent-foreground` mirrors the outline Button hover.
- Focus ring matches Input and Button exactly (`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`).
- The wrapping `<div>` with `mt-1 flex flex-wrap gap-1.5` stays unchanged — gap-1.5 is correct.

---

### 3. Row tints (per `bank_id` group)

**Current state found:** `rowColorClass()` already exists and returns tint classes, but it operates on individual row data, not on a pre-computed per-`bank_id` sum. Split rows (`split_index > 1`) return `""` unconditionally, meaning they get no tint. This is the bug the spec addresses.

**Confirmed tint classes:**

Green tint (fully applied, `|sum − deposit_amt| < 1`):
- Base: `bg-green-50`
- Hover: `hover:bg-green-100`
- Full class string on `<TR>`: `bg-green-50 hover:bg-green-100`

Yellow tint (partial, `0 < sum < deposit_amt`):
- Base: `bg-amber-50`
- Hover: `hover:bg-amber-100`
- Full class string on `<TR>`: `bg-amber-50 hover:bg-amber-100`

No tint (unreconciled, `sum === 0`): no class added — the default `hover:bg-muted/30` from `TR` in `table.tsx` applies.

**Composition with existing TR hover:** The `TR` component in `table.tsx` has `hover:bg-muted/30` as a base class. When we add `hover:bg-green-100` or `hover:bg-amber-100` via `cn()`, Tailwind Merge will resolve the conflict in favour of the last class — the tinted hover wins. This is the correct behaviour. Confirm with the frontend dev that `cn` (which uses `twMerge`) is used to merge these classes; it is — `rowColorClass` result is passed to `cn(borderCls, colorCls, ...)`.

**Badge palette compatibility check:**
- `bg-green-50` row tint vs `bg-green-100 text-green-800` Cash badge: the badge is darker and saturated; the row is near-white. No conflict — the badge reads clearly.
- `bg-amber-50` row tint vs `bg-blue-100` (UPI), `bg-purple-100` (Card), `bg-orange-100` (MMT), `bg-slate-100` (Bank): all badge backgrounds are 100-level on their respective hues; `bg-amber-50` row is 50-level — subtle enough that badge colours dominate. No conflict.

---

### 4. Clickable rows

**Current state found:** `canExpand` rows already have `cursor-pointer` and an `onClick` on `<TR>`. The invoice `<Link>` already has `onClick={(e) => e.stopPropagation()}`. The chevron is already a `<span>` with `aria-hidden="true"`, not a `<button>`. However, `tabIndex` and a focus ring are absent from the `<TR>`.

**Spec for `<TR>` when `canExpand === true`:**

```
className={cn(
  colorCls,           // tint + hover tint from item 3
  "cursor-pointer",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
)}
tabIndex={0}
onKeyDown={(e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    setExpanded((s) => ({ ...s, [r.bank_id]: !s[r.bank_id] }));
  }
}}
```

- `tabIndex={0}` makes the row keyboard-focusable.
- `focus-visible:ring-inset` keeps the ring inside the row border, preventing layout shift on a table row (which cannot have `ring-offset` without artifacts).
- `onKeyDown` for Enter and Space is required for keyboard accessibility alongside `tabIndex`.
- The amber left-border (`borderCls`) is removed (see item 5), so `borderCls` disappears from the `cn()` call.
- The chevron `<span>` stays as `aria-hidden="true"` — it is a visual hint only. The `<TR>`'s `onClick` handles expand/collapse. The chevron gets no `onClick` of its own (the earlier "chevron is its own button" was reconsidered — it was already changed to a span in the current code, which is correct; keep it).
- The invoice `<Link>` already has `onClick={(e) => e.stopPropagation()}` — keep it exactly.

---

### 5. Drop amber left-border

**Current state found:** The `borderCls` variable is:
```js
const borderCls = isUnreconciled && !isSplit ? "border-l-2 border-gray-700" : "";
```
This produces a dark gray (not amber — the code uses `border-gray-700`) left border on unreconciled non-split rows. This is confirmed present in the current implementation.

**Spec:** Remove `borderCls` entirely. Delete the variable declaration and remove it from the `cn()` call on `<TR>`. No replacement class. Unreconciled rows are distinguished solely by the absence of a green or amber tint (they will have no tint and the default `hover:bg-muted/30` hover).

---

### 6. Split-row tint coherence

**Current state found:** `rowColorClass()` checks `if (r.split_index > 1) return ""` — split rows get no tint at all today. The tint class is computed per-row from `r.total_amount_applied`, which is the sum across all splits (it is the same value on every row of the same `bank_id` group, per the view definition). The bug is only in the `split_index > 1` guard that suppresses it.

**Confirmed spec:** The tint must be computed once per `bank_id` using `total_amount_applied` (which the view already provides consistently across all splits of a `bank_id`), then applied to every row in that group including split rows (`split_index > 1`). The fix is to remove the `if (r.split_index > 1) return ""` guard in `rowColorClass()`. All rows sharing a `bank_id` will then receive the same tint class because they share the same `total_amount_applied` and `deposit_amt` values.

The updated `rowColorClass` logic:
```ts
function rowColorClass(r: BankStatementRow): string {
  const applied = r.total_amount_applied ?? 0;
  if (applied <= 0) return "";
  if (Math.abs(applied - r.deposit_amt) < 1) return "bg-green-50 hover:bg-green-100";
  if (applied > 0 && applied < r.deposit_amt) return "bg-amber-50 hover:bg-amber-100";
  return "";
}
```

Note: the `|sum − deposit_amt| < 1` threshold (not `>=`) is used for "fully applied" to handle floating-point rounding in INR amounts.

---

READY FOR FRONTEND-DEV

## Up Next After BS-Polish (E10 — pre-existing)
Walk every page and every error state in the frontend. Confirm style-guide compliance per `prd.md` § UI Requirements:
- Spacing rhythm: 4/8/16/24 grid; cards use 16px internal padding.
- Status badge palette already in place: `unreconciled`=red, `partial`=amber, `fully_reconciled`=green, `flagged_for_review`=purple (see `src/components/ui/badge.tsx`).
- Error messages must state what happened, why, and what to do next.
- Focus rings: tailwind primitives already include `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.

## Theme tokens (set in `frontend/src/app/globals.css`)
- slate-base palette (HSL CSS variables)
- `--radius: 0.5rem`
- Colors all driven by Tailwind tokens (no hex anywhere except the badge accents)

## Files where UI lives
- `src/app/(app)/...` — pages
- `src/components/ui/...` — primitives
- `src/lib/utils.ts` — `cn` (twMerge + clsx) + INR/date formatters

## Status
awaiting BS-Polish-1 invocation.
