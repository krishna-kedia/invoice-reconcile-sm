import { ReconciliationSummaryClient } from "./reconciliation-summary-client";

export default function ReconciliationPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  return <ReconciliationSummaryClient initialFrom={searchParams.from} initialTo={searchParams.to} />;
}
