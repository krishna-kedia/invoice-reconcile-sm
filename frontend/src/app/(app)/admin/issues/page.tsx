"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import type { IssueCategory, IssueReportStatus } from "@/lib/types";

const PAGE_SIZE = 50;

type TabValue = "open" | "resolved";

interface IssueRow {
  id: string;
  invoice_id: string;
  category: string;
  notes: string | null;
  status: IssueReportStatus;
  reported_by: string;
  reported_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  source_snapshot: string | null;
  hotel_invoice: {
    invoice_number: string | null;
    guest_name: string | null;
    source: string | null;
  } | null;
}

function statusBadge(status: IssueReportStatus) {
  switch (status) {
    case "open":
      return <Badge variant="destructive">Open</Badge>;
    case "resolved_by_admin":
      return <Badge variant="success">Resolved by admin</Badge>;
    case "resolved_by_reconciliation":
      return <Badge variant="success">Auto-resolved</Badge>;
    case "withdrawn_by_operator":
      return <Badge variant="default" className="bg-slate-100 text-slate-700">Withdrawn</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function AdminIssuesPage() {
  const supabase = React.useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = React.useState<TabValue>("open");
  const [filterSource, setFilterSource] = React.useState("");
  const [filterCategory, setFilterCategory] = React.useState("");
  const [filterDateFrom, setFilterDateFrom] = React.useState("");
  const [filterDateTo, setFilterDateTo] = React.useState("");
  const [page, setPage] = React.useState(0);

  // Resolve dialog state
  const [resolveReport, setResolveReport] = React.useState<IssueRow | null>(null);
  const [resolutionNotes, setResolutionNotes] = React.useState("");
  const [resolving, setResolving] = React.useState(false);

  // Fetch categories for label lookup
  const categoriesQ = useQuery({
    queryKey: ["issue-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("issue_categories")
        .select("id, code, label, applies_to, is_active, sort_order")
        .order("sort_order");
      if (error) throw error;
      return (data || []) as IssueCategory[];
    },
  });

  const categoryLabel = (code: string) =>
    categoriesQ.data?.find((c) => c.code === code)?.label ?? code;

  // Reset page on filter/tab change
  React.useEffect(() => { setPage(0); }, [tab, filterSource, filterCategory, filterDateFrom, filterDateTo]);

  const issuesQ = useQuery({
    queryKey: ["admin-issues", tab, filterSource, filterCategory, filterDateFrom, filterDateTo, page],
    queryFn: async () => {
      let q = supabase
        .from("invoice_issue_reports")
        .select(
          "id, invoice_id, category, notes, status, reported_by, reported_at, resolved_by, resolved_at, resolution_notes, source_snapshot, hotel_invoice!inner(invoice_number, guest_name, source)",
          { count: "exact" }
        )
        .order("reported_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (tab === "open") {
        q = q.eq("status", "open");
      } else {
        q = q.in("status", ["resolved_by_admin", "resolved_by_reconciliation", "withdrawn_by_operator"]);
      }

      if (filterCategory) q = q.eq("category", filterCategory);
      if (filterDateFrom) q = q.gte("reported_at", filterDateFrom);
      if (filterDateTo) q = q.lte("reported_at", filterDateTo + "T23:59:59");

      const { data, error, count } = await q;
      if (error) throw error;

      // Client-side source filter (source is nested in hotel_invoice)
      let rows = (data || []) as unknown as IssueRow[];
      if (filterSource) {
        rows = rows.filter(
          (r) =>
            r.hotel_invoice?.source
              ?.toLowerCase()
              .includes(filterSource.toLowerCase())
        );
      }

      return { rows, count: count ?? 0 };
    },
  });

  const totalPages = Math.max(1, Math.ceil((issuesQ.data?.count ?? 0) / PAGE_SIZE));

  async function handleResolve() {
    if (!resolveReport) return;
    setResolving(true);
    const { error } = await supabase.rpc("rpc_resolve_issue_report", {
      p_report_id: resolveReport.id,
      p_resolution_notes: resolutionNotes.trim() || null,
    });
    setResolving(false);
    if (error) {
      const msg = error.message || "";
      if (msg.includes("REPORT_NOT_OPEN")) {
        toast.show("error", "This report is no longer open.");
      } else {
        toast.show("error", "Failed to resolve the report. Please try again.");
      }
      return;
    }
    toast.show("success", "Report resolved.");
    setResolveReport(null);
    setResolutionNotes("");
    qc.invalidateQueries({ queryKey: ["admin-issues"] });
    qc.invalidateQueries({ queryKey: ["invoices.walkin"] });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Issue Reports</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(["open", "resolved"] as TabValue[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <Label>Source</Label>
            <Input
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              placeholder="e.g. MMT, Yatra…"
            />
          </div>
          <div>
            <Label>Category</Label>
            <Select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {(categoriesQ.data || []).map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Reported from</Label>
            <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
          </div>
          <div>
            <Label>Reported to</Label>
            <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {issuesQ.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading reports…</div>
          ) : issuesQ.isError ? (
            <div className="p-6 text-sm text-red-700">
              Failed to load reports: {(issuesQ.error as Error).message}
            </div>
          ) : issuesQ.data!.rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No {tab} reports found.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice #</TH>
                  <TH>Guest</TH>
                  <TH>Source</TH>
                  <TH>Category</TH>
                  <TH>Notes</TH>
                  <TH>Reported at</TH>
                  <TH>Status</TH>
                  {tab === "resolved" && <TH>Resolved at</TH>}
                  {tab === "open" && <TH className="text-right">Actions</TH>}
                </TR>
              </THead>
              <TBody>
                {issuesQ.data!.rows.map((r) => (
                  <TR
                    key={r.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => {
                      window.location.href = `/invoices/${r.invoice_id}`;
                    }}
                  >
                    <TD>
                      <Link
                        href={`/invoices/${r.invoice_id}`}
                        className="text-primary underline-offset-2 hover:underline font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.hotel_invoice?.invoice_number || r.invoice_id.slice(0, 8)}
                      </Link>
                    </TD>
                    <TD>{r.hotel_invoice?.guest_name || "—"}</TD>
                    <TD className="text-xs">{r.hotel_invoice?.source || "—"}</TD>
                    <TD>{categoryLabel(r.category)}</TD>
                    <TD className="max-w-xs">
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {r.notes || "—"}
                      </span>
                    </TD>
                    <TD className="text-xs">{formatDateTime(r.reported_at)}</TD>
                    <TD>{statusBadge(r.status)}</TD>
                    {tab === "resolved" && (
                      <TD className="text-xs">
                        {r.resolved_at ? formatDateTime(r.resolved_at) : "—"}
                        {r.resolution_notes && (
                          <div className="mt-0.5 text-muted-foreground line-clamp-1">
                            {r.resolution_notes}
                          </div>
                        )}
                      </TD>
                    )}
                    {tab === "open" && (
                      <TD className="text-right">
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setResolutionNotes("");
                            setResolveReport(r);
                          }}
                        >
                          Resolve
                        </Button>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
        {issuesQ.data && (
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
            <div className="text-muted-foreground">
              {issuesQ.data.count} total — page {page + 1} / {totalPages}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page + 1 >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Resolve dialog */}
      <Dialog
        open={!!resolveReport}
        onClose={() => { setResolveReport(null); setResolutionNotes(""); }}
        title="Resolve issue report"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setResolveReport(null); setResolutionNotes(""); }}>
              Cancel
            </Button>
            <Button onClick={handleResolve} disabled={resolving}>
              {resolving ? "Resolving…" : "Mark as resolved"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {resolveReport && (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
              <div>
                <span className="font-medium">Invoice:</span>{" "}
                {resolveReport.hotel_invoice?.invoice_number || resolveReport.invoice_id.slice(0, 8)}
              </div>
              <div>
                <span className="font-medium">Category:</span>{" "}
                {categoryLabel(resolveReport.category)}
              </div>
              {resolveReport.notes && (
                <div>
                  <span className="font-medium">Notes:</span> {resolveReport.notes}
                </div>
              )}
            </div>
          )}
          <div>
            <Label>Resolution notes (optional)</Label>
            <Textarea
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="How was the issue addressed?"
              rows={3}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
