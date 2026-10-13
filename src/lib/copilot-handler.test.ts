import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCopilotHandler, type CopilotServices } from "../../supabase/functions/_shared/copilot-handler";
import type { CopilotAccess } from "../../supabase/functions/_shared/copilot-core";
const id = "00000000-0000-4000-8000-000000000001";
let access: CopilotAccess;
const db = { rpc: vi.fn() };
const budget = { rpc: vi.fn() };
const generate = vi.fn();
const authenticate = vi.fn();
const aiConfigured = vi.fn();
const services: CopilotServices = { authenticate, budgetDb: () => budget, aiConfigured, generate };
const handle = createCopilotHandler(services);
const request = (body: object) => new Request("https://synthetic.invalid/copilot", { method: "POST", body: JSON.stringify(body) });
const ask = (message: string, extra = {}) => request({ action: "ask", message, requestId: id, allowAi: false, ...extra });
beforeEach(() => {
  vi.resetAllMocks();
  aiConfigured.mockReturnValue(true);
  access = { allowed: true, aiEnabled: true, role: "admin", timezone: "America/New_York", sections: ["leads", "schedule", "technicians", "settings"] };
  authenticate.mockResolvedValue({ userId: id, db });
  db.rpc.mockImplementation(async (name) => ({ data: name === "copilot_get_access" ? { ...access } : name === "copilot_search" ? [] : name === "copilot_get_settings" ? { config: {} } : null, error: null }));
  budget.rpc.mockResolvedValue({ data: null, error: null });
  generate.mockResolvedValue({ kind: "answer", query: "", text: "A heat pump transfers heat.", inputTokens: 100, outputTokens: 40 });
});
describe("authenticated Copilot handler", () => {
  it("requires authentication before any database tool or provider request", async () => {
    authenticate.mockResolvedValue({ userId: "", db });
    expect((await handle(ask("hello"))).status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it("supports CORS preflight and rejects other methods", async () => {
    expect((await handle(new Request("https://synthetic.invalid", { method: "OPTIONS" }))).status).toBe(200);
    expect((await handle(new Request("https://synthetic.invalid"))).status).toBe(405);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("denies direct calls when the caller is excluded", async () => {
    access.allowed = false;
    expect((await handle(ask("MM-101"))).status).toBe(403);
    expect(db.rpc.mock.calls.map((call) => call[0])).toEqual(["copilot_get_access"]);
    expect(generate).not.toHaveBeenCalled();
  });
  it("runs deterministic saved-record queries without AI or paid reservations", async () => {
    const response = await handle(ask("find lead MM-101", { allowAi: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "crm", aiUsed: false, cards: [] });
    expect(db.rpc).toHaveBeenCalledWith("copilot_search", expect.objectContaining({ p_kind: "leads", p_query: "MM-101", p_offset: 0 }));
    expect(generate).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
  });
  it("blocks a mutation even when the client supplies a different intent", async () => {
    const response = await handle(ask("approve paid MM-101", { intent: "ai", allowAi: true }));
    expect(await response.json()).toMatchObject({ resolvedIntent: "blocked", title: "Read-only assistant" });
    expect(generate).not.toHaveBeenCalled();
  });
  it("never bypasses a database navigation denial", async () => {
    db.rpc.mockImplementation(async (name) => name === "copilot_search" ? { data: null, error: { code: "42501", message: "no access" } } : { data: access, error: null });
    expect((await handle(ask("find technician Alice"))).status).toBe(403);
    expect(budget.rpc).not.toHaveBeenCalled();
  });
  it("keeps AI optional and provides deterministic alternatives when disabled", async () => {
    access.aiEnabled = false;
    const response = await handle(ask("what is a heat pump?", { allowAi: true }));
    expect(await response.json()).toMatchObject({ source: "crm", title: "CRM tools remain available" });
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not reserve or call the provider without explicit user consent", async () => {
    const response = await handle(ask("what is a heat pump?"));
    expect(await response.json()).toMatchObject({ source: "crm", title: "CRM tools remain available" });
    expect(generate).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
  });
  it("uses no allowance when the server-side OpenAI key is missing", async () => {
    aiConfigured.mockReturnValue(false);
    const response = await handle(ask("what is a heat pump?", { allowAi: true }));
    expect(await response.json()).toMatchObject({ source: "crm", title: "CRM tools remain available" });
    expect(generate).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
  });
  it("permits optional AI for an allowed non-admin without using privileged CRM reads", async () => {
    access.role = "customer_service"; access.sections = ["leads"];
    const response = await handle(ask("what is a heat pump?", { allowAi: true }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ source: "ai", aiUsed: true });
    expect(budget.rpc.mock.calls.map((call) => call[0])).toEqual(["copilot_reserve_ai", "copilot_finish_ai"]);
  });
});
