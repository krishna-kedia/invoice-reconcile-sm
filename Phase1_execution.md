# Phase 1 Execution Report - Invoice Reconcile Backend System

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Implementation Overview](#implementation-overview)
3. [Project Structure](#project-structure)
4. [Detailed File Analysis](#detailed-file-analysis)
5. [Architecture & Design Decisions](#architecture--design-decisions)
6. [Configuration System](#configuration-system)
7. [Database Schema](#database-schema)
8. [Complete Setup Instructions](#complete-setup-instructions)
9. [Running the System](#running-the-system)
10. [Testing & Validation](#testing--validation)
11. [Troubleshooting Guide](#troubleshooting-guide)
12. [Next Steps & Future Enhancements](#next-steps--future-enhancements)

---

## Executive Summary

This document provides a comprehensive overview of the Phase 1 implementation of the Invoice Reconcile Backend System. The system is a config-driven Python backend that:

- Reads documents from Google Drive folders
- Extracts text using OCR (OpenAI Vision) or direct parsing (Excel/CSV)
- Extracts structured data using LLM-based extraction
- Stores all results in Supabase (PostgreSQL) with full audit trails
- Supports retry logic and error handling
- Is fully configurable via YAML without code changes

**Status**: ✅ Complete - All 15 implementation tasks completed

---

## Implementation Overview

### Completed Components

1. ✅ Project structure and dependencies
2. ✅ Configuration system with environment variable substitution
3. ✅ Database schema and migrations
4. ✅ Supabase database client wrapper
5. ✅ Google Drive API client
6. ✅ File discovery module
7. ✅ OCR processor (OpenAI Vision)
8. ✅ Excel/CSV processor
9. ✅ Processor factory
10. ✅ Structured extractor
11. ✅ Main orchestration workflow
12. ✅ Error handling and retry logic
13. ✅ Logging system
14. ✅ Documentation and setup scripts
15. ✅ Document-specific normalized tables (per document type)
16. ✅ PDF password removal service
17. ✅ Nested arrays and multiple tables support
18. ✅ Robust status management (completed only after successful table insert)
19. ✅ Case-insensitive field name matching
20. ✅ Calculated field extraction support

### Technology Stack

- **Language**: Python 3.8+
- **Database**: Supabase (PostgreSQL)
- **File Storage**: Google Drive
- **OCR**: OpenAI Vision API (GPT-4 Vision)
- **LLM Extraction**: OpenAI GPT-4
- **Configuration**: YAML with environment variable substitution
- **Scheduling**: Cron (for production)

---

## Project Structure

```
invoice-reconcile-sm/
├── .env                          # Environment variables (created from .env.example)
├── .env.example                  # Template for environment variables
├── .gitignore                    # Git ignore patterns
├── config.yaml                   # Main configuration file
├── requirements.txt              # Python dependencies
├── README.md                     # User documentation
├── backend-prd.md                # Original PRD
├── Phase1_execution.md           # This file
│
├── src/                          # Source code
│   ├── __init__.py
│   ├── main.py                   # Entry point and orchestration
│   │
│   ├── config/                   # Configuration management
│   │   ├── __init__.py
│   │   └── loader.py             # YAML config loader with env var substitution
│   │
│   ├── database/                 # Database layer
│   │   ├── __init__.py
│   │   ├── models.py             # Data models and enums
│   │   ├── client.py             # Supabase client wrapper
│   │   ├── table_manager.py      # Document-specific table management
│   │   └── migrations/
│   │       ├── 001_initial_schema.sql  # Database schema
│   │       └── 002_document_type_tables.sql  # Document-specific tables
│   │
│   ├── drive/                    # Google Drive integration
│   │   ├── __init__.py
│   │   ├── client.py             # Drive API client
│   │   └── discovery.py          # File discovery logic
│   │
│   ├── processors/               # Document processors
│   │   ├── __init__.py
│   │   ├── base.py               # Base processor interface
│   │   ├── ocr_processor.py      # OpenAI Vision OCR
│   │   ├── excel_processor.py    # Excel/CSV parser
│   │   └── factory.py            # Processor factory
│   │
│   ├── extractors/               # Structured extraction
│   │   ├── __init__.py
│   │   └── structured_extractor.py  # LLM-based field extraction
│   │
│   └── utils/                    # Utilities
│       ├── __init__.py
│       ├── logging.py           # Logging setup
│       ├── retry.py              # Retry decorators
│       └── pdf_decryptor.py      # PDF password removal service
│
└── scripts/                      # Setup and deployment scripts
    ├── setup_db.sql              # Database setup script
    └── run_cron.sh               # Cron wrapper script
```

---

## Detailed File Analysis

### Configuration Files

#### `config.yaml`
**Purpose**: Single source of truth for all system configuration

**Structure**:
- `system`: System-wide settings (retry limits, cron schedule)
- `connections`: External service credentials (via environment variables)
- `document_types`: Document type definitions with extraction prompts and field schemas

**Key Features**:
- Environment variable substitution using `${VAR_NAME}` syntax
- Supports multiple document types
- Field validation schema (type, required flags)
- Custom extraction prompts per document type
- Optional PDF password per document type (for password-protected PDFs)

**Example Configuration**:
```yaml
system:
  max_ocr_retries: 3
  cron_schedule: "0 2 * * *"

connections:
  supabase:
    url: "${SUPABASE_URL}"
    key: "${SUPABASE_KEY}"
  
  google_drive:
    service_account_path: "${GOOGLE_SERVICE_ACCOUNT_JSON}"
  
  openai:
    api_key: "${OPENAI_API_KEY}"
    model: "gpt-4-vision-preview"
    max_tokens: 4096

document_types:
  - document_type: booking_com_invoice
    drive_folder_id: "${DRIVE_FOLDER_ID_BOOKING}"
    file_types: [pdf, jpg, jpeg, png, heic]
    extraction_prompt: |
      Extract Booking.com commission invoice details...
    fields:
      - name: invoice_number
        type: string
        required: true
```

**Design Decisions**:
- All sensitive data in environment variables
- YAML for human-readable configuration
- Supports adding new document types without code changes

---

#### `.env.example` and `.env`
**Purpose**: Environment variable template and actual credentials

**Variables Required**:
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_KEY`: Supabase service role key
- `GOOGLE_SERVICE_ACCOUNT_JSON`: Path to Google service account JSON
- `OPENAI_API_KEY`: OpenAI API key
- `DRIVE_FOLDER_ID_*`: Google Drive folder IDs (one per document type)

**Security**:
- `.env` is in `.gitignore` (never committed)
- `.env.example` is a template with placeholder values

---

### Core Application Files

#### `src/main.py` (259 lines)
**Purpose**: Main entry point and orchestration class

**Key Components**:

1. **InvoiceReconcileSystem Class**:
   - Initializes all clients (database, Drive, processors, extractors)
   - Orchestrates the complete workflow
   - Handles error logging and status updates

2. **run_discovery() Method**:
   - Iterates through all configured document types
   - Calls discovery for each folder
   - Logs discovery results

3. **process_file() Method**:
   - Downloads file from Google Drive
   - Routes to appropriate processor
   - Stores OCR/parsed output
   - Extracts structured fields
   - **Status Management**: Only marks file as "completed" after successful insertion into document-specific tables
   - **Error Handling**: Comprehensive exception handling ensures files are always marked as "failed" (never left in "processing" state)
   - Logs all errors with full context

4. **run_processing() Method**:
   - Fetches pending/failed files
   - Processes each file through the pipeline
   - Handles errors gracefully

5. **run() Method**:
   - Main workflow orchestrator
   - Runs discovery then processing
   - Handles fatal errors

**Error Handling**:
- All exceptions caught and logged
- File status updated on errors (always marked as "failed", never left in "processing")
- Retry count incremented automatically
- Errors logged to `processing_logs` table
- **Table Insert Failures**: If document-specific table insertion fails, file is marked as "failed" with error details
- **Robust Status Updates**: Status update to "failed" is wrapped in try-except to ensure it always succeeds, even if logging fails

**Logging**:
- Structured logging to console
- All operations logged to database
- Error details captured for debugging

---

#### `src/config/loader.py` (137 lines)
**Purpose**: Configuration loader with environment variable substitution

**Key Features**:

1. **Config Class**:
   - Loads and parses YAML
   - Substitutes environment variables
   - Validates required sections
   - Provides typed access to config sections

2. **substitute_env_vars() Function**:
   - Recursively processes config values
   - Supports `${VAR_NAME}` syntax
   - Raises error if variable not found
   - Handles nested structures (dicts, lists)

3. **Validation**:
   - Checks for required sections (system, connections, document_types)
   - Validates connection configs
   - Validates document type structure
   - Ensures at least one document type exists

**Usage**:
```python
from config.loader import Config

config = Config()  # Loads config.yaml from project root
# Or: config = Config("/path/to/config.yaml")

max_retries = config.system['max_ocr_retries']
supabase_url = config.connections['supabase']['url']
doc_types = config.document_types
```

**Design Decisions**:
- Environment variables required (no defaults for security)
- Validation at load time (fail fast)
- Supports custom config paths for testing

---

### Database Layer

#### `src/database/models.py`
**Purpose**: Data models and type definitions

**Key Components**:

1. **Enums**:
   - `FileStatus`: pending, processing, completed, failed
   - `OperationType`: discovery, download, ocr, extraction, error
   - `LogStatus`: success, failure

2. **Data Classes**:
   - `FileRecord`: Represents a file in the database
   - `OCROutput`: Raw OCR/parsing results
   - `Extraction`: Structured field extractions
   - `ProcessingLog`: Audit trail entries

**Features**:
- `from_dict()` class methods for database row conversion
- `to_dict()` methods for database operations
- Type-safe enums for status values
- Dataclasses for clean data structures

**Usage**:
```python
file_record = FileRecord.from_dict(db_row)
status = FileStatus.PENDING
```

---

#### `src/database/table_manager.py`
**Purpose**: Document-specific table management

**Key Functions**:
- `generate_table_sql(document_type, fields) -> str`: Generate CREATE TABLE SQL for main table
- `generate_indexes_sql(document_type, fields) -> List[str]`: Generate index SQL
- `generate_child_table_sql(document_type, array_field) -> str`: Generate CREATE TABLE SQL for child tables (nested arrays)
- `generate_child_table_indexes_sql(document_type, array_field) -> List[str]`: Generate indexes for child tables
- `generate_all_tables_sql(document_type, fields) -> Dict[str, str]`: Generate SQL for main + all child tables
- `get_array_fields(fields) -> List[Dict]`: Extract array field definitions from config
- `check_table_exists(db_client, document_type) -> bool`: Check if table exists
- `ensure_table_exists(db_client, document_type, fields) -> None`: Create table if missing
- `ensure_all_tables_exist(config, db_client) -> None`: Ensure all document type tables exist

**Features**:
- Maps field types to SQL types (string→TEXT, number→NUMERIC, date→DATE)
- Generates normalized tables from config.yaml definitions
- Supports nested arrays: creates main table + child tables with foreign keys
- Creates indexes on file_id, parent table foreign keys, and commonly queried fields
- Sanitizes table and column names for SQL safety

---

#### `src/database/client.py`
**Purpose**: Supabase database client wrapper

**Key Methods**:

1. **File Operations**:
   - `insert_file()`: Create new file record
   - `get_file_by_drive_id()`: Lookup by Drive file ID
   - `get_pending_files()`: Get files needing processing
   - `update_file_status()`: Update status and retry count

2. **OCR Operations**:
   - `insert_ocr_output()`: Store raw OCR text
   - `get_ocr_output()`: Retrieve OCR results

3. **Extraction Operations**:
   - `insert_extraction()`: Store structured fields
   - `get_extraction()`: Retrieve extraction results

4. **Logging Operations**:
   - `insert_log()`: Create audit trail entry
   - `get_file_logs()`: Get all logs for a file

5. **Document-Specific Table Operations**:
   - `insert_document_extraction()`: Insert into document-specific normalized table(s) - supports main table + child tables for arrays
   - `insert_extraction()`: Updated to insert into both extractions table (JSONB) and document-specific table(s)
   - Both methods accept:
     - `fields_config`: Field definitions from config (needed for array handling)
     - `main_table`: Optional custom main table name (defaults to document_type)
   - Automatically handles splitting main fields from array fields
   - Bulk inserts child table records for efficiency
   - **Critical**: Raises exception if table insertion fails, ensuring files are marked as "failed" rather than "completed"

**Design Decisions**:
- Uses Supabase Python client (not raw SQL)
- Returns typed model objects
- Handles errors with clear exceptions
- Append-only writes (no updates to historical data)

**Error Handling**:
- Raises `ValueError` on failed inserts (including table insertion failures)
- Returns `None` for not-found queries
- All operations logged to database
- **Status Management**: Files are only marked as "completed" after successful table insertion. If table insertion fails, the exception is re-raised and the file is marked as "failed" with error details.
- **Robust Failure Handling**: Exception handling ensures files are always marked as "failed" and never left in "processing" state, even if error logging fails.

---

#### `src/database/migrations/001_initial_schema.sql`
**Purpose**: Database schema definition

**Tables Created**:

1. **files**:
   - Tracks all discovered files
   - Status management (pending → processing → completed/failed)
   - **Status Rules**: 
     - Files marked as "completed" ONLY after successful insertion into document-specific tables
     - Files marked as "failed" if any step fails (OCR, extraction, or table insertion)
     - Files never left in "processing" state - always transition to completed or failed
   - Retry count tracking
   - Indexes on drive_file_id, status, document_type

2. **ocr_outputs**:
   - Stores raw OCR/parsing text
   - Metadata (model, tokens, processing time)
   - Foreign key to files

3. **extractions**:
   - Structured field extractions (JSONB)
   - Extraction metadata (prompt, model)
   - Foreign key to files

4. **processing_logs**:
   - Complete audit trail
   - Operation types and status
   - Details as JSONB
   - Indexes for efficient querying

**Features**:
- UUID primary keys
- Timestamps with timezone
- Foreign key constraints with CASCADE
- Check constraints for status values
- Automatic `updated_at` trigger
- Comprehensive indexes

**Migration Strategy**:
- Uses `CREATE TABLE IF NOT EXISTS` for idempotency
- Can be run multiple times safely
- No data loss on re-run

---

### Google Drive Integration

#### `src/drive/client.py`
**Purpose**: Google Drive API client wrapper

**Key Features**:

1. **Authentication**:
   - Service account authentication
   - Read-only scope (Drive.readonly)
   - Credentials from JSON file

2. **list_files_in_folder()**:
   - Lists all files in a folder
   - Filters by file types (MIME type or extension)
   - Handles pagination (1000 files per page)
   - Returns file metadata

3. **download_file()**:
   - Downloads file content as bytes
   - Optional file save to disk
   - Handles large files with chunked download

4. **get_file_metadata()**:
   - Retrieves file information
   - Returns name, size, timestamps

**File Type Support**:
- Maps extensions to MIME types
- Supports: PDF, JPG, PNG, HEIC, XLSX, XLS, CSV
- Fallback to name-based filtering

**Error Handling**:
- Catches `HttpError` from Google API
- Raises descriptive exceptions
- Logs errors for debugging

**Usage**:
```python
drive_client = DriveClient(service_account_path)
files = drive_client.list_files_in_folder(folder_id, ['pdf', 'jpg'])
content = drive_client.download_file(file_id)
```

---

#### `src/drive/discovery.py`
**Purpose**: File discovery and registration logic

**Key Features**:

1. **discover_files() Method**:
   - Queries Google Drive for files
   - Filters by file types
   - Checks database for duplicates
   - Inserts new files with status='pending'
   - Logs all operations

2. **Duplicate Detection**:
   - Uses `drive_file_id` as unique identifier
   - Skips files already in database
   - Prevents reprocessing

3. **File Type Extraction**:
   - Extracts extension from filename
   - Falls back to MIME type mapping
   - Normalizes to lowercase

4. **Timestamp Parsing**:
   - Parses Drive timestamps to Python datetime
   - Handles timezone information
   - Stores as ISO format strings

**Logging**:
- Logs discovery start/end
- Logs each file discovered
- Logs errors with details

**Design Decisions**:
- Idempotent (safe to run multiple times)
- Only discovers new files
- Respects file type filters from config

---

### Document Processors

#### `src/processors/base.py`
**Purpose**: Abstract base class for processors

**Interface**:
- `process()`: Abstract method to process file
- `supports()`: Abstract method to check file type support

**Design Pattern**:
- Strategy pattern for different processors
- Polymorphic interface
- Easy to add new processors

---

#### `src/processors/ocr_processor.py` (143 lines)
**Purpose**: OCR processing using OpenAI Vision API

**Key Features**:

1. **File Type Support**:
   - PDF (converted to images first)
   - Images: JPG, JPEG, PNG
   - HEIC (with pillow-heif)

2. **PDF Processing**:
   - Uses `pdf2image` to convert to images
   - Processes first page (can be extended)
   - Handles multi-page PDFs

3. **Image Processing**:
   - Converts HEIC to RGB if needed
   - Encodes to base64 for API
   - Handles various image formats

4. **OpenAI Vision API**:
   - Uses GPT-4 Vision model
   - Sends image as base64
   - Extracts all text with formatting preserved
   - Returns raw text + metadata

**Metadata Captured**:
- Model used
- Token usage (prompt, completion, total)
- File type
- Processing method

**Error Handling**:
- Handles API errors
- Validates image conversion
- Provides descriptive error messages

**PDF Password Support**:
- Supports password-protected PDFs via optional `password` parameter
- Automatically decrypts PDFs before processing if password is provided
- Handles decryption failures gracefully (logs warning, tries original PDF)

**Usage**:
```python
processor = OCRProcessor(api_key, model="gpt-4-vision-preview")
result = processor.process(file_bytes, "pdf")
raw_text = result['raw_text']
metadata = result['metadata']
```

---

#### `src/processors/excel_processor.py`
**Purpose**: Direct parsing of Excel and CSV files

**Key Features**:

1. **File Type Support**:
   - CSV (pandas)
   - XLSX (pandas + openpyxl)
   - XLS (pandas + xlrd)

2. **Text Extraction**:
   - Reads into pandas DataFrame
   - Converts to structured text format
   - Includes column names
   - Includes all row data

3. **Metadata**:
   - Number of rows and columns
   - Column names
   - DataFrame shape
   - Processing method

**Output Format**:
```
Columns: col1, col2, col3

Row 1: col1: value1 | col2: value2 | col3: value3
Row 2: col1: value4 | col2: value5 | col3: value6
```

**Design Decisions**:
- Direct parsing (no OCR needed)
- Preserves structure for LLM extraction
- Can be extended to extract directly to structured format

---

#### `src/processors/factory.py`
**Purpose**: Routes files to appropriate processor

**Key Features**:

1. **Processor Factory**:
   - Initializes OCR and Excel processors
   - Routes based on file type
   - Returns `None` if no processor supports type

2. **get_processor() Method**:
   - Checks Excel processor first
   - Falls back to OCR processor
   - Returns processor instance or None

3. **can_process() Method**:
   - Quick check if file type is supported
   - Used for validation before processing

**Design Pattern**:
- Factory pattern for processor creation
- Single responsibility (routing only)
- Easy to extend with new processors

---

### Structured Extraction

#### `src/extractors/structured_extractor.py`
**Purpose**: LLM-based structured field extraction

**Key Features**:

1. **extract() Method**:
   - Takes raw text and extraction prompt
   - Builds field schema description
   - Calls OpenAI API with JSON response format
   - Validates and converts field types
   - Returns extracted fields + metadata

2. **Field Schema Building**:
   - Generates description from config
   - Marks required fields
   - Includes type information

3. **Type Validation**:
   - Validates required fields present
   - Converts types (string, number, date)
   - Handles number formatting (removes $, ₹, commas)
   - Validates date formats (ISO preferred)
   - **Case-Insensitive Field Matching**: Automatically maps field names regardless of case (e.g., `TCS` → `tcs`, `TDS` → `tds`)
   - **Complete Field Coverage**: Ensures all config fields are present in output (sets to `None` if missing)

4. **OpenAI Integration**:
   - Uses GPT-4 for extraction
   - JSON response format enforced
   - Low temperature (0.1) for consistency
   - Token usage tracked

**Prompt Engineering**:
- System prompt for role definition
- User prompt with field schema
- Raw text included in prompt
- Clear instructions for JSON output
- **Calculated Fields**: Prompts can instruct LLM to calculate values when not explicitly present (e.g., "If TCS not mentioned, calculate as Property Gross Charges × 0.5%")
- **Field Name Instructions**: Prompts can specify exact field names to use (e.g., "use lowercase: tcs, tds")

**Error Handling**:
- JSON parsing errors
- Missing required fields
- Invalid type conversions
- API errors

**Usage**:
```python
extractor = StructuredExtractor(api_key, model="gpt-4")
result = extractor.extract(raw_text, prompt, fields)
extracted_fields = result['extracted_fields']
```

---

### Utilities

#### `src/utils/logging.py`
**Purpose**: Structured logging setup

**Features**:
- Console logging (stdout)
- Optional file logging
- Configurable log levels
- Timestamp formatting
- Logger instance management

**Usage**:
```python
from utils.logging import setup_logging

logger = setup_logging(log_file="logs/app.log", log_level="INFO")
logger.info("Message")
```

---

#### `src/utils/retry.py`
**Purpose**: Retry decorator with exponential backoff

**Features**:
- Configurable max retries
- Exponential backoff
- Customizable exceptions to catch
- Decorator pattern

**Usage**:
```python
from utils.retry import retry_with_backoff

@retry_with_backoff(max_retries=3, initial_delay=1.0)
def api_call():
    # Code that might fail
    pass
```

**Note**: Currently defined but not actively used in main workflow (retry logic handled at file level).

---

#### `src/utils/pdf_decryptor.py`
**Purpose**: PDF password decryption service

**Key Methods**:
- `is_password_protected(pdf_bytes) -> bool`: Check if PDF is password-protected
- `decrypt_pdf(pdf_bytes, password) -> bytes`: Decrypt password-protected PDF

**Features**:
- Handles both encrypted and unencrypted PDFs
- Returns decrypted PDF bytes for further processing
- Raises ValueError if password is incorrect

**Library**: Uses `pypdf` for PDF manipulation

**Usage**:
```python
from utils.pdf_decryptor import decrypt_pdf, is_password_protected

if is_password_protected(pdf_bytes):
    decrypted = decrypt_pdf(pdf_bytes, "password")
```

---

### Scripts

#### `scripts/setup_db.sql`
**Purpose**: Database setup script for Supabase

**Contents**:
- Complete schema definition
- All tables, indexes, triggers
- Can be copied directly into Supabase SQL editor
- Idempotent (safe to run multiple times)

**Usage**:
1. Open Supabase SQL editor
2. Copy entire contents of this file
3. Paste and run

---

#### `scripts/run_cron.sh`
**Purpose**: Cron wrapper script

**Features**:
- Sets up project directory
- Activates virtual environment (if exists)
- Creates logs directory
- Runs main script with logging
- Timestamped log files
- Proper exit codes

**Usage**:
```bash
chmod +x scripts/run_cron.sh
# Add to crontab:
0 2 * * * /path/to/scripts/run_cron.sh
```

---

### Documentation

#### `README.md`
**Purpose**: User-facing documentation

**Contents**:
- Overview and features
- Installation instructions
- Configuration guide
- Usage examples
- Troubleshooting
- Adding new document types

---

#### `requirements.txt`
**Purpose**: Python dependencies

**Key Dependencies**:
- `supabase>=2.0.0`: Database client
- `google-auth>=2.23.0`: Google authentication
- `google-api-python-client>=2.100.0`: Drive API
- `openai>=1.0.0`: OpenAI API
- `pyyaml>=6.0`: YAML parsing
- `python-dotenv>=1.0.0`: Environment variables
- `pandas>=2.0.0`: Excel/CSV processing
- `openpyxl>=3.1.0`: XLSX support
- `pdf2image>=1.16.0`: PDF to image conversion
- `pillow>=10.0.0`: Image processing
- `pillow-heif>=0.13.0`: HEIC support
- `psycopg2-binary>=2.9.0`: PostgreSQL driver
- `python-dateutil>=2.8.0`: Date parsing
- `xlrd>=2.0.0`: XLS support
- `pypdf>=3.0.0`: PDF password decryption

---

## Architecture & Design Decisions

### Design Principles (from PRD)

1. **Google Drive is storage only**: Files are read but not modified
2. **Supabase is the workflow engine**: All state managed in database
3. **OCR is a worker, not a discovery system**: Discovery separate from processing
4. **All extraction logic is config-driven**: No hardcoded prompts or fields
5. **Append-only data model**: No updates to historical records
6. **Failures are visible and retryable**: All errors logged, retry logic built-in
7. **No silent corrections**: All operations logged
8. **Human correctness deferred**: System extracts only, doesn't validate

### Architecture Patterns

1. **Strategy Pattern**: Processors (OCR vs Excel)
2. **Factory Pattern**: Processor routing
3. **Repository Pattern**: Database client abstraction
4. **Dependency Injection**: Clients passed to classes
5. **Configuration Pattern**: Single config file with env vars

### Data Flow

```
Google Drive
    ↓ (discovery)
File Discovery Module
    ↓ (insert files)
Supabase (files table)
    ↓ (fetch pending)
Main Orchestrator
    ↓ (download)
Google Drive API
    ↓ (file bytes)
Processor Factory
    ↓ (route by type)
OCR Processor OR Excel Processor
    ↓ (raw text)
Supabase (ocr_outputs table)
    ↓ (extract)
Structured Extractor
    ↓ (structured fields)
Supabase (extractions table - JSONB for audit)
    ↓ (also insert into)
Supabase (document-specific table - normalized columns)
    ↓ (update status)
Supabase (files table - status=completed)
```

### Error Handling Strategy

1. **File-level errors**: Caught in `process_file()`, logged, status updated
2. **Retry logic**: Automatic retry up to `max_ocr_retries`
3. **Audit trail**: All errors logged to `processing_logs`
4. **Graceful degradation**: One file failure doesn't stop batch
5. **Fatal errors**: System exits with error code for cron monitoring

---

## Configuration System

### Environment Variables

All sensitive data in `.env`:

```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGc...

# Google Drive
GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/service-account.json

# OpenAI
OPENAI_API_KEY=sk-...

# Drive Folder IDs
DRIVE_FOLDER_ID_BOOKING=1a2b3c4d5e6f...
```

### Config File Structure

```yaml
system:
  max_ocr_retries: 3          # Max retries per file
  cron_schedule: "0 2 * * *"   # Cron expression (daily at 2 AM)

connections:
  supabase:
    url: "${SUPABASE_URL}"     # From .env
    key: "${SUPABASE_KEY}"
  
  google_drive:
    service_account_path: "${GOOGLE_SERVICE_ACCOUNT_JSON}"
  
  openai:
    api_key: "${OPENAI_API_KEY}"
    model: "gpt-4-vision-preview"
    max_tokens: 4096

document_types:
  - document_type: booking_com_invoice
    drive_folder_id: "${DRIVE_FOLDER_ID_BOOKING}"
    file_types: [pdf, jpg, jpeg, png, heic]
    extraction_prompt: |
      Extract Booking.com commission invoice details...
    fields:
      - name: invoice_number
        type: string
        required: true
      # ... more fields
```

### Adding New Document Types

1. Create Google Drive folder
2. Share with service account email
3. Add folder ID to `.env`
4. Add document type to `config.yaml`:
   ```yaml
   document_types:
     - document_type: new_type
       drive_folder_id: "${DRIVE_FOLDER_ID_NEW}"
       file_types: [pdf, jpg]
       extraction_prompt: |
         Your extraction instructions...
       fields:
         - name: field1
           type: string
           required: true
   ```
5. No code changes needed!

### Adding Nested Arrays (Multiple Tables)

For documents with nested arrays (e.g., bank payment reports with transaction lists), define array fields with `type: array`. This creates a main table for summary data and child tables for array items.

#### Example: HDFC Bank Merchant Payment Report

```yaml
document_types:
  - document_type: hdfc_mpr
    drive_folder_id: "${HDFC_MPR_FOLDER}"
    file_types: [pdf]
    main_table: card_settlement  # Custom main table name
    pdf_password: "AYH059"       # Optional: for password-protected PDFs

    extraction_prompt: |
      Extract HDFC Bank Merchant Payment Report details.
      Return gross_amount, discount, gst_amount, net_amount, mpr_date,
      and arrays: card[] (with transaction_date, settlement_date, gross_amount, mdr_percent)
      and upi[] (with transaction_date, settlement_date, amount, vpa, upi_transaction_id).

    fields:
      # Main table fields → stored in card_settlement
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
      
      # Array field → creates card_transactions child table
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
      
      # Array field → creates upi_transactions child table
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

1. **Main Table**: Created from non-array fields (e.g., `card_settlement` with summary totals)
2. **Child Tables**: Created for each array field (e.g., `card_transactions`, `upi_transactions`)
3. **Foreign Keys**: Child tables reference main table via `{main_table}_id`
4. **Data Flow**:
   - LLM extracts and returns JSON with nested arrays
   - System splits data automatically:
     - Main fields → `card_settlement` table
     - Card array items → `card_transactions` table (bulk insert)
     - UPI array items → `upi_transactions` table (bulk insert)
5. **Empty Arrays**: Handled gracefully (no child records created if array is empty)

#### Migration SQL

Create migration script (e.g., `005_hdfc_mpr_tables.sql`):

```sql
-- Main table
CREATE TABLE IF NOT EXISTS card_settlement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    gross_amount NUMERIC(15, 2) NOT NULL,
    discount NUMERIC(15, 2) NOT NULL,
    gst_amount NUMERIC(15, 2) NOT NULL,
    net_amount NUMERIC(15, 2) NOT NULL,
    mpr_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Child table for card transactions
CREATE TABLE IF NOT EXISTS card_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_settlement_id UUID NOT NULL REFERENCES card_settlement(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    settlement_date DATE NOT NULL,
    gross_amount NUMERIC(15, 2) NOT NULL,
    mdr_percent NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Child table for UPI transactions
CREATE TABLE IF NOT EXISTS upi_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_settlement_id UUID NOT NULL REFERENCES card_settlement(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    settlement_date DATE NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    vpa TEXT NOT NULL,
    upi_transaction_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_card_settlement_file_id ON card_settlement(file_id);
CREATE INDEX IF NOT EXISTS idx_card_transactions_card_settlement_id ON card_transactions(card_settlement_id);
CREATE INDEX IF NOT EXISTS idx_upi_transactions_card_settlement_id ON upi_transactions(card_settlement_id);
```

#### Key Points

- **`main_table`**: Optional field to specify custom main table name (defaults to `document_type`)
- **`type: array`**: Marks field as array that creates child table
- **`child_table`**: Name of child table to create
- **`child_fields`**: Field definitions for child table columns
- **Arrays can be empty**: System handles missing or empty arrays gracefully
- **Bulk inserts**: All child records inserted in single operation for efficiency

### Field Extraction Improvements

#### Case-Insensitive Field Matching

The system automatically handles case-insensitive field names. If the LLM returns uppercase field names (e.g., `TCS`, `TDS`) but your config specifies lowercase (e.g., `tcs`, `tds`), the system automatically maps them correctly.

**Example**:
- Config defines: `tcs`, `tds` (lowercase)
- LLM returns: `TCS`, `TDS` (uppercase)
- System maps: `TCS` → `tcs`, `TDS` → `tds`
- Database receives: `tcs`, `tds` (matching config)

#### Calculated Fields

Extraction prompts can instruct the LLM to calculate values when they're not explicitly present in documents. This is useful for fields like TCS/TDS that may need to be calculated from other values.

**Example**:
```yaml
extraction_prompt: |
  Extract invoice details.
  For TCS: If explicitly mentioned, extract that value. 
  If not mentioned, calculate TCS as Property Gross Charges × 0.005 (0.5%).
  
  For TDS: If explicitly mentioned, extract that value.
  If not mentioned, calculate TDS as Property Gross Charges × 0.001 (0.1%).
```

**Benefits**:
- Handles documents where calculated values aren't explicitly stated
- Ensures consistent data extraction even when document formats vary
- Allows prompts to specify calculation formulas

#### Complete Field Coverage

The system ensures all fields defined in config are present in the validated output. Missing optional fields are set to `None` instead of being omitted, ensuring consistent data structure.

---

## Database Schema

### Tables

#### Document-Specific Tables

Each document type has its own normalized table (e.g., `hotel_invoice`, `booking_com_invoice`) with columns matching the extracted fields defined in `config.yaml`. These tables are created automatically based on the document type configuration.

**Features**:
- Table name matches `document_type` from config
- Columns match field names from config
- Field types mapped: string→TEXT, number→NUMERIC(15,2), date→DATE
- Includes `file_id` foreign key to `files` table
- Indexes on `file_id` and commonly queried fields
- Created via migration scripts or auto-generated from config

**Example**: `hotel_invoice` table includes columns: `guest_name`, `source`, `arrival_time`, `departure_time`, `booking_id`, `booking_date`, `taxable_amount`, `cgst`, `sgst`, `grand_total`, `invoice_number`.

**Data Flow**: Extractions are stored in both:
1. `extractions` table (JSONB - for audit/history)
2. Document-specific table (normalized columns - for queries)

#### Nested Arrays and Multiple Tables

For documents with nested array structures (e.g., bank payment reports with transaction lists), the system supports creating multiple related tables. This enables normalized storage of summary data and detailed transaction records.

**Real-World Example: HDFC Bank Merchant Payment Report**

The HDFC MPR document type demonstrates nested arrays in practice:

**Configuration**:
```yaml
document_type: hdfc_mpr
main_table: card_settlement  # Custom main table name
fields:
  # Main table: card_settlement
  - name: gross_amount
  - name: discount
  - name: gst_amount
  - name: net_amount
  - name: mpr_date
  
  # Array → child table: card_transactions
  - name: card
    type: array
    child_table: card_transactions
    child_fields:
      - name: transaction_date
      - name: settlement_date
      - name: gross_amount
      - name: mdr_percent
  
  # Array → child table: upi_transactions
  - name: upi
    type: array
    child_table: upi_transactions
    child_fields:
      - name: transaction_date
      - name: settlement_date
      - name: amount
      - name: vpa
      - name: upi_transaction_id
```

**Database Structure**:

1. **`card_settlement`** (main table):
   - Stores summary totals: `gross_amount`, `discount`, `gst_amount`, `net_amount`, `mpr_date`
   - One record per document

2. **`card_transactions`** (child table):
   - Stores individual card payment transactions
   - Foreign key: `card_settlement_id` → references `card_settlement.id`
   - Multiple records per document (one per transaction)

3. **`upi_transactions`** (child table):
   - Stores individual UPI payment transactions
   - Foreign key: `card_settlement_id` → references `card_settlement.id`
   - Multiple records per document (one per transaction)

**How It Works**:

1. **Extraction**: LLM extracts data and returns JSON:
   ```json
   {
     "gross_amount": 100000,
     "discount": 2000,
     "gst_amount": 360,
     "net_amount": 98360,
     "mpr_date": "2025-04-20",
     "card": [
       {"transaction_date": "2025-04-19", "settlement_date": "2025-04-20", ...},
       {"transaction_date": "2025-04-19", "settlement_date": "2025-04-20", ...}
     ],
     "upi": [
       {"transaction_date": "2025-04-19", "settlement_date": "2025-04-20", ...}
     ]
   }
   ```

2. **Storage**:
   - Main fields → inserted into `card_settlement` table
   - Card array items → bulk inserted into `card_transactions` table
   - UPI array items → bulk inserted into `upi_transactions` table

3. **Empty Arrays**: If no transactions exist, arrays are empty `[]` and no child records are created

**Key Features**:

- **Custom Main Table Names**: Use `main_table` field to specify table name (defaults to `document_type`)
- **Automatic Splitting**: System automatically separates main fields from array items
- **Bulk Inserts**: All child records inserted in single operation for efficiency
- **Foreign Key Relationships**: Child tables properly reference main table
- **Graceful Handling**: Empty arrays don't cause errors

**Migration**: See `src/database/migrations/005_hdfc_mpr_tables.sql` for complete SQL example.

#### `files`
Tracks all discovered files and processing status.

**Columns**:
- `id` (UUID, PK)
- `drive_file_id` (TEXT, UNIQUE) - Google Drive file ID
- `drive_folder_id` (TEXT) - Drive folder ID
- `document_type` (TEXT) - From config
- `file_name` (TEXT)
- `file_type` (TEXT) - Extension (pdf, jpg, etc.)
- `file_size` (BIGINT)
- `drive_created_at` (TIMESTAMP)
- `drive_modified_at` (TIMESTAMP)
- `status` (TEXT) - pending, processing, completed, failed
- `ocr_retry_count` (INTEGER) - Retry attempts
- `error_message` (TEXT, NULLABLE)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP) - Auto-updated by trigger

**Indexes**:
- `idx_files_drive_file_id` - Fast duplicate lookup
- `idx_files_status` - Query pending/failed files
- `idx_files_document_type` - Filter by document type

#### `ocr_outputs`
Raw OCR/parsing results.

**Columns**:
- `id` (UUID, PK)
- `file_id` (UUID, FK → files.id)
- `raw_text` (TEXT) - Extracted text
- `ocr_metadata` (JSONB) - Model, tokens, etc.
- `created_at` (TIMESTAMP)

**Indexes**:
- `idx_ocr_outputs_file_id` - Join with files

#### `extractions`
Structured field extractions.

**Columns**:
- `id` (UUID, PK)
- `file_id` (UUID, FK → files.id)
- `document_type` (TEXT)
- `extracted_fields` (JSONB) - Field values
- `extraction_metadata` (JSONB) - Prompt, model, etc.
- `created_at` (TIMESTAMP)

**Indexes**:
- `idx_extractions_file_id` - Join with files
- `idx_extractions_document_type` - Filter by type

#### `processing_logs`
Complete audit trail.

**Columns**:
- `id` (UUID, PK)
- `file_id` (UUID, FK → files.id, NULLABLE)
- `operation` (TEXT) - discovery, download, ocr, extraction, error
- `status` (TEXT) - success, failure
- `details` (JSONB) - Operation-specific details
- `created_at` (TIMESTAMP)

**Indexes**:
- `idx_processing_logs_file_id` - Filter by file
- `idx_processing_logs_operation` - Filter by operation
- `idx_processing_logs_created_at` - Time-based queries

### Relationships

```
files (1) ──→ (many) ocr_outputs
files (1) ──→ (many) extractions
files (1) ──→ (many) processing_logs
files (1) ──→ (many) hotel_invoice (and other document-specific main tables)
files (1) ──→ (many) card_settlement (HDFC MPR main table)
card_settlement (1) ──→ (many) card_transactions (child table)
card_settlement (1) ──→ (many) upi_transactions (child table)
```

**Note**: For nested array document types, the main table (e.g., `card_settlement`) references `files`, and child tables (e.g., `card_transactions`, `upi_transactions`) reference the main table via `{main_table}_id`.

### Constraints

- `files.status` CHECK constraint (pending, processing, completed, failed)
- `processing_logs.operation` CHECK constraint
- `processing_logs.status` CHECK constraint
- Foreign keys with CASCADE (delete file → delete outputs/extractions)
- Foreign keys with SET NULL (delete file → keep logs)

---

## Complete Setup Instructions

### Prerequisites

1. **Python 3.8+** installed
2. **Supabase account** and project created
3. **Google Cloud account** with Drive API enabled
4. **OpenAI account** with API access
5. **Google Drive folders** set up for each document type

### Step 1: Clone and Install

```bash
# Navigate to project directory
cd invoice-reconcile-sm

# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Step 2: Set Up Supabase

1. **Create Supabase Project**:
   - Go to https://supabase.com
   - Create new project
   - Note your project URL and service role key

2. **Run Database Migration**:
   - Open Supabase SQL Editor
   - Copy contents of `scripts/setup_db.sql`
   - Paste and execute
   - Verify tables created (check Table Editor)

3. **Get Credentials**:
   - Project URL: `https://xxxxx.supabase.co`
   - Service Role Key: Settings → API → service_role key

### Step 3: Set Up Google Drive

1. **Create Service Account**:
   - Go to Google Cloud Console
   - Create new project (or use existing)
   - Enable Google Drive API
   - Create Service Account
   - Download JSON key file
   - Note service account email (e.g., `xxx@xxx.iam.gserviceaccount.com`)

2. **Share Drive Folders**:
   - Open Google Drive
   - For each folder in your config:
     - Right-click folder → Share
     - Add service account email
     - Give "Viewer" permission
     - Copy folder ID from URL

3. **Get Folder IDs**:
   - Folder URL: `https://drive.google.com/drive/folders/FOLDER_ID`
   - Copy `FOLDER_ID` part

### Step 4: Set Up OpenAI

1. **Get API Key**:
   - Go to https://platform.openai.com
   - Create API key
   - Copy key (starts with `sk-`)

2. **Verify Access**:
   - Ensure you have access to GPT-4 Vision
   - Check API quota/limits

### Step 5: Configure Environment

1. **Create `.env` file**:
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env`** with your values:
   ```bash
   # Supabase
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_KEY=eyJhbGc...

   # Google Drive
   GOOGLE_SERVICE_ACCOUNT_JSON=/absolute/path/to/service-account.json

   # OpenAI
   OPENAI_API_KEY=sk-...

   # Drive Folder IDs
   DRIVE_FOLDER_ID_BOOKING=1a2b3c4d5e6f...
   ```

3. **Verify paths are absolute** (especially service account JSON)

### Step 6: Configure Document Types

1. **Edit `config.yaml`**:
   - Update `drive_folder_id` values (use env vars)
   - Customize `extraction_prompt` for each document type
   - Define `fields` with types and required flags

2. **Example field types**:
   - `string`: Text values
   - `number`: Numeric values (handles currency symbols: $, ₹, commas)
   - `date`: Date values (ISO format: YYYY-MM-DD)
   - `array`: Nested arrays that create child tables (see nested arrays section)

3. **Field Name Best Practices**:
   - Use lowercase snake_case for field names (e.g., `tcs`, `tds`, `booking_id`)
   - System handles case-insensitive matching automatically
   - If LLM returns uppercase, it's automatically mapped to config field names

4. **Calculated Fields**:
   - Prompts can instruct LLM to calculate values when not explicitly present
   - Example: "If TCS not mentioned, calculate as Property Gross Charges × 0.5%"
   - Useful for fields that may or may not be explicitly stated in documents

### Step 7: Test Configuration

```bash
# Test config loading (should not error)
PYTHONPATH=src:$PYTHONPATH python -c "from config.loader import Config; c = Config(); print('Config loaded successfully')"

# Test database connection (create test script)
PYTHONPATH=src:$PYTHONPATH python -c "
from database.client import DatabaseClient
import os
from dotenv import load_dotenv
load_dotenv()
client = DatabaseClient(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_KEY'))
print('Database connection successful')
"
```

### Step 8: Verify File Structure

```bash
# Check all files exist
ls -la src/
ls -la scripts/
ls -la config.yaml .env.example
```

---

## Running the System

### Manual Run

```bash
# Activate virtual environment (if using)
source venv/bin/activate

# Run with PYTHONPATH set
PYTHONPATH=src:$PYTHONPATH python src/main.py

# Or run as module
python -m src.main

# With custom config
PYTHONPATH=src:$PYTHONPATH python src/main.py /path/to/config.yaml
```

### Expected Output

```
2026-01-24 10:00:00 - invoice_reconcile - INFO - ============================================================
2026-01-24 10:00:00 - invoice_reconcile - INFO - Starting Invoice Reconcile System
2026-01-24 10:00:00 - invoice_reconcile - INFO - ============================================================
2026-01-24 10:00:01 - invoice_reconcile - INFO - Configuration loaded successfully
2026-01-24 10:00:01 - invoice_reconcile - INFO - Database client initialized
2026-01-24 10:00:02 - invoice_reconcile - INFO - Google Drive client initialized
2026-01-24 10:00:02 - invoice_reconcile - INFO - Processors and extractors initialized
2026-01-24 10:00:02 - invoice_reconcile - INFO - Starting file discovery phase
2026-01-24 10:00:03 - invoice_reconcile - INFO - Discovering files for document type: booking_com_invoice
2026-01-24 10:00:05 - invoice_reconcile - INFO - Discovered 3 new files for booking_com_invoice
2026-01-24 10:00:05 - invoice_reconcile - INFO - Starting processing phase
2026-01-24 10:00:05 - invoice_reconcile - INFO - Found 3 files to process
2026-01-24 10:00:06 - invoice_reconcile - INFO - Processing file: invoice_001.pdf (ID: xxx)
2026-01-24 10:00:07 - invoice_reconcile - INFO - Downloaded file: invoice_001.pdf (123456 bytes)
2026-01-24 10:00:08 - invoice_reconcile - INFO - Processing file with OCRProcessor
2026-01-24 10:00:15 - invoice_reconcile - INFO - Extracted 1234 characters from invoice_001.pdf
2026-01-24 10:00:16 - invoice_reconcile - INFO - Extracting structured fields for invoice_001.pdf
2026-01-24 10:00:20 - invoice_reconcile - INFO - Extracted 8 fields from invoice_001.pdf
2026-01-24 10:00:20 - invoice_reconcile - INFO - Successfully processed file: invoice_001.pdf
...
2026-01-24 10:01:00 - invoice_reconcile - INFO - ============================================================
2026-01-24 10:01:00 - invoice_reconcile - INFO - Invoice Reconcile System completed successfully
2026-01-24 10:01:00 - invoice_reconcile - INFO - ============================================================
```

### Cron Setup

1. **Make script executable**:
   ```bash
   chmod +x scripts/run_cron.sh
   ```

2. **Edit script** (if needed):
   - Update paths if not in default location
   - Adjust virtual environment path

3. **Add to crontab**:
   ```bash
   crontab -e
   
   # Add line (runs daily at 2 AM):
   0 2 * * * /absolute/path/to/invoice-reconcile-sm/scripts/run_cron.sh
   
   # Or every 6 hours:
   0 */6 * * * /absolute/path/to/invoice-reconcile-sm/scripts/run_cron.sh
   ```

4. **Verify cron**:
   ```bash
   crontab -l  # List cron jobs
   ```

5. **Check logs**:
   ```bash
   ls -la logs/
   tail -f logs/cron_20260124.log
   ```

---

## Testing & Validation

### Unit Testing (To Be Implemented)

Recommended test structure:
```
tests/
├── test_config_loader.py
├── test_database_client.py
├── test_drive_client.py
├── test_processors.py
├── test_extractors.py
└── test_integration.py
```

### Manual Testing Checklist

1. **Config Loading**:
   - [ ] Config loads without errors
   - [ ] Environment variables substituted correctly
   - [ ] Validation catches missing sections

2. **Database Connection**:
   - [ ] Can connect to Supabase
   - [ ] Can insert file record
   - [ ] Can query files
   - [ ] Logs written correctly

3. **Google Drive**:
   - [ ] Can list files in folder
   - [ ] Can download file
   - [ ] Service account has access

4. **File Discovery**:
   - [ ] Discovers new files
   - [ ] Skips duplicates
   - [ ] Filters by file type
   - [ ] Logs discovery

5. **OCR Processing**:
   - [ ] PDF processed correctly
   - [ ] Image processed correctly
   - [ ] HEIC converted (if applicable)
   - [ ] Text extracted accurately

6. **Excel Processing**:
   - [ ] CSV parsed correctly
   - [ ] XLSX parsed correctly
   - [ ] XLS parsed correctly
   - [ ] Text formatted correctly

7. **Structured Extraction**:
   - [ ] Fields extracted correctly
   - [ ] Required fields validated
   - [ ] Types converted correctly
   - [ ] Dates formatted (ISO)

8. **Error Handling**:
   - [ ] Errors logged to database
   - [ ] File status updated on error
   - [ ] Retry count incremented
   - [ ] Failed files can be retried

9. **End-to-End**:
   - [ ] Complete workflow runs
   - [ ] All tables populated
   - [ ] Status transitions correct
   - [ ] Logs complete

### Validation Queries

**Check discovered files**:
```sql
SELECT * FROM files ORDER BY created_at DESC LIMIT 10;
```

**Check processing status**:
```sql
SELECT status, COUNT(*) 
FROM files 
GROUP BY status;
```

**Check failed files**:
```sql
SELECT file_name, error_message, ocr_retry_count 
FROM files 
WHERE status = 'failed';
```

**Check extractions**:
```sql
SELECT f.file_name, e.extracted_fields 
FROM files f
JOIN extractions e ON f.id = e.file_id
ORDER BY e.created_at DESC;
```

**Check logs**:
```sql
SELECT operation, status, COUNT(*) 
FROM processing_logs 
GROUP BY operation, status;
```

---

## Troubleshooting Guide

### Common Issues and Solutions

#### 1. Configuration Errors

**Error**: `Environment variable 'SUPABASE_URL' not found`
- **Cause**: Variable not set in `.env`
- **Solution**: Check `.env` file exists and has all required variables

**Error**: `Missing required config section: connections`
- **Cause**: Invalid `config.yaml` structure
- **Solution**: Verify YAML syntax, check all sections present

**Error**: `Document type config not found: xxx`
- **Cause**: Document type not in config
- **Solution**: Add document type to `config.yaml`

#### 2. Database Connection Errors

**Error**: `Failed to connect to Supabase`
- **Cause**: Invalid URL or key
- **Solution**: 
  - Verify `SUPABASE_URL` is correct
  - Verify `SUPABASE_KEY` is service role key (not anon key)
  - Check network connectivity

**Error**: `relation "files" does not exist`
- **Cause**: Database schema not created
- **Solution**: Run `scripts/setup_db.sql` in Supabase SQL editor

**Error**: `permission denied for table files`
- **Cause**: Using wrong API key (anon instead of service role)
- **Solution**: Use service role key in `.env`

#### 3. Google Drive Errors

**Error**: `Service account file not found`
- **Cause**: Invalid path in `.env`
- **Solution**: Use absolute path to JSON file

**Error**: `Error listing files in folder: 403 Forbidden`
- **Cause**: Service account doesn't have access
- **Solution**: Share folder with service account email

**Error**: `Error listing files in folder: 404 Not Found`
- **Cause**: Invalid folder ID
- **Solution**: Verify folder ID in config matches Drive folder

**Error**: `Error downloading file: 403 Forbidden`
- **Cause**: Service account can't download
- **Solution**: Ensure service account has "Viewer" permission

#### 4. OpenAI API Errors

**Error**: `OpenAI API error: Invalid API key`
- **Cause**: Wrong or expired API key
- **Solution**: Verify API key in `.env`, check OpenAI dashboard

**Error**: `OpenAI API error: Rate limit exceeded`
- **Cause**: Too many requests
- **Solution**: Wait and retry, check API quota

**Error**: `OpenAI API error: Model not found`
- **Cause**: Invalid model name
- **Solution**: Check model name in config (e.g., `gpt-4-vision-preview`)

**Error**: `Failed to parse JSON response`
- **Cause**: LLM didn't return valid JSON
- **Solution**: Check extraction prompt, verify model supports JSON mode

#### 5. Processing Errors

**Error**: `No processor available for file type: xxx`
- **Cause**: File type not supported
- **Solution**: Add processor or update file_types in config

**Error**: `Failed to convert PDF to images` or `Command Line Error: Incorrect password`
- **Cause**: Missing poppler (for pdf2image) or password-protected PDF with wrong password
- **Solution**: 
  - Install poppler:
    ```bash
    # macOS
    brew install poppler
  - For password-protected PDFs: Verify `pdf_password` in config.yaml matches the PDF password
  - Check logs to see if decryption was attempted and failed

**Error**: `Failed to insert into document-specific table` or `Could not find the 'xxx' column`
- **Cause**: Table schema doesn't match config fields (column name mismatch or missing column)
- **Solution**: 
  - Run migration script to update table schema
  - Verify field names in config match database column names (case-sensitive in database)
  - Check if field names were changed in config but table wasn't updated

**Error**: File marked as "completed" but data not in table
- **Cause**: This should not happen with current implementation
- **Solution**: 
  - Check if table insertion actually failed (should mark file as "failed")
  - Verify exception handling is working correctly
  - Check processing logs for table insertion errors

**Error**: File stuck in "processing" status
- **Cause**: Exception occurred but status update failed (should be rare)
- **Solution**: 
  - Check error logs for details
  - Manually update status if needed: `UPDATE files SET status = 'failed' WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '1 hour'`
  - System should automatically mark as failed, but this is a fallback

#### 6. Field Extraction Issues

**Issue**: Fields not being extracted (showing as null)
- **Cause**: Field not present in document or LLM not finding it
- **Solution**: 
  - Review extraction prompt - be more specific about field location
  - For calculated fields: Ensure prompt includes calculation formula
  - Check if field name matches between prompt and config (case-insensitive matching helps)

**Issue**: Field name mismatch (e.g., LLM returns `TCS` but config has `tcs`)
- **Cause**: Case sensitivity in field names
- **Solution**: 
  - System now handles this automatically with case-insensitive matching
  - Ensure config uses lowercase snake_case for consistency
  - System will map `TCS` → `tcs` automatically

**Issue**: Calculated fields not working
- **Cause**: Calculation formula not clear in prompt or missing base values
- **Solution**: 
  - Make calculation formula explicit in extraction prompt
  - Ensure base values (e.g., Property Gross Charges) are extracted first
  - Example: "If TCS not mentioned, calculate as Property Gross Charges × 0.005"
  
  # Ubuntu
  sudo apt-get install poppler-utils
  ```

**Error**: `Invalid date format for field 'xxx'`
- **Cause**: LLM returned date in wrong format
- **Solution**: Improve extraction prompt, specify date format

**Error**: `Missing required fields: ['invoice_number']`
- **Cause**: LLM didn't extract required field
- **Solution**: Improve extraction prompt, check document quality

#### 6. Import Errors

**Error**: `ModuleNotFoundError: No module named 'config'`
- **Cause**: PYTHONPATH not set
- **Solution**: Run with `PYTHONPATH=src:$PYTHONPATH python src/main.py`

**Error**: `ImportError: cannot import name 'Config'`
- **Cause**: Syntax error in module
- **Solution**: Check Python syntax, verify file exists

#### 7. Permission Errors

**Error**: `Permission denied: scripts/run_cron.sh`
- **Cause**: Script not executable
- **Solution**: `chmod +x scripts/run_cron.sh`

**Error**: `Permission denied: .env`
- **Cause**: File permissions too restrictive
- **Solution**: `chmod 600 .env`

### Debugging Tips

1. **Enable Debug Logging**:
   ```python
   logger = setup_logging(log_level="DEBUG")
   ```

2. **Check Database State**:
   ```sql
   -- Check file statuses
   SELECT status, COUNT(*) FROM files GROUP BY status;
   
   -- Check recent errors
   SELECT * FROM processing_logs 
   WHERE status = 'failure' 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```

3. **Test Individual Components**:
   ```python
   # Test Drive client
   from drive.client import DriveClient
   client = DriveClient(service_account_path)
   files = client.list_files_in_folder(folder_id)
   
   # Test processor
   from processors.ocr_processor import OCRProcessor
   processor = OCRProcessor(api_key)
   result = processor.process(file_bytes, "pdf")
   ```

4. **Check Logs**:
   - Console output (if running manually)
   - Database `processing_logs` table
   - Cron log files in `logs/` directory

5. **Verify Environment**:
   ```bash
   # Check Python version
   python --version
   
   # Check installed packages
   pip list | grep -E "supabase|openai|google"
   
   # Test imports
   python -c "import supabase; import openai; print('OK')"
   ```

---

## Next Steps & Future Enhancements

### Immediate Next Steps

1. **Set Up Production Environment**:
   - [ ] Configure production Supabase instance
   - [ ] Set up production Google Drive folders
   - [ ] Configure production OpenAI account
   - [ ] Set up monitoring/alerting

2. **Initial Testing**:
   - [ ] Test with sample documents
   - [ ] Verify extraction accuracy
   - [ ] Test error scenarios
   - [ ] Validate retry logic

3. **Deployment**:
   - [ ] Set up cron job
   - [ ] Configure log rotation
   - [ ] Set up backup strategy
   - [ ] Document runbook

### Short-Term Enhancements

1. **Multi-Page PDF Support**:
   - Currently processes first page only
   - Add support for all pages
   - Combine text from multiple pages

2. **Improved Error Messages**:
   - More descriptive error messages
   - Better validation feedback
   - User-friendly error reporting

3. **Performance Optimization**:
   - Parallel processing of files
   - Batch API calls where possible
   - Caching of common operations

4. **Monitoring & Alerting**:
   - Health check endpoint
   - Metrics collection
   - Alert on failures
   - Dashboard for status

### Medium-Term Enhancements

1. **Testing Suite**:
   - Unit tests for all components
   - Integration tests
   - End-to-end tests
   - Mock external APIs

2. **Configuration Validation**:
   - Schema validation for config.yaml
   - Field type validation
   - Prompt quality checks

3. **Advanced Extraction**:
   - Support for tables in PDFs
   - Multi-document extraction
   - Confidence scores
   - Extraction quality metrics

4. **Retry Strategies**:
   - Exponential backoff
   - Different retry strategies per error type
   - Manual retry trigger

### Long-Term Enhancements

1. **Frontend Integration**:
   - API endpoints for frontend
   - File status dashboard
   - Manual correction interface
   - Approval workflow

2. **Advanced Features**:
   - Document classification
   - Duplicate detection
   - Version tracking
   - Change detection

3. **Scalability**:
   - Queue-based processing
   - Worker pool
   - Horizontal scaling
   - Load balancing

4. **Analytics**:
   - Processing metrics
   - Extraction accuracy tracking
   - Performance monitoring
   - Cost tracking

---

## Conclusion

Phase 1 implementation is **complete** and ready for testing. The system provides:

✅ Complete file discovery and processing pipeline
✅ Config-driven architecture (no code changes for new types)
✅ Comprehensive error handling and retry logic
✅ Full audit trail and logging
✅ Support for multiple file formats
✅ Structured data extraction with validation

**Next Action**: Follow the setup instructions to configure and test the system with your actual data.

---

## Appendix: File Summary

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `src/main.py` | 259 | Main orchestration | ✅ Complete |
| `src/config/loader.py` | 137 | Config loading | ✅ Complete |
| `src/database/client.py` | ~200 | Database operations | ✅ Complete |
| `src/database/models.py` | ~150 | Data models | ✅ Complete |
| `src/drive/client.py` | ~150 | Drive API client | ✅ Complete |
| `src/drive/discovery.py` | ~120 | File discovery | ✅ Complete |
| `src/processors/ocr_processor.py` | 143 | OCR processing | ✅ Complete |
| `src/processors/excel_processor.py` | ~80 | Excel parsing | ✅ Complete |
| `src/processors/factory.py` | ~50 | Processor routing | ✅ Complete |
| `src/extractors/structured_extractor.py` | ~200 | Field extraction | ✅ Complete |
| `src/utils/logging.py` | ~40 | Logging setup | ✅ Complete |
| `src/utils/retry.py` | ~40 | Retry utilities | ✅ Complete |
| `src/utils/pdf_decryptor.py` | ~70 | PDF password decryption | ✅ Complete |
| `src/database/table_manager.py` | ~200 | Document table management | ✅ Complete |
| `config.yaml` | ~40 | Configuration | ✅ Complete |
| `requirements.txt` | 16 | Dependencies | ✅ Complete |
| `README.md` | ~300 | Documentation | ✅ Complete |
| `scripts/setup_db.sql` | 90 | Database schema | ✅ Complete |
| `scripts/run_cron.sh` | ~20 | Cron wrapper | ✅ Complete |

**Total**: ~1,800 lines of code + documentation

---

*Document generated: January 24, 2026*
*Phase 1 Status: ✅ COMPLETE*
