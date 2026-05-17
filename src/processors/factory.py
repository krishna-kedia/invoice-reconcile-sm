"""Processor factory to route files to appropriate processor"""

from typing import Optional
from .base import BaseProcessor
from .ocr_processor import OCRProcessor
from .excel_processor import ExcelProcessor
from .json_processor import JsonProcessor


class ProcessorFactory:
    """Factory for creating appropriate processors based on file type"""

    def __init__(self, openai_api_key: str, openai_model: str = "gpt-4-vision-preview",
                 openai_max_tokens: int = 4096):
        """Initialize processor factory.

        Args:
            openai_api_key: OpenAI API key for OCR processor
            openai_model: OpenAI model name
            openai_max_tokens: Maximum tokens for OpenAI API
        """
        self.ocr_processor = OCRProcessor(openai_api_key, openai_model, openai_max_tokens)
        self.excel_processor = ExcelProcessor()
        self.json_processor = JsonProcessor()

    def get_processor(self, file_type: str) -> Optional[BaseProcessor]:
        """Get appropriate processor for file type.

        Args:
            file_type: File extension (e.g., 'pdf', 'xlsx', 'json')

        Returns:
            BaseProcessor instance or None if no processor supports the file type
        """
        file_type_lower = file_type.lower()

        # Try JSON processor (for structured JSON files)
        if self.json_processor.supports(file_type_lower):
            return self.json_processor

        # Try Excel processor (for Excel/CSV files)
        if self.excel_processor.supports(file_type_lower):
            return self.excel_processor

        # Try OCR processor (for images and PDFs)
        if self.ocr_processor.supports(file_type_lower):
            return self.ocr_processor

        return None

    def can_process(self, file_type: str) -> bool:
        """Check if any processor can handle the file type.

        Args:
            file_type: File extension

        Returns:
            True if a processor supports the file type
        """
        return self.get_processor(file_type) is not None
