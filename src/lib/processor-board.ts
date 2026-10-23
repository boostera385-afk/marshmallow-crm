import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { phoneKey, schedulePassed } from "../../supabase/functions/_shared/processor-job-status";
import { PROCESSOR_BOARD_STATUSES, PROCESSOR_POLICY, type ProcessorBoardStatus } from "../../supabase/functions/_shared/processor-lead-window";
import { processorReadiness } from "../../supabase/functions/_shared/processor-review";
import { PAYMENT_STATES, type PaymentState } from "../../supabase/functions/_shared/processor-payment";
export { processorReadiness, processorWorkflowMessage } from "../../supabase/functions/_shared/processor-review";
export { PROCESSOR_BOARD_STATUSES };
export type ProcessorStatus = ProcessorBoardStatus;

export const PROCESSOR_STATUS_UI: Record<ProcessorStatus, { label: string; help: string; color: string }> = {
  take_job_update: { label: "Take Job Update", help: "The appointment time has passed and the technician has not updated this job yet. Ask the technician for an update.", color: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  job_in_progress: { label: "Job In Progress", help: "The technician updated this job (on the way, arrived, working), or the lead is saved as In Progress.", color: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  payment_pending: { label: "Payment Pending", help: "The technician said the job is completed, or the lead is saved as Payment Pending. Stays here until it is marked Partial Paid or Paid.", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  payment_overdue: { label: "Payment Overdue", help: "Completed more than 24 hours ago and still not marked Partial Paid or Paid (or the date the customer promised has passed). Follow up on the payment.", color: "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300" },
  send_dose: { label: "Send Dose", help: "The technician took the job details, then has not answered our message about it for 60+ minutes. Follow up manually; nothing is sent automatically.", color: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  not_enough_details: { label: "Not enough details in the chat", help: "AI could not find enough about this job in the technician chat to decide. Open the chat and check it yourself.", color: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  upcoming: { label: "Upcoming", help: "The appointment has not started yet and no follow-up is due.", color: "border-border bg-muted/40 text-muted-foreground" },
};

/** What the customer's own chat says about the open payment. */
export const PAYMENT_STATE_UI: Record<PaymentState, { label: string; attention: boolean }> = {
  no_chat: { label: "No customer chat found", attention: false },
  not_asked: { label: "Customer not asked for payment yet", attention: true },
  waiting_on_customer: { label: "Waiting on customer", attention: true },
  promised: { label: "Customer promised to pay", attention: false },
  refused: { label: "Customer refused or disputes", attention: true },
  customer_says_paid: { label: "Customer says paid · verify", attention: true },
  unclear: { label: "Payment talk unclear", attention: false },
};

const nullableText = z.string().nullable();
export const processorChatSetupSchema = z.object({
  state: z.enum(["ready", "blocked", "unavailable"]), code: z.string(), message: z.string(), fingerprint: z.string(),
  conversation_id: nullableText, last_message_at: nullableText, source: z.enum(["saved_link", "verified_mirror"]).nullable(),
  chat_url: z.string().regex(/^https:\/\/my\.quo\.com\/inbox\/PN[A-Za-z0-9_-]{6,}\/c\/CN[A-Za-z0-9_-]{6,}$/).optional(),
});
/** Facts saved by the current backend. Older saved results stay readable but are ignored. */
export const processorFactsSchema = z.object({
  policy: z.literal(PROCESSOR_POLICY), tech_phone: z.string(),
  enough_context: z.boolean(), tech_took_job: z.boolean(), job_update: z.enum(["none", "in_progress", "completed"]),
  completed_at: nullableText.optional(), waiting_since: nullableText, waiting_message_id: nullableText, summary: z.string(),
  evidence: z.array(z.object({ signal: z.enum(["took_job", "in_progress", "completed", "waiting"]), quote: z.string(), message_id: z.string(), message_time: z.string(), from: z.enum(["technician", "our_team"]), via: z.enum(["text", "call"]) })),
  window: z.object({ start: z.string(), anchor: z.enum(["customer_mention", "lead_created"]), anchor_message_id: nullableText, messages: z.number().int().nonnegative(), omitted: z.number().int().nonnegative() }),
  call_transcripts: z.object({ state: z.enum(["available", "partial", "unavailable"]), checked: z.number().int().nonnegative(), missing: z.number().int().nonnegative(), skipped_segments: z.number().int().nonnegative() }),
  source: z.string(), history_complete: z.boolean(), ai_used: z.boolean(), ai_reused: z.boolean(), checked_at: z.string(), lead_updated_at: z.string().optional(),
  payment: z.object({
    state: z.enum(PAYMENT_STATES), waiting_since: nullableText, promised_date: nullableText, summary: z.string(),
    evidence: z.array(z.object({ signal: z.enum(["asked", "promised", "refused", "says_paid"]), quote: z.string(), message_id: z.string(), message_time: z.string(), from: z.enum(["customer", "our_team"]) })),
    window: z.object({ start: z.string(), messages: z.number().int().nonnegative(), omitted: z.number().int().nonnegative(), conversations: z.number().int().nonnegative() }),
  }).optional(),
  payment_error: z.string().optional(), checked_by: z.enum(["user", "daily_check"]).optional(),
  status: z.enum(PROCESSOR_BOARD_STATUSES).nullable(),
});
export type ProcessorFacts = z.infer<typeof processorFactsSchema>;
export const processorJobSchema = z.object({
  id: z.string().uuid(), job_id: z.string(), customer_name: nullableText, customer_phone: nullableText,
  service_type: nullableText, address: nullableText, half_address: nullableText.optional(), city: nullableText, state: nullableText,
  tech_name: nullableText, tech_number: nullableText, scheduled_date: nullableText, scheduled_time_start: nullableText, scheduled_time_end: nullableText,
  customer_schedule_requirements: nullableText, terms: nullableText, status: z.string(), updated_at: z.string(), created_at: z.string(),
  board_status: z.enum(PROCESSOR_BOARD_STATUSES), ai_stale: z.boolean(),
  assessment: z.record(z.unknown()).nullable(), checked_at: nullableText,
  chat_setup: processorChatSetupSchema.nullable().optional(),
});
export type ProcessorJob = z.infer<typeof processorJobSchema>;
export const processorQueueSchema = z.object({
  rows: z.array(processorJobSchema), total: z.number().int().nonnegative(), all_total: z.number().int().nonnegative(),
  counts: z.record(z.number().int().nonnegative()), observed_at: z.string(), timezone: z.string(),
  monitoring: z.object({ ai_configured: z.boolean(), current_history_configured: z.boolean(), evidence_policy: z.number().int().nonnegative().optional() }).optional(),
});
export type ProcessorQueue = z.infer<typeof processorQueueSchema>;
export type ProcessorFilters = { offset: number; search: string; timezone: string; aiStatus: ProcessorStatus | null };
export const PROCESSOR_PAGE_SIZE = 25;

export class ProcessorReviewFailure extends Error {
  constructor(message: string, public retryable = true, public code = "review_unavailable") { super(message); }
}
async function call(body: object, signal?: AbortSignal): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("processor-board", { body, signal });
  if (error) {
    const context: unknown = error.context;
    if (context instanceof Response) {
      if (context.status === 546) throw new ProcessorReviewFailure("The check reached the server resource limit while reading a long chat. The previous result is kept. Check again; contact Admin if it repeats.", true, "resource_limit");
      const payload = await context.clone().json().catch(() => null);
      if (payload && typeof payload.error === "string") throw new ProcessorReviewFailure(payload.error, typeof payload.retryable === "boolean" ? payload.retryable : ![400, 401, 403, 404, 422].includes(context.status), typeof payload.code === "string" ? payload.code : "review_unavailable");
    }
    throw new ProcessorReviewFailure("Processor Board is unavailable. Check your connection or ask Admin to check function health, then retry.");
  }
  return data;
}
export async function fetchProcessorJobs(filters: ProcessorFilters, signal?: AbortSignal): Promise<ProcessorQueue> {
  const parsed = processorQueueSchema.safeParse(await call({ action: "list", ...filters }, signal));
  if (!parsed.success) {
    // Name the field (never its value) so a version mismatch or data defect can be traced.
    const issue = parsed.error.issues[0];
    const field = issue ? `${issue.path.join(".") || "response"} (${issue.message.toLowerCase()})` : "response";
    throw new ProcessorReviewFailure(`The Processor Board backend sent data this page cannot read: ${field}. Ask Admin to check that every Processor Board migration is applied and the latest processor-board function is deployed.`, false, "backend_version");
  }
  return parsed.data;
}
export const PROCESSOR_REVIEW_TIMEOUT_MS = 120_000;
export async function assessProcessorJob(leadId: string, timezone: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROCESSOR_REVIEW_TIMEOUT_MS);
  try {
    return z.object({ result: processorFactsSchema, cached: z.boolean() }).parse(await call({ action: "assess", leadId, timezone }, controller.signal));
  } catch (error) {
    if (controller.signal.aborted) throw new ProcessorReviewFailure("The check timed out. The server may still finish it; refresh the board before checking again.", true, "review_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Saved facts for the technician now assigned, or null (never checked, older backend, reassigned). */
export function processorFacts(job: ProcessorJob): ProcessorFacts | null {
  const parsed = processorFactsSchema.safeParse(job.assessment);
  return parsed.success && parsed.data.tech_phone === phoneKey(job.tech_number) ? parsed.data : null;
}
export function processorSetupIssue(job: ProcessorJob): string | null {
  return processorReadiness(job) || (job.chat_setup && job.chat_setup.state !== "ready" ? job.chat_setup.message : null);
}
/**
 * AI runs only when its inputs changed: never checked, saved by an older
 * backend, or the lead / technician chat changed since (ai_stale). Time passing
 * alone never needs AI; the server turns saved facts into the current status.
 */
export function processorNeedsCheck(job: ProcessorJob): boolean {
  if (processorSetupIssue(job) || job.chat_setup?.state !== "ready") return false;
  return !processorFacts(job) || job.ai_stale;
}
/** Changes whenever a check could give a different answer. */
export const processorCheckSignature = (job: ProcessorJob) => `${job.updated_at}:${job.tech_number ?? ""}:${job.chat_setup?.fingerprint ?? ""}:${job.chat_setup?.last_message_at ?? ""}`;
export const processorSchedulePassed = (job: ProcessorJob, timezone: string, now: Date) => schedulePassed(job, now, timezone);
export const PROCESSOR_TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
/** One short line on who the open payment is waiting on, for completed jobs only. */
export function processorPaymentNote(job: ProcessorJob, timezone: string): { text: string; attention: boolean } | null {
  const facts = processorFacts(job);
  if (!facts || !["payment_pending", "payment_overdue"].includes(job.board_status)) return null;
  if (!facts.payment) return facts.payment_error ? { text: "Customer chat not checked yet", attention: false } : null;
  const ui = PAYMENT_STATE_UI[facts.payment.state];
  const day = (value: string) => new Date(value).toLocaleDateString([], { month: "short", day: "numeric", timeZone: timezone });
  const detail = facts.payment.waiting_since ? ` since ${day(facts.payment.waiting_since)}`
    : facts.payment.promised_date ? ` · ${new Date(`${facts.payment.promised_date}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" })}` : "";
  return { text: `${ui.label}${detail}`, attention: ui.attention };
}
