"""Direct Yatra-payout-JSON to Database inserter.

Handles one parsed Yatra payout JSON file. Unlike MMT, each Yatra file
represents a single booking (no `transfer` wrapper, no `bookings[]` array).

Idempotent: if the `voucher_no` already exists in `yatra_bookings_payout`
the record is NOT overwritten; the call returns success=True, skipped=True.
"""

import logging
import math
from datetime import datetime
from typing import Any, Dict, Optional

logger = logging.getLogger('invoice_reconcile')


class YatraPayoutInserter:
    """Insert one parsed Yatra payout JSON into Supabase."""

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
        """Insert one Yatra payout JSON document.

        Args:
            file_id: UUID of the file row in `files`.
            parsed_json: The deserialised JSON object.

        Returns:
            Dict with keys:
              - success (bool)
              - inserted (bool)   — True if a new yatra_bookings_payout row was added.
              - skipped (bool)    — True if the voucher_no already existed.
              - voucher_no (str | None) — The natural key, if parsed.
              - errors (list[dict])     — Validation/insert errors.
        """
        # ---- 1. Validate top-level shape ----------------------------------------
        if not isinstance(parsed_json, dict):
            raise ValueError(
                f"Expected JSON object at top level, got {type(parsed_json).__name__}"
            )

        voucher_no = self._safe_str(parsed_json.get('voucherNo'))
        if not voucher_no:
            raise ValueError("voucherNo is required and missing")

        # ---- 2. Extract sub-objects -----------------------------------------------
        guest = parsed_json.get('guest') or {}
        if not isinstance(guest, dict):
            guest = {}

        booking = parsed_json.get('booking') or {}
        if not isinstance(booking, dict):
            booking = {}

        hotel = parsed_json.get('hotel') or {}
        if not isinstance(hotel, dict):
            hotel = {}

        commercials = parsed_json.get('commercials') or {}
        if not isinstance(commercials, dict):
            commercials = {}

        # ---- 3. Check idempotency ------------------------------------------------
        try:
            existing = (
                self.db_client.client
                .table('yatra_bookings_payout')
                .select('voucher_no')
                .eq('voucher_no', voucher_no)
                .limit(1)
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"Failed to query yatra_bookings_payout: {exc}") from exc

        if existing.data:
            logger.info(
                f"yatra_bookings_payout row already exists for voucher_no={voucher_no}; skipping"
            )
            return {
                'success': True,
                'inserted': False,
                'skipped': True,
                'voucher_no': voucher_no,
                'errors': [],
            }

        # ---- 4. Build row --------------------------------------------------------
        row = {
            'voucher_no':                voucher_no,
            'file_id':                   file_id,
            'guest_name':                self._safe_str(guest.get('name')),
            'guest_email':               self._safe_str(guest.get('email')),
            'guest_phone':               self._safe_str(guest.get('phone')),
            'email_date':                self._parse_iso_timestamp(parsed_json.get('emailDate')),
            'is_pre_pay':                bool(parsed_json.get('isPrePay')) if parsed_json.get('isPrePay') is not None else None,
            'booking_date':              self._parse_date_d_mon_yyyy(booking.get('bookingDate')),
            'check_in':                  self._parse_date_d_mon_yyyy(booking.get('checkIn')),
            'check_out':                 self._parse_date_d_mon_yyyy(booking.get('checkOut')),
            'number_of_rooms':           self._safe_str(booking.get('numberOfRooms')),
            'adults':                    self._safe_str(booking.get('adults')),
            'children':                  self._safe_str(booking.get('children')),
            'room_name':                 self._safe_str(booking.get('roomName')),
            'room_type':                 self._safe_str(booking.get('roomType')),
            'rate_plan_type':            self._safe_str(booking.get('ratePlanType')),
            'total_room_charges':        self._parse_number(commercials.get('totalRoomCharges'),
                                                             required=False,
                                                             field='commercials.totalRoomCharges'),
            'other_charges':             self._parse_number(commercials.get('otherCharges'),
                                                             required=False,
                                                             field='commercials.otherCharges'),
            'hotel_gross_charges':       self._parse_number(commercials.get('hotelGrossCharges'),
                                                             required=False,
                                                             field='commercials.hotelGrossCharges'),
            'yatra_commission':          self._parse_number(commercials.get('yatraCommission'),
                                                             required=False,
                                                             field='commercials.yatraCommission'),
            'yatra_commission_with_gst': self._parse_number(commercials.get('yatraCommissionWithGST'),
                                                             required=False,
                                                             field='commercials.yatraCommissionWithGST'),
            'gst':                       self._parse_number(commercials.get('gst'),
                                                             required=False,
                                                             field='commercials.gst'),
            'tcs':                       self._parse_number(commercials.get('tcs'),
                                                             required=False,
                                                             field='commercials.tcs'),
            'tds':                       self._parse_number(commercials.get('tds'),
                                                             required=False,
                                                             field='commercials.tds'),
            'yatra_to_pay_hotel':        self._parse_number(commercials.get('yatraToPayHotel'),
                                                             required=False,
                                                             field='commercials.yatraToPayHotel'),
        }

        # ---- 5. Insert (idempotent race guard) -----------------------------------
        try:
            self.db_client.client.table('yatra_bookings_payout').insert(row).execute()
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            # Another worker may have raced us to the same voucher_no
            if '23505' in msg or 'duplicate key' in msg.lower():
                logger.info(
                    f"yatra_bookings_payout row already existed for voucher_no={voucher_no} (race)"
                )
                return {
                    'success': True,
                    'inserted': False,
                    'skipped': True,
                    'voucher_no': voucher_no,
                    'errors': [],
                }
            raise ValueError(
                f"Failed to insert yatra_bookings_payout row for {voucher_no}: {msg}"
            ) from exc

        logger.info(f"Inserted yatra_bookings_payout row for voucher_no={voucher_no}")
        return {
            'success': True,
            'inserted': True,
            'skipped': False,
            'voucher_no': voucher_no,
            'errors': [],
        }

    # ---- Helpers (copied from MmtPayoutInserter for parity) -----------------

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

    @staticmethod
    def _parse_date_d_mon_yyyy(value: Any) -> Optional[str]:
        """Parse Yatra's "DD Mon YYYY" format (e.g. "09 Jan 2026") into ISO YYYY-MM-DD.

        Falls back to ISO date parsing if the primary format fails.
        Returns None for empty/missing input.
        """
        if value is None or value == '':
            return None
        text = str(value).strip()
        if not text:
            return None
        # Primary: Yatra format — "09 Jan 2026"
        try:
            return datetime.strptime(text, '%d %b %Y').date().isoformat()
        except ValueError:
            pass
        # Fallbacks: ISO and dash-separated variants
        for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
            try:
                return datetime.strptime(text, fmt).date().isoformat()
            except ValueError:
                continue
        # Last resort: full ISO timestamp with timezone
        try:
            return datetime.fromisoformat(text.replace('Z', '+00:00')).date().isoformat()
        except ValueError:
            return None
