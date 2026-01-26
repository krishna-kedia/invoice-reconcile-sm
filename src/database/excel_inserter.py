"""Direct Excel to Database inserter for bank statements"""

import logging
from typing import Dict, Any, List, Optional
import pandas as pd

from .table_manager import sanitize_table_name, get_column_name
from utils.date_parser import parse_excel_date

logger = logging.getLogger('invoice_reconcile')


class ExcelDirectInserter:
    """Handle direct Excel → Database insertion for bank statements."""
    
    def __init__(self, db_client):
        """Initialize Excel direct inserter.
        
        Args:
            db_client: DatabaseClient instance
        """
        self.db_client = db_client
    
    def insert_bank_statement_rows(
        self,
        file_id: str,
        df: pd.DataFrame,
        document_type: str,
        fields_config: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Insert Excel rows directly into bank_statement table.
        
        Args:
            file_id: File UUID from files table
            df: DataFrame with normalized column names
            document_type: Document type name
            fields_config: Field definitions from config
        
        Returns:
            Dict with insertion results:
            {
                'success': bool,
                'rows_inserted': int,
                'rows_failed': int,
                'errors': List[Dict[str, Any]]
            }
        """
        table_name = sanitize_table_name(document_type)
        
        # Validate columns
        validation_result = self.validate_columns(df, fields_config)
        if not validation_result['valid']:
            return {
                'success': False,
                'rows_inserted': 0,
                'rows_failed': 0,
                'errors': [{'error': validation_result['error']}]
            }
        
        # Convert types and prepare rows
        rows_to_insert = []
        errors = []
        
        for idx, row in df.iterrows():
            try:
                row_data = self._prepare_row(row, file_id, fields_config, idx + 1)
                if row_data:
                    rows_to_insert.append(row_data)
            except Exception as e:
                errors.append({
                    'row_number': idx + 1,
                    'error': str(e)
                })
                logger.warning(f"Error preparing row {idx + 1}: {str(e)}")
        
        if not rows_to_insert:
            return {
                'success': False,
                'rows_inserted': 0,
                'rows_failed': len(df),
                'errors': errors if errors else [{'error': 'No valid rows to insert'}]
            }
        
        # Bulk insert
        try:
            result = self.db_client.client.table(table_name).insert(rows_to_insert).execute()
            
            rows_inserted = len(result.data) if result.data else 0
            
            return {
                'success': True,
                'rows_inserted': rows_inserted,
                'rows_failed': len(errors),
                'errors': errors
            }
        except Exception as e:
            logger.error(f"Error inserting rows into {table_name}: {str(e)}", exc_info=True)
            return {
                'success': False,
                'rows_inserted': 0,
                'rows_failed': len(rows_to_insert),
                'errors': [{'error': f'Database insertion failed: {str(e)}'}] + errors
            }
    
    def validate_columns(self, df: pd.DataFrame, fields_config: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validate that required columns exist in DataFrame.
        
        Args:
            df: DataFrame with normalized column names
            fields_config: Field definitions from config
        
        Returns:
            Dict with 'valid' (bool) and 'error' (str if invalid)
        """
        required_fields = [f['name'] for f in fields_config if f.get('required', False)]
        available_columns = set(df.columns.tolist())
        
        missing_columns = []
        for field_name in required_fields:
            column_name = get_column_name(field_name)
            if column_name not in available_columns:
                missing_columns.append(field_name)
        
        if missing_columns:
            return {
                'valid': False,
                'error': f"Missing required columns: {', '.join(missing_columns)}. "
                        f"Available columns: {', '.join(sorted(available_columns))}"
            }
        
        return {'valid': True}
    
    def _prepare_row(
        self,
        row: pd.Series,
        file_id: str,
        fields_config: List[Dict[str, Any]],
        row_number: int
    ) -> Optional[Dict[str, Any]]:
        """Prepare a single row for database insertion.
        
        Args:
            row: pandas Series representing a row
            file_id: File UUID
            fields_config: Field definitions from config
            row_number: Row number in Excel file
        
        Returns:
            Dict with column names and values, or None if row is invalid
        """
        row_data = {
            'file_id': file_id,
            'row_number': row_number
        }
        
        # Skip if row is completely empty
        if row.isna().all():
            return None
        
        # Process each field from config
        for field_config in fields_config:
            field_name = field_config['name']
            field_type = field_config['type']
            is_required = field_config.get('required', False)
            column_name = get_column_name(field_name)
            
            # Get value from DataFrame
            if column_name not in row.index:
                if is_required:
                    raise ValueError(f"Required field '{field_name}' (column '{column_name}') not found in row")
                continue
            
            value = row[column_name]
            
            # Convert value based on field type
            converted_value = self._convert_value(value, field_type, is_required)
            
            # Only add non-None values (or required fields)
            if converted_value is not None or is_required:
                row_data[column_name] = converted_value
        
        return row_data
    
    def _convert_value(self, value: Any, field_type: str, is_required: bool) -> Any:
        """Convert value to appropriate type for database.
        
        Args:
            value: Value from Excel cell
            field_type: Field type (string, number, date)
            is_required: Whether field is required
        
        Returns:
            Converted value or None if conversion fails and field is not required
        """
        # Handle None/NaN
        if value is None or pd.isna(value):
            if is_required:
                raise ValueError(f"Required field has null value")
            return None
        
        # Convert based on type
        if field_type == 'date':
            date_value = parse_excel_date(value)
            if date_value is None:
                if is_required:
                    raise ValueError(f"Could not parse date from value: {value}")
                return None
            return date_value.isoformat()  # Return as ISO string for database
        
        elif field_type == 'number':
            # Handle string numbers with commas, currency symbols, etc.
            if isinstance(value, str):
                # Remove currency symbols, commas, spaces
                value = value.replace('₹', '').replace('$', '').replace(',', '').replace(' ', '').strip()
                if not value:
                    if is_required:
                        raise ValueError(f"Required number field is empty")
                    return None
            
            try:
                num_value = float(value)
                return num_value
            except (ValueError, TypeError):
                if is_required:
                    raise ValueError(f"Could not convert to number: {value}")
                return None
        
        elif field_type == 'string':
            # Convert to string, strip whitespace
            str_value = str(value).strip()
            if not str_value and is_required:
                raise ValueError(f"Required string field is empty")
            return str_value if str_value else None
        
        else:
            # Unknown type, return as string
            return str(value).strip() if value else None
