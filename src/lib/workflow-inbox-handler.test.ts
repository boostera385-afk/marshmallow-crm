import { describe, expect, it, vi } from "vitest";
import { createWorkflowInboxHandler } from "../../supabase/functions/_shared/workflow-inbox-handler";
const id = "00000000-0000-4000-8000-000000000001";
const request = (body: object) => new Request("https://synthetic.invalid", { method: "POST", body: JSON.stringify(body) });
describe("workflow inbox HTTP boundary", () => {
  it("requires a verified user before any RPC", async () => {
    const rpc = vi.fn();
    expect((await createWorkflowInboxHandler(async () => ({ userId: "", db: { rpc } }))(request({ area: "notifications", action: "list" }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ area: "notifications", action: "read" }, { area: "notifications", action: "open", notificationId: "invalid" },
    { area: "notifications", action: "alerts", after: "invalid" }, { area: "notifications", action: "read", ids: Array(101).fill(id) },
    { area: "schedule", action: "configure", mode: "automatic", reason: "" }, { area: "schedule", action: "execute_sql" }])("denies malformed request %j", async (body) => {
    const rpc = vi.fn(); expect((await createWorkflowInboxHandler(async () => ({ userId: id, db: { rpc } }))(request(body))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("never trusts caller identity or status fields", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const response = await createWorkflowInboxHandler(async () => ({ userId: id, db: { rpc } }))(request({ area: "notifications", action: "list", user_id: "someone-else", role: "admin", status: "paid", offset: 20 }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("workflow_notifications", { p_input: { action: "list", offset: 20 } });
  });
  it("maps server authorization denial without a false success", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "Admin only" } });
    expect((await createWorkflowInboxHandler(async () => ({ userId: id, db: { rpc } }))(request({ area: "schedule", action: "status" }))).status).toBe(403);
  });
});
