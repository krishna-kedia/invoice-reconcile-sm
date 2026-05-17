"""Direct MMT-payout-JSON to Database inserter.

Handles one parsed MMT payout JSON file:
  1. Inserts the `transfer` object → `mmt_payouts` (ON CONFLICT DO NOTHING).
  2. Inserts every `bookings[]` entry → `mmt_bookings_payout`
     (ON CONFLICT (transaction_no, booking_id) DO NOTHING).

Both inserts are idempotent so re-running the pipeline over the same file
produces no duplicates and is not an error.
"""

import logging
import math
from datetime import datetime, date
from typing import Any, Dict, List, Optional

logger = logging.getLogger('invoice_reconcile')


class MmtPayoutInserter:
    """Insert one parsed MMT payout JSON into Supabase."""

    def __init__(self, db_client):
        """Initialise the inserter.

        Args:
            db_client: DatabaseClient instance with `.client` (supabase-py).
        """
        self.db_client = db_client

    def insert_payout_json(
        self,
        file_id: str,
        parsed_json: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Insert one MMT payout JSON document.

        Args:
            file_id: UUID of the file row in `files`.
            parsed_json: The deserialised JSON object.

        Returns:
            Dict with keys:
              - success (bool)
              - payout_inserted (bool)  — True if a new mmt_payouts row was added.
              - payout_existed (bool)   — True if the payout row already existed.
              - bookings_inserted (int) — Count of new mmt_bookings_payout rows.
              - bookings_skipped (int)  — Count of bookings that already existed
                                          OR were skipped because of validation errors.
              - transaction_no (str | None) — The natural key, if parsed.
              - errors (list[dict])     — Per-booking validation/insert errors.
        """
        errors: List[Dict[str, Any]] = []

        # ---- 1. Validate shape -------------------------------------------------
        if not isinstance(parsed_json, dict):
            raise ValueError(
                f"Expected JSON object at top level, got {type(parsed_json).__name__}"
            )

        transfer = parsed_json.get('transfer')
        if not isinstance(transfer, dict):
            raise ValueError("Missing or invalid 'transfer' object in JSON")

        transaction_no = self._safe_str(transfer.get('transactionNo'))
        if not transaction_no:
            raise ValueError("transfer.transactionNo is required and missing")

        total_amount = self._parse_number(transfer.get('totalAmount'), required=True,
                                          field='transfer.totalAmount')

        bookings = parsed_json.get('bookings') or []
        if not isinstance(bookings, list):
            raise ValueError(
                f"'bookings' must be an array, got {type(bookings).__name__}"
            )

        summary = parsed_json.get('summary') or {}
        if not isinstance(summary, dict):
            summary = {}

        # ---- 2. Build payout row ----------------------------------------------
        payout_row = {
            'transaction_no': transaction_no,
            'file_id': file_id,
            'subject_ref': self._safe_str(parsed_json.get('subjectRef')),
            'email_date': self._parse_iso_timestamp(parsed_json.get('emailDate')),
            'exported_at': self._parse_iso_timestamp(parsed_json.get('exportedAt')),
            'processing_date': self._safe_str(transfer.get('processingDate')),
            'total_amount': total_amount,
            'bank_name': self._safe_str(transfer.get('bankName')),
            'beneficiary': self._safe_str(transfer.get('beneficiary')),
            'account_number': self._safe_str(transfer.get('accountNumber')),
            'transaction_date': self._parse_date_ddmmyyyy(transfer.get('transactionDate')),
            'total_bookings': self._parse_int(summary.get('totalBookings')),
            'total_payable_amount': self._parse_number(summary.get('totalPayableAmount'),
                                                       required=False,
                                                       field='summary.totalPayableAmount'),
        }

        # ---- 3. Insert payout (idempotent) ------------------------------------
        try:
            existing = (
                self.db_client.client
                .table('mmt_payouts')
                .select('transaction_no')
                .eq('transaction_no', transaction_no)
                .limit(1)
                .execute()
            )
            payout_existed = bool(existing.data)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"Failed to query mmt_payouts: {exc}") from exc

        payout_inserted = False
        if not payout_existed:
            try:
                self.db_client.client.table('mmt_payouts').insert(payout_row).execute()
                payout_inserted = True
            except Exception as exc:  # noqa: BLE001
                # Race: another worker just inserted the same payout. Treat as existed.
                msg = str(exc)
                if '23505' in msg or 'duplicate key' in msg.lower():
                    payout_existed = True
                    logger.info(
                        f"mmt_payouts row already existed for transaction_no={transaction_no} (race)"
                    )
                else:
                    raise ValueError(
                        f"Failed to insert mmt_payouts row for {transaction_no}: {msg}"
                    ) from exc

        # ---- 4. Insert bookings -----------------------------------------------
        bookings_inserted = 0
        bookings_skipped = 0

        # Fetch existing booking_ids for this payout so we know which to skip
        # without per-row round-trips.
        existing_booking_ids: set = set()
        try:
            existing_b = (
                self.db_client.client
                .table('mmt_bookings_payout')
                .select('booking_id')
                .eq('transaction_no', transaction_no)
                .execute()
            )
            if existing_b.data:
                existing_booking_ids = {row['booking_id'] for row in existing_b.data}
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                f"Could not pre-fetch existing bookings for {transaction_no}: {exc}"
            )

        rows_to_insert: List[Dict[str, Any]] = []
        for idx, booking in enumerate(bookings):
            if not isinstance(booking, dict):
                errors.append({'booking_index': idx, 'error': 'not an object'})
                bookings_skipped += 1
                continue

            booking_id = self._safe_str(booking.get('bookingId'))
            if not booking_id:
                errors.append({'booking_index': idx, 'error': 'bookingId missing'})
                bookings_skipped += 1
                continue

            if booking_id in existing_booking_ids:
                bookings_skipped += 1
                continue

            try:
                row = {
                    'file_id':        file_id,
                    'transaction_no': transaction_no,
                    'booking_id':     booking_id,
                    'booking_pnr':    self._safe_str(booking.get('bookingPNR')),
                    'client_name':    self._safe_str(booking.get('clientName')),
                    'hotel_name':     self._safe_str(booking.get('hotelName')),
                    'hotel_city':     self._safe_str(booking.get('hotelCity')),
                    'check_in':       self._parse_date_ddmmyyyy(booking.get('checkIn')),
                    'check_out':      self._parse_date_ddmmyyyy(booking.get('checkOut')),
                    'original_cost':  self._parse_number(booking.get('originalCost'),
                                                          required=False,
                                                          field=f"bookings[{idx}].originalCost"),
                    'payable':        self._parse_number(booking.get('payable'),
                                                          required=False,
                                                          field=f"bookings[{idx}].payable"),
                    'booking_type':   self._safe_str(booking.get('bookingType')),
                    'brand':          self._safe_str(booking.get('brand')),
                }
                rows_to_insert.append(row)
                existing_booking_ids.add(booking_id)
            except Exception as exc:  # noqa: BLE001
                errors.append({'booking_index': idx, 'booking_id': booking_id,
                               'error': str(exc)})
                bookings_skipped += 1

        if rows_to_insert:
            try:
                result = (
                    self.db_client.client
                    .table('mmt_bookings_payout')
                    .insert(rows_to_insert)
                    .execute()
                )
                bookings_inserted = len(result.data) if result.data else len(rows_to_insert)
            except Exception as exc:  # noqa: BLE001
                # If a unique-constraint race kicks in, fall back to per-row inserts so
                # the rest of the batch still gets recorded.
                msg = str(exc)
                logger.warning(
                    f"Bulk insert into mmt_bookings_payout failed ({msg}); "
                    "falling back to per-row inserts."
                )
                for row in rows_to_insert:
                    try:
                        self.db_client.client.table('mmt_bookings_payout').insert(row).execute()
                        bookings_inserted += 1
                    except Exception as row_exc:  # noqa: BLE001
                        row_msg = str(row_exc)
                        if '23505' in row_msg or 'duplicate key' in row_msg.lower():
                            bookings_skipped += 1
                        else:
                            errors.append({'booking_id': row.get('booking_id'),
                                           'error': row_msg})
                            bookings_skipped += 1

        return {
            'success': True,
            'payout_inserted': payout_inserted,
            'payout_existed': payout_existed,
            'bookings_inserted': bookings_inserted,
            'bookings_skipped': bookings_skipped,
            'transaction_no': transaction_no,
            'errors': errors,
        }

    # ---- Helpers ------------------------------------------------------------

    @staticmethod
    def _safe_str(value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            s = value.strip()
            return s if s else None
        return str(value)

    @staticmethod
    def _parse_int(value: Any) -> Optional[int]:
        if value is None or value == '':
            return None
        try:
            return int(str(value).strip())
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _parse_number(value: Any, required: bool, field: str) -> Optional[float]:
        if value is None or value == '':
            if required:
                raise ValueError(f"{field} is required and missing")
            return None
        if isinstance(value, (int, float)):
            result = float(value)
            if math.isnan(result) or math.isinf(result):
                if required:
                    raise ValueError(f"{field} parsed to invalid float (nan/inf): {value!r}")
                return None
            return result
        try:
            cleaned = str(value).replace(',', '').replace('₹', '').strip()
            result = float(cleaned)
            if math.isnan(result) or math.isinf(result):
                if required:
                    raise ValueError(f"{field} parsed to invalid float (nan/inf): {value!r}")
                return None
            return result
        except (ValueError, TypeError) as exc:
            if required:
                raise ValueError(f"{field} is not a valid number: {value!r}") from exc
            return None

    @staticmethod
    def _parse_date_ddmmyyyy(value: Any) -> Optional[str]:
        """Parse `DD/MM/YYYY` (MMT format) into ISO `YYYY-MM-DD` string for Supabase.

        Returns None for empty/missing inputs. Falls back to ISO parsing if the
        DD/MM/YYYY parse fails.
        """
        if value is None or value == '':
            return None
        text = str(value).strip()
        if not text:
            return None
        for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y'):
            try:
                return datetime.strptime(text, fmt).date().isoformat()
            except ValueError:
                continue
        # Last resort: ISO with timezone (e.g. 2026-05-07T15:07:23Z)
        try:
            return datetime.fromisoformat(text.replace('Z', '+00:00')).date().isoformat()
        except ValueError:
            return None

    @staticmethod
    def _parse_iso_timestamp(value: Any) -> Optional[str]:
        """Parse an ISO-8601 timestamp into a Supabase-friendly timestamptz string."""
        if value is None or value == '':
            return None
        text = str(value).strip()
        if not text:
            return None
        try:
            # Accept "Z" suffix.
            dt = datetime.fromisoformat(text.replace('Z', '+00:00'))
            return dt.isoformat()
        except ValueError:
            return None
