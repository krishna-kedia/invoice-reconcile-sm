"""Base processor interface"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional


class BaseProcessor(ABC):
    """Base class for document processors"""
    
    @abstractmethod
    def process(self, file_content: bytes, file_type: str, 
               metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Process a file and extract text/content.
        
        Args:
            file_content: File content as bytes
            file_type: File extension (e.g., 'pdf', 'jpg')
            metadata: Optional metadata about the file
        
        Returns:
            Dictionary with keys:
            - raw_text: Extracted text content
            - metadata: Processing metadata (model, confidence, etc.)
        """
        pass
    
    @abstractmethod
    def supports(self, file_type: str) -> bool:
        """Check if this processor supports the given file type.
        
        Args:
            file_type: File extension (lowercase)
        
        Returns:
            True if this processor can handle the file type
        """
        pass
