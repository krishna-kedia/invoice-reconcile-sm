"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";

export default function AuditPage() {
  const supabase = React.useMemo(() => createClient(), []);
  const [action, setAction] = React.useState("");
  const [entity, setEntity] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [open, setOpen] = React.useState<number | null>(null);

  const q = useQuery({
    queryKey: ["audit.list", action, entity, from, to],
    queryFn: async () => {
      let query = supabase.from("audit_log").select("*").order("occurred_at", { ascending: false }).limit(500);
      if (action) query = query.ilike("action", `${action}%`);
      if (entity) query = query.eq("entity_type", entity);
      if (from) query = query.gte("occurred_at", from);
      if (to) query = query.lte("occurred_at", to);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit Log</h1>
      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><Label>Action prefix</Label><Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="reconcile." /></div>
          <div><Label>Entity type</Label>
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All</option>
              <option value="invoice">invoice</option>
              <option value="reconciliation_link">reconciliation_link</option>
              <option value="cash_payment">cash_payment</option>
              <option value="approval_request">approval_request</option>
              <option value="discrepancy">discrepancy</option>
              <option value="payment_source_config">payment_source_config</option>
            </Select>
          </div>
          <div><Label>From</Label><Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {q.isLoading ? <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            : (q.data || []).length === 0 ? <div className="p-4 text-sm text-muted-foreground">No audit entries.</div> : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Actor</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>ID</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {(q.data || []).map((r: any) => (
                  <React.Fragment key={r.id}>
                    <TR>
                      <TD>{formatDateTime(r.occurred_at)}</TD>
                      <TD className="text-xs">{r.actor_user_id?.slice(0,8) || "—"}</TD>
                      <TD className="font-mono text-xs">{r.action}</TD>
                      <TD className="text-xs">{r.entity_type}</TD>
                      <TD className="font-mono text-xs">{(r.entity_id || "").slice(0,8)}</TD>
                      <TD className="text-right">
                        <button className="text-xs text-primary hover:underline"
                                onClick={() => setOpen(open === r.id ? null : r.id)}>
                          {open === r.id ? "Hide" : "Diff"}
                        </button>
                      </TD>
                    </TR>
                    {open === r.id && (
                      <TR>
                        <TD colSpan={6}>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2 bg-muted/30 rounded">
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Before</div>
                              <pre className="rounded bg-card border p-2 text-xs overflow-auto max-h-64">{JSON.stringify(r.before_state, null, 2)}</pre>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">After</div>
                              <pre className="rounded bg-card border p-2 text-xs overflow-auto max-h-64">{JSON.stringify(r.after_state, null, 2)}</pre>
                            </div>
                          </div>
                        </TD>
                      </TR>
                    )}
                  </React.Fragment>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
