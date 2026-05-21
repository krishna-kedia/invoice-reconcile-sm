"use client";

/**
 * AgodaReconcilePanel — Agoda Payout Reconcile
 *
 * Renders on hotel_invoice detail pages where `source` includes 'agoda'
 * (case-insensitive). Lets the operator:
 *   1. Pick a booking_id (auto-selects if guest name matches).
 *   2. View / edit the agoda_bookings_payout numeric fields.
 *   3. Pick a bank transaction to reconcile against.
 *   4. Reconcile in one atomic call (rpc_reconcile_agoda_invoice).
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
  AgodaBookingPayout,
  AgodaReconcileCandidatesResponse,
  TransactionRow,
} from "@/lib/types";

const num = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "0" : Number(v).toFixed(2);

const AGODA_METHODS = ["upi", "card", "bank_transfer"] as const;
type AgodaPaymentMethod = (typeof AGODA_METHODS)[number];

const AGODA_METHOD_LABELS: Record<AgodaPaymentMethod, string> = {
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank Transfer",
};

const AGODA_EDIT_FIELDS: Array<{
  key: keyof AgodaBookingPayout;
  label: string;
  sign: "+" | "-";
  highlight?: boolean;
}> = [
  { key: "reference_sell_rate", label: "Reference sell rate", sign: "+" },
  { key: "room_rate",           label: "Room rate",           sign: "+" },
  { key: "extra_bed_rate",      label: "Extra bed rate",      sign: "+" },
  { key: "commission",          label: "Commission",          sign: "-" },
  { key: "compensation",        label: "Compensation",        sign: "-" },
  { key: "other_programs",      label: "Other programs",      sign: "-" },
  { key: "tds_withholding_tax", label: "TDS withholding tax", sign: "-" },
  { key: "net_rate",            label: "Net rate to hotel",   sign: "+", highlight: true },
];

export function AgodaReconcilePanel({
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

  const [selectedBookingId, setSelectedBookingId] = React.useState<string | null>(null);
  const [bookingSearch, setBookingSearch] = React.useState("");
  const [bookingDropdownOpen, setBookingDropdownOpen] = React.useState(false);
  const bookingInputRef = React.useRef<HTMLInputElement>(null);

  const [saving, setSaving] = React.useState(false);
  const [errorBanner, setErrorBanner] = React.useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = React.useState<
    null | { kind: "partial" | "overpay"; message: string }
  >(null);

  const [draft, setDraft] = React.useState<Record<string, string>>({});

  const [txMethod, setTxMethod] = React.useState<AgodaPaymentMethod>("bank_transfer");
  const [txDate, setTxDate] = React.useState("");
  const [debouncedTxDate, setDebouncedTxDate] = React.useState("");
  const [pickTxn, setPickTxn] = React.useState<TransactionRow | null>(null);
  const [pickAmount, setPickAmount] = React.useState("");
  const [selectedTxn, setSelectedTxn] = React.useState<{
    txn: TransactionRow;
    amount: number;
  } | null>(null);

  React.useEffect(() => {
    const isComplete = /^\d{4}-\d{2}-\d{2}$/.test(txDate);
    if (!isComplete) return;
    const timer = setTimeout(() => setDebouncedTxDate(txDate), 400);
    return () => clearTimeout(timer);
  }, [txDate]);

  // 1. Candidates
  const candidatesQ = useQuery({
    queryKey: ["agoda-candidates", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "rpc_get_agoda_reconcile_candidates",
        { p_hotel_invoice_id: invoiceId }
      );
      if (error) throw new Error(error.message);
      return data as AgodaReconcileCandidatesResponse;
    },
  });

  React.useEffect(() => {
    if (!selectedBookingId && candidatesQ.data?.default_booking_id) {
      setSelectedBookingId(candidatesQ.data.default_booking_id);
    }
  }, [candidatesQ.data, selectedBookingId]);

  const matchType  = candidatesQ.data?.match_type ?? "none";
  const candidates = candidatesQ.data?.candidates ?? [];

  // 2. Detail
  const detailQ = useQuery<AgodaBookingPayout, Error>({
    queryKey: ["agoda-detail", selectedBookingId],
    enabled: !!selectedBookingId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_get_agoda_reconcile_detail", {
        p_booking_id: selectedBookingId,
      });
      if (error) throw new Error(error.message);
      return data as AgodaBookingPayout;
    },
  });

  React.useEffect(() => {
    setDraft({});
    setErrorBanner(null);
    setSelectedTxn(null);
  }, [detailQ.data?.id]);

  // Latest date for tx method
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

  // 3. Transactions
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

  // 4. Field update mutation
  const updateFieldsMut = useMutation({
    mutationFn: async (fields: Record<string, number>) => {
      const { error } = await supabase.rpc(
        "rpc_update_agoda_bookings_payout_fields",
        { p_id: detailQ.data!.id, p_fields: fields }
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agoda-detail", selectedBookingId] });
    },
  });

  // 5. Reconcile
  async function reconcile(opts: { confirm_partial?: boolean; confirm_overpay?: boolean } = {}) {
    const detail = detailQ.data;
    if (!detail || !selectedTxn) return;
    setSaving(true);
    setErrorBanner(null);
    try {
      const { data, error } = await supabase.rpc("rpc_reconcile_agoda_invoice", {
        p_hotel_invoice_id:          invoiceId,
        p_agoda_bookings_payout_id:  detail.id,
        p_source_table:              selectedTxn.txn.source_table,
        p_source_id:                 selectedTxn.txn.source_id,
        p_payment_method:            selectedTxn.txn.payment_method,
        p_amount_applied:            selectedTxn.amount,
        p_confirm_partial:           !!opts.confirm_partial,
        p_confirm_overpay:           !!opts.confirm_overpay,
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
        setErrorBanner(prettifyAgodaError(msg));
        return;
      }
      const result = data as { new_status?: string; link_id?: string; invoice_id?: string } | null;
      const newStatus = result?.new_status;
      toast.show(
        "success",
        `Agoda payout reconciled (${formatINR(selectedTxn.amount)}). Invoice status: ${newStatus ?? "updated"}.`
      );
      onReconciled();
      if (newStatus === "fully_reconciled") {
        router.push("/invoices");
        return;
      }
      setSelectedBookingId(null);
      setSelectedTxn(null);
      qc.invalidateQueries({ queryKey: ["agoda-candidates", invoiceId] });
    } catch {
      setErrorBanner(
        "Save failed — a network error occurred and nothing was changed. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  const detail = detailQ.data;

  const detailErrorKind = React.useMemo(() => {
    const msg = (detailQ.error as Error | null)?.message ?? "";
    if (!msg) return null;
    if (msg.includes("AGODA_BOOKING_NOT_FOUND")) return "AGODA_BOOKING_NOT_FOUND";
    return "GENERIC";
  }, [detailQ.error]);

  function openPicker(t: TransactionRow) {
    if (t.remaining <= 0) return;
    setPickTxn(t);
    const netToPay = Number(detail?.net_rate ?? 0);
    const def = netToPay > 0 ? Math.min(Number(t.remaining), netToPay) : Number(t.remaining);
    setPickAmount(def.toFixed(2));
  }

  function confirmPicker() {
    if (!pickTxn) return;
    const amt = parseFloat(pickAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.show("error", "Amount must be greater than zero.");
      return;
    }
    if (amt > Number(pickTxn.remaining) + 0.001) {
      toast.show(
        "error",
        `Only ${formatINR(pickTxn.remaining)} is available on this transaction.`
      );
      return;
    }
    setSelectedTxn({ txn: pickTxn, amount: amt });
    setPickTxn(null);
    setPickAmount("");
  }

  const isAlreadyReconciled = !!detail?.reconciled_at;
  const netToPay = Number(detail?.net_rate ?? 0);

  return (
    <Card id="agoda-reconcile" className="border-orange-200">
      <CardHeader>
        <CardTitle>Agoda Payout Reconcile</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          For invoices booked via Agoda, reconcile directly against the matched payout email. Select
          the booking, verify amounts, pick the bank transaction, then click Reconcile.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorBanner && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {errorBanner}
          </div>
        )}

        {/* Booking selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Booking ID</Label>
            <div className="relative">
              <Input
                ref={bookingInputRef}
                type="text"
                placeholder="Search booking ID or guest name…"
                value={
                  bookingDropdownOpen
                    ? bookingSearch
                    : selectedBookingId
                    ? (() => {
                        const c = candidates.find((c) => c.booking_id === selectedBookingId);
                        return c
                          ? `${c.booking_id}${c.guest_name ? ` — ${c.guest_name}` : ""}`
                          : selectedBookingId;
                      })()
                    : ""
                }
                onChange={(e) => {
                  setBookingSearch(e.target.value);
                  setBookingDropdownOpen(true);
                }}
                onFocus={() => {
                  setBookingSearch("");
                  setBookingDropdownOpen(true);
                }}
                onBlur={() => setTimeout(() => setBookingDropdownOpen(false), 150)}
                autoComplete="off"
              />
              {bookingDropdownOpen && (
                <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-background shadow-lg max-h-56 overflow-y-auto">
                  {(() => {
                    const q = bookingSearch.toLowerCase();
                    const filtered = candidates.filter(
                      (c) =>
                        c.booking_id.toLowerCase().includes(q) ||
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
                        key={c.booking_id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-baseline gap-2"
                        onMouseDown={() => {
                          setSelectedBookingId(c.booking_id);
                          setBookingSearch("");
                          setBookingDropdownOpen(false);
                        }}
                      >
                        <span className="font-mono">{c.booking_id}</span>
                        {c.is_default && (
                          <span className="text-xs text-green-700 font-medium">(this invoice)</span>
                        )}
                        {c.guest_name && (
                          <span className="text-xs text-muted-foreground">{c.guest_name}</span>
                        )}
                        {c.net_rate !== null && (
                          <span className="ml-auto text-xs tabular-nums text-orange-700">
                            {formatINR(c.net_rate)}
                          </span>
                        )}
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>

            {candidatesQ.isLoading && (
              <p className="mt-1 text-xs text-muted-foreground">Loading candidates…</p>
            )}
            {!candidatesQ.isLoading && selectedBookingId && matchType === "guest_name" && (
              <p className="mt-1 text-xs">
                <Badge variant="outline" className="text-orange-700 border-orange-300 bg-orange-50">
                  Guest name match
                </Badge>
              </p>
            )}
            {!candidatesQ.isLoading && matchType === "none" && candidates.length > 0 && !selectedBookingId && (
              <p className="mt-1 text-xs">
                <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
                  No match — select manually
                </Badge>
              </p>
            )}
            {!candidatesQ.isLoading && candidates.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">
                No unreconciled Agoda bookings found. Upload an Agoda payout email first, then try again.
              </p>
            )}
          </div>

          {isAlreadyReconciled && (
            <div className="self-end pb-2">
              <Badge className="bg-green-100 text-green-800 border border-green-300">
                Reconciled
              </Badge>
            </div>
          )}
        </div>

        {selectedBookingId && detailQ.isLoading && (
          <div className="text-sm text-muted-foreground">Loading detail…</div>
        )}

        {selectedBookingId && detailErrorKind === "AGODA_BOOKING_NOT_FOUND" && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Payout for this booking has not been received yet. Please wait for the Agoda payout
            email to arrive, then try again.
          </div>
        )}

        {selectedBookingId && detailErrorKind === "GENERIC" && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {prettifyAgodaError((detailQ.error as Error).message)}
          </div>
        )}

        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* LEFT: editable financials */}
              <Card className="border-orange-200">
                <CardHeader>
                  <CardTitle className="text-base">Agoda Commercials</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Edits persist immediately. Net rate to hotel is the reconciliation target.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {AGODA_EDIT_FIELDS.map((f) => {
                    const dbVal  = (detail as any)[f.key];
                    const draftVal = draft[f.key as string];
                    const shown = draftVal !== undefined ? draftVal : num(dbVal);
                    const dirty =
                      draftVal !== undefined && Number(draftVal) !== Number(dbVal ?? 0);
                    return (
                      <div
                        key={f.key as string}
                        className={`flex items-center gap-2 ${
                          f.highlight ? "rounded-md bg-orange-50 px-2 py-1 border border-orange-200" : ""
                        }`}
                      >
                        <Label className="flex-1 text-xs">
                          <span className={f.sign === "+" ? "text-green-700" : "text-red-700"}>
                            {f.sign}
                          </span>{" "}
                          <span className={f.highlight ? "font-semibold text-orange-800" : ""}>
                            {f.label}
                          </span>
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          className={`w-32 text-right tabular-nums ${
                            f.highlight ? "font-semibold text-orange-800" : ""
                          }`}
                          value={shown}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [f.key as string]: e.target.value }))
                          }
                          onBlur={() => {
                            if (!dirty) return;
                            const v = parseFloat(draftVal!);
                            if (!Number.isFinite(v)) {
                              toast.show("error", `${f.label} must be a valid number.`);
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
                                  toast.show("error", prettifyAgodaError((err as Error).message));
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
                  <p className="text-xs text-muted-foreground">Read-only booking context from Agoda.</p>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <DetailRow label="Booking ID" value={<span className="font-mono">{detail.booking_id}</span>} />
                  <DetailRow label="Guest name" value={detail.guest_name || "—"} />
                  <DetailRow label="Check-in"   value={formatDate(detail.check_in)} />
                  <DetailRow label="Check-out"  value={formatDate(detail.check_out)} />
                  <DetailRow label="Email date" value={formatDate(detail.email_date)} />
                  <DetailRow label="Status"
                    value={
                      detail.status ? (
                        <Badge variant="outline" className="text-orange-700 border-orange-300 bg-orange-50 text-xs">
                          {detail.status}
                        </Badge>
                      ) : "—"
                    }
                  />
                  <DetailRow label="Country" value={detail.country_of_residence || "—"} />
                  {detail.booked_and_payable_by && (
                    <DetailRow label="Payable by" value={<span className="text-xs">{detail.booked_and_payable_by}</span>} />
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Net receivable summary */}
            <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm flex items-center justify-between">
              <span className="text-orange-900">
                Net receivable from Agoda (reconciliation target)
              </span>
              <span className="font-semibold tabular-nums text-orange-800 text-base">
                {formatINR(netToPay)}
              </span>
            </div>

            {/* Transaction picker */}
            <Card className="border-emerald-200">
              <CardHeader>
                <CardTitle className="text-base">Select Bank Transaction</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Pick the bank transfer or UPI/card transaction that corresponds to this Agoda payout.
                  Cash and MMT payout are not allowed for Agoda reconciliation.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Payment method</Label>
                    <div className="flex gap-2 mt-1">
                      {AGODA_METHODS.map((m) => (
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
                              ? "bg-orange-600 text-white border-orange-600"
                              : "bg-background border-border hover:bg-muted"
                          }`}
                        >
                          {AGODA_METHOD_LABELS[m]}
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

                {txQ.isLoading && (
                  <div className="text-sm text-muted-foreground">Loading transactions…</div>
                )}
                {txQ.isError && (
                  <div className="text-sm text-red-700">{(txQ.error as Error).message}</div>
                )}
                {!txQ.isLoading && !txQ.isError && (txQ.data || []).length === 0 && debouncedTxDate && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    No {AGODA_METHOD_LABELS[txMethod]} transactions found for {debouncedTxDate}.
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
                    ? "This booking has already been reconciled"
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
              Agoda net rate:{" "}
              <span className="font-medium text-orange-700">{formatINR(netToPay)}</span>
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

function prettifyAgodaError(raw: string): string {
  const SENTINELS = [
    "AGODA_BOOKING_NOT_FOUND",
    "CONFIRM_PARTIAL_REQUIRED",
    "OVERPAY_NOT_ALLOWED",
    "NOT_AGODA_INVOICE",
    "INVALID_PAYMENT_METHOD_FOR_AGODA",
  ];
  let s = raw.replace(/^[A-Z0-9]{5}:\s*/g, "").replace(/^error(:\s*)?/i, "").trim();
  for (const code of SENTINELS) {
    s = s.replace(new RegExp(`^${code}:\\s*`), "");
  }
  return s || "Something went wrong — nothing was changed. Please try again.";
}
