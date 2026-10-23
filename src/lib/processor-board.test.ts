import { afterEach, describe, expect, it, vi } from "vitest";
import { canAccessNavItem } from "./access";
import { assessProcessorJob, fetchProcessorJobs, processorFacts, processorNeedsCheck, processorReadiness, processorSchedulePassed, processorSetupIssue, processorWorkflowMessage, type ProcessorJob } from "./processor-board";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
const processorTestFacts = { policy: 10, tech_phone: "4155550199", enough_context: true, tech_took_job: true, job_update: "completed", waiting_since: null, waiting_message_id: null, summary: "Technician finished.", evidence: [],
  window: { start: "2026-10-07T15:00:00Z", anchor: "customer_mention", anchor_message_id: "m1", messages: 3, omitted: 0 }, call_transcripts: { state: "available", checked: 0, missing: 0, skipped_segments: 0 },
  source: "Quo current history", history_complete: true, ai_used: true, ai_reused: false, checked_at: "2026-10-15T17:00:00Z", status: "payment_pending" };
const chat = { state: "ready" as const, code: "ready", message: "Verified", fingerprint: "fp", conversation_id: "00000000-0000-4000-8000-0000000000c1", last_message_at: null, source: "saved_link" as const };
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "JOB-1", customer_name: "John Sample", customer_phone: null, address: null, city: null, state: null, service_type: "Repair", tech_name: "Alex", tech_number: "4155550199", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, customer_schedule_requirements: null, terms: null, status: "scheduled", updated_at: "2026-10-15T10:00:00Z", created_at: "2026-10-08T15:00:00Z",
  board_status: "take_job_update", ai_stale: false, checked_at: null, assessment: null, chat_setup: chat };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); invoke.mockReset(); });
describe("Processor Board contract", () => {
  it.each(["admin", "processor", "customer_service", "cs_admin", "opr", "opr_admin"] as const)("enforces fixed role access for %s despite grants", (role) => {
    expect(canAccessNavItem(role, "processor_board", [{ id: "p", user_id: "u", nav_section: "processor_board", allowed: true }])).toBe(["admin", "processor"].includes(role));
  });
  it("checks only jobs whose chat or lead changed, never because time passed", () => {
    const checked = { ...job, assessment: processorTestFacts };
    expect(processorNeedsCheck(job)).toBe(true);
    expect(processorNeedsCheck(checked)).toBe(false);
    expect(processorNeedsCheck({ ...checked, ai_stale: true })).toBe(true);
    expect(processorNeedsCheck({ ...checked, assessment: { status: "send_dose", tech_phone: "4155550199" } })).toBe(true);
    expect(processorNeedsCheck({ ...checked, tech_number: "4155550188" })).toBe(true);
    expect(processorNeedsCheck({ ...job, chat_setup: { ...chat, state: "blocked" } })).toBe(false);
    expect(processorNeedsCheck({ ...job, tech_number: null })).toBe(false);
  });
  it("ignores saved facts from another technician or an older backend", () => {
    expect(processorFacts({ ...job, assessment: processorTestFacts })?.job_update).toBe("completed");
    expect(processorFacts({ ...job, tech_number: "4155550188", assessment: processorTestFacts })).toBeNull();
    expect(processorFacts({ ...job, assessment: { ...processorTestFacts, policy: 9 } })).toBeNull();
  });
  it("marks the schedule overdue in the chosen timezone", () => {
    const at = new Date("2026-10-15T14:30:00Z");
    expect(processorSchedulePassed(job, "America/New_York", at)).toBe(true);
    expect(processorSchedulePassed(job, "America/Los_Angeles", at)).toBe(false);
  });
  it("keeps payment-recorded, cancelled and scammed jobs closed; assigned jobs without a time are checkable", () => {
    for (const status of ["paid", "partial_paid", "cancelled", "scammed"]) expect(processorReadiness({ ...job, status })).toContain("Closed job");
    for (const status of ["job_done", "payment_requested", "needs_reschedule"]) expect(processorReadiness({ ...job, status })).toBeNull();
    expect(processorSetupIssue({ ...job, scheduled_time_start: null })).toBeNull();
    expect(processorSetupIssue({ ...job, tech_number: null })).toContain("technician number");
    expect(processorSetupIssue({ ...job, chat_setup: { ...chat, state: "blocked", message: "Save the chat link" } })).toBe("Save the chat link");
    expect(processorWorkflowMessage("payment_requested")).toContain("Payment approval pending");
  });
  it("sends the AI status filter and fails closed on an out-of-date backend", async () => {
    invoke.mockResolvedValue({ data: { rows: [{ ...job }], total: 1, all_total: 4, counts: { take_job_update: 1 }, observed_at: "2026-10-15T18:00:00Z", timezone: "America/New_York" }, error: null });
    await expect(fetchProcessorJobs({ offset: 0, search: "", timezone: "America/New_York", aiStatus: "take_job_update" })).resolves.toMatchObject({ total: 1, counts: { take_job_update: 1 } });
    expect(invoke).toHaveBeenCalledWith("processor-board", expect.objectContaining({ body: { action: "list", offset: 0, search: "", timezone: "America/New_York", aiStatus: "take_job_update" } }));
    invoke.mockResolvedValue({ data: { rows: [{ ...job, board_status: undefined }], total: 1, observed_at: "x", timezone: "America/New_York" }, error: null });
    await expect(fetchProcessorJobs({ offset: 0, search: "", timezone: "America/New_York", aiStatus: null })).rejects.toMatchObject({ code: "backend_version", retryable: false, message: expect.stringContaining("rows.0.board_status") });
    invoke.mockResolvedValue({ data: { rows: [{ ...job, ai_stale: null, customer_name: "Secret Name" }], total: 1, all_total: 1, counts: {}, observed_at: "x", timezone: "America/New_York" }, error: null });
    const failure = fetchProcessorJobs({ offset: 0, search: "", timezone: "America/New_York", aiStatus: null });
    await expect(failure).rejects.toMatchObject({ message: expect.stringContaining("rows.0.ai_stale") });
    await expect(failure).rejects.not.toMatchObject({ message: expect.stringContaining("Secret Name") });
  });
  it("bounds stalled checks and reports uncertain server completion rather than fabricated success", async () => {
    vi.useFakeTimers();
    invoke.mockImplementationOnce((_name, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("Aborted")))));
    const review = assessProcessorJob(job.id, "America/New_York");
    const check = expect(review).rejects.toMatchObject({ code: "review_timeout", retryable: true, message: expect.stringContaining("server may still finish") });
    await vi.advanceTimersByTimeAsync(120000);
    await check;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("turns resource-limit shutdowns into actionable errors", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "CPU Time exceeded" }), { status: 546 }) } });
    await expect(assessProcessorJob(job.id, "America/New_York")).rejects.toMatchObject({ code: "resource_limit", retryable: true });
  });
  it("preserves the server's recovery classification for setup failures", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "Verify technician chat", code: "chat_setup", retryable: false }), { status: 422 }) } });
    await expect(assessProcessorJob(job.id, "America/New_York")).rejects.toMatchObject({ code: "chat_setup", retryable: false });
  });
});
