-- Migration 002: Create document-specific tables
-- Creates normalized tables for each document type based on config.yaml

-- hotel_invoice table: Structured data for hotel invoice documents
CREATE TABLE IF NOT EXISTS hotel_invoice (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    guest_name TEXT NOT NULL,
    source TEXT NOT NULL,
    arrival_time DATE NOT NULL,
    departure_time DATE NOT NULL,
    booking_id TEXT NOT NULL,
    booking_date DATE NOT NULL,
    taxable_amount NUMERIC(15, 2) NOT NULL,
    cgst NUMERIC(15, 2) NOT NULL,
    sgst NUMERIC(15, 2) NOT NULL,
    grand_total NUMERIC(15, 2) NOT NULL,
    invoice_number TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for hotel_invoice table
CREATE INDEX IF NOT EXISTS idx_hotel_invoice_file_id ON hotel_invoice(file_id);
CREATE INDEX IF NOT EXISTS idx_hotel_invoice_invoice_number ON hotel_invoice(invoice_number);
CREATE INDEX IF NOT EXISTS idx_hotel_invoice_booking_id ON hotel_invoice(booking_id);
CREATE INDEX IF NOT EXISTS idx_hotel_invoice_booking_date ON hotel_invoice(booking_date);
