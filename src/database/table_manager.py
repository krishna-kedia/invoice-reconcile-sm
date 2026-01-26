"""Table manager for creating document-specific tables dynamically"""

from typing import Dict, Any, List
import re


# Field type to SQL type mapping
FIELD_TYPE_TO_SQL = {
    'string': 'TEXT',
    'number': 'NUMERIC(15, 2)',  # Supports currency with 2 decimal places
    'date': 'DATE'
}


def sanitize_table_name(document_type: str) -> str:
    """Sanitize document type name for use as SQL table name.
    
    Args:
        document_type: Document type name from config
    
    Returns:
        SQL-safe table name (alphanumeric + underscores only)
    """
    # Replace any non-alphanumeric/underscore characters with underscore
    sanitized = re.sub(r'[^a-zA-Z0-9_]', '_', document_type)
    # Ensure it doesn't start with a number
    if sanitized and sanitized[0].isdigit():
        sanitized = '_' + sanitized
    return sanitized.lower()


def get_column_name(field_name: str) -> str:
    """Convert field name to SQL-safe column name.
    
    Args:
        field_name: Field name from config (already in snake_case)
    
    Returns:
        SQL-safe column name
    """
    # Field names are already in snake_case, just sanitize
    sanitized = re.sub(r'[^a-zA-Z0-9_]', '_', field_name)
    if sanitized and sanitized[0].isdigit():
        sanitized = '_' + sanitized
    return sanitized.lower()


def generate_table_sql(document_type: str, fields: List[Dict[str, Any]]) -> str:
    """Generate CREATE TABLE SQL statement for a document type.
    
    Args:
        document_type: Document type name
        fields: List of field definitions from config
    
    Returns:
        CREATE TABLE SQL statement
    """
    table_name = sanitize_table_name(document_type)
    
    # Start building CREATE TABLE statement
    columns = [
        "id UUID PRIMARY KEY DEFAULT gen_random_uuid()",
        "file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE",
    ]
    
    # Add columns for each field
    for field in fields:
        field_name = field['name']
        field_type = field['type']
        is_required = field.get('required', False)
        
        column_name = get_column_name(field_name)
        sql_type = FIELD_TYPE_TO_SQL.get(field_type, 'TEXT')
        
        nullable = "NOT NULL" if is_required else "NULL"
        columns.append(f"{column_name} {sql_type} {nullable}")
    
    # Add created_at timestamp
    columns.append("created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()")
    
    # Build SQL
    sql = f"CREATE TABLE IF NOT EXISTS {table_name} (\n"
    sql += ",\n".join(f"    {col}" for col in columns)
    sql += "\n);"
    
    return sql


def generate_indexes_sql(document_type: str, fields: List[Dict[str, Any]]) -> List[str]:
    """Generate CREATE INDEX SQL statements for a document type.
    
    Args:
        document_type: Document type name
        fields: List of field definitions from config
    
    Returns:
        List of CREATE INDEX SQL statements
    """
    table_name = sanitize_table_name(document_type)
    indexes = []
    
    # Always index file_id for joins
    indexes.append(
        f"CREATE INDEX IF NOT EXISTS idx_{table_name}_file_id "
        f"ON {table_name}(file_id);"
    )
    
    # Index commonly queried fields (invoice_number, booking_date, etc.)
    common_index_fields = ['invoice_number', 'booking_id', 'booking_date', 
                          'invoice_date', 'date', 'id']
    
    for field in fields:
        field_name = field['name']
        column_name = get_column_name(field_name)
        
        # Index if it's a common query field
        if any(common in field_name.lower() for common in common_index_fields):
            index_name = f"idx_{table_name}_{column_name}"
            indexes.append(
                f"CREATE INDEX IF NOT EXISTS {index_name} "
                f"ON {table_name}({column_name});"
            )
    
    return indexes


def check_table_exists(db_client, document_type: str) -> bool:
    """Check if document-specific table exists.
    
    Args:
        db_client: DatabaseClient instance
        document_type: Document type name
    
    Returns:
        True if table exists, False otherwise
    """
    table_name = sanitize_table_name(document_type)
    
    try:
        # Try to query the table (will fail if table doesn't exist)
        result = db_client.client.table(table_name).select('id').limit(1).execute()
        return True
    except Exception:
        return False


def ensure_table_exists(db_client, document_type: str, fields: List[Dict[str, Any]]) -> None:
    """Ensure document-specific table exists, create if it doesn't.
    
    Note: This function checks if the table exists. If it doesn't, it logs a warning
    that the migration script needs to be run. Supabase Python client doesn't support
    raw SQL execution, so tables must be created via migration scripts.
    
    Args:
        db_client: DatabaseClient instance
        document_type: Document type name
        fields: List of field definitions from config
    """
    table_name = sanitize_table_name(document_type)
    
    # Check if table exists
    if check_table_exists(db_client, document_type):
        return
    
    # Table doesn't exist - log warning with SQL to create it
    import logging
    logger = logging.getLogger('invoice_reconcile')
    
    create_table_sql = generate_table_sql(document_type, fields)
    index_sqls = generate_indexes_sql(document_type, fields)
    
    logger.warning(
        f"Table {table_name} does not exist. "
        f"Please run migration script 002_document_type_tables.sql in Supabase SQL editor.\n"
        f"SQL to create table:\n{create_table_sql}\n"
        f"Indexes:\n" + "\n".join(index_sqls)
    )


def ensure_all_tables_exist(config, db_client) -> None:
    """Ensure all document type tables exist based on config.
    
    Args:
        config: Config instance with document_types
        db_client: DatabaseClient instance
    """
    for doc_type_config in config.document_types:
        document_type = doc_type_config['document_type']
        fields = doc_type_config['fields']
        
        try:
            ensure_table_exists(db_client, document_type, fields)
        except NotImplementedError as e:
            # Log warning but continue
            import logging
            logger = logging.getLogger('invoice_reconcile')
            logger.warning(f"Could not auto-create table for {document_type}: {e}")
