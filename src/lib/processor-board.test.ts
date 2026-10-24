import { afterEach, describe, expect, it, vi } from "vitest";
import { canAccessNavItem } from "./access";
import { assessProcessorJob, fetchProcessorDetail, fetchProcessorJobs, processorFacts, processorPaymentNote, processorReadiness, processorSchedulePassed, processorSetupIssue, processorSummary, processorWorkflowMessage, PROCESSOR_BOARD_STATUSES, type ProcessorJob } from "./processor-board";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
const fullFacts = { policy: 10, tech_phone: "4155550199", enough_context: true, tech_took_job: true, job_update: "completed", waiting_since: null, waiting_message_id: null, summary: "Technician finished.", evidence: [],
  window: { start: "2026-10-07T15:00:00Z", anchor: "customer_mention", anchor_message_id: "m1", messages: 3, omitted: 0 }, call_transcripts: { state: "available", checked: 0, missing: 0, skipped_segments: 0 },
  source: "Quo current history", history_complete: true, ai_used: true, ai_reused: false, checked_at: "2026-10-15T17:00:00Z", status: "payment_pending" };
const chat = { state: "ready" as const, code: "ready", message: "Verified", fingerprint: "fp", conversation_id: "00000000-0000-4000-8000-0000000000c1", last_message_at: null, source: "saved_link" as const };
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "JOB-1", customer_name: "John Sample", customer_phone: null, address: null, city: null, state: null, service_type: "Repair", tech_name: "Alex", tech_number: "4155550199", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, customer_schedule_requirements: null, terms: null, status: "scheduled", updated_at: "2026-10-15T10:00:00Z", created_at: "2026-10-08T15:00:00Z",
  board_status: "take_job_update", ai_stale: false, checked_at: null, ai_summary: null, chat_setup: chat };
const summary = { policy: 10, tech_phone: "4155550199", job_update: "completed" };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); invoke.mockReset(); });
describe("Processor Board contract", () => {
  it.each(["admin", "processor", "customer_service", "cs_admin", "opr", "opr_admin"] as const)("enforces fixed role access for %s despite grants", (role) => {
    expect(canAccessNavItem(role, "processor_board", [{ id: "p", user_id: "u", nav_section: "processor_board", allowed: true }])).toBe(["admin", "processor"].includes(role));
  });
  it("has Wrong Tech Number and no Payment Overdue status", () => {
    expect(PROCESSOR_BOARD_STATUSES).toContain("wrong_tech_number");
    expect(PROCESSOR_BOARD_STATUSES).not.toContain("payment_overdue");
  });
  it("uses saved facts and summaries only for the technician now assigned and this version", () => {
    expect(processorFacts(job, fullFacts)?.job_update).toBe("completed");
    expect(processorFacts({ ...job, tech_number: "4155550188" }, fullFacts)).toBeNull();
    expect(processorFacts(job, { ...fullFacts, policy: 9 })).toBeNull();
    expect(processorSummary({ ...job, ai_summary: summary })).toEqual(summary);
    expect(processorSummary({ ...job, ai_summary: { ...summary, tech_phone: "4155550188" } })).toBeNull();
    expect(processorSummary({ ...job, ai_summary: { status: "send_dose" } as ProcessorJob["ai_summary"] })).toBeNull();
  });
  it("shows the payment reason only for completed, unpaid jobs", () => {
    const paid = { ...job, board_status: "send_dose" as const, ai_summary: { ...summary, payment_state: "waiting_on_customer" as const, payment_waiting_since: "2026-10-15T17:00:00Z" } };
    expect(processorPaymentNote(paid, "America/New_York")).toEqual({ text: "Waiting on customer since Oct 15", attention: true });
    expect(processorPaymentNote({ ...paid, board_status: "job_in_progress", ai_summary: { ...paid.ai_summary, job_update: "in_progress" } }, "America/New_York")).toBeNull();
    expect(processorPaymentNote({ ...paid, ai_summary: { ...summary, payment_error: true } }, "America/New_York")).toEqual({ text: "Customer chat not checked yet", attention: false });
  });
  it("marks the schedule overdue in the chosen timezone", () => {
    const at = new Date("2026-10-15T14:30:00Z");
    expect(processorSchedulePassed(job, "America/New_York", at)).toBe(true);
    expect(processorSchedulePassed(job, "America/Los_Angeles", at)).toBe(false);
  });
  it("keeps payment-recorded, cancelled and scammed jobs closed and flags bad tech numbers", () => {
    for (const status of ["paid", "partial_paid", "cancelled", "scammed"]) expect(processorReadiness({ ...job, status })).toContain("Closed job");
    for (const status of ["job_done", "payment_requested", "needs_reschedule"]) expect(processorReadiness({ ...job, status })).toBeNull();
    for (const number of [null, "415555019", "24155550199"]) expect(processorSetupIssue({ ...job, tech_number: number })).toContain("technician number");
    expect(processorSetupIssue({ ...job, tech_number: "+1 (415) 555-0199" })).toBeNull();
    expect(processorWorkflowMessage("payment_requested")).toContain("Payment approval pending");
  });
  it("loads every job with the AI status filter, with no paging parameters", async () => {
    invoke.mockResolvedValue({ data: { rows: [job], total: 1, all_total: 4, counts: { take_job_update: 1 }, observed_at: "2026-10-15T18:00:00Z", timezone: "America/New_York" }, error: null });
    await expect(fetchProcessorJobs({ search: "", timezone: "America/New_York", aiStatus: "wrong_tech_number" })).resolves.toMatchObject({ total: 1 });
    expect(invoke).toHaveBeenCalledWith("processor-board", expect.objectContaining({ body: { action: "list", search: "", timezone: "America/New_York", aiStatus: "wrong_tech_number" } }));
  });
  it("names the field it cannot read, never its value", async () => {
    invoke.mockResolvedValue({ data: { rows: [{ ...job, ai_stale: null, customer_name: "Secret Name" }], total: 1, all_total: 1, counts: {}, observed_at: "x", timezone: "America/New_York" }, error: null });
    const failure = fetchProcessorJobs({ search: "", timezone: "America/New_York", aiStatus: null });
    await expect(failure).rejects.toMatchObject({ code: "backend_version", retryable: false, message: expect.stringContaining("rows.0.ai_stale") });
    await expect(failure).rejects.not.toMatchObject({ message: expect.stringContaining("Secret Name") });
  });
  it("fetches one job's full review only on request", async () => {
    invoke.mockResolvedValue({ data: { result: fullFacts, checked_at: "x" }, error: null });
    await expect(fetchProcessorDetail(job.id)).resolves.toEqual(fullFacts);
    expect(invoke).toHaveBeenCalledWith("processor-board", expect.objectContaining({ body: { action: "detail", leadId: job.id } }));
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
  it("preserves the server's recovery classification for setup failures", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "Verify technician chat", code: "chat_setup", retryable: false }), { status: 422 }) } });
    await expect(assessProcessorJob(job.id, "America/New_York")).rejects.toMatchObject({ code: "chat_setup", retryable: false });
  });
});
