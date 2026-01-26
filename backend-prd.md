# PRD — Google Drive–Based Document OCR & Structured Extraction System (V1)

## Status
Final  
Authoritative source of truth  
Backend-only

## Enhancements (Post-Implementation)

The following features were added after initial implementation:

1. **Document-Specific Normalized Tables**: Each document type now has its own database table with columns matching extracted fields (e.g., `hotel_invoice` table). Data is stored in both the `extractions` table (JSONB for audit) and document-specific tables (normalized columns for queries).

2. **PDF Password Support**: System supports password-protected PDFs. Passwords can be configured per document type in `config.yaml` using the optional `pdf_password` field. PDFs are automatically decrypted before processing.

3. **Nested Arrays and Multiple Tables**: System supports extracting nested array fields that map to multiple database tables. Array fields can be defined in config with `type: array`, `child_table`, and `child_fields`. The system automatically creates a main table for top-level fields and child tables for array items, with proper foreign key relationships.

4. **Custom Main Table Names**: For document types with nested arrays, you can specify a custom main table name using the `main_table` field in config. This allows multiple document types to share the same child tables (e.g., `card_transactions`, `upi_transactions`) while having different main tables.

5. **Robust Status Management**: Files are only marked as "completed" after successful insertion into document-specific tables. If table insertion fails, files are marked as "failed" with error details. Failed files are always properly marked as "failed" and never left in "processing" state.

6. **Case-Insensitive Field Matching**: The extraction system handles case-insensitive field names, so if the LLM returns `TCS`/`TDS` but config specifies `tcs`/`tds`, the system automatically maps them correctly.

7. **Calculated Field Support**: Extraction prompts can instruct the LLM to calculate values when they're not explicitly present in documents (e.g., TCS = Property Gross Charges × 0.5%).

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
├── Structured extraction table (JSONB - audit)
└── Document-specific tables (normalized columns per document type)

**Status Management**:
- Files marked as "completed" ONLY after successful insertion into document-specific tables
- Files marked as "failed" if any step fails (OCR, extraction, or table insertion)
- Files never left in "processing" state - always transition to completed or failed


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

    pdf_password: "your_password_here"  # Optional - only for password-protected PDFs

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
```

### 7.3 Nested Arrays and Multiple Tables

For documents with nested array structures (e.g., payment settlements with card and UPI transaction arrays), the system supports creating multiple related tables. This is useful for documents like bank payment reports that contain summary totals plus detailed transaction lists.

#### Configuration Structure

```yaml
document_types:
  - document_type: hdfc_mpr
    drive_folder_id: "${HDFC_MPR_FOLDER}"
    file_types: [pdf, jpg, jpeg, png, heic]
    main_table: card_settlement  # Optional: custom main table name
    pdf_password: "password"     # Optional: for password-protected PDFs

    extraction_prompt: |
      Extract HDFC Bank Merchant Payment Report details.
      Return gross_amount, discount, gst_amount, net_amount, mpr_date,
      and arrays: card[] and upi[].

    fields:
      # Main table fields (stored in card_settlement table)
      - name: gross_amount
        type: number
        required: true
      - name: discount
        type: number
        required: true
      - name: gst_amount
        type: number
        required: true
      - name: net_amount
        type: number
        required: true
      - name: mpr_date
        type: date
        required: true
      
      # Array field - creates child table: card_transactions
      - name: card
        type: array
        required: false
        child_table: card_transactions
        child_fields:
          - name: transaction_date
            type: date
            required: true
          - name: settlement_date
            type: date
            required: true
          - name: gross_amount
            type: number
            required: true
          - name: mdr_percent
            type: number
            required: true
      
      # Array field - creates child table: upi_transactions
      - name: upi
        type: array
        required: false
        child_table: upi_transactions
        child_fields:
          - name: transaction_date
            type: date
            required: true
          - name: settlement_date
            type: date
            required: true
          - name: amount
            type: number
            required: true
          - name: vpa
            type: string
            required: true
          - name: upi_transaction_id
            type: string
            required: true
```

#### How It Works

1. **Main Table**: Stores top-level summary fields (e.g., `card_settlement` with `gross_amount`, `discount`, `gst_amount`, `net_amount`, `mpr_date`)

2. **Child Tables**: Store array items with foreign key relationships:
   - `card_transactions` → stores individual card payment transactions
   - `upi_transactions` → stores individual UPI payment transactions
   - Both reference main table via `{main_table}_id` (e.g., `card_settlement_id`)

3. **Extraction Flow**:
   - LLM extracts data and returns JSON with nested arrays
   - System automatically splits data:
     - Main fields → inserted into main table
     - Array items → bulk inserted into child tables
   - Empty arrays are handled gracefully (no child records created)

4. **Custom Main Table Names**: 
   - Use `main_table` field to specify a custom table name
   - Defaults to `document_type` if not specified
   - Useful when multiple document types share the same child table structure

#### Database Structure Example

For the HDFC MPR example above, the system creates:

- **`card_settlement`** (main table):
  - `id`, `file_id`, `gross_amount`, `discount`, `gst_amount`, `net_amount`, `mpr_date`

- **`card_transactions`** (child table):
  - `id`, `card_settlement_id` (FK), `transaction_date`, `settlement_date`, `gross_amount`, `mdr_percent`

- **`upi_transactions`** (child table):
  - `id`, `card_settlement_id` (FK), `transaction_date`, `settlement_date`, `amount`, `vpa`, `upi_transaction_id`

#### Benefits

- **Normalized Data**: Transaction details stored separately from summary totals
- **Efficient Queries**: Query transactions by date, amount, etc. without scanning JSON
- **Scalability**: Handles documents with hundreds of transactions
- **Flexibility**: Arrays can be empty (no transactions) or contain many items

### 7.4 Field Extraction Features

#### Case-Insensitive Field Matching

The system automatically handles case-insensitive field names. If the LLM returns uppercase field names (e.g., `TCS`, `TDS`) but your config specifies lowercase (e.g., `tcs`, `tds`), the system automatically maps them correctly.

**Example**:
- Config: `tcs`, `tds` (lowercase)
- LLM returns: `TCS`, `TDS` (uppercase)
- System maps: `TCS` → `tcs`, `TDS` → `tds`
- Database receives: `tcs`, `tds` (matching config)

#### Calculated Fields

Extraction prompts can instruct the LLM to calculate values when they're not explicitly present in documents. This is useful for fields like TCS/TDS that may need to be calculated from other values.

**Example Prompt**:
```
For TCS (Tax Collected at Source): If explicitly mentioned in the document, extract that value. 
If not mentioned, calculate TCS as Property Gross Charges × 0.005 (0.5%). 

For TDS (Tax Deducted at Source): If explicitly mentioned in the document, extract that value.
If not mentioned, calculate TDS as Property Gross Charges × 0.001 (0.1%).
```

**Benefits**:
- Handles documents where calculated values aren't explicitly stated
- Ensures consistent data extraction even when document formats vary
- Allows prompts to specify calculation formulas

#### Complete Field Coverage

The system ensures all fields defined in config are present in the validated output. Missing optional fields are set to `None` instead of being omitted, ensuring consistent data structure for all records.

### 7.5 Status Management

**File Status Lifecycle**:
1. **pending**: File discovered but not yet processed
2. **processing**: File is currently being processed (OCR, extraction, table insertion)
3. **completed**: File successfully processed AND data inserted into document-specific tables
4. **failed**: Processing failed at any step (OCR, extraction, or table insertion)

**Critical Rules**:
- Files are **only** marked as "completed" after successful insertion into document-specific tables
- If table insertion fails, the file is marked as "failed" with error details
- Files are **never** left in "processing" state - exception handling ensures transition to "failed"
- Status updates are wrapped in try-except to ensure they always succeed, even if logging fails
