"""
Reprocess card_settlement MPR files that were OCR'd with the old single-page path.

Flow:
  1. Query all card_settlement files with processing_method = 'openai_vision'
  2. For each: download from Drive → re-OCR (multi-page) → append new ocr_outputs row
  3. Run LLM extraction to get full upi[] array from new raw_text
  4. For each extracted UPI row, check composite key against upi_transactions
     (card_settlement_id, vpa, amount, transaction_date)
  5. Write ALL rows to upi_transactions_staging with already_exists flag
  6. Never touch upi_transactions, reconciliation_links, or files.status

Run:
  python scripts/reprocess_mpr_upi.py              # full run (writes to staging)
  python scripts/reprocess_mpr_upi.py --dry-run    # skip all DB writes, print only
"""

import sys
import os
import json
import argparse
import logging
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / 'src'))

from config.loader import Config
from database.client import DatabaseClient
from drive.client import DriveClient
from processors.ocr_processor import OCRProcessor
from extractors.structured_extractor import StructuredExtractor
from supabase import create_client

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger('reprocess_mpr')

RUN_ID = datetime.utcnow().strftime('%Y%m%d_%H%M%S')


def get_files_to_reprocess(supabase):
    """Return all card_settlement files processed with old single-page OCR."""
    result = supabase.rpc('', {}).execute() if False else None  # placeholder
    result = supabase.table('files') \
        .select('id, file_name, drive_file_id, file_size') \
        .eq('document_type', 'card_settlement') \
        .eq('status', 'completed') \
        .execute()

    files = result.data or []

    # Filter to only those with old processing_method in ocr_outputs
    reprocess = []
    for f in files:
        ocr = supabase.table('ocr_outputs') \
            .select('ocr_metadata, created_at') \
            .eq('file_id', f['id']) \
            .order('created_at', desc=True) \
            .limit(1) \
            .execute()
        if ocr.data:
            method = (ocr.data[0].get('ocr_metadata') or {}).get('processing_method', '')
            if method == 'openai_vision':
                reprocess.append(f)

    return reprocess


def get_card_settlement_id(supabase, file_id):
    result = supabase.table('card_settlement') \
        .select('id') \
        .eq('file_id', file_id) \
        .limit(1) \
        .execute()
    if result.data:
        return result.data[0]['id']
    return None


def check_existing_upi(supabase, card_settlement_id, vpa, amount, transaction_date):
    """Return True if this UPI row already exists in upi_transactions."""
    result = supabase.table('upi_transactions') \
        .select('id') \
        .eq('card_settlement_id', card_settlement_id) \
        .eq('vpa', vpa) \
        .eq('amount', amount) \
        .eq('transaction_date', transaction_date) \
        .limit(1) \
        .execute()
    return bool(result.data)


def insert_staging_row(supabase, row):
    supabase.table('upi_transactions_staging').insert(row).execute()


def process_file(file_rec, supabase, drive_client, ocr_processor, extractor,
                 extraction_prompt, upi_fields, dry_run):
    file_id = file_rec['id']
    file_name = file_rec['file_name']
    logger.info(f"  Processing: {file_name}")

    # Download from Drive
    try:
        file_content = drive_client.download_file(file_rec['drive_file_id'])
        logger.info(f"    Downloaded {len(file_content):,} bytes")
    except Exception as e:
        logger.error(f"    Download failed: {e}")
        return {'file': file_name, 'status': 'download_failed', 'error': str(e)}

    # Re-OCR (force_vision=True, multi-page)
    try:
        ocr_result = ocr_processor.process(
            file_content, 'pdf',
            password='AYH059',
            force_vision=True
        )
        raw_text = ocr_result['raw_text']
        ocr_meta = ocr_result['metadata']
        ocr_meta['reprocess'] = True
        ocr_meta['run_id'] = RUN_ID
        num_pages = ocr_meta.get('num_pages', 1)
        logger.info(f"    OCR done: {num_pages} page(s), {len(raw_text):,} chars")
    except Exception as e:
        logger.error(f"    OCR failed: {e}")
        return {'file': file_name, 'status': 'ocr_failed', 'error': str(e)}

    # Append new ocr_outputs row
    if not dry_run:
        try:
            supabase.table('ocr_outputs').insert({
                'file_id': file_id,
                'raw_text': raw_text,
                'ocr_metadata': ocr_meta
            }).execute()
        except Exception as e:
            logger.error(f"    Failed to save ocr_outputs: {e}")
            return {'file': file_name, 'status': 'ocr_save_failed', 'error': str(e)}

    # LLM extraction — get upi[] array
    try:
        extraction = extractor.extract(
            raw_text=raw_text,
            extraction_prompt=extraction_prompt,
            fields=upi_fields
        )
        upi_rows = extraction['extracted_fields'].get('upi') or []
        logger.info(f"    Extracted {len(upi_rows)} UPI row(s) from new OCR")
    except Exception as e:
        logger.error(f"    Extraction failed: {e}")
        return {'file': file_name, 'status': 'extraction_failed', 'error': str(e)}

    # Get card_settlement_id for this file
    cs_id = get_card_settlement_id(supabase, file_id)
    if not cs_id:
        logger.error(f"    No card_settlement row found for file_id {file_id}")
        return {'file': file_name, 'status': 'no_card_settlement', 'error': 'missing card_settlement row'}

    # Determine which page each UPI was found on (best-effort from raw_text)
    new_count = 0
    existing_count = 0
    staging_rows = []

    for upi in upi_rows:
        vpa = upi.get('vpa') or ''
        amount = upi.get('amount')
        txn_date = upi.get('transaction_date')
        settle_date = upi.get('settlement_date')
        upi_txn_id = upi.get('upi_transaction_id') or ''

        # Determine page (look for VPA in paged text)
        page_found = None
        if '--- Page ' in raw_text and vpa:
            pages = raw_text.split('--- Page ')
            for i, page_chunk in enumerate(pages[1:], start=1):
                if vpa in page_chunk:
                    page_found = i
                    break

        already_exists = check_existing_upi(supabase, cs_id, vpa, amount, txn_date)

        staging_row = {
            'run_id': RUN_ID,
            'card_settlement_id': cs_id,
            'transaction_date': txn_date,
            'settlement_date': settle_date,
            'amount': amount,
            'vpa': vpa,
            'upi_transaction_id': upi_txn_id,
            'source_file': file_name,
            'page_found': page_found,
            'already_exists': already_exists
        }
        staging_rows.append(staging_row)

        if already_exists:
            existing_count += 1
        else:
            new_count += 1

    if not dry_run:
        for row in staging_rows:
            try:
                insert_staging_row(supabase, row)
            except Exception as e:
                logger.error(f"    Failed to insert staging row: {e}")

    logger.info(f"    Staging: {new_count} NEW, {existing_count} already exist")

    return {
        'file': file_name,
        'status': 'ok',
        'pages': num_pages,
        'upi_extracted': len(upi_rows),
        'new': new_count,
        'existing': existing_count,
        'rows': staging_rows
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true',
                        help='Skip all DB writes; print what would happen')
    args = parser.parse_args()

    dry_run = args.dry_run
    if dry_run:
        logger.info("=== DRY RUN MODE — no DB writes ===")

    logger.info(f"Run ID: {RUN_ID}")

    # Load env
    config = Config()
    conns = config.connections

    supabase = create_client(conns['supabase']['url'], conns['supabase']['key'])
    drive_client = DriveClient(service_account_path=conns['google_drive']['service_account_path'])
    ocr_processor = OCRProcessor(
        api_key=conns['openai']['api_key'],
        model=conns['openai']['model'],
        max_tokens=conns['openai']['max_tokens']
    )
    extractor = StructuredExtractor(
        api_key=conns['openai']['api_key'],
        model=conns['openai']['model'],
        max_tokens=conns['openai']['max_tokens']
    )

    # Get card_settlement extraction config
    cs_config = config.get_document_type('card_settlement')
    extraction_prompt = cs_config['extraction_prompt']
    # Only pass fields needed for UPI extraction (keeps LLM prompt focused)
    all_fields = cs_config['fields']

    logger.info("Querying files to reprocess...")
    files = get_files_to_reprocess(supabase)
    logger.info(f"Found {len(files)} card_settlement files with old OCR path")

    results = []
    for i, f in enumerate(files, 1):
        logger.info(f"[{i}/{len(files)}] {f['file_name']}")
        result = process_file(
            f, supabase, drive_client, ocr_processor, extractor,
            extraction_prompt, all_fields, dry_run
        )
        results.append(result)

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info(f"SUMMARY  (run_id={RUN_ID})")
    logger.info("=" * 60)

    ok = [r for r in results if r['status'] == 'ok']
    failed = [r for r in results if r['status'] != 'ok']
    total_new = sum(r.get('new', 0) for r in ok)
    total_existing = sum(r.get('existing', 0) for r in ok)
    multi_page = [r for r in ok if r.get('pages', 1) > 1]

    logger.info(f"Files processed OK : {len(ok)}/{len(results)}")
    logger.info(f"Files failed        : {len(failed)}")
    logger.info(f"Multi-page files    : {len(multi_page)}")
    logger.info(f"Total UPI rows NEW  : {total_new}  ← these will be inserted on promote")
    logger.info(f"Total UPI rows DUPE : {total_existing}  ← already in upi_transactions")

    if multi_page:
        logger.info("\nMulti-page files found:")
        for r in multi_page:
            logger.info(f"  {r['file']}  ({r['pages']} pages, {r['new']} new UPI rows)")

    if failed:
        logger.info("\nFailed files:")
        for r in failed:
            logger.info(f"  {r['file']}  [{r['status']}] {r.get('error', '')}")

    if not dry_run:
        logger.info(f"\nAll new rows written to upi_transactions_staging (run_id={RUN_ID})")
        logger.info("To promote: run the SQL in scripts/promote_upi_staging.sql")

    # Write promote SQL
    promote_sql = f"""-- Promote run_id={RUN_ID} from staging to upi_transactions
-- Review staging first:
--   SELECT source_file, page_found, vpa, amount, transaction_date, already_exists
--   FROM upi_transactions_staging WHERE run_id = '{RUN_ID}' ORDER BY source_file, transaction_date;

BEGIN;

INSERT INTO upi_transactions (card_settlement_id, transaction_date, settlement_date, amount, vpa, upi_transaction_id)
SELECT card_settlement_id, transaction_date, settlement_date, amount, vpa, upi_transaction_id
FROM upi_transactions_staging
WHERE run_id = '{RUN_ID}'
  AND already_exists = FALSE;

-- Verify then COMMIT (or ROLLBACK if anything looks wrong)
COMMIT;
"""
    promote_path = Path(__file__).parent / 'promote_upi_staging.sql'
    promote_path.write_text(promote_sql)
    logger.info(f"Promote SQL written to {promote_path}")


if __name__ == '__main__':
    main()
