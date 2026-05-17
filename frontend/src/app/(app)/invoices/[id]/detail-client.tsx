"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatINR, formatDate, formatDateTime } from "@/lib/utils";
import Link from "next/link";
import type {
  HotelInvoice, NewLinkInput, PaymentMethod, ReconciliationLink, SourceTable, TransactionRow, AuditLogRow
} from "@/lib/types";
import { MmtReconcilePanel } from "./mmt-reconcile-panel";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cash", label: "Cash" },
];

const isMmtSource = (source: string | null | undefined) =>
  source === "MakeMyTrip" || source === "Goibibo";

export function InvoiceDetailClient({
  invoice, currentUserId, currentRole,
}: { invoice: HotelInvoice; currentUserId: string | null; currentRole: "admin" | "operator" }) {
  const supabase = React.useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const toast = useToast();

  const linksQ = useQuery({
    queryKey: ["links", invoice.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reconciliation_links")
        .select("*")
        .eq("invoice_id", invoice.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as ReconciliationLink[];
    },
  });

  const invQ = useQuery({
    queryKey: ["invoice", invoice.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hotel_invoice").select("*").eq("id", invoice.id).single();
      if (error) throw error;
      return data as HotelInvoice;
    },
    initialData: invoice,
  });

  const inv = invQ.data!;
  const isMMT = isMmtSource(inv.source);

  // For MMT/Goibibo invoices, fetch the mmt_invoice row to compute net receivable
  const mmtInvQ = useQuery({
    queryKey: ["mmt_invoice_for", inv.booking_id],
    enabled: isMMT && !!inv.booking_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("mmt_invoice")
        .select("room_charges,extra_adult_child_charges,property_taxes,go_mmt_commission,gst_on_commission,tcs,tds")
        .eq("booking_id", inv.booking_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      return data;
    },
  });

  const netReceivable: number | null = React.useMemo(() => {
    if (!isMMT || !mmtInvQ.data) return null;
    const d = mmtInvQ.data;
    return (
      Number(d.room_charges ?? 0) +
      Number(d.extra_adult_child_charges ?? 0) +
      Number(d.property_taxes ?? 0) -
      Number(d.go_mmt_commission ?? 0) -
      Number(d.gst_on_commission ?? 0) -
      Number(d.tcs ?? 0) -
      Number(d.tds ?? 0)
    );
  }, [isMMT, mmtInvQ.data]);

  const linkedTotal = (linksQ.data || []).reduce((s, l) => s + Number(l.amount_applied), 0);
  // For MMT invoices use net receivable as the reconciliation target; fall back to grand_total
  const reconciliationTarget = netReceivable ?? Number(inv.grand_total);
  const outstanding = reconciliationTarget - linkedTotal;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/invoices" className="text-sm text-muted-foreground hover:underline">← Back to invoices</Link>
          <h1 className="text-xl font-semibold mt-1">
            {inv.invoice_number || inv.id.slice(0, 8)}
            <span className="ml-3"><StatusBadge status={inv.reconciliation_status} /></span>
          </h1>
        </div>
        {outstanding > 0.0001 && (
          <a href="#add-payment">
            <Button>Reconcile now</Button>
          </a>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Invoice details</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          {/* Guest & booking info */}
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Guest & Booking</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Guest name" value={inv.guest_name} />
              <Field label="Booking ID" value={inv.booking_id} />
              <Field label="Invoice #" value={inv.invoice_number} />
              <Field label="Source / Channel" value={inv.source} />
              <Field label="Booking date" value={formatDate(inv.booking_date)} />
              <Field label="Check-in" value={formatDate(inv.arrival_time)} />
              <Field label="Check-out" value={formatDate(inv.departure_time)} />
              <Field
                label="Stay duration"
                value={
                  inv.arrival_time && inv.departure_time
                    ? (() => {
                        const nights = Math.round(
                          (new Date(inv.departure_time).getTime() - new Date(inv.arrival_time).getTime()) /
                            (1000 * 60 * 60 * 24)
                        );
                        return nights > 0 ? `${nights} night${nights !== 1 ? "s" : ""}` : "—";
                      })()
                    : "—"
                }
              />
            </div>
          </div>

          {/* Financial breakdown */}
          <div className="border-t pt-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Amount Breakdown</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Room charges (taxable)" value={formatINR(inv.taxable_amount)} />
              <Field label="CGST" value={formatINR(inv.cgst)} />
              <Field label="SGST" value={formatINR(inv.sgst)} />
              <Field
                label="Grand total (billed)"
                value={<span className="text-base font-bold">{formatINR(inv.grand_total)}</span>}
              />
              {isMMT && (
                <Field
                  label="Net receivable from MMT"
                  value={
                    netReceivable !== null ? (
                      <span className="text-base font-bold text-blue-700">{formatINR(netReceivable)}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">Loading…</span>
                    )
                  }
                />
              )}
              {isMMT && netReceivable !== null && (
                <Field
                  label="MMT deductions"
                  value={
                    <span className="text-sm text-red-700">
                      {formatINR(Number(inv.grand_total) - netReceivable)}
                    </span>
                  }
                />
              )}
            </div>
          </div>

          {/* Reconciliation summary */}
          <div className="border-t pt-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Reconciliation Summary</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Field label="Amount linked so far" value={<span className="font-semibold text-green-700">{formatINR(linkedTotal)}</span>} />
              <Field
                label={isMMT ? "Outstanding (vs net receivable)" : "Outstanding balance"}
                value={
                  <span className={outstanding > 0.01 ? "font-semibold text-red-700" : "font-semibold text-green-700"}>
                    {formatINR(Math.max(outstanding, 0))}
                  </span>
                }
              />
              <Field label="Status" value={<StatusBadge status={inv.reconciliation_status} />} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linked payments: shown BEFORE payment panels for reconciled/partial, AFTER for unreconciled */}
      {inv.reconciliation_status !== "unreconciled" && (
        <LinkedPayments
          invoiceId={inv.id}
          links={linksQ.data || []}
          isLoading={linksQ.isLoading}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["links", inv.id] });
            qc.invalidateQueries({ queryKey: ["invoice", inv.id] });
          }}
        />
      )}

      {isMmtSource(inv.source) && (
        <MmtReconcilePanel
          invoice={inv}
          onReconciled={() => {
            qc.invalidateQueries({ queryKey: ["links", inv.id] });
            qc.invalidateQueries({ queryKey: ["invoice", inv.id] });
            qc.invalidateQueries({ queryKey: ["audit.invoice", inv.id] });
          }}
        />
      )}

      <AddPaymentPanel
        invoice={inv}
        outstanding={outstanding}
        initialOpen={!isMmtSource(inv.source)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["links", inv.id] });
          qc.invalidateQueries({ queryKey: ["invoice", inv.id] });
          qc.invalidateQueries({ queryKey: ["audit.invoice", inv.id] });
        }}
      />

      {inv.reconciliation_status === "unreconciled" && (
        <LinkedPayments
          invoiceId={inv.id}
          links={linksQ.data || []}
          isLoading={linksQ.isLoading}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["links", inv.id] });
            qc.invalidateQueries({ queryKey: ["invoice", inv.id] });
          }}
        />
      )}

      <InvoiceAudit invoiceId={inv.id} invoiceNumber={inv.invoice_number} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div>{value || "—"}</div>
    </div>
  );
}

function LinkedPayments({
  invoiceId, links, isLoading, onChanged,
}: { invoiceId: string; links: ReconciliationLink[]; isLoading: boolean; onChanged: () => void; }) {
  const toast = useToast();
  const supabase = React.useMemo(() => createClient(), []);
  const [reqLink, setReqLink] = React.useState<ReconciliationLink | null>(null);
  const [reqInvoice, setReqInvoice] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submitLink() {
    if (!reqLink) return;
    setBusy(true);
    const { error } = await supabase.rpc("rpc_request_unreconcile_link", {
      p_link_id: reqLink.id, p_reason: reason,
    });
    setBusy(false);
    if (error) {
      toast.show("error", prettifyError(error.message));
      return;
    }
    toast.show("success", "Un-reconciliation request submitted. An admin will review it shortly.");
    setReqLink(null); setReason(""); onChanged();
  }
  async function submitInvoice() {
    setBusy(true);
    const { error } = await supabase.rpc("rpc_request_unreconcile_invoice", {
      p_invoice_id: invoiceId, p_reason: reason,
    });
    setBusy(false);
    if (error) {
      toast.show("error", prettifyError(error.message));
      return;
    }
    toast.show("success", "Un-reconciliation request submitted for the entire invoice. An admin will review it shortly.");
    setReqInvoice(false); setReason(""); onChanged();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Linked payments</CardTitle>
        {links.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => { setReason(""); setReqInvoice(true); }}>
            Request to un-reconcile entire invoice
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          : links.length === 0 ? <div className="p-4 text-sm text-muted-foreground">No payments linked yet.</div> : (
          <Table>
            <THead>
              <TR>
                <TH>Method</TH>
                <TH>Source</TH>
                <TH>Source ID</TH>
                <TH className="text-right">Applied</TH>
                <TH>When</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {links.map((l) => (
                <TR key={l.id}>
                  <TD><Badge variant="outline">{l.payment_method}</Badge></TD>
                  <TD className="text-xs">{l.source_table}</TD>
                  <TD className="text-xs font-mono">{l.source_id.slice(0, 8)}</TD>
                  <TD className="text-right tabular-nums">{formatINR(l.amount_applied)}</TD>
                  <TD>{formatDateTime(l.created_at)}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => { setReason(""); setReqLink(l); }} aria-label="Request un-reconciliation">×</Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>

      <Dialog
        open={!!reqLink}
        onClose={() => { setReqLink(null); setReason(""); }}
        title="Request to un-reconcile this payment"
        footer={
          <>
            <Button variant="outline" onClick={() => { setReqLink(null); setReason(""); }}>Cancel</Button>
            <Button onClick={submitLink} disabled={busy || !reason.trim()}>{busy ? "Submitting…" : "Submit request"}</Button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">This will be sent to an admin for approval. The payment remains linked until approved.</p>
          <Label>Reason (required)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does this need to be un-reconciled?" />
        </div>
      </Dialog>

      <Dialog
        open={reqInvoice}
        onClose={() => { setReqInvoice(false); setReason(""); }}
        title="Request to un-reconcile the entire invoice"
        footer={
          <>
            <Button variant="outline" onClick={() => { setReqInvoice(false); setReason(""); }}>Cancel</Button>
            <Button onClick={submitInvoice} disabled={busy || !reason.trim()}>{busy ? "Submitting…" : "Submit request"}</Button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">All linked payments for this invoice will be removed once an admin approves.</p>
          <Label>Reason (required)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does this need to be un-reconciled?" />
        </div>
      </Dialog>
    </Card>
  );
}

// ---------------- Add Payment Panel ----------------

function AddPaymentPanel({
  invoice, outstanding, onSaved, initialOpen = true,
}: { invoice: HotelInvoice; outstanding: number; onSaved: () => void; initialOpen?: boolean }) {
  const supabase = React.useMemo(() => createClient(), []);
  const toast = useToast();
  const router = useRouter();
  const [panelOpen, setPanelOpen] = React.useState(initialOpen);
  const [method, setMethod] = React.useState<PaymentMethod>("upi");
  const [date, setDate] = React.useState("");
  const [debouncedDate, setDebouncedDate] = React.useState("");
  // Once the user picks a date, never auto-override it on method changes
  const userHasEditedDate = React.useRef(false);
  const [cashAmount, setCashAmount] = React.useState("");
  const [pending, setPending] = React.useState<NewLinkInput[]>([]);
  const [pickTxn, setPickTxn] = React.useState<TransactionRow | null>(null);
  const [pickAmount, setPickAmount] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [errorBanner, setErrorBanner] = React.useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = React.useState<null | { kind: "partial" | "overpay"; message: string }>(null);

  // Debounce date input so queries only fire after the user finishes typing (avoids
  // spurious queries for partial dates like "0002-04-01" or "0020-04-01").
  React.useEffect(() => {
    const isComplete = /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (!isComplete) return;
    const timer = setTimeout(() => setDebouncedDate(date), 400);
    return () => clearTimeout(timer);
  }, [date]);

  const remainingForInvoice = outstanding - pending.reduce((s, l) => s + l.amount_applied, 0);

  // For UPI and Card, bank_transfer rows are also relevant (a UPI/card credit appears
  // in both the MPR and the bank statement). We therefore include bank_transfer rows
  // whenever the operator has selected UPI or Card.
  const methodsForQuery = React.useMemo<string[]>(() => {
    if (method === "upi") return ["upi", "bank_transfer"];
    if (method === "card") return ["card", "bank_transfer"];
    return [method];
  }, [method]);

  // Auto-detect the latest date that has transactions for the PRIMARY method (upi/card),
  // not the combined set — this avoids landing on a bank_transfer-only date.
  const latestDateQ = useQuery({
    queryKey: ["txn.latest_date", method],
    enabled: method !== "cash",
    queryFn: async () => {
      const { data } = await supabase
        .from("v_transactions_with_remaining")
        .select("payment_date")
        .eq("payment_method", method)
        .order("payment_date", { ascending: false })
        .limit(1)
        .single();
      return data?.payment_date ?? new Date().toISOString().slice(0, 10);
    },
  });

  // Only auto-update the date when it first loads — never override a date the user picked.
  React.useEffect(() => {
    if (latestDateQ.data && !userHasEditedDate.current) {
      setDate(latestDateQ.data);
      setDebouncedDate(latestDateQ.data);
    }
  }, [latestDateQ.data]);

  const txQ = useQuery({
    queryKey: ["txn", method, debouncedDate],
    enabled: method !== "cash" && /^\d{4}-\d{2}-\d{2}$/.test(debouncedDate),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_transactions_with_remaining")
        .select("*")
        .in("payment_method", methodsForQuery)
        .eq("payment_date", debouncedDate)
        .order("time_text", { ascending: true });
      if (error) throw error;
      // Sort: primary method rows first, then bank_transfer rows
      const rows = (data || []) as TransactionRow[];
      return [
        ...rows.filter((r) => r.payment_method === method),
        ...rows.filter((r) => r.payment_method !== method),
      ];
    },
  });

  function addPending(link: NewLinkInput) {
    setPending((p) => [...p, link]);
  }
  function removePending(idx: number) {
    setPending((p) => p.filter((_, i) => i !== idx));
  }

  function openPicker(t: TransactionRow) {
    if (t.remaining <= 0) return;
    setPickTxn(t);
    const def = Math.min(Number(t.remaining), Math.max(remainingForInvoice, 0) || Number(t.remaining));
    setPickAmount(def.toFixed(2));
  }
  function confirmPicker() {
    if (!pickTxn) return;
    const amt = parseFloat(pickAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.show("error", "Amount must be greater than zero. Enter how much of this transaction you want to apply to this invoice.");
      return;
    }
    if (amt > Number(pickTxn.remaining) + 0.001) {
      toast.show("error", `Only ${formatINR(pickTxn.remaining)} is available on this transaction. Reduce the amount you entered, or pick a different transaction.`);
      return;
    }
    // Toggle off if already selected
    const dupIdx = pending.findIndex((l) => l.source_table === pickTxn.source_table && l.source_id === pickTxn.source_id);
    if (dupIdx >= 0) removePending(dupIdx);
    addPending({
      source_table: pickTxn.source_table,
      source_id: pickTxn.source_id,
      payment_method: pickTxn.payment_method,
      amount_applied: amt,
      _display: {
        identifier_text: pickTxn.identifier_text,
        payment_date: pickTxn.payment_date,
        original_amount: Number(pickTxn.original_amount),
        remaining: Number(pickTxn.remaining),
      },
    });
    setPickTxn(null); setPickAmount("");
  }

  function addCashPending() {
    const amt = parseFloat(cashAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.show("error", "Cash amount must be greater than zero. Enter the exact cash amount received.");
      return;
    }
    if (!date) {
      toast.show("error", "A date is required for the cash entry. Select the date the cash was received.");
      return;
    }
    addPending({
      source_table: "cash_payments",
      payment_method: "cash",
      amount_applied: amt,
      cash_payment_date: date,
      _display: { identifier_text: "Cash", payment_date: date, original_amount: amt, remaining: amt },
    });
    setCashAmount("");
  }

  async function save(opts: { confirm_partial?: boolean; confirm_overpay?: boolean } = {}) {
    if (pending.length === 0) {
      toast.show("error", "No payments added yet. Use the transaction list or cash form above to add at least one payment before saving.");
      return;
    }
    setSaving(true);
    setErrorBanner(null);

    const linksPayload = pending.map((l) => ({
      source_table: l.source_table,
      source_id: l.source_id || null,
      payment_method: l.payment_method,
      amount_applied: l.amount_applied,
      cash_payment_date: l.cash_payment_date || null,
    }));

    let rpcData: any = null;
    let rpcError: any = null;
    try {
      const { data, error } = await supabase.rpc("rpc_reconcile_invoice", {
        p_invoice_id: invoice.id,
        p_links: linksPayload,
        p_confirm_partial: !!opts.confirm_partial,
        p_confirm_overpay: !!opts.confirm_overpay,
      });
      rpcData = data;
      rpcError = error;
    } catch {
      setSaving(false);
      setErrorBanner("Save failed — a network error occurred and nothing was changed. Please check your connection and try again.");
      return;
    }

    setSaving(false);
    if (rpcError) {
      const msg = rpcError.message || String(rpcError);
      if (msg.includes("PARTIAL_CONFIRMATION_REQUIRED")) {
        setConfirmDialog({ kind: "partial", message: msg.replace(/^.*PARTIAL_CONFIRMATION_REQUIRED:\s*/, "") });
        return;
      }
      if (msg.includes("OVERPAY_CONFIRMATION_REQUIRED")) {
        setConfirmDialog({ kind: "overpay", message: msg.replace(/^.*OVERPAY_CONFIRMATION_REQUIRED:\s*/, "") });
        return;
      }
      if (msg.toLowerCase().includes("was just used by another")) {
        setErrorBanner("This transaction was just used by another reconciliation. Please refresh the page and try again — no data was changed.");
        return;
      }
      setErrorBanner(prettifyError(msg));
      return;
    }
    const data = rpcData;
    const newStatus = (data as any)?.reconciliation_status;
    const statusLabel: Record<string, string> = {
      fully_reconciled: "Fully reconciled",
      partial: "Partial — outstanding balance remains",
      flagged_for_review: "Saved and flagged for admin review (overpayment noted)",
      unreconciled: "Saved (unreconciled)",
    };
    toast.show("success", `Reconciliation saved. Invoice status: ${statusLabel[newStatus] ?? newStatus ?? "updated"}.`);
    setPending([]);
    onSaved();
    if (newStatus === "fully_reconciled") {
      router.push("/invoices");
    }
  }

  const sessionTotal = pending.reduce((s, l) => s + l.amount_applied, 0);

  const isFullyReconciled = outstanding <= 0.0001;

  return (
    <Card id="add-payment">
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        className="w-full text-left"
      >
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex-1">
            <CardTitle>{isFullyReconciled ? "Add another payment (already fully reconciled)" : "Add payment / Reconcile"}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFullyReconciled
                ? "This invoice is fully reconciled. You can still link extra payments if needed."
                : `Outstanding: ${formatINR(outstanding)}. Pick a payment method and date, then click a transaction (or add cash) to apply it to this invoice.`}
            </p>
          </div>
          <div className="mt-1 text-muted-foreground" aria-hidden>
            {panelOpen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
            )}
          </div>
        </CardHeader>
      </button>
      {panelOpen && <CardContent className="space-y-4">
        {errorBanner && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{errorBanner}</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>Method</Label>
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {METHODS.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
            </Select>
          </div>
          <div>
            <Label>
              {method === "upi" || method === "card" ? "Settlement date" : "Date"}
            </Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                userHasEditedDate.current = true;
                setDate(e.target.value);
              }}
            />
            {method !== "cash" && (
              <p className="mt-1 text-xs text-muted-foreground">
                {latestDateQ.isLoading
                  ? "Finding latest available date…"
                  : latestDateQ.data
                  ? `Latest available: ${formatDate(latestDateQ.data)}`
                  : "No transactions found for this method"}
              </p>
            )}
          </div>
          {method === "cash" && (
            <div>
              <Label>Cash amount</Label>
              <div className="flex gap-2">
                <Input type="number" min="0" step="0.01" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
                <Button onClick={addCashPending}>Add</Button>
              </div>
            </div>
          )}
        </div>

        {method !== "cash" && (
          <div>
            <div className="text-sm text-muted-foreground mb-2">
              Click a transaction to add it. Greyed out rows are fully reconciled.
            </div>
            {txQ.isLoading ? <div className="text-sm text-muted-foreground">Loading transactions…</div>
              : txQ.isError ? <div className="text-sm text-red-700">{(txQ.error as Error).message}</div>
              : (txQ.data || []).length === 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  No {METHODS.find((m) => m.value === method)?.label ?? method} transactions found for {debouncedDate}.
                  Try a date between April and May 2026, or check if the MPR file for this date has been uploaded.
                </div>
              )
              : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Source</TH>
                      <TH>Identifier</TH>
                      <TH>Time</TH>
                      <TH className="text-right">Original</TH>
                      <TH className="text-right">Used</TH>
                      <TH className="text-right">Remaining</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {(txQ.data || []).map((t) => {
                      const fully = Number(t.remaining) <= 0;
                      return (
                        <TR key={`${t.source_table}-${t.source_id}`} className={fully ? "opacity-50" : ""}>
                          <TD className="text-xs">{t.source_table.replace("_", " ")}</TD>
                          <TD className="text-xs">{t.identifier_text || "—"}</TD>
                          <TD>{t.time_text || "—"}</TD>
                          <TD className="text-right tabular-nums">{formatINR(t.original_amount)}</TD>
                          <TD className="text-right tabular-nums">{formatINR(t.used_amount)}</TD>
                          <TD className="text-right tabular-nums font-medium">{formatINR(t.remaining)}</TD>
                          <TD className="text-right">
                            <Button
                              size="sm" variant={fully ? "ghost" : "outline"}
                              disabled={fully}
                              title={fully ? "Fully reconciled against other invoices" : "Add this transaction"}
                              onClick={() => openPicker(t)}
                            >Add</Button>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
          </div>
        )}

        <div>
          <div className="text-sm font-medium mb-2">Linked payments (this session)</div>
          {pending.length === 0 ? <div className="text-sm text-muted-foreground">Nothing added yet.</div> : (
            <Table>
              <THead>
                <TR>
                  <TH>Method</TH>
                  <TH>Identifier</TH>
                  <TH>Date</TH>
                  <TH className="text-right">Applying</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {pending.map((l, i) => (
                  <TR key={i}>
                    <TD><Badge variant="outline">{l.payment_method}</Badge></TD>
                    <TD className="text-xs">{l._display?.identifier_text || l.source_table}</TD>
                    <TD>{formatDate(l._display?.payment_date || l.cash_payment_date || "")}</TD>
                    <TD className="text-right tabular-nums">{formatINR(l.amount_applied)}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => removePending(i)} aria-label="Remove">×</Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <div className="mt-3 flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
            <div>
              Session total <span className="font-semibold">{formatINR(sessionTotal)}</span>
              <span className="ml-3 text-muted-foreground">
                Outstanding after save: {formatINR(outstanding - sessionTotal)}
              </span>
            </div>
            <Button onClick={() => save()} disabled={saving || pending.length === 0}>
              {saving ? "Saving…" : "Save reconciliation"}
            </Button>
          </div>
        </div>
      </CardContent>}

      {/* Pick amount modal */}
      <Dialog
        open={!!pickTxn} onClose={() => setPickTxn(null)}
        title="How much of this transaction goes to this invoice?"
        footer={
          <>
            <Button variant="outline" onClick={() => setPickTxn(null)}>Cancel</Button>
            <Button onClick={confirmPicker}>Add</Button>
          </>
        }
      >
        {pickTxn && (
          <div className="space-y-2 text-sm">
            <div>Original amount: <span className="font-medium">{formatINR(pickTxn.original_amount)}</span></div>
            <div>Remaining: <span className="font-medium">{formatINR(pickTxn.remaining)}</span></div>
            <Label>Amount to apply</Label>
            <Input type="number" min="0" step="0.01" value={pickAmount} onChange={(e) => setPickAmount(e.target.value)} />
          </div>
        )}
      </Dialog>

      {/* Partial / overpay confirmation */}
      <Dialog
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.kind === "partial" ? "Save as partial?" : "Flag for admin review?"}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button onClick={() => {
              const k = confirmDialog!.kind;
              setConfirmDialog(null);
              save(k === "partial" ? { confirm_partial: true } : { confirm_overpay: true });
            }}>Confirm</Button>
          </>
        }
      >
        <p className="text-sm">{confirmDialog?.message}</p>
      </Dialog>
    </Card>
  );
}

/**
 * Converts a raw Postgres/Supabase error message into an operator-friendly sentence.
 * Rules:
 * - Strip all Postgres severity prefixes ("ERROR:", "P0001:" etc.)
 * - If the underlying message already starts with a user-facing phrase, return it as-is.
 * - For unrecognised messages, wrap in a generic action-oriented message.
 */
function prettifyError(msg: string): string {
  // Strip Postgres prefixes like "ERROR:  ", "P0001: ERROR:", RPC envelope etc.
  const clean = msg
    .replace(/^[A-Z0-9]{5}:\s*/g, "")
    .replace(/^error(:\s*)?/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Some RPC messages start with "Cannot save:" already — keep them verbatim.
  if (/^cannot save/i.test(clean)) return clean;

  // Known sentinel patterns already stripped by the caller; just return cleaned text.
  if (clean.length > 0) return clean;

  return "Save failed — nothing was changed. Please try again or contact support.";
}

function InvoiceAudit({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string | null }) {
  const [open, setOpen] = React.useState(false);
  const supabase = React.useMemo(() => createClient(), []);
  const q = useQuery({
    queryKey: ["audit.invoice", invoiceId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log").select("*").eq("entity_id", invoiceId)
        .order("occurred_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as AuditLogRow[];
    },
  });

  return (
    <Card>
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-base font-semibold">
            Audit trail{invoiceNumber ? ` — ${invoiceNumber}` : ""}
          </div>
          <div className="text-sm text-muted-foreground">{open ? "Hide" : "Show"}</div>
        </div>
      </button>
      {open && (
        <CardContent className="p-0">
          {q.isLoading ? <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            : (q.data || []).length === 0 ? <div className="p-4 text-sm text-muted-foreground">No audit entries.</div>
            : (
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Invoice</TH>
                    <TH>Action</TH>
                    <TH>Actor</TH>
                    <TH>Entity</TH>
                  </TR>
                </THead>
                <TBody>
                  {(q.data || []).map((r) => (
                    <TR key={r.id}>
                      <TD>{formatDateTime(r.occurred_at)}</TD>
                      <TD className="text-xs font-medium">{invoiceNumber || "—"}</TD>
                      <TD className="font-mono text-xs">{r.action}</TD>
                      <TD className="text-xs">{r.actor_user_id?.slice(0, 8) || "—"}</TD>
                      <TD className="text-xs">{r.entity_type}/{r.entity_id?.slice(0, 8)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
        </CardContent>
      )}
    </Card>
  );
}
