"""Structured data extractor using OpenAI API"""

import json
from typing import Dict, Any, List, Optional
from datetime import datetime
from openai import OpenAI


class StructuredExtractor:
    """Extracts structured fields from raw text using OpenAI API"""
    
    def __init__(self, api_key: str, model: str = "gpt-4", max_tokens: int = 4096):
        """Initialize structured extractor.
        
        Args:
            api_key: OpenAI API key
            model: Model to use (e.g., 'gpt-4', 'gpt-4-turbo')
            max_tokens: Maximum tokens for response
        """
        self.client = OpenAI(api_key=api_key)
        self.model = model
        self.max_tokens = max_tokens
    
    def extract(self, raw_text: str, extraction_prompt: str,
               fields: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Extract structured fields from raw text.
        
        Args:
            raw_text: Raw text content from OCR or parsing
            extraction_prompt: Prompt describing what to extract
            fields: List of field definitions from config
        
        Returns:
            Dictionary with extracted fields and metadata
        """
        # Build field schema description
        field_descriptions = []
        required_fields = []
        
        for field in fields:
            field_name = field['name']
            field_type = field['type']
            is_required = field.get('required', False)
            
            field_desc = f"- {field_name} ({field_type})"
            if is_required:
                field_desc += " [REQUIRED]"
                required_fields.append(field_name)
            
            field_descriptions.append(field_desc)
        
        fields_schema = "\n".join(field_descriptions)
        
        # Build extraction prompt
        system_prompt = """You are a data extraction assistant. Extract structured data from the provided text according to the specified schema.
Return ONLY a valid JSON object with the extracted fields. Do not include any explanation or markdown formatting.
For date fields, use ISO format (YYYY-MM-DD).
For number fields, use numeric values (no currency symbols or commas).
If a required field cannot be found, use null for that field."""
        
        user_prompt = f"""{extraction_prompt}

Required fields:
{fields_schema}

Extract the following information from this text:

{raw_text}

Return a JSON object with the extracted fields."""
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format={"type": "json_object"},
                max_tokens=self.max_tokens,
                temperature=0.1  # Low temperature for consistent extraction
            )
            
            # Parse JSON response
            response_text = response.choices[0].message.content or "{}"
            extracted_fields = json.loads(response_text)
            # #region agent log
            with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                import json as json_module
                field_keys = list(extracted_fields.keys())
                tcs_present = 'TCS' in extracted_fields or 'tcs' in extracted_fields
                tds_present = 'TDS' in extracted_fields or 'tds' in extracted_fields
                f.write(json_module.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H7","location":"structured_extractor.py:86","message":"Extracted fields keys","data":{"field_keys":field_keys,"tcs_present":tcs_present,"tds_present":tds_present,"tcs_value":extracted_fields.get('TCS') or extracted_fields.get('tcs'),"tds_value":extracted_fields.get('TDS') or extracted_fields.get('tds')},"timestamp":int(__import__('time').time()*1000)}) + '\n')
            # #endregion
            
            # Validate required fields
            missing_fields = []
            for field in fields:
                if field.get('required', False):
                    field_name = field['name']
                    if field_name not in extracted_fields or extracted_fields[field_name] is None:
                        missing_fields.append(field_name)
            
            if missing_fields:
                raise ValueError(f"Missing required fields: {', '.join(missing_fields)}")
            
            # Validate and convert field types
            validated_fields = self._validate_and_convert_types(extracted_fields, fields)
            # #region agent log
            with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                import json as json_module
                validated_keys = list(validated_fields.keys())
                tcs_final = validated_fields.get('TCS') or validated_fields.get('tcs')
                tds_final = validated_fields.get('TDS') or validated_fields.get('tds')
                f.write(json_module.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H9","location":"structured_extractor.py:100","message":"After validation","data":{"validated_keys":validated_keys,"tcs_final":tcs_final,"tds_final":tds_final},"timestamp":int(__import__('time').time()*1000)}) + '\n')
            # #endregion
            
            # Build metadata
            extraction_metadata = {
                'model': self.model,
                'prompt_used': extraction_prompt,
                'usage': {
                    'prompt_tokens': response.usage.prompt_tokens if response.usage else None,
                    'completion_tokens': response.usage.completion_tokens if response.usage else None,
                    'total_tokens': response.usage.total_tokens if response.usage else None
                },
                'extraction_timestamp': datetime.utcnow().isoformat()
            }
            
            return {
                'extracted_fields': validated_fields,
                'metadata': extraction_metadata
            }
        
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse JSON response: {str(e)}")
        except Exception as e:
            raise Exception(f"OpenAI API error during extraction: {str(e)}")
    
    def _validate_and_convert_types(self, extracted_fields: Dict[str, Any],
                                    field_definitions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validate and convert field types according to schema.
        
        Args:
            extracted_fields: Raw extracted fields
            field_definitions: Field definitions from config
        
        Returns:
            Validated and converted fields
        """
        validated = {}
        field_map = {field['name']: field for field in field_definitions}
        # Create case-insensitive lookup map
        field_map_lower = {field['name'].lower(): field['name'] for field in field_definitions}
        
        # #region agent log
        with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
            import json as json_module
            config_field_names = list(field_map.keys())
            extracted_field_names = list(extracted_fields.keys())
            tcs_in_config = 'tcs' in [f.lower() for f in config_field_names]
            tds_in_config = 'tds' in [f.lower() for f in config_field_names]
            f.write(json_module.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H7","location":"structured_extractor.py:136","message":"Field name matching","data":{"config_field_names":config_field_names,"extracted_field_names":extracted_field_names,"tcs_in_config":tcs_in_config,"tds_in_config":tds_in_config},"timestamp":int(__import__('time').time()*1000)}) + '\n')
        # #endregion
        
        for field_name, field_value in extracted_fields.items():
            # Try exact match first
            if field_name in field_map:
                canonical_field_name = field_name
            # Try case-insensitive match
            elif field_name.lower() in field_map_lower:
                canonical_field_name = field_map_lower[field_name.lower()]
                # #region agent log
                with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                    import json as json_module
                    f.write(json_module.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H7","location":"structured_extractor.py:165","message":"Case-insensitive field match","data":{"extracted_name":field_name,"canonical_name":canonical_field_name},"timestamp":int(__import__('time').time()*1000)}) + '\n')
                # #endregion
            else:
                # Unknown field, keep as-is
                # #region agent log
                with open('/Users/krishnagopalkedia/Documents/GitHub/invoice-reconcile-sm/.cursor/debug.log', 'a') as f:
                    import json as json_module
                    f.write(json_module.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"H7","location":"structured_extractor.py:172","message":"Unknown field (not in config)","data":{"field_name":field_name,"field_value":field_value},"timestamp":int(__import__('time').time()*1000)}) + '\n')
                # #endregion
                validated[field_name] = field_value
                continue
            
            field_def = field_map[canonical_field_name]
            field_type = field_def['type']
            
            # Convert based on type
            if field_value is None:
                validated[canonical_field_name] = None
            elif field_type == 'string':
                validated[canonical_field_name] = str(field_value)
            elif field_type == 'number':
                try:
                    # Remove any currency symbols or commas
                    if isinstance(field_value, str):
                        cleaned = field_value.replace(',', '').replace('$', '').replace('₹', '').strip()
                        validated[canonical_field_name] = float(cleaned)
                    else:
                        validated[canonical_field_name] = float(field_value)
                except (ValueError, TypeError):
                    raise ValueError(f"Invalid number value for field '{canonical_field_name}': {field_value}")
            elif field_type == 'date':
                # Try to parse date
                if isinstance(field_value, str):
                    try:
                        # Try ISO format first
                        datetime.fromisoformat(field_value.replace('Z', '+00:00'))
                        validated[canonical_field_name] = field_value
                    except ValueError:
                        # Try other common formats
                        try:
                            dt = datetime.strptime(field_value, '%Y-%m-%d')
                            validated[canonical_field_name] = dt.strftime('%Y-%m-%d')
                        except ValueError:
                            raise ValueError(f"Invalid date format for field '{canonical_field_name}': {field_value}")
                else:
                    validated[canonical_field_name] = field_value
            else:
                # Unknown type, keep as-is
                validated[canonical_field_name] = field_value
        
        # Ensure all config fields are present in validated output (set to None if missing)
        for field_def in field_definitions:
            field_name = field_def['name']
            if field_name not in validated:
                # Field not extracted, set to None (will be handled as optional if not required)
                validated[field_name] = None
        
        return validated
