"""Database models and data structures"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any
from enum import Enum


class FileStatus(str, Enum):
    """File processing status"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class OperationType(str, Enum):
    """Processing operation types"""
    DISCOVERY = "discovery"
    DOWNLOAD = "download"
    OCR = "ocr"
    EXTRACTION = "extraction"
    ERROR = "error"


class LogStatus(str, Enum):
    """Log entry status"""
    SUCCESS = "success"
    FAILURE = "failure"


@dataclass
class FileRecord:
    """Represents a file record in the database"""
    id: str
    drive_file_id: str
    drive_folder_id: str
    document_type: str
    file_name: str
    file_type: str
    file_size: Optional[int]
    drive_created_at: Optional[datetime]
    drive_modified_at: Optional[datetime]
    status: FileStatus
    ocr_retry_count: int
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'FileRecord':
        """Create FileRecord from database row dict"""
        return cls(
            id=str(data['id']),
            drive_file_id=data['drive_file_id'],
            drive_folder_id=data['drive_folder_id'],
            document_type=data['document_type'],
            file_name=data['file_name'],
            file_type=data['file_type'],
            file_size=data.get('file_size'),
            drive_created_at=data.get('drive_created_at'),
            drive_modified_at=data.get('drive_modified_at'),
            status=FileStatus(data['status']),
            ocr_retry_count=data.get('ocr_retry_count', 0),
            error_message=data.get('error_message'),
            created_at=data['created_at'],
            updated_at=data['updated_at']
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for database operations"""
        return {
            'id': self.id,
            'drive_file_id': self.drive_file_id,
            'drive_folder_id': self.drive_folder_id,
            'document_type': self.document_type,
            'file_name': self.file_name,
            'file_type': self.file_type,
            'file_size': self.file_size,
            'drive_created_at': self.drive_created_at.isoformat() if self.drive_created_at else None,
            'drive_modified_at': self.drive_modified_at.isoformat() if self.drive_modified_at else None,
            'status': self.status.value,
            'ocr_retry_count': self.ocr_retry_count,
            'error_message': self.error_message,
            'created_at': self.created_at.isoformat() if isinstance(self.created_at, datetime) else self.created_at,
            'updated_at': self.updated_at.isoformat() if isinstance(self.updated_at, datetime) else self.updated_at
        }


@dataclass
class OCROutput:
    """Represents an OCR output record"""
    id: str
    file_id: str
    raw_text: str
    ocr_metadata: Optional[Dict[str, Any]]
    created_at: datetime
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'OCROutput':
        """Create OCROutput from database row dict"""
        return cls(
            id=str(data['id']),
            file_id=str(data['file_id']),
            raw_text=data['raw_text'],
            ocr_metadata=data.get('ocr_metadata'),
            created_at=data['created_at']
        )


@dataclass
class Extraction:
    """Represents a structured extraction record"""
    id: str
    file_id: str
    document_type: str
    extracted_fields: Dict[str, Any]
    extraction_metadata: Optional[Dict[str, Any]]
    created_at: datetime
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Extraction':
        """Create Extraction from database row dict"""
        return cls(
            id=str(data['id']),
            file_id=str(data['file_id']),
            document_type=data['document_type'],
            extracted_fields=data['extracted_fields'],
            extraction_metadata=data.get('extraction_metadata'),
            created_at=data['created_at']
        )


@dataclass
class ProcessingLog:
    """Represents a processing log entry"""
    id: str
    file_id: Optional[str]
    operation: OperationType
    status: LogStatus
    details: Optional[Dict[str, Any]]
    created_at: datetime
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ProcessingLog':
        """Create ProcessingLog from database row dict"""
        return cls(
            id=str(data['id']),
            file_id=str(data['file_id']) if data.get('file_id') else None,
            operation=OperationType(data['operation']),
            status=LogStatus(data['status']),
            details=data.get('details'),
            created_at=data['created_at']
        )
