# 02 — WhatsApp Service (AiSensy Integration)

> Depends on `00-overview-and-data-model.md`. Complete the **AiSensy discovery checklist** (doc 00 §7) before writing code here.

This is the "separate service that handles everything WhatsApp." Physically it is: (a) a **send worker** (cron-driven), and (b) an **inbound webhook** (Next.js API route on Vercel). Both share the Supabase tables. Keep it in its own module/folder so it is cleanly separable.

---

## Part A — Outbound send worker

### Purpose
Drain `outbound_messages` where `status='pending'` and send each via AiSensy. Only two template types are ever sent: `booking_confirmation`, `checkout_invoice`.

### Per message
1. Claim the row (`status='pending' → 'sending'` with a guarded UPDATE so overlapping runs don't double-send).
2. If using private-bucket signed URLs: generate a fresh signed `pdf_url` now (short TTL, e.g. 1h — long enough for AiSensy to fetch).
3. Pick the campaign name: `booking_confirmation → AISENSY_CAMPAIGN_BOOKING`, `checkout_invoice → AISENSY_CAMPAIGN_CHECKOUT`.
4. `POST {AISENSY_SEND_URL}`:
   ```json
   {
     "apiKey": "<AISENSY_API_KEY>",
     "campaignName": "<campaign for this template_type>",
     "destination": "<to_phone E.164>",
     "userName": "<guest name>",
     "templateParams": ["<{{1}}>", "...", "<{{n}}>"],
     "media": { "url": "<pdf_url>", "filename": "<booking_id>.pdf" }
   }
   ```
5. On success: `outbound_messages.status='sent'`, store `sent_at` and `aisensy_response`; also insert an `outbound` row into `messages` (link/create the guest `conversations` row) so the send shows in the inbox thread.
6. On failure: `status='failed'`, increment `attempts`, store the error. Retry up to N attempts (e.g. 3) on later runs; after N, leave `failed` for an admin to see.

### Notes
- `media.url` MUST be publicly reachable by AiSensy/Meta or the send is rejected.
- Never send a template that is not `Approved` in AiSensy.
- Runs on the same 2-min cadence as the parse pipeline (doc 01 §Scheduling).

### Acceptance criteria
- A `pending` row results in a delivered WhatsApp message with the PDF attached, and flips to `sent`.
- A bad phone / unreachable URL flips to `failed` with a readable error and does not loop forever.
- No message is ever sent twice.

---

## Part B — Inbound webhook + replies

### Purpose
Receive guest messages, store them, surface to staff, and let staff reply within the 24-hour window.

### The route
- A Next.js API route on Vercel, e.g. `POST /api/whatsapp/webhook`. This is the public HTTPS URL you paste into AiSensy's incoming-webhook setting.
- **Verify authenticity:** check a shared secret (`AISENSY_WEBHOOK_SECRET`) on every request (header or query param — match what AiSensy supports). Reject otherwise.
- **Always return 200 fast.** Do the DB work quickly (or enqueue) so AiSensy doesn't retry/timeout.

### On an inbound message
> Build against a REAL captured payload (doc 00 §7.3), not a guess. Field names below are placeholders.
1. Extract: `guest_phone` (E.164), `guest_name`, `text`/`media_url`, `wa_message_id`, `timestamp`.
2. **Dedup** on `wa_message_id` (AiSensy may retry) — ignore if already stored.
3. **Upsert `conversations`** by `guest_phone`: set `last_inbound_at=now()`, `window_expires_at=now()+24h`, `last_message_at=now()`, `status='open'`. Best-effort link `booking_id` by matching the phone to a recent booking.
4. **Insert `messages`** (`direction='inbound'`, `status='received'`).
5. Return 200.

### Status callbacks (if AiSensy sends them here)
If delivered/read/failed events arrive on the same webhook, update the matching `messages.status` by `wa_message_id`.

### Staff reply (called from the frontend, doc 03)
- Route e.g. `POST /api/whatsapp/reply` `{ conversation_id, body }`.
- **Guard the window:** if `now() > conversations.window_expires_at`, reject with a clear error ("24-hour window closed — guest must message first"). The frontend disables the composer in this state, but enforce it server-side too.
- Send a **free-form session message** via AiSensy's session/live-chat endpoint (confirm exact endpoint in discovery — this is NOT the template campaign API).
- On success insert an `outbound` `messages` row (`sent_by = staff user id`, `status='sent'`), update `conversations.last_message_at`.

### Acceptance criteria
- A guest WhatsApp reply appears as an `inbound` message in the right conversation within seconds, deduped.
- `window_expires_at` correctly reflects last inbound + 24h.
- Staff reply inside the window is delivered and stored; a reply attempt after the window is blocked server-side with a clear message.

## Open questions (resolve via discovery)
- Exact inbound payload schema (capture one).
- Exact free-form/session-reply endpoint and payload.
- Whether status callbacks share this webhook or need a separate subscription.
- AiSensy's webhook auth mechanism (secret header vs signature).
