import { ReconciliationDetailClient } from "./reconciliation-detail-client";

export default function ReconciliationDetailPage({
  params,
}: {
  params: { month: string };
}) {
  const monthStart = params.month + "-01";
  return <ReconciliationDetailClient monthStart={monthStart} month={params.month} />;
}
