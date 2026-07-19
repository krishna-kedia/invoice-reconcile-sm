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

// ---------- Bank Statement View (Phase BS) ----------

export type BankStatementDrillType = "upi_settlement" | "card_settlement" | "mmt_payout" | "yatra_payout" | null;

export interface BankStatementRow {
  bank_id: string;
  date: string;
  narration: string;
  chq_ref_no: string | null;
  deposit_amt: number;
  closing_balance: number;
  link_id: string | null;
  amount_applied: number | null;
  total_amount_applied: number | null;
  invoice_id: string | null;
  invoice_number: string | null;
  mmt_booking_id: string | null;
  payment_method: PaymentMethod | null;
  drill_type: BankStatementDrillType;
  drill_count: { upi: number; card: number; mmt: number; yatra: number };
  split_index: number;
  split_total: number;
}

export interface BankStatementViewResponse {
  rows: BankStatementRow[];
  total_count: number;
  export_capped: boolean;
}

export interface BankStatementDrillReconciledInvoice {
  hotel_invoice_id: string;
  invoice_number: string;
  amount_applied: number;
}

export interface BankStatementDrillUpi {
  id: string;
  transaction_date: string;
  settlement_date: string;
  vpa: string | null;
  upi_transaction_id: string | null;
  amount: number;
  card_settlement_id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  reconciled_invoices: BankStatementDrillReconciledInvoice[];
  applied_total: number | null;
  base_amount: number;
}

export interface BankStatementDrillCard {
  id: string;
  transaction_date: string;
  settlement_date: string;
  gross_amount: number;
  mdr_percent: number;
  net_after_mdr: number;
  card_settlement_id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  reconciled_invoices: BankStatementDrillReconciledInvoice[];
  applied_total: number | null;
  base_amount: number;
}

export interface BankStatementDrillMmt {
  id: string;
  transaction_no: string;
  booking_id: string;
  booking_pnr: string | null;
  client_name: string | null;
  hotel_name: string | null;
  check_in: string | null;
  check_out: string | null;
  payable: number;
  hotel_invoice_id: string | null;
  hotel_invoice_number: string | null;
  is_reconciled: boolean;
  reconciled_invoices: BankStatementDrillReconciledInvoice[];
  applied_total: number | null;
  base_amount: number;
}

export interface BankStatementDrillYatra {
  id: string;
  voucher_no: string;
  guest_name: string | null;
  hotel_name: string | null;
  check_in: string | null;
  check_out: string | null;
  yatra_to_pay_hotel: number;
  hotel_invoice_id: string | null;
  hotel_invoice_number: string | null;
  is_reconciled: boolean;
  reconciled_invoices: BankStatementDrillReconciledInvoice[];
  applied_total: number | null;
  base_amount: number;
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

// ---------- Yatra Direct Reconcile ----------

export interface YatraBookingPayout {
  id: string;
  file_id: string | null;
  voucher_no: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  email_date: string | null;
  is_pre_pay: boolean | null;
  booking_date: string | null;
  check_in: string | null;
  check_out: string | null;
  number_of_rooms: string | null;
  adults: string | null;
  children: string | null;
  room_name: string | null;
  room_type: string | null;
  rate_plan_type: string | null;
  total_room_charges: number | null;
  other_charges: number | null;
  hotel_gross_charges: number | null;
  yatra_commission: number | null;
  yatra_commission_with_gst: number | null;
  gst: number | null;
  tcs: number | null;
  tds: number | null;
  yatra_to_pay_hotel: number | null;
  reconciled_at: string | null;
  reconciled_link_id: string | null;
  created_at: string;
}

// One row per month in v_yatra_monthly_deductions. Aggregates over
// reconciled Yatra bookings, bucketed by email_date month.
export interface YatraMonthlyDeduction {
  month_start: string; // ISO date, e.g. "2026-04-01"
  year: number;
  month: number;
  bookings_count: number;
  total_tariff_sum: number;
  yatra_commission_amt_sum: number;
  yatra_commission_with_gst_sum: number;
  tds_amt_sum: number;
  gst_on_commission_sum: number;
  tcs_amt_sum: number;
  yatra_to_pay_hotel_sum: number;
  other_charges_sum: number;
  hotel_gross_charges_sum: number;
}

export interface YatraReconcileCandidate {
  voucher_no: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  yatra_to_pay_hotel: number | null;
  is_default: boolean;
  created_at: string;
}

export interface YatraReconcileCandidatesResponse {
  hotel_invoice_guest_name: string | null;
  default_voucher_no: string | null;
  match_type: "guest_name" | "none";
  candidates: YatraReconcileCandidate[];
}

// ---------- Issue Reports (Phase RI) ----------

export type IssueReportStatus =
  | "open"
  | "resolved_by_admin"
  | "resolved_by_reconciliation"
  | "withdrawn_by_operator";

export interface IssueReport {
  id: string;
  invoice_id: string;
  category: string;
  notes: string | null;
  status: IssueReportStatus;
  reported_by: string;
  reported_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  source_snapshot: string | null;
}

export interface IssueCategory {
  id: string;
  code: string;
  label: string;
  applies_to: string[];
  is_active: boolean;
  sort_order: number;
}

// Source bucket classification (mirrors fn_classify_invoice_source on the backend)
export function classifyInvoiceSource(source: string | null | undefined): string {
  if (!source) return "walk_in";
  const s = source.toLowerCase();
  if (s.includes("mmt") || s.includes("makemytrip") || s.includes("goibibo")) return "mmt";
  if (s.includes("yatra")) return "yatra";
  if (s.includes("agoda")) return "agoda";
  return "walk_in";
}

// ---------- Agoda Direct Reconcile ----------

export interface AgodaBookingPayout {
  id: string;
  file_id: string | null;
  booking_id: string;
  email_date: string | null;
  status: string | null;
  iata: string | null;
  guest_name: string | null;
  country_of_residence: string | null;
  check_in: string | null;
  check_out: string | null;
  other_guests: string | null;
  room_rate: number | null;
  reference_sell_rate: number | null;
  extra_bed_rate: number | null;
  commission: number | null;
  compensation: number | null;
  other_programs: number | null;
  tds_withholding_tax: number | null;
  net_rate: number | null;
  booked_and_payable_by: string | null;
  reconciled_at: string | null;
  reconciled_link_id: string | null;
  created_at: string;
}

export interface AgodaReconcileCandidate {
  booking_id: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  net_rate: number | null;
  is_default: boolean;
  created_at: string;
}

export interface AgodaReconcileCandidatesResponse {
  hotel_invoice_guest_name: string | null;
  default_booking_id: string | null;
  match_type: "guest_name" | "none";
  candidates: AgodaReconcileCandidate[];
}

// ---------- Manual Payment Entries (MPE-4) ----------

export type ManualPaymentType = 'upi' | 'another_machine' | 'commission' | 'tds'
export type ManualPaymentStatus = 'pending' | 'approved' | 'rejected'

export interface ManualPaymentEntry {
  id: string
  invoice_id: string
  payment_type: ManualPaymentType
  status: ManualPaymentStatus
  submitted_by: string
  submitter_email?: string
  reviewed_by?: string
  reviewed_at?: string
  amount: number
  transaction_date: string
  settlement_date?: string
  vpa?: string
  upi_transaction_id?: string
  party_name?: string
  note?: string
  admin_flags: Array<{code: string; [key: string]: unknown}>
  rejection_reason?: string
  reconciliation_link_ref?: string
}

// ---------- Payment Folio ----------

// ---------- Monthly Reconciliation Report (MRR-2) ----------

export interface ReconciliationReceivedChannels {
  mmt: number;
  goibibo: number;
  card: number;
  upi: number;
  cash: number;
  bank_transfer: number;
  another_machine: number;
  other: number;
  total: number;
}

export interface ReconciliationDeductions {
  commission: number;
  gst_on_commission: number;
  tds: number;
  tcs: number;
  mdr: number;
  total: number;
}

export interface ReconciliationMonthSummary {
  invoice_month: string; // ISO date string "2026-06-01"
  invoice_count: number;
  gross_billed: number;
  taxable_amount: number;
  gst: number;
  received: ReconciliationReceivedChannels;
  deductions: ReconciliationDeductions;
  outstanding: number;
}

export interface BookingTypeBreakdownRow {
  source: string;
  invoice_count: number;
  gross_billed: number;
  gst: number;
  net_receivable: number;
  total_deductions: number;
  received: number;
  outstanding: number;
}

export interface PaymentTimingRow {
  period: string;
  label: string;
  amount: number;
  pct: number;
}

export interface PendingReconciliationInvoice {
  id: string;
  invoice_number: string;
  guest_name: string;
  checkout_date: string;
  source: string;
  grand_total: number;
  received: number;
  outstanding: number;
  status: "unreconciled" | "partial";
}

export interface ReconciliationMonthDetail {
  summary: {
    total_billed: number;
    net_receivable: number;
    total_received: number;
    outstanding: number;
  };
  booking_type_breakdown: BookingTypeBreakdownRow[];
  payment_timing: PaymentTimingRow[];
  pending_invoices: PendingReconciliationInvoice[];
}

export interface PaymentSuggestion {
  id: string;
  payment_method: string;
  payment_type_raw: string;
  received_date: string | null;
  payment_amount: number;
  reference_text: string | null;
  match_type: "booking_id" | "invoice_number";
}
