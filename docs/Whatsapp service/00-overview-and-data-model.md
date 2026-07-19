# 00 — Overview & Data Model

> Read this first. The other three docs (`01` parse pipeline, `02` WhatsApp service, `03` frontend) all depend on the schema and terms defined here.

## 1. What we are building

A self-contained WhatsApp messaging capability for Sai Maa Hotel, layered on top of the existing Supabase + Next.js stack. It does three things and nothing more:

1. **Parses** booking documents that land in Supabase and extracts the fields needed for a WhatsApp message.
2. **Sends** two message types automatically: the **booking confirmation** and the **checkout invoice** (both AiSensy template messages, each carrying a PDF).
3. **Handles inbound replies**: when a guest replies on WhatsApp, we store the message, surface it to staff in the existing app, and let staff reply back within WhatsApp's 24-hour service window.

### Explicitly OUT of scope (do not build)
- Reminders, review requests, re-engagement, or any proactive message other than the two auto-sends above.
- Marketing broadcasts.
- Bots / keyword auto-replies. All inbound replies are handled by a human.
- Changing the existing Google Apps Script. It stays as-is (email → PDF → Supabase Storage).

## 2. Existing stack (do not re-architect)

- **DB / backend:** Supabase (Postgres) — auth, RLS, SECURITY DEFINER RPCs, migrations via Supabase MCP.
- **Python pipeline (`src/`):** existing OCR/ingestion pipeline; the new parse pipeline (doc `01`) is a sibling job in the same codebase.
- **Frontend:** Next.js 14 (App Router, TS), Tailwind, shadcn-style primitives, `@supabase/ssr`, TanStack Query, Zod + React Hook Form, date-fns, lucide-react.
- **Deployment:** Vercel (Next.js) + GitHub Actions (Python pipeline).

## 3. End-to-end flow

```
[Apps Script — UNCHANGED]
  Gmail booking/invoice email → extract PDF → upload to Supabase Storage bucket

        │  (PDF now sits in storage)
        ▼
[Parse pipeline — doc 01, Python, runs every 2 min]
  list new PDFs in bucket → parse → write row to `outbound_messages` (status=pending)

        │
        ▼
[Send worker — doc 02, runs every 2 min]
  find pending outbound_messages → call AiSensy send API (template + PDF url)
  → mark sent / failed

        ▼
[Guest receives WhatsApp message]

        │  guest replies
        ▼
[Inbound webhook — doc 02, Next.js API route on Vercel]
  AiSensy POSTs inbound message → upsert `conversations` + insert `messages`

        ▼
[Frontend inbox — doc 03, existing Next.js app]
  operator sees conversation → replies within 24h window → route calls AiSensy send
```

### A note on the two cron jobs
The user's flow describes a 2-minute cron for parsing. Parsing (doc 01) and sending (doc 02) are kept as **two separate steps writing/reading one `outbound_messages` table**, so a parse failure never blocks a send and vice versa. Both can run on the same 2-minute cadence. See doc 01 §Scheduling for the recommended mechanism (GitHub Actions is unreliable below ~5 min; prefer Supabase `pg_cron` calling an RPC, or a Vercel Cron route — decide during build and record the choice).

## 4. Data model (Supabase / Postgres)

All tables in `public`. Use snake_case, `uuid` PKs (`gen_random_uuid()`), `timestamptz` timestamps defaulting to `now()`. Add migrations via Supabase MCP.

### `documents` — the ingestion ledger (owned by the parse pipeline)
Tracks every PDF the pipeline has seen, so it never reprocesses one.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| storage_path | text unique | path inside the Supabase Storage bucket |
| pdf_url | text | public or signed URL used in the WhatsApp message |
| doc_type | text | `booking_confirmation` \| `checkout_invoice` |
| booking_id | text | e.g. `FDR19881784211064` (from filename / parsed) |
| status | text | `new` → `parsed` → `failed` |
| parse_error | text null | populated on failure |
| created_at, parsed_at | timestamptz | |

### `outbound_messages` — the send queue
One row per WhatsApp message to send. Written by the parse pipeline, consumed by the send worker.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| document_id | uuid FK → documents | |
| booking_id | text | |
| template_type | text | `booking_confirmation` \| `checkout_invoice` |
| to_phone | text | **E.164**, e.g. `+919518866666` |
| variables | jsonb | ordered template params (see doc 01 §Field mapping) |
| pdf_url | text | media URL for the message |
| status | text | `pending` → `sent` → `failed` |
| attempts | int default 0 | |
| aisensy_response | jsonb null | raw API response for debugging |
| created_at, sent_at | timestamptz | |

### `conversations` — one per guest phone number
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| guest_phone | text unique | E.164 |
| guest_name | text null | |
| booking_id | text null | best-effort link to a booking |
| last_message_at | timestamptz | for sorting the inbox |
| last_inbound_at | timestamptz null | when guest last messaged us |
| window_expires_at | timestamptz null | `last_inbound_at + 24h`; drives the "can we reply freely" state |
| status | text | `open` \| `closed` |
| assigned_to | uuid null → auth.users | |
| created_at | timestamptz | |

### `messages` — every message, both directions
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| conversation_id | uuid FK → conversations | |
| direction | text | `inbound` \| `outbound` |
| body | text null | text content |
| media_url | text null | if the message had media |
| template_type | text null | set for outbound template sends |
| wa_message_id | text null | AiSensy/WhatsApp message id, for dedup + status |
| status | text | `received` \| `sent` \| `delivered` \| `read` \| `failed` |
| sent_by | uuid null → auth.users | which staff member sent it (null for guest/auto) |
| created_at | timestamptz | |

## 5. Roles & RLS

Two roles: **admin** and **operator**. Store role in a `profiles` table or JWT claim (match whatever the existing app already uses — check first, don't invent a second scheme).

- **operator:** read all conversations/messages; send replies; cannot change config.
- **admin:** everything operator can, plus manage settings/templates and view the send queue / failures.
- Service-role key (server-side pipeline + webhook) bypasses RLS for inserts. Never expose it client-side.
- Enable RLS on all four tables. Frontend reads go through the user's session (anon key + RLS); server writes go through service role.

## 6. Secrets / env vars (server-side only)

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
AISENSY_API_KEY
AISENSY_SEND_URL                 = https://backend.aisensy.com/campaign/t1/api/v2
AISENSY_WEBHOOK_SECRET           # a random token you set, verified on the inbound route
AISENSY_CAMPAIGN_BOOKING         # API-campaign name wrapping the approved booking template
AISENSY_CAMPAIGN_CHECKOUT        # API-campaign name wrapping the approved checkout template
```

## 7. AiSensy discovery checklist (do this BEFORE writing send/receive code)

The user does not yet know AiSensy's specifics. These MUST be confirmed against a live AiSensy account and their API reference (https://aisensy.stoplight.io/docs/project-api/) before implementation:

1. **Outbound send** (mostly known): `POST {AISENSY_SEND_URL}` with body
   `{ apiKey, campaignName, destination, userName, source, media:{ url, filename }, templateParams:[...], tags:[], attributes:{} }`.
   `templateParams` is the ordered list of `{{1}}…{{n}}` values; `media.url` must be publicly reachable. Confirm exact field names and success/error response shapes.
2. **API campaigns:** confirm you must first create a named "API campaign" in AiSensy that wraps each approved template, and that `campaignName` in the payload refers to it.
3. **Inbound webhook:** find where in the AiSensy dashboard the incoming-message webhook URL is set, subscribe to inbound-message + status events, then **capture one real payload** and record its exact JSON shape (sender phone, name, text, media, message id, timestamp). Build the parser in doc 02 against that captured payload, not against a guess.
4. **Session (free-form) replies:** confirm the endpoint/method for sending a **non-template** message inside the 24-hour window (staff replies). This is different from the template send API. Record the exact endpoint. If AiSensy only exposes template sends, flag it — the reply feature depends on this.
5. **Delivery/read status:** confirm whether status callbacks (delivered/read/failed) arrive on the same webhook, so `messages.status` can be updated.
