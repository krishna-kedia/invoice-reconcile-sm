# Phase 1 Execution Steps - Complete Setup Checklist

This document provides a step-by-step checklist to get the backend service running. Follow each step in order and check off items as you complete them.

---

## Prerequisites Checklist

Before starting, ensure you have:

- [ ] Python 3.8 or higher installed
- [ ] Access to a Supabase account (or ability to create one)
- [ ] Access to Google Cloud Console
- [ ] Access to OpenAI account with API access
- [ ] Google Drive account with folders set up
- [ ] Terminal/command line access

---

## Step 1: Install Python Dependencies

### 1.1 Navigate to Project Directory
```bash
cd /path/to/invoice-reconcile-sm
```

### 1.2 Create Virtual Environment (Recommended)
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 1.3 Install Dependencies
```bash
pip install -r requirements.txt
```

**Checkpoint**: Verify installation
```bash
pip list | grep -E "supabase|openai|google"
```

You should see: `supabase`, `openai`, `google-auth`, `google-api-python-client`

---

## Step 2: Set Up Supabase Database

### 2.1 Create Supabase Project

1. Go to https://supabase.com
2. Sign in or create account
3. Click "New Project"
4. Fill in:
   - **Project Name**: `invoice-reconcile` (or your choice)
   - **Database Password**: (save this securely)
   - **Region**: Choose closest to you
   - Click "Create new project"
5. Wait for project to be created (2-3 minutes)

### 2.2 Get Supabase Credentials

1. In Supabase dashboard, go to **Settings** → **API**
2. Copy the following values:

   **Project URL**:
   ```
   https://xxxxxxxxxxxxx.supabase.co
   ```
   *(Copy this entire URL)*

   **Service Role Key**:
   ```
   eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4eHh4eHh4eHh4eHh4eHh4eHgiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjQxNzY5MzIwLCJleHAiOjE5NTczNDUzMjB9.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   *(This is a long JWT token - copy the entire service_role key, NOT the anon key)*

   ⚠️ **IMPORTANT**: Use the **service_role** key, not the **anon** key!

### 2.3 Create Database Schema

1. In Supabase dashboard, go to **SQL Editor**
2. Click "New query"
3. Open the file: `scripts/setup_db.sql`
4. Copy **ALL** contents of that file
5. Paste into SQL Editor
6. Click "Run" or press `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)
7. Verify success - you should see "Success. No rows returned"

### 2.4 Verify Tables Created

1. Go to **Table Editor** in Supabase dashboard
2. You should see 4 tables:
   - ✅ `files`
   - ✅ `ocr_outputs`
   - ✅ `extractions`
   - ✅ `processing_logs`

**Checkpoint**: Database is ready ✅

---

## Step 3: Set Up Google Drive Service Account

### 3.1 Create Google Cloud Project

1. Go to https://console.cloud.google.com
2. Click project dropdown at top
3. Click "New Project"
4. Fill in:
   - **Project Name**: `invoice-reconcile-drive` (or your choice)
   - Click "Create"
5. Wait for project creation, then select it

### 3.2 Enable Google Drive API

1. In Google Cloud Console, go to **APIs & Services** → **Library**
2. Search for "Google Drive API"
3. Click on "Google Drive API"
4. Click "Enable"
5. Wait for API to be enabled

### 3.3 Create Service Account

1. Go to **APIs & Services** → **Credentials**
2. Click "Create Credentials" → "Service Account"
3. Fill in:
   - **Service account name**: `invoice-reconcile-drive`
   - **Service account ID**: (auto-generated, keep default)
   - Click "Create and Continue"
4. **Grant this service account access to project**:
   - Role: Select "Editor" (or "Viewer" if you prefer minimal permissions)
   - Click "Continue"
5. Click "Done" (skip optional step)

### 3.4 Create and Download Service Account Key

1. In **Credentials** page, find your service account
2. Click on the service account email
3. Go to **Keys** tab
4. Click "Add Key" → "Create new key"
5. Select **JSON** format
6. Click "Create"
7. **JSON file will download automatically** - save it securely!

8. **Note the service account email** (looks like):
   ```
   invoice-reconcile-drive@your-project.iam.gserviceaccount.com
   ```
   *(Copy this email - you'll need it in Step 3.5)*

### 3.5 Share Google Drive Folders with Service Account

For each document type you want to process:

1. Open **Google Drive** (drive.google.com)
2. Navigate to the folder you want to use
3. Right-click the folder → **Share**
4. In the "Add people and groups" field, paste the **service account email** from Step 3.4
5. Set permission to **Viewer** (read-only is sufficient)
6. **Uncheck** "Notify people" (service accounts don't need notifications)
7. Click "Share"

8. **Get the Folder ID**:
   - The folder URL will be: `https://drive.google.com/drive/folders/FOLDER_ID_HERE`
   - Copy the `FOLDER_ID_HERE` part (long alphanumeric string)
   - Example: `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`

9. **Repeat for each folder** you want to process

**Checkpoint**: You should have:
- ✅ Service account JSON file downloaded
- ✅ Service account email noted
- ✅ At least one Drive folder shared with service account
- ✅ Folder ID(s) copied

---

## Step 4: Set Up OpenAI API

### 4.1 Get OpenAI API Key

1. Go to https://platform.openai.com
2. Sign in or create account
3. Go to **API keys** section (or https://platform.openai.com/api-keys)
4. Click "Create new secret key"
5. Give it a name: `invoice-reconcile-backend`
6. Click "Create secret key"
7. **Copy the key immediately** - it starts with `sk-` and you won't see it again!
   ```
   sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

### 4.2 Verify API Access

1. Check that you have access to:
   - ✅ GPT-4 Vision (for OCR)
   - ✅ GPT-4 (for extraction)
2. Check your API usage/quota in OpenAI dashboard
3. Ensure you have credits/billing set up

**Checkpoint**: You have OpenAI API key starting with `sk-` ✅

---

## Step 5: Configure Environment Variables

### 5.1 Create .env File

```bash
# In project root directory
cp .env.example .env
```

### 5.2 Fill in .env File

Open `.env` file and fill in **ALL** the following values:

```bash
# ============================================
# SUPABASE CONFIGURATION
# ============================================
# From Step 2.2 - Project URL
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co

# From Step 2.2 - Service Role Key (NOT anon key!)
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4eHh4eHh4eHh4eHh4eHh4eHgiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjQxNzY5MzIwLCJleHAiOjE5NTczNDUzMjB9.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ============================================
# GOOGLE DRIVE CONFIGURATION
# ============================================
# From Step 3.4 - Full absolute path to the JSON file you downloaded
# Example: /Users/yourname/Downloads/invoice-reconcile-drive-xxxxx.json
# On Windows: C:\Users\yourname\Downloads\invoice-reconcile-drive-xxxxx.json
GOOGLE_SERVICE_ACCOUNT_JSON=/absolute/path/to/your-service-account-key.json

# ============================================
# OPENAI CONFIGURATION
# ============================================
# From Step 4.1 - Your API key
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ============================================
# GOOGLE DRIVE FOLDER IDs
# ============================================
# From Step 3.5 - Folder ID for each document type
# Replace with your actual folder IDs
DRIVE_FOLDER_ID_BOOKING=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
```

**Important Notes**:
- Use **absolute paths** for `GOOGLE_SERVICE_ACCOUNT_JSON` (not relative)
- No quotes around values (unless the value itself contains spaces)
- No trailing slashes or spaces
- Each variable on its own line

**Example .env file** (with real-looking placeholders):
```bash
SUPABASE_URL=https://abcdefghijklmnop.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjQxNzY5MzIwLCJleHAiOjE5NTczNDUzMjB9.abcdefghijklmnopqrstuvwxyz1234567890
GOOGLE_SERVICE_ACCOUNT_JSON=/Users/john/Downloads/invoice-reconcile-drive-abc123.json
OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890
DRIVE_FOLDER_ID_BOOKING=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
```

### 5.3 Verify .env File

```bash
# Check file exists and has content
cat .env

# Verify no syntax errors (should not error)
python3 -c "from dotenv import load_dotenv; load_dotenv(); print('✅ .env file is valid')"
```

**Checkpoint**: `.env` file is complete with all values ✅

---

## Step 6: Configure config.yaml

### 6.1 Review config.yaml

Open `config.yaml` in your editor. It should look like:

```yaml
system:
  max_ocr_retries: 3
  cron_schedule: "0 2 * * *"  # Daily at 2 AM

connections:
  supabase:
    url: "${SUPABASE_URL}"
    key: "${SUPABASE_KEY}"
  
  google_drive:
    service_account_path: "${GOOGLE_SERVICE_ACCOUNT_JSON}"
  
  openai:
    api_key: "${OPENAI_API_KEY}"
    model: "gpt-4-vision-preview"  # or gpt-4o
    max_tokens: 4096

document_types:
  - document_type: HDFC_MPR
    drive_folder_id: "${HDFC_MPR_HOTEL_ACCOUNT}"
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
```

### 6.2 Customize Document Types

For each document type you want to process:

1. **Update `drive_folder_id`**: Should match your `.env` variable
   ```yaml
   drive_folder_id: "${DRIVE_FOLDER_ID_BOOKING}"  # Must match .env variable name
   ```

2. **Update `file_types`**: List the file types you want to process
   ```yaml
   file_types: [pdf, jpg, jpeg, png, heic]  # Add/remove as needed
   ```

3. **Customize `extraction_prompt`**: Write clear instructions for what to extract
   ```yaml
   extraction_prompt: |
     Extract Booking.com commission invoice details.
     Return invoice number, invoice date, stay period,
     gross revenue, commission amount, tax if present,
     and net payable.
   ```
   **Tips for good prompts**:
   - Be specific about what to extract
   - Mention the document type/context
   - List the fields you want
   - Specify format requirements (e.g., "dates in YYYY-MM-DD format")

4. **Define `fields`**: List all fields you want extracted
   ```yaml
   fields:
     - name: invoice_number      # Field name (will be key in JSON)
       type: string               # string, number, or date
       required: true             # true or false
   ```
   
   **Field Types**:
   - `string`: Text values
   - `number`: Numeric values (handles currency symbols, commas)
   - `date`: Date values (preferred format: YYYY-MM-DD)

### 6.3 Add More Document Types (Optional)

To add another document type, add another entry to `document_types`:

```yaml
document_types:
  - document_type: booking_com_invoice
    # ... existing config ...
  
  - document_type: expedia_invoice          # New document type
    drive_folder_id: "${DRIVE_FOLDER_ID_EXPEDIA}"  # Add to .env first!
    file_types: [pdf, jpg, jpeg]
    extraction_prompt: |
      Extract Expedia commission invoice details...
    fields:
      - name: invoice_number
        type: string
        required: true
      # ... more fields ...
```

**Don't forget**: Add the corresponding folder ID to `.env`:
```bash
DRIVE_FOLDER_ID_EXPEDIA=another_folder_id_here
```

**Checkpoint**: `config.yaml` is customized for your document types ✅

---

## Step 7: Test Configuration

### 7.1 Test Config Loading

```bash
# Activate virtual environment if using
source venv/bin/activate

# Test config loading
PYTHONPATH=src:$PYTHONPATH python3 -c "
from config.loader import Config
config = Config()
print('✅ Config loaded successfully')
print(f'Max retries: {config.system[\"max_ocr_retries\"]}')
print(f'Document types: {len(config.document_types)}')
"
```

**Expected Output**:
```
✅ Config loaded successfully
Max retries: 3
Document types: 1
```

**If Error**: Check that all environment variables in `.env` are set correctly.

### 7.2 Test Database Connection

```bash
PYTHONPATH=src:$PYTHONPATH python3 -c "
from database.client import DatabaseClient
import os
from dotenv import load_dotenv
load_dotenv()

url = os.getenv('SUPABASE_URL')
key = os.getenv('SUPABASE_KEY')

if not url or not key:
    print('❌ SUPABASE_URL or SUPABASE_KEY not set in .env')
    exit(1)

try:
    client = DatabaseClient(url, key)
    # Try a simple query
    files = client.get_pending_files(3)
    print(f'✅ Database connection successful')
    print(f'Found {len(files)} pending files')
except Exception as e:
    print(f'❌ Database connection failed: {e}')
    exit(1)
"
```

**Expected Output**:
```
✅ Database connection successful
Found 0 pending files
```

**If Error**: 
- Check Supabase URL and key in `.env`
- Verify you used **service_role** key, not anon key
- Check database schema was created (Step 2.3)

### 7.3 Test Google Drive Connection

```bash
PYTHONPATH=src:$PYTHONPATH python3 -c "
from drive.client import DriveClient
import os
from dotenv import load_dotenv
load_dotenv()

service_account_path = os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON')

if not service_account_path:
    print('❌ GOOGLE_SERVICE_ACCOUNT_JSON not set in .env')
    exit(1)

try:
    client = DriveClient(service_account_path)
    print('✅ Google Drive client initialized successfully')
except Exception as e:
    print(f'❌ Google Drive connection failed: {e}')
    print('Check:')
    print('  1. Service account JSON path is correct and absolute')
    print('  2. JSON file exists and is readable')
    exit(1)
"
```

**Expected Output**:
```
✅ Google Drive client initialized successfully
```

**If Error**:
- Verify JSON file path is **absolute** (starts with `/` on Mac/Linux, `C:\` on Windows)
- Check file exists: `ls /path/to/file.json` or `dir C:\path\to\file.json`
- Verify JSON file is valid (not corrupted)

### 7.4 Test OpenAI Connection

```bash
PYTHONPATH=src:$PYTHONPATH python3 -c "
from openai import OpenAI
import os
from dotenv import load_dotenv
load_dotenv()

api_key = os.getenv('OPENAI_API_KEY')

if not api_key:
    print('❌ OPENAI_API_KEY not set in .env')
    exit(1)

try:
    client = OpenAI(api_key=api_key)
    # Simple test - list models (doesn't cost anything)
    models = client.models.list()
    print('✅ OpenAI connection successful')
    print(f'Available models: {len(models.data)} models')
except Exception as e:
    print(f'❌ OpenAI connection failed: {e}')
    print('Check:')
    print('  1. API key is correct (starts with sk-)')
    print('  2. You have API access enabled')
    print('  3. You have credits/quota available')
    exit(1)
"
```

**Expected Output**:
```
✅ OpenAI connection successful
Available models: XX models
```

**If Error**:
- Verify API key is correct
- Check OpenAI dashboard for API access
- Verify billing/credits are set up

**Checkpoint**: All connections tested successfully ✅

---

## Step 8: Prepare Test Files

### 8.1 Add Test Files to Google Drive

1. Go to your Google Drive folder (the one you shared with service account)
2. Upload at least one test file:
   - PDF invoice
   - Image (JPG/PNG) of invoice
   - Or Excel/CSV file (if configured)

3. **Verify file is in the correct folder** that matches your `config.yaml`

### 8.2 Verify Folder Access

Make sure:
- ✅ Folder is shared with service account email (from Step 3.4)
- ✅ Service account has "Viewer" permission
- ✅ Test file is in the folder
- ✅ File type matches `file_types` in `config.yaml`

**Checkpoint**: Test files ready in Drive folder ✅

---

## Step 9: Run the System

### 9.1 First Run (Discovery Only)

Run the system to discover files:

```bash
# Activate virtual environment if using
source venv/bin/activate

# Run the system
PYTHONPATH=src:$PYTHONPATH python3 src/main.py
```

**Expected Output**:
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
2026-01-24 10:00:05 - invoice_reconcile - INFO - Discovered 1 new files for booking_com_invoice
2026-01-24 10:00:05 - invoice_reconcile - INFO - Starting processing phase
2026-01-24 10:00:05 - invoice_reconcile - INFO - Found 1 files to process
2026-01-24 10:00:06 - invoice_reconcile - INFO - Processing file: invoice_001.pdf (ID: xxx-xxx-xxx)
...
```

### 9.2 Monitor Processing

Watch for:
- ✅ Files discovered
- ✅ Files downloaded
- ✅ OCR/parsing completed
- ✅ Extraction completed
- ✅ Status updated to "completed"

### 9.3 Check Results in Supabase

1. Go to Supabase dashboard → **Table Editor**
2. Check `files` table:
   - Should see your test file
   - Status should be "completed" (or "failed" if error)
3. Check `ocr_outputs` table:
   - Should have raw text from your file
4. Check `extractions` table:
   - Should have structured fields extracted
5. Check `processing_logs` table:
   - Should have log entries for all operations

**Checkpoint**: System ran successfully and processed files ✅

---

## Step 10: Verify Results

### 10.1 Check File Status

In Supabase SQL Editor, run:
```sql
SELECT 
    file_name, 
    status, 
    document_type,
    ocr_retry_count,
    error_message,
    created_at
FROM files
ORDER BY created_at DESC
LIMIT 10;
```

**Expected**: Files with `status = 'completed'`

### 10.2 Check Extracted Data

```sql
SELECT 
    f.file_name,
    e.extracted_fields,
    e.created_at
FROM files f
JOIN extractions e ON f.id = e.file_id
ORDER BY e.created_at DESC;
```

**Expected**: JSON object with all your configured fields

### 10.3 Check Logs

```sql
SELECT 
    operation,
    status,
    details,
    created_at
FROM processing_logs
ORDER BY created_at DESC
LIMIT 20;
```

**Expected**: Log entries showing successful operations

---

## Troubleshooting First Run

### Issue: "Environment variable 'XXX' not found"

**Solution**:
1. Check `.env` file exists: `ls -la .env`
2. Verify variable name matches exactly (case-sensitive)
3. Check no extra spaces or quotes
4. Verify `.env` is in project root

### Issue: "Service account file not found"

**Solution**:
1. Use **absolute path** in `.env`:
   ```bash
   # ✅ Good
   GOOGLE_SERVICE_ACCOUNT_JSON=/Users/john/Downloads/key.json
   
   # ❌ Bad
   GOOGLE_SERVICE_ACCOUNT_JSON=./key.json
   ```
2. Verify file exists: `ls /path/to/file.json`
3. Check file permissions: `chmod 600 /path/to/file.json`

### Issue: "Error listing files in folder: 403 Forbidden"

**Solution**:
1. Verify folder is shared with service account email
2. Check service account has "Viewer" permission
3. Verify folder ID in config matches actual folder

### Issue: "No files discovered"

**Solution**:
1. Check files are in the correct folder
2. Verify file types match `file_types` in config
3. Check files are not in trash
4. Verify folder ID is correct

### Issue: "OpenAI API error: Invalid API key"

**Solution**:
1. Verify API key in `.env` starts with `sk-`
2. Check key is complete (not truncated)
3. Verify key is active in OpenAI dashboard

### Issue: "Failed to parse JSON response"

**Solution**:
1. Improve extraction prompt in `config.yaml`
2. Be more specific about JSON format
3. Check that document has the information you're asking for

---

## Step 11: Set Up Automated Runs (Optional)

### 11.1 Create Logs Directory

```bash
mkdir -p logs
```

### 11.2 Make Cron Script Executable

```bash
chmod +x scripts/run_cron.sh
```

### 11.3 Edit Cron Script (if needed)

Open `scripts/run_cron.sh` and verify paths are correct:
- Project directory path
- Virtual environment path (if using)

### 11.4 Add to Crontab

```bash
# Edit crontab
crontab -e

# Add this line (runs daily at 2 AM):
0 2 * * * /absolute/path/to/invoice-reconcile-sm/scripts/run_cron.sh

# Or every 6 hours:
0 */6 * * * /absolute/path/to/invoice-reconcile-sm/scripts/run_cron.sh

# Save and exit
```

### 11.5 Verify Cron Job

```bash
# List cron jobs
crontab -l

# Check logs after first run
ls -la logs/
tail -f logs/cron_$(date +%Y%m%d).log
```

---

## Complete Checklist Summary

Before running, ensure you have:

### Credentials & Keys
- [ ] Supabase Project URL
- [ ] Supabase Service Role Key (not anon key!)
- [ ] Google Service Account JSON file path
- [ ] Google Service Account email
- [ ] OpenAI API Key
- [ ] Google Drive Folder ID(s)

### Configuration Files
- [ ] `.env` file created and filled
- [ ] `config.yaml` customized for your document types
- [ ] Extraction prompts written
- [ ] Fields defined with types

### Setup Complete
- [ ] Python dependencies installed
- [ ] Database schema created in Supabase
- [ ] Google Drive folders shared with service account
- [ ] Test files uploaded to Drive folders
- [ ] All connection tests passed

### Ready to Run
- [ ] Virtual environment activated (if using)
- [ ] Test files in Drive folders
- [ ] Ready to execute: `PYTHONPATH=src:$PYTHONPATH python3 src/main.py`

---

## Quick Reference: All Required Values

### From Supabase (Step 2)
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGc... (service_role key)
```

### From Google Cloud (Step 3)
```
GOOGLE_SERVICE_ACCOUNT_JSON=/absolute/path/to/key.json
Service Account Email: xxx@xxx.iam.gserviceaccount.com
Folder IDs: 1a2b3c4d5e6f...
```

### From OpenAI (Step 4)
```
OPENAI_API_KEY=sk-proj-xxxxx...
```

### In config.yaml
- Document type names
- File types list
- Extraction prompts
- Field definitions (name, type, required)

---

## Next Steps After First Successful Run

1. **Review Extracted Data**: Check if fields are extracted correctly
2. **Refine Prompts**: Improve extraction prompts based on results
3. **Add More Document Types**: Configure additional document types
4. **Set Up Monitoring**: Monitor logs and database for issues
5. **Schedule Regular Runs**: Set up cron for automated processing

---

## Getting Help

If you encounter issues:

1. **Check Logs**: 
   - Console output
   - Supabase `processing_logs` table
   - Cron log files (if using)

2. **Verify Configuration**:
   - Run test scripts from Step 7
   - Check all values in `.env`
   - Verify `config.yaml` syntax

3. **Check Documentation**:
   - `README.md` - General documentation
   - `Phase1_execution.md` - Detailed implementation docs
   - This file - Step-by-step setup

4. **Common Issues**: See "Troubleshooting First Run" section above

---

**You're ready to run!** 🚀

Start with Step 9 and monitor the output. Good luck!
