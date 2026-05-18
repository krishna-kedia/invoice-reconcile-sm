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
  BankStatementDrillUpi,
  BankStatementDrillCard,
  BankStatementDrillMmt,
  BankStatementDrillType,
  PaymentMethod,
} from "@/lib/types";

const PAGE_SIZE = 100;

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

function drillLabel(t: BankStatementDrillType, count: { upi: number; card: number; mmt: number }): string | null {
  if (!t) return null;
  if (t === "upi_settlement")  return `${count.upi} UPI ${count.upi === 1 ? "transaction" : "transactions"}`;
  if (t === "card_settlement") return `${count.card} card ${count.card === 1 ? "transaction" : "transactions"}`;
  if (t === "mmt_payout")      return `${count.mmt} MMT ${count.mmt === 1 ? "booking" : "bookings"}`;
  return null;
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
        "Linked invoice": r.invoice_number || "",
        "MMT booking id": r.mmt_booking_id || "",
        "Method": r.payment_method || "",
        "Closing balance (₹)": r.closing_balance,
        "Drill type": r.drill_type || "",
        "UPI count": r.drill_count?.upi ?? 0,
        "Card count": r.drill_count?.card ?? 0,
        "MMT count": r.drill_count?.mmt ?? 0,
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
          <Button onClick={handleExport} disabled={exporting || view.isLoading}>
            {exporting ? "Exporting…" : "Export to Excel"}
          </Button>
        </div>
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
                        "rounded-md border px-2 py-1 text-xs font-medium transition",
                        active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
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
                        "rounded-md border px-2 py-1 text-xs font-medium transition",
                        active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
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
            <Table>
              <THead>
                <TR>
                  <TH className="w-[110px]">Date</TH>
                  <TH>Narration</TH>
                  <TH className="w-[160px]">Chq / Ref</TH>
                  <TH className="w-[140px] text-right">Deposit</TH>
                  <TH className="w-[140px] text-right">Applied</TH>
                  <TH className="w-[180px]">Linked invoice</TH>
                  <TH className="w-[120px]">Method</TH>
                  <TH className="w-[140px] text-right">Closing bal.</TH>
                  <TH className="w-[60px]"></TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const rowKey = `${r.bank_id}-${r.split_index}`;
                  const isSplit = r.split_index > 1;
                  const isUnreconciled = r.link_id === null;
                  const canExpand = r.split_index === 1 && r.drill_type !== null;
                  const isOpen = !!expanded[r.bank_id];
                  const muted = isSplit ? "text-muted-foreground" : "";
                  const borderCls = isUnreconciled && !isSplit ? "border-l-2 border-amber-400" : "";

                  return (
                    <React.Fragment key={rowKey}>
                      <TR className={cn(borderCls)}>
                        <TD className={muted}>
                          {isSplit ? <span className="italic">↳ split</span> : formatDate(r.date)}
                        </TD>
                        <TD className={cn("max-w-[420px] truncate", muted)} title={r.narration}>
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
                        <TD className={cn("text-right tabular-nums", muted)}>
                          {isSplit ? "" : formatINR(r.closing_balance)}
                        </TD>
                        <TD className="text-right">
                          {canExpand ? (
                            <button
                              type="button"
                              className="rounded-md px-2 py-1 text-xs hover:bg-muted"
                              onClick={() => setExpanded((s) => ({ ...s, [r.bank_id]: !s[r.bank_id] }))}
                              aria-label={isOpen ? "Collapse" : "Expand"}
                              title={drillLabel(r.drill_type, r.drill_count) || ""}
                            >
                              {isOpen ? "▾" : "▸"}
                            </button>
                          ) : null}
                        </TD>
                      </TR>
                      {canExpand && isOpen ? (
                        <TR>
                          <TD colSpan={9} className="bg-muted/30 p-0">
                            <DrillDown bankId={r.bank_id} drillType={r.drill_type!} />
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
    </div>
  );
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
      <div className="px-6 py-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          UPI transactions in this settlement ({rows.length})
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Txn date</TH>
              <TH>Settled</TH>
              <TH>VPA</TH>
              <TH>UPI txn id</TH>
              <TH className="text-right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {(rows as BankStatementDrillUpi[]).map((u) => (
              <TR key={u.id}>
                <TD>{formatDate(u.transaction_date)}</TD>
                <TD>{formatDate(u.settlement_date)}</TD>
                <TD className="font-mono text-xs">{u.vpa || "—"}</TD>
                <TD className="font-mono text-xs">{u.upi_transaction_id || "—"}</TD>
                <TD className="text-right tabular-nums">{formatINR(u.amount)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    );
  }

  if (drillType === "card_settlement") {
    return (
      <div className="px-6 py-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Card transactions in this settlement ({rows.length})
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Txn date</TH>
              <TH>Settled</TH>
              <TH className="text-right">Gross</TH>
              <TH className="text-right">MDR %</TH>
              <TH className="text-right">Net after MDR</TH>
            </TR>
          </THead>
          <TBody>
            {(rows as BankStatementDrillCard[]).map((c) => (
              <TR key={c.id}>
                <TD>{formatDate(c.transaction_date)}</TD>
                <TD>{formatDate(c.settlement_date)}</TD>
                <TD className="text-right tabular-nums">{formatINR(c.gross_amount)}</TD>
                <TD className="text-right tabular-nums">{Number(c.mdr_percent).toFixed(2)}%</TD>
                <TD className="text-right tabular-nums">{formatINR(c.net_after_mdr)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    );
  }

  // mmt_payout
  return (
    <div className="px-6 py-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        MMT bookings in this payout ({rows.length})
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Booking ID</TH>
            <TH>PNR</TH>
            <TH>Guest</TH>
            <TH>Hotel</TH>
            <TH>Check-in</TH>
            <TH>Check-out</TH>
            <TH className="text-right">Payable</TH>
            <TH>Hotel invoice</TH>
          </TR>
        </THead>
        <TBody>
          {(rows as BankStatementDrillMmt[]).map((m) => (
            <TR key={m.id}>
              <TD className="font-mono text-xs">{m.booking_id}</TD>
              <TD className="font-mono text-xs">{m.booking_pnr || "—"}</TD>
              <TD>{m.client_name || "—"}</TD>
              <TD className="max-w-[180px] truncate" title={m.hotel_name || ""}>{m.hotel_name || "—"}</TD>
              <TD>{formatDate(m.check_in)}</TD>
              <TD>{formatDate(m.check_out)}</TD>
              <TD className="text-right tabular-nums">{formatINR(m.payable)}</TD>
              <TD>
                {m.hotel_invoice_id ? (
                  <Link
                    href={`/invoices/${m.hotel_invoice_id}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {m.hotel_invoice_number || "open"}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
