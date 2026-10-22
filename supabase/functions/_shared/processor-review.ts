import { phoneKey } from "./processor-job-status.ts";

export const PROCESSOR_ACTIVE = ["scheduled", "job_in_progress", "payment_pending", "partial_paid"];
export const PROCESSOR_TERMINAL = ["paid", "cancelled", "job_done", "done", "completed"];
export function processorWorkflowMessage(status: string): string | null {
  if (PROCESSOR_TERMINAL.includes(status)) return "Closed job — history only. AI cannot reopen it or change its saved status.";
  if (status === "cancellation_requested") return "Cancellation approval pending. AI evidence cannot approve or cancel this job.";
  if (status === "payment_requested") return "Payment approval pending. AI evidence cannot approve payment or mark this job paid.";
  if (status === "needs_reschedule") return "Needs Reschedule — confirm the customer's new agreement in the saved lead. AI does not change the schedule.";
  if (status === "waiting_customer_response") return "Waiting for the customer's response. Technician evidence does not replace the customer follow-up.";
  return PROCESSOR_ACTIVE.includes(status) ? null : `Saved workflow: ${status.replace(/_/g, " ")}. Review evidence without bypassing its existing workflow.`;
}
/** Readiness is not authorization. Both callers still enforce their role and record scope. */
export function processorReadiness(job: { status?: string; tech_number?: string | null; scheduled_date?: string | null; scheduled_time_start?: string | null }): string | null {
  if (!job.status || PROCESSOR_TERMINAL.includes(job.status)) return "Closed job — history only. Open its saved record; no AI review or status change is allowed.";
  if (!phoneKey(job.tech_number ?? null)) return "Save a valid technician number on this job before checking its conversation.";
  if (!job.scheduled_date || !job.scheduled_time_start) return "Save the agreed appointment date and start time before checking this job. No schedule was inferred.";
  return null;
}

/** Only static, customer-safe messages may cross this boundary. Never expose provider bodies. */
export class ProcessorReviewError extends Error {
  constructor(message: string, public code: string, public retryable: boolean, public status = 503) { super(message); }
}
