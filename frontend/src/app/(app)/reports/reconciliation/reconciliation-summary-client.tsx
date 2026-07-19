"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, startOfMonth, subMonths, endOfMonth } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/utils";
import type { ReconciliationMonthSummary } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDefaults() {
  const today = new Date();
  const fromDate = startOfMonth(subMonths(today, 11));
  return {
    fromMonth: format(fromDate, "yyyy-MM"),
    toMonth: format(today, "yyyy-MM"),
    dateFrom: format(fromDate, "yyyy-MM-dd"),
    dateTo: format(today, "yyyy-MM-dd"),
  };
}

function monthLabel(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(d);
}

function zero(n: number | undefined | null): number {
  return n ?? 0;
}

function roundOutstanding(v: number): number {
  return Math.abs(v) < 1 ? 0 : v;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <TR key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TD key={j}>
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
            </TD>
          ))}
        </TR>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Totals computation
// ---------------------------------------------------------------------------

function computeTotals(rows: ReconciliationMonthSummary[]) {
  return rows.reduce(
    (acc, r) => ({
      invoice_count: acc.invoice_count + zero(r.invoice_count),
      gross_billed: acc.gross_billed + zero(r.gross_billed),
      taxable_amount: acc.taxable_amount + zero(r.taxable_amount),
      gst: acc.gst + zero(r.gst),
      received_mmt: acc.received_mmt + zero(r.received?.mmt),
      received_goibibo: acc.received_goibibo + zero(r.received?.goibibo),
      received_card: acc.received_card + zero(r.received?.card),
      received_upi: acc.received_upi + zero(r.received?.upi),
      received_cash: acc.received_cash + zero(r.received?.cash),
      received_bank_transfer: acc.received_bank_transfer + zero(r.received?.bank_transfer),
      received_another_machine: acc.received_another_machine + zero(r.received?.another_machine),
      received_other: acc.received_other + zero(r.received?.other),
      received_total: acc.received_total + zero(r.received?.total),
      deductions_commission: acc.deductions_commission + zero(r.deductions?.commission),
      deductions_gst_on_commission: acc.deductions_gst_on_commission + zero(r.deductions?.gst_on_commission),
      deductions_tds: acc.deductions_tds + zero(r.deductions?.tds),
      deductions_tcs: acc.deductions_tcs + zero(r.deductions?.tcs),
      deductions_mdr: acc.deductions_mdr + zero(r.deductions?.mdr),
      deductions_total: acc.deductions_total + zero(r.deductions?.total),
      outstanding: acc.outstanding + zero(r.outstanding),
    }),
    {
      invoice_count: 0,
      gross_billed: 0,
      taxable_amount: 0,
      gst: 0,
      received_mmt: 0,
      received_goibibo: 0,
      received_card: 0,
      received_upi: 0,
      received_cash: 0,
      received_bank_transfer: 0,
      received_another_machine: 0,
      received_other: 0,
      received_total: 0,
      deductions_commission: 0,
      deductions_gst_on_commission: 0,
      deductions_tds: 0,
      deductions_tcs: 0,
      deductions_mdr: 0,
      deductions_total: 0,
      outstanding: 0,
    }
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReconciliationSummaryClient({
  initialFrom,
  initialTo,
}: {
  initialFrom?: string;
  initialTo?: string;
}) {
  const defaults = React.useMemo(() => getDefaults(), []);

  const [fromMonth, setFromMonth] = React.useState(
    initialFrom?.slice(0, 7) ?? defaults.fromMonth
  );
  const [toMonth, setToMonth] = React.useState(
    initialTo?.slice(0, 7) ?? defaults.toMonth
  );
  const [dateFrom, setDateFrom] = React.useState(
    initialFrom ?? defaults.dateFrom
  );
  const [dateTo, setDateTo] = React.useState(
    initialTo ?? defaults.dateTo
  );

  const supabase = React.useMemo(() => createClient(), []);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["reconciliation-monthly-summary", dateFrom, dateTo],
    queryFn: async () => {
      const { data: rows, error: rpcError } = await supabase.rpc(
        "rpc_get_reconciliation_monthly_summary",
        { p_date_from: dateFrom, p_date_to: dateTo }
      );
      if (rpcError) throw rpcError;
      return (rows ?? []) as ReconciliationMonthSummary[];
    },
  });

  function handleApply() {
    const from = parseISO(fromMonth + "-01");
    const to = endOfMonth(parseISO(toMonth + "-01"));
    setDateFrom(format(from, "yyyy-MM-dd"));
    setDateTo(format(to, "yyyy-MM-dd"));
  }

  const totals = React.useMemo(() => computeTotals(data ?? []), [data]);
  const COLS = 21;

  function showOrDash(val: number): React.ReactNode {
    if (val === 0) return <span className="text-muted-foreground">—</span>;
    return formatINR(val);
  }

  function outstandingClass(val: number): string {
    if (val < 0) return "text-green-700 dark:text-green-400";
    if (val === 0) return "text-muted-foreground";
    return "";
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold">Monthly Reconciliation Report</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invoice-month based collection summary across all payment channels
        </p>
      </div>

      {/* Date filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">From</label>
          <input
            type="month"
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">To</label>
          <input
            type="month"
            value={toMonth}
            onChange={(e) => setToMonth(e.target.value)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Button onClick={handleApply} size="sm">
          Apply
        </Button>
      </div>

      {/* Main table */}
      <Card>
        <CardHeader>
          <CardTitle>Month-wise Summary</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-red-700">
              Failed to load reconciliation data: {(error as Error).message}
              <button className="ml-3 text-primary underline" onClick={() => refetch()}>
                Retry
              </button>
            </div>
          ) : !isLoading && (data?.length ?? 0) === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No reconciled invoices found for the selected period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full caption-bottom text-sm">
                <THead>
                  {/* Group header row */}
                  <tr className="border-b bg-muted/30">
                    <TH rowSpan={2} className="align-middle">Month</TH>
                    <TH rowSpan={2} className="text-right align-middle whitespace-nowrap"># Invoices</TH>
                    <TH
                      colSpan={3}
                      className="border-b border-border text-center font-semibold"
                    >
                      Billed
                    </TH>
                    <TH
                      colSpan={9}
                      className="border-b border-border text-center font-semibold"
                    >
                      Received
                    </TH>
                    <TH
                      colSpan={6}
                      className="border-b border-border text-center font-semibold"
                    >
                      Deductions
                    </TH>
                    <TH rowSpan={2} className="text-right align-middle whitespace-nowrap">Outstanding</TH>
                  </tr>
                  {/* Individual column row */}
                  <tr className="border-b bg-muted/30">
                    <TH className="text-right whitespace-nowrap">Gross</TH>
                    <TH className="text-right whitespace-nowrap">Taxable</TH>
                    <TH className="text-right">GST</TH>
                    <TH className="text-right">MMT</TH>
                    <TH className="text-right">Goibibo</TH>
                    <TH className="text-right">Card</TH>
                    <TH className="text-right">UPI</TH>
                    <TH className="text-right">Cash</TH>
                    <TH className="text-right whitespace-nowrap">Bank Transfer</TH>
                    <TH className="text-right whitespace-nowrap">Anoth. Machine</TH>
                    <TH className="text-right">Other</TH>
                    <TH className="text-right font-semibold">Total</TH>
                    <TH className="text-right">Comm.</TH>
                    <TH className="text-right whitespace-nowrap">GST on Comm</TH>
                    <TH className="text-right">TDS</TH>
                    <TH className="text-right">TCS</TH>
                    <TH className="text-right">MDR</TH>
                    <TH className="text-right font-semibold">Total</TH>
                  </tr>
                </THead>
                <TBody>
                  {isLoading ? (
                    <SkeletonRows cols={COLS} />
                  ) : (
                    <>
                      {(data ?? []).map((row) => {
                        const monthPath = format(parseISO(row.invoice_month), "yyyy-MM");
                        return (
                          <TR key={row.invoice_month}>
                            <TD className="font-medium whitespace-nowrap">
                              <Link
                                href={`/reports/reconciliation/${monthPath}`}
                                className="text-primary underline-offset-2 hover:underline"
                              >
                                {monthLabel(row.invoice_month)}
                              </Link>
                            </TD>
                            <TD className="text-right tabular-nums">{zero(row.invoice_count)}</TD>
                            <TD className="text-right tabular-nums">{formatINR(zero(row.gross_billed))}</TD>
                            <TD className="text-right tabular-nums">{formatINR(zero(row.taxable_amount))}</TD>
                            <TD className="text-right tabular-nums">{formatINR(zero(row.gst))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.received?.mmt))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.received?.goibibo))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.received?.card))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.received?.upi))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.received?.cash))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.received?.bank_transfer))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.received?.another_machine))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.received?.other))}</TD>
                            <TD className="text-right tabular-nums font-semibold">{formatINR(zero(row.received?.total))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.deductions?.commission))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.deductions?.gst_on_commission))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.deductions?.tds))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.deductions?.tcs))}</TD>
                            <TD className="text-right tabular-nums">{showOrDash(zero(row.deductions?.mdr))}</TD>
                            <TD className="text-right tabular-nums font-semibold">{formatINR(zero(row.deductions?.total))}</TD>
                            <TD className={`text-right tabular-nums ${outstandingClass(roundOutstanding(zero(row.outstanding)))}`}>{formatINR(roundOutstanding(zero(row.outstanding)))}</TD>
                          </TR>
                        );
                      })}
                      {/* Totals row */}
                      <TR className="font-semibold bg-muted/40 border-t">
                        <TD className="whitespace-nowrap">Total</TD>
                        <TD className="text-right tabular-nums">{totals.invoice_count}</TD>
                        <TD className="text-right tabular-nums">{formatINR(totals.gross_billed)}</TD>
                        <TD className="text-right tabular-nums">{formatINR(totals.taxable_amount)}</TD>
                        <TD className="text-right tabular-nums">{formatINR(totals.gst)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.received_mmt)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.received_goibibo)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.received_card)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.received_upi)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.received_cash)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.received_bank_transfer)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.received_another_machine)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.received_other)}</TD>
                        <TD className="text-right tabular-nums">{formatINR(totals.received_total)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.deductions_commission)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.deductions_gst_on_commission)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.deductions_tds)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.deductions_tcs)}</TD>
                        <TD className="text-right tabular-nums">{showOrDash(totals.deductions_mdr)}</TD>
                        <TD className="text-right tabular-nums">{formatINR(totals.deductions_total)}</TD>
                        <TD className={`text-right tabular-nums ${outstandingClass(roundOutstanding(totals.outstanding))}`}>{formatINR(roundOutstanding(totals.outstanding))}</TD>
                      </TR>
                    </>
                  )}
                </TBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
