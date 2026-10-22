import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { schedulePassed } from "../../supabase/functions/_shared/processor-job-status";
import { PROCESSOR_ACTIVE, PROCESSOR_TERMINAL, processorReadiness } from "../../supabase/functions/_shared/processor-review";
export { processorReadiness, processorWorkflowMessage } from "../../supabase/functions/_shared/processor-review";

export const PROCESSOR_STATUSES = ["take_job_update", "job_in_progress", "payment_pending", "send_dose", "needs_review", "unavailable", "scheduled"] as const;
export type ProcessorStatus = typeof PROCESSOR_STATUSES[number];
export const PROCESSOR_STATUS_UI: Record<ProcessorStatus, { label: string; action: string; color: string }> = {
  take_job_update: { label: "Take Job Update", action: "Ask the technician for this job's current update.", color: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  job_in_progress: { label: "Job In Progress", action: "Monitor the job and confirm its expected finish.", color: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  payment_pending: { label: "Payment Pending", action: "Review completion and follow the existing payment approval workflow.", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  send_dose: { label: "Send Dose", action: "Review the unanswered request and follow up manually in Quo. Nothing is sent automatically.", color: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  needs_review: { label: "Needs Review", action: "Verify the saved schedule and job-specific conversation.", color: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  unavailable: { label: "Unavailable", action: "Sync or verify the technician chat, then retry. No outcome was inferred.", color: "border-border bg-muted text-muted-foreground" },
  scheduled: { label: "Scheduled", action: "The saved appointment has not started in the selected timezone.", color: "border-border bg-muted text-muted-foreground" },
};
const nullableText = z.string().nullable();
export const processorChatSetupSchema = z.object({
  state: z.enum(["ready", "blocked", "unavailable"]), code: z.string(), message: z.string(), fingerprint: z.string(),
  conversation_id: nullableText, last_message_at: nullableText, source: z.enum(["saved_link", "verified_mirror"]).nullable(),
});
export const processorAssessmentSchema = z.object({
  status: z.enum(PROCESSOR_STATUSES), evidence: z.array(z.object({ signal: z.enum(["accepted", "progress", "completed", "update_request"]), quote: z.string(), message_id: z.string(), message_time: z.string(), sender: z.string() })),
  messages_reviewed: z.number().int().nonnegative(), matched_messages: z.number().int().nonnegative(),
  source: z.string(), history_complete: z.boolean(), ai_used: z.boolean().optional(), chat_fingerprint: z.string().optional(), chat_source: z.enum(["saved_link", "verified_mirror"]).optional(), timezone: z.string(), checked_at: z.string(), summary: z.string(), lead_updated_at: z.string(),
});
export const processorJobSchema = z.object({
  id: z.string().uuid(), job_id: z.string(), customer_name: z.string(), customer_phone: nullableText,
  service_type: nullableText, address: nullableText, city: nullableText, state: nullableText,
  tech_name: nullableText, tech_number: nullableText, scheduled_date: nullableText, scheduled_time_start: nullableText, scheduled_time_end: nullableText,
  customer_schedule_requirements: nullableText, terms: nullableText, status: z.string(), updated_at: z.string(),
  assessment: processorAssessmentSchema.nullable(), checked_at: nullableText,
  chat_setup: processorChatSetupSchema.nullable().optional(),
});
export type ProcessorJob = z.infer<typeof processorJobSchema>;
export const processorQueueSchema = z.object({ rows: z.array(processorJobSchema), total: z.number().int().nonnegative(), observed_at: z.string(), timezone: z.string(), monitoring: z.object({ ai_configured: z.boolean(), current_history_configured: z.boolean() }).optional() });
export type ProcessorQueue = z.infer<typeof processorQueueSchema>;
export type ProcessorFilters = { offset: number; search: string; history: boolean; timezone: string };
export class ProcessorReviewFailure extends Error {
  constructor(message: string, public retryable = true, public code = "review_unavailable") { super(message); }
}
async function call(body: object, signal?: AbortSignal): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("processor-board", { body, signal });
  if (error) {
    const context: unknown = error.context;
    if (context instanceof Response) {
      if (context.status === 546) throw new ProcessorReviewFailure("Review reached the server resource limit while reading a long conversation. Previous evidence is retained. Retry this job; contact Admin if it repeats.", true, "resource_limit");
      const payload = await context.clone().json().catch(() => null);
      if (payload && typeof payload.error === "string") throw new ProcessorReviewFailure(payload.error, typeof payload.retryable === "boolean" ? payload.retryable : ![400, 401, 403, 404, 422].includes(context.status), typeof payload.code === "string" ? payload.code : "review_unavailable");
    }
    throw new ProcessorReviewFailure("Processor Board is unavailable. Check your connection or ask Admin to check function health, then retry.");
  }
  return data;
}
export const fetchProcessorJobs = async (filters: ProcessorFilters, signal?: AbortSignal) => processorQueueSchema.parse(await call({ action: "list", ...filters }, signal));
export const assessProcessorJob = async (leadId: string, timezone: string) => z.object({ result: processorAssessmentSchema, cached: z.boolean() }).parse(await call({ action: "assess", leadId, timezone }));
export function currentAssessment(job: ProcessorJob, timezone: string, now: Date) {
  const a = job.assessment;
  return a && (!job.chat_setup || a.chat_fingerprint === job.chat_setup.fingerprint) && a.timezone === timezone && Date.parse(a.lead_updated_at) === Date.parse(job.updated_at) && now.getTime() - Date.parse(a.checked_at) < 5 * 60_000 ? a : null;
}
export function processorSetupIssue(job: ProcessorJob): string | null {
  return processorReadiness(job) || (job.chat_setup && job.chat_setup.state !== "ready" ? job.chat_setup.message : null);
}
export const processorReviewSignature = (job: ProcessorJob, timezone: string) => `${job.updated_at}:${timezone}:${job.chat_setup?.fingerprint ?? "legacy"}`;
export function processorStatus(job: ProcessorJob, timezone: string, now: Date): ProcessorStatus {
  if (PROCESSOR_TERMINAL.includes(job.status)) return "needs_review";
  if (job.status === "payment_pending" || job.status === "partial_paid") return "payment_pending";
  const assessment = currentAssessment(job, timezone, now);
  if (assessment) {
    if (job.status === "job_in_progress" && ["scheduled", "take_job_update"].includes(assessment.status)) return "job_in_progress";
    return assessment.status === "scheduled" && schedulePassed(job, now, timezone) ? "take_job_update" : assessment.status;
  }
  if (job.status === "job_in_progress") return "job_in_progress";
  if (!PROCESSOR_ACTIVE.includes(job.status)) return "needs_review";
  return schedulePassed(job, now, timezone) ? "take_job_update" : job.scheduled_date && job.scheduled_time_start ? "scheduled" : "needs_review";
}
/** The status's authority is separate from whether an AI request ran. */
export function processorStatusOrigin(job: ProcessorJob, timezone: string, now: Date): string {
  const assessment = currentAssessment(job, timezone, now);
  const status = processorStatus(job, timezone, now);
  const review = !assessment ? job.checked_at ? "previous check stale · refresh AI" : "not AI checked"
    : assessment.ai_used === true ? assessment.evidence.length ? "AI reviewed source quotes" : "AI found no verified job update"
      : assessment.ai_used === false ? "no AI used" : "AI usage not recorded";
  if (["payment_pending", "partial_paid"].includes(job.status) || (job.status === "job_in_progress" && status === "job_in_progress" && !assessment?.evidence.some((e) => e.signal === "progress"))) return `Saved lead status · ${review}`;
  if (assessment && status === "payment_pending" && assessment.evidence.some((e) => e.signal === "completed")) return "AI evidence · technician completion verified";
  if (assessment && status === "job_in_progress" && assessment.evidence.some((e) => e.signal === "progress")) return "AI evidence · technician progress verified";
  if (assessment && status === "send_dose") return assessment.history_complete && assessment.evidence.some((e) => e.signal === "accepted" || e.signal === "progress") && assessment.evidence.some((e) => e.signal === "update_request")
    ? "AI evidence + delivered-request timing · follow up manually" : "Review result · verify acceptance and delivered request before following up";
  if (status === "scheduled" || status === "take_job_update") return `Schedule rule · ${review}`;
  return `Saved workflow / review result · ${review}`;
}
export const PROCESSOR_TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
