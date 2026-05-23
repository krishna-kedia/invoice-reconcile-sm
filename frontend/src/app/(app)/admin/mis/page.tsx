"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatINR } from "@/lib/utils";
import type { YatraMonthlyDeduction } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MisMonthlySummaryRow {
  invoice_month: string; // "2026-04-01"
  invoice_count: number;
  total_invoiced: number;
  total_received: number;
  same_month_received: number;
  other_month_received: number;
  pending: number;
}

interface MisPaymentDetailRow {
  invoice_month: string;
  payment_month: string;
  payment_method: "upi" | "card" | "bank_transfer" | "cash";
  amount_received: number;
}

// Pivoted sub-table row: one entry per payment_month
interface PivotRow {
  payment_month: string;
  upi: number;
  card: number;
  bank_transfer: number;
  cash: number;
  total: number;
  isSameMonth: boolean;
}

type MisTab = "summary" | "yatra";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAYMENT_METHODS = ["upi", "card", "bank_transfer", "cash"] as const;

const METHOD_LABELS: Record<typeof PAYMENT_METHODS[number], string> = {
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank Transfer",
  cash: "Cash",
};

/** Format a date-string like "2026-04-01" as "Apr 2026" */
function formatMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(d);
}

/** Collection-rate colour class */
function collectionRateClass(rate: number): string {
  if (rate >= 90) return "text-green-700 font-semibold";
  if (rate >= 50) return "text-amber-600 font-semibold";
  return "text-red-600 font-semibold";
}

/** Build a pivot table for one invoice_month from the detail rows */
function buildPivot(detailRows: MisPaymentDetailRow[], invoiceMonth: string): PivotRow[] {
  const relevant = detailRows.filter((r) => r.invoice_month === invoiceMonth);

  const map = new Map<string, PivotRow>();
  for (const r of relevant) {
    const existing = map.get(r.payment_month) ?? {
      payment_month: r.payment_month,
      upi: 0,
      card: 0,
      bank_transfer: 0,
      cash: 0,
      total: 0,
      isSameMonth: r.payment_month === invoiceMonth,
    };
    existing[r.payment_method] += r.amount_received;
    existing.total += r.amount_received;
    map.set(r.payment_month, existing);
  }

  return Array.from(map.values()).sort((a, b) =>
    b.payment_month.localeCompare(a.payment_month)
  );
}

/** Coerce a possibly-numeric Postgres value (number | string | null) to number. */
function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------
// Stat tile (re-used from admin home pattern)
// ---------------------------------------------------------------------------

function StatTile({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-table (expanded row content)
// ---------------------------------------------------------------------------

function PaymentBreakdownTable({
  invoiceMonth,
  detailRows,
}: {
  invoiceMonth: string;
  detailRows: MisPaymentDetailRow[];
}) {
  const pivotRows = buildPivot(detailRows, invoiceMonth);

  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <div className="mb-3 text-sm font-medium text-foreground">
        Payment breakdown for {formatMonthLabel(invoiceMonth)}
      </div>
      {pivotRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment data for this month.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Payment Month</TH>
              {PAYMENT_METHODS.map((m) => (
                <TH key={m} className="text-right">
                  {METHOD_LABELS[m]}
                </TH>
              ))}
              <TH className="text-right">Row Total</TH>
            </TR>
          </THead>
          <TBody>
            {pivotRows.map((row) => (
              <TR key={row.payment_month}>
                <TD>
                  {formatMonthLabel(row.payment_month)}
                  {row.isSameMonth && (
                    <span className="ml-2 inline-flex items-center rounded-sm bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800">
                      Same month
                    </span>
                  )}
                </TD>
                {PAYMENT_METHODS.map((m) => (
                  <TD key={m} className="text-right tabular-nums">
                    {row[m] > 0 ? formatINR(row[m]) : "—"}
                  </TD>
                ))}
                <TD className="text-right tabular-nums font-medium">{formatINR(row.total)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Monthly Summary section (existing behaviour)
// ---------------------------------------------------------------------------

function MonthlySummarySection() {
  const supabase = React.useMemo(() => createClient(), []);
  const [expandedMonth, setExpandedMonth] = React.useState<string | null>(null);

  const summaryQ = useQuery({
    queryKey: ["mis.summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_mis_monthly_summary")
        .select("*")
        .order("invoice_month", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MisMonthlySummaryRow[];
    },
  });

  const detailQ = useQuery({
    queryKey: ["mis.detail"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_mis_payment_detail")
        .select("*")
        .order("invoice_month", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MisPaymentDetailRow[];
    },
  });

  // Aggregate totals across all months
  const totals = React.useMemo(() => {
    const rows = summaryQ.data ?? [];
    return rows.reduce(
      (acc, r) => ({
        total_invoiced: acc.total_invoiced + (r.total_invoiced ?? 0),
        total_received: acc.total_received + (r.total_received ?? 0),
        same_month_received: acc.same_month_received + (r.same_month_received ?? 0),
        pending: acc.pending + (r.pending ?? 0),
      }),
      { total_invoiced: 0, total_received: 0, same_month_received: 0, pending: 0 }
    );
  }, [summaryQ.data]);

  const isLoading = summaryQ.isLoading || detailQ.isLoading;
  const isError = summaryQ.isError || detailQ.isError;
  const errorMsg =
    ((summaryQ.error as Error | null)?.message ?? "") ||
    ((detailQ.error as Error | null)?.message ?? "Unknown error");

  function toggleMonth(month: string) {
    setExpandedMonth((prev) => (prev === month ? null : month));
  }

  return (
    <div className="space-y-6">
      {/* Summary stat tiles */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="py-5">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-7 w-32 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : isError ? null : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile title="Total Invoiced" value={formatINR(totals.total_invoiced)} />
          <StatTile title="Total Received" value={formatINR(totals.total_received)} />
          <StatTile title="Same-Month Received" value={formatINR(totals.same_month_received)} />
          <StatTile title="Total Pending" value={formatINR(totals.pending)} />
        </div>
      )}

      {/* Main table */}
      <Card>
        <CardHeader>
          <CardTitle>Month-wise Summary</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading MIS data…</div>
          ) : isError ? (
            <div className="p-6 text-sm text-red-700">
              Failed to load MIS data: {errorMsg}
              <button
                className="ml-3 text-primary underline"
                onClick={() => {
                  summaryQ.refetch();
                  detailQ.refetch();
                }}
              >
                Retry
              </button>
            </div>
          ) : (summaryQ.data?.length ?? 0) === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No invoice data found. Data appears here once invoices have a checkout date.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice Month</TH>
                  <TH className="text-right">Invoices</TH>
                  <TH className="text-right">Total Invoiced</TH>
                  <TH className="text-right">Total Received</TH>
                  <TH className="text-right">Same Month</TH>
                  <TH className="text-right">Other Months</TH>
                  <TH className="text-right">Pending</TH>
                  <TH className="text-right">Collection %</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {summaryQ.data!.map((row) => {
                  const rate =
                    row.total_invoiced > 0
                      ? (row.total_received / row.total_invoiced) * 100
                      : 0;
                  const isExpanded = expandedMonth === row.invoice_month;

                  return (
                    <React.Fragment key={row.invoice_month}>
                      <TR
                        className="cursor-pointer select-none"
                        onClick={() => toggleMonth(row.invoice_month)}
                      >
                        <TD className="font-medium">
                          {formatMonthLabel(row.invoice_month)}
                        </TD>
                        <TD className="text-right tabular-nums">{row.invoice_count}</TD>
                        <TD className="text-right tabular-nums">{formatINR(row.total_invoiced)}</TD>
                        <TD className="text-right tabular-nums">{formatINR(row.total_received)}</TD>
                        <TD className="text-right tabular-nums">{formatINR(row.same_month_received)}</TD>
                        <TD className="text-right tabular-nums">{formatINR(row.other_month_received)}</TD>
                        <TD className="text-right tabular-nums">{formatINR(row.pending)}</TD>
                        <TD className={`text-right tabular-nums ${collectionRateClass(rate)}`}>
                          {rate.toFixed(1)}%
                        </TD>
                        <TD className="text-right text-muted-foreground">
                          {isExpanded ? "▲" : "▼"}
                        </TD>
                      </TR>
                      {isExpanded && (
                        <TR>
                          <TD colSpan={9} className="p-0">
                            {detailQ.isLoading ? (
                              <div className="p-4 text-sm text-muted-foreground">
                                Loading breakdown…
                              </div>
                            ) : detailQ.isError ? (
                              <div className="p-4 text-sm text-red-700">
                                Failed to load payment detail.
                              </div>
                            ) : (
                              <PaymentBreakdownTable
                                invoiceMonth={row.invoice_month}
                                detailRows={detailQ.data ?? []}
                              />
                            )}
                          </TD>
                        </TR>
                      )}
                    </React.Fragment>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yatra Monthly Deductions section (Y7)
// ---------------------------------------------------------------------------

function YatraMonthlyDeductionsSection() {
  const supabase = React.useMemo(() => createClient(), []);

  const yatraQ = useQuery({
    queryKey: ["mis.yatra-monthly-deductions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_yatra_monthly_deductions")
        .select("*")
        .order("month_start", { ascending: false });
      if (error) throw error;
      return (data ?? []) as YatraMonthlyDeduction[];
    },
  });

  const totals = React.useMemo(() => {
    const rows = yatraQ.data ?? [];
    return rows.reduce(
      (acc, r) => ({
        bookings_count: acc.bookings_count + (r.bookings_count ?? 0),
        total_tariff_sum: acc.total_tariff_sum + num(r.total_tariff_sum),
        yatra_commission_amt_sum:
          acc.yatra_commission_amt_sum + num(r.yatra_commission_amt_sum),
        yatra_commission_with_gst_sum:
          acc.yatra_commission_with_gst_sum + num(r.yatra_commission_with_gst_sum),
        tds_amt_sum: acc.tds_amt_sum + num(r.tds_amt_sum),
        gst_on_commission_sum: acc.gst_on_commission_sum + num(r.gst_on_commission_sum),
        tcs_amt_sum: acc.tcs_amt_sum + num(r.tcs_amt_sum),
        yatra_to_pay_hotel_sum:
          acc.yatra_to_pay_hotel_sum + num(r.yatra_to_pay_hotel_sum),
      }),
      {
        bookings_count: 0,
        total_tariff_sum: 0,
        yatra_commission_amt_sum: 0,
        yatra_commission_with_gst_sum: 0,
        tds_amt_sum: 0,
        gst_on_commission_sum: 0,
        tcs_amt_sum: 0,
        yatra_to_pay_hotel_sum: 0,
      }
    );
  }, [yatraQ.data]);

  return (
    <div className="space-y-6">
      {/* Summary stat tiles */}
      {yatraQ.isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="py-5">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-7 w-32 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : yatraQ.isError ? null : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile title="Reconciled Bookings" value={totals.bookings_count.toLocaleString("en-IN")} />
          <StatTile title="Total Tariff" value={formatINR(totals.total_tariff_sum)} />
          <StatTile title="Total Deductions (Comm+GST)" value={formatINR(totals.yatra_commission_with_gst_sum)} />
          <StatTile title="Net to Hotel" value={formatINR(totals.yatra_to_pay_hotel_sum)} />
        </div>
      )}

      {/* Main table */}
      <Card>
        <CardHeader>
          <CardTitle>Yatra Monthly Deductions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {yatraQ.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading Yatra deductions…</div>
          ) : yatraQ.isError ? (
            <div className="p-6 text-sm text-red-700">
              Failed to load Yatra deductions: {(yatraQ.error as Error | null)?.message ?? "Unknown error"}
              <button
                className="ml-3 text-primary underline"
                onClick={() => yatraQ.refetch()}
              >
                Retry
              </button>
            </div>
          ) : (yatraQ.data?.length ?? 0) === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No reconciled Yatra bookings yet. Rows appear here as Yatra invoices are reconciled.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Month</TH>
                  <TH className="text-right">Bookings</TH>
                  <TH className="text-right">Total Tariff</TH>
                  <TH className="text-right">Commission</TH>
                  <TH className="text-right">Commission+GST</TH>
                  <TH className="text-right">TDS</TH>
                  <TH className="text-right">GST on Commission</TH>
                  <TH className="text-right">TCS</TH>
                  <TH className="text-right">Net to Hotel</TH>
                </TR>
              </THead>
              <TBody>
                {yatraQ.data!.map((row) => (
                  <TR key={row.month_start}>
                    <TD className="font-medium">{formatMonthLabel(row.month_start)}</TD>
                    <TD className="text-right tabular-nums">{row.bookings_count}</TD>
                    <TD className="text-right tabular-nums">{formatINR(num(row.total_tariff_sum))}</TD>
                    <TD className="text-right tabular-nums">{formatINR(num(row.yatra_commission_amt_sum))}</TD>
                    <TD className="text-right tabular-nums">{formatINR(num(row.yatra_commission_with_gst_sum))}</TD>
                    <TD className="text-right tabular-nums">{formatINR(num(row.tds_amt_sum))}</TD>
                    <TD className="text-right tabular-nums">{formatINR(num(row.gst_on_commission_sum))}</TD>
                    <TD className="text-right tabular-nums">{formatINR(num(row.tcs_amt_sum))}</TD>
                    <TD className="text-right tabular-nums font-medium">{formatINR(num(row.yatra_to_pay_hotel_sum))}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MisReportPage() {
  const [tab, setTab] = React.useState<MisTab>("summary");

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold">Monthly MIS Report</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invoices by checkout month — settlement-date based payment matching
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <nav className="-mb-px flex gap-2">
          <TabButton active={tab === "summary"} onClick={() => setTab("summary")}>
            Monthly Summary
          </TabButton>
          <TabButton active={tab === "yatra"} onClick={() => setTab("yatra")}>
            Yatra Deductions
          </TabButton>
        </nav>
      </div>

      {tab === "summary" ? <MonthlySummarySection /> : <YatraMonthlyDeductionsSection />}
    </div>
  );
}
