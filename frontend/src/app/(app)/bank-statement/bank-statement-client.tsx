"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatINR, formatDate, cn } from "@/lib/utils";
import type {
  BankStatementViewResponse,
  BankStatementRow,
  BankStatementDrillUpi,
  BankStatementDrillCard,
  BankStatementDrillMmt,
  BankStatementDrillYatra,
  BankStatementDrillType,
  BankStatementDrillReconciledInvoice,
  PaymentMethod,
} from "@/lib/types";

const PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// HDFC bank statement Excel parser (browser-side)
// Mirrors the Python ExcelProcessor: finds rows of **** as delimiters,
// extracts the header row between d1 and d2, data rows between d2 and d3.
// ---------------------------------------------------------------------------

interface ParsedBankRow {
  date: string;
  narration: string;
  chq_ref_no: string | null;
  value_dt: string;
  withdrawal_amt: number | null;
  deposit_amt: number | null;
  closing_balance: number;
}

interface UploadResult {
  inserted: number;
  skipped: number;
  skipped_rows: Array<{
    row: number;
    date: string;
    narration: string;
    deposit_amt: number | null;
    reason: string;
  }>;
}

// Maps a raw header cell text to a DB column name.
// Tries exact match first, then falls back to keyword detection.
function mapColName(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  // Exact / known variants
  const EXACT: Record<string, string> = {
    "date": "date",
    "txn date": "date",
    "transaction date": "date",
    "narration": "narration",
    "description": "narration",
    "particulars": "narration",
    "remarks": "narration",
    "chq./ref.no.": "chq_ref_no",
    "chq/ref no": "chq_ref_no",
    "chq. / ref. no.": "chq_ref_no",
    "cheque no": "chq_ref_no",
    "cheque number": "chq_ref_no",
    "ref no": "chq_ref_no",
    "reference no": "chq_ref_no",
    "value dt": "value_dt",
    "value date": "value_dt",
    "withdrawal amt.": "withdrawal_amt",
    "withdrawal amt": "withdrawal_amt",
    "debit": "withdrawal_amt",
    "debit amount": "withdrawal_amt",
    "dr": "withdrawal_amt",
    "deposit amt.": "deposit_amt",
    "deposit amt": "deposit_amt",
    "credit": "deposit_amt",
    "credit amount": "deposit_amt",
    "cr": "deposit_amt",
    "closing balance": "closing_balance",
    "balance": "closing_balance",
    "balance (inr)": "closing_balance",
  };
  if (EXACT[s]) return EXACT[s];
  // Keyword fallbacks
  if (s.includes("narration") || s.includes("description") || s.includes("particulars")) return "narration";
  if ((s.includes("value") && s.includes("dt")) || (s.includes("value") && s.includes("date"))) return "value_dt";
  if (s.includes("withdrawal") || s.includes("debit") || s === "dr") return "withdrawal_amt";
  if (s.includes("deposit") || s.includes("credit") || s === "cr") return "deposit_amt";
  if (s.includes("balance")) return "closing_balance";
  if ((s.includes("chq") || s.includes("ref")) && !s.includes("balance")) return "chq_ref_no";
  if (s === "date" || (s.includes("date") && !s.includes("value"))) return "date";
  // Unknown — keep as-is (will be ignored during row building)
  return s.replace(/[^a-z0-9]+/g, "_");
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function toISODate(val: unknown): string | null {
  if (val == null || val === "") return null;
  if (val instanceof Date) {
    const d = val;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const s = String(val).trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY (4-digit year)
  const dmy4 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy4) return `${dmy4[3]}-${dmy4[2].padStart(2, "0")}-${dmy4[1].padStart(2, "0")}`;
  // DD/MM/YY (2-digit year) — HDFC format e.g. "01/04/26"
  const dmy2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (dmy2) {
    const yy = parseInt(dmy2[3], 10);
    const yyyy = yy <= 49 ? 2000 + yy : 1900 + yy;
    return `${yyyy}-${dmy2[2].padStart(2, "0")}-${dmy2[1].padStart(2, "0")}`;
  }
  // DD-MM-YYYY or DD-MM-YY
  const dmy3 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dmy3) {
    const yRaw = parseInt(dmy3[3], 10);
    const yyyy = dmy3[3].length === 2 ? (yRaw <= 49 ? 2000 + yRaw : 1900 + yRaw) : yRaw;
    return `${yyyy}-${dmy3[2].padStart(2, "0")}-${dmy3[1].padStart(2, "0")}`;
  }
  // DD MMM YYYY or DD-MMM-YYYY (e.g. "01 Apr 2026")
  const dmyStr = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3})[\s-]+(\d{2,4})$/);
  if (dmyStr) {
    const m = MONTHS[dmyStr[2].toLowerCase()];
    if (m) {
      const yRaw = parseInt(dmyStr[3], 10);
      const yyyy = dmyStr[3].length === 2 ? (yRaw <= 49 ? 2000 + yRaw : 1900 + yRaw) : yRaw;
      return `${yyyy}-${m}-${dmyStr[1].padStart(2, "0")}`;
    }
  }
  // Excel serial date number stored as string (e.g. "45291")
  const serial = parseFloat(s);
  if (!isNaN(serial) && serial > 10000 && serial < 60000) {
    // Excel epoch: Dec 30 1899. JS epoch: Jan 1 1970. Diff = 25569 days.
    const ms = (serial - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  return null;
}

function toNumber(val: unknown): number | null {
  if (val == null || val === "") return null;
  if (typeof val === "number") return isFinite(val) ? val : null;
  const s = String(val).replace(/[₹$,\s]/g, "").trim();
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

async function parseHdfcExcel(file: File): Promise<ParsedBankRow[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  // Use raw:false so xlsx formats dates as strings — consistent across .xls and .xlsx
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd" }) as unknown[][];

  // Find delimiter rows: any row where the first non-null cell contains 4+ asterisks
  const delimIdxs: number[] = [];
  allRows.forEach((row, i) => {
    const first = String((row as unknown[]).find((c) => c != null && String(c).trim() !== "") ?? "");
    if (/\*{4,}/.test(first)) delimIdxs.push(i);
  });

  if (delimIdxs.length < 3) {
    throw new Error(
      `Could not find HDFC delimiter rows (****) — found ${delimIdxs.length}, need at least 3. ` +
      `Make sure this is the correct HDFC bank statement Excel (not a filtered export or CSV).`
    );
  }

  const [d1, d2] = delimIdxs;
  const d3 = delimIdxs[delimIdxs.length - 2]; // second-to-last marks end of data

  // Header row sits between d1 and d2
  const rawHeader = allRows[d1 + 1] as unknown[];
  const cols = rawHeader.map(mapColName);

  // Data rows between d2 and d3
  const dataRows = allRows.slice(d2 + 1, d3);

  const parsed: ParsedBankRow[] = [];
  for (const row of dataRows) {
    const r: Record<string, unknown> = {};
    cols.forEach((col, i) => { r[col] = (row as unknown[])[i] ?? null; });

    // Skip completely empty rows
    if (Object.values(r).every((v) => v == null || v === "")) continue;

    const date = toISODate(r.date);
    const value_dt = toISODate(r.value_dt) ?? date;
    const narration = String(r.narration ?? "").trim();
    const closing_balance = toNumber(r.closing_balance);

    if (!date || !narration || closing_balance == null) continue;

    parsed.push({
      date,
      narration,
      chq_ref_no: r.chq_ref_no ? String(r.chq_ref_no).trim() || null : null,
      value_dt: value_dt!,
      withdrawal_amt: toNumber(r.withdrawal_amt),
      deposit_amt: toNumber(r.deposit_amt),
      closing_balance,
    });
  }

  if (parsed.length === 0 && dataRows.length > 0) {
    // Diagnostic: show what column names were actually detected
    const detectedCols = cols.filter(Boolean).join(", ");
    throw new Error(
      `Found ${dataRows.length} data row(s) but could not parse any. ` +
      `Detected columns: [${detectedCols}]. ` +
      `Expected: date, narration, value_dt, closing_balance. ` +
      `Check that the column headers match the HDFC format.`
    );
  }

  return parsed;
}

const ALL_METHODS: { value: string; label: string }[] = [
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cash", label: "Cash" },
  { value: "mmt_payout", label: "MMT Payout" },
  { value: "unreconciled", label: "Unreconciled" },
];

const ALL_DRILLS: { value: string; label: string }[] = [
  { value: "upi_settlement", label: "UPI settlement" },
  { value: "card_settlement", label: "Card settlement" },
  { value: "mmt_payout", label: "MMT payout" },
  { value: "yatra_payout", label: "Yatra" },
  { value: "none", label: "No drill-down" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function methodBadgeVariant(m: PaymentMethod | null): {
  cls: string;
  label: string;
} {
  switch (m) {
    case "upi":           return { cls: "bg-blue-100 text-blue-800",     label: "UPI" };
    case "card":          return { cls: "bg-purple-100 text-purple-800", label: "Card" };
    case "bank_transfer": return { cls: "bg-slate-100 text-slate-800",   label: "Bank transfer" };
    case "cash":          return { cls: "bg-green-100 text-green-800",   label: "Cash" };
    case "mmt_payout":    return { cls: "bg-orange-100 text-orange-900", label: "MMT payout" };
    default:              return { cls: "bg-muted text-muted-foreground", label: "—" };
  }
}

function drillLabel(t: BankStatementDrillType, count: { upi: number; card: number; mmt: number; yatra: number }): string | null {
  if (!t) return null;
  if (t === "upi_settlement")  return `${count.upi} UPI ${count.upi === 1 ? "transaction" : "transactions"}`;
  if (t === "card_settlement") return `${count.card} card ${count.card === 1 ? "transaction" : "transactions"}`;
  if (t === "mmt_payout")      return `${count.mmt} MMT ${count.mmt === 1 ? "booking" : "bookings"}`;
  if (t === "yatra_payout")    return `${count.yatra} Yatra ${count.yatra === 1 ? "booking" : "bookings"}`;
  return null;
}

function rowColorClass(r: BankStatementRow): string {
  const applied = r.total_amount_applied ?? 0;
  if (applied <= 0) return "";
  if (Math.abs(applied - r.deposit_amt) < 1) return "bg-green-50 hover:bg-green-100";
  if (applied > 0 && applied < r.deposit_amt) return "bg-amber-50 hover:bg-amber-100";
  return "";
}

export function BankStatementClient({ currentRole: _currentRole }: { currentRole: "admin" | "operator" }) {
  const supabase = React.useMemo(() => createClient(), []);
  const toast = useToast();

  // Filters
  const [dateFrom, setDateFrom] = React.useState<string>(daysAgoISO(30));
  const [dateTo, setDateTo] = React.useState<string>(todayISO());
  const [narration, setNarration] = React.useState("");
  const [chqRef, setChqRef] = React.useState("");
  const [invoiceNumber, setInvoiceNumber] = React.useState("");
  const [amountMin, setAmountMin] = React.useState("");
  const [amountMax, setAmountMax] = React.useState("");
  const [methods, setMethods] = React.useState<string[]>([]);
  const [drillTypes, setDrillTypes] = React.useState<string[]>([]);
  const [page, setPage] = React.useState(0);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const filterKey = JSON.stringify({
    dateFrom, dateTo, narration, chqRef, invoiceNumber, amountMin, amountMax, methods, drillTypes, page,
  });

  const view = useQuery<BankStatementViewResponse>({
    queryKey: ["bank-statement.view", filterKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_get_bank_statement_view", {
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_narration: narration.trim() || null,
        p_chq_ref: chqRef.trim() || null,
        p_methods: methods.length ? methods : null,
        p_invoice_number: invoiceNumber.trim() || null,
        p_amount_min: amountMin ? parseFloat(amountMin) : null,
        p_amount_max: amountMax ? parseFloat(amountMax) : null,
        p_drill_types: drillTypes.length ? drillTypes : null,
        p_page: page,
        p_page_size: PAGE_SIZE,
      });
      if (error) throw error;
      return data as BankStatementViewResponse;
    },
  });

  const totalPages = Math.max(1, Math.ceil((view.data?.total_count ?? 0) / PAGE_SIZE));

  const toggleMethod = (v: string) => {
    setMethods((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
    setPage(0);
  };
  const toggleDrill = (v: string) => {
    setDrillTypes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
    setPage(0);
  };
  const clearFilters = () => {
    setDateFrom(daysAgoISO(30));
    setDateTo(todayISO());
    setNarration("");
    setChqRef("");
    setInvoiceNumber("");
    setAmountMin("");
    setAmountMax("");
    setMethods([]);
    setDrillTypes([]);
    setPage(0);
  };

  const [exporting, setExporting] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadResult, setUploadResult] = React.useState<UploadResult | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    try {
      const rows = await parseHdfcExcel(file);
      if (rows.length === 0) {
        toast.show("error", "No valid rows found in this file. Check the file format.");
        return;
      }
      const { data, error } = await supabase.rpc("rpc_upload_bank_statement", { p_rows: rows });
      if (error) throw error;
      setUploadResult(data as UploadResult);
      view.refetch();
    } catch (err: any) {
      toast.show("error", `Upload failed: ${err?.message || "Please try again."}`);
    } finally {
      setUploading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data, error } = await supabase.rpc("rpc_get_bank_statement_view", {
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_narration: narration.trim() || null,
        p_chq_ref: chqRef.trim() || null,
        p_methods: methods.length ? methods : null,
        p_invoice_number: invoiceNumber.trim() || null,
        p_amount_min: amountMin ? parseFloat(amountMin) : null,
        p_amount_max: amountMax ? parseFloat(amountMax) : null,
        p_drill_types: drillTypes.length ? drillTypes : null,
        p_page: null,
        p_page_size: null,
      });
      if (error) throw error;
      const resp = data as BankStatementViewResponse;
      const rows = resp.rows || [];
      const sheetRows = rows.map((r) => ({
        Date: r.date,
        Narration: r.narration,
        "Chq/Ref no": r.chq_ref_no || "",
        "Deposit amount (₹)": r.deposit_amt,
        "Amount applied to invoice (₹)": r.amount_applied ?? "",
        "Total amount applied (₹)": r.total_amount_applied ?? "",
        "Linked invoice": r.invoice_number || "",
        "MMT booking id": r.mmt_booking_id || "",
        "Method": r.payment_method || "",
        "Closing balance (₹)": r.closing_balance,
        "Drill type": r.drill_type || "",
        "UPI count": r.drill_count?.upi ?? 0,
        "Card count": r.drill_count?.card ?? 0,
        "MMT count": r.drill_count?.mmt ?? 0,
        "Yatra count": r.drill_count?.yatra ?? 0,
        "Split index": r.split_index,
        "Split total": r.split_total,
      }));

      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bank Statement");
      const filename = `bank-statement_${dateFrom || "all"}_to_${dateTo || "all"}.xlsx`;
      XLSX.writeFile(wb, filename);

      if (resp.export_capped) {
        toast.show(
          "info",
          `Export capped at 10,000 rows — narrow your filters to export the full dataset.`
        );
      } else {
        toast.show(
          "success",
          `Export downloaded — ${sheetRows.length} row${sheetRows.length === 1 ? "" : "s"}.`
        );
      }
    } catch (err: any) {
      toast.show("error", `Export failed: ${err?.message || "Please try again."}`);
    } finally {
      setExporting(false);
    }
  };

  const rows = view.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Bank Statement</h1>
          <p className="text-sm text-muted-foreground">
            All bank credits with reconciled invoice attribution. Expand a row to see its constituent
            card, UPI, or MMT transactions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
          <Button variant="outline" onClick={handleUploadClick} disabled={uploading}>
            {uploading ? "Uploading…" : "Upload Statement"}
          </Button>
          <Button onClick={handleExport} disabled={exporting || view.isLoading}>
            {exporting ? "Exporting…" : "Export to Excel"}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <div>
              <Label>Date from</Label>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} />
            </div>
            <div>
              <Label>Date to</Label>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} />
            </div>
            <div>
              <Label>Narration</Label>
              <Input value={narration} onChange={(e) => { setNarration(e.target.value); setPage(0); }} placeholder="search…" />
            </div>
            <div>
              <Label>Chq / Ref no</Label>
              <Input value={chqRef} onChange={(e) => { setChqRef(e.target.value); setPage(0); }} placeholder="search…" />
            </div>
            <div>
              <Label>Invoice #</Label>
              <Input value={invoiceNumber} onChange={(e) => { setInvoiceNumber(e.target.value); setPage(0); }} placeholder="e.g. FDR…" />
            </div>
            <div>
              <Label>Min amount (₹)</Label>
              <Input type="number" value={amountMin} onChange={(e) => { setAmountMin(e.target.value); setPage(0); }} />
            </div>
            <div>
              <Label>Max amount (₹)</Label>
              <Input type="number" value={amountMax} onChange={(e) => { setAmountMax(e.target.value); setPage(0); }} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label>Method</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {ALL_METHODS.map((m) => {
                  const active = methods.includes(m.value);
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => toggleMethod(m.value)}
                      className={cn(
                        active
                          ? "rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          : "rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      )}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Label>Drill-down type</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {ALL_DRILLS.map((d) => {
                  const active = drillTypes.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDrill(d.value)}
                      className={cn(
                        active
                          ? "rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          : "rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {view.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading bank statement…</div>
          ) : view.isError ? (
            <div className="p-6 text-sm text-red-700">
              Failed to load: {(view.error as Error).message}. Try refreshing the page.
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No bank-statement deposits match your filters. Try widening the date range or clearing filters.
            </div>
          ) : (
            <Table className="w-full table-auto border border-gray-200 [&_th]:border-r [&_th]:border-gray-200 [&_td]:border-r [&_td]:border-gray-200">
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Narration</TH>
                  <TH>Chq / Ref</TH>
                  <TH className="text-right">Deposit</TH>
                  <TH className="text-right">Applied</TH>
                  <TH>Linked invoice</TH>
                  <TH>Method</TH>
                  {/* Change 2: closing balance column removed */}
                  <TH className="w-8"></TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const rowKey = `${r.bank_id}-${r.split_index}`;
                  const isSplit = r.split_index > 1;
                  const canExpand = r.split_index === 1 && r.drill_type !== null;
                  const isOpen = !!expanded[r.bank_id];
                  const muted = isSplit ? "text-muted-foreground" : "";
                  const colorCls = rowColorClass(r);

                  return (
                    <React.Fragment key={rowKey}>
                      <TR
                        className={cn(
                          colorCls,
                          canExpand && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        )}
                        onClick={canExpand ? () => setExpanded((s) => ({ ...s, [r.bank_id]: !s[r.bank_id] })) : undefined}
                        tabIndex={canExpand ? 0 : undefined}
                        onKeyDown={canExpand ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpanded((s) => ({ ...s, [r.bank_id]: !s[r.bank_id] }));
                          }
                        } : undefined}
                      >
                        <TD className={muted}>
                          {isSplit ? <span className="italic">↳ split</span> : formatDate(r.date)}
                        </TD>
                        <TD className={cn("truncate", muted)} title={r.narration}>
                          {isSplit ? "" : r.narration}
                        </TD>
                        <TD className={cn("font-mono text-xs", muted)}>
                          {isSplit ? "" : (r.chq_ref_no && r.chq_ref_no !== "000000000000000" ? r.chq_ref_no : "—")}
                        </TD>
                        <TD className={cn("text-right tabular-nums", muted)}>
                          {isSplit ? "" : formatINR(r.deposit_amt)}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {r.amount_applied != null ? formatINR(r.amount_applied) : ""}
                        </TD>
                        <TD>
                          {r.invoice_id && r.invoice_number ? (
                            <div className="flex flex-col">
                              <Link
                                href={`/invoices/${r.invoice_id}`}
                                className="text-primary underline-offset-2 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {r.invoice_number}
                              </Link>
                              {r.mmt_booking_id ? (
                                <span className="text-xs text-muted-foreground">{r.mmt_booking_id}</span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TD>
                        <TD>
                          {r.payment_method ? (
                            <Badge className={methodBadgeVariant(r.payment_method).cls}>
                              {methodBadgeVariant(r.payment_method).label}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TD>
                        {/* Change 2: closing balance TD removed */}
                        <TD className="text-right">
                          {canExpand ? (
                            // Change 3: chevron is visual indicator only, click handled by TR
                            <span
                              className="rounded-md px-2 py-1 text-xs text-muted-foreground"
                              title={drillLabel(r.drill_type, r.drill_count) || ""}
                              aria-hidden="true"
                            >
                              {isOpen ? "▾" : "▸"}
                            </span>
                          ) : null}
                        </TD>
                      </TR>
                      {canExpand && isOpen ? (
                        // Change 5 & 8: colSpan=8 (was 9), tinted bg, drill-down inside
                        <TR>
                          <TD colSpan={8} className="p-0">
                            <div className="bg-slate-50 pl-6">
                              <DrillDown bankId={r.bank_id} drillType={r.drill_type!} />
                            </div>
                          </TD>
                        </TR>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
        {view.data && view.data.total_count > 0 ? (
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
            <div className="text-muted-foreground">
              {view.data.total_count} total rows — page {page + 1} / {totalPages}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page + 1 >= totalPages}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Upload result modal */}
      {uploadResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">Upload Result</h2>
            <div className="mb-4 flex gap-6">
              <div className="flex items-center gap-2 rounded-md bg-green-50 px-4 py-3">
                <span className="text-2xl font-bold text-green-700">{uploadResult.inserted}</span>
                <span className="text-sm text-green-800">rows inserted</span>
              </div>
              <div className="flex items-center gap-2 rounded-md bg-yellow-50 px-4 py-3">
                <span className="text-2xl font-bold text-yellow-700">{uploadResult.skipped}</span>
                <span className="text-sm text-yellow-800">rows skipped (duplicate)</span>
              </div>
            </div>
            {uploadResult.skipped_rows.length > 0 && (
              <div className="mb-4 max-h-64 overflow-auto rounded border border-gray-200">
                <Table className="w-full table-auto border border-gray-200 [&_th]:border-r [&_th]:border-gray-200 [&_td]:border-r [&_td]:border-gray-200">
                  <THead>
                    <TR>
                      <TH>Row #</TH>
                      <TH>Date</TH>
                      <TH>Narration</TH>
                      <TH className="text-right">Deposit (₹)</TH>
                      <TH>Reason</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {uploadResult.skipped_rows.map((r) => (
                      <TR key={r.row}>
                        <TD className="tabular-nums">{r.row}</TD>
                        <TD>{formatDate(r.date)}</TD>
                        <TD className="max-w-xs truncate text-xs" title={r.narration}>{r.narration}</TD>
                        <TD className="text-right tabular-nums">{r.deposit_amt != null ? formatINR(r.deposit_amt) : "—"}</TD>
                        <TD><Badge className="bg-yellow-100 text-yellow-800">{r.reason}</Badge></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => setUploadResult(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DrillDown helpers
// ---------------------------------------------------------------------------

function ReconciledToCell({ invoices }: { invoices: BankStatementDrillReconciledInvoice[] }) {
  if (!invoices || invoices.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <>
      {invoices.map((inv) => (
        <div key={inv.hotel_invoice_id}>
          <Link
            href={`/invoices/${inv.hotel_invoice_id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-primary underline-offset-2 hover:underline text-xs"
          >
            {inv.invoice_number}
          </Link>
        </div>
      ))}
    </>
  );
}

function drillRowTintClass(appliedTotal: number | null, baseAmount: number): string {
  if (!appliedTotal || appliedTotal <= 0) return "";
  if (Math.abs(appliedTotal - baseAmount) < 1) return "bg-green-50";
  if (appliedTotal > 0 && appliedTotal < baseAmount) return "bg-amber-50";
  return "";
}

function DrillDown({ bankId, drillType }: { bankId: string; drillType: NonNullable<BankStatementDrillType> }) {
  const supabase = React.useMemo(() => createClient(), []);
  const q = useQuery({
    queryKey: ["bank-statement.drill", bankId, drillType],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_get_bank_statement_drilldown", {
        p_bank_statement_id: bankId,
        p_drill_type: drillType,
      });
      if (error) throw error;
      return (data as { rows: any[] }).rows ?? [];
    },
    staleTime: Infinity,
  });

  if (q.isLoading) {
    return <div className="px-6 py-3 text-xs text-muted-foreground">Loading details…</div>;
  }
  if (q.isError) {
    return <div className="px-6 py-3 text-xs text-red-700">Failed to load drill-down: {(q.error as Error).message}</div>;
  }
  const rows = q.data || [];
  if (rows.length === 0) {
    return (
      <div className="px-6 py-3 text-xs text-muted-foreground">
        No matching settlement found in our records — this bank credit may pre-date settlement ingestion
        or the amount/date doesn&apos;t tie out.
      </div>
    );
  }

  if (drillType === "upi_settlement") {
    return (
      <div className="py-3 pr-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          UPI transactions in this settlement ({rows.length})
        </div>
        <Table className="w-full table-auto border border-gray-200 [&_th]:border-r [&_th]:border-gray-200 [&_td]:border-r [&_td]:border-gray-200">
          <THead>
            <TR>
              <TH>Txn date</TH>
              <TH>Settled</TH>
              <TH>VPA</TH>
              <TH>UPI txn id</TH>
              <TH className="text-right">Amount</TH>
              <TH>Reconciled To</TH>
            </TR>
          </THead>
          <TBody>
            {(rows as BankStatementDrillUpi[]).map((u) => (
              <TR key={u.id} className={cn(drillRowTintClass(u.applied_total, u.base_amount))}>
                <TD>{formatDate(u.transaction_date)}</TD>
                <TD>{formatDate(u.settlement_date)}</TD>
                <TD className="font-mono text-xs">{u.vpa || "—"}</TD>
                <TD className="font-mono text-xs">{u.upi_transaction_id || "—"}</TD>
                <TD className="text-right tabular-nums">{formatINR(u.amount)}</TD>
                <TD>
                  <ReconciledToCell invoices={u.reconciled_invoices ?? []} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    );
  }

  if (drillType === "card_settlement") {
    return (
      <div className="py-3 pr-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Card transactions in this settlement ({rows.length})
        </div>
        <Table className="w-full table-auto border border-gray-200 [&_th]:border-r [&_th]:border-gray-200 [&_td]:border-r [&_td]:border-gray-200">
          <THead>
            <TR>
              <TH>Txn date</TH>
              <TH>Settled</TH>
              <TH className="text-right">Gross</TH>
              <TH className="text-right">MDR %</TH>
              <TH className="text-right">Net after MDR</TH>
              <TH>Reconciled To</TH>
            </TR>
          </THead>
          <TBody>
            {(rows as BankStatementDrillCard[]).map((c) => (
              <TR key={c.id} className={cn(drillRowTintClass(c.applied_total, c.base_amount))}>
                <TD>{formatDate(c.transaction_date)}</TD>
                <TD>{formatDate(c.settlement_date)}</TD>
                <TD className="text-right tabular-nums">{formatINR(c.gross_amount)}</TD>
                <TD className="text-right tabular-nums">{Number(c.mdr_percent).toFixed(2)}%</TD>
                <TD className="text-right tabular-nums">{formatINR(c.net_after_mdr)}</TD>
                <TD>
                  <ReconciledToCell invoices={c.reconciled_invoices ?? []} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    );
  }

  if (drillType === "mmt_payout") {
    return (
      <div className="py-3 pr-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          MMT bookings in this payout ({rows.length})
        </div>
        <Table className="w-full table-auto border border-gray-200 [&_th]:border-r [&_th]:border-gray-200 [&_td]:border-r [&_td]:border-gray-200">
          <THead>
            <TR>
              <TH>Booking ID</TH>
              <TH>PNR</TH>
              <TH>Guest</TH>
              <TH>Hotel</TH>
              <TH>Check-in</TH>
              <TH>Check-out</TH>
              <TH className="text-right">Payable</TH>
              <TH>Reconciled To</TH>
            </TR>
          </THead>
          <TBody>
            {(rows as BankStatementDrillMmt[]).map((m) => (
              <TR key={m.id} className={cn(drillRowTintClass(m.applied_total, m.base_amount))}>
                <TD className="font-mono text-xs">{m.booking_id}</TD>
                <TD className="font-mono text-xs">{m.booking_pnr || "—"}</TD>
                <TD>{m.client_name || "—"}</TD>
                <TD className="max-w-[180px] truncate" title={m.hotel_name || ""}>{m.hotel_name || "—"}</TD>
                <TD>{formatDate(m.check_in)}</TD>
                <TD>{formatDate(m.check_out)}</TD>
                <TD className="text-right tabular-nums">{formatINR(m.payable)}</TD>
                <TD>
                  <ReconciledToCell invoices={m.reconciled_invoices ?? []} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    );
  }

  // yatra_payout
  return (
    <div className="py-3 pr-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Yatra bookings in this payout ({rows.length})
      </div>
      <Table className="w-full table-auto border border-gray-200 [&_th]:border-r [&_th]:border-gray-200 [&_td]:border-r [&_td]:border-gray-200">
        <THead>
          <TR>
            <TH>Voucher No</TH>
            <TH>Guest</TH>
            <TH>Hotel</TH>
            <TH className="text-right">Amount</TH>
            <TH>Reconciled To</TH>
          </TR>
        </THead>
        <TBody>
          {(rows as BankStatementDrillYatra[]).map((y) => (
            <TR key={y.id} className={cn(drillRowTintClass(y.applied_total, y.base_amount))}>
              <TD className="font-mono text-xs">{y.voucher_no}</TD>
              <TD>{y.guest_name || "—"}</TD>
              <TD className="max-w-[180px] truncate" title={y.hotel_name || ""}>{y.hotel_name || "—"}</TD>
              <TD className="text-right tabular-nums">{formatINR(y.yatra_to_pay_hotel)}</TD>
              <TD>
                <ReconciledToCell invoices={y.reconciled_invoices ?? []} />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
