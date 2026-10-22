import { phoneKey } from "./processor-job-status.ts";

export const PROCESSOR_ACTIVE = ["scheduled", "job_in_progress", "payment_pending", "partial_paid"];
/** Readiness is not authorization. Both callers still enforce their role and record scope. */
export function processorReadiness(job: { status?: string; tech_number?: string | null; scheduled_date?: string | null; scheduled_time_start?: string | null }): string | null {
  if (!PROCESSOR_ACTIVE.includes(job.status ?? "")) return "This job is closed or in another approval workflow. Open its saved record.";
  if (!phoneKey(job.tech_number ?? null)) return "Save a valid technician number on this job before checking its conversation.";
  if (!job.scheduled_date || !job.scheduled_time_start) return "Save the agreed appointment date and start time before checking this job. No schedule was inferred.";
  return null;
}

/** Only static, customer-safe messages may cross this boundary. Never expose provider bodies. */
export class ProcessorReviewError extends Error {
  constructor(message: string, public code: string, public retryable: boolean, public status = 503) { super(message); }
}
