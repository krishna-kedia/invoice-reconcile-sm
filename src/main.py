"""Main entry point for invoice reconcile backend system"""

import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Add src directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from config.loader import Config
from database.client import DatabaseClient, DuplicateInvoiceError
from database.models import FileStatus, OperationType, LogStatus
from database.table_manager import ensure_all_tables_exist
from drive.client import DriveClient
from drive.discovery import FileDiscovery
from processors.factory import ProcessorFactory
from extractors.structured_extractor import StructuredExtractor
from utils.logging import setup_logging

# Setup logging
logger = setup_logging()


class InvoiceReconcileSystem:
    """Main orchestration class for the invoice reconcile system"""
    
    def __init__(self, config_path: str = None):
        """Initialize the system.
        
        Args:
            config_path: Optional path to config.yaml
        """
        # Load configuration
        self.config = Config(config_path)
        logger.info("Configuration loaded successfully")
        
        # Initialize clients
        connections = self.config.connections
        
        self.db_client = DatabaseClient(
            supabase_url=connections['supabase']['url'],
            supabase_key=connections['supabase']['key']
        )
        logger.info("Database client initialized")
        
        self.drive_client = DriveClient(
            service_account_path=connections['google_drive']['service_account_path']
        )
        logger.info("Google Drive client initialized")
        
        # Initialize processors
        openai_config = connections['openai']
        self.processor_factory = ProcessorFactory(
            openai_api_key=openai_config['api_key'],
            openai_model=openai_config['model'],
            openai_max_tokens=openai_config['max_tokens']
        )
        
        self.extractor = StructuredExtractor(
            api_key=openai_config['api_key'],
            model=openai_config['model'],
            max_tokens=openai_config['max_tokens']
        )
        logger.info("Processors and extractors initialized")
        
        # Initialize discovery
        self.discovery = FileDiscovery(self.drive_client, self.db_client)
        
        # Ensure all document type tables exist
        logger.info("Checking document type tables...")
        ensure_all_tables_exist(self.config, self.db_client)
        logger.info("Document type tables verified")
    
    def run_discovery(self) -> None:
        """Run file discovery for all configured document types."""
        logger.info("Starting file discovery phase")
        
        for doc_type_config in self.config.document_types:
            document_type = doc_type_config['document_type']
            drive_folder_id = doc_type_config['drive_folder_id']
            file_types = doc_type_config['file_types']
            
            logger.info(f"Discovering files for document type: {document_type}")
            
            try:
                new_file_ids = self.discovery.discover_files(
                    document_type=document_type,
                    drive_folder_id=drive_folder_id,
                    file_types=file_types
                )
                
                logger.info(f"Discovered {len(new_file_ids)} new files for {document_type}")
            
            except Exception as e:
                logger.error(f"Error during discovery for {document_type}: {str(e)}", exc_info=True)
    
    def process_file(self, file_record, db_client=None, drive_client=None) -> None:
        """Process a single file through the pipeline.

        Args:
            file_record: FileRecord instance
            db_client: Optional DatabaseClient; uses self.db_client if not provided.
            drive_client: Optional DriveClient; uses self.drive_client if not provided.
                          Pass per-thread instances when calling from parallel workers —
                          both httplib2 (Drive) and supabase-py are not thread-safe when shared.
        """
        db = db_client if db_client is not None else self.db_client
        drive = drive_client if drive_client is not None else self.drive_client
        file_id = file_record.id
        file_name = file_record.file_name
        file_type = file_record.file_type
        document_type = file_record.document_type

        logger.info(f"Processing file: {file_name} (ID: {file_id})")

        try:
            # Update status to processing
            db.update_file_status(file_id, FileStatus.PROCESSING)

            # Log download start
            db.insert_log(
                operation=OperationType.DOWNLOAD,
                status=LogStatus.SUCCESS,
                file_id=file_id,
                details={'file_name': file_name}
            )

            # Download file from Drive
            file_content = drive.download_file(file_record.drive_file_id)
            logger.info(f"Downloaded file: {file_name} ({len(file_content)} bytes)")

            # Get appropriate processor
            processor = self.processor_factory.get_processor(file_type)
            if not processor:
                raise ValueError(f"No processor available for file type: {file_type}")

            # Get document type config for password / vision flags (if PDF)
            pdf_password = None
            force_vision = False
            if file_type.lower() == 'pdf':
                doc_type_config_early = self.config.get_document_type(document_type)
                if doc_type_config_early:
                    pdf_password = doc_type_config_early.get('pdf_password')
                    force_vision = bool(doc_type_config_early.get('use_vision', False))

            # Process file (OCR or direct parse)
            logger.info(f"Processing file with {processor.__class__.__name__}")
            db.insert_log(
                operation=OperationType.OCR,
                status=LogStatus.SUCCESS,
                file_id=file_id,
                details={'processor': processor.__class__.__name__}
            )

            # Only OCRProcessor supports password / force_vision parameters
            if file_type.lower() == 'pdf':
                process_result = processor.process(
                    file_content, file_type,
                    password=pdf_password,
                    force_vision=force_vision,
                )
            else:
                process_result = processor.process(file_content, file_type)
            raw_text = process_result['raw_text']
            ocr_metadata = process_result.get('metadata', {})

            logger.info(f"Extracted {len(raw_text)} characters from {file_name}")

            # Store OCR output
            db.insert_ocr_output(
                file_id=file_id,
                raw_text=raw_text,
                ocr_metadata=ocr_metadata
            )

            # Get document type config for extraction
            doc_type_config = self.config.get_document_type(document_type)
            if not doc_type_config:
                raise ValueError(f"Document type config not found: {document_type}")

            # Check if Excel file with direct insertion enabled
            excel_direct_insert = doc_type_config.get('excel_direct_insert', False)
            # Check if JSON file with direct insertion enabled
            json_direct_insert = doc_type_config.get('json_direct_insert', False)

            if file_type.lower() == 'json' and json_direct_insert:
                # Direct JSON insertion path (skip LLM)
                logger.info(f"Processing JSON file with direct insertion for {file_name}")

                parsed_json = process_result.get('parsed_json')
                if parsed_json is None:
                    raise ValueError("JSON processor did not return parsed_json")

                # Route to the correct inserter based on document_type.
                if document_type == 'yatra_payout':
                    result = db.insert_yatra_payout_json(
                        file_id=file_id,
                        parsed_json=parsed_json
                    )
                    log_details = {
                        'document_type': document_type,
                        'processing_method': 'json_direct_insert',
                        'inserted': result.get('inserted'),
                        'skipped': result.get('skipped'),
                        'voucher_no': result.get('voucher_no'),
                        'errors': result.get('errors', []),
                    }
                    success_msg = (
                        f"Successfully processed Yatra JSON file: {file_name} "
                        f"(voucher_no={result.get('voucher_no')}, "
                        f"{'inserted' if result.get('inserted') else 'skipped/already existed'})"
                    )
                    failure_prefix = "Failed to insert Yatra payout JSON"
                elif document_type == 'agoda_payout':
                    result = db.insert_agoda_payout_json(
                        file_id=file_id,
                        parsed_json=parsed_json
                    )
                    log_details = {
                        'document_type': document_type,
                        'processing_method': 'json_direct_insert',
                        'inserted': result.get('inserted'),
                        'skipped': result.get('skipped'),
                        'booking_id': result.get('booking_id'),
                        'errors': result.get('errors', []),
                    }
                    success_msg = (
                        f"Successfully processed Agoda JSON file: {file_name} "
                        f"(booking_id={result.get('booking_id')}, "
                        f"{'inserted' if result.get('inserted') else 'skipped/already existed'})"
                    )
                    failure_prefix = "Failed to insert Agoda payout JSON"
                else:
                    # Default to MMT payout inserter (document_type == 'mmt_payout')
                    result = db.insert_mmt_payout_json(
                        file_id=file_id,
                        parsed_json=parsed_json
                    )
                    log_details = {
                        'document_type': document_type,
                        'processing_method': 'json_direct_insert',
                        'payout_inserted': result.get('payout_inserted'),
                        'payout_existed': result.get('payout_existed'),
                        'bookings_inserted': result.get('bookings_inserted', 0),
                        'bookings_skipped': result.get('bookings_skipped', 0),
                        'transaction_no': result.get('transaction_no'),
                        'errors': result.get('errors', []),
                    }
                    success_msg = (
                        f"Successfully processed JSON file: {file_name} "
                        f"(payout {'inserted' if result.get('payout_inserted') else 'existed'}, "
                        f"{result.get('bookings_inserted', 0)} bookings inserted, "
                        f"{result.get('bookings_skipped', 0)} skipped)"
                    )
                    failure_prefix = "Failed to insert MMT payout JSON"

                db.insert_log(
                    operation=OperationType.EXTRACTION,
                    status=LogStatus.SUCCESS if result.get('success') else LogStatus.FAILURE,
                    file_id=file_id,
                    details=log_details
                )

                if result.get('success'):
                    db.update_file_status(file_id, FileStatus.COMPLETED)
                    logger.info(success_msg)
                else:
                    err = result.get('errors') or [{'error': 'Unknown JSON insert error'}]
                    raise ValueError(f"{failure_prefix}: {err[0].get('error')}")

            elif file_type.lower() in ['xlsx', 'xls', 'csv'] and excel_direct_insert:
                # Direct Excel insertion path (skip LLM)
                logger.info(f"Processing Excel file with direct insertion for {file_name}")

                df = processor.extract_data_between_delimiters(file_content, file_type)
                df = processor.normalize_column_names(df)

                logger.info(f"Extracted {len(df)} rows from Excel file")

                db.insert_ocr_output(
                    file_id=file_id,
                    raw_text=f"Excel file with {len(df)} rows",
                    ocr_metadata={
                        'num_rows': len(df),
                        'num_columns': len(df.columns),
                        'column_names': df.columns.tolist(),
                        'processing_method': 'excel_direct_insert'
                    }
                )

                result = db.insert_excel_rows_direct(
                    file_id=file_id,
                    document_type=document_type,
                    df=df,
                    fields_config=doc_type_config['fields']
                )

                db.insert_log(
                    operation=OperationType.EXTRACTION,
                    status=LogStatus.SUCCESS if result['success'] else LogStatus.FAILURE,
                    file_id=file_id,
                    details={
                        'document_type': document_type,
                        'processing_method': 'excel_direct_insert',
                        'rows_inserted': result.get('rows_inserted', 0),
                        'rows_failed': result.get('rows_failed', 0)
                    }
                )

                if result['success']:
                    if result.get('rows_failed', 0) > 0:
                        logger.warning(
                            f"Inserted {result['rows_inserted']} rows, "
                            f"{result['rows_failed']} rows failed: {result.get('errors', [])}"
                        )
                    db.update_file_status(file_id, FileStatus.COMPLETED)
                    logger.info(f"Successfully processed file: {file_name} ({result['rows_inserted']} rows inserted)")
                else:
                    error_msg = result.get('errors', [{}])[0].get('error', 'Unknown error') if result.get('errors') else 'Insertion failed'
                    raise ValueError(f"Failed to insert Excel rows: {error_msg}")
            else:
                # LLM extraction path
                logger.info(f"Extracting structured fields for {file_name}")
                db.insert_log(
                    operation=OperationType.EXTRACTION,
                    status=LogStatus.SUCCESS,
                    file_id=file_id,
                    details={'document_type': document_type}
                )

                extraction_result = self.extractor.extract(
                    raw_text=raw_text,
                    extraction_prompt=doc_type_config['extraction_prompt'],
                    fields=doc_type_config['fields']
                )

                extracted_fields = extraction_result['extracted_fields']
                extraction_metadata = extraction_result['metadata']

                logger.info(f"Extracted {len(extracted_fields)} fields from {file_name}")

                main_table = doc_type_config.get('main_table')
                db.insert_extraction(
                    file_id=file_id,
                    document_type=document_type,
                    extracted_fields=extracted_fields,
                    extraction_metadata=extraction_metadata,
                    fields_config=doc_type_config['fields'],
                    main_table=main_table
                )

                db.update_file_status(file_id, FileStatus.COMPLETED)
                logger.info(f"Successfully processed file: {file_name}")

        except DuplicateInvoiceError as dup_err:
            # A duplicate invoice_number UNIQUE violation was caught in the
            # inserter (DUP-2).  This is NOT a hard failure — another worker or
            # a previous pipeline run already inserted the same invoice.
            # Log structured, mark the file as FAILED with a clear message, and
            # do NOT re-raise so this worker continues processing other files.
            dup_msg = str(dup_err)
            logger.warning(
                "DUPLICATE_INVOICE_SKIPPED",
                extra={
                    "file_id": file_id,
                    "file_name": file_name,
                    "invoice_number": dup_err.invoice_number,
                    "constraint": "hotel_invoice_invoice_number_unique",
                }
            )

            try:
                db.insert_log(
                    operation=OperationType.ERROR,
                    status=LogStatus.FAILURE,
                    file_id=file_id,
                    details={
                        'error': dup_msg,
                        'file_name': file_name,
                        'duplicate_invoice_number': dup_err.invoice_number,
                    }
                )
            except Exception as log_error:
                logger.error(f"Failed to log duplicate-invoice event for {file_name}: {str(log_error)}")

            try:
                db.update_file_status(
                    file_id,
                    FileStatus.FAILED,
                    error_message=dup_msg,
                    increment_retry=False  # Do not retry — this is a data duplicate, not a transient error
                )
                logger.info(f"File {file_name} marked as FAILED (duplicate invoice skipped)")
            except Exception as status_error:
                logger.critical(
                    f"CRITICAL: Failed to update file status for duplicate-invoice {file_name}: {str(status_error)}"
                )
            # No re-raise — worker continues to the next file

        except Exception as e:
            error_message = str(e)
            logger.error(f"Error processing file {file_name}: {error_message}", exc_info=True)

            try:
                db.insert_log(
                    operation=OperationType.ERROR,
                    status=LogStatus.FAILURE,
                    file_id=file_id,
                    details={'error': error_message, 'file_name': file_name}
                )
            except Exception as log_error:
                logger.error(f"Failed to log error for file {file_name}: {str(log_error)}")

            try:
                max_retries = self.config.system['max_ocr_retries']
                increment_retry = file_record.ocr_retry_count < max_retries
                db.update_file_status(
                    file_id,
                    FileStatus.FAILED,
                    error_message=error_message,
                    increment_retry=increment_retry
                )
                logger.info(f"File {file_name} marked as FAILED due to error: {error_message}")
            except Exception as status_error:
                logger.critical(
                    f"CRITICAL: Failed to update file status to FAILED for {file_name}: {str(status_error)}. "
                    f"Original error: {error_message}"
                )

            raise
    
    def run_processing(self) -> None:
        """Run processing phase for pending files in parallel."""
        logger.info("Starting processing phase")

        max_retries = self.config.system['max_ocr_retries']
        max_workers = self.config.system.get('max_parallel_workers', 4)
        pending_files = self.db_client.get_pending_files(max_retries)

        logger.info(f"Found {len(pending_files)} files to process (max_workers={max_workers})")

        if not pending_files:
            return

        supabase_url = self.config.connections['supabase']['url']
        supabase_key = self.config.connections['supabase']['key']
        drive_sa_path = self.config.connections['google_drive']['service_account_path']

        def _worker(file_record):
            # Each thread gets its own clients — both supabase-py and httplib2 (Drive) are not
            # thread-safe when a single instance is shared across threads.
            thread_db = DatabaseClient(supabase_url=supabase_url, supabase_key=supabase_key)
            thread_drive = DriveClient(service_account_path=drive_sa_path)
            self.process_file(file_record, db_client=thread_db, drive_client=thread_drive)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_worker, f): f for f in pending_files}
            completed = 0
            for future in as_completed(futures):
                file_record = futures[future]
                completed += 1
                try:
                    future.result()
                    logger.info(f"[{completed}/{len(pending_files)}] Done: {file_record.file_name}")
                except Exception as e:
                    logger.error(f"[{completed}/{len(pending_files)}] Failed: {file_record.file_name} — {e}")
    
    def run(self) -> None:
        """Run the complete workflow: discovery + processing."""
        logger.info("=" * 60)
        logger.info("Starting Invoice Reconcile System")
        logger.info("=" * 60)
        
        try:
            # Phase 1: Discovery
            self.run_discovery()
            
            # Phase 2: Processing
            self.run_processing()
            
            logger.info("=" * 60)
            logger.info("Invoice Reconcile System completed successfully")
            logger.info("=" * 60)
        
        except Exception as e:
            logger.error(f"Fatal error in main workflow: {str(e)}", exc_info=True)
            sys.exit(1)


def main():
    """Main entry point."""
    # Allow config path to be passed as command line argument
    config_path = sys.argv[1] if len(sys.argv) > 1 else None
    
    system = InvoiceReconcileSystem(config_path)
    system.run()


if __name__ == "__main__":
    main()
