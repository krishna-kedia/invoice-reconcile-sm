-- Migration 008: Create bank_statement table for direct Excel insertion
-- Stores bank statement transactions extracted from Excel files

CREATE TABLE IF NOT EXISTS bank_statement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    narration TEXT NOT NULL,
    chq_ref_no TEXT,
    value_dt DATE NOT NULL,
    withdrawal_amt NUMERIC(15, 2),
    deposit_amt NUMERIC(15, 2),
    closing_balance NUMERIC(15, 2) NOT NULL,
    row_number INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for bank_statement table
CREATE INDEX IF NOT EXISTS idx_bank_statement_file_id ON bank_statement(file_id);
CREATE INDEX IF NOT EXISTS idx_bank_statement_date ON bank_statement(date);
CREATE INDEX IF NOT EXISTS idx_bank_statement_file_row ON bank_statement(file_id, row_number);
