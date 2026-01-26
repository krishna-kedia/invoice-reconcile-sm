"""Main entry point for invoice reconcile backend system"""

import sys
from pathlib import Path

# Add src directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from config.loader import Config
from database.client import DatabaseClient
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
    
    def process_file(self, file_record) -> None:
        """Process a single file through the pipeline.
        
        Args:
            file_record: FileRecord instance
        """
        file_id = file_record.id
        file_name = file_record.file_name
        file_type = file_record.file_type
        document_type = file_record.document_type
        
        logger.info(f"Processing file: {file_name} (ID: {file_id})")
        
        try:
            # Update status to processing
            self.db_client.update_file_status(file_id, FileStatus.PROCESSING)
            
            # Log download start
            self.db_client.insert_log(
                operation=OperationType.DOWNLOAD,
                status=LogStatus.SUCCESS,
                file_id=file_id,
                details={'file_name': file_name}
            )
            
            # Download file from Drive
            file_content = self.drive_client.download_file(file_record.drive_file_id)
            logger.info(f"Downloaded file: {file_name} ({len(file_content)} bytes)")
            
            # Get appropriate processor
            processor = self.processor_factory.get_processor(file_type)
            if not processor:
                raise ValueError(f"No processor available for file type: {file_type}")
            
            # Get document type config for password (if PDF)
            pdf_password = None
            if file_type.lower() == 'pdf':
                doc_type_config = self.config.get_document_type(document_type)
                if doc_type_config:
                    pdf_password = doc_type_config.get('pdf_password')
                    # #region agent log
                    with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                        import json
                        f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H3","location":"main.py:135","message":"Password from config","data":{"document_type":document_type,"has_password":pdf_password is not None,"password_length":len(pdf_password) if pdf_password else 0},"timestamp":int(__import__('time').time()*1000)}) + '\n')
                    # #endregion
            
            # Process file (OCR or direct parse)
            logger.info(f"Processing file with {processor.__class__.__name__}")
            self.db_client.insert_log(
                operation=OperationType.OCR,
                status=LogStatus.SUCCESS,
                file_id=file_id,
                details={'processor': processor.__class__.__name__}
            )
            
            # Process with password if provided (for PDFs)
            # Only OCRProcessor supports password parameter
            if file_type.lower() == 'pdf' and pdf_password:
                process_result = processor.process(file_content, file_type, password=pdf_password)
            else:
                process_result = processor.process(file_content, file_type)
            raw_text = process_result['raw_text']
            ocr_metadata = process_result.get('metadata', {})
            
            logger.info(f"Extracted {len(raw_text)} characters from {file_name}")
            
            # Store OCR output
            self.db_client.insert_ocr_output(
                file_id=file_id,
                raw_text=raw_text,
                ocr_metadata=ocr_metadata
            )
            
            # Get document type config for extraction
            doc_type_config = self.config.get_document_type(document_type)
            if not doc_type_config:
                raise ValueError(f"Document type config not found: {document_type}")
            
            # Extract structured fields
            logger.info(f"Extracting structured fields for {file_name}")
            self.db_client.insert_log(
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
            
            # Store extraction (pass fields_config for array handling and main_table if specified)
            main_table = doc_type_config.get('main_table')  # Optional custom main table name
            self.db_client.insert_extraction(
                file_id=file_id,
                document_type=document_type,
                extracted_fields=extracted_fields,
                extraction_metadata=extraction_metadata,
                fields_config=doc_type_config['fields'],  # Pass fields config for nested arrays
                main_table=main_table  # Pass custom main table name if specified
            )
            
            # Update status to completed
            self.db_client.update_file_status(file_id, FileStatus.COMPLETED)
            logger.info(f"Successfully processed file: {file_name}")
        
        except Exception as e:
            error_message = str(e)
            logger.error(f"Error processing file {file_name}: {error_message}", exc_info=True)
            
            # Ensure file status is updated to FAILED, even if other operations fail
            try:
                # Log error
                self.db_client.insert_log(
                    operation=OperationType.ERROR,
                    status=LogStatus.FAILURE,
                    file_id=file_id,
                    details={'error': error_message, 'file_name': file_name}
                )
            except Exception as log_error:
                logger.error(f"Failed to log error for file {file_name}: {str(log_error)}")
            
            # Update file status to FAILED - this MUST succeed
            try:
                max_retries = self.config.system['max_ocr_retries']
                increment_retry = file_record.ocr_retry_count < max_retries
                
                self.db_client.update_file_status(
                    file_id,
                    FileStatus.FAILED,
                    error_message=error_message,
                    increment_retry=increment_retry
                )
                logger.info(f"File {file_name} marked as FAILED due to error: {error_message}")
            except Exception as status_error:
                # Critical: if status update fails, log it but don't raise
                # This ensures we don't leave files in PROCESSING state
                logger.critical(
                    f"CRITICAL: Failed to update file status to FAILED for {file_name}: {str(status_error)}. "
                    f"Original error: {error_message}"
                )
            
            # Re-raise to allow caller to handle
            raise
    
    def run_processing(self) -> None:
        """Run processing phase for pending files."""
        logger.info("Starting processing phase")
        
        max_retries = self.config.system['max_ocr_retries']
        pending_files = self.db_client.get_pending_files(max_retries)
        
        logger.info(f"Found {len(pending_files)} files to process")
        
        for file_record in pending_files:
            try:
                self.process_file(file_record)
            except Exception as e:
                # Error already logged in process_file
                logger.error(f"Failed to process file {file_record.file_name}: {str(e)}")
                continue
    
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
