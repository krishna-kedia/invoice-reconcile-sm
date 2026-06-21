-- Promote run_id=20260620_140026 from staging to upi_transactions
-- Review staging first:
--   SELECT source_file, page_found, vpa, amount, transaction_date, already_exists
--   FROM upi_transactions_staging WHERE run_id = '20260620_140026' ORDER BY source_file, transaction_date;

BEGIN;

INSERT INTO upi_transactions (card_settlement_id, transaction_date, settlement_date, amount, vpa, upi_transaction_id)
SELECT card_settlement_id, transaction_date, settlement_date, amount, vpa, upi_transaction_id
FROM upi_transactions_staging
WHERE run_id = '20260620_140026'
  AND already_exists = FALSE;

-- Verify then COMMIT (or ROLLBACK if anything looks wrong)
COMMIT;
