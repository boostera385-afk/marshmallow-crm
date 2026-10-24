import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCopilotHandler, type CopilotServices } from "../../supabase/functions/_shared/copilot-handler";
import type { CopilotAccess } from "../../supabase/functions/_shared/copilot-core";
import { CopilotProviderError } from "../../supabase/functions/_shared/copilot-provider";
const id = "00000000-0000-4000-8000-000000000001";
let access: CopilotAccess;
const db = { rpc: vi.fn() };
const budget = { rpc: vi.fn() };
const generate = vi.fn();
const authenticate = vi.fn();
const aiConfigured = vi.fn();
const services: CopilotServices = { enabled: true, authenticate, budgetDb: () => budget, aiConfigured, generate };
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
  it.each(["access", "ask", "settings", "configure", "set_permission", "diagnostics", "test_ai"])("blocks %s during the release pause without CRM or AI work", async (action) => {
    const paused = createCopilotHandler({ ...services, enabled: false });
    const response = await paused(request({ action, message: "find MM-101", allowAi: true, confirmed: true }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "copilot_paused" });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(db.rpc).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
    expect(aiConfigured).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it("retains authentication failures while paused", async () => {
    authenticate.mockResolvedValue({ userId: "", db });
    const paused = createCopilotHandler({ ...services, enabled: false });
    expect((await paused(ask("hello"))).status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it("reduces the same synthetic search from three CRM RPCs to zero during pause", async () => {
    expect((await handle(ask("find lead MM-101"))).status).toBe(200);
    expect(db.rpc.mock.calls.map((call) => call[0])).toEqual(["copilot_get_access", "copilot_search", "copilot_get_access"]);
    db.rpc.mockClear(); authenticate.mockClear();
    const paused = createCopilotHandler({ ...services, enabled: false });
    expect((await paused(ask("find lead MM-101"))).status).toBe(503);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(db.rpc).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it.each(["admin", "processor"] as const)("opens Processor Board help for %s with no AI or assessment request", async (role) => {
    access.role = role; access.sections.push("processor_board", "cx_updates");
    const response = await handle(ask("open Processor Board", { allowAi: true }));
    expect(await response.json()).toMatchObject({ source: "crm", aiUsed: false, cards: [{ title: "Processor Board", href: "/processor-board" }] });
    expect(db.rpc.mock.calls.map((call) => call[0])).toEqual(["copilot_get_access", "copilot_get_access"]);
    expect(generate).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
  });
  it.each(["opr", "opr_admin", "customer_service", "cs_admin"] as const)("does not expose Processor Board to %s", async (role) => {
    access.role = role; access.sections = ["leads", "processor_board"];
    const response = await handle(ask("Processor Board", { allowAi: true }));
    expect(await response.json()).toMatchObject({ source: "crm", links: [], cards: [] });
    expect(generate).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
  });
  it("explains Tech Update and Donut deterministically without running either workflow", async () => {
    access.role = "customer_service"; access.sections = ["leads", "cx_updates"];
    expect(await (await handle(ask("Get Tech Update", { allowAi: true }))).json()).toMatchObject({ cards: [{ title: "Get Tech Update", href: "/get-tech-update" }] });
    expect(await (await handle(ask("update Donut", { allowAi: true }))).json()).toMatchObject({ cards: [{ title: "Donut extension guide", href: "/leads", subtitle: expect.stringContaining("Installation is manual") }] });
    expect(db.rpc.mock.calls.map((call) => call[0])).toEqual(Array(4).fill("copilot_get_access"));
    expect(generate).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
  });
  it("does not invent feature access or call AI when the access lookup fails", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "Synthetic database failure" } });
    expect((await handle(ask("Processor Board", { allowAi: true }))).status).toBe(503);
    expect(generate).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
  });
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
  it("reserves before a single model call and records usage", async () => {
    const response = await handle(ask("what is a heat pump?", { allowAi: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "ai", aiUsed: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith("what is a heat pump?", expect.stringContaining("crmGuide"));
    expect(budget.rpc).toHaveBeenNthCalledWith(1, "copilot_reserve_ai", { p_user_id: id, p_request_id: id });
    expect(budget.rpc).toHaveBeenNthCalledWith(2, "copilot_finish_ai", { p_request_id: id, p_input: 100, p_output: 40, p_success: true });
  });
  it("labels AI routing honestly and still queries the caller's RLS-scoped client", async () => {
    generate.mockResolvedValue({ kind: "leads", query: "MM-101", text: "", inputTokens: 100, outputTokens: 40 });
    const response = await handle(ask("lookup this reference please", { allowAi: true }));
    expect(await response.json()).toMatchObject({ source: "crm", aiUsed: true, searchQuery: "MM-101" });
    expect(db.rpc).toHaveBeenCalledWith("copilot_search", expect.objectContaining({ p_query: "MM-101" }));
    expect(budget.rpc.mock.calls.some((call) => call[0] === "copilot_search")).toBe(false);
  });
  it("does not call OpenAI when reservation fails", async () => {
    budget.rpc.mockResolvedValue({ data: null, error: { message: "Monthly AI budget reached; CRM tools remain available" } });
    expect((await handle(ask("what is a heat pump?", { allowAi: true }))).status).toBe(429);
    expect(generate).not.toHaveBeenCalled();
  });
  it("enforces daily-cap rejection before calling the provider", async () => {
    budget.rpc.mockResolvedValue({ data: null, error: { message: "Daily AI limit reached; CRM tools remain available" } });
    expect((await handle(ask("what is a heat pump?", { allowAi: true }))).status).toBe(429);
    expect(generate).not.toHaveBeenCalled();
  });
  it("records unknown failures without retries or invented zero-token outcomes", async () => {
    generate.mockRejectedValue(new Error("network failed"));
    const response = await handle(ask("what is a heat pump?", { allowAi: true }));
    expect(response.status).toBe(503);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(budget.rpc).toHaveBeenLastCalledWith("copilot_finish_ai", { p_request_id: id, p_input: null, p_output: null, p_success: false });
  });
  it("discards late results when access is revoked", async () => {
    generate.mockImplementation(async () => { access.allowed = false; return { kind: "answer", query: "", text: "discard me", inputTokens: 100, outputTokens: 30 }; });
    const response = await handle(ask("what is a heat pump?", { allowAi: true }));
    expect(response.status).toBe(403); expect(JSON.stringify(await response.json())).not.toContain("discard me");
  });
  it("discards a paid answer if Admin disables AI while the call is in flight", async () => {
    generate.mockImplementation(async () => { access.aiEnabled = false; return { kind: "answer", query: "", text: "discard AI answer", inputTokens: 100, outputTokens: 30 }; });
    const response = await handle(ask("what is a heat pump?", { allowAi: true }));
    expect(response.status).toBe(403); expect(JSON.stringify(await response.json())).not.toContain("discard AI answer");
    expect(budget.rpc).toHaveBeenLastCalledWith("copilot_finish_ai", expect.objectContaining({ p_success: true }));
  });
  it("uses only aggregate metrics for report explanations, never saved customer fields", async () => {
    db.rpc.mockImplementation(async (name) => ({ data: name === "copilot_get_access" ? access : name === "copilot_report" ? {
      start: "2026-03-08", end: "2026-03-08", timezone: "America/New_York", metrics: { created: 2, latestEdits: 1, scheduled: null, urgent: 1, incomplete: 0, needTech: 0, followups: 0 },
      unexpectedCustomer: "PRIVATE CUSTOMER DATA",
    } : null, error: null }));
    const response = await handle(ask("Explain my work report", { allowAi: true }));
    expect(response.status).toBe(200);
    expect(generate.mock.calls[0][1]).toContain("Leads created in range");
    expect(generate.mock.calls[0][1]).not.toContain("PRIVATE CUSTOMER DATA");
  });
  it("does not send a rejected team report to the model", async () => {
    db.rpc.mockImplementation(async (name) => name === "copilot_report" ? { data: null, error: { code: "42501", message: "Admin only" } } : { data: access, error: null });
    expect((await handle(ask("Explain team work report", { allowAi: true }))).status).toBe(403);
    expect(generate).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
  });
  it("redacts CS Admin technician fields defensively and limits cards to ten", async () => {
    access.role = "cs_admin";
    db.rpc.mockImplementation(async (name) => ({ data: name === "copilot_get_access" ? access : Array.from({ length: 11 }, (_, i) => ({ id, job_id: `MM-${i}`, customer_name: "Synthetic", quote: null, tech_name: "PRIVATE TECH", tech_number: "SECRET NUMBER", address: "10 Main St Apt 2" })), error: null }));
    const response = await handle(ask("find leads")); const data = await response.json();
    expect(data.cards).toHaveLength(10); expect(data.hasMore).toBe(true);
    expect(JSON.stringify(data)).not.toContain("PRIVATE TECH"); expect(JSON.stringify(data)).not.toContain("SECRET NUMBER");
    expect(data.cards[0].fields).toContainEqual({ label: "Address", value: "10 Main St Apt 2" });
  });
  it("acknowledges persisted permission writes without a fallible post-save read", async () => {
    const response = await handle(request({ action: "set_permission", role: "opr", userId: null, allowed: true }));
    expect(await response.json()).toEqual({ saved: true });
    expect(db.rpc.mock.calls.map((call) => call[0])).toEqual(["copilot_get_settings", "copilot_set_permission"]);
  });
  it("saves Admin AI configuration through the caller-authorized RPC", async () => {
    const config = { enabled: true, ai_enabled: true, monthly_budget_cents: 425, daily_ai_limit: 3, timezone: "America/New_York" };
    const response = await handle(request({ action: "configure", config }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ saved: true });
    expect(db.rpc).toHaveBeenLastCalledWith("copilot_configure", { p_enabled: true, p_ai_enabled: true, p_monthly_budget_cents: 425, p_daily_ai_limit: 3, p_timezone: "America/New_York" });
    expect(budget.rpc).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it.each(["settings", "configure", "set_permission", "diagnostics", "test_ai"])("rejects non-admin %s calls before administrative changes", async (action) => {
    access.role = "customer_service";
    db.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Only Admin may manage Copilot" } });
    const response = await handle(request({ action, config: { enabled: true, ai_enabled: true, monthly_budget_cents: 1000, daily_ai_limit: 20, timezone: "America/New_York" }, role: "opr", userId: null, allowed: true }));
    expect(response.status).toBe(403); expect(db.rpc.mock.calls.map((call) => call[0])).toEqual(["copilot_get_settings"]);
    expect(generate).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
  });
  it.each([{ monthly_budget_cents: -1 }, { monthly_budget_cents: 100001 }, { monthly_budget_cents: 1.5 }, { daily_ai_limit: -1 }, { daily_ai_limit: 101 }, { daily_ai_limit: 1.5 }])("rejects invalid AI limits: %j", async (invalid) => {
    const config = { enabled: true, ai_enabled: true, monthly_budget_cents: 1000, daily_ai_limit: 20, timezone: "America/New_York", ...invalid };
    expect((await handle(request({ action: "configure", config }))).status).toBe(400);
    expect(db.rpc.mock.calls.map((call) => call[0])).toEqual(["copilot_get_settings"]);
  });
  it("reports installation blockers, not empty successful search results", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "function does not exist" } });
    const response = await handle(ask("MM-101"));
    expect(response.status).toBe(503); expect((await response.json()).error).toContain("not installed yet");
  });
  it.each([[false, true, true, "ai_disabled"], [true, false, true, "consent_required"], [true, true, false, "key_missing"]])("distinguishes saved AI enablement, consent and missing key", async (enabled, consent, key, noticeCode) => {
    access.aiEnabled = enabled; aiConfigured.mockReturnValue(key);
    expect(await (await handle(ask("What is a heat pump?", { allowAi: consent }))).json()).toMatchObject({ noticeCode });
    expect(generate).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
  });
  it("requires Admin authorization and confirmation for a provider test", async () => {
    expect((await handle(request({ action: "test_ai", requestId: id }))).status).toBe(400); expect(generate).not.toHaveBeenCalled();
    expect((await handle(request({ action: "test_ai", requestId: id, confirmed: true }))).status).toBe(200); expect(generate).toHaveBeenCalledTimes(1);
  });
  it("ignores extra customer context on the fixed nonsensitive provider test", async () => {
    expect((await handle(request({ action: "test_ai", requestId: id, confirmed: true, selectedLeadId: id, conversation: [{ question: "PRIVATE", answer: "PRIVATE" }] }))).status).toBe(200);
    expect(generate.mock.calls[0][2]).toBeUndefined(); expect(JSON.stringify(generate.mock.calls[0])).not.toContain("PRIVATE");
    expect(db.rpc.mock.calls.some((call) => call[0] === "copilot_lead_brief")).toBe(false);
  });
  it("returns stale settings conflict without saving", async () => {
    db.rpc.mockImplementation(async (name) => ({ data: null, error: name === "copilot_configure_checked" ? { code: "40001", message: "stale" } : null }));
    const response = await handle(request({ action: "configure", config: { enabled: true, ai_enabled: true, monthly_budget_cents: 1000, daily_ai_limit: 20, timezone: "UTC" }, expected: {} }));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "config_conflict" });
  });
  it("returns an exact saved brief or an indistinguishable unavailable outcome", async () => {
    const missing = await handle(ask("this lead", { selectedLeadId: id })); expect(missing.status).toBe(404);
    db.rpc.mockImplementation(async (name) => ({ data: name === "copilot_get_access" ? access : { id, job_id: "MM-101", customer_name: "Synthetic", address: "10 Test St Apt 2", status: "urgent_job", quote: null }, error: null }));
    const response = await handle(ask("this lead", { selectedLeadId: id }));
    const result = await response.json(); expect(result.text).toContain("Missing saved information"); expect(result.text).toContain("not an urgent-verification");
    expect(result.cards[0].fields).toContainEqual({ label: "Address", value: "10 Test St Apt 2" }); expect(generate).not.toHaveBeenCalled();
  });
  it("drafts with fresh minimal selected context, never customer data or hidden quote", async () => {
    db.rpc.mockImplementation(async (name) => ({ data: name === "copilot_get_access" ? access : { id, service_type: "Plumbing", status: "urgent_job", address: "PRIVATE ADDRESS", customer_name: "PRIVATE NAME", quote: "PRIVATE QUOTE", customer_schedule_requirements: "PRIVATE SCHEDULE" }, error: null }));
    const response = await handle(ask("Draft a message to send to the customer", { allowAi: true, selectedLeadId: id })); expect(response.status).toBe(200);
    expect(generate.mock.calls[0][1]).toContain("Plumbing"); expect(generate.mock.calls[0][1]).not.toContain("PRIVATE");
    expect(budget.rpc.mock.calls.every((c) => ["copilot_reserve_ai", "copilot_finish_ai"].includes(c[0]))).toBe(true);
  });
  it("does not call AI or reserve allowance for an inaccessible selected lead", async () => {
    expect((await handle(ask("Draft a follow-up", { allowAi: true, selectedLeadId: id }))).status).toBe(404);
    expect(generate).not.toHaveBeenCalled(); expect(budget.rpc).not.toHaveBeenCalled();
  });
  it("returns safe provider code and metadata without leaking provider text", async () => {
    generate.mockRejectedValue(new CopilotProviderError("provider_billing", "Check provider billing", 429));
    const response = await handle(ask("What is a heat pump?", { allowAi: true })); expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "provider_billing", requestId: id });
  });
  it("keeps a successful AI answer when usage finalization fails", async () => {
    budget.rpc.mockImplementation(async (name) => ({ data: null, error: name === "copilot_finish_ai" ? { message: "ledger temporarily unavailable" } : null }));
    const response = await handle(ask("What is a heat pump?", { allowAi: true })); expect(response.status).toBe(200); expect((await response.json()).text).toContain("transfers heat"); expect(generate).toHaveBeenCalledTimes(1);
  });
  it("runs clarification without AI even when consent is enabled", async () => {
    expect(await (await handle(ask("only tomorrow", { allowAi: true }))).json()).toMatchObject({ resolvedIntent: "clarify", aiUsed: false }); expect(generate).not.toHaveBeenCalled();
  });
  it("keeps requested report dates and scope for a conversational explanation", async () => {
    db.rpc.mockImplementation(async (name, args) => ({ data: name === "copilot_get_access" ? access : { start: args.p_start, end: args.p_end, timezone: "America/New_York", metrics: {} }, error: null }));
    const response = await handle(ask("explain that", { allowAi: true, previous: { intent: "report", start: "2026-10-01", end: "2026-10-07", scope: "team" } }));
    expect(response.status).toBe(200); expect((await response.json()).followup).toMatchObject({ intent: "report", start: "2026-10-01", end: "2026-10-07", scope: "team" });
    expect(db.rpc).toHaveBeenCalledWith("copilot_report", { p_start: "2026-10-01", p_end: "2026-10-07", p_scope: "team" }); expect(generate.mock.calls[0][1]).toContain("2026-10-01 to 2026-10-07");
  });
});
