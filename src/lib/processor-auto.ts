import { currentAssessment, processorReviewSignature, processorSetupIssue, type ProcessorJob } from "./processor-board";
import { phoneKey } from "../../supabase/functions/_shared/processor-job-status";

export type ProcessorAutoAttempt = { signature: string; retryAt: number; failures: number };
export type ProcessorAutoAttempts = Map<string, ProcessorAutoAttempt>;
export type ProcessorReviewFocus = { id: string; identity: string; lastMessageAt: string | null };
export function processorReviewFocus(job: ProcessorJob, timezone: string): ProcessorReviewFocus {
  return { id: job.id, identity: `${job.id}:${job.updated_at}:${timezone}:${phoneKey(job.tech_number)}:${job.chat_setup?.conversation_id ?? ""}`, lastMessageAt: job.chat_setup?.last_message_at ?? null };
}
export function processorFocusHasActivity(focus: ProcessorReviewFocus, job: ProcessorJob, timezone: string): boolean {
  const next = processorReviewFocus(job, timezone);
  const at = Date.parse(next.lastMessageAt ?? "");
  const before = Date.parse(focus.lastMessageAt ?? "");
  return next.identity === focus.identity && Number.isFinite(at) && (!Number.isFinite(before) || at > before);
}

/** Existing UI clock drives this planner: no per-row timer or unbounded retry loop. */
export function automaticProcessorJobs(jobs: ProcessorJob[], timezone: string, now: Date, attempts: ProcessorAutoAttempts): ProcessorJob[] {
  return jobs.filter((job) => {
    if (processorSetupIssue(job) || job.chat_setup?.state !== "ready" || currentAssessment(job, timezone, now)) return false;
    const previous = attempts.get(job.id);
    return !previous || previous.signature !== processorReviewSignature(job, timezone) || previous.retryAt <= now.getTime();
  });
}

export function recordProcessorAttempt(attempts: ProcessorAutoAttempts, job: ProcessorJob, timezone: string, now: number, success: boolean, retryable = true) {
  const signature = processorReviewSignature(job, timezone);
  const previous = attempts.get(job.id);
  const failures = success ? 0 : (previous?.signature === signature ? previous.failures : 0) + 1;
  // Setup failures wait for a changed setup fingerprint or explicit user recheck.
  const wait = success ? 5 * 60_000 : retryable ? Math.min(5 * 60_000, 60_000 * 2 ** Math.min(failures - 1, 3)) : Infinity;
  attempts.set(job.id, { signature, retryAt: now + wait, failures });
}
