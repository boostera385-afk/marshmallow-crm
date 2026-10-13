import { describe, expect, it, vi } from "vitest";
import { createCxUpdateHandler } from "../../supabase/functions/_shared/cx-update-handler";
const id = "00000000-0000-4000-8000-000000000001";
const request = (body: object) => new Request("https://synthetic.invalid/cx", { method: "POST", body: JSON.stringify(body) });
describe("CX Edge Function boundary", () => {
  it("refuses unauthenticated calls before any RPC", async () => {
    const rpc = vi.fn();
    const handler = createCxUpdateHandler(async () => ({ userId: "", db: { rpc } }));
    expect((await handler(request({ action: "count" }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("forwards only whitelisted arguments, ignoring client role and technician payloads", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { saved: true, id }, error: null });
    const handler = createCxUpdateHandler(async () => ({ userId: id, db: { rpc } }));
    expect((await handler(request({ action: "create", leadId: id, requestId: id, text: "Confirm", role: "admin", status: "paid", tech_name: "private" }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("cx_update_requests", { p_action: "create", p_lead_id: id, p_request_id: id, p_text: "Confirm", p_offset: 0 });
  });
  it.each([{ action: "execute_sql" }, { action: "complete", requestId: id, text: " " }, { action: "list_pending", offset: -1 }, { action: "create", leadId: "invalid", requestId: id, text: "Confirm" }, { action: "complete", requestId: id, text: "x".repeat(4001) }])("rejects invalid input %j without RPC", async (body) => {
    const rpc = vi.fn();
    const handler = createCxUpdateHandler(async () => ({ userId: id, db: { rpc } }));
    expect((await handler(request(body))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["23505", 409], ["40001", 409], ["22023", 400], ["PGRST202", 503]])("maps backend %s to %s", async (code, status) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: "Synthetic denial" } });
    const handler = createCxUpdateHandler(async () => ({ userId: id, db: { rpc } }));
    expect((await handler(request({ action: "count" }))).status).toBe(status);
  });
});
