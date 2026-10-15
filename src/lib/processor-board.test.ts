import { describe, expect, it, vi } from "vitest";
import { canAccessNavItem } from "./access";
import { currentAssessment, processorStatus, fetchProcessorJobs, type ProcessorJob } from "./processor-board";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
const job: ProcessorJob = { id: "00000000-0000-4000-8000-000000000001", job_id: "JOB-1", customer_name: "John Sample", customer_phone: null, address: null, city: null, state: null, service_type: "Repair", tech_name: "Alex", tech_number: "4155550199", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, customer_schedule_requirements: null, terms: null, status: "scheduled", updated_at: "2026-10-15T10:00:00Z", checked_at: null, assessment: null };
const now = new Date("2026-10-15T18:00:00Z");
describe("Processor Board contract", () => {
  it.each(["admin", "processor", "customer_service", "cs_admin", "opr", "opr_admin"] as const)("enforces fixed role access for %s despite grants", (role) => {
    expect(canAccessNavItem(role, "processor_board", [{ id: "p", user_id: "u", nav_section: "processor_board", allowed: true }])).toBe(["admin", "processor"].includes(role));
  });
  it("derives schedule action without claiming AI reviewed the conversation", () => {
    expect(processorStatus(job, "America/New_York", now)).toBe("take_job_update");
    expect(currentAssessment(job, "America/New_York", now)).toBeNull();
  });
  it("retires old, changed-job and wrong-timezone AI evidence", () => {
    const reviewed = { ...job, assessment: { status: "payment_pending" as const, evidence: [], messages_reviewed: 4, matched_messages: 1, source: "mirror", history_complete: false, timezone: "America/New_York", checked_at: now.toISOString(), summary: "Reviewed", lead_updated_at: job.updated_at } };
    expect(processorStatus(reviewed, "America/New_York", now)).toBe("payment_pending");
    expect(processorStatus(reviewed, "America/Chicago", now)).toBe("take_job_update");
    expect(processorStatus({ ...reviewed, updated_at: now.toISOString() }, "America/New_York", now)).toBe("take_job_update");
    expect(processorStatus(reviewed, "America/New_York", new Date(now.getTime() + 300001))).toBe("take_job_update");
  });
  it("fails closed on invalid transport rather than rendering fabricated jobs", async () => {
    invoke.mockResolvedValue({ data: { rows: [{ customer_name: "invalid" }], total: 1 }, error: null });
    await expect(fetchProcessorJobs({ offset: 0, search: "", history: false, timezone: "America/New_York" })).rejects.toThrow();
  });
});
