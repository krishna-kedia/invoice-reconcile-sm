"""File discovery logic for Google Drive"""

from typing import List, Dict, Any
from datetime import datetime
from dateutil import parser as date_parser

from database.client import DatabaseClient
from database.models import FileStatus, OperationType, LogStatus
from drive.client import DriveClient


class FileDiscovery:
    """Handles discovery of new files from Google Drive"""
    
    def __init__(self, drive_client: DriveClient, db_client: DatabaseClient):
        """Initialize file discovery.
        
        Args:
            drive_client: Google Drive API client
            db_client: Database client
        """
        self.drive_client = drive_client
        self.db_client = db_client
    
    def discover_files(self, document_type: str, drive_folder_id: str, 
                      file_types: List[str]) -> List[str]:
        """Discover new files in a Google Drive folder and register them.
        
        Args:
            document_type: Document type name from config
            drive_folder_id: Google Drive folder ID
            file_types: List of allowed file extensions
        
        Returns:
            List of newly discovered file IDs (database UUIDs)
        """
        try:
            # Log discovery start
            self.db_client.insert_log(
                operation=OperationType.DISCOVERY,
                status=LogStatus.SUCCESS,
                details={
                    'document_type': document_type,
                    'folder_id': drive_folder_id,
                    'file_types': file_types
                }
            )
            
            # List files in Drive folder
            drive_files = self.drive_client.list_files_in_folder(
                drive_folder_id,
                file_types=file_types
            )
            
            new_file_ids = []
            
            for drive_file in drive_files:
                drive_file_id = drive_file['id']
                
                # Check if file already exists in database
                existing_file = self.db_client.get_file_by_drive_id(drive_file_id)
                
                if existing_file:
                    # File already registered, skip
                    continue
                
                # Extract file extension from name
                file_name = drive_file['name']
                file_type = self._extract_file_type(file_name, drive_file.get('mimeType', ''))
                
                # Parse timestamps
                drive_created_at = None
                drive_modified_at = None
                
                if drive_file.get('createdTime'):
                    drive_created_at = date_parser.parse(drive_file['createdTime'])
                if drive_file.get('modifiedTime'):
                    drive_modified_at = date_parser.parse(drive_file['modifiedTime'])
                
                # Create file record
                file_data = {
                    'drive_file_id': drive_file_id,
                    'drive_folder_id': drive_folder_id,
                    'document_type': document_type,
                    'file_name': file_name,
                    'file_type': file_type,
                    'file_size': int(drive_file.get('size', 0)) if drive_file.get('size') else None,
                    'drive_created_at': drive_created_at.isoformat() if drive_created_at else None,
                    'drive_modified_at': drive_modified_at.isoformat() if drive_modified_at else None,
                    'status': FileStatus.PENDING.value,
                    'ocr_retry_count': 0
                }
                
                file_record = self.db_client.insert_file(file_data)
                new_file_ids.append(file_record.id)
                
                # Log file discovery
                self.db_client.insert_log(
                    operation=OperationType.DISCOVERY,
                    status=LogStatus.SUCCESS,
                    file_id=file_record.id,
                    details={
                        'drive_file_id': drive_file_id,
                        'file_name': file_name,
                        'file_type': file_type
                    }
                )
            
            return new_file_ids
        
        except Exception as e:
            # Log discovery error
            self.db_client.insert_log(
                operation=OperationType.DISCOVERY,
                status=LogStatus.FAILURE,
                details={
                    'document_type': document_type,
                    'folder_id': drive_folder_id,
                    'error': str(e)
                }
            )
            raise
    
    def _extract_file_type(self, file_name: str, mime_type: str) -> str:
        """Extract file type (extension) from file name or MIME type.
        
        Args:
            file_name: File name
            mime_type: MIME type
        
        Returns:
            File extension (lowercase, without dot)
        """
        # Try to get from file name first
        if '.' in file_name:
            extension = file_name.rsplit('.', 1)[1].lower()
            return extension
        
        # Fallback to MIME type mapping
        mime_to_ext = {
            'application/pdf': 'pdf',
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/heic': 'heic',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
            'application/vnd.ms-excel': 'xls',
            'text/csv': 'csv'
        }
        
        return mime_to_ext.get(mime_type, 'unknown')
