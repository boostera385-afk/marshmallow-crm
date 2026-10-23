import { afterEach, describe, expect, it, vi } from "vitest";
import { canAccessNavItem } from "./access";
import { compatibleProcessorAssessment, currentAssessment, processorStatus, processorStatusOrigin, processorReviewMessage, processorWorkflowMessage, processorReadiness, assessProcessorJob, fetchProcessorJobs, type ProcessorJob } from "./processor-board";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "JOB-1", customer_name: "John Sample", customer_phone: null, address: null, city: null, state: null, service_type: "Repair", tech_name: "Alex", tech_number: "4155550199", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, customer_schedule_requirements: null, terms: null, status: "scheduled", updated_at: "2026-10-15T10:00:00Z", checked_at: null, assessment: null };
const now = new Date("2026-10-15T18:00:00Z");
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("Processor Board contract", () => {
  it.each(["2026-10-15", "2026-10-25"])("uses schedule %s, not a review blocker, for a legacy no-outcome result", (date) => {
    const reviewed: ProcessorJob = { ...job, scheduled_date: date, assessment: { status: "needs_review", review_reason: "no_verified_update", evidence: [], messages_reviewed: 4, matched_messages: 1, matched_technician_messages: 1, source: "Quo current history", history_complete: true, ai_used: true, timezone: "America/New_York", checked_at: now.toISOString(), summary: "No verified outcome", lead_updated_at: job.updated_at } };
    expect(processorStatus(reviewed, "America/New_York", now)).toBe(date === "2026-10-15" ? "take_job_update" : "scheduled");
    expect(processorReviewMessage(reviewed, "America/New_York", now)).toContain("not an AI-confirmed outcome");
    expect(processorStatusOrigin(reviewed, "America/New_York", now)).toBe("Schedule rule · AI found no verified job update");
    expect(processorStatus({ ...reviewed, assessment: { ...reviewed.assessment!, review_reason: "job_attribution" } }, "America/New_York", now)).toBe("needs_review");
    expect(processorStatus({ ...reviewed, assessment: { ...reviewed.assessment!, review_reason: "mirror_incomplete" } }, "America/New_York", now)).toBe("needs_review");
    expect(reviewed.status).toBe("scheduled");
  });
  it("retains a supported previous completion without treating it as a fresh check or a new assignment's result", () => {
    const reviewed: ProcessorJob = { ...job, checked_at: now.toISOString(), assessment: { status: "payment_pending", evidence: [{ signal: "completed", quote: "JOB-1 completed", message_id: "done", message_time: now.toISOString(), sender: "customer" }], messages_reviewed: 4, matched_messages: 1, source: "Quo current history", history_complete: true, ai_used: true, timezone: "America/New_York", checked_at: now.toISOString(), summary: "Verified", lead_updated_at: job.updated_at } };
    const later = new Date(now.getTime() + 300001);
    expect(currentAssessment(reviewed, "America/New_York", later)).toBeNull();
    expect(processorStatus(reviewed, "America/New_York", later)).toBe("payment_pending");
    expect(processorStatusOrigin(reviewed, "America/New_York", later)).toContain("Previous AI evidence");
    const reassigned = { ...reviewed, tech_number: "4155550188", updated_at: later.toISOString() };
    expect(compatibleProcessorAssessment(reassigned, "America/New_York")).toBeNull();
    expect(processorStatus(reassigned, "America/New_York", later)).toBe("needs_review");
    expect(processorReviewMessage(reassigned, "America/New_York", later)).toContain("assigned technician");
    expect(processorStatus(reviewed, "America/Chicago", later)).toBe("needs_review");
  });
  it("never keeps expired Send Dose actionable and rejects materially future checks", () => {
    const reviewed: ProcessorJob = { ...job, assessment: { status: "send_dose", evidence: [], messages_reviewed: 4, matched_messages: 1, source: "Quo current history", history_complete: true, ai_used: true, timezone: "America/New_York", checked_at: now.toISOString(), summary: "Unanswered request", lead_updated_at: job.updated_at } };
    expect(processorStatus(reviewed, "America/New_York", new Date(now.getTime()+300001))).toBe("needs_review");
    expect(currentAssessment({ ...reviewed, assessment: { ...reviewed.assessment!, checked_at: new Date(now.getTime()+60000).toISOString() } }, "America/New_York", now)).toBeNull();
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
  it.each(["admin", "processor", "customer_service", "cs_admin", "opr", "opr_admin"] as const)("enforces fixed role access for %s despite grants", (role) => {
    expect(canAccessNavItem(role, "processor_board", [{ id: "p", user_id: "u", nav_section: "processor_board", allowed: true }])).toBe(["admin", "processor"].includes(role));
  });
  it("derives schedule action without claiming AI reviewed the conversation", () => {
    expect(processorStatus(job, "America/New_York", now)).toBe("take_job_update");
    expect(currentAssessment(job, "America/New_York", now)).toBeNull();
  });
  it.each(["payment_pending", "partial_paid", "job_in_progress"])("does not regress saved %s from an older rule-only check", (status) => {
    const assessment: NonNullable<ProcessorJob["assessment"]> = { status: "take_job_update", evidence: [], messages_reviewed: 1, matched_messages: 0, source: "Quo current history", history_complete: true, ai_used: false, timezone: "America/New_York", checked_at: now.toISOString(), lead_updated_at: job.updated_at, summary: "No job update" };
    expect(processorStatus({ ...job, status, assessment }, "America/New_York", now)).toBe(status === "job_in_progress" ? status : "payment_pending");
  });
  it("keeps done/history and approval workflows read-only", () => {
    for (const status of ["job_done", "paid", "cancelled", "needs_reschedule", "payment_requested"]) {
      expect(processorStatus({ ...job, status }, "America/New_York", now)).toBe("needs_review");
      if (["job_done", "paid", "cancelled"].includes(status)) expect(processorReadiness({ ...job, status })).toContain("Closed job");
      else expect(processorReadiness({ ...job, status })).toBeNull();
    }
  });
  it("never describes saved progress as AI-confirmed when the AI found no verified update", () => {
    const assessment: NonNullable<ProcessorJob["assessment"]> = { status: "job_in_progress", evidence: [], messages_reviewed: 65, matched_messages: 3, source: "Quo current history", history_complete: true, ai_used: true, timezone: "America/New_York", checked_at: now.toISOString(), lead_updated_at: job.updated_at, summary: "No verified update" };
    expect(processorStatusOrigin({ ...job, status: "job_in_progress", assessment }, "America/New_York", now)).toBe("Saved lead status · AI found no verified job update");
    expect(processorStatusOrigin({ ...job, assessment: { ...assessment, status: "take_job_update" } }, "America/New_York", now)).toBe("Schedule rule · AI found no verified job update");
    expect(processorWorkflowMessage("needs_reschedule")).toContain("confirm the customer's new agreement");
    expect(processorWorkflowMessage("waiting_customer_response")).not.toContain("Closed");
  });
  it("retires old, changed-job and wrong-timezone AI evidence", () => {
    const reviewed = { ...job, assessment: { status: "payment_pending" as const, evidence: [], messages_reviewed: 4, matched_messages: 1, source: "mirror", history_complete: false, timezone: "America/New_York", checked_at: now.toISOString(), summary: "Reviewed", lead_updated_at: job.updated_at } };
    expect(processorStatus(reviewed, "America/New_York", now)).toBe("payment_pending");
    expect(processorStatus(reviewed, "America/Chicago", now)).toBe("needs_review");
    expect(processorStatus({ ...reviewed, updated_at: now.toISOString() }, "America/New_York", now)).toBe("needs_review");
    expect(processorStatus(reviewed, "America/New_York", new Date(now.getTime() + 300001))).toBe("take_job_update");
  });
  it("fails closed on invalid transport rather than rendering fabricated jobs", async () => {
    invoke.mockResolvedValue({ data: { rows: [{ customer_name: "invalid" }], total: 1 }, error: null });
    await expect(fetchProcessorJobs({ offset: 0, search: "", history: false, timezone: "America/New_York" })).rejects.toThrow();
  });
  it("turns resource-limit shutdowns into actionable errors even when the gateway supplies generic JSON", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "CPU Time exceeded" }), { status: 546 }) } });
    await expect(assessProcessorJob(job.id, "America/New_York")).rejects.toMatchObject({ code: "resource_limit", retryable: true, message: expect.stringContaining("server resource limit") });
  });
  it("preserves the server's recovery classification for setup and transient failures", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "Verify technician chat", code: "chat_setup", retryable: false }), { status: 422 }) } });
    await expect(assessProcessorJob(job.id, "America/New_York")).rejects.toMatchObject({ code: "chat_setup", retryable: false });
    expect(processorReadiness({ ...job, tech_number: null })).toContain("technician number");
    expect(processorReadiness({ ...job, scheduled_date: null })).toContain("agreed appointment");
    expect(processorReadiness(job)).toBeNull();
  });
});
