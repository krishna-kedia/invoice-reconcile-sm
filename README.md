# Invoice Reconcile Backend System

A config-driven backend system that reads documents from Google Drive, extracts structured data using OCR (OpenAI Vision) or direct parsing (Excel/CSV), and stores results in Supabase with full audit trails and retry capabilities.

## Features

- **Config-driven**: All document types, fields, and extraction prompts configured via YAML
- **Multi-format support**: PDFs, images (JPG, PNG, HEIC), and Excel/CSV files
- **OCR processing**: Uses OpenAI Vision API for image and PDF text extraction
- **Structured extraction**: LLM-based field extraction with validation
- **Audit trail**: Complete logging of all operations
- **Retry logic**: Automatic retry for failed files with configurable limits
- **Append-only data model**: All data is append-only for full auditability

## Architecture

```
Google Drive (files)
    ↓
Python Backend
├── Drive discovery & file registration
├── OCR / parsing worker
└── Supabase writes
    ↓
Supabase (Postgres)
├── File state & retries
├── Raw OCR output
└── Structured extraction tables
```

## Prerequisites

- Python 3.8+
- Supabase account and project
- Google Cloud service account with Drive API access
- OpenAI API key
- Google Drive folders set up for each document type

## Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd invoice-reconcile-sm
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Set up Supabase database**:
   - Open your Supabase project SQL editor
   - Run the migration script: `src/database/migrations/001_initial_schema.sql`
   - Or use the convenience script: `scripts/setup_db.sql`

5. **Configure Google Drive**:
   - Create a Google Cloud service account
   - Enable Google Drive API
   - Download service account JSON key
   - Share your Drive folders with the service account email
   - Set `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env`

6. **Configure the system**:
   - Edit `config.yaml` with your document types and folder IDs
   - Set environment variables in `.env`

## Configuration

### config.yaml

The main configuration file defines:

- **System settings**: Retry limits, cron schedule
- **Connections**: Supabase, Google Drive, OpenAI credentials (via env vars)
- **Document types**: Each document type specifies:
  - Drive folder ID
  - Supported file types
  - Extraction prompt
  - Field schema (name, type, required)

Example:
```yaml
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

### Environment Variables

All sensitive credentials are stored in `.env`:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_KEY`: Supabase service role key
- `GOOGLE_SERVICE_ACCOUNT_JSON`: Path to service account JSON file
- `OPENAI_API_KEY`: OpenAI API key
- `DRIVE_FOLDER_ID_*`: Folder IDs for each document type

## Usage

### Manual Run

Run the system manually:
```bash
PYTHONPATH=src:$PYTHONPATH python src/main.py
```

Or with custom config path:
```bash
PYTHONPATH=src:$PYTHONPATH python src/main.py /path/to/config.yaml
```

Alternatively, you can run it as a module:
```bash
python -m src.main
```

### Cron Setup

Set up a daily cron job:

1. **Create cron wrapper script** (`scripts/run_cron.sh`):
   ```bash
   #!/bin/bash
   cd /path/to/invoice-reconcile-sm
   source venv/bin/activate  # If using virtualenv
   python src/main.py >> logs/cron.log 2>&1
   ```

2. **Make it executable**:
   ```bash
   chmod +x scripts/run_cron.sh
   ```

3. **Add to crontab**:
   ```bash
   crontab -e
   # Add this line (runs daily at 2 AM):
   0 2 * * * /path/to/invoice-reconcile-sm/scripts/run_cron.sh
   ```

## Database Schema

The system uses four main tables:

- **`files`**: Tracks all discovered files and their processing status
- **`ocr_outputs`**: Stores raw OCR/text extraction results
- **`extractions`**: Stores structured field extractions
- **`processing_logs`**: Complete audit trail of all operations

See `src/database/migrations/001_initial_schema.sql` for full schema.

## Workflow

1. **Discovery Phase**:
   - Queries Google Drive for files in configured folders
   - Filters by file types
   - Checks database for duplicates
   - Inserts new files with status='pending'

2. **Processing Phase**:
   - Fetches pending files (or failed files with retries available)
   - Downloads file from Drive
   - Routes to appropriate processor (OCR or Excel parser)
   - Stores raw output
   - Extracts structured fields using LLM
   - Stores extraction results
   - Updates file status

3. **Error Handling**:
   - All errors are logged to `processing_logs`
   - Failed files increment retry count
   - Files exceeding max retries remain failed for manual review

## Adding New Document Types

1. Add folder to Google Drive
2. Share folder with service account
3. Add entry to `config.yaml`:
   ```yaml
   document_types:
     - document_type: new_document_type
       drive_folder_id: "${DRIVE_FOLDER_ID_NEW}"
       file_types: [pdf, jpg]
       extraction_prompt: |
         Your extraction instructions...
       fields:
         - name: field1
           type: string
           required: true
   ```
4. Add folder ID to `.env`
5. No code changes needed!

## Logging

Logs are written to:
- **Console**: All operations
- **Database**: `processing_logs` table for audit trail
- **File**: If configured in logging setup

Log levels: DEBUG, INFO, WARNING, ERROR, CRITICAL

## Troubleshooting

### Common Issues

1. **Service account authentication fails**:
   - Verify service account JSON path is correct
   - Ensure service account has Drive API access
   - Check that folders are shared with service account email

2. **OpenAI API errors**:
   - Verify API key is valid
   - Check API quota/limits
   - Ensure model name is correct

3. **Database connection errors**:
   - Verify Supabase URL and key
   - Check network connectivity
   - Ensure database schema is created

4. **Files not discovered**:
   - Verify folder IDs in config
   - Check file types match config
   - Ensure files are not in trash

## Development

### Project Structure

```
invoice-reconcile-sm/
├── config.yaml              # Main configuration
├── requirements.txt         # Python dependencies
├── .env.example            # Environment variable template
├── src/
│   ├── main.py             # Entry point
│   ├── config/             # Configuration loader
│   ├── database/           # Database models and client
│   ├── drive/              # Google Drive integration
│   ├── processors/         # Document processors
│   ├── extractors/         # Structured extractors
│   └── utils/              # Utilities
└── scripts/                 # Setup and cron scripts
```

### Running Tests

(Test suite to be added)

## License

[Your License Here]

## Support

For issues and questions, please open an issue in the repository.
