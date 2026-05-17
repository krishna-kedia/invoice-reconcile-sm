"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR, formatDateTime } from "@/lib/utils";
import type { AdminHomeSummary } from "@/lib/types";

export default function AdminHome() {
  const supabase = React.useMemo(() => createClient(), []);
  const q = useQuery({
    queryKey: ["admin.home"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_admin_home_summary");
      if (error) throw error;
      return data as AdminHomeSummary;
    },
  });

  if (q.isLoading) return <div className="text-sm text-muted-foreground">Loading dashboard…</div>;
  if (q.isError) return <div className="text-sm text-red-700">Failed to load: {(q.error as Error).message}</div>;
  const s = q.data!;

  const sb = s.status_breakdown || {};
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Admin Home</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Tile title="Unreconciled invoices" value={s.unreconciled_count} href="/invoices?status=unreconciled" />
        <Tile title="Unreconciled amount" value={formatINR(s.unreconciled_amount)} />
        <Tile title="Pending approvals" value={s.pending_approvals} href="/admin/approvals" highlight={s.pending_approvals > 0} />
        <Tile title="Flagged discrepancies" value={s.flagged_discrepancies} href="/admin/discrepancies" highlight={s.flagged_discrepancies > 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader><CardTitle>Status breakdown</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1">
              <BreakRow label="Unreconciled" v={sb["unreconciled"]} />
              <BreakRow label="Partial" v={sb["partial"]} />
              <BreakRow label="Fully reconciled" v={sb["fully_reconciled"]} />
              <BreakRow label="Flagged" v={sb["flagged_for_review"]} />
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Aging (unreconciled + partial)</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1">
              <li className="flex justify-between"><span>0–7 days</span><span className="tabular-nums font-medium">{s.aging.bucket_0_7}</span></li>
              <li className="flex justify-between"><span>8–30 days</span><span className="tabular-nums font-medium">{s.aging.bucket_8_30}</span></li>
              <li className="flex justify-between"><span>30+ days</span><span className="tabular-nums font-medium">{s.aging.bucket_30_plus}</span></li>
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Cash vs digital (last 30d)</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1">
              <li className="flex justify-between"><span>Cash</span><span className="tabular-nums font-medium">{formatINR(s.cash_vs_digital_30d.cash_amount)}</span></li>
              <li className="flex justify-between"><span>Digital</span><span className="tabular-nums font-medium">{formatINR(s.cash_vs_digital_30d.digital_amount)}</span></li>
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent audit (last 20)</CardTitle>
            <Link className="text-sm text-primary hover:underline" href="/audit">View all</Link>
          </CardHeader>
          <CardContent className="p-0 max-h-72 overflow-auto">
            <ul className="text-xs divide-y">
              {(s.recent_audit || []).map((a: any) => (
                <li key={a.id} className="px-4 py-2">
                  <div className="font-mono">{a.action}</div>
                  <div className="text-muted-foreground">{formatDateTime(a.occurred_at)} · {a.entity_type}/{(a.entity_id || "").slice(0, 8)}</div>
                </li>
              ))}
              {(!s.recent_audit || s.recent_audit.length === 0) && <li className="px-4 py-3 text-muted-foreground">No audit entries yet.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Tile({ title, value, href, highlight }: { title: string; value: React.ReactNode; href?: string; highlight?: boolean }) {
  const body = (
    <Card className={highlight ? "border-amber-400" : ""}>
      <CardContent className="py-5">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {href && <div className="mt-2 text-xs text-primary">View →</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function BreakRow({ label, v }: { label: string; v: { count: number; amount: number } | undefined }) {
  return (
    <li className="flex justify-between">
      <span>{label}</span>
      <span className="tabular-nums">
        <span className="font-medium">{v?.count ?? 0}</span>{" "}
        <span className="text-muted-foreground">({formatINR(v?.amount ?? 0)})</span>
      </span>
    </li>
  );
}
