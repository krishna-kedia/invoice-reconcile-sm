"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { formatINR, formatDateTime } from "@/lib/utils";
import type { Discrepancy } from "@/lib/types";

export default function DiscrepanciesPage() {
  const supabase = React.useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const toast = useToast();
  const [active, setActive] = React.useState<Discrepancy | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const q = useQuery({
    queryKey: ["discrepancies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discrepancies").select("*").order("flagged_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data || []) as Discrepancy[];
    },
  });

  function prettifyError(msg: string): string {
    return msg
      .replace(/^[A-Z0-9]{5}:\s*/g, "")
      .replace(/^error(:\s*)?/i, "")
      .replace(/\s+/g, " ")
      .trim() || "An unexpected error occurred. Please try again.";
  }

  async function resolve() {
    if (!active) return;
    if (!note.trim()) {
      toast.show("error", "A resolution note is required. Explain why this overpayment discrepancy is being acknowledged.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("rpc_resolve_discrepancy", { p_discrepancy_id: active.id, p_note: note });
    setBusy(false);
    if (error) {
      toast.show("error", prettifyError(error.message));
      return;
    }
    toast.show("success", "Discrepancy marked as resolved.");
    setActive(null); setNote("");
    qc.invalidateQueries({ queryKey: ["discrepancies"] });
  }

  async function reverse() {
    if (!active) return;
    if (!note.trim()) {
      toast.show("error", "A note is required before reversing. Explain why the reconciliation is being reversed.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("rpc_admin_reverse_reconciliation", {
      p_invoice_id: active.invoice_id, p_note: note,
    });
    setBusy(false);
    if (error) {
      toast.show("error", prettifyError(error.message));
      return;
    }
    toast.show("success", "Reconciliation reversed. All payment links for this invoice have been removed.");
    setActive(null); setNote("");
    qc.invalidateQueries({ queryKey: ["discrepancies"] });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Discrepancies</h1>
      <Card>
        <CardContent className="p-0">
          {q.isLoading ? <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            : (q.data || []).length === 0 ? <div className="p-4 text-sm text-muted-foreground">No discrepancies.</div> : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Linked</TH>
                  <TH className="text-right">Diff</TH>
                  <TH>Status</TH>
                  <TH>Flagged at</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {(q.data || []).map((d) => (
                  <TR key={d.id}>
                    <TD className="font-mono text-xs"><Link className="text-primary hover:underline" href={`/invoices/${d.invoice_id}`}>{d.invoice_id.slice(0,8)}</Link></TD>
                    <TD className="text-right tabular-nums">{formatINR(d.invoice_total)}</TD>
                    <TD className="text-right tabular-nums">{formatINR(d.linked_total)}</TD>
                    <TD className="text-right tabular-nums">{formatINR(d.diff_amount)} ({d.diff_percent}%)</TD>
                    <TD className="text-xs">{d.status}</TD>
                    <TD>{formatDateTime(d.flagged_at)}</TD>
                    <TD className="text-right">
                      <Button size="sm" variant="outline" onClick={() => { setActive(d); setNote(""); }}>Open</Button>
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
        title={active ? `Discrepancy on invoice ${active.invoice_id.slice(0,8)}` : ""}
        footer={
          active?.status === "open" ? (
            <>
              <Button variant="outline" onClick={() => setActive(null)}>Cancel</Button>
              <Button variant="destructive" onClick={reverse} disabled={busy}>Reverse reconciliation</Button>
              <Button onClick={resolve} disabled={busy}>{busy ? "Working…" : "Mark resolved"}</Button>
            </>
          ) : <Button variant="outline" onClick={() => setActive(null)}>Close</Button>
        }
      >
        {active && (
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Invoice total" v={formatINR(active.invoice_total)} />
              <Field label="Linked total" v={formatINR(active.linked_total)} />
              <Field label="Difference" v={`${formatINR(active.diff_amount)} (${active.diff_percent}%)`} />
              <Field label="Status" v={active.status} />
              <Field label="Flagged" v={formatDateTime(active.flagged_at)} />
            </div>
            {active.status === "open" && (
              <div className="pt-2">
                <Label>Note (required)</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain the resolution or reversal." />
              </div>
            )}
            {active.resolution_note && <div><span className="text-muted-foreground">Resolution note:</span> {active.resolution_note}</div>}
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Field({ label, v }: { label: string; v: React.ReactNode }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div>{v}</div></div>;
}
