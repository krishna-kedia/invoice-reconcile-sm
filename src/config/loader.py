"""Configuration loader with environment variable substitution"""

import os
import re
import yaml
from pathlib import Path
from typing import Dict, Any, Optional
from dotenv import load_dotenv


def substitute_env_vars(value: Any) -> Any:
    """Recursively substitute environment variables in config values.
    
    Supports ${VAR_NAME} syntax. If the variable is not found, raises ValueError.
    """
    if isinstance(value, str):
        # Pattern to match ${VAR_NAME} or ${VAR_NAME}
        pattern = r'\$\{([^}]+)\}'
        
        def replace_var(match):
            var_name = match.group(1)
            env_value = os.getenv(var_name)
            if env_value is None:
                raise ValueError(f"Environment variable '{var_name}' not found")
            return env_value
        
        return re.sub(pattern, replace_var, value)
    elif isinstance(value, dict):
        return {k: substitute_env_vars(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [substitute_env_vars(item) for item in value]
    else:
        return value


class Config:
    """Configuration manager that loads and validates config.yaml"""
    
    def __init__(self, config_path: Optional[str] = None):
        """Initialize config loader.
        
        Args:
            config_path: Path to config.yaml file. If None, looks for config.yaml
                         in the project root.
        """
        if config_path is None:
            # Find project root (where config.yaml should be)
            current_dir = Path(__file__).parent.parent.parent
            config_path = current_dir / "config.yaml"
        
        self.config_path = Path(config_path)
        
        # Load environment variables from .env file if it exists
        env_file = self.config_path.parent / ".env"
        if env_file.exists():
            load_dotenv(env_file)
        
        self._config: Dict[str, Any] = {}
        self.load()
    
    def load(self) -> None:
        """Load and parse config.yaml with environment variable substitution."""
        if not self.config_path.exists():
            raise FileNotFoundError(f"Config file not found: {self.config_path}")
        
        with open(self.config_path, 'r') as f:
            raw_config = yaml.safe_load(f)
        
        # Substitute environment variables
        self._config = substitute_env_vars(raw_config)
        
        # Validate required sections
        self._validate()
    
    def _validate(self) -> None:
        """Validate that required config sections exist."""
        required_sections = ['system', 'connections', 'document_types']
        for section in required_sections:
            if section not in self._config:
                raise ValueError(f"Missing required config section: {section}")
        
        # Validate connections
        connections = self._config['connections']
        required_connections = ['supabase', 'google_drive', 'openai']
        for conn in required_connections:
            if conn not in connections:
                raise ValueError(f"Missing required connection config: {conn}")
        
        # Validate document types
        if not isinstance(self._config['document_types'], list):
            raise ValueError("document_types must be a list")
        
        if len(self._config['document_types']) == 0:
            raise ValueError("At least one document_type must be configured")
        
        # Validate each document type
        for doc_type in self._config['document_types']:
            required_fields = ['document_type', 'drive_folder_id', 'file_types', 
                             'extraction_prompt', 'fields']
            
            # If excel_direct_insert is True, extraction_prompt is optional
            excel_direct_insert = doc_type.get('excel_direct_insert', False)
            if excel_direct_insert:
                # For direct Excel insertion, extraction_prompt is optional
                required_fields = ['document_type', 'drive_folder_id', 'file_types', 'fields']
            
            for field in required_fields:
                if field not in doc_type:
                    raise ValueError(f"Document type '{doc_type.get('document_type', 'unknown')}' "
                                   f"missing required field: {field}")
            
            # Validate excel_direct_insert flag if present
            if 'excel_direct_insert' in doc_type:
                if not isinstance(doc_type['excel_direct_insert'], bool):
                    raise ValueError(f"Document type '{doc_type.get('document_type', 'unknown')}' "
                                   f"excel_direct_insert must be a boolean")
    
    @property
    def system(self) -> Dict[str, Any]:
        """Get system configuration."""
        return self._config['system']
    
    @property
    def connections(self) -> Dict[str, Any]:
        """Get connections configuration."""
        return self._config['connections']
    
    @property
    def document_types(self) -> list:
        """Get list of document type configurations."""
        return self._config['document_types']
    
    def get_document_type(self, document_type: str) -> Optional[Dict[str, Any]]:
        """Get configuration for a specific document type.
        
        Args:
            document_type: The document type name to look up.
            
        Returns:
            Document type config dict or None if not found.
        """
        for doc_type in self.document_types:
            if doc_type['document_type'] == document_type:
                return doc_type
        return None
    
    def reload(self) -> None:
        """Reload configuration from file."""
        self.load()
