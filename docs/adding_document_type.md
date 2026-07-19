# Adding a New Document Type

This guide explains how to add a new document type to the invoice reconcile system. The system is config-driven, so adding a new document type primarily involves updating the configuration file.

## Overview

When you add a new document type, you need to:
1. Set up a Google Drive folder
2. Add the document type to `config.yaml`
3. Add the folder ID to `.env`
4. Create the database table (via migration)
5. Test the configuration

---

## Step-by-Step Guide

### Step 1: Set Up Google Drive Folder

1. **Create a folder in Google Drive** for your new document type
   - Example: "Expedia Invoices", "Booking.com Statements", etc.

2. **Share the folder with your service account**
   - Right-click the folder → **Share**
   - Add your service account email (from `google_cloud_json_auth.json`)
   - Set permission to **Viewer**
   - Uncheck "Notify people"
   - Click **Share**

3. **Get the Folder ID**
   - The folder URL will be: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`
   - Copy the `FOLDER_ID_HERE` part (long alphanumeric string)
   - Example: `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`

---

### Step 2: Add Folder ID to .env

1. Open `.env` file in the project root

2. Add a new line with your folder ID:
   ```bash
   DRIVE_FOLDER_ID_EXPEDIA=your_folder_id_here
   ```
   - Use a descriptive name (e.g., `DRIVE_FOLDER_ID_EXPEDIA`, `DRIVE_FOLDER_ID_BOOKING`)
   - The name should match what you'll use in `config.yaml`

---

### Step 3: Add Document Type to config.yaml

1. Open `config.yaml` in the project root

2. Add a new entry to the `document_types` list:

```yaml
document_types:
  # ... existing document types ...
  
  - document_type: expedia_invoice          # Unique identifier (used as table name)
    drive_folder_id: "${DRIVE_FOLDER_ID_EXPEDIA}"  # Must match .env variable name
    file_types: [pdf, jpg, jpeg, png, heic]        # Supported file extensions
    pdf_password: "your_password_here"     # Optional - only for password-protected PDFs
    
    extraction_prompt: |
      Extract Expedia commission invoice details.
      Return invoice number, invoice date, property name,
      check-in date, check-out date, room nights,
      gross revenue, commission rate, commission amount,
      and net payable amount.
    
    fields:
      - name: invoice_number
        type: string
        required: true
      - name: invoice_date
        type: date
        required: true
      - name: property_name
        type: string
        required: true
      - name: check_in_date
        type: date
        required: true
      - name: check_out_date
        type: date
        required: true
      - name: room_nights
        type: number
        required: true
      - name: gross_revenue
        type: number
        required: true
      - name: commission_rate
        type: number
        required: false
      - name: commission_amount
        type: number
        required: true
      - name: net_payable
        type: number
        required: true
```

#### Field Configuration Details

**document_type** (required):
- Unique identifier for this document type
- Will be used as the database table name (e.g., `expedia_invoice`)
- Use snake_case (lowercase with underscores)
- Examples: `hotel_invoice`, `booking_com_invoice`, `expedia_invoice`

**drive_folder_id** (required):
- Must match the variable name in `.env` (with `${}` wrapper)
- Example: `${DRIVE_FOLDER_ID_EXPEDIA}` → `DRIVE_FOLDER_ID_EXPEDIA` in `.env`

**file_types** (required):
- List of file extensions this document type supports
- Options: `pdf`, `jpg`, `jpeg`, `png`, `heic`, `xlsx`, `xls`, `csv`
- Use lowercase

**pdf_password** (optional):
- Password for password-protected PDFs
- Only needed if your PDFs are password-protected
- If provided, the system will automatically decrypt PDFs before processing
- If PDF is not password-protected, this field is ignored
- Example: `pdf_password: "MySecurePassword123"`

**extraction_prompt** (required):
- Instructions for the LLM on what to extract
- Be specific about:
  - Document type/context
  - Fields to extract
  - Format requirements (e.g., "dates in YYYY-MM-DD format")
- Use YAML multi-line string (`|`)

**fields** (required):
- List of all fields to extract
- Each field has:
  - `name`: Field name (snake_case, will be column name)
  - `type`: Field type (`string`, `number`, or `date`)
  - `required`: `true` or `false`

**Field Types**:
- `string`: Text values (TEXT column in database)
- `number`: Numeric values (NUMERIC(15, 2) in database)
  - Handles currency symbols and commas automatically
- `date`: Date values (DATE column in database)
  - Preferred format: YYYY-MM-DD (ISO format)

---

### Step 4: Create Database Table

The system needs a database table for your new document type. You have two options:

#### Option A: Generate SQL Automatically (Recommended)

1. **Generate SQL using Python**:
   ```bash
   cd /path/to/invoice-reconcile-sm
   PYTHONPATH=src:$PYTHONPATH python3 -c "
   from config.loader import Config
   from database.table_manager import generate_table_sql, generate_indexes_sql
   
   config = Config()
   for doc_type in config.document_types:
       if doc_type['document_type'] == 'expedia_invoice':  # Your new document type
           print('-- Table for:', doc_type['document_type'])
           print(generate_table_sql(doc_type['document_type'], doc_type['fields']))
           print()
           for idx in generate_indexes_sql(doc_type['document_type'], doc_type['fields']):
               print(idx)
   "
   ```

2. **Copy the output SQL**

3. **Run in Supabase SQL Editor**:
   - Go to Supabase dashboard → SQL Editor
   - Paste the SQL
   - Click "Run" or press `Cmd+Enter` (Mac) / `Ctrl+Enter` (Windows)

#### Option B: Manual SQL Creation

1. **Create migration file** (optional):
   - Create `src/database/migrations/003_expedia_invoice.sql`
   - Or add to existing migration file

2. **Write CREATE TABLE statement**:
   ```sql
   CREATE TABLE IF NOT EXISTS expedia_invoice (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
       invoice_number TEXT NOT NULL,
       invoice_date DATE NOT NULL,
       property_name TEXT NOT NULL,
       check_in_date DATE NOT NULL,
       check_out_date DATE NOT NULL,
       room_nights NUMERIC(15, 2) NOT NULL,
       gross_revenue NUMERIC(15, 2) NOT NULL,
       commission_rate NUMERIC(15, 2) NULL,
       commission_amount NUMERIC(15, 2) NOT NULL,
       net_payable NUMERIC(15, 2) NOT NULL,
       created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
   );
   
   CREATE INDEX IF NOT EXISTS idx_expedia_invoice_file_id ON expedia_invoice(file_id);
   CREATE INDEX IF NOT EXISTS idx_expedia_invoice_invoice_number ON expedia_invoice(invoice_number);
   CREATE INDEX IF NOT EXISTS idx_expedia_invoice_invoice_date ON expedia_invoice(invoice_date);
   ```

3. **Run in Supabase SQL Editor**

---

### Step 5: Verify Configuration

1. **Test config loading**:
   ```bash
   PYTHONPATH=src:$PYTHONPATH python3 -c "
   from config.loader import Config
   config = Config()
   doc_type = config.get_document_type('expedia_invoice')
   if doc_type:
       print('✅ Document type found')
       print(f'Fields: {len(doc_type[\"fields\"])}')
   else:
       print('❌ Document type not found')
   "
   ```

2. **Test table exists** (optional):
   ```bash
   PYTHONPATH=src:$PYTHONPATH python3 -c "
   from database.client import DatabaseClient
   from database.table_manager import check_table_exists
   import os
   from dotenv import load_dotenv
   load_dotenv()
   
   client = DatabaseClient(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_KEY'))
   exists = check_table_exists(client, 'expedia_invoice')
   print('✅ Table exists' if exists else '❌ Table does not exist')
   "
   ```

---

### Step 6: Test with Real Files

1. **Upload a test file** to your Google Drive folder

2. **Run the system**:
   ```bash
   PYTHONPATH=src:$PYTHONPATH python3 src/main.py
   ```

3. **Check results**:
   - System should discover the file
   - Process it (OCR/parsing)
   - Extract structured fields
   - Insert into both:
     - `extractions` table (JSONB)
     - `expedia_invoice` table (normalized columns)

4. **Verify in Supabase**:
   ```sql
   -- Check file was processed
   SELECT * FROM files WHERE document_type = 'expedia_invoice';
   
   -- Check extraction in JSONB table
   SELECT * FROM extractions WHERE document_type = 'expedia_invoice';
   
   -- Check normalized data
   SELECT * FROM expedia_invoice;
   ```

---

## Complete Example

Here's a complete example for adding a "Booking.com Invoice" document type:

### 1. .env
```bash
DRIVE_FOLDER_ID_BOOKING=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
```

### 2. config.yaml
```yaml
document_types:
  - document_type: booking_com_invoice
    drive_folder_id: "${DRIVE_FOLDER_ID_BOOKING}"
    file_types: [pdf, jpg, jpeg, png]
    pdf_password: "MyPassword123"  # Optional - only if PDFs are password-protected
    
    extraction_prompt: |
      Extract Booking.com commission invoice details.
      Return invoice number, invoice date, stay period (start and end dates),
      gross revenue, commission percentage, commission amount,
      tax amount if present, and net payable amount.
      All dates should be in YYYY-MM-DD format.
    
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
      - name: commission_percentage
        type: number
        required: false
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

### 3. Database Table (SQL)
```sql
CREATE TABLE IF NOT EXISTS booking_com_invoice (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    invoice_date DATE NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    gross_revenue NUMERIC(15, 2) NOT NULL,
    commission_percentage NUMERIC(15, 2) NULL,
    commission_amount NUMERIC(15, 2) NOT NULL,
    tax_amount NUMERIC(15, 2) NULL,
    net_payable NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_com_invoice_file_id ON booking_com_invoice(file_id);
CREATE INDEX IF NOT EXISTS idx_booking_com_invoice_invoice_number ON booking_com_invoice(invoice_number);
CREATE INDEX IF NOT EXISTS idx_booking_com_invoice_invoice_date ON booking_com_invoice(invoice_date);
```

---

## Tips for Writing Extraction Prompts

1. **Be specific**: Mention the document type and context
   - ✅ "Extract Booking.com commission invoice details"
   - ❌ "Extract invoice details"

2. **List all fields**: Explicitly mention each field to extract
   - ✅ "Return invoice number, invoice date, gross revenue, commission amount"
   - ❌ "Extract relevant invoice information"

3. **Specify formats**: Mention date/number formats
   - ✅ "All dates in YYYY-MM-DD format"
   - ✅ "Numbers without currency symbols or commas"

4. **Handle edge cases**: Mention optional fields
   - ✅ "Tax amount if present, otherwise null"
   - ✅ "Commission percentage if available"

5. **Provide context**: Help the LLM understand the document
   - ✅ "From the GST Tax Invoice section"
   - ✅ "In the commission breakdown table"

---

## Troubleshooting

### Issue: "Environment variable 'DRIVE_FOLDER_ID_XXX' not found"
**Solution**: Check that the variable name in `.env` matches exactly (case-sensitive)

### Issue: "Table does not exist" warning
**Solution**: Run the CREATE TABLE SQL in Supabase SQL editor

### Issue: "Failed to insert into document-specific table"
**Solution**: 
- Check table exists in Supabase
- Verify column names match field names (snake_case)
- Check data types match (string→TEXT, number→NUMERIC, date→DATE)

### Issue: Extraction missing required fields
**Solution**: 
- Improve extraction prompt (be more specific)
- Check if document actually contains the information
- Verify field names in config match what LLM extracts

### Issue: Wrong data types in database
**Solution**: 
- Check field `type` in config (string/number/date)
- Verify SQL table uses correct types (TEXT/NUMERIC/DATE)

---

## PDF Password Protection

If your PDFs are password-protected, you can configure the password in `config.yaml`:

```yaml
- document_type: hotel_invoice
  drive_folder_id: "${HOTEL_INVOICES}"
  file_types: [pdf, jpg, jpeg, png, heic]
  pdf_password: "your_password_here"  # Add this line for password-protected PDFs
  extraction_prompt: |
    ...
```

**How it works**:
- System automatically detects if PDF is password-protected
- If password is provided in config, PDF is decrypted before processing
- If password is wrong or PDF isn't encrypted, system logs warning and continues
- Works seamlessly with existing processing pipeline

**Note**: Only add `pdf_password` if your PDFs are actually password-protected. The system will ignore this field for unencrypted PDFs.

## Quick Checklist

- [ ] Google Drive folder created and shared with service account
- [ ] Folder ID copied
- [ ] Folder ID added to `.env`
- [ ] Document type added to `config.yaml`
- [ ] PDF password added (if PDFs are password-protected)
- [ ] Extraction prompt written
- [ ] Fields defined with correct types
- [ ] Database table created (SQL run in Supabase)
- [ ] Configuration tested
- [ ] Test file uploaded to Drive folder
- [ ] System run and file processed successfully
- [ ] Data verified in Supabase tables

---

## Summary

Adding a new document type is straightforward:

1. **Configure** → Add to `config.yaml` and `.env`
2. **Create Table** → Run SQL in Supabase
3. **Test** → Process a file and verify results

The system automatically:
- Discovers files in the new folder
- Processes them with appropriate processor (OCR or Excel)
- Extracts fields using your prompt
- Inserts into both `extractions` and document-specific table

No code changes needed! The system is fully config-driven.
