import * as XLSX from "xlsx";

export interface PaymentFolioRow {
  booking_id: string | null;
  invoice_number: string | null;
  payment_type: string;
  transaction_date: string | null; // YYYY-MM-DD
  reference_text: string | null;
  payment_amount: number;
}

function cleanStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

/**
 * Parse a date value that xlsx may return as a JS Date, a serial number, or a
 * string in various formats.  Returns YYYY-MM-DD or null.
 */
function parseDate(val: unknown): string | null {
  if (val === null || val === undefined) return null;

  // xlsx cellDates:true returns JS Date objects for date cells
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const s = String(val).trim();
  if (!s) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  // Fallback: let Date parse it
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Parses a Payment Folio Excel file (.xls or .xlsx) from an ArrayBuffer.
 *
 * Expected columns (first sheet):
 *   Booking ID, Invoice Number (or Invoice No), Payment Type,
 *   Received Date, Reference Text (or Reference), Payment Amount (or Amount)
 *
 * Returns rows filtered to those with a non-empty payment_type and amount > 0.
 */
export function parsePaymentFolio(buffer: ArrayBuffer): PaymentFolioRow[] {
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("The file appears to be empty — no sheets found.");
  }

  const sheet = workbook.Sheets[sheetName];
  // defval: null means missing cells come back as null rather than undefined
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  if (rows.length === 0) {
    throw new Error("The sheet is empty — no data rows were found.");
  }

  return rows
    .map((row): PaymentFolioRow => {
      const paymentType = cleanStr(row["Payment Type"]) ?? "";
      const rawAmount =
        row["Payment Amount"] ?? row["Amount"] ?? row["payment_amount"] ?? 0;
      const amount = parseFloat(String(rawAmount)) || 0;

      return {
        booking_id: cleanStr(row["Booking ID"] ?? row["booking_id"]),
        invoice_number: cleanStr(
          row["Invoice Number"] ?? row["Invoice No"] ?? row["invoice_number"]
        ),
        payment_type: paymentType,
        transaction_date: parseDate(
          row["Received Date"] ?? row["received_date"] ?? row["Date"]
        ),
        reference_text: cleanStr(
          row["Reference Text"] ??
            row["Reference"] ??
            row["reference_text"] ??
            row["Narration"]
        ),
        payment_amount: amount,
      };
    })
    .filter((r) => r.payment_type.trim() !== "" && r.payment_amount > 0);
}

/**
 * Computes the SHA-256 hex digest of an ArrayBuffer using the Web Crypto API.
 * Works in all modern browsers and Node 20+.
 */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
