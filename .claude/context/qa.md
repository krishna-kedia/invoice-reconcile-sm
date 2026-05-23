# QA Context
<!-- Last updated: 2026-05-17 14:35 -->

## Last Activity
PM-level smoke testing on RPCs via Supabase MCP (impersonating operator user with `set_config('request.jwt.claims', …)`):

| Test | Outcome |
|---|---|
| Partial save without `confirm_partial` | `PARTIAL_CONFIRMATION_REQUIRED` raised — PASS |
| Partial save with `confirm_partial=true` | Link inserted, status → `partial`, 2 audit rows | PASS |
| Overpay > 5% (22%) | Hard error with explicit reduction amount | PASS |
| `npm run build` (frontend) | 12 routes generated, no compile errors | PASS |
| `tsc --noEmit` | clean | PASS |

## Open Bugs
None known.

## Up Next
- C1 — Full RPC test suite (happy path, partial, overpay-flag, overpay-reject, double-claim race, un-reconcile lifecycle, cash edit/delete lifecycle, RLS direct-mutation block from authenticated role).
- C2 — Audit log completeness matrix per RPC.
- F1 — Manual end-to-end script with both seeded users on the deployed frontend.
- F2 — Performance pass with seeded 2000 invoices / 5000 txns.
- F3 — Final security advisor pass.

## Reference
- Seed admin user: krishnagopal.kedia@optimoloan.com / `AdminPass123!`
- Seed operator user: operator@hotel.local / `OperatorPass123!`
- Supabase project URL in `frontend/.env.local`

## Status
idle — ready to take on C1.
