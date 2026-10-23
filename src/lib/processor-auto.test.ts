import { describe, expect, it } from "vitest";
import { automaticProcessorJobs, recordProcessorAttempt, type ProcessorAutoAttempts } from "./processor-auto";
import type { ProcessorJob } from "./processor-board";
const now = Date.parse("2026-10-22T16:00:00Z");
const facts = { policy: 10, tech_phone: "4155550199", enough_context: true, tech_took_job: true, job_update: "none", waiting_since: null, waiting_message_id: null, summary: "", evidence: [],
  window: { start: "2026-10-07T15:00:00Z", anchor: "lead_created", anchor_message_id: null, messages: 1, omitted: 0 }, call_transcripts: { state: "available", checked: 0, missing: 0, skipped_segments: 0 },
  source: "Quo current history", history_complete: true, ai_used: true, ai_reused: false, checked_at: "2026-10-22T15:00:00Z", status: "upcoming" };
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "JOB-1001", customer_name: "Synthetic", customer_phone: null, address: null, city: null, state: null, service_type: null, tech_name: "Synthetic Tech", tech_number: "4155550199", scheduled_date: "2026-10-21", scheduled_time_start: "10:00:00", scheduled_time_end: null, customer_schedule_requirements: null, terms: null, status: "scheduled", updated_at: "2026-10-20T16:00:00Z", created_at: "2026-10-19T16:00:00Z",
  board_status: "take_job_update", ai_stale: false, assessment: null, checked_at: null,
  chat_setup: { state: "ready", code: "ready", message: "Verified", fingerprint: "setup-a", conversation_id: "00000000-0000-4000-8000-000000000002", last_message_at: "2026-10-20T10:00:00Z", source: "verified_mirror" } };
describe("Processor Board check planner", () => {
  it("selects unchecked or changed ready jobs only", () => {
    const rows = [job, { ...job, id: "checked", assessment: facts }, { ...job, id: "stale", assessment: facts, ai_stale: true }, { ...job, id: "missing", tech_number: null }, { ...job, id: "closed", status: "paid" }, { ...job, id: "blocked", chat_setup: { ...job.chat_setup!, state: "blocked" as const } }];
    expect(automaticProcessorJobs(rows, now, new Map()).map((j) => j.id)).toEqual([job.id, "stale"]);
  });
  it("never rechecks a successful job on a timer, only after its chat or lead changes", () => {
    const attempts: ProcessorAutoAttempts = new Map();
    recordProcessorAttempt(attempts, job, now, true);
    for (const later of [30_000, 300_000, 86_400_000]) expect(automaticProcessorJobs([job], now + later, attempts)).toEqual([]);
    const newMessage = { ...job, chat_setup: { ...job.chat_setup!, last_message_at: "2026-10-22T15:59:00Z" } };
    expect(automaticProcessorJobs([newMessage], now, attempts)).toEqual([newMessage]);
    const edited = { ...job, updated_at: "2026-10-22T15:59:00Z" };
    expect(automaticProcessorJobs([edited], now, attempts)).toEqual([edited]);
  });
  it("uses capped exponential backoff for transient failures and waits for a change after a setup failure", () => {
    const attempts: ProcessorAutoAttempts = new Map();
    recordProcessorAttempt(attempts, job, now, false);
    expect(automaticProcessorJobs([job], now + 30_000, attempts)).toEqual([]);
    expect(automaticProcessorJobs([job], now + 60_000, attempts)).toEqual([job]);
    recordProcessorAttempt(attempts, job, now + 60_000, false);
    expect(attempts.get(job.id)?.retryAt).toBe(now + 180_000);
    for (let i = 0; i < 6; i++) recordProcessorAttempt(attempts, job, now, false);
    expect(attempts.get(job.id)?.retryAt).toBe(now + 480_000);
    recordProcessorAttempt(attempts, job, now, false, false);
    expect(automaticProcessorJobs([job], now + 86_400_000, attempts)).toEqual([]);
    const fixed = { ...job, chat_setup: { ...job.chat_setup!, fingerprint: "setup-b" } };
    expect(automaticProcessorJobs([fixed], now, attempts)).toEqual([fixed]);
  });
});
