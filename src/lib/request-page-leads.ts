import type { Lead } from "@/types";

/**
 * Column projections for the lead rows the approval-request pages join in.
 *
 * The Paid Approval and Cancellation Requests pages only render a handful of
 * lead fields next to each pending request, and their review actions
 * (reviewPaymentRequest / reviewCancellationRequest) only read id, job_id and
 * customer_name. Both pages used to fetch every column of each joined lead -
 * on leads that's 50+ columns including heavy text like service_details and
 * quote - on first load AND again inside the realtime INSERT handler.
 *
 * These projections are everything each page and its review path read, and
 * nothing else. The accompanying types keep the pages honest: the rows are
 * typed as the Pick, so reading an unfetched column is a compile error instead
 * of a silent undefined.
 */

/** Read by reviewPaymentRequest / reviewCancellationRequest (lib arg types). */
export type ReviewActionLead = Pick<Lead, "id" | "job_id" | "customer_name">;

export const CANCELLATION_PAGE_LEAD_COLUMNS = [
  "id",
  "status",
  "customer_name",
  "job_id",
].join(", ");

export type CancellationPageLead = Pick<
  Lead,
  "id" | "status" | "customer_name" | "job_id"
>;

export const PAYMENT_PAGE_LEAD_COLUMNS = [
  "id",
  "status",
  "customer_name",
  "job_id",
  "tech_name",
  "tech_number",
  "city",
  "state",
  "zip_code",
  "address",
].join(", ");

export type PaymentPageLead = Pick<
  Lead,
  | "id"
  | "status"
  | "customer_name"
  | "job_id"
  | "tech_name"
  | "tech_number"
  | "city"
  | "state"
  | "zip_code"
  | "address"
>;
