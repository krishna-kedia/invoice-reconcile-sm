"use client";

/**
 * MmtReconcilePanel — Phase M (FR-066)
 *
 * Renders alongside AddPaymentPanel on hotel_invoice detail pages where
 * `source IN ('MakeMyTrip','Goibibo')`. Lets the operator:
 *   1. Pick a booking_id (defaults to the invoice's own booking_id if it
 *      matches an unreconciled mmt_invoice row).
 *   2. View / edit the mmt_invoice formula line items AND the
 *      mmt_bookings_payout.payable side-by-side.
 *   3. See a live "amounts match within ₹1" indicator.
 *   4. See the matched bank_statement row + remaining.
 *   5. Reconcile in one atomic call (rpc_reconcile_mmt_invoice).
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
import { useToast } from "@/components/ui/toast";
import { formatINR, formatDate } from "@/lib/utils";
import type {
  HotelInvoice,
  MmtReconcileCandidatesResponse,
  MmtReconcileDetail,
  MmtInvoiceRow,
} from "@/lib/types";

// Number → string with 2-decimal precision, safe for null/undef
const num = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "0" : Number(v).toFixed(2);

const MMT_INVOICE_EDIT_FIELDS: Array<{ key: keyof MmtInvoiceRow; label: string; sign: "+" | "-" }> = [
  { key: "room_charges", label: "Room charges", sign: "+" },
  { key: "extra_adult_child_charges", label: "Extra adult/child charges", sign: "+" },
  { key: "property_taxes", label: "Property taxes", sign: "+" },
  { key: "go_mmt_commission", label: "GoMMT commission", sign: "-" },
  { key: "gst_on_commission", label: "GST on commission", sign: "-" },
  { key: "tcs", label: "TCS", sign: "-" },
  { key: "tds", label: "TDS", sign: "-" },
];

export function MmtReconcilePanel({
  invoice,
  onReconciled,
}: {
  invoice: HotelInvoice;
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

  // Local override buffer so the operator can type without firing a save per keystroke.
  const [miDraft, setMiDraft] = React.useState<Record<string, string>>({});
  const [poDraft, setPoDraft] = React.useState<string>("");

  // -----------------------------------------------------------------
  // 1. Load candidate booking_ids
  // -----------------------------------------------------------------
  const candidatesQ = useQuery({
    queryKey: ["mmt-candidates", invoice.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_get_mmt_reconcile_candidates", {
        p_hotel_invoice_id: invoice.id,
      });
      if (error) throw new Error(error.message);
      return data as MmtReconcileCandidatesResponse;
    },
  });

  // Auto-select the default booking_id when the candidates load
  React.useEffect(() => {
    if (!selectedBookingId && candidatesQ.data?.default_booking_id) {
      setSelectedBookingId(candidatesQ.data.default_booking_id);
    }
  }, [candidatesQ.data, selectedBookingId]);

  const matchType = candidatesQ.data?.match_type ?? "none";

  // -----------------------------------------------------------------
  // 2. Load detail when a booking_id is selected
  // -----------------------------------------------------------------
  const detailQ = useQuery<MmtReconcileDetail, Error>({
    queryKey: ["mmt-detail", selectedBookingId],
    enabled: !!selectedBookingId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_get_mmt_reconcile_detail", {
        p_booking_id: selectedBookingId,
      });
      if (error) throw new Error(error.message);
      return data as MmtReconcileDetail;
    },
  });

  // Reset drafts when the detail row changes
  React.useEffect(() => {
    setMiDraft({});
    setPoDraft("");
    setErrorBanner(null);
  }, [detailQ.data?.mmt_invoice?.id, detailQ.data?.mmt_bookings_payout?.id]);

  // -----------------------------------------------------------------
  // 3. Field-update mutations (mmt_invoice + mmt_bookings_payout)
  // -----------------------------------------------------------------
  const updateMiMut = useMutation({
    mutationFn: async (fields: Record<string, number>) => {
      const { error } = await supabase.rpc("rpc_update_mmt_invoice_fields", {
        p_id: detailQ.data!.mmt_invoice.id,
        p_fields: fields,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mmt-detail", selectedBookingId] });
    },
  });

  const updatePoMut = useMutation({
    mutationFn: async (payable: number) => {
      const { error } = await supabase.rpc("rpc_update_mmt_bookings_payout_fields", {
        p_id: detailQ.data!.mmt_bookings_payout.id,
        p_fields: { payable },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mmt-detail", selectedBookingId] });
    },
  });

  // -----------------------------------------------------------------
  // 4. Reconcile action
  // -----------------------------------------------------------------
  async function reconcile(opts: { confirm_partial?: boolean; confirm_overpay?: boolean } = {}) {
    const detail = detailQ.data;
    if (!detail) return;
    setSaving(true);
    setErrorBanner(null);
    try {
      const { data, error } = await supabase.rpc("rpc_reconcile_mmt_invoice", {
        p_hotel_invoice_id: invoice.id,
        p_mmt_invoice_id: detail.mmt_invoice.id,
        p_mmt_bookings_payout_id: detail.mmt_bookings_payout.id,
        p_bank_statement_id: detail.bank_statement.id,
        p_confirm_partial: !!opts.confirm_partial,
        p_confirm_overpay: !!opts.confirm_overpay,
      });
      if (error) {
        const msg = error.message || String(error);
        if (msg.includes("PARTIAL_CONFIRMATION_REQUIRED")) {
          setConfirmDialog({
            kind: "partial",
            message: msg.replace(/^.*PARTIAL_CONFIRMATION_REQUIRED:\s*/, ""),
          });
          return;
        }
        if (msg.includes("OVERPAY_CONFIRMATION_REQUIRED")) {
          setConfirmDialog({
            kind: "overpay",
            message: msg.replace(/^.*OVERPAY_CONFIRMATION_REQUIRED:\s*/, ""),
          });
          return;
        }
        setErrorBanner(prettifyMmtError(msg));
        return;
      }
      const newStatus = (data as { reconciliation_status?: string })?.reconciliation_status;
      toast.show(
        "success",
        `MMT payout reconciled (₹${formatINR(detail.mmt_bookings_payout.payable)}). Invoice status: ${newStatus ?? "updated"}.`
      );
      onReconciled();
      if (newStatus === "fully_reconciled") {
        router.push("/invoices");
        return;
      }
      // Partial — stay on page, reset booking selection
      setSelectedBookingId(null);
      qc.invalidateQueries({ queryKey: ["mmt-candidates", invoice.id] });
    } catch {
      setErrorBanner("Save failed — a network error occurred and nothing was changed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------
  const detail = detailQ.data;
  const candidates = candidatesQ.data?.candidates ?? [];

  // Detect the kind of error so we can show a friendlier inline state
  const detailErrorKind = React.useMemo(() => {
    const msg = (detailQ.error as Error | null)?.message ?? "";
    if (!msg) return null;
    if (msg.includes("MMT_INVOICE_NOT_FOUND")) return "MMT_INVOICE_NOT_FOUND";
    if (msg.includes("MMT_PAYOUT_NOT_FOUND")) return "MMT_PAYOUT_NOT_FOUND";
    if (msg.includes("MMT_PAYOUT_AMBIGUOUS")) return "MMT_PAYOUT_AMBIGUOUS";
    if (msg.includes("MMT_BANK_NOT_FOUND")) return "MMT_BANK_NOT_FOUND";
    if (msg.includes("MMT_BANK_AMBIGUOUS")) return "MMT_BANK_AMBIGUOUS";
    return "GENERIC";
  }, [detailQ.error]);

  return (
    <Card id="mmt-reconcile" className="border-amber-200">
      <CardHeader>
        <CardTitle>MMT Payout Reconcile</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          For invoices booked via MakeMyTrip or Goibibo, reconcile directly against the matched payout
          and bank credit. Field values are editable until both sides match within ₹1.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorBanner && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {errorBanner}
          </div>
        )}

        {/* Booking ID searchable picker */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Booking ID</Label>
            <div className="relative">
              <Input
                ref={bookingInputRef}
                type="text"
                placeholder="Search booking ID…"
                value={
                  bookingDropdownOpen
                    ? bookingSearch
                    : selectedBookingId
                    ? (() => {
                        const c = candidates.find((c) => c.booking_id === selectedBookingId);
                        return c
                          ? `${c.booking_id}${c.is_default ? " (matches this invoice)" : ""}${c.guest_hint ? ` — ${c.guest_hint}` : ""}`
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
                onBlur={() => {
                  // delay so click on option registers first
                  setTimeout(() => setBookingDropdownOpen(false), 150);
                }}
                autoComplete="off"
              />
              {bookingDropdownOpen && (
                <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-background shadow-lg max-h-56 overflow-y-auto">
                  {(() => {
                    const q = bookingSearch.toLowerCase();
                    const filtered = candidates.filter(
                      (c) =>
                        c.booking_id.toLowerCase().includes(q) ||
                        (c.guest_hint ?? "").toLowerCase().includes(q)
                    );
                    if (filtered.length === 0)
                      return (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          {candidatesQ.isLoading ? "Loading…" : "No matches found."}
                        </div>
                      );
                    return filtered.map((c) => (
                      <button
                        key={c.mmt_invoice_id}
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
                        {c.guest_hint && (
                          <span className="text-xs text-muted-foreground">{c.guest_hint}</span>
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
            {!candidatesQ.isLoading && selectedBookingId && matchType === "booking_id" && (
              <p className="mt-1 text-xs text-green-700 font-medium">
                Auto-matched by booking ID
              </p>
            )}
            {!candidatesQ.isLoading && selectedBookingId && matchType === "guest_name" && (
              <p className="mt-1 text-xs text-blue-700 font-medium">
                Auto-matched by guest name — verify this is the correct booking
              </p>
            )}
            {!candidatesQ.isLoading && matchType === "none" && candidates.length > 0 && !selectedBookingId && (
              <p className="mt-1 text-xs text-amber-700">
                No automatic match found — search by booking ID or guest name above
              </p>
            )}
            {!candidatesQ.isLoading && candidates.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">
                No unreconciled MMT invoices found. Upload an MMT invoice PDF first, then try again.
              </p>
            )}
          </div>
          <div className="text-xs text-muted-foreground self-end pb-2">
            This invoice&apos;s booking ID: <span className="font-mono">{invoice.booking_id || "—"}</span>
          </div>
        </div>

        {/* Detail loading / error / success states */}
        {selectedBookingId && detailQ.isLoading && (
          <div className="text-sm text-muted-foreground">Loading detail…</div>
        )}

        {selectedBookingId && detailErrorKind && (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              detailErrorKind === "MMT_PAYOUT_AMBIGUOUS" || detailErrorKind === "MMT_BANK_AMBIGUOUS"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            {prettifyMmtError((detailQ.error as Error).message)}
          </div>
        )}

        {detail && (
          <div className="space-y-4">
            {/* Two-column edit panels */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* LEFT: mmt_invoice */}
              <Card className="border-blue-200">
                <CardHeader>
                  <CardTitle className="text-base">MMT Invoice (line items)</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Edits persist immediately to the MMT invoice record.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {MMT_INVOICE_EDIT_FIELDS.map((f) => {
                    const dbVal = (detail.mmt_invoice as any)[f.key];
                    const draftVal = miDraft[f.key as string];
                    const shown = draftVal !== undefined ? draftVal : num(dbVal);
                    const dirty = draftVal !== undefined && Number(draftVal) !== Number(dbVal ?? 0);
                    return (
                      <div key={f.key as string} className="flex items-center gap-2">
                        <Label className="flex-1 text-xs">
                          <span className={f.sign === "+" ? "text-green-700" : "text-red-700"}>
                            {f.sign}
                          </span>{" "}
                          {f.label}
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          className="w-32 text-right tabular-nums"
                          value={shown}
                          onChange={(e) =>
                            setMiDraft((d) => ({ ...d, [f.key as string]: e.target.value }))
                          }
                          onBlur={() => {
                            if (!dirty) return;
                            const v = parseFloat(draftVal);
                            if (!Number.isFinite(v) || v < 0) {
                              toast.show(
                                "error",
                                `${f.label} must be a non-negative number. Enter the correct amount.`
                              );
                              setMiDraft((d) => {
                                const c = { ...d };
                                delete c[f.key as string];
                                return c;
                              });
                              return;
                            }
                            updateMiMut.mutate(
                              { [f.key as string]: v },
                              {
                                onError: (err) => {
                                  toast.show("error", prettifyMmtError((err as Error).message));
                                  setMiDraft((d) => {
                                    const c = { ...d };
                                    delete c[f.key as string];
                                    return c;
                                  });
                                },
                                onSuccess: () =>
                                  setMiDraft((d) => {
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
                  <div className="border-t pt-2 mt-2 flex items-center justify-between text-sm">
                    <span className="font-medium">Computed payable</span>
                    <span className="font-mono tabular-nums font-semibold">
                      {formatINR(detail.computed_payable)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* RIGHT: mmt_bookings_payout */}
              <Card className="border-purple-200">
                <CardHeader>
                  <CardTitle className="text-base">MMT Payout (bank-leg)</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Edit if MMT sent a corrected payable. Persists immediately.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <DetailRow label="Transaction No" value={<span className="font-mono">{detail.mmt_bookings_payout.transaction_no}</span>} />
                  <DetailRow label="Booking ID" value={<span className="font-mono">{detail.mmt_bookings_payout.booking_id}</span>} />
                  <DetailRow label="Client name" value={detail.mmt_bookings_payout.client_name || "—"} />
                  <DetailRow label="Original cost" value={formatINR(detail.mmt_bookings_payout.original_cost ?? 0)} />
                  <div className="flex items-center gap-2 pt-2 border-t mt-2">
                    <Label className="flex-1 text-xs">Payable</Label>
                    <Input
                      type="number"
                      step="0.01"
                      className="w-32 text-right tabular-nums"
                      value={poDraft !== "" ? poDraft : num(detail.payout_payable)}
                      onChange={(e) => setPoDraft(e.target.value)}
                      onBlur={() => {
                        if (poDraft === "") return;
                        const v = parseFloat(poDraft);
                        if (!Number.isFinite(v) || v < 0) {
                          toast.show("error", "Payable must be a non-negative number.");
                          setPoDraft("");
                          return;
                        }
                        if (Number(v.toFixed(2)) === Number(Number(detail.payout_payable).toFixed(2))) {
                          setPoDraft("");
                          return;
                        }
                        updatePoMut.mutate(v, {
                          onError: (err) => {
                            toast.show("error", prettifyMmtError((err as Error).message));
                            setPoDraft("");
                          },
                          onSuccess: () => setPoDraft(""),
                        });
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Match indicator */}
            <div
              className={`rounded-md border px-3 py-2 text-sm flex items-center justify-between ${
                detail.match_within_tolerance
                  ? "border-green-200 bg-green-50 text-green-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <span>
                {detail.match_within_tolerance
                  ? `✓ Amounts match within ₹1 (${formatINR(detail.computed_payable)})`
                  : `✗ Amounts differ by ${formatINR(Math.abs(detail.amount_diff))}. Edit either side to bring them in sync.`}
              </span>
              <span className="text-xs">tolerance ₹{detail.tolerance_rupees}</span>
            </div>

            {/* Bank statement callout */}
            <Card className="border-emerald-200">
              <CardHeader>
                <CardTitle className="text-base">Bank Statement (knockoff target)</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <DetailRow label="Bank date" value={formatDate(detail.bank_statement.date)} />
                <DetailRow label="Cheque/Ref" value={<span className="font-mono">{detail.bank_statement.chq_ref_no || "—"}</span>} />
                <DetailRow label="Narration" value={<span className="text-xs">{detail.bank_statement.narration}</span>} />
                <DetailRow label="Deposit amount" value={formatINR(detail.bank_statement.deposit_amt ?? 0)} />
                <DetailRow label="Already knocked off" value={formatINR(detail.bank_statement.used_amount)} />
                <DetailRow
                  label="Remaining"
                  value={
                    <span
                      className={
                        detail.bank_statement.remaining + 1 >= Number(detail.payout_payable)
                          ? "font-semibold text-emerald-700"
                          : "font-semibold text-red-700"
                      }
                    >
                      {formatINR(detail.bank_statement.remaining)}
                    </span>
                  }
                />
                <DetailRow
                  label="After this reconcile"
                  value={formatINR(detail.bank_statement.remaining - Number(detail.payout_payable))}
                />
              </CardContent>
            </Card>

            {/* Reconcile button */}
            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
              <div className="text-sm">
                Apply <span className="font-semibold">{formatINR(detail.payout_payable)}</span> to this invoice
                via the matched bank credit.
              </div>
              <Button
                onClick={() => reconcile()}
                disabled={
                  saving ||
                  !detail.match_within_tolerance ||
                  detail.bank_statement.remaining + 1 < Number(detail.payout_payable)
                }
                title={
                  !detail.match_within_tolerance
                    ? "Bring the two sides into match before reconciling"
                    : detail.bank_statement.remaining + 1 < Number(detail.payout_payable)
                    ? "Bank row does not have enough remaining to cover this payout"
                    : ""
                }
              >
                {saving ? "Saving…" : "Reconcile"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* Partial / overpay confirmation reused from main panel pattern */}
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
 * Strip Postgres prefixes and our sentinel codes, leaving a human-readable
 * description. The detail RPC's error messages are already operator-friendly
 * after the sentinel prefix.
 */
function prettifyMmtError(raw: string): string {
  const SENTINELS = [
    "MMT_INVOICE_NOT_FOUND",
    "MMT_PAYOUT_NOT_FOUND",
    "MMT_PAYOUT_AMBIGUOUS",
    "MMT_BANK_NOT_FOUND",
    "MMT_BANK_AMBIGUOUS",
    "OVERPAY_CONFIRMATION_REQUIRED",
    "PARTIAL_CONFIRMATION_REQUIRED",
  ];
  let s = raw.replace(/^[A-Z0-9]{5}:\s*/g, "").replace(/^error(:\s*)?/i, "").trim();
  for (const code of SENTINELS) {
    s = s.replace(new RegExp(`^${code}:\\s*`), "");
  }
  return s || "Something went wrong — nothing was changed. Please try again.";
}
