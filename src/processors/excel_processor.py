"""Excel/CSV processor using pandas and openpyxl"""

import io
from typing import Dict, Any, Optional
import pandas as pd
import openpyxl

from .base import BaseProcessor


class ExcelProcessor(BaseProcessor):
    """Processor for Excel and CSV files using direct parsing"""
    
    SUPPORTED_TYPES = ['xlsx', 'xls', 'csv']
    
    def supports(self, file_type: str) -> bool:
        """Check if this processor supports the file type."""
        return file_type.lower() in self.SUPPORTED_TYPES
    
    def process(self, file_content: bytes, file_type: str,
               metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Process Excel/CSV file and extract text content.
        
        Args:
            file_content: File content as bytes
            file_type: File extension
            metadata: Optional file metadata
        
        Returns:
            Dictionary with 'raw_text' and 'metadata' keys
        """
        file_type_lower = file_type.lower()
        
        try:
            if file_type_lower == 'csv':
                # Read CSV
                df = pd.read_csv(io.BytesIO(file_content))
            elif file_type_lower == 'xlsx':
                # Read XLSX
                df = pd.read_excel(io.BytesIO(file_content), engine='openpyxl')
            elif file_type_lower == 'xls':
                # Read XLS (older format)
                df = pd.read_excel(io.BytesIO(file_content), engine='xlrd')
            else:
                raise ValueError(f"Unsupported Excel file type: {file_type}")
            
            # Convert DataFrame to text representation
            # Include column names and all data
            text_parts = []
            
            # Add column names
            text_parts.append("Columns: " + ", ".join(df.columns.astype(str)))
            text_parts.append("\n")
            
            # Add data rows
            for idx, row in df.iterrows():
                row_text = " | ".join([f"{col}: {val}" for col, val in row.items()])
                text_parts.append(f"Row {idx + 1}: {row_text}")
            
            raw_text = "\n".join(text_parts)
            
            # Create metadata
            processing_metadata = {
                'file_type': file_type,
                'processing_method': 'pandas_direct_parse',
                'num_rows': len(df),
                'num_columns': len(df.columns),
                'column_names': df.columns.tolist(),
                'dataframe_shape': list(df.shape)
            }
            
            return {
                'raw_text': raw_text,
                'metadata': processing_metadata
            }
        
        except Exception as e:
            raise Exception(f"Error processing Excel/CSV file: {str(e)}")
