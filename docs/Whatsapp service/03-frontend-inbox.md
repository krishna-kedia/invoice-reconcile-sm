# 03 — Frontend (WhatsApp Inbox)

> Depends on `00-overview-and-data-model.md` and the reply route in `02-whatsapp-service.md`. Built inside the **existing** Next.js 14 app — reuse its stack, do not introduce new libraries.

## Purpose
Give hotel staff a shared inbox inside the app to read guest WhatsApp replies and respond within the 24-hour window. This is the only human touchpoint in scope.

## Stack to reuse (no new deps)
Next.js 14 App Router (TS), Tailwind, existing shadcn-style primitives (Button, Card, Dialog, Table, etc.), `@supabase/ssr` (cookie auth), TanStack Query (fetching/cache), Zod + React Hook Form (the reply form), date-fns (timestamps), lucide-react (icons).

## Roles
- **operator:** view conversations, read threads, send replies.
- **admin:** everything operator does, plus a view of the send queue / failed outbound messages (read-only is fine for launch).

Use the app's existing auth/role mechanism — do not build a second one.

## Screens

### 1. Inbox (conversation list)
- Route e.g. `/whatsapp` (or wherever the app nests feature pages).
- List `conversations` ordered by `last_message_at` desc.
- Each row: guest name (or phone), `booking_id` if linked, snippet of last message, relative time (date-fns), and an **unread** indicator (see below).
- A **window badge** per row: "Open — Xh left" (green) when `now() < window_expires_at`, else "Closed" (grey). Compute client-side from `window_expires_at`.
- Basic filter: All / Open window / Unread. No search needed for launch.

### 2. Conversation thread
- Opens the selected conversation; loads `messages` for that `conversation_id`, oldest→newest.
- Bubbles styled by `direction` (inbound left, outbound right); show template sends (booking/checkout) inline in the timeline so staff see what the guest already received, with a small "sent automatically" tag.
- Show per-message status for outbound (sent/delivered/read/failed) if available.
- Header shows guest name, phone, linked booking, and the live window countdown.

### 3. Reply composer
- Text input + send button, using React Hook Form + Zod (non-empty, length cap).
- **Disabled with an explanation when the window is closed** (`now() > window_expires_at`): show "This chat is closed. The guest needs to message first before you can reply." (Server also enforces this — doc 02.)
- On send: call `POST /api/whatsapp/reply` `{ conversation_id, body }`; optimistic append via TanStack Query, reconcile on response; toast on failure.
- Media/attachment sending is **out of scope** for launch (text replies only).

## Realtime / freshness
- Prefer **Supabase Realtime** subscriptions on `messages` / `conversations` so new inbound messages and status changes appear without refresh. If that's more than you want for v1, fall back to TanStack Query polling every ~10–15s on the open views. Record the choice.
- "Unread": track a per-conversation `last_read_at` (per user, or a simple conversation-level flag for a shared inbox — a shared flag is fine given the small team). Mark read when a thread is opened.

## Data access
- Reads use the user session (anon key + RLS). Sending goes through the server route (service role) — the browser never holds the AiSensy key or Supabase service-role key.
- Wrap Supabase reads in TanStack Query hooks; keep query keys stable per conversation.

## Acceptance criteria
- Operator sees guest replies appear in near-real-time and can reply within the window; the reply reaches the guest's WhatsApp and shows in the thread.
- When the window is closed, the composer is disabled with a clear reason and the server rejects any forced attempt.
- Auto-sent booking/checkout messages appear in the correct guest thread, tagged as automatic.
- Admin can see failed outbound messages; operator cannot access admin-only views.
- No secret keys are present in any client bundle.

## Out of scope (do not build)
Broadcast composer, template manager/editor, analytics dashboards, bot/auto-reply config, outbound media from staff, contact management. Keep the surface to inbox + thread + reply.
