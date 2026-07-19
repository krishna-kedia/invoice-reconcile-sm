# Excel Upload Integration Plan

## Overview

This plan outlines the integration of direct Excel file uploads with database storage. The system will support:
1. **Direct Excel uploads** via REST API (in addition to Google Drive)
2. **Direct database insertion** (skip LLM extraction when Excel columns match DB schema)
3. **LLM extraction fallback** (when columns don't match or mapping is needed)
4. **Bulk row insertion** for efficient processing

## Current State Analysis

### Existing Capabilities
- ✅ Excel processor (`ExcelProcessor`) converts Excel → text format
- ✅ Excel files from Google Drive are processed via LLM extraction
- ✅ Document-specific tables exist for structured data
- ✅ System supports nested arrays and multiple tables

### Gaps
- ❌ No direct upload API endpoint
- ❌ Excel data always goes through LLM (even when columns match DB)
- ❌ No column mapping configuration
- ❌ No bulk insertion for Excel rows

## Architecture Options

### Option A: Direct Column Mapping (Recommended)
**Approach**: Excel columns directly map to database columns
- Excel columns match DB columns → Direct insertion (no LLM)
- Excel columns don't match → Use LLM extraction (current flow)
- Configurable column mapping in `config.yaml`

**Pros**:
- Fast for structured Excel files
- No LLM cost for simple uploads
- Maintains audit trail

**Cons**:
- Requires exact column matching or mapping config

### Option B: Always Use LLM
**Approach**: All Excel files go through LLM extraction (current behavior)

**Pros**:
- Consistent processing
- Handles any Excel format

**Cons**:
- Slower and more expensive
- Unnecessary for structured data

### Option C: Hybrid (Recommended)
**Approach**: 
- Check if Excel columns match DB columns (or mapping exists)
- If match → Direct insertion
- If no match → LLM extraction fallback

**Pros**:
- Best of both worlds
- Flexible and efficient

**Cons**:
- More complex implementation

## Recommended Solution: Hybrid Approach

### Phase 1: API Endpoint for Excel Uploads

#### 1.1 Create REST API Server
- **Framework**: FastAPI (lightweight, async, auto-docs)
- **Endpoint**: `POST /api/v1/upload/excel`
- **Authentication**: API key or JWT (to be configured)

#### 1.2 Upload Endpoint Design
```python
POST /api/v1/upload/excel
Content-Type: multipart/form-data

Parameters:
- file: Excel file (xlsx, xls, csv)
- document_type: Document type from config
- use_llm: boolean (optional, default: auto-detect)
- mapping_config: JSON (optional, custom column mapping)
```

#### 1.3 Response Format
```json
{
  "success": true,
  "file_id": "uuid",
  "rows_inserted": 150,
  "processing_method": "direct_insert" | "llm_extraction",
  "warnings": []
}
```

### Phase 2: Direct Database Insertion

#### 2.1 Column Mapping Configuration
Add to `config.yaml`:
```yaml
document_types:
  - document_type: excel_booking_data
    # ... existing config ...
    
    # NEW: Excel direct mapping config
    excel_mapping:
      enabled: true  # Enable direct insertion
      sheet_name: "Sheet1"  # Optional: specific sheet
      skip_rows: 0  # Optional: skip header rows
      column_mapping:
        # Map Excel columns to DB fields
        "Booking ID": "booking_id"
        "Guest Name": "guest_name"
        "Check-in": "check_in"
        "Check-out": "check_out"
        "Amount": "amount"
      # Or use exact match (no mapping needed)
      # exact_match: true  # Excel columns must match DB field names exactly
```

#### 2.2 Excel Processor Enhancement
Enhance `ExcelProcessor` to:
- Return DataFrame directly (not just text)
- Support column mapping
- Validate data types
- Handle multiple sheets

#### 2.3 Direct Insertion Logic
Create `ExcelDirectInserter` class:
- Validate Excel columns against DB schema
- Map columns using config
- Type conversion (string, number, date)
- Bulk insert rows
- Handle errors per row

### Phase 3: Integration with Existing System

#### 3.1 File Registration
- Uploaded Excel files registered in `files` table
- `drive_file_id` = `upload_<uuid>` (for uploaded files)
- `drive_folder_id` = `upload` (special folder for uploads)
- Status tracking: pending → processing → completed/failed

#### 3.2 Processing Flow
```
Excel Upload
    ↓
Validate file & document_type
    ↓
Check if direct mapping available
    ↓
    ├─ YES → Direct DB Insertion
    │         ↓
    │      Bulk insert rows
    │         ↓
    │      Mark as completed
    │
    └─ NO → LLM Extraction (current flow)
             ↓
          Extract fields
             ↓
          Insert to DB
             ↓
          Mark as completed
```

#### 3.3 Audit Trail
- All uploads logged in `processing_logs`
- OCR output table: Store Excel metadata (columns, row count)
- Extractions table: Store direct insertion summary or LLM results

## Implementation Steps

### Step 1: Add API Dependencies
```bash
# Add to requirements.txt
fastapi>=0.104.0
uvicorn>=0.24.0
python-multipart>=0.0.6  # For file uploads
```

### Step 2: Create API Server Module
```
src/
  api/
    __init__.py
    server.py          # FastAPI app
    routes/
      __init__.py
      upload.py        # Upload endpoints
    models/
      __init__.py
      request.py       # Request models
      response.py     # Response models
```

### Step 3: Enhance Excel Processor
- Add `get_dataframe()` method
- Add column mapping support
- Add validation methods

### Step 4: Create Direct Inserter
```
src/
  database/
    excel_inserter.py  # Direct Excel → DB insertion
```

### Step 5: Update Config Schema
- Add `excel_mapping` section to config loader
- Validate mapping config

### Step 6: Update Main System
- Add upload processing to `InvoiceReconcileSystem`
- Support both Drive files and uploaded files

### Step 7: Error Handling
- File validation errors
- Column mismatch errors
- Type conversion errors
- Database insertion errors

### Step 8: Testing
- Test direct insertion with matching columns
- Test LLM fallback with non-matching columns
- Test bulk insertion performance
- Test error scenarios

## Configuration Example

```yaml
document_types:
  - document_type: booking_excel
    file_types: [xlsx, xls, csv]
    
    # Direct Excel mapping (skip LLM)
    excel_mapping:
      enabled: true
      sheet_name: "Bookings"  # Optional
      header_row: 0  # Row index for headers
      column_mapping:
        "Booking ID": "booking_id"
        "Guest Name": "guest_name"
        "Check-in Date": "check_in"
        "Check-out Date": "check_out"
        "Total Amount": "total_amount"
        "Status": "status"
    
    # Fallback: LLM extraction if direct mapping fails
    extraction_prompt: |
      Extract booking details from Excel data.
      ...
    
    fields:
      - name: booking_id
        type: string
        required: true
      - name: guest_name
        type: string
        required: true
      - name: check_in
        type: date
        required: true
      - name: check_out
        type: date
        required: true
      - name: total_amount
        type: number
        required: true
      - name: status
        type: string
        required: false
```

## Database Considerations

### Row-Level Tracking
For direct Excel insertion, each row becomes a record:
- Option A: One file → One record (current model)
- Option B: One file → Multiple records (one per Excel row)

**Recommendation**: Option B (multiple records)
- Add `row_number` to document-specific tables
- Each Excel row = one DB record
- `file_id` links all rows from same file

### Schema Update
```sql
-- Add row_number to document-specific tables
ALTER TABLE booking_excel ADD COLUMN row_number INTEGER;
CREATE INDEX idx_booking_excel_file_row ON booking_excel(file_id, row_number);
```

## API Endpoints

### 1. Upload Excel File
```
POST /api/v1/upload/excel
```

### 2. Get Upload Status
```
GET /api/v1/upload/{file_id}/status
```

### 3. List Uploads
```
GET /api/v1/upload?document_type=booking_excel&limit=10
```

## Security Considerations

1. **File Size Limits**: Max 10MB per file
2. **File Type Validation**: Only allow xlsx, xls, csv
3. **Authentication**: API key or JWT token
4. **Rate Limiting**: Max uploads per hour
5. **Input Validation**: Validate document_type exists in config

## Performance Considerations

1. **Bulk Insertion**: Use PostgreSQL COPY or batch inserts
2. **Async Processing**: Large files processed in background
3. **Chunking**: Process large Excel files in chunks
4. **Connection Pooling**: Reuse DB connections

## Error Handling

### Validation Errors
- Invalid file format
- Missing required columns
- Invalid data types
- Document type not found

### Processing Errors
- Database connection failures
- Type conversion failures
- Constraint violations
- Partial insertion failures

## Testing Strategy

1. **Unit Tests**:
   - Column mapping logic
   - Type conversion
   - Validation rules

2. **Integration Tests**:
   - API endpoint with real files
   - Direct insertion flow
   - LLM fallback flow

3. **Performance Tests**:
   - Bulk insertion (1000+ rows)
   - Large file handling (10MB+)

## Migration Path

1. **Phase 1**: API endpoint + direct insertion (new feature)
2. **Phase 2**: Enhance existing Google Drive Excel processing
3. **Phase 3**: Unified processing (Drive + Upload)

## Questions to Clarify

1. **Authentication**: How should API be secured? (API key, JWT, OAuth?)
2. **Row Model**: One file = one record OR one file = multiple records?
3. **LLM Fallback**: Always available or configurable?
4. **Multiple Sheets**: How to handle multi-sheet Excel files?
5. **Validation**: Strict (fail on first error) or lenient (continue with warnings)?
