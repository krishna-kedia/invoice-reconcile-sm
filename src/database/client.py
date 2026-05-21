"""Supabase database client wrapper"""

from typing import List, Optional, Dict, Any
from datetime import datetime
import pandas as pd
from supabase import create_client, Client

from .models import (
    FileRecord, FileStatus, OCROutput, Extraction, 
    ProcessingLog, OperationType, LogStatus
)
from .table_manager import sanitize_table_name, get_column_name
from .excel_inserter import ExcelDirectInserter
from .mmt_payout_inserter import MmtPayoutInserter
from .yatra_payout_inserter import YatraPayoutInserter
from .agoda_payout_inserter import AgodaPayoutInserter


class DatabaseClient:
    """Wrapper for Supabase database operations"""
    
    def __init__(self, supabase_url: str, supabase_key: str):
        """Initialize Supabase client.
        
        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key (for backend operations)
        """
        self.client: Client = create_client(
            supabase_url,
            supabase_key
        )
    
    # File operations
    def insert_file(self, file_data: Dict[str, Any]) -> FileRecord:
        """Insert a new file record.
        
        Args:
            file_data: Dictionary with file fields (drive_file_id, drive_folder_id, etc.)
            
        Returns:
            FileRecord instance
        """
        result = self.client.table('files').insert(file_data).execute()
        if not result.data:
            raise ValueError("Failed to insert file")
        return FileRecord.from_dict(result.data[0])
    
    def get_file_by_drive_id(self, drive_file_id: str) -> Optional[FileRecord]:
        """Get file by Google Drive file ID.
        
        Args:
            drive_file_id: Google Drive file ID
            
        Returns:
            FileRecord or None if not found
        """
        result = self.client.table('files').select('*').eq('drive_file_id', drive_file_id).execute()
        if result.data:
            return FileRecord.from_dict(result.data[0])
        return None
    
    def get_pending_files(self, max_retries: int) -> List[FileRecord]:
        """Get files that need processing (pending or failed with retries available).
        
        Args:
            max_retries: Maximum number of retries allowed
            
        Returns:
            List of FileRecord instances
        """
        # Get pending files
        pending = self.client.table('files').select('*').eq('status', FileStatus.PENDING.value).execute()
        
        # Get failed files with retry_count < max_retries
        failed = self.client.table('files').select('*').eq('status', FileStatus.FAILED.value).lt('ocr_retry_count', max_retries).execute()
        
        files = []
        if pending.data:
            files.extend([FileRecord.from_dict(row) for row in pending.data])
        if failed.data:
            files.extend([FileRecord.from_dict(row) for row in failed.data])
        
        return files
    
    def update_file_status(self, file_id: str, status: FileStatus, 
                          error_message: Optional[str] = None,
                          increment_retry: bool = False) -> None:
        """Update file status and optionally error message.
        
        Args:
            file_id: File UUID
            status: New status
            error_message: Optional error message
            increment_retry: If True, increment ocr_retry_count
        """
        update_data: Dict[str, Any] = {'status': status.value}
        
        if error_message is not None:
            update_data['error_message'] = error_message
        
        if increment_retry:
            # Get current retry count and increment
            current = self.client.table('files').select('ocr_retry_count').eq('id', file_id).execute()
            if current.data:
                update_data['ocr_retry_count'] = current.data[0]['ocr_retry_count'] + 1
        
        self.client.table('files').update(update_data).eq('id', file_id).execute()
    
    # OCR output operations
    def insert_ocr_output(self, file_id: str, raw_text: str, 
                         ocr_metadata: Optional[Dict[str, Any]] = None) -> OCROutput:
        """Insert OCR output record.
        
        Args:
            file_id: File UUID
            raw_text: Raw OCR text
            ocr_metadata: Optional metadata (model, confidence, etc.)
            
        Returns:
            OCROutput instance
        """
        data = {
            'file_id': file_id,
            'raw_text': raw_text,
            'ocr_metadata': ocr_metadata
        }
        result = self.client.table('ocr_outputs').insert(data).execute()
        if not result.data:
            raise ValueError("Failed to insert OCR output")
        return OCROutput.from_dict(result.data[0])
    
    def get_ocr_output(self, file_id: str) -> Optional[OCROutput]:
        """Get OCR output for a file.
        
        Args:
            file_id: File UUID
            
        Returns:
            OCROutput or None if not found
        """
        result = self.client.table('ocr_outputs').select('*').eq('file_id', file_id).execute()
        if result.data:
            return OCROutput.from_dict(result.data[0])
        return None
    
    # Extraction operations
    def insert_extraction(self, file_id: str, document_type: str,
                         extracted_fields: Dict[str, Any],
                         extraction_metadata: Optional[Dict[str, Any]] = None,
                         fields_config: Optional[List[Dict[str, Any]]] = None,
                         main_table: Optional[str] = None) -> Extraction:
        """Insert structured extraction record.
        
        Inserts into both:
        1. extractions table (JSONB - for audit/history)
        2. document-specific table(s) (normalized columns, including child tables for arrays)
        
        Args:
            file_id: File UUID
            document_type: Document type name
            extracted_fields: Extracted field values
            extraction_metadata: Optional metadata (prompt, model, etc.)
            fields_config: Optional field definitions from config (needed for array fields)
            main_table: Optional custom main table name (defaults to document_type)
            
        Returns:
            Extraction instance
        """
        # Insert into extractions table (JSONB - for audit)
        data = {
            'file_id': file_id,
            'document_type': document_type,
            'extracted_fields': extracted_fields,
            'extraction_metadata': extraction_metadata
        }
        result = self.client.table('extractions').insert(data).execute()
        if not result.data:
            raise ValueError("Failed to insert extraction")
        extraction = Extraction.from_dict(result.data[0])
        
        # Also insert into document-specific normalized table(s)
        # This MUST succeed for the file to be marked as completed
        # If this fails, raise exception so file status is marked as failed
        try:
            self.insert_document_extraction(file_id, document_type, extracted_fields, fields_config, main_table)
        except Exception as e:
            # Log error and re-raise - file should be marked as failed
            import logging
            logger = logging.getLogger('invoice_reconcile')
            logger.error(
                f"Failed to insert into document-specific table for {document_type}: {str(e)}. "
                f"File will be marked as failed."
            )
            # Re-raise so caller can handle and mark file as failed
            raise ValueError(f"Failed to insert into document-specific table: {str(e)}") from e
        
        return extraction
    
    def get_extraction(self, file_id: str) -> Optional[Extraction]:
        """Get extraction for a file.
        
        Args:
            file_id: File UUID
            
        Returns:
            Extraction or None if not found
        """
        result = self.client.table('extractions').select('*').eq('file_id', file_id).execute()
        if result.data:
            return Extraction.from_dict(result.data[0])
        return None
    
    def insert_document_extraction(self, file_id: str, document_type: str,
                                  extracted_fields: Dict[str, Any],
                                  fields_config: Optional[List[Dict[str, Any]]] = None,
                                  main_table: Optional[str] = None) -> None:
        """Insert into document-specific normalized tables (main + child tables).
        
        Args:
            file_id: File UUID
            document_type: Document type name
            extracted_fields: Extracted field values (dict with field names as keys)
            fields_config: Optional field definitions from config (needed for array fields)
            main_table: Optional custom main table name (defaults to document_type)
        
        Raises:
            ValueError: If insertion fails
        """
        from .table_manager import get_array_fields
        
        # Use custom main_table if provided, otherwise use document_type
        main_table_name = sanitize_table_name(main_table) if main_table else sanitize_table_name(document_type)
        
        # Separate main fields from array fields
        main_data = {'file_id': file_id}
        array_data = {}
        
        # Get array field definitions if provided
        array_fields_config = get_array_fields(fields_config) if fields_config else []
        array_field_names = {af['name']: af for af in array_fields_config}
        
        for field_name, value in extracted_fields.items():
            if field_name in array_field_names:
                # This is an array field - store for child table insertion
                array_data[field_name] = value
            else:
                # Regular field - add to main table
                column_name = get_column_name(field_name)
                main_data[column_name] = value
        
        # Insert into main table first
        try:
            result = self.client.table(main_table_name).insert(main_data).execute()
            if not result.data:
                raise ValueError(f"Failed to insert into {main_table_name} table")
            
            main_record_id = result.data[0]['id']
            
            # Insert into child tables
            for array_field_name, array_value in array_data.items():
                if not isinstance(array_value, list):
                    continue  # Skip if not an array
                
                array_field_config = array_field_names[array_field_name]
                child_table_name = sanitize_table_name(array_field_config['child_table'])
                
                # Prepare child table records
                child_records = []
                for item in array_value:
                    if not isinstance(item, dict):
                        continue
                    
                    child_record = {f"{main_table_name}_id": main_record_id}
                    for child_field in array_field_config['child_fields']:
                        child_field_name = child_field['name']
                        child_column_name = get_column_name(child_field_name)
                        if child_field_name in item:
                            child_record[child_column_name] = item[child_field_name]
                    
                    child_records.append(child_record)
                
                # Bulk insert child records
                if child_records:
                    self.client.table(child_table_name).insert(child_records).execute()
        
        except Exception as e:
            # Re-raise with more context
            raise ValueError(f"Failed to insert into {main_table_name} table: {str(e)}")
    
    # Processing log operations
    def insert_log(self, operation: OperationType, status: LogStatus,
                  file_id: Optional[str] = None,
                  details: Optional[Dict[str, Any]] = None) -> ProcessingLog:
        """Insert a processing log entry.
        
        Args:
            operation: Operation type
            status: Success or failure
            file_id: Optional file UUID
            details: Optional details dictionary
            
        Returns:
            ProcessingLog instance
        """
        data = {
            'operation': operation.value,
            'status': status.value,
            'details': details
        }
        if file_id:
            data['file_id'] = file_id
        
        result = self.client.table('processing_logs').insert(data).execute()
        if not result.data:
            raise ValueError("Failed to insert log")
        return ProcessingLog.from_dict(result.data[0])
    
    def get_file_logs(self, file_id: str) -> List[ProcessingLog]:
        """Get all logs for a file.
        
        Args:
            file_id: File UUID
            
        Returns:
            List of ProcessingLog instances
        """
        result = self.client.table('processing_logs').select('*').eq('file_id', file_id).order('created_at').execute()
        if result.data:
            return [ProcessingLog.from_dict(row) for row in result.data]
        return []
    
    def insert_excel_rows_direct(
        self,
        file_id: str,
        document_type: str,
        df: pd.DataFrame,
        fields_config: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Insert Excel DataFrame rows directly into document-specific table.
        
        Args:
            file_id: File UUID
            document_type: Document type name
            df: DataFrame with normalized column names
            fields_config: Field definitions from config
        
        Returns:
            Dict with insertion results:
            {
                'success': bool,
                'rows_inserted': int,
                'rows_failed': int,
                'errors': List[Dict[str, Any]]
            }
        """
        inserter = ExcelDirectInserter(self)
        return inserter.insert_bank_statement_rows(
            file_id=file_id,
            df=df,
            document_type=document_type,
            fields_config=fields_config
        )

    def insert_mmt_payout_json(
        self,
        file_id: str,
        parsed_json: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert one parsed MMT-payout JSON file.

        Routes to MmtPayoutInserter; idempotent via ON CONFLICT DO NOTHING semantics.

        Args:
            file_id: File UUID.
            parsed_json: The JSON object as parsed by JsonProcessor.

        Returns:
            Dict from MmtPayoutInserter.insert_payout_json describing what was
            inserted/skipped.
        """
        inserter = MmtPayoutInserter(self)
        return inserter.insert_payout_json(file_id=file_id, parsed_json=parsed_json)

    def insert_yatra_payout_json(
        self,
        file_id: str,
        parsed_json: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert one parsed Yatra-payout JSON file.

        Routes to YatraPayoutInserter. Idempotent: if voucher_no already exists
        the row is skipped rather than overwritten.

        Args:
            file_id: File UUID.
            parsed_json: The JSON object as parsed by JsonProcessor.

        Returns:
            Dict from YatraPayoutInserter.insert_payout_json with keys:
              success, inserted, skipped, voucher_no, errors.
        """
        inserter = YatraPayoutInserter(self)
        return inserter.insert_payout_json(file_id=file_id, parsed_json=parsed_json)

    def insert_agoda_payout_json(
        self,
        file_id: str,
        parsed_json: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert one parsed Agoda-payout JSON file.

        Routes to AgodaPayoutInserter. Idempotent: if booking_id already exists
        the row is skipped rather than overwritten.

        Returns:
            Dict with keys: success, inserted, skipped, booking_id, errors.
        """
        inserter = AgodaPayoutInserter(self)
        return inserter.insert_payout_json(file_id=file_id, parsed_json=parsed_json)
