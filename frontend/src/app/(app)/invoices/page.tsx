"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { formatINR, formatDate } from "@/lib/utils";

const PAGE_SIZE = 50;

export default function InvoicesPage() {
  const [status, setStatus] = React.useState<string>("all");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [guest, setGuest] = React.useState("");
  const [invoiceNumber, setInvoiceNumber] = React.useState("");
  const [amountMin, setAmountMin] = React.useState("");
  const [amountMax, setAmountMax] = React.useState("");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Invoices</h1>
      <React.Suspense>
        <WalkInList
          status={status} setStatus={setStatus}
          dateFrom={dateFrom} setDateFrom={setDateFrom}
          dateTo={dateTo} setDateTo={setDateTo}
          guest={guest} setGuest={setGuest}
          invoiceNumber={invoiceNumber} setInvoiceNumber={setInvoiceNumber}
          amountMin={amountMin} setAmountMin={setAmountMin}
          amountMax={amountMax} setAmountMax={setAmountMax}
        />
      </React.Suspense>
    </div>
  );
}

function WalkInList(props: any) {
  const supabase = React.useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { status, setStatus, dateFrom, setDateFrom, dateTo, setDateTo, guest, setGuest,
          invoiceNumber, setInvoiceNumber,
          amountMin, setAmountMin, amountMax, setAmountMax } = props;

  const page = parseInt(searchParams.get("page") ?? "0", 10);
  const setPage = React.useCallback((newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    router.push(`${pathname}?${params.toString()}`);
  }, [searchParams, pathname, router]);

  const query = useQuery({
    queryKey: ["invoices.walkin", status, dateFrom, dateTo, guest, invoiceNumber, amountMin, amountMax, page],
    queryFn: async () => {
      let q = supabase.from("v_invoice_list_with_issue")
        .select("id, invoice_number, guest_name, arrival_time, departure_time, grand_total, reconciliation_status, booking_date, created_at, has_open_issue, has_pending_manual_payment", { count: "exact" })
        .order("departure_time", { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (status !== "all") q = q.eq("reconciliation_status", status);
      if (dateFrom) q = q.gte("arrival_time", dateFrom);
      if (dateTo) q = q.lte("arrival_time", dateTo);
      if (guest.trim()) q = q.ilike("guest_name", `%${guest.trim()}%`);
      if (invoiceNumber.trim()) q = q.ilike("invoice_number", `%${invoiceNumber.trim()}%`);
      if (amountMin) q = q.gte("grand_total", parseFloat(amountMin));
      if (amountMax) q = q.lte("grand_total", parseFloat(amountMax));
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data || [], count: count ?? 0 };
    },
  });

  const totalPages = Math.max(1, Math.ceil((query.data?.count ?? 0) / PAGE_SIZE));
  return (
    <>
      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
        Click any invoice row to open it and add payments / reconcile.
      </div>
      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <div>
            <Label>Status</Label>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="all">All</option>
              <option value="unreconciled">Unreconciled</option>
              <option value="partial">Partial</option>
              <option value="fully_reconciled">Fully reconciled</option>
              <option value="flagged_for_review">Flagged</option>
            </Select>
          </div>
          <div>
            <Label>Invoice #</Label>
            <Input value={invoiceNumber} onChange={(e) => { setInvoiceNumber(e.target.value); setPage(0); }} placeholder="e.g. FDR1988…" />
          </div>
          <div>
            <Label>Guest name</Label>
            <Input value={guest} onChange={(e) => { setGuest(e.target.value); setPage(0); }} placeholder="search…" />
          </div>
          <div>
            <Label>Arrival from</Label>
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} />
          </div>
          <div>
            <Label>Arrival to</Label>
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} />
          </div>
          <div>
            <Label>Min total (₹)</Label>
            <Input type="number" value={amountMin} onChange={(e) => { setAmountMin(e.target.value); setPage(0); }} />
          </div>
          <div>
            <Label>Max total (₹)</Label>
            <Input type="number" value={amountMax} onChange={(e) => { setAmountMax(e.target.value); setPage(0); }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {query.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading invoices…</div>
          ) : query.isError ? (
            <div className="p-6 text-sm text-red-700">Failed to load invoices: {(query.error as Error).message}</div>
          ) : query.data!.rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No invoices match your filters.</div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice #</TH>
                  <TH>Guest</TH>
                  <TH>Arrival</TH>
                  <TH>Departure</TH>
                  <TH className="text-right">Grand total</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {query.data!.rows.map((r: any) => {
                  const href = `/invoices/${r.id}`;
                  const isDone = r.reconciliation_status === "fully_reconciled";
                  return (
                    <TR
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(href)}
                    >
                      <TD>
                        <Link
                          href={href}
                          className="text-primary underline-offset-2 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.invoice_number || r.id.slice(0, 8)}
                        </Link>
                      </TD>
                      <TD>{r.guest_name || "—"}</TD>
                      <TD>{formatDate(r.arrival_time)}</TD>
                      <TD>{formatDate(r.departure_time)}</TD>
                      <TD className="text-right tabular-nums">{formatINR(r.grand_total)}</TD>
                      <TD>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <StatusBadge status={r.reconciliation_status} pendingManualPayment={r.has_pending_manual_payment} />
                          {r.has_open_issue && (
                            <Badge variant="destructive" className="text-xs">Issue reported</Badge>
                          )}
                        </div>
                      </TD>
                      <TD className="text-right">
                        <Button
                          size="sm"
                          variant={isDone ? "outline" : "default"}
                          onClick={(e) => { e.stopPropagation(); router.push(href); }}
                        >
                          {isDone ? "View" : "Reconcile"}
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
        {query.data && (
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
            <div className="text-muted-foreground">
              {query.data.count} total — page {page + 1} / {totalPages}
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
        )}
      </Card>
    </>
  );
}

