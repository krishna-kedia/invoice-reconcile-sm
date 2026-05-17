"""OCR processor using OpenAI Vision API"""

import base64
import io
import tempfile
from typing import Dict, Any, Optional
from pathlib import Path

from pdf2image import convert_from_bytes
from PIL import Image
from pypdf import PdfReader
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
        self.client = OpenAI(api_key=api_key)
        self.model = model
        self.max_tokens = max_tokens

    def supports(self, file_type: str) -> bool:
        return file_type.lower() in self.SUPPORTED_TYPES

    def process(self, file_content: bytes, file_type: str,
               metadata: Optional[Dict[str, Any]] = None,
               password: Optional[str] = None,
               force_vision: bool = False) -> Dict[str, Any]:
        file_type_lower = file_type.lower()
        logger = logging.getLogger('invoice_reconcile')

        # Handle PDF decryption if password is provided
        if file_type_lower == 'pdf' and password:
            try:
                is_protected = is_password_protected(file_content)
                if is_protected:
                    logger.info("PDF is password-protected, attempting decryption...")
                    file_content = decrypt_pdf(file_content, password)
                    logger.info("PDF decryption succeeded")
                else:
                    logger.info("PDF is not password-protected, proceeding without decryption")
            except ValueError as e:
                logger.warning(f"PDF decryption failed: {str(e)}. Attempting to process original PDF...")
            except Exception as e:
                logger.warning(f"PDF decryption error: {str(e)}. Attempting to process original PDF...")

        if file_type_lower == 'pdf':
            # Step 1: Try direct text extraction (fast path for digital PDFs like MMT invoices).
            # Skipped when force_vision=True (e.g. HDFC MPR where pypdf loses table structure).
            direct_text = self._extract_pdf_text(file_content)
            if not force_vision and len(direct_text.strip()) >= 300:
                logger.info(f"Direct PDF text extraction succeeded ({len(direct_text)} chars across all pages)")
                return {
                    'raw_text': direct_text,
                    'metadata': {
                        'model': 'pypdf_direct',
                        'processing_method': 'pypdf_direct',
                        'usage': {'prompt_tokens': None, 'completion_tokens': None, 'total_tokens': None},
                        'file_type': file_type,
                    }
                }

            # Step 2: Vision API fallback — process ALL pages (image-based / scanned PDFs).
            logger.info(f"Direct text extraction insufficient ({len(direct_text.strip())} chars), using Vision API on all pages")
            try:
                images = convert_from_bytes(file_content)
            except Exception as e:
                raise
            if not images:
                raise ValueError("Failed to convert PDF to images")

            all_text_parts = []
            total_prompt_tokens = 0
            total_completion_tokens = 0

            for page_num, page_image in enumerate(images):
                image_bytes = self._image_to_bytes(page_image)
                base64_image = base64.b64encode(image_bytes).decode('utf-8')
                try:
                    response = self.client.chat.completions.create(
                        model=self.model,
                        messages=[{
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "Extract all text from this image. Return the text exactly as it appears, preserving formatting and structure."
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                                }
                            ]
                        }],
                        max_tokens=self.max_tokens
                    )
                    page_text = response.choices[0].message.content or ""
                    if page_text.strip():
                        all_text_parts.append(f"--- Page {page_num + 1} ---\n{page_text.strip()}")
                    if response.usage:
                        total_prompt_tokens += response.usage.prompt_tokens or 0
                        total_completion_tokens += response.usage.completion_tokens or 0
                except Exception as e:
                    logger.warning(f"Vision API failed on page {page_num + 1}: {e}")

            raw_text = "\n\n".join(all_text_parts)
            ocr_metadata = {
                'model': self.model,
                'processing_method': 'vision_api_multipage',
                'num_pages': len(images),
                'usage': {
                    'prompt_tokens': total_prompt_tokens,
                    'completion_tokens': total_completion_tokens,
                    'total_tokens': total_prompt_tokens + total_completion_tokens,
                },
                'file_type': file_type,
            }
            return {'raw_text': raw_text, 'metadata': ocr_metadata}

        else:
            # Image files (jpg, jpeg, png, heic) — single Vision API call
            image = Image.open(io.BytesIO(file_content))
            if file_type_lower == 'heic' and image.mode != 'RGB':
                image = image.convert('RGB')
            image_bytes = self._image_to_bytes(image)

        # Encode image to base64
        base64_image = base64.b64encode(image_bytes).decode('utf-8')

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

    def _extract_pdf_text(self, file_content: bytes) -> str:
        """Extract text directly from a digital PDF using pypdf (all pages).
        Returns empty string if the PDF is image-based or extraction fails."""
        try:
            reader = PdfReader(io.BytesIO(file_content))
            parts = []
            for i, page in enumerate(reader.pages):
                text = page.extract_text() or ""
                if text.strip():
                    parts.append(f"--- Page {i + 1} ---\n{text.strip()}")
            return "\n\n".join(parts)
        except Exception:
            return ""

    def _image_to_bytes(self, image: Image.Image, format: str = 'JPEG') -> bytes:
        buffer = io.BytesIO()
        image.save(buffer, format=format)
        buffer.seek(0)
        return buffer.read()
