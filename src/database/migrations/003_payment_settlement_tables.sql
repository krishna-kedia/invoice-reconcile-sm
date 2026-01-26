-- Migration 003: Payment Settlement with nested arrays example
-- This demonstrates how to create main table + child tables for array fields

-- Main table: payment_settlement
CREATE TABLE IF NOT EXISTS payment_settlement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    gross_amount NUMERIC(15, 2) NOT NULL,
    discount NUMERIC(15, 2) NOT NULL,
    gst_amount NUMERIC(15, 2) NOT NULL,
    net_amount NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Child table for card transactions
CREATE TABLE IF NOT EXISTS card_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_settlement_id UUID NOT NULL REFERENCES payment_settlement(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    settlement_date DATE NOT NULL,
    gross_amount NUMERIC(15, 2) NOT NULL,
    mdr_percent NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Child table for UPI transactions
CREATE TABLE IF NOT EXISTS upi_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_settlement_id UUID NOT NULL REFERENCES payment_settlement(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    settlement_date DATE NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    vpa TEXT NOT NULL,
    upi_transaction_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for payment_settlement
CREATE INDEX IF NOT EXISTS idx_payment_settlement_file_id ON payment_settlement(file_id);

-- Indexes for card_transactions
CREATE INDEX IF NOT EXISTS idx_card_transactions_payment_settlement_id ON card_transactions(payment_settlement_id);
CREATE INDEX IF NOT EXISTS idx_card_transactions_transaction_date ON card_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_card_transactions_settlement_date ON card_transactions(settlement_date);

-- Indexes for upi_transactions
CREATE INDEX IF NOT EXISTS idx_upi_transactions_payment_settlement_id ON upi_transactions(payment_settlement_id);
CREATE INDEX IF NOT EXISTS idx_upi_transactions_transaction_date ON upi_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_upi_transactions_settlement_date ON upi_transactions(settlement_date);
CREATE INDEX IF NOT EXISTS idx_upi_transactions_upi_transaction_id ON upi_transactions(upi_transaction_id);
