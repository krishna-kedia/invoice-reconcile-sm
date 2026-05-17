"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { PaymentMethod, SourceTable, PaymentSourceConfig } from "@/lib/types";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cash", label: "Cash" },
];
const SOURCES: SourceTable[] = ["upi_transactions", "card_transactions", "bank_statement", "cash_payments"];

export default function PaymentSourcesPage() {
  const supabase = React.useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const toast = useToast();

  const q = useQuery({
    queryKey: ["psc"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payment_source_config").select("*");
      if (error) throw error;
      return (data || []) as PaymentSourceConfig[];
    },
  });

  // Local checkbox state mirrors the active config until saved.
  const [draft, setDraft] = React.useState<Record<PaymentMethod, Set<SourceTable>> | null>(null);
  React.useEffect(() => {
    if (!q.data) return;
    const next: Record<string, Set<SourceTable>> = { upi: new Set(), card: new Set(), bank_transfer: new Set(), cash: new Set() };
    for (const row of q.data) {
      if (row.is_active) next[row.payment_method].add(row.source_table);
    }
    setDraft(next as any);
  }, [q.data]);

  const [savingMethod, setSavingMethod] = React.useState<PaymentMethod | null>(null);

  function toggle(method: PaymentMethod, src: SourceTable) {
    setDraft((d) => {
      if (!d) return d;
      const copy = { ...d, [method]: new Set(d[method]) };
      if (copy[method].has(src)) copy[method].delete(src);
      else copy[method].add(src);
      return copy;
    });
  }

  async function save(method: PaymentMethod) {
    if (!draft) return;
    setSavingMethod(method);
    const sources = Array.from(draft[method]);
    const { error } = await supabase.rpc("rpc_upsert_payment_source_config", {
      p_payment_method: method, p_source_tables: sources,
    });
    setSavingMethod(null);
    if (error) { toast.show("error", error.message); return; }
    toast.show("success", `${method} sources updated.`);
    qc.invalidateQueries({ queryKey: ["psc"] });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Payment source configuration</h1>
      <Card>
        <CardHeader><CardTitle>Map each method to its source tables</CardTitle></CardHeader>
        <CardContent>
          {q.isLoading || !draft ? <div className="text-sm text-muted-foreground">Loading…</div> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2">Method</th>
                  {SOURCES.map((s) => <th key={s} className="px-2 py-2">{s}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {METHODS.map((m) => (
                  <tr key={m.value} className="border-b">
                    <td className="py-3 pr-3 font-medium">{m.label}</td>
                    {SOURCES.map((s) => (
                      <td key={s} className="px-2 py-3">
                        <input
                          type="checkbox"
                          checked={draft[m.value].has(s)}
                          onChange={() => toggle(m.value, s)}
                        />
                      </td>
                    ))}
                    <td className="py-3 text-right">
                      <Button size="sm" onClick={() => save(m.value)} disabled={savingMethod === m.value}>
                        {savingMethod === m.value ? "Saving…" : "Save"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
