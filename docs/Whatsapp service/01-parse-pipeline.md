# 01 — Parse Pipeline

> Depends on `00-overview-and-data-model.md`. This is a Python job in the existing `src/` pipeline codebase.

## Purpose

Every 2 minutes: find booking PDFs that have newly arrived in Supabase Storage, parse the fields needed for the WhatsApp message, and enqueue a row in `outbound_messages`. The user already has the PDF parser — this doc specifies how it plugs in, not how to parse.

## Scope
- **In:** detect new PDFs, run the existing parser, normalise the fields, write `documents` + `outbound_messages` rows.
- **Out:** sending anything (that is doc 02), touching Gmail (Apps Script owns that), the parser internals (already exist).

## Trigger / detecting "new" documents

The Apps Script is unchanged, so the pipeline discovers new PDFs by **listing the storage bucket and diffing against the `documents` table**:

1. List objects in the Supabase Storage bucket (Storage API `list`).
2. For each object whose `storage_path` is **not** already in `documents`, insert a `documents` row with `status='new'`.
3. Select `documents` where `status='new'` and process each.

> Optimisation (optional, only if bucket listing gets slow): have the Apps Script insert the `documents` row on upload instead of diffing. Not required for launch.

## Steps per new document

1. **Resolve the PDF bytes/URL.** Download the object (or use a signed URL) for parsing; keep the `pdf_url` that will go into the message. For guest-facing PDFs prefer a **signed URL** (privacy) — but note it expires, so if using signed URLs, generate the send-time URL in the send worker (doc 02), and store only `storage_path` here. If the bucket is public, store the public `pdf_url` directly. Record which approach is used.
2. **Classify `doc_type`** — `booking_confirmation` vs `checkout_invoice`. Decide by filename pattern, folder, or a marker in the PDF. Confirm how checkout-invoice PDFs are named/foldered (see Open Questions).
3. **Run the existing parser** to extract fields.
4. **Normalise:**
   - Phone → **E.164**: strip spaces, prepend `+91` if a bare 10-digit Indian number (matches the sample `9518866666 → +919518866666`). If phone is missing/`N/A`, set `documents.status='failed'`, `parse_error='no phone'`, and **do not** enqueue.
   - Dates → the format the approved template expects (confirm during template setup).
   - Amounts → plain numbers, no currency symbol (template already prints `Rs.`).
5. **Build `variables`** as an ordered JSON array matching the approved template's `{{1}}…{{n}}` (see Field mapping).
6. **Insert `outbound_messages`** (`status='pending'`) and set `documents.status='parsed'`.
7. On any exception: `documents.status='failed'`, populate `parse_error`, continue to the next document (never crash the whole run).

## Field mapping — booking confirmation

Order must exactly match the approved template. Current template variables:

| idx | field | source |
|---|---|---|
| {{1}} | greeting name | guest name |
| {{2}} | booking id | `FDR19881784211064` |
| {{3}} | guest name | |
| {{4}} | booked on | booking date |
| {{5}} | check-in date | (template appends fixed "from 2:00 PM") |
| {{6}} | check-out date | (template appends fixed "by 12:00 noon") |
| {{7}} | number of guests | adults + children |
| {{8}} | number of rooms | |
| {{9}} | invoice amount | total |
| {{10}} | amount paid | |
| {{11}} | balance due | |

> `{{1}}` and `{{3}}` are both the guest name in the current template — fill both unless the template is trimmed. Checkout-invoice template variables are TBD (Open Questions).

## Idempotency & safety
- Uniqueness on `documents.storage_path` prevents duplicate ingestion.
- One `outbound_messages` row per `document_id` (enforce with a unique constraint) prevents double-enqueue if a run overlaps.
- The job must be safe to run concurrently — wrap the "claim new documents" step so two runs don't grab the same row (e.g. `UPDATE … SET status='processing' WHERE status='new' RETURNING …`).

## Scheduling
Every 2 minutes. GitHub Actions cron is unreliable below ~5 min, so **prefer Supabase `pg_cron` + `pg_net`** to hit an ingestion RPC/endpoint on a true 2-min cadence, or a **Vercel Cron** route that shells into the parse step. Record the final choice in the repo README.

## Acceptance criteria
- Dropping a known booking PDF into the bucket results, within ~2 min, in exactly one `outbound_messages` row with correctly mapped `variables`, valid E.164 `to_phone`, and a working `pdf_url`.
- A PDF with no phone number produces a `failed` document and **no** outbound row.
- Re-running the job produces no duplicates.

## Open questions
- How do **checkout invoice** PDFs arrive and how are they distinguished from booking confirmations (separate Apps Script rule / separate sender / filename)? Confirm before building the `checkout_invoice` path.
- Exact date string format the approved templates expect.
- Public bucket + permanent URL, or private bucket + signed URL generated at send time? (Privacy leans private.)
