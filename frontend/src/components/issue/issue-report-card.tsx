"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import type { IssueReport, IssueCategory, IssueReportStatus } from "@/lib/types";

interface IssueReportCardProps {
  invoiceId: string;
  currentUserId: string | null;
  currentRole: "admin" | "operator";
  invoiceStatus: string;
  onReportChanged: () => void;
}

function statusBadge(status: IssueReportStatus) {
  switch (status) {
    case "open":
      return <Badge variant="destructive">Open</Badge>;
    case "resolved_by_admin":
    case "resolved_by_reconciliation":
      return <Badge variant="success">{status === "resolved_by_admin" ? "Resolved by admin" : "Auto-resolved"}</Badge>;
    case "withdrawn_by_operator":
      return <Badge variant="default" className="bg-slate-100 text-slate-700">Withdrawn</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function borderColor(status: IssueReportStatus): string {
  switch (status) {
    case "open":
      return "border-l-4 border-l-red-500";
    case "resolved_by_admin":
    case "resolved_by_reconciliation":
      return "border-l-4 border-l-green-500";
    case "withdrawn_by_operator":
      return "border-l-4 border-l-slate-400";
    default:
      return "";
  }
}

export function IssueReportCard({
  invoiceId,
  currentUserId,
  currentRole,
  invoiceStatus,
  onReportChanged,
}: IssueReportCardProps) {
  const supabase = React.useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const toast = useToast();

  const [withdrawOpen, setWithdrawOpen] = React.useState(false);
  const [resolveOpen, setResolveOpen] = React.useState(false);
  const [resolutionNotes, setResolutionNotes] = React.useState("");
  const [resolveError, setResolveError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Fetch latest report for this invoice
  const reportQ = useQuery({
    queryKey: ["issue-report", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_issue_reports")
        .select(
          "id, invoice_id, category, notes, status, reported_by, reported_at, resolved_by, resolved_at, resolution_notes, source_snapshot"
        )
        .eq("invoice_id", invoiceId)
        .order("reported_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data || []) as IssueReport[];
    },
  });

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

  const report = reportQ.data?.[0] ?? null;

  async function handleWithdraw() {
    if (!report) return;
    setBusy(true);
    const { error } = await supabase.rpc("rpc_withdraw_issue_report", {
      p_report_id: report.id,
    });
    setBusy(false);
    if (error) {
      const msg = error.message || "";
      if (msg.includes("REPORT_NOT_OPEN")) {
        toast.show("error", "This report is no longer open and cannot be withdrawn.");
      } else if (msg.includes("Not authorized")) {
        toast.show("error", "You are not authorised to withdraw this report.");
      } else {
        toast.show("error", "Failed to withdraw the report. Please try again.");
      }
      return;
    }
    toast.show("success", "Report withdrawn successfully.");
    setWithdrawOpen(false);
    qc.invalidateQueries({ queryKey: ["issue-report", invoiceId] });
    qc.invalidateQueries({ queryKey: ["invoices.walkin"] });
    onReportChanged();
  }

  async function handleResolve() {
    if (!report) return;
    setBusy(true);
    setResolveError(null);
    const { error } = await supabase.rpc("rpc_resolve_issue_report", {
      p_report_id: report.id,
      p_resolution_notes: resolutionNotes.trim() || null,
    });
    setBusy(false);
    if (error) {
      const msg = error.message || "";
      if (msg.includes("INVOICE_NOT_RECONCILED")) {
        setResolveError("Cannot resolve — invoice has not been reconciled yet.");
        return;
      }
      if (msg.includes("REPORT_NOT_OPEN")) {
        toast.show("error", "This report is no longer open and cannot be resolved.");
      } else if (msg.includes("Not authorized")) {
        toast.show("error", "Only admins can resolve reports.");
      } else {
        toast.show("error", "Failed to resolve the report. Please try again.");
      }
      return;
    }
    toast.show("success", "Report resolved.");
    setResolveOpen(false);
    setResolutionNotes("");
    setResolveError(null);
    qc.invalidateQueries({ queryKey: ["issue-report", invoiceId] });
    qc.invalidateQueries({ queryKey: ["invoices.walkin"] });
    onReportChanged();
  }

  if (reportQ.isLoading) return null;
  if (!report) return null;

  const categoryLabel =
    categoriesQ.data?.find((c) => c.code === report.category)?.label ?? report.category;

  const canWithdraw =
    report.status === "open" && currentUserId === report.reported_by;
  const canResolve =
    report.status === "open" && currentRole === "admin";
  const resolveDisabled = invoiceStatus === "unreconciled";
  const resolveTooltip = resolveDisabled
    ? "Invoice must be reconciled first"
    : undefined;

  return (
    <>
      <Card className={borderColor(report.status as IssueReportStatus)}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Issue Report</CardTitle>
          <div className="flex items-center gap-2">
            {statusBadge(report.status as IssueReportStatus)}
            {canWithdraw && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWithdrawOpen(true)}
              >
                Withdraw
              </Button>
            )}
            {canResolve && (
              <span title={resolveTooltip}>
                <Button
                  size="sm"
                  disabled={resolveDisabled}
                  onClick={() => { setResolutionNotes(""); setResolveError(null); setResolveOpen(true); }}
                >
                  Resolve
                </Button>
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="font-medium">Category:</span>{" "}
            <span>{categoryLabel}</span>
          </div>
          {report.notes && (
            <div>
              <span className="font-medium">Notes:</span>{" "}
              <span className="text-muted-foreground">{report.notes}</span>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Reported on {formatDateTime(report.reported_at)}
          </div>
          {(report.status === "resolved_by_admin" || report.status === "resolved_by_reconciliation") &&
            report.resolved_at && (
              <div className="mt-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-900">
                <div>Resolved on {formatDateTime(report.resolved_at)}</div>
                {report.resolution_notes && (
                  <div className="mt-1">
                    <span className="font-medium">Resolution note:</span> {report.resolution_notes}
                  </div>
                )}
              </div>
            )}
        </CardContent>
      </Card>

      {/* Withdraw confirm dialog */}
      <Dialog
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title="Withdraw this issue report?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setWithdrawOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleWithdraw} disabled={busy}>
              {busy ? "Withdrawing…" : "Yes, withdraw"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          This will mark the report as withdrawn. You can file a new report on this invoice if needed.
        </p>
      </Dialog>

      {/* Resolve dialog (admin only) */}
      <Dialog
        open={resolveOpen}
        onClose={() => { setResolveOpen(false); setResolutionNotes(""); setResolveError(null); }}
        title="Resolve this issue report"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setResolveOpen(false); setResolutionNotes(""); setResolveError(null); }}>
              Cancel
            </Button>
            <Button onClick={handleResolve} disabled={busy}>
              {busy ? "Resolving…" : "Mark as resolved"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {resolveError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {resolveError}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Optionally add a note explaining how the issue was addressed.
          </p>
          <div>
            <Label>Resolution notes (optional)</Label>
            <Textarea
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="How was the issue resolved?"
              rows={3}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
