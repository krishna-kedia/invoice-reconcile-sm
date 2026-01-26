"""OCR processor using OpenAI Vision API"""

import base64
import io
import tempfile
from typing import Dict, Any, Optional
from pathlib import Path

from pdf2image import convert_from_bytes
from PIL import Image
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass  # pillow-heif not available, HEIC files will fail

from openai import OpenAI

from .base import BaseProcessor


class OCRProcessor(BaseProcessor):
    """OCR processor using OpenAI Vision API for images and PDFs"""
    
    SUPPORTED_TYPES = ['pdf', 'jpg', 'jpeg', 'png', 'heic']
    
    def __init__(self, api_key: str, model: str = "gpt-4-vision-preview", 
                 max_tokens: int = 4096):
        """Initialize OCR processor.
        
        Args:
            api_key: OpenAI API key
            model: Model to use (e.g., 'gpt-4-vision-preview', 'gpt-4o')
            max_tokens: Maximum tokens for response
        """
        self.client = OpenAI(api_key=api_key)
        self.model = model
        self.max_tokens = max_tokens
    
    def supports(self, file_type: str) -> bool:
        """Check if this processor supports the file type."""
        return file_type.lower() in self.SUPPORTED_TYPES
    
    def process(self, file_content: bytes, file_type: str,
               metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Process file using OpenAI Vision API.
        
        Args:
            file_content: File content as bytes
            file_type: File extension
            metadata: Optional file metadata
        
        Returns:
            Dictionary with 'raw_text' and 'metadata' keys
        """
        file_type_lower = file_type.lower()
        
        # Convert PDF to images
        if file_type_lower == 'pdf':
            images = convert_from_bytes(file_content)
            if not images:
                raise ValueError("Failed to convert PDF to images")
            
            # Process first page (or combine multiple pages)
            # For now, process first page only
            image = images[0]
            image_bytes = self._image_to_bytes(image)
        else:
            # Handle image files
            image = Image.open(io.BytesIO(file_content))
            
            # Convert HEIC if needed
            if file_type_lower == 'heic':
                # Convert to RGB if needed
                if image.mode != 'RGB':
                    image = image.convert('RGB')
            
            image_bytes = self._image_to_bytes(image)
        
        # Encode image to base64
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
        
        # Call OpenAI Vision API
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "Extract all text from this image. Return the text exactly as it appears, preserving formatting and structure."
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{base64_image}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=self.max_tokens
            )
            
            raw_text = response.choices[0].message.content or ""
            
            # Extract metadata
            ocr_metadata = {
                'model': self.model,
                'usage': {
                    'prompt_tokens': response.usage.prompt_tokens if response.usage else None,
                    'completion_tokens': response.usage.completion_tokens if response.usage else None,
                    'total_tokens': response.usage.total_tokens if response.usage else None
                },
                'file_type': file_type,
                'processing_method': 'openai_vision'
            }
            
            return {
                'raw_text': raw_text,
                'metadata': ocr_metadata
            }
        
        except Exception as e:
            raise Exception(f"OpenAI Vision API error: {str(e)}")
    
    def _image_to_bytes(self, image: Image.Image, format: str = 'JPEG') -> bytes:
        """Convert PIL Image to bytes.
        
        Args:
            image: PIL Image object
            format: Output format (JPEG, PNG, etc.)
        
        Returns:
            Image bytes
        """
        buffer = io.BytesIO()
        image.save(buffer, format=format)
        buffer.seek(0)
        return buffer.read()
