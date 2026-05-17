"""Structured data extractor using OpenAI API"""

import json
from typing import Dict, Any, List, Optional
from datetime import datetime
from openai import OpenAI


class StructuredExtractor:
    """Extracts structured fields from raw text using OpenAI API"""

    def __init__(self, api_key: str, model: str = "gpt-4", max_tokens: int = 4096):
        self.client = OpenAI(api_key=api_key)
        self.model = model
        self.max_tokens = max_tokens

    def extract(self, raw_text: str, extraction_prompt: str,
               fields: List[Dict[str, Any]]) -> Dict[str, Any]:
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
                temperature=0.1
            )

            response_text = response.choices[0].message.content or "{}"
            extracted_fields = json.loads(response_text)

            # Validate required fields
            missing_fields = []
            for field in fields:
                if field.get('required', False):
                    field_name = field['name']
                    if field_name not in extracted_fields or extracted_fields[field_name] is None:
                        missing_fields.append(field_name)

            if missing_fields:
                raise ValueError(f"Missing required fields: {', '.join(missing_fields)}")

            validated_fields = self._validate_and_convert_types(extracted_fields, fields)

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
        validated = {}
        field_map = {field['name']: field for field in field_definitions}
        field_map_lower = {field['name'].lower(): field['name'] for field in field_definitions}

        for field_name, field_value in extracted_fields.items():
            if field_name in field_map:
                canonical_field_name = field_name
            elif field_name.lower() in field_map_lower:
                canonical_field_name = field_map_lower[field_name.lower()]
            else:
                validated[field_name] = field_value
                continue

            field_def = field_map[canonical_field_name]
            field_type = field_def['type']

            if field_value is None:
                validated[canonical_field_name] = None
            elif field_type == 'string':
                validated[canonical_field_name] = str(field_value)
            elif field_type == 'number':
                try:
                    if isinstance(field_value, str):
                        cleaned = field_value.replace(',', '').replace('$', '').replace('₹', '').strip()
                        validated[canonical_field_name] = float(cleaned)
                    else:
                        validated[canonical_field_name] = float(field_value)
                except (ValueError, TypeError):
                    raise ValueError(f"Invalid number value for field '{canonical_field_name}': {field_value}")
            elif field_type == 'date':
                if isinstance(field_value, str):
                    try:
                        datetime.fromisoformat(field_value.replace('Z', '+00:00'))
                        validated[canonical_field_name] = field_value
                    except ValueError:
                        try:
                            dt = datetime.strptime(field_value, '%Y-%m-%d')
                            validated[canonical_field_name] = dt.strftime('%Y-%m-%d')
                        except ValueError:
                            raise ValueError(f"Invalid date format for field '{canonical_field_name}': {field_value}")
                else:
                    validated[canonical_field_name] = field_value
            else:
                validated[canonical_field_name] = field_value

        # Ensure all config fields are present (set to None if missing)
        for field_def in field_definitions:
            field_name = field_def['name']
            if field_name not in validated:
                validated[field_name] = None

        return validated
