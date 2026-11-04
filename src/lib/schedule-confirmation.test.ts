// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  assessScheduleCandidate, buildScheduleTranscript, parseScheduleBatch, schedulePrecheck, verifyCustomerQuote,
  type ConversationMessage, type ScheduleCheck,
} from "../../supabase/functions/_shared/schedule-confirmation";
import { createScheduleMonitorHandler } from "../../supabase/functions/_shared/schedule-monitor-handler";

const enteredAt = "2026-11-30T10:00:00Z";
const conversation: ConversationMessage[] = [
  { sender: "customer", direction: "inbound", text: "Yes 10am works for me", message_time: "2026-11-30T12:00:00Z", quo_message_id: "q3" },
  { sender: "agent", direction: "outbound", text: "Can the technician come tomorrow at 10am?", message_time: "2026-11-30T11:00:00Z", quo_message_id: "q2" },
  { sender: "customer", direction: "inbound", text: "My AC stopped working", message_time: "2026-11-29T09:00:00Z", quo_message_id: "q1" },
  { sender: "customer", direction: "inbound", text: "Call summary: yes", message_time: "2026-11-30T12:30:00Z", quo_message_id: "c1:call.summary.completed" },
];
const job: ScheduleCheck = {
  lead_id: "job", lease: "lease", generation: 2, attempts: 1, entered_at: enteredAt, eligible: true, ambiguous: false,
  job_id: "JOB-123", status: "urgent_job", customer_name: "Jane", service_type: "AC Repair", service_details: "Unit not cooling",
  schedule_requirements: "Tomorrow 10 AM", scheduled_date: null, scheduled_time_start: null, scheduled_time_end: null,
  evidence: { id: "m3", conversation_id: "conversation", sender: "customer", direction: "inbound", text: "Yes 10am works for me", message_time: "2026-11-30T12:00:00Z", quo_message_id: "q3" },
  messages: conversation,
};
const aiAnswer = (content: object) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));

describe("schedule confirmation prechecks", () => {
  it("lets an eligible job with a customer text through to the AI", () => { expect(schedulePrecheck(job)).toBeNull(); });
  it.each([
    [{ eligible: false }, "needs_review"], [{ ambiguous: true }, "needs_review"], [{ evidence: null }, "unavailable"],
    [{ evidence: { ...job.evidence!, sender: "agent", direction: "outbound" } }, "needs_review"],
    [{ evidence: { ...job.evidence!, quo_message_id: "c1:call.completed" } }, "needs_review"],
  ] as const)("fails closed for %j", (patch, decision) => {
    expect(schedulePrecheck({ ...job, ...patch } as ScheduleCheck)?.decision).toBe(decision);
  });
});

describe("conversation handling", () => {
  it("sends texts only, oldest first, and marks what came after the waiting tag", () => {
    expect(buildScheduleTranscript(conversation, enteredAt)).toEqual([
      { from: "customer", at: "2026-11-29T09:00:00Z", after_waiting_tag: false, text: "My AC stopped working" },
      { from: "our_team", at: "2026-11-30T11:00:00Z", after_waiting_tag: true, text: "Can the technician come tomorrow at 10am?" },
      { from: "customer", at: "2026-11-30T12:00:00Z", after_waiting_tag: true, text: "Yes 10am works for me" },
    ]);
  });
  it("accepts only the customer's own words sent after the job started waiting", () => {
    expect(verifyCustomerQuote("10am works", conversation, enteredAt)).toBe(true);
    expect(verifyCustomerQuote("tomorrow at 10am", conversation, enteredAt)).toBe(false); // our team's words
    expect(verifyCustomerQuote("My AC stopped", conversation, enteredAt)).toBe(false); // before the tag
    expect(verifyCustomerQuote("yes", conversation, enteredAt)).toBe(false); // only in a call summary
    expect(verifyCustomerQuote(" ", conversation, enteredAt)).toBe(false);
  });
});

describe("AI decision", () => {
  it("confirms with the customer's quote when the AI quotes them exactly", async () => {
    const fetcher = vi.fn().mockResolvedValue(aiAnswer({ confirmed: true, customer_quote: "Yes 10am works for me", reason: "Customer agreed to 10am." }));
    expect(await assessScheduleCandidate(job, "synthetic", fetcher)).toEqual({ decision: "confirmed", reason: "Customer agreed to 10am.", quote: "Yes 10am works for me" });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(JSON.parse(body.messages[1].content).CONVERSATION).toHaveLength(3);
  });
  it("refuses a confirmation whose quote is not the customer's words", async () => {
    const fetcher = vi.fn().mockResolvedValue(aiAnswer({ confirmed: true, customer_quote: "tomorrow at 10am", reason: "Agreed" }));
    expect((await assessScheduleCandidate(job, "synthetic", fetcher)).decision).toBe("needs_review");
  });
  it("keeps the job waiting when the AI says the customer has not confirmed", async () => {
    const fetcher = vi.fn().mockResolvedValue(aiAnswer({ confirmed: false, customer_quote: "", reason: "Customer asked for Friday instead." }));
    expect(await assessScheduleCandidate(job, "synthetic", fetcher)).toEqual({ decision: "needs_review", reason: "Customer asked for Friday instead." });
  });
  it("distinguishes missing config, provider failures and bad answers", async () => {
    const fetcher = vi.fn();
    expect((await assessScheduleCandidate(job, undefined, fetcher)).decision).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(new Response("", { status: 429 }));
    expect(await assessScheduleCandidate(job, "synthetic", fetcher)).toMatchObject({ decision: "unavailable", provider_status: 429 });
    fetcher.mockResolvedValue(aiAnswer({ confirmed: true }));
    expect((await assessScheduleCandidate(job, "synthetic", fetcher)).decision).toBe("unavailable");
  });
  it("does not spend an AI call when nothing new came from the customer", async () => {
    const fetcher = vi.fn();
    const before = conversation.map((m) => ({ ...m, message_time: "2026-11-29T00:00:00Z" }));
    expect((await assessScheduleCandidate({ ...job, messages: before }, "synthetic", fetcher)).decision).toBe("needs_review");
    expect((await assessScheduleCandidate({ ...job, ambiguous: true }, "synthetic", fetcher)).decision).toBe("needs_review");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("worker batch and boundary", () => {
  const claimed = { mode: "automatic", timezone: "America/New_York", config_changed_at: "2026-11-30T00:00:00Z", rows: [job, { ...job, lead_id: "job-2" }] };
  it("parses the claimed jobs with their details", () => {
    const parsed = parseScheduleBatch(claimed).rows[0];
    expect(parsed).toMatchObject({ job_id: "JOB-123", service_type: "AC Repair", ambiguous: false });
    expect(parsed.messages).toHaveLength(4);
    expect(() => parseScheduleBatch({ ...claimed, rows: [{ ...job, ambiguous: undefined }] })).toThrow();
  });
  it("denies calls without the worker secret before any database work", async () => {
    const assess = vi.fn();
    const handler = createScheduleMonitorHandler({ authenticate: async () => null, assess });
    expect((await handler(new Request("https://synthetic.invalid", { method: "POST" }))).status).toBe(401);
    expect(assess).not.toHaveBeenCalled();
  });
  it("passes the AI's quote to the database and stops provider calls after a 429", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: claimed, error: null }).mockResolvedValue({ data: true, error: null });
    const assess = vi.fn().mockResolvedValueOnce({ decision: "confirmed", reason: "ok", quote: "Yes 10am works for me" })
      .mockResolvedValue({ decision: "unavailable", reason: "limited", provider_status: 429 });
    const response = await createScheduleMonitorHandler({ authenticate: async () => ({ rpc }), assess })(new Request("https://synthetic.invalid", { method: "POST" }));
    expect(response.status).toBe(503);
    expect(assess).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1].p_input).toMatchObject({ lease: "lease", generation: 2, mode: "automatic", result: { decision: "confirmed", quote: "Yes 10am works for me" } });
  });
  it("OFF and empty queues do not call AI", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { mode: "off", rows: [] }, error: null });
    const assess = vi.fn();
    const response = await createScheduleMonitorHandler({ authenticate: async () => ({ rpc }), assess })(new Request("https://synthetic.invalid", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(assess).not.toHaveBeenCalled();
  });
});
