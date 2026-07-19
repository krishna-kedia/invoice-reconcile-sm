# Card Settlement HDFC MPR Fix — Deferred

**Issue:** 5 HDFC card_settlement PDFs permanently stuck as `failed`:
- `42310731-01072026-MAP2718177832942.pdf` (Jul 2026)
- `42310731-01062026-MAP2715190235259.pdf` (Jun 2026)
- `42310731-01022026-MAP2603155500125.pdf` (Feb 2026)
- `42310731-01042026-MAP2609005131132.pdf` (Apr 2026)
- `42310731-01052026-MAP2712084152131.pdf` (May 2026)

**Error:** `Missing required fields: gross_amount, discount, gst_amount, net_amount, mpr_date`

**Root cause:** Vision API OCR extracts text but the extraction prompt doesn't match the actual field layout in those months' MPR PDFs.

**To fix:**
1. Query `ocr_outputs` table for those file_ids to see raw extracted text
2. Adjust `card_settlement` extraction prompt in `config.yaml` to match actual layout
3. Reset those 5 files: `UPDATE files SET status='pending', ocr_retry_count=0, error_message=NULL WHERE document_type='card_settlement' AND status='failed'`
