"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatINR, formatDate } from "@/lib/utils";
import { parsePaymentFolio, sha256Hex } from "@/lib/xls/parse-payment-folio";
import type { PaymentFolioRow } from "@/lib/xls/parse-payment-folio";

interface UploadResult {
  inserted: number;
  skipped_duplicates: number;
  total: number;
}

export default function PaymentFolioPage() {
  const supabase = React.useMemo(() => createClient(), []);

  // File state
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [fileSize, setFileSize] = React.useState<number>(0);
  const [rows, setRows] = React.useState<PaymentFolioRow[]>([]);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [rawBuffer, setRawBuffer] = React.useState<ArrayBuffer | null>(null);

  // Upload state
  const [uploading, setUploading] = React.useState(false);
  const [uploadResult, setUploadResult] = React.useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  // Drag-and-drop state
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function resetState() {
    setRows([]);
    setParseError(null);
    setUploadResult(null);
    setUploadError(null);
    setRawBuffer(null);
  }

  async function handleFile(file: File) {
    resetState();
    setFileName(file.name);
    setFileSize(file.size);

    const buffer = await file.arrayBuffer();
    setRawBuffer(buffer);

    try {
      const parsed = parsePaymentFolio(buffer);
      if (parsed.length === 0) {
        setParseError(
          "No valid rows found in this file. Make sure the sheet has Payment Type and Payment Amount columns with data."
        );
        return;
      }
      setRows(parsed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setParseError(`Could not read the file: ${msg}`);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset the input so the same file can be re-selected after an error
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function handleUpload() {
    if (!rawBuffer || rows.length === 0 || !fileName) return;
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);

    let sha: string;
    try {
      sha = await sha256Hex(rawBuffer);
    } catch {
      setUploadError("Could not compute file checksum. Try again.");
      setUploading(false);
      return;
    }

    const payload = rows.map((r) => ({
      booking_id: r.booking_id,
      invoice_number: r.invoice_number,
      payment_type: r.payment_type,
      transaction_date: r.transaction_date,
      reference_text: r.reference_text,
      payment_amount: r.payment_amount,
    }));

    const { data, error } = await supabase.rpc("rpc_upload_payment_folio", {
      p_file_name: fileName,
      p_file_size_bytes: fileSize,
      p_sha256: sha,
      p_rows: payload,
    });

    setUploading(false);

    if (error) {
      const msg = error.message || String(error);
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("already uploaded")) {
        setUploadError("This file has already been uploaded (duplicate detected). No rows were added.");
      } else {
        setUploadError(`Upload failed: ${msg.replace(/^[A-Z0-9]{5}:\s*/g, "").replace(/^error(:\s*)?/i, "")}`);
      }
      return;
    }

    const result = data as UploadResult;
    setUploadResult(result);
    // Clear parsed rows so the user can pick another file
    setRows([]);
    setRawBuffer(null);
    setFileName(null);
  }

  const PREVIEW_LIMIT = 10;
  const previewRows = rows.slice(0, PREVIEW_LIMIT);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold">Payment Folio Upload</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a Payment Folio Excel file (.xls or .xlsx) to import payment
          entries. Duplicate rows are detected automatically and skipped.
        </p>
      </div>

      {/* Drop zone */}
      <Card>
        <CardContent className="pt-6">
          <div
            role="button"
            tabIndex={0}
            aria-label="Drop an Excel file here or click to browse"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            className={[
              "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-12 cursor-pointer transition-colors select-none",
              dragOver
                ? "border-blue-400 bg-blue-50"
                : "border-muted-foreground/30 hover:border-muted-foreground/50 hover:bg-muted/30",
            ].join(" ")}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-muted-foreground"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="12" x2="12" y2="18" />
              <polyline points="9 15 12 12 15 15" />
            </svg>
            <div className="text-center">
              <p className="text-sm font-medium">
                Drop a Payment Folio file here
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                or click to browse — accepts .xls and .xlsx
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={onInputChange}
            />
          </div>

          {fileName && rows.length === 0 && !parseError && (
            <p className="mt-3 text-sm text-muted-foreground">
              Parsing <span className="font-medium">{fileName}</span>…
            </p>
          )}
        </CardContent>
      </Card>

      {/* Parse error */}
      {parseError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">Could not read the file</p>
          <p className="mt-1">{parseError}</p>
        </div>
      )}

      {/* Upload success */}
      {uploadResult && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <p className="font-semibold">Upload complete</p>
          <ul className="mt-1 space-y-0.5 list-disc list-inside">
            <li>{uploadResult.inserted} row{uploadResult.inserted !== 1 ? "s" : ""} inserted</li>
            <li>{uploadResult.skipped_duplicates} duplicate{uploadResult.skipped_duplicates !== 1 ? "s" : ""} skipped</li>
            <li>{uploadResult.total} row{uploadResult.total !== 1 ? "s" : ""} in file</li>
          </ul>
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">Upload failed</p>
          <p className="mt-1">{uploadError}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? "Retrying…" : "Retry upload"}
          </Button>
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">
                Preview — {rows.length} row{rows.length !== 1 ? "s" : ""} parsed
                {rows.length > PREVIEW_LIMIT && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    (showing first {PREVIEW_LIMIT})
                  </span>
                )}
              </CardTitle>
              {fileName && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  File: <span className="font-medium">{fileName}</span>
                </p>
              )}
            </div>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? "Uploading…" : `Upload ${rows.length} row${rows.length !== 1 ? "s" : ""}`}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Booking ID</TH>
                  <TH>Invoice #</TH>
                  <TH>Payment Type</TH>
                  <TH>Date</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Reference</TH>
                </TR>
              </THead>
              <TBody>
                {previewRows.map((row, i) => (
                  <TR key={i}>
                    <TD className="font-mono text-xs">{row.booking_id ?? "—"}</TD>
                    <TD className="text-xs">{row.invoice_number ?? "—"}</TD>
                    <TD>
                      <Badge variant="outline" className="text-xs">
                        {row.payment_type}
                      </Badge>
                    </TD>
                    <TD>{row.transaction_date ? formatDate(row.transaction_date) : "—"}</TD>
                    <TD className="text-right tabular-nums font-medium">
                      {formatINR(row.payment_amount)}
                    </TD>
                    <TD className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {row.reference_text ?? "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {rows.length > PREVIEW_LIMIT && (
              <div className="px-4 py-3 text-xs text-muted-foreground border-t">
                ... and {rows.length - PREVIEW_LIMIT} more rows not shown in preview
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
