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
import logging

from .base import BaseProcessor
from utils.pdf_decryptor import decrypt_pdf, is_password_protected


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
               metadata: Optional[Dict[str, Any]] = None,
               password: Optional[str] = None) -> Dict[str, Any]:
        """Process file using OpenAI Vision API.
        
        Args:
            file_content: File content as bytes
            file_type: File extension
            metadata: Optional file metadata
            password: Optional password for password-protected PDFs
        
        Returns:
            Dictionary with 'raw_text' and 'metadata' keys
        """
        file_type_lower = file_type.lower()
        logger = logging.getLogger('invoice_reconcile')
        
        # Handle PDF decryption if password is provided
        if file_type_lower == 'pdf' and password:
            # #region agent log
            with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                import json
                f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H3","location":"ocr_processor.py:64","message":"Password received in process","data":{"has_password":password is not None,"password_length":len(password) if password else 0},"timestamp":int(__import__('time').time()*1000)}) + '\n')
            # #endregion
            try:
                # Check if PDF is password-protected
                is_protected = is_password_protected(file_content)
                # #region agent log
                with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                    import json
                    f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H1","location":"ocr_processor.py:67","message":"PDF password protection check","data":{"is_protected":is_protected},"timestamp":int(__import__('time').time()*1000)}) + '\n')
                # #endregion
                if is_protected:
                    logger.info("PDF is password-protected, attempting decryption...")
                    original_size = len(file_content)
                    file_content = decrypt_pdf(file_content, password)
                    decrypted_size = len(file_content)
                    # #region agent log
                    with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                        import json
                        f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H2","location":"ocr_processor.py:69","message":"PDF decryption result","data":{"original_size":original_size,"decrypted_size":decrypted_size,"sizes_match":original_size==decrypted_size},"timestamp":int(__import__('time').time()*1000)}) + '\n')
                    # #endregion
                    logger.info("PDF decryption succeeded")
                else:
                    logger.info("PDF is not password-protected, proceeding without decryption")
            except ValueError as e:
                # Decryption failed (wrong password)
                # #region agent log
                with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                    import json
                    f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H2","location":"ocr_processor.py:74","message":"PDF decryption ValueError","data":{"error":str(e)},"timestamp":int(__import__('time').time()*1000)}) + '\n')
                # #endregion
                logger.warning(f"PDF decryption failed: {str(e)}. Attempting to process original PDF...")
                # Continue with original bytes - may fail at pdf2image stage
            except Exception as e:
                # Other decryption errors
                # #region agent log
                with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                    import json
                    f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H2","location":"ocr_processor.py:78","message":"PDF decryption Exception","data":{"error":str(e)},"timestamp":int(__import__('time').time()*1000)}) + '\n')
                # #endregion
                logger.warning(f"PDF decryption error: {str(e)}. Attempting to process original PDF...")
                # Continue with original bytes
        
        # Convert PDF to images
        if file_type_lower == 'pdf':
            # #region agent log
            with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                import json
                f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H4","location":"ocr_processor.py:84","message":"Before convert_from_bytes","data":{"file_content_size":len(file_content)},"timestamp":int(__import__('time').time()*1000)}) + '\n')
            # #endregion
            try:
                images = convert_from_bytes(file_content)
                # #region agent log
                with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                    import json
                    f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H4","location":"ocr_processor.py:84","message":"After convert_from_bytes","data":{"num_images":len(images) if images else 0},"timestamp":int(__import__('time').time()*1000)}) + '\n')
                # #endregion
            except Exception as e:
                # #region agent log
                with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                    import json
                    f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H4","location":"ocr_processor.py:84","message":"convert_from_bytes failed","data":{"error":str(e)},"timestamp":int(__import__('time').time()*1000)}) + '\n')
                # #endregion
                raise
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
