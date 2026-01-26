"""PDF password decryption service"""

import io
from typing import Optional
from pypdf import PdfReader, PdfWriter


def is_password_protected(pdf_bytes: bytes) -> bool:
    """Check if a PDF is password-protected.
    
    Args:
        pdf_bytes: PDF file content as bytes
    
    Returns:
        True if PDF is password-protected, False otherwise
    """
    try:
        pdf_stream = io.BytesIO(pdf_bytes)
        reader = PdfReader(pdf_stream)
        return reader.is_encrypted
    except Exception:
        # If we can't read it, assume it might be encrypted
        return True


def decrypt_pdf(pdf_bytes: bytes, password: str) -> bytes:
    """Decrypt a password-protected PDF.
    
    Args:
        pdf_bytes: Encrypted PDF file content as bytes
        password: Password to decrypt the PDF
    
    Returns:
        Decrypted PDF file content as bytes
    
    Raises:
        ValueError: If password is incorrect or decryption fails
    """
    try:
        pdf_stream = io.BytesIO(pdf_bytes)
        reader = PdfReader(pdf_stream)
        
        # Check if PDF is encrypted
        if not reader.is_encrypted:
            # PDF is not encrypted, return original bytes
            return pdf_bytes
        
        # Try to decrypt with password
        if not reader.decrypt(password):
            raise ValueError("Incorrect password or decryption failed")
        
        # Create a new PDF writer and copy all pages
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        
        # Write decrypted PDF to bytes
        output_stream = io.BytesIO()
        writer.write(output_stream)
        output_stream.seek(0)
        
        return output_stream.read()
    
    except ValueError:
        # Re-raise ValueError (incorrect password)
        raise
    except Exception as e:
        # Wrap other exceptions
        raise ValueError(f"PDF decryption failed: {str(e)}")
