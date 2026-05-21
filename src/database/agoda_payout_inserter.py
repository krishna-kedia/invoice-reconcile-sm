"""Direct Agoda-payout-JSON to Database inserter.

Handles one parsed Agoda payout JSON file. Each Agoda file represents a single
booking (same pattern as Yatra — no wrapper array).

Idempotent: if the `booking_id` already exists in `agoda_bookings_payout` the
record is NOT overwritten; the call returns success=True, skipped=True.
"""

import logging
import math
from datetime import datetime
from typing import Any, Dict, Optional

logger = logging.getLogger('invoice_reconcile')


class AgodaPayoutInserter:
    """Insert one parsed Agoda payout JSON into Supabase."""

    def __init__(self, db_client):
        self.db_client = db_client

    def insert_payout_json(
        self,
        file_id: str,
        parsed_json: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Insert one Agoda payout JSON document.

        Returns:
            Dict with keys: success, inserted, skipped, booking_id, errors.
        """
        if not isinstance(parsed_json, dict):
            raise ValueError(
                f"Expected JSON object at top level, got {type(parsed_json).__name__}"
            )

        booking_id = self._safe_str(parsed_json.get('bookingId'))
        if not booking_id:
            raise ValueError("bookingId is required and missing")

        # ── Sub-objects ──────────────────────────────────────────────────────
        guest        = parsed_json.get('guest') or {}
        rates        = parsed_json.get('rates') or {}
        compensation = parsed_json.get('compensation') or {}
        bottom       = parsed_json.get('bottom') or {}

        if not isinstance(guest,        dict): guest        = {}
        if not isinstance(rates,        dict): rates        = {}
        if not isinstance(compensation, dict): compensation = {}
        if not isinstance(bottom,       dict): bottom       = {}

        # ── Idempotency check ────────────────────────────────────────────────
        try:
            existing = (
                self.db_client.client
                .table('agoda_bookings_payout')
                .select('booking_id')
                .eq('booking_id', booking_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            raise ValueError(f"Failed to query agoda_bookings_payout: {exc}") from exc

        if existing.data:
            logger.info(
                f"agoda_bookings_payout row already exists for booking_id={booking_id}; skipping"
            )
            return {
                'success': True,
                'inserted': False,
                'skipped': True,
                'booking_id': booking_id,
                'errors': [],
            }

        # ── Build row ────────────────────────────────────────────────────────
        first = self._safe_str(guest.get('firstName')) or ''
        last  = self._safe_str(guest.get('lastName'))  or ''
        guest_name = (first + ' ' + last).strip() or None

        row = {
            'booking_id':            booking_id,
            'file_id':               file_id,
            'email_date':            self._parse_iso_timestamp(parsed_json.get('emailDate')),
            'status':                self._safe_str(parsed_json.get('status')),
            'iata':                  self._safe_str(parsed_json.get('iata')),
            'guest_name':            guest_name,
            'country_of_residence':  self._safe_str(guest.get('countryOfResidence')),
            'check_in':              self._parse_agoda_date(guest.get('checkIn')),
            'check_out':             self._parse_agoda_date(guest.get('checkOut')),
            'other_guests':          self._safe_str(guest.get('otherGuests')),
            'room_rate':             self._parse_number(rates.get('roomRate'),
                                                         required=False, field='rates.roomRate'),
            'reference_sell_rate':   self._parse_number(rates.get('referenceSellRate'),
                                                         required=False, field='rates.referenceSellRate'),
            'extra_bed_rate':        self._parse_number(rates.get('extraBedRate'),
                                                         required=False, field='rates.extraBedRate'),
            'commission':            self._parse_number(compensation.get('commission'),
                                                         required=False, field='compensation.commission'),
            'compensation':          self._parse_number(compensation.get('compensation'),
                                                         required=False, field='compensation.compensation'),
            'other_programs':        self._parse_number(compensation.get('otherPrograms'),
                                                         required=False, field='compensation.otherPrograms'),
            'tds_withholding_tax':   self._parse_number(compensation.get('tdsWithholdingTax'),
                                                         required=False, field='compensation.tdsWithholdingTax'),
            'net_rate':              self._parse_number(bottom.get('netRate'),
                                                         required=False, field='bottom.netRate'),
            'booked_and_payable_by': self._safe_str(bottom.get('bookedAndPayableBy')),
        }

        # ── Insert (idempotent race guard) ───────────────────────────────────
        try:
            self.db_client.client.table('agoda_bookings_payout').insert(row).execute()
        except Exception as exc:
            msg = str(exc)
            if '23505' in msg or 'duplicate key' in msg.lower():
                logger.info(
                    f"agoda_bookings_payout row already existed for booking_id={booking_id} (race)"
                )
                return {
                    'success': True,
                    'inserted': False,
                    'skipped': True,
                    'booking_id': booking_id,
                    'errors': [],
                }
            raise ValueError(
                f"Failed to insert agoda_bookings_payout row for {booking_id}: {msg}"
            ) from exc

        logger.info(f"Inserted agoda_bookings_payout row for booking_id={booking_id}")
        return {
            'success': True,
            'inserted': True,
            'skipped': False,
            'booking_id': booking_id,
            'errors': [],
        }

    # ── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _safe_str(value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            s = value.strip()
            return s if s else None
        return str(value)

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
    def _parse_iso_timestamp(value: Any) -> Optional[str]:
        if value is None or value == '':
            return None
        text = str(value).strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace('Z', '+00:00'))
            return dt.isoformat()
        except ValueError:
            return None

    @staticmethod
    def _parse_agoda_date(value: Any) -> Optional[str]:
        """Parse Agoda's "Month D, YYYY" format (e.g. "February 5, 2026") into ISO YYYY-MM-DD.

        Falls back to common date formats and ISO if the primary format fails.
        """
        if value is None or value == '':
            return None
        text = str(value).strip()
        if not text:
            return None
        # Primary: Agoda format — "February 5, 2026"
        try:
            return datetime.strptime(text, '%B %d, %Y').date().isoformat()
        except ValueError:
            pass
        # Fallbacks
        for fmt in ('%d %b %Y', '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
            try:
                return datetime.strptime(text, fmt).date().isoformat()
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(text.replace('Z', '+00:00')).date().isoformat()
        except ValueError:
            return None
