import { describe, expect, it } from "vitest";
import { automaticProcessorJobs, processorFocusHasActivity, processorReviewFocus, recordProcessorAttempt, type ProcessorAutoAttempts } from "./processor-auto";
import type { ProcessorJob } from "./processor-board";
const now = new Date("2026-10-22T16:00:00Z");
const timezone = "America/New_York";
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "JOB-1001", customer_name: "Synthetic", customer_phone: null, address: null, city: null, state: null, service_type: null, tech_name: "Synthetic Tech", tech_number: "4155550199", scheduled_date: "2026-10-21", scheduled_time_start: "10:00:00", scheduled_time_end: null, customer_schedule_requirements: null, terms: null, status: "scheduled", updated_at: "2026-10-20T16:00:00Z", assessment: null, checked_at: null,
  chat_setup: { state: "ready", code: "ready", message: "Verified", fingerprint: "setup-a", conversation_id: "00000000-0000-4000-8000-000000000002", last_message_at: null, source: "verified_mirror" } };
describe("open-board automatic review planner", () => {
  it("only treats later activity in the same saved focused assignment as a new-message check", () => {
    const focus = processorReviewFocus(job, timezone);
    expect(processorFocusHasActivity(focus, job, timezone)).toBe(false);
    const changed = { ...job, chat_setup: { ...job.chat_setup!, last_message_at: now.toISOString(), fingerprint: "new-message" } };
    expect(processorFocusHasActivity(focus, changed, timezone)).toBe(true);
    expect(processorFocusHasActivity(processorReviewFocus(changed, timezone), changed, timezone)).toBe(false);
    for (const outside of [{ ...changed, id: "other" }, { ...changed, tech_number: "4155550188" }, { ...changed, updated_at: now.toISOString() }, { ...changed, chat_setup: { ...changed.chat_setup, conversation_id: "different" } }]) {
      expect(processorFocusHasActivity(focus, outside, timezone)).toBe(false);
    }
    expect(processorFocusHasActivity(focus, changed, "America/Chicago")).toBe(false);
  });
  it("only selects ready saved jobs, not unverified setup, terminal jobs or legacy backend rows", () => {
    const rows = [job, { ...job, id: "missing", tech_number: null }, { ...job, id: "legacy", chat_setup: undefined }, { ...job, id: "closed", status: "paid" }, { ...job, id: "blocked", chat_setup: { ...job.chat_setup!, state: "blocked" as const } }];
    expect(automaticProcessorJobs(rows, timezone, now, new Map()).map((j) => j.id)).toEqual([job.id]);
  });
  it("does not recheck a successful job on every 30-second board read", () => {
    const attempts: ProcessorAutoAttempts = new Map();
    recordProcessorAttempt(attempts, job, timezone, now.getTime(), true);
    for (let tick = 1; tick < 10; tick++) expect(automaticProcessorJobs([job], timezone, new Date(now.getTime() + tick * 30000), attempts)).toEqual([]);
    expect(automaticProcessorJobs([job], timezone, new Date(now.getTime() + 300000), attempts)).toEqual([job]);
  });
  it("uses exponential backoff for transient failures and waits for changed setup after a permanent failure", () => {
    const attempts: ProcessorAutoAttempts = new Map();
    recordProcessorAttempt(attempts, job, timezone, now.getTime(), false);
    expect(automaticProcessorJobs([job], timezone, new Date(now.getTime() + 30000), attempts)).toEqual([]);
    expect(automaticProcessorJobs([job], timezone, new Date(now.getTime() + 60000), attempts)).toEqual([job]);
    recordProcessorAttempt(attempts, job, timezone, now.getTime() + 60000, false);
    expect(attempts.get(job.id)?.retryAt).toBe(now.getTime() + 180000);
    recordProcessorAttempt(attempts, job, timezone, now.getTime(), false, false);
    expect(automaticProcessorJobs([job], timezone, new Date(now.getTime() + 86400000), attempts)).toEqual([]);
    const changed = { ...job, chat_setup: { ...job.chat_setup!, fingerprint: "setup-b" } };
    expect(automaticProcessorJobs([changed], timezone, now, attempts)).toEqual([changed]);
  });
  it("new conversation activity retires a previous cooldown without crossing jobs", () => {
    const attempts: ProcessorAutoAttempts = new Map();
    recordProcessorAttempt(attempts, job, timezone, now.getTime(), true);
    const other = { ...job, id: "other", job_id: "JOB-1002" };
    const changed = { ...job, chat_setup: { ...job.chat_setup!, fingerprint: "new-message" } };
    expect(automaticProcessorJobs([changed, other], timezone, now, attempts)).toEqual([changed, other]);
  });
});
