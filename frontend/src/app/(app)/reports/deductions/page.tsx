"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatINR, formatDate } from "@/lib/utils";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeductionRow {
  invoice_id: string;
  invoice_number: string | null;
  guest_name: string | null;
  source: string | null;
  payment_type: "commission" | "tds";
  party_name: string | null;
  amount: number;
  approved_date: string | null;
}

interface DeductionTotal {
  payment_type: "commission" | "tds";
  party_name: string | null;
  total: number;
}

interface DeductionsReportResponse {
  rows: DeductionRow[];
  totals: DeductionTotal[];
}

type DeductionTypeFilter = "all" | "commission" | "tds";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function TypeBadge({ type }: { type: "commission" | "tds" }) {
  return (
    <Badge
      className={
        type === "commission"
          ? "bg-orange-100 text-orange-800"
          : "bg-purple-100 text-purple-700"
      }
    >
      {type === "commission" ? "Commission" : "TDS"}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DeductionsPage() {
  const supabase = React.useMemo(() => createClient(), []);

  // Filters
  const today = new Date().toISOString().slice(0, 10);
  const firstOfYear = `${new Date().getFullYear()}-01-01`;

  const [dateFrom, setDateFrom] = React.useState(firstOfYear);
  const [dateTo, setDateTo] = React.useState(today);
  const [typeFilter, setTypeFilter] = React.useState<DeductionTypeFilter>("all");
  const [partyFilter, setPartyFilter] = React.useState("");

  // Applied filters (submitted on button click)
  const [appliedFilters, setAppliedFilters] = React.useState({
    dateFrom: firstOfYear,
    dateTo: today,
    type: "all" as DeductionTypeFilter,
    party: "",
  });

  function applyFilters() {
    setAppliedFilters({
      dateFrom,
      dateTo,
      type: typeFilter,
      party: partyFilter,
    });
  }

  const { dateFrom: af_dateFrom, dateTo: af_dateTo, type: af_type, party: af_party } = appliedFilters;

  const q = useQuery({
    queryKey: ["deductions_report", af_dateFrom, af_dateTo, af_type, af_party],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_get_deductions_report", {
        p_date_from: af_dateFrom || null,
        p_date_to: af_dateTo || null,
        p_type: af_type === "all" ? null : af_type,
        p_party: af_party.trim() || null,
      });
      if (error) throw error;
      return (data ?? { rows: [], totals: [] }) as DeductionsReportResponse;
    },
  });

  const rows = q.data?.rows ?? [];
  const totals = q.data?.totals ?? [];

  const commissionTotals = totals.filter((t) => t.payment_type === "commission");
  const tdsTotals = totals.filter((t) => t.payment_type === "tds");

  const commissionGrand = commissionTotals.reduce((s, t) => s + t.total, 0);
  const tdsGrand = tdsTotals.reduce((s, t) => s + t.total, 0);

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div>
        <h1 className="text-xl font-semibold">Commission &amp; TDS Deductions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View approved commission and TDS write-off entries across invoices.
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>Date From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <Label>Date To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as DeductionTypeFilter)
                }
              >
                <option value="all">All</option>
                <option value="commission">Commission</option>
                <option value="tds">TDS</option>
              </Select>
            </div>
            <div>
              <Label>Party</Label>
              <Input
                type="text"
                value={partyFilter}
                onChange={(e) => setPartyFilter(e.target.value)}
                placeholder="e.g. Agoda, Yatra"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={applyFilters}>Apply filters</Button>
          </div>
        </CardContent>
      </Card>

      {/* Main table */}
      <Card>
        <CardHeader>
          <CardTitle>Deduction entries</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? (
            // Loading skeleton
            <div className="space-y-2 p-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-md bg-muted/50"
                />
              ))}
            </div>
          ) : q.isError ? (
            // Error state
            <div className="p-4">
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                Could not load deduction data. Please try again.
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => q.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            // Empty state
            <div className="p-6 text-center text-sm text-muted-foreground">
              No deduction entries found for the selected filters.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice #</TH>
                  <TH>Guest</TH>
                  <TH>Source</TH>
                  <TH>Type</TH>
                  <TH>Party</TH>
                  <TH className="text-right">Amount (₹)</TH>
                  <TH>Approved Date</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row, i) => (
                  <TR key={`${row.invoice_id}-${i}`}>
                    <TD>
                      {row.invoice_id ? (
                        <Link
                          href={`/invoices/${row.invoice_id}`}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {row.invoice_number || row.invoice_id.slice(0, 8)}
                        </Link>
                      ) : (
                        row.invoice_number || "—"
                      )}
                    </TD>
                    <TD>{row.guest_name || "—"}</TD>
                    <TD className="text-xs">{row.source || "—"}</TD>
                    <TD>
                      <TypeBadge type={row.payment_type} />
                    </TD>
                    <TD>{row.party_name || "—"}</TD>
                    <TD className="text-right tabular-nums font-medium">
                      {formatINR(row.amount)}
                    </TD>
                    <TD>{row.approved_date ? formatDate(row.approved_date) : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Summary totals */}
      {!q.isLoading && !q.isError && totals.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Commission totals */}
          {commissionTotals.length > 0 && (
            <Card className="bg-orange-50">
              <CardHeader>
                <CardTitle className="text-base">Commission</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Party</TH>
                      <TH className="text-right">Total (₹)</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {commissionTotals.map((t, i) => (
                      <TR key={i}>
                        <TD>{t.party_name || "—"}</TD>
                        <TD className="text-right tabular-nums font-medium">
                          {formatINR(t.total)}
                        </TD>
                      </TR>
                    ))}
                    {/* Grand total row */}
                    <TR>
                      <TD className="font-semibold">Total</TD>
                      <TD className="text-right tabular-nums font-bold">
                        {formatINR(commissionGrand)}
                      </TD>
                    </TR>
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* TDS totals */}
          {tdsTotals.length > 0 && (
            <Card className="bg-purple-50">
              <CardHeader>
                <CardTitle className="text-base">TDS</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Party</TH>
                      <TH className="text-right">Total (₹)</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {tdsTotals.map((t, i) => (
                      <TR key={i}>
                        <TD>{t.party_name || "—"}</TD>
                        <TD className="text-right tabular-nums font-medium">
                          {formatINR(t.total)}
                        </TD>
                      </TR>
                    ))}
                    {/* Grand total row */}
                    <TR>
                      <TD className="font-semibold">Total</TD>
                      <TD className="text-right tabular-nums font-bold">
                        {formatINR(tdsGrand)}
                      </TD>
                    </TR>
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
