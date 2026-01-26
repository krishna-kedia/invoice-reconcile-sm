-- Initial database schema for invoice reconcile system
-- Append-only data model with full audit trail

-- Files table: Tracks all files discovered from Google Drive
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_file_id TEXT UNIQUE NOT NULL,
    drive_folder_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size BIGINT,
    drive_created_at TIMESTAMP WITH TIME ZONE,
    drive_modified_at TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    ocr_retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index on drive_file_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_files_drive_file_id ON files(drive_file_id);

-- Create index on status for querying pending/failed files
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);

-- Create index on document_type for filtering
CREATE INDEX IF NOT EXISTS idx_files_document_type ON files(document_type);

-- OCR outputs table: Raw OCR results
CREATE TABLE IF NOT EXISTS ocr_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    ocr_metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index on file_id for joins
CREATE INDEX IF NOT EXISTS idx_ocr_outputs_file_id ON ocr_outputs(file_id);

-- Extractions table: Structured field extractions
CREATE TABLE IF NOT EXISTS extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    extracted_fields JSONB NOT NULL,
    extraction_metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index on file_id for joins
CREATE INDEX IF NOT EXISTS idx_extractions_file_id ON extractions(file_id);

-- Create index on document_type for filtering
CREATE INDEX IF NOT EXISTS idx_extractions_document_type ON extractions(document_type);

-- Processing logs table: Audit trail for all operations
CREATE TABLE IF NOT EXISTS processing_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    operation TEXT NOT NULL CHECK (operation IN ('discovery', 'download', 'ocr', 'extraction', 'error')),
    status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index on file_id for filtering logs by file
CREATE INDEX IF NOT EXISTS idx_processing_logs_file_id ON processing_logs(file_id);

-- Create index on operation for filtering by operation type
CREATE INDEX IF NOT EXISTS idx_processing_logs_operation ON processing_logs(operation);

-- Create index on created_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_processing_logs_created_at ON processing_logs(created_at);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to update updated_at on files table
CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
