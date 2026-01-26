-- Migration 004: Create MMT (MakeMyTrip) invoice table
-- Creates normalized table for MMT invoice documents based on config.yaml

-- mmt_invoice table: Structured data for MakeMyTrip invoice documents
CREATE TABLE IF NOT EXISTS mmt_invoice (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    primary_guest_details TEXT NOT NULL,
    booking_id TEXT NOT NULL,
    booked_on DATE NOT NULL,
    check_in DATE NOT NULL,
    check_out DATE NOT NULL,
    room_charges NUMERIC(15, 2) NOT NULL,
    extra_adult_child_charges NUMERIC(15, 2) NOT NULL,
    property_taxes NUMERIC(15, 2) NOT NULL,
    service_charge NUMERIC(15, 2) NOT NULL,
    property_gross_charges NUMERIC(15, 2) NOT NULL,
    go_mmt_commission NUMERIC(15, 2) NOT NULL,
    gst_on_commission NUMERIC(15, 2) NOT NULL,
    tcs NUMERIC(15, 2) NULL,
    tds NUMERIC(15, 2) NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for mmt_invoice table
CREATE INDEX IF NOT EXISTS idx_mmt_invoice_file_id ON mmt_invoice(file_id);
CREATE INDEX IF NOT EXISTS idx_mmt_invoice_booking_id ON mmt_invoice(booking_id);
CREATE INDEX IF NOT EXISTS idx_mmt_invoice_booked_on ON mmt_invoice(booked_on);
CREATE INDEX IF NOT EXISTS idx_mmt_invoice_check_in ON mmt_invoice(check_in);
CREATE INDEX IF NOT EXISTS idx_mmt_invoice_check_out ON mmt_invoice(check_out);
