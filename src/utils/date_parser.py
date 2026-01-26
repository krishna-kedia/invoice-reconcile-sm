"""Date parsing utility for Excel files"""

from datetime import datetime, date
from typing import Any, Optional
import pandas as pd
import re


def parse_excel_date(value: Any) -> Optional[date]:
    """Parse date from Excel cell (handles multiple formats).
    
    Handles:
    - Excel date numbers (serial date)
    - String dates: "01/04/25", "01-04-2025", "2025-04-01", "01/04/2025"
    - pandas Timestamp objects
    - datetime objects
    
    Args:
        value: Date value from Excel (can be number, string, Timestamp, datetime)
    
    Returns:
        date object or None if parsing fails
    """
    if value is None or pd.isna(value):
        return None
    
    # If already a date object
    if isinstance(value, date):
        return value
    
    # If datetime, extract date
    if isinstance(value, datetime):
        return value.date()
    
    # If pandas Timestamp
    if isinstance(value, pd.Timestamp):
        return value.date()
    
    # If numeric (Excel serial date)
    if isinstance(value, (int, float)):
        try:
            # Excel serial date (days since 1900-01-01)
            # Note: Excel incorrectly treats 1900 as a leap year
            base_date = datetime(1899, 12, 30)
            result_date = base_date + pd.Timedelta(days=int(value))
            return result_date.date()
        except (ValueError, OverflowError):
            return None
    
    # If string, try to parse various formats
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
        
        # Try common date formats
        date_formats = [
            '%d/%m/%y',      # 01/04/25
            '%d/%m/%Y',      # 01/04/2025
            '%d-%m-%Y',      # 01-04-2025
            '%Y-%m-%d',      # 2025-04-01
            '%d.%m.%Y',      # 01.04.2025
            '%d %m %Y',      # 01 04 2025
            '%d/%m/%y %H:%M:%S',  # 01/04/25 12:00:00
            '%d/%m/%Y %H:%M:%S',  # 01/04/2025 12:00:00
        ]
        
        for fmt in date_formats:
            try:
                dt = datetime.strptime(value, fmt)
                return dt.date()
            except ValueError:
                continue
        
        # Try pandas to_datetime as fallback
        try:
            dt = pd.to_datetime(value)
            return dt.date()
        except (ValueError, TypeError):
            pass
    
    return None
