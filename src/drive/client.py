"""Google Drive API client with service account authentication"""

import os
import io
from typing import List, Dict, Any, Optional
from pathlib import Path
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError


class DriveClient:
    """Google Drive API client wrapper"""
    
    SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
    
    def __init__(self, service_account_path: str):
        """Initialize Google Drive client.
        
        Args:
            service_account_path: Path to service account JSON file
        """
        if not os.path.exists(service_account_path):
            raise FileNotFoundError(f"Service account file not found: {service_account_path}")
        
        credentials = service_account.Credentials.from_service_account_file(
            service_account_path,
            scopes=self.SCOPES
        )
        
        self.service = build('drive', 'v3', credentials=credentials)
    
    def list_files_in_folder(self, folder_id: str, 
                            file_types: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """List all files in a Google Drive folder.
        
        Args:
            folder_id: Google Drive folder ID
            file_types: Optional list of file extensions to filter (e.g., ['pdf', 'jpg'])
                       If None, returns all files.
        
        Returns:
            List of file metadata dictionaries with keys:
            - id: Drive file ID
            - name: File name
            - mimeType: MIME type
            - size: File size in bytes
            - createdTime: Creation timestamp
            - modifiedTime: Last modified timestamp
        """
        query = f"'{folder_id}' in parents and trashed=false"
        
        # Filter by file types if provided
        if file_types:
            mime_type_filters = []
            extension_filters = []
            
            for file_type in file_types:
                file_type_lower = file_type.lower()
                
                # Map common extensions to MIME types
                mime_map = {
                    'pdf': 'application/pdf',
                    'jpg': 'image/jpeg',
                    'jpeg': 'image/jpeg',
                    'png': 'image/png',
                    'heic': 'image/heic',
                    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'xls': 'application/vnd.ms-excel',
                    'csv': 'text/csv'
                }

                # JSON: Drive uploads frequently arrive with MIME 'application/json'
                # but can also be 'text/plain' or even 'application/octet-stream'.
                # Always include the name-extension filter so we catch them all.
                if file_type_lower == 'json':
                    mime_type_filters.append("mimeType='application/json'")
                    extension_filters.append("name contains '.json'")
                elif file_type_lower in mime_map:
                    mime_type_filters.append(f"mimeType='{mime_map[file_type_lower]}'")
                else:
                    # Fallback to name contains extension
                    extension_filters.append(f"name contains '.{file_type_lower}'")
            
            # Combine MIME and extension filters with a single OR — extension
            # fallbacks must still apply for types whose MIME we can't predict
            # (e.g. JSON uploads sometimes arrive as text/plain or octet-stream).
            combined_filters = mime_type_filters + extension_filters
            if combined_filters:
                query += f" and ({' or '.join(combined_filters)})"
        
        files = []
        page_token = None
        
        try:
            while True:
                response = self.service.files().list(
                    q=query,
                    fields='nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)',
                    pageToken=page_token,
                    pageSize=1000
                ).execute()
                
                files.extend(response.get('files', []))
                page_token = response.get('nextPageToken')
                
                if not page_token:
                    break
        
        except HttpError as error:
            raise Exception(f"Error listing files in folder {folder_id}: {error}")
        
        return files
    
    def download_file(self, file_id: str, output_path: Optional[str] = None) -> bytes:
        """Download a file from Google Drive.
        
        Args:
            file_id: Google Drive file ID
            output_path: Optional path to save file. If None, returns bytes.
        
        Returns:
            File content as bytes
        """
        try:
            request = self.service.files().get_media(fileId=file_id)
            file_content = io.BytesIO()
            downloader = MediaIoBaseDownload(file_content, request)
            
            done = False
            while not done:
                status, done = downloader.next_chunk()
            
            file_content.seek(0)
            content_bytes = file_content.read()
            
            # Save to file if output_path provided
            if output_path:
                Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, 'wb') as f:
                    f.write(content_bytes)
            
            return content_bytes
        
        except HttpError as error:
            raise Exception(f"Error downloading file {file_id}: {error}")
    
    def get_file_metadata(self, file_id: str) -> Dict[str, Any]:
        """Get file metadata.
        
        Args:
            file_id: Google Drive file ID
        
        Returns:
            File metadata dictionary
        """
        try:
            file_metadata = self.service.files().get(
                fileId=file_id,
                fields='id, name, mimeType, size, createdTime, modifiedTime'
            ).execute()
            return file_metadata
        except HttpError as error:
            raise Exception(f"Error getting file metadata {file_id}: {error}")
