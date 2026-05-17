// Domain types matching the Supabase schema (V1).
export type UserRole = "admin" | "operator";

export interface UserProfile {
  user_id: string;
  display_name: string;
  role: UserRole;
  created_at: string;
}

export type ReconciliationStatus =
  | "unreconciled"
  | "partial"
  | "fully_reconciled"
  | "flagged_for_review";

export interface HotelInvoice {
  id: string;
  invoice_number: string | null;
  guest_name: string | null;
  source: string | null;
  arrival_time: string | null;
  departure_time: string | null;
  booking_id: string | null;
  booking_date: string | null;
  taxable_amount: number | null;
  cgst: number | null;
  sgst: number | null;
  grand_total: number;
  reconciliation_status: ReconciliationStatus | null;
  created_at: string;
}

export interface MmtInvoice {
  id: string;
  invoice_number: string | null;
  guest_name: string | null;
  arrival_time: string | null;
  departure_time: string | null;
  booking_id: string | null;
  booking_date: string | null;
  grand_total: number | null;
  created_at: string;
}

export type SourceTable =
  | "upi_transactions"
  | "card_transactions"
  | "bank_statement"
  | "cash_payments";

export type PaymentMethod = "upi" | "card" | "bank_transfer" | "cash" | "mmt_payout";

// ---------- MMT Direct Reconcile (Phase M) ----------

export interface MmtReconcileCandidate {
  booking_id: string;
  mmt_invoice_id: string;
  guest_hint: string | null;
  check_in: string | null;
  check_out: string | null;
  created_at: string;
  is_default: boolean;
}

export interface MmtReconcileCandidatesResponse {
  hotel_invoice_booking_id: string | null;
  hotel_invoice_guest_name: string | null;
  default_booking_id: string | null;
  match_type: "booking_id" | "guest_name" | "none";
  candidates: MmtReconcileCandidate[];
}

export interface MmtInvoiceRow {
  id: string;
  booking_id: string;
  room_charges: number;
  extra_adult_child_charges: number;
  property_taxes: number;
  service_charge: number;
  property_gross_charges: number;
  go_mmt_commission: number;
  gst_on_commission: number;
  tcs: number | null;
  tds: number | null;
  reconciled_at: string | null;
  reconciled_link_id: string | null;
  primary_guest_details: string | null;
  check_in: string | null;
  check_out: string | null;
  booked_on: string | null;
}

export interface MmtBookingsPayoutRow {
  id: string;
  transaction_no: string;
  booking_id: string;
  payable: number;
  original_cost: number | null;
  client_name: string | null;
  hotel_name: string | null;
  reconciled_at: string | null;
  reconciled_link_id: string | null;
}

export interface BankStatementMatch {
  id: string;
  date: string;
  value_dt: string;
  chq_ref_no: string | null;
  narration: string;
  deposit_amt: number | null;
  used_amount: number;
  remaining: number;
}

export interface MmtReconcileDetail {
  mmt_invoice: MmtInvoiceRow;
  mmt_bookings_payout: MmtBookingsPayoutRow;
  bank_statement: BankStatementMatch;
  computed_payable: number;
  payout_payable: number;
  amount_diff: number;
  match_within_tolerance: boolean;
  tolerance_rupees: number;
}

export interface ReconciliationLink {
  id: string;
  invoice_id: string;
  source_table: SourceTable;
  source_id: string;
  payment_method: PaymentMethod;
  amount_applied: number;
  created_by: string;
  created_at: string;
}

export interface TransactionRow {
  source_table: SourceTable;
  source_id: string;
  payment_date: string;
  original_amount: number;
  used_amount: number;
  remaining: number;
  identifier_text: string | null;
  time_text: string | null;
  payment_method: PaymentMethod;
}

export interface CashPayment {
  id: string;
  payment_date: string;
  amount: number;
  created_by: string;
  created_at: string;
}

export type ApprovalRequestType =
  | "unreconcile_link"
  | "unreconcile_invoice"
  | "cash_edit"
  | "cash_delete";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequest {
  id: string;
  request_type: ApprovalRequestType;
  target_invoice_id: string | null;
  target_link_id: string | null;
  target_cash_id: string | null;
  payload: any;
  reason: string;
  status: ApprovalStatus;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export type DiscrepancyStatus = "open" | "resolved" | "reversed";

export interface Discrepancy {
  id: string;
  invoice_id: string;
  invoice_total: number;
  linked_total: number;
  diff_amount: number;
  diff_percent: number;
  status: DiscrepancyStatus;
  flagged_by: string;
  flagged_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface PaymentSourceConfig {
  id: string;
  payment_method: PaymentMethod;
  source_table: SourceTable;
  is_active: boolean;
}

export interface AuditLogRow {
  id: number;
  occurred_at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: any;
  after_state: any;
  context: any;
}

export interface NewLinkInput {
  source_table: SourceTable;
  source_id?: string;            // null/undefined for inline-cash creation
  payment_method: PaymentMethod;
  amount_applied: number;
  cash_payment_date?: string;    // only for inline cash creation
  // Display-only fields, ignored by RPC
  _display?: {
    identifier_text?: string | null;
    payment_date?: string | null;
    original_amount?: number;
    remaining?: number;
  };
}

export interface AdminHomeSummary {
  unreconciled_count: number;
  unreconciled_amount: number;
  status_breakdown: Record<string, { count: number; amount: number }>;
  aging: { bucket_0_7: number; bucket_8_30: number; bucket_30_plus: number };
  cash_vs_digital_30d: { cash_amount: number; digital_amount: number };
  pending_approvals: number;
  flagged_discrepancies: number;
  recent_audit: AuditLogRow[];
}
