"""Supabase database client wrapper"""

from typing import List, Optional, Dict, Any
from datetime import datetime
from supabase import create_client, Client

from .models import (
    FileRecord, FileStatus, OCROutput, Extraction, 
    ProcessingLog, OperationType, LogStatus
)


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
                         extraction_metadata: Optional[Dict[str, Any]] = None) -> Extraction:
        """Insert structured extraction record.
        
        Args:
            file_id: File UUID
            document_type: Document type name
            extracted_fields: Extracted field values
            extraction_metadata: Optional metadata (prompt, model, etc.)
            
        Returns:
            Extraction instance
        """
        data = {
            'file_id': file_id,
            'document_type': document_type,
            'extracted_fields': extracted_fields,
            'extraction_metadata': extraction_metadata
        }
        result = self.client.table('extractions').insert(data).execute()
        if not result.data:
            raise ValueError("Failed to insert extraction")
        return Extraction.from_dict(result.data[0])
    
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
