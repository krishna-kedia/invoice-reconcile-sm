# PRD — Google Drive–Based Document OCR & Structured Extraction System (V1)

## Status
Final  
Authoritative source of truth  
Backend-only

---

## 1. Objective

Build a **backend system** that:

- Reads documents that already exist in Google Drive
- Extracts structured data from those documents using OCR or parsing
- Stores raw OCR output and structured fields in Supabase (Postgres)
- Is fully **config-driven**
- Is reliable, auditable, and retryable

The system **does NOT**:
- Reconcile invoices
- Decide correctness
- Approve data
- Show dashboards
- Handle GST logic
- Handle payments
- Handle authentication
- Handle frontend UI

The sole responsibility of this system is:

> **Convert documents in Google Drive into structured data, deterministically and transparently.**

---

## 2. Target Users

- Internal operator (hotel owner / manager)
- Technical operator configuring document types and fields
- Future frontend / reconciliation system (consumer of this data)

---

## 3. Tech Stack (Locked)

- Backend language: **Python**
- Database: **Supabase (Postgres)**
- File storage: **Google Drive**
- OCR execution: **Python worker**
- Scheduling: **Cron**
- Configuration: **Single YAML config file**
- Frontend: **Out of scope**

---

## 4. High-Level Architecture

Google Drive (files already exist)
|
| (metadata + file download)
v
Python Backend
├── Drive discovery & file registration
├── OCR / parsing worker
└── Supabase writes
|
v
Supabase (Postgres)
├── File state & retries
├── Raw OCR output
└── Structured extraction tables


---

## 5. Core Design Principles

1. **Google Drive is storage only**
2. **Supabase is the workflow engine**
3. **OCR is a worker, not a discovery system**
4. **All extraction logic is config-driven**
5. **Append-only data model**
6. **Failures are visible and retryable**
7. **No silent corrections**
8. **Human correctness is deferred to a future frontend**

---

## 6. Starting Assumptions

- Documents already exist in Google Drive
- Each Drive folder represents **one document type**
- Files may be:
  - PDFs
  - Images (jpg, jpeg, png, heic)
  - Excel files (xls, xlsx, csv)
- Files may arrive manually or via external automation
- Backend starts **from Drive**, not Gmail

---

## 7. Configuration (Single Source of Control)

### 7.1 Requirement

All user-controlled inputs MUST live in **one config file**.

No prompts, fields, mappings, or retry limits should be hardcoded in code.

Changing this file must allow:
- Adding new document types
- Adding/removing fields
- Modifying OCR prompts
- Changing retry limits

Without code changes.

---

### 7.2 Config File

**File name:** `config.yaml`

```yaml
system:
  max_ocr_retries: 3

document_types:
  - document_type: booking_com_invoice
    drive_folder_id: "DRIVE_FOLDER_ID_BOOKING"
    file_types: [pdf, jpg, jpeg, png, heic]

    extraction_prompt: |
      Extract Booking.com commission invoice details.
      Return invoice number, invoice date, stay period,
      gross revenue, commission amount, tax if present,
      and net payable.

    fields:
      - name: invoice_number
        type: string
        required: true
      - name: invoice_date
        type: date
        required: true
      - name: period_start
        type: date
        required: true
      - name: period_end
        type: date
        required: true
      - name: gross_revenue
        type: number
        required: true
      - name: commission_amount
        type: number
        required: true
      - name: tax_amount
        type: number
        required: false
      - name: net_payable
        type: number
        required: true
