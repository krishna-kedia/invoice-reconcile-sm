-- Migration 005: Create HDFC MPR (Merchant Payment Report) tables
-- Creates main table (card_settlement) and child tables (card_transactions, upi_transactions)

-- Main table: card_settlement
CREATE TABLE IF NOT EXISTS card_settlement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    gross_amount NUMERIC(15, 2) NOT NULL,
    discount NUMERIC(15, 2) NOT NULL,
    gst_amount NUMERIC(15, 2) NOT NULL,
    net_amount NUMERIC(15, 2) NOT NULL,
    mpr_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Child table for card transactions
CREATE TABLE IF NOT EXISTS card_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_settlement_id UUID NOT NULL REFERENCES card_settlement(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    settlement_date DATE NOT NULL,
    gross_amount NUMERIC(15, 2) NOT NULL,
    mdr_percent NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Child table for UPI transactions
CREATE TABLE IF NOT EXISTS upi_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_settlement_id UUID NOT NULL REFERENCES card_settlement(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    settlement_date DATE NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    vpa TEXT NOT NULL,
    upi_transaction_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for card_settlement
CREATE INDEX IF NOT EXISTS idx_card_settlement_file_id ON card_settlement(file_id);
CREATE INDEX IF NOT EXISTS idx_card_settlement_mpr_date ON card_settlement(mpr_date);

-- Indexes for card_transactions
CREATE INDEX IF NOT EXISTS idx_card_transactions_card_settlement_id ON card_transactions(card_settlement_id);
CREATE INDEX IF NOT EXISTS idx_card_transactions_transaction_date ON card_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_card_transactions_settlement_date ON card_transactions(settlement_date);

-- Indexes for upi_transactions
CREATE INDEX IF NOT EXISTS idx_upi_transactions_card_settlement_id ON upi_transactions(card_settlement_id);
CREATE INDEX IF NOT EXISTS idx_upi_transactions_transaction_date ON upi_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_upi_transactions_settlement_date ON upi_transactions(settlement_date);
CREATE INDEX IF NOT EXISTS idx_upi_transactions_upi_transaction_id ON upi_transactions(upi_transaction_id);
