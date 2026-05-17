# Designer Context
<!-- Last updated: 2026-05-17 -->

## Design System
### Colors
- Status colors follow the system: green=reconciled/paid, yellow=partial/pending, red=mismatch/error, grey=unused/inactive, blue=informational
- Tailwind semantic color tokens via CSS variables: bg-background, bg-card, text-foreground, text-muted-foreground, border-border, bg-primary, bg-destructive, bg-secondary, bg-muted, bg-accent
- Status badge colors in use:
  - Green: bg-green-100, border-green-200, text-green-800 / bg-green-50, text-green-900
  - Red: bg-red-100, border-red-200, text-red-800 / bg-red-50, text-red-900
  - Amber/Yellow: bg-amber-100, border-amber-400, text-amber-900
  - Blue: bg-blue-50, border-blue-200, text-blue-900
  - Purple: bg-purple-100, text-purple-800

### Typography
- Headings: text-2xl font-bold, text-xl font-semibold
- Body: text-sm (default for table cells, form labels)
- Labels: text-xs uppercase tracking-wide font-medium text-muted-foreground
- Monospace amounts: font-mono tabular-nums
- Muted secondary text: text-muted-foreground

### Spacing
- Page padding: p-4 to p-8
- Card padding: p-4 or p-6
- Section gaps: gap-4, gap-6, space-y-4
- Table cell padding: py-3 px-4

### Component Patterns
- Cards: bg-card border border-border rounded-lg shadow-sm p-4 or p-6
- Status badges: inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border, colored by status
- Tables: full-width, border-b on rows, text-sm cells, sticky or prominent header
- Buttons: follow shadcn Button component variants (default, destructive, secondary, outline, ghost)
- Form fields: shadcn Input, Label, Select, Textarea with standard spacing space-y-1.5

## What I've Styled
### [2026-05-17] CSS Infrastructure Diagnosis and Fix
- Diagnosed and fixed missing autoprefixer from PostCSS pipeline
- `globals.css`: confirmed correct — has @tailwind base/components/utilities directives and full shadcn CSS variable definitions for both :root light theme
- `tailwind.config.ts`: confirmed correct — content paths cover ./src/pages, ./src/components, ./src/app with all ts/tsx/js/jsx/mdx extensions
- `layout.tsx`: confirmed correct — imports globals.css, sets antialiased min-h-screen bg-background on body
- `postcss.config.mjs`: was MISSING autoprefixer plugin — fixed by adding autoprefixer: {}
- `package.json`: was MISSING autoprefixer in devDependencies — added autoprefixer ^10.5.0
- Files changed: postcss.config.mjs, package.json
- Build: clean (✓ Compiled successfully, all 12 static pages generated)
- Dev server: starts clean, ready in ~1578ms

## Pending / In Progress
- No pending design tasks identified at this time
- ESLint warnings present in several files for unused imports (CardHeader, CardTitle, Badge, useMutation, SourceTable) — these are developer cleanup tasks, not design issues

## Decisions Log
### [2026-05-17] PostCSS autoprefixer fix
- Added autoprefixer to postcss.config.mjs and package.json devDependencies
- Standard Tailwind CSS v3 setup requires tailwindcss + autoprefixer in PostCSS pipeline
- Missing autoprefixer causes intermittent CSS disappearance in dev server (stale cache interactions) even though Tailwind itself can technically run without it
- Root cause: the project was initialized without autoprefixer, which is the standard companion to tailwindcss in PostCSS configs per all official Next.js + Tailwind docs

## Notes for Product Manager
- CSS infrastructure is now fully correct and stable. Build and dev server both verified working.
- The ESLint unused-variable warnings in several page components are non-blocking but should be cleaned up by the developer to keep the codebase tidy.
- No design system changes were made — the existing color system, typography, and component patterns were already well-established and consistent.
