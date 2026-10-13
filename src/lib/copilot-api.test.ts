import { beforeEach, describe, expect, it, vi } from "vitest";
import { askCopilot, configureCopilot, fetchCopilotAccess, safeCopilotHref } from "./copilot-api";
import { accessibleFeatures, businessDate, emptyCopilotResult, parseCopilotAsk, reportRange, resolveCopilotAccess, routeCopilotMessage } from "../../supabase/functions/_shared/copilot-core";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => invoke.mockReset());
describe("Copilot permissions and deterministic routing", () => {
  it("defaults to denied and keeps grants independent of underlying features", () => {
    expect(resolveCopilotAccess("opr", true)).toBe(false);
    expect(resolveCopilotAccess("opr", true, true, false)).toBe(false);
    expect(resolveCopilotAccess("opr", true, false, true)).toBe(true);
    expect(resolveCopilotAccess("admin", false, true, true)).toBe(false);
    expect(resolveCopilotAccess(null, true, true, true)).toBe(false);
    expect(accessibleFeatures({ allowed: true, aiEnabled: false, role: "opr", timezone: "UTC", sections: ["leads"] }).map((f) => f.id)).toEqual(["leads"]);
  });
  it.each([
    ["MM-101", "leads", "MM-101"], ["find lead 5550100000", "leads", "5550100000"],
    ["find technician Alice", "technicians", "Alice"], ["my daily report", "report", "my daily report"],
    ["what needs attention?", "attention", ""], ["open quote approval", "help", "open quote approval"],
    ["show features", "features", ""], ["check system health", "health", ""],
    ["approve paid MM-101", "blocked", "approve paid MM-101"], ["write a draft for the customer", "ai", "write a draft for the customer"],
    ["what is a heat pump?", "ai", "what is a heat pump?"],
  ])("routes %s without guessing a record", (message, intent, query) => expect(routeCopilotMessage(message)).toMatchObject({ intent, query }));
  it("parses scheduled dates as business dates, not creation times", () => {
    expect(routeCopilotMessage("show scheduled jobs tomorrow")).toMatchObject({ intent: "leads", status: "scheduled", dayOffset: 1 });
    const day = businessDate(new Date("2026-03-08T04:59:00Z"));
    expect(day).toBe("2026-03-07");
    expect(reportRange("yesterday", "2026-03-08")).toEqual({ start: "2026-03-07", end: "2026-03-07" });
    expect(reportRange("last week", "2026-11-02")).toEqual({ start: "2026-10-27", end: "2026-11-02" });
  });
  it("rejects executable and foreign destinations", () => {
    expect(safeCopilotHref(`/leads/${id}`)).toBe(true);
    expect(safeCopilotHref(`/technicians?copilot=${id}`)).toBe(true);
    for (const href of ["javascript:alert(1)", "//evil.invalid", "/settings?admin=1", "/leads/not-an-id", "https://example.com"]) expect(safeCopilotHref(href)).toBe(false);
  });
  it("rejects oversized prompts, invalid pages and scope", () => {
    const ask = { action: "ask", message: "hello", requestId: id, allowAi: false };
    for (const extra of [{ message: "a".repeat(1201) }, { offset: -1 }, { offset: 300 }, { intent: "execute_sql" }, { scope: "all" }, { date: "not a date" }]) expect(() => parseCopilotAsk({ ...ask, ...extra })).toThrow();
  });
});
describe("Copilot API boundary", () => {
  it("validates access and fails closed on invalid server shapes", async () => {
    invoke.mockResolvedValue({ data: { allowed: true, aiEnabled: false, role: "admin", timezone: "UTC", sections: ["leads"] }, error: null });
    await expect(fetchCopilotAccess()).resolves.toMatchObject({ allowed: true });
    invoke.mockResolvedValue({ data: { allowed: true }, error: null });
    await expect(fetchCopilotAccess()).rejects.toThrow();
  });
  it("rejects unsafe links before UI rendering", async () => {
    invoke.mockResolvedValue({ data: { ...emptyCopilotResult("help"), links: [{ label: "Click", href: "javascript:alert(1)" }] }, error: null });
    await expect(askCopilot({ action: "ask", message: "help", requestId: id, allowAi: false })).rejects.toThrow();
  });
  it("propagates access denial without suggesting retries or using a privileged client", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "Access denied" }), { status: 403 }) } });
    await expect(fetchCopilotAccess()).rejects.toMatchObject({ message: "Access denied", status: 403 });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("accepts save acknowledgement independently of a settings refresh", async () => {
    invoke.mockResolvedValue({ data: { saved: true }, error: null });
    await expect(configureCopilot({ enabled: true, ai_enabled: false, monthly_budget_cents: 0, daily_ai_limit: 0, timezone: "UTC" })).resolves.toEqual({ saved: true });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
