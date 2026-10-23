import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { schedulePassed } from "../../supabase/functions/_shared/processor-job-status";
import { PROCESSOR_ACTIVE, PROCESSOR_TERMINAL, processorReadiness, processorWorkflowMessage } from "../../supabase/functions/_shared/processor-review";
export { processorReadiness, processorWorkflowMessage } from "../../supabase/functions/_shared/processor-review";

export const PROCESSOR_STATUSES = ["take_job_update", "job_in_progress", "payment_pending", "send_dose", "needs_review", "unavailable", "scheduled"] as const;
export type ProcessorStatus = typeof PROCESSOR_STATUSES[number];
export const PROCESSOR_STATUS_UI: Record<ProcessorStatus, { label: string; action: string; color: string }> = {
  take_job_update: { label: "Take Job Update", action: "Ask the technician for this job's current update.", color: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  job_in_progress: { label: "Job In Progress", action: "Monitor the job and confirm its expected finish.", color: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  payment_pending: { label: "Payment Pending", action: "Review completion and follow the existing payment approval workflow.", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  send_dose: { label: "Send Dose", action: "Review the unanswered request and follow up manually in Quo. Nothing is sent automatically.", color: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  needs_review: { label: "Needs Review", action: "Verify the saved schedule and job-specific conversation.", color: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  unavailable: { label: "Needs Review", action: "Sync or verify the technician chat, then retry. No outcome was inferred.", color: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  scheduled: { label: "Appointment upcoming", action: "The appointment has not started. No follow-up is due yet.", color: "border-border bg-muted/30 text-muted-foreground" },
};
export const PROCESSOR_ACTION_HELP = {
  take_job_update: "The agreed appointment date and start time have passed, with no verified progress or completion for this job. Ask its assigned technician for an update.",
  job_in_progress: "This job's technician explicitly reported arriving, starting or working, or the saved lead is already In Progress. Acceptance, plans and another customer's updates do not prove work started.",
  payment_pending: "The technician explicitly reported completing this specific appointment, or its saved lead is already Payment Pending / Partially Paid. Existing payment approvals still apply.",
  send_dose: "This job was explicitly accepted and its appointment has started. A delivered job-specific update request has gone unanswered for at least 60 minutes, verified against current Quo history. Follow up manually; nothing is sent automatically.",
} as const;
const nullableText = z.string().nullable();
export const processorChatSetupSchema = z.object({
  state: z.enum(["ready", "blocked", "unavailable"]), code: z.string(), message: z.string(), fingerprint: z.string(),
  conversation_id: nullableText, last_message_at: nullableText, source: z.enum(["saved_link", "verified_mirror"]).nullable(),
  chat_url: z.string().regex(/^https:\/\/my\.quo\.com\/inbox\/PN[A-Za-z0-9_-]{6,}\/c\/CN[A-Za-z0-9_-]{6,}$/).optional(),
});
export const processorAssessmentSchema = z.object({
  status: z.enum(PROCESSOR_STATUSES), evidence: z.array(z.object({ signal: z.enum(["accepted", "progress", "completed", "update_request"]), quote: z.string(), message_id: z.string(), message_time: z.string(), sender: z.string(), identity_basis: z.enum(["source_message", "thread_context"]).optional(), source: z.literal("call_transcript").optional(), source_message_id: z.string().optional(), call_id: z.string().optional() })),
  messages_reviewed: z.number().int().nonnegative(), matched_messages: z.number().int().nonnegative(),
  matched_technician_messages: z.number().int().nonnegative().optional(), context_technician_messages: z.number().int().nonnegative().optional(), unattributed_technician_messages: z.number().int().nonnegative().optional(), technician_text_messages: z.number().int().nonnegative().optional(), call_event_messages: z.number().int().nonnegative().optional(), extraction_messages: z.number().int().nonnegative().optional(),
  source: z.string(), history_complete: z.boolean(), ai_used: z.boolean().optional(), chat_fingerprint: z.string().optional(), chat_source: z.enum(["saved_link", "verified_mirror"]).optional(), timezone: z.string(), checked_at: z.string(), summary: z.string(), lead_updated_at: z.string(),
  ai_scope: z.enum(["latest_job_messages_and_keywords", "all_job_linked_messages"]).optional(), ai_recent_limit: z.number().int().positive().optional(), ai_messages_omitted: z.number().int().nonnegative().optional(),
  review_reason: z.enum(["job_attribution", "no_verified_update", "mirror_incomplete", "call_history_unavailable"]).optional(),
  ai_extraction_reused: z.boolean().optional(), job_messages_changed: z.boolean().optional(),
  call_transcripts: z.object({ state: z.enum(["available", "partial", "unavailable"]), checked: z.number().int().nonnegative(), missing: z.number().int().nonnegative(), skipped_segments: z.number().int().nonnegative() }).optional(),
});
export const processorJobSchema = z.object({
  id: z.string().uuid(), job_id: z.string(), customer_name: z.string(), customer_phone: nullableText,
  service_type: nullableText, address: nullableText, half_address: nullableText.optional(), city: nullableText, state: nullableText,
  tech_name: nullableText, tech_number: nullableText, scheduled_date: nullableText, scheduled_time_start: nullableText, scheduled_time_end: nullableText,
  customer_schedule_requirements: nullableText, terms: nullableText, status: z.string(), updated_at: z.string(),
  assessment: processorAssessmentSchema.nullable(), checked_at: nullableText,
  chat_setup: processorChatSetupSchema.nullable().optional(),
});
export type ProcessorJob = z.infer<typeof processorJobSchema>;
export const processorQueueSchema = z.object({ rows: z.array(processorJobSchema), total: z.number().int().nonnegative(), observed_at: z.string(), timezone: z.string(), monitoring: z.object({ ai_configured: z.boolean(), current_history_configured: z.boolean(), evidence_policy: z.number().int().nonnegative().optional() }).optional() });
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
export const PROCESSOR_REVIEW_TIMEOUT_MS = 120_000;
export const assessProcessorJob = async (leadId: string, timezone: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROCESSOR_REVIEW_TIMEOUT_MS);
  try {
    return z.object({ result: processorAssessmentSchema, cached: z.boolean() }).parse(await call({ action: "assess", leadId, timezone }, controller.signal));
  } catch (error) {
    if (controller.signal.aborted) throw new ProcessorReviewFailure("The check timed out. The server may still finish it; refresh the board before retrying. No new result was confirmed.", true, "review_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
/** An old check may still describe this exact assignment, but is not fresh. */
export function compatibleProcessorAssessment(job: ProcessorJob, timezone: string) {
  const a = job.assessment;
  return a && Number.isFinite(Date.parse(a.checked_at)) && (!job.chat_setup || a.chat_fingerprint === job.chat_setup.fingerprint) && a.timezone === timezone && Date.parse(a.lead_updated_at) === Date.parse(job.updated_at) ? a : null;
}
export function currentAssessment(job: ProcessorJob, timezone: string, now: Date) {
  const a = compatibleProcessorAssessment(job, timezone);
  const age = a ? now.getTime() - Date.parse(a.checked_at) : -1;
  // The UI clock ticks every 30s; a response can arrive just after its snapshot.
  // Bound that small skew, but never accept a materially future-dated result.
  return a && age >= -30_000 && age < 5 * 60_000 ? a : null;
}
export function processorSetupIssue(job: ProcessorJob): string | null {
  return processorReadiness(job) || (!job.tech_name?.trim() ? "Technician name missing — verify the assigned technician on the saved job." : null) || (job.chat_setup && job.chat_setup.state !== "ready" ? job.chat_setup.message : null);
}
export function processorAttributionMessage(job: ProcessorJob, timezone: string, now: Date): string | null {
  const a = currentAssessment(job, timezone, now);
  if (a?.matched_technician_messages === undefined && a?.context_technician_messages === undefined) return null;
  const direct = a?.matched_technician_messages ?? 0;
  const contextual = a?.context_technician_messages ?? 0;
  const unassigned = a?.unattributed_technician_messages ?? 0;
  const tied = direct + contextual;
  if (!tied) return unassigned
    ? `${unassigned} technician repl${unassigned === 1 ? "y was" : "ies were"} not tied to this job; no technician outcome is verified. Review the chat manually.`
    : "No technician text reply is tied to this job yet. Review the chat manually.";
  const verified = a?.evidence.some((item) => item.signal !== "update_request");
  return `${tied} technician repl${tied === 1 ? "y is" : "ies are"} tied to this job${contextual ? ` (${contextual} via this job's saved dispatch)` : ""}.${unassigned ? ` ${unassigned} other repl${unassigned === 1 ? "y was" : "ies were"} not tied to it.` : ""} ${verified ? "Verify the quoted updates in Quo before acting." : "No progress or completion is verified yet."}`;
}
/** Replies and extracted outcomes are different: an acknowledgement is a reply
 * even when AI finds no progress/completion. Older results fall back to evidence. */
export function processorHasTechnicianReply(assessment: z.infer<typeof processorAssessmentSchema>): boolean {
  if (assessment.matched_technician_messages !== undefined || assessment.context_technician_messages !== undefined)
    return (assessment.matched_technician_messages ?? 0) + (assessment.context_technician_messages ?? 0) > 0;
  return assessment.evidence.some((item) => item.signal !== "update_request");
}
export const processorReviewSignature = (job: ProcessorJob, timezone: string) => `${job.updated_at}:${timezone}:${job.chat_setup?.fingerprint ?? "legacy"}`;
export function processorStatus(job: ProcessorJob, timezone: string, now: Date): ProcessorStatus {
  if (PROCESSOR_TERMINAL.includes(job.status)) return "needs_review";
  if (job.status === "payment_pending" || job.status === "partial_paid") return "payment_pending";
  const assessment = currentAssessment(job, timezone, now);
  if (assessment) {
    const unlinked = (assessment.matched_technician_messages ?? 0) + (assessment.context_technician_messages ?? 0) === 0 && (assessment.unattributed_technician_messages ?? 0) > 0;
    if (job.status !== "job_in_progress" && ((assessment.review_reason && assessment.review_reason !== "no_verified_update") || unlinked)) return "needs_review";
    // Legacy reviews also used Needs Review for ordinary chatter/acknowledgements.
    // No verified outcome is not a setup error: retain the diagnostic, not a
    // fabricated progress/completion finding or an unnecessary review blocker.
    if (job.status === "scheduled" && assessment.review_reason === "no_verified_update") return schedulePassed(job, now, timezone) ? "take_job_update" : "scheduled";
    if (job.status === "job_in_progress" && ["scheduled", "take_job_update"].includes(assessment.status)) return "job_in_progress";
    return assessment.status === "scheduled" && schedulePassed(job, now, timezone) ? "take_job_update" : assessment.status;
  }
  if (job.status === "job_in_progress") return "job_in_progress";
  const previous = compatibleProcessorAssessment(job, timezone);
  // Keep supported outcomes visible as PREVIOUS evidence while rechecking. Never
  // keep an old non-response accusation actionable or reuse a changed assignment.
  if (previous && Date.parse(previous.checked_at) <= now.getTime()) {
    if (previous.status === "payment_pending" && previous.evidence.some((e) => e.signal === "completed")) return "payment_pending";
    if (previous.status === "job_in_progress" && previous.evidence.some((e) => e.signal === "progress")) return "job_in_progress";
    if (["needs_review", "unavailable", "send_dose"].includes(previous.status)) return "needs_review";
  }
  if ((job.checked_at || job.assessment) && !previous) return "needs_review";
  if (!PROCESSOR_ACTIVE.includes(job.status)) return "needs_review";
  return schedulePassed(job, now, timezone) ? "take_job_update" : job.scheduled_date && job.scheduled_time_start ? "scheduled" : "needs_review";
}
/** Short, readable remediation on the row; detailed evidence stays in Review. */
export function processorReviewMessage(job: ProcessorJob, timezone: string, now: Date): string | null {
  const setup = processorSetupIssue(job);
  if (setup) return setup;
  const a = currentAssessment(job, timezone, now);
  if (a?.review_reason === "job_attribution" || (a && (a.matched_technician_messages ?? 0) + (a.context_technician_messages ?? 0) === 0 && (a.unattributed_technician_messages ?? 0) > 0)) return "Cannot confidently match this technician's update to this job. Review the chat.";
  if (a?.review_reason === "no_verified_update") return job.status === "scheduled" ? "No verified work update yet · using the agreed schedule, not an AI-confirmed outcome." : "No clear progress or completion was verified. Review this job's messages.";
  if (a?.review_reason === "mirror_incomplete") return "Current chat history is unavailable. Verify the unanswered request manually.";
  if (a?.review_reason === "call_history_unavailable") return "Call history could not be checked. Review the technician chat before following up.";
  if ((job.checked_at || job.assessment) && !compatibleProcessorAssessment(job, timezone)) return "Job, assigned technician, schedule or conversation changed. Recheck this job; previous evidence is not current.";
  if (!a && compatibleProcessorAssessment(job, timezone)) return "Previous result · refresh due. Rechecking uses only this job and its assigned technician.";
  return processorWorkflowMessage(job.status);
}
/** One plain-language result on the row; technical provenance stays in Review. */
export function processorRowSummary(job: ProcessorJob, timezone: string, now: Date): string {
  const setup = processorSetupIssue(job);
  if (setup) return setup;
  const fresh = currentAssessment(job, timezone, now);
  const compatible = compatibleProcessorAssessment(job, timezone);
  const shown = processorStatus(job, timezone, now);
  if (!fresh) {
    if (compatible && ["job_in_progress", "payment_pending"].includes(shown)) return "Earlier verified update shown · refresh to check for changes.";
    if ((job.checked_at || job.assessment) && !compatible) return "Job or chat changed · check this job again.";
    if (compatible) return "Last check is older · refresh to check for changes.";
    if (["job_in_progress", "payment_pending", "partial_paid"].includes(job.status)) return "From the saved lead · conversation not checked yet.";
    return shown === "scheduled" ? "Appointment has not started · no job update verified." : "Conversation not checked yet.";
  }
  if (fresh.review_reason === "job_attribution" || (processorReviewMessage(job, timezone, now)?.startsWith("Cannot confidently"))) return "Update could not be matched to this job · review the chat.";
  if (fresh.review_reason === "mirror_incomplete" || fresh.review_reason === "call_history_unavailable") return "Chat or call history is incomplete · review before following up.";
  const outcome = fresh.evidence.find((e) => e.signal === (shown === "payment_pending" ? "completed" : "progress"));
  if (["payment_pending", "job_in_progress"].includes(shown) && outcome) return `${fresh.ai_used ? "AI · " : "Evidence · "}${outcome.source === "call_transcript" ? "call transcript" : "technician message"}: ${shown === "payment_pending" ? "job completed" : "work started"}${outcome.identity_basis === "thread_context" ? " · context match—verify in chat" : ""}${fresh.job_messages_changed === false ? " · no new update" : ""}.`;
  if (fresh.call_transcripts && fresh.call_transcripts.state !== "available") return "Texts checked · some call evidence is unavailable. Review calls manually.";
  if (["job_in_progress", "payment_pending", "partial_paid"].includes(job.status)) return "From the saved lead · latest check found no new work update.";
  if (shown === "send_dose") return "Accepted job · update request unanswered for 60+ minutes. Follow up manually.";
  if (shown === "scheduled") return "Appointment has not started · no work update verified.";
  if (processorHasTechnicianReply(fresh)) return "Reply found · work started or completion not confirmed.";
  return "No update found for this job · ask the technician.";
}
/** The status's authority is separate from whether an AI request ran. */
export function processorStatusOrigin(job: ProcessorJob, timezone: string, now: Date): string {
  const assessment = currentAssessment(job, timezone, now);
  const status = processorStatus(job, timezone, now);
  const previous = compatibleProcessorAssessment(job, timezone);
  if (!assessment && previous && ((status === "payment_pending" && previous.evidence.some((e) => e.signal === "completed")) || (status === "job_in_progress" && previous.evidence.some((e) => e.signal === "progress")))) return `Previous ${previous.ai_used ? "AI evidence" : "result"} · ${status === "payment_pending" ? "technician completion" : "technician progress"} · refresh due`;
  const review = !assessment ? job.checked_at ? "previous check stale · refresh AI" : "not AI checked"
    : assessment.ai_used === true ? assessment.evidence.length ? "AI reviewed source quotes" : "AI found no verified job update"
      : assessment.ai_used === false ? "no AI used" : "AI usage not recorded";
  if (["payment_pending", "partial_paid"].includes(job.status) || (job.status === "job_in_progress" && status === "job_in_progress" && !assessment?.evidence.some((e) => e.signal === "progress"))) return `Saved lead status · ${review}`;
  const completion = assessment?.evidence.find((e) => e.signal === "completed");
  if (assessment && status === "payment_pending" && completion) return `AI evidence · technician completion ${completion.identity_basis === "thread_context" ? "context-attributed · verify in Quo" : "verified"}`;
  const progress = assessment?.evidence.find((e) => e.signal === "progress");
  if (assessment && status === "job_in_progress" && progress) return `AI evidence · technician progress ${progress.identity_basis === "thread_context" ? "context-attributed · verify in Quo" : "verified"}`;
  if (assessment && status === "send_dose") return assessment.history_complete && assessment.evidence.some((e) => e.signal === "accepted" || e.signal === "progress") && assessment.evidence.some((e) => e.signal === "update_request")
    ? "AI evidence + delivered-request timing · follow up manually" : "Review result · verify acceptance and delivered request before following up";
  if (status === "scheduled" || status === "take_job_update") return `Schedule rule · ${review}`;
  return `Saved workflow / review result · ${review}`;
}
export const PROCESSOR_TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
