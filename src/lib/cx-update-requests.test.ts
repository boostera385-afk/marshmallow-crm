import { beforeEach, describe, expect, it, vi } from "vitest";
import { canAccessCxUpdates, canAccessNavItem, canCompleteCxUpdate, canCompleteTechUpdate, canRequestCxUpdate, canRequestTechUpdate } from "./access";
import { createCxRequest, completeCxRequest, fetchCxQueue, fetchCxCount, cxNotificationHref, createUpdateRequest, questionMoreUpdateRequest } from "./cx-update-requests";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
const id = "00000000-0000-4000-8000-000000000001";
export const syntheticCxRequest = {
  id, lead_id: "00000000-0000-4000-8000-000000000002", requested_by: "processor", requester_name: "Synthetic Processor",
  request_kind: "cx", recipient_cs: "cs", recipient_name: "Synthetic CS", request_text: "Confirm Friday availability", status: "pending", thread: [],
  response_text: null, completed_at: null, completed_by_name: null, created_at: "2026-10-13T00:00:00Z",
  customer: { job_id: "LD-CX-TEST", customer_name: "Synthetic Customer", customer_phone: "5550100000", customer_landline: null, customer_email: null,
    service_type: "Plumbing", service_details: "Synthetic repair", address: "10 Test St Apt 2", city: "Miami", state: "FL", zip_code: "33101",
    customer_schedule_requirements: "Friday afternoon", scheduled_date: "2026-10-16", scheduled_time_start: "13:00:00", scheduled_time_end: null },
};
beforeEach(() => invoke.mockReset());
describe("CX update role permissions", () => {
  it.each(["admin", "processor", "cs_admin", "customer_service"] as const)("grants the queue to %s with distinct request/completion access", (role) => {
    expect(canAccessCxUpdates(role)).toBe(true);
    expect(canAccessNavItem(role, "cx_updates", [{ id: "", user_id: "", nav_section: "cx_updates", allowed: false }])).toBe(true);
    expect(canRequestCxUpdate(role)).toBe(role === "admin" || role === "processor");
    expect(canCompleteCxUpdate(role)).toBe(role === "cs_admin" || role === "customer_service");
    expect(canRequestTechUpdate(role)).toBe(role === "cs_admin" || role === "customer_service");
    expect(canCompleteTechUpdate(role)).toBe(role === "processor");
  });
  it.each(["opr", "opr_admin", null, undefined] as const)("denies %s even with a navigation grant", (role) => {
    expect(canAccessNavItem(role, "cx_updates", [{ id: "", user_id: "", nav_section: "cx_updates", allowed: true }])).toBe(false);
    expect(canRequestCxUpdate(role)).toBe(false);
    expect(canCompleteCxUpdate(role)).toBe(false);
    expect(canRequestTechUpdate(role)).toBe(false);
    expect(canCompleteTechUpdate(role)).toBe(false);
  });
});
describe("CX customer-only API contract", () => {
  it("accepts an otherwise hidden lead without loading the full lead and strips unexpected technician fields", async () => {
    invoke.mockResolvedValue({ error: null, data: { rows: [{ ...syntheticCxRequest, tech_name: "PRIVATE", customer: { ...syntheticCxRequest.customer, tech_name: "PRIVATE", tech_number: "PRIVATE" } }], total: 1 } });
    const queue = await fetchCxQueue("pending", 20);
    expect(queue.rows[0].customer.address).toBe("10 Test St Apt 2");
    expect(JSON.stringify(queue)).not.toContain("PRIVATE");
    expect(invoke).toHaveBeenCalledWith("cx-update-requests", { body: { kind: "cx", action: "list_pending", offset: 20 } });
  });
  it("rejects malformed responses rather than showing an empty or successful queue", async () => {
    invoke.mockResolvedValue({ error: null, data: { rows: [{}], total: 1 } });
    await expect(fetchCxQueue("pending")).rejects.toThrow();
    invoke.mockResolvedValue({ error: null, data: {} });
    await expect(fetchCxCount()).rejects.toThrow();
  });
  it("sends request IDs and trimmed text, never job status or schedule changes", async () => {
    invoke.mockResolvedValue({ error: null, data: { saved: true, id } });
    await createCxRequest(syntheticCxRequest.lead_id, id, " Confirm Friday ");
    await completeCxRequest(id, " Friday confirmed ");
    await createUpdateRequest("tech", syntheticCxRequest.lead_id, id, " Check technician ");
    await questionMoreUpdateRequest("tech", id, " What time? ");
    expect(invoke.mock.calls.map((call) => call[1].body)).toEqual([
      { kind: "cx", action: "create", leadId: syntheticCxRequest.lead_id, requestId: id, text: "Confirm Friday" },
      { kind: "cx", action: "complete", requestId: id, text: "Friday confirmed" },
      { kind: "tech", action: "create", leadId: syntheticCxRequest.lead_id, requestId: id, text: "Check technician" },
      { kind: "tech", action: "question_more", requestId: id, text: "What time?" },
    ]);
  });
  it("preserves backend denial and failure without pretending save success", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "Assigned CS only" }), { status: 403 }) } });
    await expect(completeCxRequest(id, "Confirmed")).rejects.toThrow("Assigned CS only");
    invoke.mockResolvedValue({ error: null, data: { saved: false, id } });
    await expect(createCxRequest(syntheticCxRequest.lead_id, id, "Confirm")).rejects.toThrow();
  });
  it("links notifications to the queue rather than an inaccessible full lead", () => {
    expect(cxNotificationHref("Get CX Update")).toBe("/get-cx-update");
    expect(cxNotificationHref("CS Updated")).toBe("/get-cx-update?tab=updated");
    expect(cxNotificationHref("Get Tech Update")).toBe("/get-tech-update");
    expect(cxNotificationHref("Tech Updated")).toBe("/get-tech-update?tab=updated");
    expect(cxNotificationHref("Lead Assigned")).toBeNull();
  });
});
