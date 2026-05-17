# Invoice Reconcile Backend System - Complete Codebase Documentation

**Generated: May 14, 2026**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Directory Structure](#3-directory-structure)
4. [Configuration System](#4-configuration-system)
5. [Core Modules Deep Dive](#5-core-modules-deep-dive)
6. [Database Layer](#6-database-layer)
7. [Google Drive Integration](#7-google-drive-integration)
8. [Document Processors](#8-document-processors)
9. [Structured Extraction](#9-structured-extraction)
10. [Utilities](#10-utilities)
11. [Data Flow & Processing Pipeline](#11-data-flow--processing-pipeline)
12. [Currently Configured Document Types](#12-currently-configured-document-types)
13. [Key Design Patterns](#13-key-design-patterns)
14. [File-by-File Reference](#14-file-by-file-reference)

---

## 1. Executive Summary

The **Invoice Reconcile Backend System** is a config-driven Python backend that:

- **Discovers** documents from Google Drive folders
- **Extracts** text using OCR (OpenAI Vision API) or direct parsing (Excel/CSV)
- **Extracts** structured data using LLM-based extraction (OpenAI GPT-4)
- **Stores** results in Supabase (PostgreSQL) with full audit trails
- Supports **retry logic** and comprehensive **error handling**
- Is **fully configurable** via YAML without code changes

### What the System Does NOT Do

- Reconcile invoices or decide correctness
- Approve data or handle GST/payment logic
- Provide frontend UI or dashboards
- Handle authentication

### Core Principle

> **Convert documents in Google Drive into structured data, deterministically and transparently.**

---

## 2. System Architecture Overview

```
Google Drive (Source)
       |
       | (metadata + file download)
       v
Python Backend
├── Drive Discovery (discovers new files)
├── File Registration (inserts to database as 'pending')
├── Processor Routing (OCR vs Excel)
├── OCR/Parsing Worker (extracts raw text)
├── Structured Extractor (LLM extraction)
└── Database Writes
       |
       v
Supabase (PostgreSQL)
├── files (file tracking & state)
├── ocr_outputs (raw extracted text)
├── extractions (JSONB structured data - audit)
├── processing_logs (complete audit trail)
└── Document-specific tables (normalized columns)
    ├── hotel_invoice
    ├── mmt_invoice
    ├── card_settlement (main) + card_transactions + upi_transactions (child)
    └── bank_statement
```

### Two Processing Paths

1. **LLM Extraction Path** (default): Raw text → OpenAI GPT-4 → Structured JSON → Database
2. **Direct Excel Insertion Path**: Excel file → pandas → Direct database insertion (no LLM)

---

## 3. Directory Structure

```
invoice-reconcile-sm/
├── config.yaml                    # Main configuration (document types, prompts, fields)
├── requirements.txt               # Python dependencies
├── .env                          # Environment variables (credentials - gitignored)
├── .env.example                  # Template for environment variables
├── .gitignore                    # Git ignore patterns
├── google_cloud_json_auth.json   # Google Cloud service account credentials
│
├── src/                          # Source code
│   ├── __init__.py
│   ├── main.py                   # Entry point and orchestration (357 lines)
│   │
│   ├── config/                   # Configuration management
│   │   ├── __init__.py
│   │   └── loader.py             # YAML config loader with env var substitution (~150 lines)
│   │
│   ├── database/                 # Database layer
│   │   ├── __init__.py
│   │   ├── models.py             # Data models and enums (~155 lines)
│   │   ├── client.py             # Supabase client wrapper (~361 lines)
│   │   ├── table_manager.py      # Dynamic table SQL generation (~313 lines)
│   │   ├── excel_inserter.py     # Direct Excel → DB inserter (~100+ lines)
│   │   └── migrations/           # SQL migration files
│   │       ├── 001_initial_schema.sql        # Core tables
│   │       ├── 002_document_type_tables.sql  # hotel_invoice table
│   │       ├── 003_payment_settlement_tables.sql
│   │       ├── 004_mmt_invoice_tables.sql
│   │       ├── 005_hdfc_mpr_tables.sql       # card_settlement + child tables
│   │       ├── 006_update_mmt_invoice_tcs_tds.sql
│   │       └── 008_bank_statement_tables.sql
│   │
│   ├── drive/                    # Google Drive integration
│   │   ├── __init__.py
│   │   ├── client.py             # Drive API client (~80+ lines)
│   │   └── discovery.py          # File discovery logic (~80+ lines)
│   │
│   ├── processors/               # Document processors
│   │   ├── __init__.py
│   │   ├── base.py               # Abstract base processor (~38 lines)
│   │   ├── ocr_processor.py      # OpenAI Vision OCR (~213 lines)
│   │   ├── excel_processor.py    # Excel/CSV parser (~242 lines)
│   │   └── factory.py            # Processor routing (~55 lines)
│   │
│   ├── extractors/               # Structured extraction
│   │   ├── __init__.py
│   │   └── structured_extractor.py  # LLM-based field extraction (~234 lines)
│   │
│   └── utils/                    # Utilities
│       ├── __init__.py
│       ├── logging.py            # Logging setup (~48 lines)
│       ├── retry.py              # Retry decorator (~44 lines)
│       ├── pdf_decryptor.py      # PDF password handling (~70 lines)
│       └── date_parser.py        # Date parsing utility (~83 lines)
│
├── scripts/                      # Setup and deployment scripts
│   ├── setup_db.sql              # Database setup script
│   └── run_cron.sh               # Cron wrapper script
│
├── venv/                         # Python virtual environment
│
└── Documentation files:
    ├── README.md                 # User documentation
    ├── backend-prd.md            # Product requirements document
    ├── Phase1_execution.md       # Detailed execution report
    ├── adding_document_type.md   # Guide for adding new document types
    ├── EXCEL_UPLOAD_PLAN.md      # Excel upload planning
    ├── EXCEL_UPLOAD_STEPS.md     # Excel upload steps
    └── phase1_execution_steps.md # Execution steps
```

---

## 4. Configuration System

### 4.1 Environment Variables (`.env`)

All sensitive credentials are stored in `.env`:

```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGc...

# Google Drive
GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/service-account.json

# OpenAI
OPENAI_API_KEY=sk-...

# Drive Folder IDs (one per document type)
HOTEL_INVOICES=1a2b3c4d5e6f...
MMT_INVOICES=7g8h9i0j...
HDFC_MPR_HOTEL_ACCOUNT=...
BANK_STATEMENTS=...
```

### 4.2 Main Configuration (`config.yaml`)

The configuration file is the **single source of truth** for all system behavior.

#### Structure

```yaml
system:
  max_ocr_retries: 3              # Retry limit for failed files
  cron_schedule: "0 2 * * *"      # Daily at 2 AM

connections:
  supabase:
    url: "${SUPABASE_URL}"        # Environment variable substitution
    key: "${SUPABASE_KEY}"
  google_drive:
    service_account_path: "${GOOGLE_SERVICE_ACCOUNT_JSON}"
  openai:
    api_key: "${OPENAI_API_KEY}"
    model: "gpt-4o"               # Model with vision capabilities
    max_tokens: 4096

document_types:
  - document_type: hotel_invoice
    drive_folder_id: "${HOTEL_INVOICES}"
    file_types: [pdf, jpg, jpeg, png, heic]
    # pdf_password: "password"    # Optional for password-protected PDFs
    extraction_prompt: |
      Extract hotel invoice details...
    fields:
      - name: field_name
        type: string|number|date|array
        required: true|false
```

### 4.3 Config Loader (`src/config/loader.py`)

**Key Class: `Config`**

```python
class Config:
    def __init__(self, config_path: str = None)  # Loads config.yaml
    def load(self)                                # Parses YAML with env var substitution
    def _validate(self)                           # Validates required sections

    @property
    def system(self) -> dict                      # System settings
    @property
    def connections(self) -> dict                 # Connection configs
    @property
    def document_types(self) -> List[dict]        # Document type configs

    def get_document_type(self, name: str) -> dict  # Get specific doc type
    def reload(self)                              # Reload from file
```

**Environment Variable Substitution:**
- Uses `${VAR_NAME}` syntax
- Function `substitute_env_vars(value)` recursively processes all config values
- Raises error if variable not found

---

## 5. Core Modules Deep Dive

### 5.1 Main Entry Point (`src/main.py`)

**Key Class: `InvoiceReconcileSystem`**

This is the main orchestration class that coordinates all system components.

#### Initialization (`__init__`)

```python
def __init__(self, config_path: str = None):
    # 1. Load configuration
    self.config = Config(config_path)

    # 2. Initialize database client
    self.db_client = DatabaseClient(url, key)

    # 3. Initialize Google Drive client
    self.drive_client = DriveClient(service_account_path)

    # 4. Initialize processors (OCR + Excel)
    self.processor_factory = ProcessorFactory(api_key, model, max_tokens)

    # 5. Initialize structured extractor
    self.extractor = StructuredExtractor(api_key, model, max_tokens)

    # 6. Initialize file discovery
    self.discovery = FileDiscovery(drive_client, db_client)

    # 7. Verify document type tables exist
    ensure_all_tables_exist(config, db_client)
```

#### Core Methods

| Method | Purpose |
|--------|---------|
| `run_discovery()` | Phase 1: Discover new files from all configured Drive folders |
| `process_file(file_record)` | Process a single file through the complete pipeline |
| `run_processing()` | Phase 2: Process all pending/retryable files |
| `run()` | Complete workflow: discovery + processing |

#### File Processing Flow (`process_file`)

```python
def process_file(self, file_record):
    # 1. Update status to 'processing'
    # 2. Download file from Google Drive
    # 3. Get appropriate processor (OCR or Excel)
    # 4. Check for PDF password in config
    # 5. Process file (extract raw text)
    # 6. Store OCR output
    # 7. Check if excel_direct_insert is enabled:
    #    - YES: Direct Excel insertion (no LLM)
    #    - NO: LLM extraction path
    # 8. Store extraction results
    # 9. Update status to 'completed'
    #
    # On error:
    # - Log error to database
    # - Update status to 'failed'
    # - Increment retry count
```

---

## 6. Database Layer

### 6.1 Data Models (`src/database/models.py`)

#### Enums

```python
class FileStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class OperationType(Enum):
    DISCOVERY = "discovery"
    DOWNLOAD = "download"
    OCR = "ocr"
    EXTRACTION = "extraction"
    ERROR = "error"

class LogStatus(Enum):
    SUCCESS = "success"
    FAILURE = "failure"
```

#### Dataclasses

| Class | Purpose | Key Fields |
|-------|---------|------------|
| `FileRecord` | Represents a file in database | id, drive_file_id, document_type, status, ocr_retry_count, error_message |
| `OCROutput` | Raw OCR results | id, file_id, raw_text, ocr_metadata |
| `Extraction` | Structured extraction | id, file_id, document_type, extracted_fields (JSONB) |
| `ProcessingLog` | Audit trail entry | id, file_id, operation, status, details |

### 6.2 Database Client (`src/database/client.py`)

**Key Class: `DatabaseClient`**

Wrapper for all Supabase operations.

#### File Operations

| Method | Purpose |
|--------|---------|
| `insert_file(file_data)` | Create new file record |
| `get_file_by_drive_id(drive_file_id)` | Lookup by Drive ID (duplicate check) |
| `get_pending_files(max_retries)` | Get files needing processing |
| `update_file_status(file_id, status, error_message, increment_retry)` | Update status |

#### OCR Operations

| Method | Purpose |
|--------|---------|
| `insert_ocr_output(file_id, raw_text, metadata)` | Store raw OCR text |
| `get_ocr_output(file_id)` | Retrieve OCR results |

#### Extraction Operations

| Method | Purpose |
|--------|---------|
| `insert_extraction(...)` | Store structured extraction (JSONB + normalized table) |
| `get_extraction(file_id)` | Retrieve extraction |
| `insert_document_extraction(...)` | Insert into document-specific normalized table(s) |
| `insert_excel_rows_direct(...)` | Direct Excel DataFrame insertion |

#### Logging Operations

| Method | Purpose |
|--------|---------|
| `insert_log(operation, status, file_id, details)` | Create audit trail entry |
| `get_file_logs(file_id)` | Get all logs for a file |

### 6.3 Table Manager (`src/database/table_manager.py`)

Handles dynamic SQL generation for document-specific tables.

**Key Functions:**

| Function | Purpose |
|----------|---------|
| `sanitize_table_name(document_type)` | Convert to SQL-safe table name |
| `get_column_name(field_name)` | Convert field name to SQL-safe column name |
| `generate_table_sql(document_type, fields)` | Generate CREATE TABLE SQL |
| `generate_child_table_sql(document_type, array_field)` | Generate child table SQL for arrays |
| `generate_all_tables_sql(document_type, fields)` | Generate main + all child tables |
| `get_array_fields(fields)` | Extract array field definitions |
| `ensure_all_tables_exist(config, db_client)` | Verify all document tables exist |

**Field Type Mapping:**

```python
FIELD_TYPE_TO_SQL = {
    'string': 'TEXT',
    'number': 'NUMERIC(15, 2)',
    'date': 'DATE'
}
```

### 6.4 Database Schema

#### Core Tables (from `001_initial_schema.sql`)

**`files`** - Tracks all discovered files
```sql
CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_file_id TEXT UNIQUE NOT NULL,
    drive_folder_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size BIGINT,
    drive_created_at TIMESTAMP WITH TIME ZONE,
    drive_modified_at TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    ocr_retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**`ocr_outputs`** - Raw OCR results
```sql
CREATE TABLE ocr_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    ocr_metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**`extractions`** - Structured extractions (JSONB for audit)
```sql
CREATE TABLE extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    extracted_fields JSONB NOT NULL,
    extraction_metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**`processing_logs`** - Complete audit trail
```sql
CREATE TABLE processing_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    operation TEXT NOT NULL CHECK (operation IN ('discovery', 'download', 'ocr', 'extraction', 'error')),
    status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

#### Document-Specific Tables

Each document type has its own normalized table. Examples:

- `hotel_invoice` - Hotel invoice fields
- `mmt_invoice` - MakeMyTrip invoice fields
- `card_settlement` (main) + `card_transactions` + `upi_transactions` (children)
- `bank_statement` - Bank statement rows

---

## 7. Google Drive Integration

### 7.1 Drive Client (`src/drive/client.py`)

**Key Class: `DriveClient`**

```python
class DriveClient:
    SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

    def __init__(self, service_account_path: str):
        # Initialize with service account credentials

    def list_files_in_folder(self, folder_id: str, file_types: List[str]) -> List[dict]:
        # List files in Drive folder
        # Filters by MIME types or file extensions
        # Returns: id, name, mimeType, size, createdTime, modifiedTime
        # Supports: PDF, JPG, JPEG, PNG, HEIC, XLSX, XLS, CSV

    def download_file(self, file_id: str) -> bytes:
        # Download file content as bytes
```

### 7.2 File Discovery (`src/drive/discovery.py`)

**Key Class: `FileDiscovery`**

```python
class FileDiscovery:
    def __init__(self, drive_client: DriveClient, db_client: DatabaseClient)

    def discover_files(self, document_type: str, drive_folder_id: str,
                       file_types: List[str]) -> List[str]:
        # 1. List files from Drive folder
        # 2. For each file:
        #    - Check if already exists in database (by drive_file_id)
        #    - If new: insert with status='pending'
        #    - Log discovery operation
        # 3. Return list of new file IDs (database UUIDs)
```

**Duplicate Detection:**
- Uses `drive_file_id` as unique identifier
- Skips files already in database
- Prevents reprocessing

---

## 8. Document Processors

### 8.1 Base Processor (`src/processors/base.py`)

Abstract base class defining the processor interface:

```python
class BaseProcessor(ABC):
    @abstractmethod
    def process(self, file_content: bytes, file_type: str,
                metadata: Optional[Dict] = None) -> Dict[str, Any]:
        """Process file and extract text.
        Returns: {'raw_text': str, 'metadata': dict}
        """

    @abstractmethod
    def supports(self, file_type: str) -> bool:
        """Check if processor supports file type."""
```

### 8.2 OCR Processor (`src/processors/ocr_processor.py`)

**Key Class: `OCRProcessor`**

Uses OpenAI Vision API for OCR processing.

```python
class OCRProcessor(BaseProcessor):
    SUPPORTED_TYPES = ['pdf', 'jpg', 'jpeg', 'png', 'heic']

    def __init__(self, api_key: str, model: str = "gpt-4-vision-preview",
                 max_tokens: int = 4096)

    def supports(self, file_type: str) -> bool

    def process(self, file_content: bytes, file_type: str,
                metadata: Optional[Dict] = None,
                password: Optional[str] = None) -> Dict[str, Any]:
        # 1. If PDF + password provided:
        #    - Check if password-protected
        #    - Decrypt if needed
        # 2. If PDF: convert to images using pdf2image
        # 3. If image: open with PIL
        # 4. Encode to base64
        # 5. Call OpenAI Vision API
        # 6. Return {'raw_text': str, 'metadata': dict}
```

**Features:**
- PDF to image conversion via `pdf2image`
- Password-protected PDF support via `pypdf`
- HEIC image support via `pillow-heif`
- Base64 encoding for API
- Token usage tracking

### 8.3 Excel Processor (`src/processors/excel_processor.py`)

**Key Class: `ExcelProcessor`**

Direct parsing of Excel and CSV files using pandas.

```python
class ExcelProcessor(BaseProcessor):
    SUPPORTED_TYPES = ['xlsx', 'xls', 'csv']

    def supports(self, file_type: str) -> bool

    def process(self, file_content: bytes, file_type: str,
                metadata: Optional[Dict] = None) -> Dict[str, Any]:
        # Read Excel/CSV using pandas
        # Convert to text representation for LLM
        # Return {'raw_text': str, 'metadata': dict}

    def extract_data_between_delimiters(self, file_content: bytes,
                                        file_type: str,
                                        delimiter_pattern: str = r'\*{4,}') -> pd.DataFrame:
        # For direct insertion:
        # 1. Find delimiter rows (e.g., ****)
        # 2. Extract header row between first and second delimiter
        # 3. Extract data rows between second and third delimiter
        # 4. Return DataFrame with header as column names

    def normalize_column_names(self, df: pd.DataFrame) -> pd.DataFrame:
        # Convert Excel column names to snake_case
        # "Withdrawal Amt." → "withdrawal_amt"
        # "Chq./Ref.No." → "chq_ref_no"
```

### 8.4 Processor Factory (`src/processors/factory.py`)

**Key Class: `ProcessorFactory`**

Routes files to appropriate processor.

```python
class ProcessorFactory:
    def __init__(self, openai_api_key: str, openai_model: str, openai_max_tokens: int):
        self.ocr_processor = OCRProcessor(...)
        self.excel_processor = ExcelProcessor()

    def get_processor(self, file_type: str) -> Optional[BaseProcessor]:
        # Try Excel processor first
        # Fall back to OCR processor
        # Return None if unsupported

    def can_process(self, file_type: str) -> bool:
        # Quick check if file type is supported
```

---

## 9. Structured Extraction

### 9.1 Structured Extractor (`src/extractors/structured_extractor.py`)

**Key Class: `StructuredExtractor`**

Uses OpenAI API to extract structured fields from raw text.

```python
class StructuredExtractor:
    def __init__(self, api_key: str, model: str = "gpt-4", max_tokens: int = 4096)

    def extract(self, raw_text: str, extraction_prompt: str,
                fields: List[Dict[str, Any]]) -> Dict[str, Any]:
        # 1. Build field schema description from config
        # 2. Construct system and user prompts
        # 3. Call OpenAI Chat API with JSON response format
        # 4. Parse JSON response
        # 5. Validate required fields
        # 6. Convert types (string, number, date)
        # 7. Return {'extracted_fields': dict, 'metadata': dict}
```

**Key Features:**

1. **JSON Response Format**: Uses `response_format={"type": "json_object"}` for consistent output
2. **Low Temperature**: Uses `temperature=0.1` for consistent extraction
3. **Case-Insensitive Field Matching**: Automatically maps `TCS` → `tcs`
4. **Type Conversion**:
   - String: Direct conversion
   - Number: Removes currency symbols and commas
   - Date: Validates ISO format (YYYY-MM-DD)
5. **Complete Field Coverage**: Ensures all config fields are present (sets missing to `None`)

**System Prompt:**
```
You are a data extraction assistant. Extract structured data from the provided text according to the specified schema.
Return ONLY a valid JSON object with the extracted fields. Do not include any explanation or markdown formatting.
For date fields, use ISO format (YYYY-MM-DD).
For number fields, use numeric values (no currency symbols or commas).
If a required field cannot be found, use null for that field.
```

---

## 10. Utilities

### 10.1 Logging (`src/utils/logging.py`)

```python
def setup_logging(log_file: str = None, log_level: str = "INFO") -> logging.Logger:
    # Creates logger: 'invoice_reconcile'
    # Console output to stdout
    # Optional file output
    # Format: timestamp - logger name - level - message
```

### 10.2 PDF Decryptor (`src/utils/pdf_decryptor.py`)

```python
def is_password_protected(pdf_bytes: bytes) -> bool:
    # Check if PDF is encrypted using pypdf

def decrypt_pdf(pdf_bytes: bytes, password: str) -> bytes:
    # Decrypt password-protected PDF
    # Returns decrypted PDF bytes
    # Raises ValueError if password incorrect
```

### 10.3 Date Parser (`src/utils/date_parser.py`)

```python
def parse_excel_date(value) -> Optional[date]:
    # Handles multiple formats:
    # - date/datetime objects
    # - pandas Timestamp
    # - Excel serial numbers (days since 1899-12-30)
    # - String dates: DD/MM/YY, DD-MM-YYYY, YYYY-MM-DD, etc.
    # Returns date object or None
```

### 10.4 Retry Decorator (`src/utils/retry.py`)

```python
def retry_with_backoff(max_retries: int = 3, initial_delay: float = 1.0,
                       backoff_factor: float = 2.0,
                       exceptions: tuple = (Exception,)):
    # Decorator for retry logic with exponential backoff
```

---

## 11. Data Flow & Processing Pipeline

### Phase 1: Discovery (`run_discovery`)

```
┌─────────────────────┐
│ For each doc_type   │
│ in config.yaml      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ DriveClient         │
│ .list_files_in_     │
│  folder()           │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ For each file:      │
│ - Check if exists   │
│   in database       │
│ - If new: insert    │
│   with status=      │
│   'pending'         │
│ - Log discovery     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Return new file IDs │
└─────────────────────┘
```

### Phase 2: Processing (`run_processing` → `process_file`)

```
┌─────────────────────┐
│ Get pending files   │
│ from database       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────────────┐
│ For each file:                                      │
│                                                     │
│  1. Update status → 'processing'                    │
│                                                     │
│  2. Download from Drive                             │
│     └─→ DriveClient.download_file()                 │
│                                                     │
│  3. Get processor                                   │
│     └─→ ProcessorFactory.get_processor()            │
│         ├─ ExcelProcessor (xlsx, xls, csv)          │
│         └─ OCRProcessor (pdf, jpg, png, heic)       │
│                                                     │
│  4. Process file (extract raw text)                 │
│     └─→ processor.process()                         │
│         └─ For PDFs: handle password decryption     │
│                                                     │
│  5. Store OCR output                                │
│     └─→ db_client.insert_ocr_output()               │
│                                                     │
│  6. Check processing path:                          │
│                                                     │
│     ┌─────────────────────┐  ┌────────────────────┐ │
│     │ excel_direct_insert │  │ LLM Extraction     │ │
│     │ = true              │  │ (default)          │ │
│     └──────────┬──────────┘  └─────────┬──────────┘ │
│                │                       │            │
│                ▼                       ▼            │
│     Extract data between    StructuredExtractor     │
│     delimiters + normalize  .extract()              │
│                │                       │            │
│                ▼                       ▼            │
│     insert_excel_rows_      insert_extraction()     │
│     direct()                 ├─ extractions table   │
│                │             └─ document table(s)   │
│                └───────────────────────┘            │
│                             │                       │
│  7. Update status → 'completed'                     │
│                                                     │
│  On error:                                          │
│  - Log error to processing_logs                     │
│  - Update status → 'failed'                         │
│  - Increment retry count                            │
└─────────────────────────────────────────────────────┘
```

### Status Lifecycle

```
pending ──────► processing ──────► completed
    │                │
    │                │
    │                ▼
    └───────────► failed (increment retry)
                     │
                     │ (if retry_count < max_retries)
                     ▼
                  pending (re-queued)
```

---

## 12. Currently Configured Document Types

Based on `config.yaml`, the system is configured for:

### 12.1 Hotel Invoice (`hotel_invoice`)

- **Folder**: `${HOTEL_INVOICES}`
- **File Types**: pdf, jpg, jpeg, png, heic
- **Processing**: LLM extraction

**Fields:**
| Field | Type | Required |
|-------|------|----------|
| guest_name | string | Yes |
| source | string | Yes |
| arrival_time | date | Yes |
| departure_time | date | Yes |
| booking_id | string | Yes |
| booking_date | date | Yes |
| taxable_amount | number | Yes |
| cgst | number | Yes |
| sgst | number | Yes |
| grand_total | number | Yes |
| invoice_number | string | Yes |

### 12.2 MakeMyTrip Invoice (`mmt_invoice`)

- **Folder**: `${MMT_INVOICES}`
- **File Types**: pdf, jpg, jpeg, png, heic
- **Processing**: LLM extraction
- **Special Features**: Calculated TCS/TDS fields

**Fields:**
| Field | Type | Required |
|-------|------|----------|
| primary_guest_details | string | Yes |
| booking_id | string | Yes |
| booked_on | date | Yes |
| check_in | date | Yes |
| check_out | date | Yes |
| room_charges | number | Yes |
| extra_adult_child_charges | number | Yes |
| property_taxes | number | Yes |
| service_charge | number | Yes |
| property_gross_charges | number | Yes |
| go_mmt_commission | number | Yes |
| gst_on_commission | number | Yes |
| tcs | number | No (calculated if not present) |
| tds | number | No (calculated if not present) |

### 12.3 Card Settlement / HDFC MPR (`card_settlement`)

- **Folder**: `${HDFC_MPR_HOTEL_ACCOUNT}`
- **File Types**: pdf, jpg, jpeg, png, heic
- **PDF Password**: `AYH059`
- **Processing**: LLM extraction with nested arrays
- **Custom Main Table**: `card_settlement`

**Main Table Fields:**
| Field | Type | Required |
|-------|------|----------|
| gross_amount | number | Yes |
| discount | number | Yes |
| gst_amount | number | Yes |
| net_amount | number | Yes |
| mpr_date | date | Yes |

**Child Table: `card_transactions`**
| Field | Type | Required |
|-------|------|----------|
| transaction_date | date | Yes |
| settlement_date | date | Yes |
| gross_amount | number | Yes |
| mdr_percent | number | Yes |

**Child Table: `upi_transactions`**
| Field | Type | Required |
|-------|------|----------|
| transaction_date | date | Yes |
| settlement_date | date | Yes |
| amount | number | Yes |
| vpa | string | Yes |
| upi_transaction_id | string | Yes |

### 12.4 Bank Statement (`bank_statement`)

- **Folder**: `${BANK_STATEMENTS}`
- **File Types**: xlsx, xls
- **Processing**: **Direct Excel insertion** (no LLM)
- **Special**: `excel_direct_insert: true`

**Fields:**
| Field | Type | Required |
|-------|------|----------|
| date | date | Yes |
| narration | string | Yes |
| chq_ref_no | string | No |
| value_dt | date | Yes |
| withdrawal_amt | number | No |
| deposit_amt | number | No |
| closing_balance | number | Yes |

---

## 13. Key Design Patterns

### 13.1 Design Principles (from PRD)

1. **Google Drive is storage only**: Files are read but not modified
2. **Supabase is the workflow engine**: All state managed in database
3. **OCR is a worker, not a discovery system**: Discovery separate from processing
4. **All extraction logic is config-driven**: No hardcoded prompts or fields
5. **Append-only data model**: No updates to historical records
6. **Failures are visible and retryable**: All errors logged, retry logic built-in
7. **No silent corrections**: All operations logged
8. **Human correctness deferred**: System extracts only, doesn't validate

### 13.2 Architecture Patterns

| Pattern | Implementation |
|---------|----------------|
| **Strategy Pattern** | Processors (OCR vs Excel) |
| **Factory Pattern** | ProcessorFactory for routing |
| **Repository Pattern** | DatabaseClient abstraction |
| **Dependency Injection** | Clients passed to classes |
| **Configuration Pattern** | Single config file with env vars |

### 13.3 Error Handling Strategy

1. **File-level errors**: Caught in `process_file()`, logged, status updated
2. **Retry logic**: Automatic retry up to `max_ocr_retries`
3. **Audit trail**: All errors logged to `processing_logs`
4. **Graceful degradation**: One file failure doesn't stop batch
5. **Robust status updates**: Wrapped in try-except to ensure files never stuck in 'processing'
6. **Fatal errors**: System exits with error code for cron monitoring

### 13.4 Dual Storage Model

Extractions are stored in **two places**:

1. **`extractions` table** (JSONB):
   - For audit and history
   - Flexible schema
   - Complete original extraction

2. **Document-specific tables** (normalized columns):
   - For efficient querying
   - Type-safe columns
   - Indexed fields

---

## 14. File-by-File Reference

### Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/main.py` | 357 | Main orchestration, entry point |
| `src/config/loader.py` | ~150 | Config loading with env var substitution |
| `src/database/models.py` | ~155 | Data models and enums |
| `src/database/client.py` | ~361 | Supabase client wrapper |
| `src/database/table_manager.py` | ~313 | Dynamic table SQL generation |
| `src/database/excel_inserter.py` | ~100+ | Direct Excel → DB inserter |
| `src/drive/client.py` | ~80+ | Google Drive API client |
| `src/drive/discovery.py` | ~80+ | File discovery logic |
| `src/processors/base.py` | ~38 | Abstract base processor |
| `src/processors/ocr_processor.py` | ~213 | OpenAI Vision OCR |
| `src/processors/excel_processor.py` | ~242 | Excel/CSV parser |
| `src/processors/factory.py` | ~55 | Processor routing |
| `src/extractors/structured_extractor.py` | ~234 | LLM-based extraction |
| `src/utils/logging.py` | ~48 | Logging setup |
| `src/utils/retry.py` | ~44 | Retry decorator |
| `src/utils/pdf_decryptor.py` | ~70 | PDF password handling |
| `src/utils/date_parser.py` | ~83 | Date parsing utility |

### Configuration Files

| File | Purpose |
|------|---------|
| `config.yaml` | Main configuration (document types, prompts, fields) |
| `.env` | Environment variables (credentials) |
| `.env.example` | Template for environment variables |
| `requirements.txt` | Python dependencies |

### Migration Files

| File | Purpose |
|------|---------|
| `001_initial_schema.sql` | Core tables (files, ocr_outputs, extractions, processing_logs) |
| `002_document_type_tables.sql` | hotel_invoice table |
| `003_payment_settlement_tables.sql` | payment_settlement tables |
| `004_mmt_invoice_tables.sql` | mmt_invoice table |
| `005_hdfc_mpr_tables.sql` | card_settlement + child tables |
| `006_update_mmt_invoice_tcs_tds.sql` | Adds TCS/TDS columns |
| `008_bank_statement_tables.sql` | bank_statement table |

### Key Dependencies (from `requirements.txt`)

| Package | Purpose |
|---------|---------|
| `supabase>=2.0.0` | Database client |
| `google-auth>=2.23.0` | Google authentication |
| `google-api-python-client>=2.100.0` | Drive API |
| `openai>=1.0.0` | OpenAI API (OCR + extraction) |
| `pyyaml>=6.0` | YAML parsing |
| `python-dotenv>=1.0.0` | Environment variables |
| `pandas>=2.0.0` | Excel/CSV processing |
| `openpyxl>=3.1.0` | XLSX support |
| `pdf2image>=1.16.0` | PDF to image conversion |
| `pillow>=10.0.0` | Image processing |
| `pillow-heif>=0.13.0` | HEIC support |
| `pypdf>=3.0.0` | PDF password decryption |

---

## Running the System

### Manual Run

```bash
# Activate virtual environment
source venv/bin/activate

# Run with PYTHONPATH set
PYTHONPATH=src:$PYTHONPATH python src/main.py

# Or with custom config
PYTHONPATH=src:$PYTHONPATH python src/main.py /path/to/config.yaml
```

### Cron Setup

```bash
# Add to crontab (daily at 2 AM):
0 2 * * * /path/to/invoice-reconcile-sm/scripts/run_cron.sh
```

---

## Summary

The Invoice Reconcile Backend System is a well-architected, config-driven solution for:

1. **Automated document discovery** from Google Drive
2. **Multi-format processing** (PDF, images, Excel)
3. **Intelligent data extraction** using OpenAI Vision + GPT-4
4. **Structured storage** in PostgreSQL with full audit trails
5. **Robust error handling** with automatic retries

The system is designed to be:
- **Extensible**: Add new document types via config only
- **Reliable**: Comprehensive error handling and retry logic
- **Auditable**: Complete operation logging and append-only data model
- **Maintainable**: Clean separation of concerns and modular architecture

---

*Document generated: May 14, 2026*
*Total lines of code: ~2,200+*
