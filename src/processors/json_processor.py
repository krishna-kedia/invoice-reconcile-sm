"""JSON file processor — deterministic parse (no LLM).

Used by the `json_direct_insert` pipeline path. The processor returns the
parsed JSON object alongside an indented string representation that gets
stored as `ocr_outputs.raw_text` so the rest of the pipeline (which expects
a textual artefact per file) remains symmetric.
"""

import json
from typing import Any, Dict, Optional

from .base import BaseProcessor


class JsonProcessor(BaseProcessor):
    """Processor for JSON files using direct parsing."""

    SUPPORTED_TYPES = ['json']

    def supports(self, file_type: str) -> bool:
        """Check if this processor supports the file type."""
        return file_type.lower() in self.SUPPORTED_TYPES

    def process(
        self,
        file_content: bytes,
        file_type: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Parse a JSON file and return the parsed object + raw text.

        Args:
            file_content: File content as bytes.
            file_type: File extension (expected: 'json').
            metadata: Optional metadata about the file (unused).

        Returns:
            Dict with keys:
              - raw_text: pretty-printed JSON string (for `ocr_outputs.raw_text`).
              - parsed_json: the deserialised dict/list — only set when JSON parses.
              - metadata: processing metadata.

        Raises:
            ValueError: when the bytes are not valid UTF-8 JSON.
        """
        if file_type.lower() != 'json':
            raise ValueError(
                f"JsonProcessor only handles 'json' files, got '{file_type}'"
            )

        # Decode bytes → text. Try UTF-8 first, then UTF-8-with-BOM.
        try:
            text = file_content.decode('utf-8-sig')
        except UnicodeDecodeError as exc:
            raise ValueError(f"JSON file is not valid UTF-8: {exc}") from exc

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Failed to parse JSON file: {exc}") from exc

        try:
            raw_text = json.dumps(parsed, indent=2, ensure_ascii=False)
        except (TypeError, ValueError):
            # Fallback: preserve the original text.
            raw_text = text

        processing_metadata: Dict[str, Any] = {
            'file_type': file_type,
            'processing_method': 'json_direct_parse',
            'top_level_type': type(parsed).__name__,
        }
        if isinstance(parsed, dict):
            processing_metadata['top_level_keys'] = list(parsed.keys())
        elif isinstance(parsed, list):
            processing_metadata['top_level_length'] = len(parsed)

        return {
            'raw_text': raw_text,
            'parsed_json': parsed,
            'metadata': processing_metadata,
        }
