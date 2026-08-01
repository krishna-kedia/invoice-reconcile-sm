-- Fix: rpc_submit_manual_payment_entry wrapped the computed admin_flags jsonb
-- array in NULLIF(v_admin_flags, '[]'::jsonb) before inserting into
-- manual_payment_entries. Whenever a UPI entry had no flags to raise (bank
-- credit matched and card_settlement_id found), this turned the value into
-- SQL NULL, which violates the admin_flags NOT NULL constraint. This mainly
-- surfaced when an operator added a second manual entry for an invoice,
-- since by then bank/MPR data had usually caught up and no flags applied.
-- Fix: insert v_admin_flags directly, which is always a valid jsonb array
-- (possibly empty), matching the column's own '[]'::jsonb default.

CREATE OR REPLACE FUNCTION public.rpc_submit_manual_payment_entry(p_invoice_id uuid, p_payment_type text, p_amount numeric, p_transaction_date date, p_settlement_date date DEFAULT NULL::date, p_vpa text DEFAULT NULL::text, p_upi_transaction_id text DEFAULT NULL::text, p_party_name text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_id          uuid;
  v_role              text;
  v_invoice           RECORD;
  v_entry_id          uuid;
  v_admin_flags       jsonb := '[]'::jsonb;
  v_bank_credit       numeric;
  v_existing_upi_sum  numeric;
  v_card_settlement_id uuid;
  v_remaining_gap     numeric;
  v_source_bucket     text;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO v_role FROM user_profiles WHERE user_id = v_actor_id;
  IF v_role NOT IN ('operator', 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT grand_total, source, reconciliation_status INTO v_invoice
    FROM hotel_invoice WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found: %', p_invoice_id; END IF;

  IF p_payment_type NOT IN ('upi', 'another_machine', 'commission', 'tds') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TYPE: must be one of upi, another_machine, commission, tds';
  END IF;

  IF p_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_POSITIVE'; END IF;

  -- ---- Branch: UPI ----
  IF p_payment_type = 'upi' THEN
    IF p_settlement_date IS NULL OR p_vpa IS NULL OR p_upi_transaction_id IS NULL THEN
      RAISE EXCEPTION 'MANUAL_UPI_FIELDS_REQUIRED: settlement_date, vpa, and upi_transaction_id are required for UPI payments';
    END IF;

    SELECT deposit_amt INTO v_bank_credit
      FROM bank_statement
     WHERE date = p_settlement_date AND narration ILIKE '%UPI SETTLEMENT%AYH059%'
     LIMIT 1;

    SELECT COALESCE(SUM(amount), 0) INTO v_existing_upi_sum
      FROM upi_transactions WHERE settlement_date = p_settlement_date;

    IF v_bank_credit IS NOT NULL THEN
      IF (v_existing_upi_sum + p_amount) > (v_bank_credit * 1.01) THEN
        RAISE EXCEPTION 'MANUAL_UPI_EXCEEDS_BANK_CREDIT: total UPI for settlement date % would exceed bank credit of %',
          p_settlement_date, v_bank_credit;
      END IF;
    ELSE
      v_admin_flags := v_admin_flags || jsonb_build_array(
        jsonb_build_object('code', 'NO_BANK_CREDIT', 'settlement_date', p_settlement_date::text)
      );
    END IF;

    SELECT DISTINCT card_settlement_id INTO v_card_settlement_id
      FROM upi_transactions WHERE transaction_date = p_transaction_date LIMIT 1;

    IF v_card_settlement_id IS NULL THEN
      v_admin_flags := v_admin_flags || jsonb_build_array(
        jsonb_build_object('code', 'MPR_LINK_UNVERIFIED', 'transaction_date', p_transaction_date::text)
      );
    END IF;

    INSERT INTO manual_payment_entries (
      invoice_id, payment_type, status, submitted_by,
      amount, transaction_date, settlement_date,
      vpa, upi_transaction_id, card_settlement_id,
      admin_flags, party_name, note
    ) VALUES (
      p_invoice_id, 'upi', 'pending', v_actor_id,
      p_amount, p_transaction_date, p_settlement_date,
      p_vpa, p_upi_transaction_id, v_card_settlement_id,
      v_admin_flags, p_party_name, p_note
    ) RETURNING id INTO v_entry_id;

    PERFORM fn_write_audit(
      v_actor_id, 'manual_payment.submit', 'manual_payment_entries', v_entry_id::text,
      NULL,
      jsonb_build_object('payment_type', 'upi', 'amount', p_amount, 'invoice_id', p_invoice_id, 'admin_flags', v_admin_flags),
      NULL
    );

    RETURN jsonb_build_object('entry_id', v_entry_id, 'status', 'pending', 'admin_flags', v_admin_flags);

  -- ---- Branch: ANOTHER_MACHINE ----
  ELSIF p_payment_type = 'another_machine' THEN
    INSERT INTO manual_payment_entries (
      invoice_id, payment_type, status, submitted_by, amount, transaction_date, party_name, note
    ) VALUES (
      p_invoice_id, 'another_machine', 'pending', v_actor_id, p_amount, p_transaction_date, p_party_name, p_note
    ) RETURNING id INTO v_entry_id;

    PERFORM fn_write_audit(
      v_actor_id, 'manual_payment.submit', 'manual_payment_entries', v_entry_id::text,
      NULL,
      jsonb_build_object('payment_type', 'another_machine', 'amount', p_amount, 'invoice_id', p_invoice_id),
      NULL
    );

    RETURN jsonb_build_object('entry_id', v_entry_id, 'status', 'pending', 'admin_flags', '[]'::jsonb);

  -- ---- Branch: COMMISSION / TDS ----
  ELSE
    IF p_party_name IS NULL OR trim(p_party_name) = '' THEN
      RAISE EXCEPTION 'PARTY_REQUIRED: party_name is required for commission and tds payments';
    END IF;

    -- Block walk-in only; phone bookings are now eligible
    IF p_payment_type = 'commission' THEN
      v_source_bucket := fn_classify_invoice_source(v_invoice.source);
      IF v_source_bucket = 'walk_in' THEN
        RAISE EXCEPTION 'WRITEOFF_SOURCE_NOT_ELIGIBLE: Commission not allowed for walk-in bookings';
      END IF;
    END IF;

    SELECT v_invoice.grand_total - COALESCE(SUM(amount_applied), 0)
      INTO v_remaining_gap FROM reconciliation_links WHERE invoice_id = p_invoice_id;
    IF v_remaining_gap IS NULL THEN v_remaining_gap := v_invoice.grand_total; END IF;

    IF p_amount > v_remaining_gap THEN
      RAISE EXCEPTION 'WRITEOFF_EXCEEDS_GAP: amount % exceeds remaining invoice gap of %', p_amount, v_remaining_gap;
    END IF;

    INSERT INTO manual_payment_entries (
      invoice_id, payment_type, status, submitted_by, amount, transaction_date, party_name, note
    ) VALUES (
      p_invoice_id, p_payment_type, 'pending', v_actor_id, p_amount, p_transaction_date, p_party_name, p_note
    ) RETURNING id INTO v_entry_id;

    PERFORM fn_write_audit(
      v_actor_id, 'manual_payment.submit', 'manual_payment_entries', v_entry_id::text,
      NULL,
      jsonb_build_object('payment_type', p_payment_type, 'amount', p_amount, 'invoice_id', p_invoice_id, 'party_name', p_party_name),
      NULL
    );

    RETURN jsonb_build_object('entry_id', v_entry_id, 'status', 'pending', 'admin_flags', '[]'::jsonb);
  END IF;
END;
$function$;
