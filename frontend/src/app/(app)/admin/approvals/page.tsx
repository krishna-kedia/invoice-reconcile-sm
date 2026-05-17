"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import type { ApprovalRequest } from "@/lib/types";

const REQUEST_TYPE_LABELS: Record<string, string> = {
  unreconcile_link: "Un-reconcile payment",
  unreconcile_invoice: "Un-reconcile invoice",
  cash_edit: "Edit cash entry",
  cash_delete: "Delete cash entry",
};

export default function ApprovalsPage() {
  const [tab, setTab] = React.useState<"pending" | "decided">("pending");
  const supabase = React.useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const toast = useToast();

  const q = useQuery({
    queryKey: ["approvals", tab],
    queryFn: async () => {
      let query = supabase.from("approval_requests").select("*").order("requested_at", { ascending: false }).limit(200);
      if (tab === "pending") query = query.eq("status", "pending");
      else query = query.in("status", ["approved", "rejected"]);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as ApprovalRequest[];
    },
  });

  const [active, setActive] = React.useState<ApprovalRequest | null>(null);
  const [rejectNote, setRejectNote] = React.useState("");
  const [approveNote, setApproveNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  function prettifyError(msg: string): string {
    return msg
      .replace(/^[A-Z0-9]{5}:\s*/g, "")
      .replace(/^error(:\s*)?/i, "")
      .replace(/\s+/g, " ")
      .trim() || "An unexpected error occurred. Please try again.";
  }

  async function approve() {
    if (!active) return;
    setBusy(true);
    const { error } = await supabase.rpc("rpc_approve_request", { p_request_id: active.id, p_note: approveNote || null });
    setBusy(false);
    if (error) {
      toast.show("error", prettifyError(error.message));
      return;
    }
    toast.show("success", "Request approved. The change has been applied.");
    setActive(null); setApproveNote(""); setRejectNote("");
    qc.invalidateQueries({ queryKey: ["approvals"] });
  }
  async function reject() {
    if (!active) return;
    if (!rejectNote.trim()) {
      toast.show("error", "A rejection note is required. Explain to the operator why the request was denied.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("rpc_reject_request", { p_request_id: active.id, p_note: rejectNote });
    setBusy(false);
    if (error) {
      toast.show("error", prettifyError(error.message));
      return;
    }
    toast.show("success", "Request rejected. The operator has been notified.");
    setActive(null); setApproveNote(""); setRejectNote("");
    qc.invalidateQueries({ queryKey: ["approvals"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Approvals</h1>
        <div className="flex rounded-md border bg-card text-sm">
          <button onClick={() => setTab("pending")}
            className={`px-3 py-1.5 ${tab === "pending" ? "bg-primary text-primary-foreground rounded-md" : "text-muted-foreground"}`}>
            Pending
          </button>
          <button onClick={() => setTab("decided")}
            className={`px-3 py-1.5 ${tab === "decided" ? "bg-primary text-primary-foreground rounded-md" : "text-muted-foreground"}`}>
            Decided
          </button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="divide-y">
              {[1, 2, 3].map((i) => (
                <div key={i} className="px-4 py-3 animate-pulse flex gap-4">
                  <div className="h-4 w-28 rounded bg-muted" />
                  <div className="h-4 w-20 rounded bg-muted" />
                  <div className="h-4 w-40 rounded bg-muted" />
                  <div className="h-4 flex-1 rounded bg-muted" />
                </div>
              ))}
            </div>
          )
            : (q.data || []).length === 0 ? (
              <div className="p-8 text-center">
                <div className="text-sm font-medium text-foreground">
                  {tab === "pending" ? "No pending requests" : "No decided requests"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {tab === "pending"
                    ? "All clear — there are no operator requests waiting for your review."
                    : "No requests have been approved or rejected yet."}
                </div>
              </div>
            )
            : (
              <Table>
                <THead>
                  <TR>
                    <TH>Type</TH>
                    <TH>Target</TH>
                    <TH>Requested at</TH>
                    <TH>Reason</TH>
                    <TH>Status</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {(q.data || []).map((r) => (
                    <TR key={r.id}>
                      <TD className="text-xs font-medium">{REQUEST_TYPE_LABELS[r.request_type] ?? r.request_type}</TD>
                      <TD className="text-xs font-mono text-muted-foreground">{(r.target_invoice_id || r.target_link_id || r.target_cash_id || "—").slice(0, 8)}</TD>
                      <TD className="text-xs">{formatDateTime(r.requested_at)}</TD>
                      <TD className="max-w-xs truncate text-xs text-muted-foreground">{r.reason}</TD>
                      <TD>
                        {r.status === "pending" && <Badge variant="warning">Pending</Badge>}
                        {r.status === "approved" && <Badge variant="success">Approved</Badge>}
                        {r.status === "rejected" && <Badge variant="destructive">Rejected</Badge>}
                      </TD>
                      <TD className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setActive(r)}>Open</Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
        </CardContent>
      </Card>

      <Dialog
        open={!!active} onClose={() => setActive(null)} size="lg"
        title={active ? `Request: ${active.request_type}` : ""}
        footer={
          active?.status === "pending" ? (
            <>
              <Button variant="destructive" onClick={reject} disabled={busy}>Reject</Button>
              <Button onClick={approve} disabled={busy}>{busy ? "Working…" : "Approve"}</Button>
            </>
          ) : <Button variant="outline" onClick={() => setActive(null)}>Close</Button>
        }
      >
        {active && (
          <div className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Reason:</span> {active.reason}</div>
            <div><span className="text-muted-foreground">Requested by:</span> {active.requested_by}</div>
            <div><span className="text-muted-foreground">Status:</span> {active.status}</div>
            {active.payload && <pre className="rounded bg-muted p-2 text-xs overflow-auto">{JSON.stringify(active.payload, null, 2)}</pre>}
            {active.status === "pending" && (
              <>
                <div className="pt-2"><Label>Approval note (optional)</Label>
                  <Textarea value={approveNote} onChange={(e) => setApproveNote(e.target.value)} /></div>
                <div><Label>Rejection note (required to reject)</Label>
                  <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} /></div>
              </>
            )}
            {active.status !== "pending" && active.decision_note && (
              <div><span className="text-muted-foreground">Decision note:</span> {active.decision_note}</div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
