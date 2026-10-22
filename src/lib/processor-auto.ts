import { currentAssessment, processorReviewSignature, processorSetupIssue, type ProcessorJob } from "./processor-board";

export type ProcessorAutoAttempt = { signature: string; retryAt: number; failures: number };
export type ProcessorAutoAttempts = Map<string, ProcessorAutoAttempt>;

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
