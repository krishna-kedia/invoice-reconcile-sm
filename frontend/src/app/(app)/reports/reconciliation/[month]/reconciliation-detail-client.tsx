"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatINR } from "@/lib/utils";
import type { ReconciliationMonthDetail, PendingReconciliationInvoice } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zero(n: number | undefined | null): number {
  return n ?? 0;
}

function roundOutstanding(v: number): number {
  return Math.abs(v) < 1 ? 0 : v;
}

function monthDisplayLabel(monthStart: string): string {
  const d = parseISO(monthStart);
  return format(d, "MMMM yyyy");
}

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

function SummaryCard({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-7 w-32 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

function SkeletonRows({ cols, rows = 3 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
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
// Main component
// ---------------------------------------------------------------------------

export function ReconciliationDetailClient({
  monthStart,
}: {
  monthStart: string;
  month: string;
}) {
  const supabase = React.useMemo(() => createClient(), []);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["reconciliation-month-detail", monthStart],
    queryFn: async () => {
      const { data: result, error: rpcError } = await supabase.rpc(
        "rpc_get_reconciliation_month_detail",
        { p_month_start: monthStart }
      );
      if (rpcError) throw rpcError;
      return result as ReconciliationMonthDetail;
    },
  });

  const displayMonth = React.useMemo(() => monthDisplayLabel(monthStart), [monthStart]);

  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div>
        <Link
          href="/reports/reconciliation"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to Monthly Summary
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{displayMonth}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reconciliation detail for {displayMonth}
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          Failed to load reconciliation data: {(error as Error).message}
          <button className="ml-3 underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {/* Loading: summary cards skeleton */}
      {isLoading && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
          </div>
          <Card>
            <CardHeader><CardTitle>Booking Type Breakdown</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <TBody><SkeletonRows cols={8} rows={4} /></TBody>
                </table>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Payment Timing</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <TBody><SkeletonRows cols={3} rows={3} /></TBody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {/* No data state */}
      {!isLoading && !error && !data && (
        <div className="rounded-md border bg-muted/20 p-6 text-sm text-muted-foreground">
          No data for this month.
        </div>
      )}

      {/* Success state */}
      {!isLoading && !error && data && (
        <>
          {/* Section 1: Summary Cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard
              title="Total Billed"
              value={formatINR(zero(data.summary?.total_billed))}
            />
            <SummaryCard
              title="Net Receivable"
              value={formatINR(zero(data.summary?.net_receivable))}
            />
            <SummaryCard
              title="Total Received"
              value={formatINR(zero(data.summary?.total_received))}
            />
            <SummaryCard
              title="Outstanding"
              value={
                <span className={roundOutstanding(zero(data.summary?.outstanding)) > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-700 dark:text-green-400"}>
                  {formatINR(roundOutstanding(zero(data.summary?.outstanding)))}
                </span>
              }
            />
          </div>

          {/* Section 2: Booking Type Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Booking Type Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(data.booking_type_breakdown?.length ?? 0) === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No booking data.</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Source</TH>
                      <TH className="text-right"># Invoices</TH>
                      <TH className="text-right">Gross Billed</TH>
                      <TH className="text-right">GST</TH>
                      <TH className="text-right">Net Receivable</TH>
                      <TH className="text-right">Total Deductions</TH>
                      <TH className="text-right">Received</TH>
                      <TH className="text-right">Outstanding</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.booking_type_breakdown.map((row, idx) => {
                      const isTotal = row.source === "TOTAL";
                      return (
                        <TR
                          key={idx}
                          className={isTotal ? "border-t-2 border-border font-semibold" : ""}
                        >
                          <TD className="whitespace-nowrap">{row.source}</TD>
                          <TD className="text-right tabular-nums">{zero(row.invoice_count)}</TD>
                          <TD className="text-right tabular-nums">{formatINR(zero(row.gross_billed))}</TD>
                          <TD className="text-right tabular-nums">{formatINR(zero(row.gst))}</TD>
                          <TD className="text-right tabular-nums">{formatINR(zero(row.net_receivable))}</TD>
                          <TD className="text-right tabular-nums">{formatINR(zero(row.total_deductions))}</TD>
                          <TD className="text-right tabular-nums">{formatINR(zero(row.received))}</TD>
                          <TD className="text-right tabular-nums">{formatINR(roundOutstanding(zero(row.outstanding)))}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Section 3: Payment Timing */}
          <Card>
            <CardHeader>
              <CardTitle>Payment Timing</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(data.payment_timing?.length ?? 0) === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No payment timing data.</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Period</TH>
                      <TH className="text-right">Amount</TH>
                      <TH className="text-right">% of Net Receivable</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.payment_timing.map((row, idx) => {
                      const isPending = row.period === "pending";
                      return (
                        <TR
                          key={idx}
                          className={isPending ? "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400" : ""}
                        >
                          <TD className={isPending ? "font-medium" : ""}>
                            {row.label ?? row.period}
                          </TD>
                          <TD className="text-right tabular-nums">
                            {formatINR(zero(row.amount))}
                          </TD>
                          <TD className="text-right tabular-nums">
                            {zero(row.pct).toFixed(1)}%
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Section 4: Pending Reconciliation */}
          {(data.pending_invoices?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Pending Reconciliation
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                    {data.pending_invoices.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Invoice #</TH>
                      <TH>Guest</TH>
                      <TH>Check-out</TH>
                      <TH>Source</TH>
                      <TH className="text-right">Amount</TH>
                      <TH className="text-right">Received</TH>
                      <TH className="text-right">Outstanding</TH>
                      <TH>Status</TH>
                      <TH></TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.pending_invoices.map((inv: PendingReconciliationInvoice) => (
                      <TR key={inv.id}>
                        <TD className="whitespace-nowrap font-mono text-xs">{inv.invoice_number}</TD>
                        <TD className="whitespace-nowrap">{inv.guest_name}</TD>
                        <TD className="whitespace-nowrap tabular-nums">
                          {inv.checkout_date ? format(new Date(inv.checkout_date + "T00:00:00"), "dd MMM") : "—"}
                        </TD>
                        <TD className="whitespace-nowrap">{inv.source}</TD>
                        <TD className="text-right tabular-nums">{formatINR(zero(inv.grand_total))}</TD>
                        <TD className="text-right tabular-nums">{formatINR(zero(inv.received))}</TD>
                        <TD className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                          {formatINR(roundOutstanding(zero(inv.outstanding)))}
                        </TD>
                        <TD>
                          <span className={
                            inv.status === "unreconciled"
                              ? "rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : "rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                          }>
                            {inv.status === "unreconciled" ? "Unreconciled" : "Partial"}
                          </span>
                        </TD>
                        <TD>
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="text-sm text-primary underline-offset-2 hover:underline whitespace-nowrap"
                          >
                            Reconcile →
                          </Link>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
