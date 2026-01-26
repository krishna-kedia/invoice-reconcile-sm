-- Migration 006: Update MMT invoice table to fix TCS/TDS column names and nullability
-- Renames tcd to tcs and makes both tcs and tds nullable

-- Rename tcd column to tcs if tcd exists
DO $$
BEGIN
    -- Check if tcd column exists and rename it to tcs
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'mmt_invoice' 
        AND column_name = 'tcd'
    ) THEN
        -- Rename tcd to tcs
        ALTER TABLE mmt_invoice RENAME COLUMN tcd TO tcs;
    END IF;
    
    -- Make tcs nullable if it exists and is not nullable
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'mmt_invoice' 
        AND column_name = 'tcs' 
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE mmt_invoice ALTER COLUMN tcs DROP NOT NULL;
    END IF;
    
    -- Make tds nullable if it exists and is not nullable
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'mmt_invoice' 
        AND column_name = 'tds' 
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE mmt_invoice ALTER COLUMN tds DROP NOT NULL;
    END IF;
END $$;
