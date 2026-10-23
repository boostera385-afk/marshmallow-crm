import { processorCheckSignature, processorNeedsCheck, type ProcessorJob } from "./processor-board";

export type ProcessorAutoAttempt = { signature: string; retryAt: number; failures: number };
export type ProcessorAutoAttempts = Map<string, ProcessorAutoAttempt>;

/**
 * Loaded-page jobs whose chat or lead changed since their last check. A job
 * already attempted for this exact signature waits for its backoff (failure)
 * or for the next change (success); it is never rechecked on a timer.
 */
export function automaticProcessorJobs(jobs: ProcessorJob[], now: number, attempts: ProcessorAutoAttempts): ProcessorJob[] {
  return jobs.filter((job) => {
    if (!processorNeedsCheck(job)) return false;
    const previous = attempts.get(job.id);
    return !previous || previous.signature !== processorCheckSignature(job) || previous.retryAt <= now;
  });
}

export function recordProcessorAttempt(attempts: ProcessorAutoAttempts, job: ProcessorJob, now: number, success: boolean, retryable = true) {
  const signature = processorCheckSignature(job);
  const previous = attempts.get(job.id);
  const failures = success ? 0 : (previous?.signature === signature ? previous.failures : 0) + 1;
  // Success: wait for the next real change. Setup failures wait for corrected details.
  const wait = success || !retryable ? Infinity : Math.min(10 * 60_000, 60_000 * 2 ** Math.min(failures - 1, 3));
  attempts.set(job.id, { signature, retryAt: now + wait, failures });
}
