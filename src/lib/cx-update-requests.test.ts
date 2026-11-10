import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCxUpdateHandler } from "../../supabase/functions/_shared/cx-update-handler";
import { canAccessCxUpdates, canAccessNavItem, canCompleteCxUpdate, canCompleteTechUpdate, canRequestCxUpdate, canRequestTechUpdate } from "./access";
import {
  createCxRequest, completeCxRequest, fetchCxQueue, fetchCxCount, cxNotificationHref, createUpdateRequest, questionMoreUpdateRequest,
  acknowledgeUpdateRequest, reassignUpdateRequest, fetchUpdateCounts, fetchUpdateRequest, fetchResolutionOwners, UPDATE_RETRY_DELAY_MS,
} from "./cx-update-requests";
const { invoke, rpc } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke }, rpc } }));
const ok = (data: unknown) => ({ data, error: null, status: 200 });
const rpcError = (status: number, code: string, message: string) => ({ data: null, status, error: { code, message } });
const id = "00000000-0000-4000-8000-000000000001";
export const syntheticCxRequest = {
  id, lead_id: "00000000-0000-4000-8000-000000000002", requested_by: "processor", requester_name: "Synthetic Processor",
  request_kind: "cx", recipient_cs: "cs", recipient_name: "Synthetic CS", request_text: "Confirm Friday availability", status: "pending", thread: [],
  response_text: null, completed_at: null, completed_by_name: null, created_at: "2026-10-13T00:00:00Z",
  revision: 1, resolution_owner: "processor", owner_name: "Synthetic Processor", acknowledged_at: null, resolved_by_name: null,
  customer: { job_id: "LD-CX-TEST", customer_name: "Synthetic Customer", customer_phone: "5550100000", customer_landline: null, customer_email: null,
    service_type: "Plumbing", service_details: "Synthetic repair", address: "10 Test St Apt 2", city: "Miami", state: "FL", zip_code: "33101",
    customer_schedule_requirements: "Friday afternoon", scheduled_date: "2026-10-16", scheduled_time_start: "13:00:00", scheduled_time_end: null },
};
beforeEach(() => { invoke.mockReset(); rpc.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
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
    rpc.mockResolvedValue(ok({ rows: [{ ...syntheticCxRequest, tech_name: "PRIVATE", customer: { ...syntheticCxRequest.customer, tech_name: "PRIVATE", tech_number: "PRIVATE" } }], total: 1 }));
    const queue = await fetchCxQueue("pending", 20);
    expect(queue.rows[0].customer.address).toBe("10 Test St Apt 2");
    expect(JSON.stringify(queue)).not.toContain("PRIVATE");
    expect(rpc).toHaveBeenCalledWith("workflow_requests", { p_input: {
      kind: "cx", action: "list_pending", leadId: null, requestId: null, text: null, offset: 20, revision: null, ownerId: null,
    } });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects malformed responses rather than showing an empty or successful queue", async () => {
    rpc.mockResolvedValue(ok({ rows: [{}], total: 1 }));
    await expect(fetchCxQueue("pending")).rejects.toThrow();
    rpc.mockResolvedValue(ok({}));
    await expect(fetchCxCount()).rejects.toThrow();
  });
  it("sends request IDs and trimmed text, never job status or schedule changes", async () => {
    rpc.mockResolvedValue(ok({ saved: true, id }));
    await createCxRequest(syntheticCxRequest.lead_id, id, " Confirm Friday ");
    await completeCxRequest(id, " Friday confirmed ", 1);
    await createUpdateRequest("tech", syntheticCxRequest.lead_id, id, " Check technician ");
    await questionMoreUpdateRequest("tech", id, " What time? ", 2);
    const base = { leadId: null, requestId: null, text: null, offset: 0, revision: null, ownerId: null };
    expect(rpc.mock.calls.map((call) => call[1].p_input)).toEqual([
      { ...base, kind: "cx", action: "create", leadId: syntheticCxRequest.lead_id, requestId: id, text: "Confirm Friday" },
      { ...base, kind: "cx", action: "complete", requestId: id, text: "Friday confirmed", revision: 1 },
      { ...base, kind: "tech", action: "create", leadId: syntheticCxRequest.lead_id, requestId: id, text: "Check technician" },
      { ...base, kind: "tech", action: "question_more", requestId: id, text: "What time?", revision: 2 },
    ]);
  });
  it("preserves backend denial and failure without pretending save success", async () => {
    rpc.mockResolvedValue(rpcError(403, "42501", "Your role cannot answer this request"));
    await expect(completeCxRequest(id, "Confirmed", 1)).rejects.toThrow("Your role cannot answer this request");
    rpc.mockResolvedValue(ok({ saved: false, id }));
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

describe("CX/Tech updates call the database function directly", () => {
  // The browser used to POST these bodies to the cx-update-requests Edge Function,
  // which validated them and forwarded p_input to workflow_requests. The direct
  // call must forward exactly the same p_input for every action.
  const leadId = "00000000-0000-4000-8000-000000000002";
  const ownerId = "00000000-0000-4000-8000-000000000003";
  const calls: [string, () => Promise<unknown>, object][] = [
    ["list", () => fetchCxQueue("cs_updated", 40), { kind: "cx", action: "list_updated", offset: 40 }],
    ["get", () => fetchUpdateRequest("tech", id), { kind: "tech", action: "get", requestId: id }],
    ["counts", () => fetchUpdateCounts(), { kind: "cx", action: "counts" }],
    ["owners", () => fetchResolutionOwners("tech"), { kind: "tech", action: "owners" }],
    ["count", () => fetchCxCount(), { kind: "cx", action: "count" }],
    ["create", () => createCxRequest(leadId, id, " Confirm "), { kind: "cx", action: "create", leadId, requestId: id, text: "Confirm" }],
    ["complete", () => completeCxRequest(id, " Done ", 3), { kind: "cx", action: "complete", requestId: id, text: "Done", revision: 3 }],
    ["resolve", () => acknowledgeUpdateRequest("tech", id, 4), { kind: "tech", action: "resolve", requestId: id, revision: 4 }],
    ["question", () => questionMoreUpdateRequest("cx", id, " When? ", 5), { kind: "cx", action: "question_more", requestId: id, text: "When?", revision: 5 }],
    ["reassign", () => reassignUpdateRequest("tech", id, ownerId, " On leave ", 6), { kind: "tech", action: "reassign", requestId: id, ownerId, text: "On leave", revision: 6 }],
  ];

  it.each(calls)("%s sends the same p_input the Edge Function forwarded, without calling it", async (_name, run, edgeBody) => {
    const handlerRpc = vi.fn(async () => ({ data: {}, error: null }));
    const handler = createCxUpdateHandler(async () => ({ userId: "synthetic-user", db: { rpc: handlerRpc } }));
    await handler(new Request("https://synthetic.invalid/cx", { method: "POST", body: JSON.stringify(edgeBody) }));
    const forwardedByEdge = (handlerRpc.mock.calls[0] as unknown[])[1];

    rpc.mockResolvedValue(ok({ rows: [], total: 0, cx: 0, tech: 0, owners: [], count: 0, saved: true, id }));
    await run().catch(() => undefined); // response shapes differ per action; only the request matters here
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(["workflow_requests", forwardedByEdge]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("retries once when the API is briefly unavailable, then succeeds", async () => {
    vi.useFakeTimers();
    rpc.mockResolvedValueOnce(rpcError(503, "PGRST002", "Could not query the database")).mockResolvedValueOnce(ok({ count: 2 }));
    const pending = fetchCxCount();
    await vi.advanceTimersByTimeAsync(UPDATE_RETRY_DELAY_MS);
    await expect(pending).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does not retry a save that the database rejected, and shows its message", async () => {
    for (const [code, message] of [["23505", "Another request is awaiting a response"], ["40001", "This request changed. Refresh before saving."], ["22023", "Enter an update (1–4000 characters)"]]) {
      rpc.mockReset();
      rpc.mockResolvedValue(rpcError(code === "40001" ? 409 : 400, code, message));
      await expect(completeCxRequest(id, "Done", 1)).rejects.toThrow(message);
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("hides internal database errors behind a short message with the code", async () => {
    rpc.mockResolvedValue(rpcError(500, "XX000", "internal detail with table names"));
    await expect(fetchCxCount()).rejects.toThrow("Update requests are unavailable (code XX000). Try again shortly.");
    await expect(fetchCxCount()).rejects.not.toThrow("internal detail");
  });

  it("stops a malformed call before any request, as the Edge Function did", async () => {
    await expect(createCxRequest("not-a-uuid", id, "Confirm")).rejects.toThrow("Invalid request fields");
    await expect(completeCxRequest(id, "   ", 1)).rejects.toThrow("Refresh the page");
    await expect(createCxRequest(leadId, id, "x".repeat(2001))).rejects.toThrow("Refresh the page");
    expect(rpc).not.toHaveBeenCalled();
  });
});
