"use client";

/**
 * YatraReconcilePanel — Yatra Payout Reconcile
 *
 * Renders alongside AddPaymentPanel on hotel_invoice detail pages where
 * `source` includes 'yatra' (case-insensitive). Lets the operator:
 *   1. Pick a voucher_no (auto-selects if guest name matches).
 *   2. View / edit the yatra_bookings_payout numeric fields.
 *   3. Pick a bank transaction to reconcile against.
 *   4. Reconcile in one atomic call (rpc_reconcile_yatra_invoice).
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatINR, formatDate } from "@/lib/utils";
import type {
  YatraBookingPayout,
  YatraReconcileCandidatesResponse,
  TransactionRow,
} from "@/lib/types";

// Number → string with 2-decimal precision, safe for null/undef
const num = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "0" : Number(v).toFixed(2);

// Allowed payment methods for Yatra reconciliation
const YATRA_METHODS = ["upi", "card", "bank_transfer"] as const;
type YatraPaymentMethod = (typeof YATRA_METHODS)[number];

const YATRA_METHOD_LABELS: Record<YatraPaymentMethod, string> = {
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank Transfer",
};

/** Editable numeric fields on yatra_bookings_payout */
const YATRA_EDIT_FIELDS: Array<{
  key: keyof YatraBookingPayout;
  label: string;
  sign: "+" | "-";
  highlight?: boolean;
}> = [
  { key: "total_room_charges", label: "Total room charges", sign: "+" },
  { key: "other_charges", label: "Other charges", sign: "+" },
  { key: "hotel_gross_charges", label: "Hotel gross charges", sign: "+" },
  { key: "yatra_commission", label: "Yatra commission", sign: "-" },
  { key: "yatra_commission_with_gst", label: "Yatra commission with GST", sign: "-" },
  { key: "gst", label: "GST", sign: "-" },
  { key: "tcs", label: "TCS", sign: "-" },
  { key: "tds", label: "TDS", sign: "-" },
  { key: "yatra_to_pay_hotel", label: "Net to pay hotel", sign: "+", highlight: true },
];

export function YatraReconcilePanel({
  invoiceId,
  onReconciled,
}: {
  invoiceId: string;
  onReconciled: () => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();

  const [selectedVoucherNo, setSelectedVoucherNo] = React.useState<string | null>(null);
  const [voucherSearch, setVoucherSearch] = React.useState("");
  const [voucherDropdownOpen, setVoucherDropdownOpen] = React.useState(false);
  const voucherInputRef = React.useRef<HTMLInputElement>(null);

  const [saving, setSaving] = React.useState(false);
  const [errorBanner, setErrorBanner] = React.useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = React.useState<
    null | { kind: "partial" | "overpay"; message: string }
  >(null);

  // Local draft buffer for editable fields — keyed by field name
  const [draft, setDraft] = React.useState<Record<string, string>>({});

  // Transaction picker state
  const [txMethod, setTxMethod] = React.useState<YatraPaymentMethod>("bank_transfer");
  const [txDate, setTxDate] = React.useState("");
  const [debouncedTxDate, setDebouncedTxDate] = React.useState("");
  const [pickTxn, setPickTxn] = React.useState<TransactionRow | null>(null);
  const [pickAmount, setPickAmount] = React.useState("");
  const [selectedTxn, setSelectedTxn] = React.useState<{
    txn: TransactionRow;
    amount: number;
  } | null>(null);

  // -----------------------------------------------------------------
  // Debounce tx date input
  // -----------------------------------------------------------------
  React.useEffect(() => {
    const isComplete = /^\d{4}-\d{2}-\d{2}$/.test(txDate);
    if (!isComplete) return;
    const timer = setTimeout(() => setDebouncedTxDate(txDate), 400);
    return () => clearTimeout(timer);
  }, [txDate]);

  // -----------------------------------------------------------------
  // 1. Load candidate voucher_nos
  // -----------------------------------------------------------------
  const candidatesQ = useQuery({
    queryKey: ["yatra-candidates", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "rpc_get_yatra_reconcile_candidates",
        { p_hotel_invoice_id: invoiceId }
      );
      if (error) throw new Error(error.message);
      return data as YatraReconcileCandidatesResponse;
    },
  });

  // Auto-select default voucher when candidates load
  React.useEffect(() => {
    if (!selectedVoucherNo && candidatesQ.data?.default_voucher_no) {
      setSelectedVoucherNo(candidatesQ.data.default_voucher_no);
    }
  }, [candidatesQ.data, selectedVoucherNo]);

  const matchType = candidatesQ.data?.match_type ?? "none";
  const candidates = candidatesQ.data?.candidates ?? [];

  // -----------------------------------------------------------------
  // 2. Load detail when a voucher_no is selected
  // -----------------------------------------------------------------
  const detailQ = useQuery<YatraBookingPayout, Error>({
    queryKey: ["yatra-detail", selectedVoucherNo],
    enabled: !!selectedVoucherNo,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_get_yatra_reconcile_detail", {
        p_voucher_no: selectedVoucherNo,
      });
      if (error) throw new Error(error.message);
      return data as YatraBookingPayout;
    },
  });

  // Reset drafts and transaction picker when detail row changes
  React.useEffect(() => {
    setDraft({});
    setErrorBanner(null);
    setSelectedTxn(null);
  }, [detailQ.data?.id]);

  // Auto-detect latest date for selected tx method
  const latestDateQ = useQuery({
    queryKey: ["txn.latest_date", txMethod],
    queryFn: async () => {
      const { data } = await supabase
        .from("v_transactions_with_remaining")
        .select("payment_date")
        .eq("payment_method", txMethod)
        .order("payment_date", { ascending: false })
        .limit(1)
        .single();
      return data?.payment_date ?? new Date().toISOString().slice(0, 10);
    },
  });

  const userHasEditedDate = React.useRef(false);
  React.useEffect(() => {
    if (latestDateQ.data && !userHasEditedDate.current) {
      setTxDate(latestDateQ.data);
      setDebouncedTxDate(latestDateQ.data);
    }
  }, [latestDateQ.data]);

  // -----------------------------------------------------------------
  // 3. Load transactions for date + method
  // -----------------------------------------------------------------
  const txQ = useQuery({
    queryKey: ["txn", txMethod, debouncedTxDate],
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(debouncedTxDate),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_transactions_with_remaining")
        .select("*")
        .eq("payment_method", txMethod)
        .eq("payment_date", debouncedTxDate)
        .order("time_text", { ascending: true });
      if (error) throw error;
      return (data || []) as TransactionRow[];
    },
  });

  // -----------------------------------------------------------------
  // 4. Field-update mutation for yatra_bookings_payout
  // -----------------------------------------------------------------
  const updateFieldsMut = useMutation({
    mutationFn: async (fields: Record<string, number>) => {
      const { error } = await supabase.rpc(
        "rpc_update_yatra_bookings_payout_fields",
        { p_id: detailQ.data!.id, p_fields: fields }
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["yatra-detail", selectedVoucherNo] });
    },
  });

  // -----------------------------------------------------------------
  // 5. Reconcile action
  // -----------------------------------------------------------------
  async function reconcile(opts: { confirm_partial?: boolean; confirm_overpay?: boolean } = {}) {
    const detail = detailQ.data;
    if (!detail || !selectedTxn) return;
    setSaving(true);
    setErrorBanner(null);
    try {
      const { data, error } = await supabase.rpc("rpc_reconcile_yatra_invoice", {
        p_hotel_invoice_id: invoiceId,
        p_yatra_bookings_payout_id: detail.id,
        p_source_table: selectedTxn.txn.source_table,
        p_source_id: selectedTxn.txn.source_id,
        p_payment_method: selectedTxn.txn.payment_method,
        p_amount_applied: selectedTxn.amount,
        p_confirm_partial: !!opts.confirm_partial,
        p_confirm_overpay: !!opts.confirm_overpay,
      });
      if (error) {
        const msg = error.message || String(error);
        if (msg.includes("CONFIRM_PARTIAL_REQUIRED")) {
          setConfirmDialog({
            kind: "partial",
            message: msg.replace(/^.*CONFIRM_PARTIAL_REQUIRED:\s*/, ""),
          });
          return;
        }
        if (msg.includes("OVERPAY_NOT_ALLOWED")) {
          setConfirmDialog({
            kind: "overpay",
            message: msg.replace(/^.*OVERPAY_NOT_ALLOWED:\s*/, ""),
          });
          return;
        }
        setErrorBanner(prettifyYatraError(msg));
        return;
      }
      const result = data as { new_status?: string; link_id?: string; invoice_id?: string } | null;
      const newStatus = result?.new_status;
      toast.show(
        "success",
        `Yatra payout reconciled (${formatINR(selectedTxn.amount)}). Invoice status: ${newStatus ?? "updated"}.`
      );
      onReconciled();
      if (newStatus === "fully_reconciled") {
        router.push("/invoices");
        return;
      }
      // Partial — stay on page, reset selection
      setSelectedVoucherNo(null);
      setSelectedTxn(null);
      qc.invalidateQueries({ queryKey: ["yatra-candidates", invoiceId] });
    } catch {
      setErrorBanner(
        "Save failed — a network error occurred and nothing was changed. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  // -----------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------
  const detail = detailQ.data;

  const detailErrorKind = React.useMemo(() => {
    const msg = (detailQ.error as Error | null)?.message ?? "";
    if (!msg) return null;
    if (msg.includes("YATRA_VOUCHER_NOT_FOUND")) return "YATRA_VOUCHER_NOT_FOUND";
    return "GENERIC";
  }, [detailQ.error]);

  function openPicker(t: TransactionRow) {
    if (t.remaining <= 0) return;
    setPickTxn(t);
    const netToPay = Number(detail?.yatra_to_pay_hotel ?? 0);
    const def = netToPay > 0 ? Math.min(Number(t.remaining), netToPay) : Number(t.remaining);
    setPickAmount(def.toFixed(2));
  }

  function confirmPicker() {
    if (!pickTxn) return;
    const amt = parseFloat(pickAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.show(
        "error",
        "Amount must be greater than zero. Enter how much of this transaction to apply to this invoice."
      );
      return;
    }
    if (amt > Number(pickTxn.remaining) + 0.001) {
      toast.show(
        "error",
        `Only ${formatINR(pickTxn.remaining)} is available on this transaction. Reduce the amount or pick a different transaction.`
      );
      return;
    }
    setSelectedTxn({ txn: pickTxn, amount: amt });
    setPickTxn(null);
    setPickAmount("");
  }

  const isAlreadyReconciled = !!detail?.reconciled_at;
  const netToPay = Number(detail?.yatra_to_pay_hotel ?? 0);

  return (
    <Card id="yatra-reconcile" className="border-blue-200">
      <CardHeader>
        <CardTitle>Yatra Payout Reconcile</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          For invoices booked via Yatra, reconcile directly against the matched payout email. Select
          the voucher, verify amounts, pick the bank transaction, then click Reconcile.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorBanner && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {errorBanner}
          </div>
        )}

        {/* Voucher selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Voucher No</Label>
            <div className="relative">
              <Input
                ref={voucherInputRef}
                type="text"
                placeholder="Search voucher no or guest name…"
                value={
                  voucherDropdownOpen
                    ? voucherSearch
                    : selectedVoucherNo
                    ? (() => {
                        const c = candidates.find((c) => c.voucher_no === selectedVoucherNo);
                        return c
                          ? `${c.voucher_no}${c.guest_name ? ` — ${c.guest_name}` : ""}`
                          : selectedVoucherNo;
                      })()
                    : ""
                }
                onChange={(e) => {
                  setVoucherSearch(e.target.value);
                  setVoucherDropdownOpen(true);
                }}
                onFocus={() => {
                  setVoucherSearch("");
                  setVoucherDropdownOpen(true);
                }}
                onBlur={() => {
                  setTimeout(() => setVoucherDropdownOpen(false), 150);
                }}
                autoComplete="off"
              />
              {voucherDropdownOpen && (
                <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-background shadow-lg max-h-56 overflow-y-auto">
                  {(() => {
                    const q = voucherSearch.toLowerCase();
                    const filtered = candidates.filter(
                      (c) =>
                        c.voucher_no.toLowerCase().includes(q) ||
                        (c.guest_name ?? "").toLowerCase().includes(q)
                    );
                    if (filtered.length === 0)
                      return (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          {candidatesQ.isLoading ? "Loading…" : "No matches found."}
                        </div>
                      );
                    return filtered.map((c) => (
                      <button
                        key={c.voucher_no}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-baseline gap-2"
                        onMouseDown={() => {
                          setSelectedVoucherNo(c.voucher_no);
                          setVoucherSearch("");
                          setVoucherDropdownOpen(false);
                        }}
                      >
                        <span className="font-mono">{c.voucher_no}</span>
                        {c.is_default && (
                          <span className="text-xs text-green-700 font-medium">(this invoice)</span>
                        )}
                        {c.guest_name && (
                          <span className="text-xs text-muted-foreground">{c.guest_name}</span>
                        )}
                        {c.yatra_to_pay_hotel !== null && (
                          <span className="ml-auto text-xs tabular-nums text-blue-700">
                            {formatINR(c.yatra_to_pay_hotel)}
                          </span>
                        )}
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>

            {/* Match badge */}
            {candidatesQ.isLoading && (
              <p className="mt-1 text-xs text-muted-foreground">Loading candidates…</p>
            )}
            {!candidatesQ.isLoading && selectedVoucherNo && matchType === "guest_name" && (
              <p className="mt-1 text-xs">
                <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50">
                  Guest name match
                </Badge>
              </p>
            )}
            {!candidatesQ.isLoading && matchType === "none" && candidates.length > 0 && !selectedVoucherNo && (
              <p className="mt-1 text-xs">
                <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
                  No match — select manually
                </Badge>
              </p>
            )}
            {!candidatesQ.isLoading && candidates.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">
                No unreconciled Yatra vouchers found. Upload a Yatra payout email first, then try again.
              </p>
            )}
          </div>

          {/* Already reconciled badge */}
          {isAlreadyReconciled && (
            <div className="self-end pb-2">
              <Badge className="bg-green-100 text-green-800 border border-green-300">
                Reconciled
              </Badge>
            </div>
          )}
        </div>

        {/* Detail loading / error / success states */}
        {selectedVoucherNo && detailQ.isLoading && (
          <div className="text-sm text-muted-foreground">Loading detail…</div>
        )}

        {selectedVoucherNo && detailErrorKind === "YATRA_VOUCHER_NOT_FOUND" && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Payout for this voucher has not been received yet. Please wait for the Yatra payout
            email to arrive, then try again.
          </div>
        )}

        {selectedVoucherNo && detailErrorKind === "GENERIC" && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {prettifyYatraError((detailQ.error as Error).message)}
          </div>
        )}

        {detail && (
          <div className="space-y-4">
            {/* Two-column view */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* LEFT: editable commercials */}
              <Card className="border-blue-200">
                <CardHeader>
                  <CardTitle className="text-base">Yatra Commercials</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Edits persist immediately. Net to pay hotel is the reconciliation target.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {YATRA_EDIT_FIELDS.map((f) => {
                    const dbVal = (detail as any)[f.key];
                    const draftVal = draft[f.key as string];
                    const shown = draftVal !== undefined ? draftVal : num(dbVal);
                    const dirty =
                      draftVal !== undefined && Number(draftVal) !== Number(dbVal ?? 0);
                    return (
                      <div
                        key={f.key as string}
                        className={`flex items-center gap-2 ${
                          f.highlight ? "rounded-md bg-blue-50 px-2 py-1 border border-blue-200" : ""
                        }`}
                      >
                        <Label className="flex-1 text-xs">
                          <span className={f.sign === "+" ? "text-green-700" : "text-red-700"}>
                            {f.sign}
                          </span>{" "}
                          <span className={f.highlight ? "font-semibold text-blue-800" : ""}>
                            {f.label}
                          </span>
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          className={`w-32 text-right tabular-nums ${
                            f.highlight ? "font-semibold text-blue-800" : ""
                          }`}
                          value={shown}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [f.key as string]: e.target.value }))
                          }
                          onBlur={() => {
                            if (!dirty) return;
                            const v = parseFloat(draftVal!);
                            if (!Number.isFinite(v) || v < 0) {
                              toast.show(
                                "error",
                                `${f.label} must be a non-negative number. Enter the correct amount.`
                              );
                              setDraft((d) => {
                                const c = { ...d };
                                delete c[f.key as string];
                                return c;
                              });
                              return;
                            }
                            updateFieldsMut.mutate(
                              { [f.key as string]: v },
                              {
                                onError: (err) => {
                                  toast.show(
                                    "error",
                                    prettifyYatraError((err as Error).message)
                                  );
                                  setDraft((d) => {
                                    const c = { ...d };
                                    delete c[f.key as string];
                                    return c;
                                  });
                                },
                                onSuccess: () =>
                                  setDraft((d) => {
                                    const c = { ...d };
                                    delete c[f.key as string];
                                    return c;
                                  }),
                              }
                            );
                          }}
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* RIGHT: read-only booking context */}
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle className="text-base">Booking Details</CardTitle>
                  <p className="text-xs text-muted-foreground">Read-only booking context from Yatra.</p>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <DetailRow label="Voucher No" value={<span className="font-mono">{detail.voucher_no}</span>} />
                  <DetailRow label="Guest name" value={detail.guest_name || "—"} />
                  <DetailRow label="Check-in" value={formatDate(detail.check_in)} />
                  <DetailRow label="Check-out" value={formatDate(detail.check_out)} />
                  <DetailRow label="Email date" value={formatDate(detail.email_date)} />
                  <DetailRow
                    label="Prepay"
                    value={
                      detail.is_pre_pay === true ? (
                        <Badge variant="outline" className="text-purple-700 border-purple-300 bg-purple-50 text-xs">
                          Prepay
                        </Badge>
                      ) : detail.is_pre_pay === false ? (
                        <span className="text-muted-foreground text-xs">Pay at hotel</span>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <DetailRow label="Room type" value={detail.room_type || "—"} />
                  <DetailRow label="Rate plan" value={detail.rate_plan_type || "—"} />
                </CardContent>
              </Card>
            </div>

            {/* Net receivable summary */}
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm flex items-center justify-between">
              <span className="text-blue-900">
                Net receivable from Yatra (reconciliation target)
              </span>
              <span className="font-semibold tabular-nums text-blue-800 text-base">
                {formatINR(netToPay)}
              </span>
            </div>

            {/* Transaction picker */}
            <Card className="border-emerald-200">
              <CardHeader>
                <CardTitle className="text-base">Select Bank Transaction</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Pick the bank transfer or UPI/card transaction that corresponds to this Yatra payout.
                  Cash and MMT payout are not allowed for Yatra reconciliation.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Payment method</Label>
                    <div className="flex gap-2 mt-1">
                      {YATRA_METHODS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setTxMethod(m);
                            userHasEditedDate.current = false;
                            setSelectedTxn(null);
                          }}
                          className={`px-3 py-1 rounded-md text-sm border transition-colors ${
                            txMethod === m
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-background border-border hover:bg-muted"
                          }`}
                        >
                          {YATRA_METHOD_LABELS[m]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={txDate}
                      onChange={(e) => {
                        userHasEditedDate.current = true;
                        setTxDate(e.target.value);
                      }}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {latestDateQ.isLoading
                        ? "Finding latest available date…"
                        : latestDateQ.data
                        ? `Latest available: ${formatDate(latestDateQ.data)}`
                        : "No transactions found for this method"}
                    </p>
                  </div>
                </div>

                {/* Transaction table */}
                {txQ.isLoading && (
                  <div className="text-sm text-muted-foreground">Loading transactions…</div>
                )}
                {txQ.isError && (
                  <div className="text-sm text-red-700">{(txQ.error as Error).message}</div>
                )}
                {!txQ.isLoading && !txQ.isError && (txQ.data || []).length === 0 && debouncedTxDate && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    No {YATRA_METHOD_LABELS[txMethod]} transactions found for {debouncedTxDate}.
                    Try a different date, or check if the relevant statement file has been uploaded.
                  </div>
                )}
                {(txQ.data || []).length > 0 && (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Source</TH>
                        <TH>Identifier</TH>
                        <TH>Time</TH>
                        <TH className="text-right">Original</TH>
                        <TH className="text-right">Remaining</TH>
                        <TH />
                      </TR>
                    </THead>
                    <TBody>
                      {(txQ.data || []).map((t) => {
                        const fully = Number(t.remaining) <= 0;
                        const isSelected =
                          selectedTxn?.txn.source_table === t.source_table &&
                          selectedTxn?.txn.source_id === t.source_id;
                        return (
                          <TR
                            key={`${t.source_table}-${t.source_id}`}
                            className={`${fully ? "opacity-50" : ""} ${
                              isSelected ? "bg-emerald-50 ring-1 ring-emerald-400" : ""
                            }`}
                          >
                            <TD className="text-xs">{t.source_table.replace(/_/g, " ")}</TD>
                            <TD className="text-xs">{t.identifier_text || "—"}</TD>
                            <TD>{t.time_text || "—"}</TD>
                            <TD className="text-right tabular-nums">{formatINR(t.original_amount)}</TD>
                            <TD className="text-right tabular-nums font-medium">
                              {formatINR(t.remaining)}
                            </TD>
                            <TD className="text-right">
                              {isSelected ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setSelectedTxn(null)}
                                  className="text-red-600"
                                >
                                  Remove
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant={fully ? "ghost" : "outline"}
                                  disabled={fully}
                                  title={
                                    fully
                                      ? "Fully reconciled against other invoices"
                                      : "Select this transaction"
                                  }
                                  onClick={() => openPicker(t)}
                                >
                                  Select
                                </Button>
                              )}
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                )}

                {/* Selected transaction summary */}
                {selectedTxn && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-emerald-900 font-medium">Selected transaction</span>
                      <span className="tabular-nums font-semibold text-emerald-800">
                        {formatINR(selectedTxn.amount)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-emerald-700">
                      {selectedTxn.txn.identifier_text || selectedTxn.txn.source_table} —{" "}
                      {formatDate(selectedTxn.txn.payment_date)}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Reconcile button */}
            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
              <div className="text-sm">
                {selectedTxn ? (
                  <>
                    Apply{" "}
                    <span className="font-semibold">{formatINR(selectedTxn.amount)}</span> to this
                    invoice via the selected transaction.
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    Select a bank transaction above to reconcile.
                  </span>
                )}
              </div>
              <Button
                onClick={() => reconcile()}
                disabled={saving || !selectedTxn || isAlreadyReconciled}
                title={
                  isAlreadyReconciled
                    ? "This voucher has already been reconciled"
                    : !selectedTxn
                    ? "Select a transaction first"
                    : ""
                }
              >
                {saving ? "Saving…" : "Reconcile"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* Partial / overpay confirmation dialog */}
      <Dialog
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.kind === "partial" ? "Save as partial?" : "Flag for admin review?"}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const k = confirmDialog!.kind;
                setConfirmDialog(null);
                reconcile(k === "partial" ? { confirm_partial: true } : { confirm_overpay: true });
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-sm">{confirmDialog?.message}</p>
      </Dialog>

      {/* Amount picker dialog */}
      <Dialog
        open={!!pickTxn}
        onClose={() => setPickTxn(null)}
        title="How much of this transaction goes to this invoice?"
        footer={
          <>
            <Button variant="outline" onClick={() => setPickTxn(null)}>
              Cancel
            </Button>
            <Button onClick={confirmPicker}>Select</Button>
          </>
        }
      >
        {pickTxn && (
          <div className="space-y-2 text-sm">
            <div>
              Original amount:{" "}
              <span className="font-medium">{formatINR(pickTxn.original_amount)}</span>
            </div>
            <div>
              Remaining:{" "}
              <span className="font-medium">{formatINR(pickTxn.remaining)}</span>
            </div>
            <div>
              Yatra net to pay hotel:{" "}
              <span className="font-medium text-blue-700">{formatINR(netToPay)}</span>
            </div>
            <Label>Amount to apply</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={pickAmount}
              onChange={(e) => setPickAmount(e.target.value)}
            />
          </div>
        )}
      </Dialog>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{value ?? "—"}</span>
    </div>
  );
}

/**
 * Strip Postgres prefixes and sentinel codes, leaving a human-readable description.
 */
function prettifyYatraError(raw: string): string {
  const SENTINELS = [
    "YATRA_VOUCHER_NOT_FOUND",
    "CONFIRM_PARTIAL_REQUIRED",
    "OVERPAY_NOT_ALLOWED",
    "NOT_YATRA_INVOICE",
    "INVALID_PAYMENT_METHOD_FOR_YATRA",
  ];
  let s = raw.replace(/^[A-Z0-9]{5}:\s*/g, "").replace(/^error(:\s*)?/i, "").trim();
  for (const code of SENTINELS) {
    s = s.replace(new RegExp(`^${code}:\\s*`), "");
  }
  return s || "Something went wrong — nothing was changed. Please try again.";
}
