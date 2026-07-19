# Excel Upload Integration - Implementation Steps

## Quick Summary

This document provides step-by-step instructions to integrate Excel file uploads with direct database storage.

## Architecture Decision

**Hybrid Approach**: 
- Excel columns match DB → Direct insertion (fast, no LLM cost)
- Excel columns don't match → LLM extraction (flexible, handles any format)

## Implementation Steps

### Step 1: Add API Dependencies

**File**: `requirements.txt`

Add these lines:
```txt
fastapi>=0.104.0
uvicorn>=0.24.0
python-multipart>=0.0.6
```

**Action**: Run `pip install -r requirements.txt`

---

### Step 2: Create API Server Structure

**Create directories**:
```bash
mkdir -p src/api/routes
mkdir -p src/api/models
```

**Files to create**:
- `src/api/__init__.py`
- `src/api/server.py` (FastAPI app)
- `src/api/routes/__init__.py`
- `src/api/routes/upload.py` (Upload endpoints)
- `src/api/models/__init__.py`
- `src/api/models/request.py` (Request models)
- `src/api/models/response.py` (Response models)

---

### Step 3: Enhance Excel Processor

**File**: `src/processors/excel_processor.py`

**Add methods**:
1. `get_dataframe()` - Return pandas DataFrame directly
2. `validate_columns()` - Check if columns match expected fields
3. `map_columns()` - Apply column mapping from config

**Key changes**:
- Keep existing `process()` method (for LLM flow)
- Add new methods for direct insertion flow

---

### Step 4: Create Excel Direct Inserter

**File**: `src/database/excel_inserter.py` (NEW)

**Purpose**: Handle direct Excel → Database insertion

**Key methods**:
- `validate_excel_columns()` - Check column match
- `map_columns()` - Apply mapping config
- `convert_types()` - Convert Excel data to DB types
- `bulk_insert_rows()` - Insert all rows efficiently
- `insert_excel_file()` - Main entry point

**Features**:
- Type validation (string, number, date)
- Error handling per row
- Bulk insertion for performance
- Row number tracking

---

### Step 5: Update Config Schema

**File**: `src/config/loader.py`

**Add support for**:
```yaml
excel_mapping:
  enabled: true
  sheet_name: "Sheet1"
  header_row: 0
  column_mapping:
    "Excel Column": "db_field"
```

**Validation**:
- Check if `excel_mapping` exists
- Validate column mapping keys match DB fields
- Validate sheet_name exists in Excel file

---

### Step 6: Update Database Client

**File**: `src/database/client.py`

**Add methods**:
- `register_uploaded_file()` - Register uploaded file in `files` table
- `insert_excel_rows()` - Bulk insert Excel rows (delegate to ExcelInserter)

**Key points**:
- Use `drive_file_id = f"upload_{uuid}"` for uploaded files
- Use `drive_folder_id = "upload"` for uploaded files
- Track status: pending → processing → completed/failed

---

### Step 7: Create API Endpoints

**File**: `src/api/routes/upload.py`

**Endpoints**:

1. **POST /api/v1/upload/excel**
   - Accept multipart/form-data
   - Validate file (type, size)
   - Validate document_type
   - Process file (direct or LLM)
   - Return file_id and results

2. **GET /api/v1/upload/{file_id}/status**
   - Get processing status
   - Return row count, errors, etc.

3. **GET /api/v1/upload**
   - List uploaded files
   - Filter by document_type, status

---

### Step 8: Update Main System

**File**: `src/main.py`

**Add method**:
- `process_uploaded_file()` - Process uploaded Excel file
- Similar to `process_file()` but for uploads

**Integration**:
- Can be called from API endpoint
- Reuses existing processors and extractors
- Uses ExcelInserter for direct insertion

---

### Step 9: Database Schema Updates

**Migration**: `src/database/migrations/007_excel_row_tracking.sql`

**Add to document-specific tables**:
```sql
-- Example for a document type table
ALTER TABLE booking_excel ADD COLUMN IF NOT EXISTS row_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_booking_excel_file_row ON booking_excel(file_id, row_number);
```

**Note**: Apply to all document-specific tables that will receive Excel uploads

---

### Step 10: Update Config.yaml

**File**: `config.yaml`

**Add example document type**:
```yaml
document_types:
  - document_type: booking_excel
    file_types: [xlsx, xls, csv]
    
    # Direct Excel mapping
    excel_mapping:
      enabled: true
      sheet_name: "Bookings"  # Optional: specific sheet
      header_row: 0  # Row index for headers (0 = first row)
      column_mapping:
        "Booking ID": "booking_id"
        "Guest Name": "guest_name"
        "Check-in": "check_in"
        "Check-out": "check_out"
        "Amount": "amount"
    
    # Fallback: LLM extraction
    extraction_prompt: |
      Extract booking details from Excel data...
    
    fields:
      - name: booking_id
        type: string
        required: true
      # ... other fields
```

---

### Step 11: Create API Server Entry Point

**File**: `src/api_server.py` (NEW)

**Purpose**: Run FastAPI server

**Code structure**:
```python
from fastapi import FastAPI
from api.routes.upload import router as upload_router

app = FastAPI(title="Invoice Reconcile API")
app.include_router(upload_router, prefix="/api/v1")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

### Step 12: Error Handling

**Add validation**:
- File size limits (max 10MB)
- File type validation (xlsx, xls, csv only)
- Document type validation (must exist in config)
- Column validation (required columns present)
- Type conversion errors (catch and report)

**Error responses**:
```json
{
  "success": false,
  "error": "Column 'booking_id' not found in Excel",
  "details": {
    "missing_columns": ["booking_id"],
    "available_columns": ["Booking ID", "Guest Name", ...]
  }
}
```

---

### Step 13: Testing

**Test cases**:

1. **Direct Insertion**:
   - Excel with matching columns → Direct DB insert
   - Verify rows inserted correctly
   - Verify row_number assigned

2. **LLM Fallback**:
   - Excel with non-matching columns → LLM extraction
   - Verify extraction works
   - Verify data in DB

3. **Column Mapping**:
   - Excel with mapped columns → Direct insert with mapping
   - Verify mapping applied correctly

4. **Error Handling**:
   - Invalid file type → Error response
   - Missing columns → Error response
   - Type conversion errors → Partial success with errors

5. **Bulk Insertion**:
   - Large Excel file (1000+ rows) → Verify performance
   - Verify all rows inserted

---

### Step 14: Documentation Updates

**Files to update**:
- `README.md` - Add API usage section
- `backend-prd.md` - Document Excel upload feature
- `Phase1_execution.md` - Add API server section

---

## Quick Start Guide

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Run API Server
```bash
python src/api_server.py
```

### 3. Test Upload
```bash
curl -X POST "http://localhost:8000/api/v1/upload/excel" \
  -F "file=@bookings.xlsx" \
  -F "document_type=booking_excel"
```

### 4. Check Status
```bash
curl "http://localhost:8000/api/v1/upload/{file_id}/status"
```

---

## Configuration Example

### Minimal Config (Exact Column Match)
```yaml
document_types:
  - document_type: simple_excel
    file_types: [xlsx, csv]
    excel_mapping:
      enabled: true
      exact_match: true  # Excel columns must match DB field names exactly
    fields:
      - name: booking_id
        type: string
        required: true
      - name: amount
        type: number
        required: true
```

### Full Config (With Mapping)
```yaml
document_types:
  - document_type: mapped_excel
    file_types: [xlsx]
    excel_mapping:
      enabled: true
      sheet_name: "Data"
      header_row: 1  # Skip first row, use second row as header
      column_mapping:
        "Booking ID": "booking_id"
        "Guest Name": "guest_name"
        "Check-in Date": "check_in"
        "Total Amount": "amount"
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
      - name: amount
        type: number
        required: true
```

---

## Decision Points

Before implementing, clarify:

1. **Row Model**: 
   - ✅ **Recommended**: One Excel row = One DB record (with row_number)
   - Alternative: One Excel file = One DB record (current model)

2. **Authentication**:
   - API key in header?
   - JWT tokens?
   - No auth (internal use only)?

3. **Multiple Sheets**:
   - Process all sheets?
   - Process specific sheet (from config)?
   - One sheet per document type?

4. **Error Strategy**:
   - Strict: Fail entire file on first error?
   - Lenient: Continue with warnings for bad rows?

5. **LLM Fallback**:
   - Always available?
   - Configurable per document type?
   - Disabled for some types?

---

## Next Steps

1. Review this plan
2. Clarify decision points above
3. Start with Step 1 (dependencies)
4. Implement incrementally (test after each step)
5. Update documentation as you go

---

## Questions?

If anything is unclear, ask before implementing to avoid rework.
