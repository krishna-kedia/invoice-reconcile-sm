# Reconciliation Bugs

Logged during manual data review — 2026-06-20.

## Open Issues

- [ ] **Invoice 7** (INV1988260007) — Issue with Goibibo reconciliation
- [ ] **Invoice 16** (INV1988260016) — Payment made via a different card machine; not being matched
- [ ] **Invoice 18** (INV1988260018) — No payment in MPR but amount shows in bank statement
- [ ] **MPR OCR incomplete** (confirmed via Invoice 54) — `42310731-14042026.pdf` has 3 UPI transactions (3rd is on a separate page) but OCR only captured 2. `42310731-12042026.pdf` (MPR for 11-Apr) has UPI section missing entirely. Need to re-run OCR/extraction for both files and audit other MPRs for same issue.

- [ ] **Manual UPI entry — `card_settlement_id` lookup uses wrong field** — `rpc_submit_manual_payment_entry` infers `card_settlement_id` from `upi_transactions WHERE transaction_date = p_transaction_date`. Should instead look it up directly via `card_settlement WHERE mpr_date = p_settlement_date` (operator always provides settlement date). Current approach fails whenever no MPR rows exist yet for that transaction date, causing a spurious `MPR_LINK_UNVERIFIED` flag. Fix is straightforward but deferred until old MPRs are uploaded. First seen on INV1988260068 (settlement date 2026-04-16, MPR not yet uploaded).

## Notes / Expected Differences

- **INV1988260052** (NEERAJ UDAY, AsiaTech) — Grand total Rs. 4,725, applied Rs. 4,558, difference Rs. 167. Gap is **commission** — entries are correct, not a reconciliation error.
- **INV1988260059** (Mr Rakesh Sharma, Raj Path Infracon) — Grand total Rs. 15,309, applied Rs. 13,309, difference Rs. 2,000. Gap is **TDS** — entries are correct, not a reconciliation error.
- **INV1988260060** (Shruthi, AsiaTech) — Grand total Rs. 13,650, applied Rs. 13,167, difference Rs. 483. Gap is **commission** — entries are correct, not a reconciliation error.

## Resolved

- [x] **Invoice 34** (INV1988260034) — Bill amount parsed incorrectly due to a Vedam (F&B) line item (Rs. 173, 0% GST) added to the room bill. Actual invoice value is Rs. 3,150 (room only). DB corrected: `taxable_amount` → 3000, `grand_total` → 3150.

- [x] **Invoice 19 & 20** (INV1988260019/20, Dilip Kumar Dalei) — Incorrectly reconciled against a Goibibo payout that was not actually for this guest. Un-reconciled (deleted the stray `reconciliation_links` rows) so the invoices are now `unreconciled` and can be correctly matched in future. Resolved 2026-07-18.

- [x] **MMT May 2026 outstanding −₹986.52** (INV1988260167, Thirumala Rao V) — Double-counted commission: the MMT payout table already deducted ₹1,004.30 via `mmt_invoice` CTE, AND a duplicate manual commission entry (₹1,004 in `manual_payment_entries`, reconciliation_link id `ad4679e8…`) was added on 2026-07-06. Deleted both the `reconciliation_links` row and the `manual_payment_entries` row. Outstanding corrected to +₹17.78. Resolved 2026-07-19.
