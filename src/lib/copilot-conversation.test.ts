import { describe, expect, it } from "vitest";
import { parseCopilotAsk, routeCopilotMessage, type CopilotAsk, type CopilotAccess } from "../../supabase/functions/_shared/copilot-core";
import { resolveCopilotQuestion } from "../../supabase/functions/_shared/copilot-conversation";
const access: CopilotAccess = { allowed: true, aiEnabled: true, role: "admin", timezone: "America/New_York", sections: ["leads", "schedule"] };
const now = new Date("2026-10-14T12:00:00Z");
const ask = (message: string, extra: Partial<CopilotAsk> = {}): CopilotAsk => ({ action: "ask", message, requestId: "00000000-0000-4000-8000-000000000001", allowAi: false, ...extra });
describe("bounded conversational CRM routing", () => {
  it("extracts explicit area, status and schedule instead of searching the entire sentence", () => {
    expect(resolveCopilotQuestion(ask("Find urgent leads in Miami tomorrow"), access, now)).toMatchObject({ intent: "leads", query: "", area: "Miami", status: "urgent_job", date: "2026-10-15" });
  });
  it("extracts a service and exact report date range, and refuses fake availability dates", () => {
    expect(resolveCopilotQuestion(ask("Find urgent plumbing leads in Miami tomorrow"), access, now)).toMatchObject({ intent: "leads", service: "plumbing", status: "urgent_job", area: "Miami", date: "2026-10-15" });
    expect(resolveCopilotQuestion(ask("My team report from 2026-10-01 to 2026-10-07"), access, now)).toMatchObject({ intent: "report", start: "2026-10-01", end: "2026-10-07", scope: "team" });
    expect(resolveCopilotQuestion(ask("Find technicians tomorrow"), access, now).intent).toBe("clarify");
    expect(resolveCopilotQuestion(ask("Find inactive plumbing technicians in Miami"), access, now)).toMatchObject({ intent: "technicians", active: false, service: "plumbing", area: "Miami" });
    expect(() => parseCopilotAsk(ask("hello", { date: "2026-02-30" }))).toThrow();
  });
  it("retains saved query and filters when refining the date", () => {
    expect(resolveCopilotQuestion(ask("only tomorrow", { previous: { intent: "leads", query: "MM-101", area: "Miami", service: "Plumbing" } }), access, now)).toMatchObject({ intent: "leads", query: "MM-101", area: "Miami", service: "Plumbing", date: "2026-10-15" });
  });
  it("refines technicians to inactive without changing ownership rules", () => {
    expect(resolveCopilotQuestion(ask("only inactive", { previous: { intent: "technicians", area: "Miami" } }), access, now)).toMatchObject({ intent: "technicians", active: false, area: "Miami" });
  });
  it("preserves exact team report scope and dates when explaining that", () => {
    expect(resolveCopilotQuestion(ask("explain that", { previous: { intent: "report", start: "2026-10-01", end: "2026-10-07", scope: "team" } }), access, now)).toMatchObject({ intent: "explain_report", start: "2026-10-01", end: "2026-10-07", scope: "team" });
  });
  it("clarifies unsupported or context-free refinements without AI", () => {
    expect(resolveCopilotQuestion(ask("only tomorrow"), access, now).intent).toBe("clarify");
    expect(resolveCopilotQuestion(ask("only reliable", { previous: { intent: "technicians" } }), access, now).intent).toBe("clarify");
  });
  it("starts a new explicit question without inheriting old filters", () => {
    const next = resolveCopilotQuestion(ask("find lead MM-200", { previous: { intent: "leads", area: "Miami", status: "urgent_job" } }), access, now);
    expect(next).toMatchObject({ intent: "leads", query: "MM-200" }); expect(next.area).toBeUndefined(); expect(next.status).toBeUndefined();
  });
  it("allows message drafts mentioning sending but never executes a send", () => {
    expect(routeCopilotMessage("Draft a message to send to the customer").intent).toBe("ai");
    expect(routeCopilotMessage("send this to the customer").intent).toBe("blocked");
  });
  it("copies only known previous fields and rejects oversized history and invalid IDs", () => {
    const parsed = parseCopilotAsk(ask("only tomorrow", { previous: { intent: "leads", area: "Miami", ...{ secret: "never copy" } } }));
    expect(parsed.previous).not.toHaveProperty("secret");
    expect(() => parseCopilotAsk(ask("hello", { selectedLeadId: "not-a-lead" }))).toThrow();
    expect(() => parseCopilotAsk(ask("hello", { conversation: Array.from({ length: 4 }, () => ({ question: "hello", answer: "hi" })) }))).toThrow();
    expect(() => parseCopilotAsk(ask("hello", { conversation: [{ question: "x".repeat(501), answer: "hi" }] }))).toThrow();
  });
});
