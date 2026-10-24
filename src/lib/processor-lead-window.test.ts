import { describe, expect, it } from "vitest";
import { customerMentioned, selectLeadWindow, verifyProcessorFacts, type LeadWindow } from "../../supabase/functions/_shared/processor-lead-window";
import type { JobMessage } from "../../supabase/functions/_shared/processor-job-status";

const job = { id: "lead", job_id: "LD-ABC123", customer_name: "Shanice Walker", customer_phone: "4045550101", address: "12 Peach St, Atlanta, GA", service_type: "Furniture Assembly", tech_number: "4155550199", scheduled_date: "2026-10-25", scheduled_time_start: "10:00:00", created_at: "2026-10-08T15:00:00Z" };
let seq = 0;
const msg = (at: string, text: string | null, sender = "agent", extra: Partial<JobMessage> = {}): JobMessage => ({ id: `m${++seq}`, conversation_id: "c", sender, text, message_time: at, status: sender === "agent" ? "delivered" : "received", ...extra });

describe("Lead chat window", () => {
  it("starts at the first customer mention from the day before the lead, skipping older chat", () => {
    const old = msg("2026-10-01T10:00:00Z", "New job: Shanice Walker, 12 Peach St");
    const otherJob = msg("2026-10-07T18:00:00Z", "Thanks for the Denver job");
    const dispatch = msg("2026-10-07T20:00:00Z", "New job for Shanice, furniture assembly at 12 Peach St");
    const reply = msg("2026-10-07T20:05:00Z", "Ok I got it", "customer");
    const window = selectLeadWindow([reply, old, otherJob, dispatch], job);
    expect(window).toMatchObject({ anchor: "customer_mention", anchor_message_id: dispatch.id, start: dispatch.message_time, omitted: 0 });
    expect(window.messages.map((m) => m.id)).toEqual([dispatch.id, reply.id]);
    expect(window.messages[1]).toMatchObject({ from: "technician", via: "text", text: "Ok I got it" });
  });
  it("still reviews the chat from the lead date when no customer detail is found", () => {
    const before = msg("2026-10-06T10:00:00Z", "unrelated");
    const after = msg("2026-10-09T10:00:00Z", "Any update on the assembly?");
    const window = selectLeadWindow([before, after], job);
    expect(window).toMatchObject({ anchor: "lead_created", anchor_message_id: null, start: "2026-10-07T15:00:00.000Z" });
    expect(window.messages.map((m) => m.id)).toEqual([after.id]);
  });
  it("includes call transcript segments and answered calls, but not call-summary rows or reactions", () => {
    const dispatch = msg("2026-10-08T16:00:00Z", "Job LD-ABC123 details sent");
    const segment = msg("2026-10-08T17:00:00Z", "I'm at the house now", "customer", { source: "call_transcript", status: "transcript.verified" });
    const answered = msg("2026-10-08T17:01:00Z", null, "customer", { status: "call.completed" });
    const summary = msg("2026-10-08T17:02:00Z", "Call summary: tech arrived", "customer");
    const reaction = msg("2026-10-08T17:03:00Z", "Liked \"ok\"", "customer");
    const window = selectLeadWindow([dispatch, segment, answered, summary, reaction], job);
    expect(window.messages.map((m) => [m.via, m.text])).toEqual([["text", "Job LD-ABC123 details sent"], ["call", "I'm at the house now"], ["call", "[answered phone call]"]]);
  });
  it("trims a very long window to the dispatch and newest messages and reports what was omitted", () => {
    const messages = Array.from({ length: 60 }, (_, i) => msg(new Date(Date.parse("2026-10-08T16:00:00Z") + i * 60_000).toISOString(), `${i === 0 ? "Shanice job " : ""}message ${i} ${"x".repeat(400)}`));
    const window = selectLeadWindow(messages, job, 12_000);
    expect(window.omitted).toBeGreaterThan(0);
    expect(window.messages.length + window.omitted).toBe(60);
    expect(window.messages[0].id).toBe(messages[0].id);
    expect(window.messages.at(-1)!.id).toBe(messages[59].id);
  });
  it.each([["Shanice Walker called"], ["for shanice tomorrow"], ["Job LD-ABC123"], ["cust (404) 555-0101"], ["at 12 peach street"]])("recognizes the customer in %s", (text) => {
    expect(customerMentioned(text, job)).toBe(true);
  });
  it("does not anchor on a different customer", () => {
    expect(customerMentioned("New job for Jeff at 40 Elm", job)).toBe(false);
  });
});

describe("AI fact verification", () => {
  const window: LeadWindow = { start: "2026-10-08T16:00:00Z", anchor: "customer_mention", anchor_message_id: "d", omitted: 0, all: [], messages: [
    { id: "d", at: "2026-10-08T16:00:00Z", from: "our_team", via: "text", text: "New job for Shanice at 12 Peach St" },
    { id: "ok", at: "2026-10-08T16:05:00Z", from: "technician", via: "text", text: "Ok got it, I'll take it" },
    { id: "ask", at: "2026-10-25T15:30:00Z", from: "our_team", via: "text", text: "Any update on Shanice?" },
    { id: "done", at: "2026-10-25T18:00:00Z", from: "technician", via: "call", text: "Yeah all done there" },
  ] };
  it("keeps completion only when quoted from the technician", () => {
    const facts = verifyProcessorFacts({ enough_context: true, tech_took_job: true, job_update: "completed", evidence: [{ signal: "took_job", message_id: "ok", quote: "Ok got it" }, { signal: "completed", message_id: "done", quote: "all done there" }] }, window);
    expect(facts).toMatchObject({ enough_context: true, tech_took_job: true, job_update: "completed", waiting_since: null });
    expect(facts.evidence.map((e) => e.signal)).toEqual(["took_job", "completed"]);
  });
  it("downgrades an unquoted or misattributed completion and an invented acceptance", () => {
    const facts = verifyProcessorFacts({ enough_context: true, tech_took_job: true, job_update: "completed", waiting_on_technician_message_id: "ask",
      evidence: [{ signal: "completed", message_id: "ask", quote: "Any update" }, { signal: "completed", message_id: "done", quote: "finished everything" }] }, window);
    expect(facts).toMatchObject({ job_update: "none", tech_took_job: false, waiting_since: null, evidence: [] });
  });
  it("records the unanswered question time only after the technician took the job", () => {
    const facts = verifyProcessorFacts({ enough_context: true, tech_took_job: true, job_update: "none", waiting_on_technician_message_id: "ask",
      evidence: [{ signal: "took_job", message_id: "ok", quote: "I'll take it" }, { signal: "waiting", message_id: "ask", quote: "Any update on Shanice?" }] }, window);
    expect(facts).toMatchObject({ tech_took_job: true, waiting_since: "2026-10-25T15:30:00Z", waiting_message_id: "ask" });
  });
  it.each([["Not done yet with Shanice", "completed", "done"], ["I will finish Shanice tomorrow", "completed", "finish"], ["Haven't started Shanice", "in_progress", "started"]])("rejects an outcome quoted out of uncertain wording: %s", (text, signal, quote) => {
    const uncertainWindow: LeadWindow = { ...window, messages: [...window.messages, { id: "u", at: "2026-10-25T18:00:00Z", from: "technician", via: "text", text }] };
    const facts = verifyProcessorFacts({ enough_context: true, tech_took_job: true, job_update: signal, evidence: [{ signal, message_id: "u", quote }] }, uncertainWindow);
    expect(facts).toMatchObject({ job_update: "none", evidence: [] });
  });
  it("records when the technician first reported completion", () => {
    const facts = verifyProcessorFacts({ enough_context: true, tech_took_job: true, job_update: "completed", evidence: [{ signal: "took_job", message_id: "ok", quote: "Ok got it" }, { signal: "completed", message_id: "done", quote: "all done there" }] }, window);
    expect(facts.completed_at).toBe("2026-10-25T18:00:00Z");
    expect(verifyProcessorFacts({ enough_context: true, job_update: "none" }, window).completed_at).toBeNull();
  });
  it("still tracks our unanswered payment question after the technician completed the job", () => {
    const later: LeadWindow = { ...window, messages: [...window.messages, { id: "paid?", at: "2026-10-25T19:00:00Z", from: "our_team", via: "text", text: "Did Shanice pay you?" }] };
    const facts = verifyProcessorFacts({ enough_context: true, tech_took_job: true, job_update: "completed", waiting_on_technician_message_id: "paid?", evidence: [{ signal: "took_job", message_id: "ok", quote: "Ok got it" }, { signal: "completed", message_id: "done", quote: "all done there" }] }, later);
    expect(facts).toMatchObject({ job_update: "completed", waiting_since: "2026-10-25T19:00:00Z" });
  });
  it("never treats a technician message as our unanswered question", () => {
    expect(verifyProcessorFacts({ enough_context: true, tech_took_job: true, waiting_on_technician_message_id: "done", evidence: [{ signal: "took_job", message_id: "ok", quote: "Ok got it" }] }, window).waiting_since).toBeNull();
  });
  it("reports not enough context for an empty window or malformed output", () => {
    expect(verifyProcessorFacts("nonsense", window).enough_context).toBe(false);
    expect(verifyProcessorFacts({ enough_context: true }, { ...window, messages: [] }).enough_context).toBe(false);
  });
});
