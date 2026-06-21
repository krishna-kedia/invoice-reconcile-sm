"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatINR, formatDate } from "@/lib/utils";
import type { ManualPaymentEntry } from "@/lib/types";

// The admin view of a manual payment entry — extends ManualPaymentEntry with
// invoice context fields returned by rpc_get_pending_manual_payments.
interface AdminManualPaymentEntry extends ManualPaymentEntry {
  invoice_number: string | null;
  guest_name: string | null;
}

type TabStatus = "pending" | "approved" | "rejected";

// Sentinel error codes returned by approve RPC
const APPROVE_INLINE_ERRORS = new Set([
  "MANUAL_UPI_EXCEEDS_BANK_CREDIT",
  "WRITEOFF_EXCEEDS_GAP",
]);

const FLAG_LABELS: Record<string, string> = {
  NO_BANK_CREDIT: "No bank credit found",
  MPR_LINK_UNVERIFIED: "MPR link unverified",
};

function flagLabel(code: string): string {
  return FLAG_LABELS[code] ?? code;
}

function prettifyError(msg: string): string {
  return msg
    .replace(/^[A-Z0-9_]+:\s*/g, "")
    .replace(/^error(:\s*)?/i, "")
    .replace(/\s+/g, " ")
    .trim() || "An unexpected error occurred. Please try again.";
}

function paymentTypeLabel(type: string): string {
  switch (type) {
    case "upi": return "UPI";
    case "another_machine": return "Another Machine";
    case "commission": return "Commission";
    case "tds": return "TDS";
    default: return type;
  }
}

const PAYMENT_TYPE_CLASS: Record<string, string> = {
  upi: "bg-blue-100 text-blue-800",
  another_machine: "bg-slate-100 text-slate-600",
  commission: "bg-orange-100 text-orange-800",
  tds: "bg-purple-100 text-purple-700",
};

// ---- Warning flag chips ----
function FlagChips({ flags }: { flags: Array<{ code: string; [key: string]: unknown }> }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
        >
          {flagLabel(f.code)}
        </span>
      ))}
    </div>
  );
}

// ---- Skeleton rows ----
function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <TR key={i}>
          {Array.from({ length: 8 }).map((_, j) => (
            <TD key={j}>
              <div className="h-4 rounded bg-muted animate-pulse" />
            </TD>
          ))}
        </TR>
      ))}
    </>
  );
}

// ---- Reject dialog ----
interface RejectDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
}

function RejectDialog({ open, onClose, onConfirm, busy }: RejectDialogProps) {
  const [reason, setReason] = React.useState("");

  // Reset when dialog opens
  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Reject payment entry"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(reason)}
            disabled={busy || !reason.trim()}
          >
            {busy ? "Rejecting…" : "Reject"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Provide a reason for rejection. The submitter will be able to see this.
        </p>
        <div>
          <Label htmlFor="reject-reason">Reason (required)</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The UPI transaction ID does not match any bank credit on this date."
            rows={3}
          />
        </div>
      </div>
    </Dialog>
  );
}

// ---- Main page ----
export default function ManualPaymentsPage() {
  const [tab, setTab] = React.useState<TabStatus>("pending");
  const supabase = React.useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const toast = useToast();

  // Per-row state: approve inline errors keyed by entry id
  const [approveErrors, setApproveErrors] = React.useState<Record<string, string>>({});
  const [approveBusy, setApproveBusy] = React.useState<Record<string, boolean>>({});

  // Reject dialog state
  const [rejectTarget, setRejectTarget] = React.useState<AdminManualPaymentEntry | null>(null);
  const [rejectBusy, setRejectBusy] = React.useState(false);

  const q = useQuery({
    queryKey: ["admin.manual_payments", tab],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_get_pending_manual_payments", {
        p_status: tab,
      });
      if (error) throw error;
      return ((data as any)?.entries ?? []) as AdminManualPaymentEntry[];
    },
  });

  async function handleApprove(entry: AdminManualPaymentEntry) {
    setApproveBusy((prev) => ({ ...prev, [entry.id]: true }));
    setApproveErrors((prev) => ({ ...prev, [entry.id]: "" }));

    const { data, error } = await supabase.rpc("rpc_approve_manual_payment_entry", {
      p_entry_id: entry.id,
    });

    setApproveBusy((prev) => ({ ...prev, [entry.id]: false }));

    if (error) {
      // Check if the error code is one we surface inline rather than as a toast
      const raw = error.message ?? "";
      const sentinel = raw.match(/^([A-Z0-9_]+):/)?.[1];
      if (sentinel && APPROVE_INLINE_ERRORS.has(sentinel)) {
        setApproveErrors((prev) => ({
          ...prev,
          [entry.id]: prettifyError(raw),
        }));
      } else {
        toast.show("error", prettifyError(raw));
      }
      return;
    }

    // Treat a successful-but-error-payload response (some RPCs return {error: ...})
    if (data && typeof data === "object" && "error" in data) {
      const payload = data as { error: string };
      const sentinel = payload.error?.match(/^([A-Z0-9_]+):/)?.[1];
      if (sentinel && APPROVE_INLINE_ERRORS.has(sentinel)) {
        setApproveErrors((prev) => ({
          ...prev,
          [entry.id]: prettifyError(payload.error),
        }));
      } else {
        toast.show("error", prettifyError(payload.error));
      }
      return;
    }

    toast.show("success", "Payment entry approved successfully.");
    // Remove the row optimistically and refetch
    qc.invalidateQueries({ queryKey: ["admin.manual_payments"] });
  }

  async function handleReject(reason: string) {
    if (!rejectTarget) return;
    setRejectBusy(true);

    const { error } = await supabase.rpc("rpc_reject_manual_payment_entry", {
      p_entry_id: rejectTarget.id,
      p_reason: reason,
    });

    setRejectBusy(false);

    if (error) {
      toast.show("error", prettifyError(error.message));
      return;
    }

    toast.show("success", "Payment entry rejected.");
    setRejectTarget(null);
    qc.invalidateQueries({ queryKey: ["admin.manual_payments"] });
  }

  const entries = q.data ?? [];
  const isPending = tab === "pending";

  return (
    <div className="space-y-4">
      {/* Page header + tabs */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Manual Payments</h1>
        <div className="flex rounded-md border bg-card text-sm">
          {(["pending", "approved", "rejected"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 capitalize ${
                tab === t
                  ? "bg-primary text-primary-foreground rounded-md"
                  : "text-muted-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Loading */}
          {q.isLoading && (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice #</TH>
                  <TH>Guest</TH>
                  <TH>Type</TH>
                  <TH>Amount</TH>
                  <TH>Txn Date</TH>
                  <TH>Submitted by</TH>
                  <TH>Warnings</TH>
                  {isPending && <TH />}
                </TR>
              </THead>
              <TBody>
                <SkeletonRows />
              </TBody>
            </Table>
          )}

          {/* Error */}
          {q.isError && (
            <div className="p-8 text-center">
              <div className="text-sm font-medium text-red-700">
                Could not load manual payments
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {prettifyError((q.error as Error)?.message ?? "Unknown error")}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => q.refetch()}
              >
                Try again
              </Button>
            </div>
          )}

          {/* Empty */}
          {!q.isLoading && !q.isError && entries.length === 0 && (
            <div className="p-8 text-center">
              <div className="text-sm font-medium text-foreground">
                {tab === "pending"
                  ? "No pending entries"
                  : tab === "approved"
                  ? "No approved entries"
                  : "No rejected entries"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {tab === "pending"
                  ? "There are no manual payment entries waiting for your review."
                  : `No manual payment entries have been ${tab} yet.`}
              </div>
            </div>
          )}

          {/* Populated table */}
          {!q.isLoading && !q.isError && entries.length > 0 && (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice #</TH>
                  <TH>Guest</TH>
                  <TH>Type</TH>
                  <TH>Amount</TH>
                  <TH>Txn Date</TH>
                  <TH>Submitted by</TH>
                  <TH>Warnings</TH>
                  {isPending && <TH />}
                </TR>
              </THead>
              <TBody>
                {entries.map((entry) => (
                  <TR key={entry.id} className={isPending ? "border-l-2 border-amber-400" : ""}>
                    {/* Invoice # */}
                    <TD className="text-xs font-medium">
                      {entry.invoice_number ? (
                        <Link
                          href={`/invoices/${entry.invoice_id}`}
                          className="text-primary underline underline-offset-2 hover:text-primary/80"
                        >
                          {entry.invoice_number}
                        </Link>
                      ) : (
                        <Link
                          href={`/invoices/${entry.invoice_id}`}
                          className="font-mono text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          {entry.invoice_id.slice(0, 8)}
                        </Link>
                      )}
                    </TD>

                    {/* Guest */}
                    <TD className="text-xs text-muted-foreground">
                      {entry.guest_name ?? "—"}
                    </TD>

                    {/* Type */}
                    <TD>
                      <Badge className={PAYMENT_TYPE_CLASS[entry.payment_type] ?? ""}>
                        {paymentTypeLabel(entry.payment_type)}
                      </Badge>
                    </TD>

                    {/* Amount */}
                    <TD className="text-xs font-medium tabular-nums">
                      {formatINR(entry.amount)}
                    </TD>

                    {/* Transaction date */}
                    <TD className="text-xs text-muted-foreground">
                      {formatDate(entry.transaction_date)}
                    </TD>

                    {/* Submitted by */}
                    <TD className="text-xs text-muted-foreground max-w-[160px] truncate">
                      {entry.submitter_email ?? entry.submitted_by.slice(0, 8)}
                    </TD>

                    {/* Warning flags */}
                    <TD>
                      <FlagChips flags={entry.admin_flags ?? []} />
                    </TD>

                    {/* Actions — only on pending tab */}
                    {isPending && (
                      <TD className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-700 border-red-200 hover:bg-red-50"
                              onClick={() => setRejectTarget(entry)}
                              disabled={approveBusy[entry.id]}
                            >
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleApprove(entry)}
                              disabled={approveBusy[entry.id]}
                            >
                              {approveBusy[entry.id] ? "Approving…" : "Approve"}
                            </Button>
                          </div>
                          {/* Inline approve error */}
                          {approveErrors[entry.id] && (
                            <p className="text-xs text-red-600 mt-1 max-w-[260px] text-right">
                              {approveErrors[entry.id]}
                            </p>
                          )}
                        </div>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reject dialog */}
      <RejectDialog
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleReject}
        busy={rejectBusy}
      />
    </div>
  );
}
