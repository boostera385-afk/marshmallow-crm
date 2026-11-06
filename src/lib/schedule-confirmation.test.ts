// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  assessScheduleCandidate, buildScheduleTranscript, isOnlyQuestion, MAX_TRANSCRIPT_MESSAGES, parseScheduleBatch, resolveConfirmingQuote, schedulePrecheck, verifyCustomerQuote,
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
const call: ConversationMessage[] = [
  { kind: "call_transcript", sender: "customer", direction: "inbound", text: "Call transcript: ...", message_time: "2026-11-30T13:00:00Z", quo_message_id: "c2:call.transcript.completed",
    dialogue: [{ speaker: "our_team", content: "Shall we book Friday at 9?" }, { speaker: "customer", content: "Friday at 9 works great" }] },
  { kind: "call_summary", sender: "customer", direction: "inbound", text: "Call summary: customer agreed to Friday 9am", message_time: "2026-11-30T13:00:05Z", quo_message_id: "c2:call.summary.completed" },
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
  it("lets an eligible job through to the AI after any new message or call", () => {
    expect(schedulePrecheck(job)).toBeNull();
    expect(schedulePrecheck({ ...job, evidence: { ...job.evidence!, sender: "agent", direction: "outbound" } })).toBeNull();
    expect(schedulePrecheck({ ...job, evidence: { ...job.evidence!, quo_message_id: "c1:call.transcript.completed" } })).toBeNull();
  });
  it.each([
    [{ eligible: false }, "needs_review"], [{ ambiguous: true }, "needs_review"], [{ evidence: null }, "unavailable"],
  ] as const)("fails closed for %j", (patch, decision) => {
    expect(schedulePrecheck({ ...job, ...patch } as ScheduleCheck)?.decision).toBe(decision);
  });
});

describe("conversation handling", () => {
  it("orders texts and summaries oldest first and marks what came after the waiting tag", () => {
    expect(buildScheduleTranscript(conversation, enteredAt)).toEqual([
      { id: 0, from: "customer", via: "text", at: "2026-11-29T09:00:00Z", after_waiting_tag: false, text: "My AC stopped working" },
      { id: 1, from: "our_team", via: "text", at: "2026-11-30T11:00:00Z", after_waiting_tag: true, text: "Can the technician come tomorrow at 10am?" },
      { id: 2, from: "customer", via: "text", at: "2026-11-30T12:00:00Z", after_waiting_tag: true, text: "Yes 10am works for me" },
      { id: 3, from: "call_summary", via: "summary", at: "2026-11-30T12:30:00Z", after_waiting_tag: true, text: "Call summary: yes" },
    ]);
  });
  it("reads each spoken call line with its speaker", () => {
    expect(buildScheduleTranscript(call, enteredAt)).toEqual([
      { id: 0, from: "our_team", via: "call", at: "2026-11-30T13:00:00Z", after_waiting_tag: true, text: "Shall we book Friday at 9?" },
      { id: 1, from: "customer", via: "call", at: "2026-11-30T13:00:00Z", after_waiting_tag: true, text: "Friday at 9 works great" },
      { id: 2, from: "call_summary", via: "summary", at: "2026-11-30T13:00:05Z", after_waiting_tag: true, text: "Call summary: customer agreed to Friday 9am" },
    ]);
  });
  it("treats a transcript without speakers as background, never as the customer", () => {
    const flat = [{ ...call[0], dialogue: [], text: "Call transcript: Customer: yes Friday works" }];
    expect(buildScheduleTranscript(flat, enteredAt)[0].from).toBe("call_record");
    expect(verifyCustomerQuote("yes Friday works", flat, enteredAt)).toBe(false);
  });
  it("accepts only the customer's own words sent after the job started waiting", () => {
    expect(verifyCustomerQuote("10am works", conversation, enteredAt)).toBe(true);
    expect(verifyCustomerQuote("tomorrow at 10am", conversation, enteredAt)).toBe(false); // our team's words
    expect(verifyCustomerQuote("My AC stopped", conversation, enteredAt)).toBe(false); // before the tag
    expect(verifyCustomerQuote("yes", conversation, enteredAt)).toBe(false); // only in a call summary
    expect(verifyCustomerQuote(" ", conversation, enteredAt)).toBe(false);
    const thumbs = [{ ...conversation[0], text: "👍" }];
    expect(verifyCustomerQuote("👍", thumbs, enteredAt)).toBe(false); // one character, as the database counts it
  });
  it("keeps the most recent items when a chat has more lines than the AI reads", () => {
    const lines = Array.from({ length: MAX_TRANSCRIPT_MESSAGES + 40 }, (_, i): ConversationMessage => ({
      sender: i % 2 ? "customer" : "agent", direction: i % 2 ? "inbound" : "outbound", text: `line ${i}`,
      message_time: new Date(Date.parse(enteredAt) + i * 1000).toISOString(), quo_message_id: `t${i}`,
    }));
    const transcript = buildScheduleTranscript(lines, enteredAt);
    expect(transcript).toHaveLength(MAX_TRANSCRIPT_MESSAGES);
    expect(transcript[0]).toMatchObject({ id: 0, text: "line 40" });
    expect(transcript.at(-1)).toMatchObject({ id: MAX_TRANSCRIPT_MESSAGES - 1, text: `line ${MAX_TRANSCRIPT_MESSAGES + 39}` });
  });
  it("accepts the customer's words on a call, but not ours or the summary", () => {
    expect(verifyCustomerQuote("Friday at 9 works great", call, enteredAt)).toBe(true);
    expect(verifyCustomerQuote("Shall we book Friday", call, enteredAt)).toBe(false);
    expect(verifyCustomerQuote("customer agreed to Friday", call, enteredAt)).toBe(false);
  });
});

describe("AI decision", () => {
  it("confirms with the exact words of the customer item the AI cites", async () => {
    const fetcher = vi.fn().mockResolvedValue(aiAnswer({ analysis: "We offered 10am; customer accepted.", our_proposal_item: 1, customer_changed_time: false, confirmed: true, confirming_items: [2], reason: "Customer agreed to 10am." }));
    expect(await assessScheduleCandidate(job, "synthetic", fetcher)).toEqual({ decision: "confirmed", reason: "Customer agreed to 10am.", quote: "Yes 10am works for me" });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o-mini");
    // The model must reason before it decides, and cite items rather than retype words.
    expect(body.response_format.json_schema.schema.required).toEqual(["analysis", "our_proposal_item", "customer_changed_time", "confirmed", "confirming_items", "reason"]);
    const sent = JSON.parse(body.messages[1].content);
    expect(sent.CONVERSATION).toHaveLength(4);
    expect(sent.CONVERSATION.map((item: { id: number }) => item.id)).toEqual([0, 1, 2, 3]);
    expect(sent.JOB.waiting_since).toBe(enteredAt);
  });
  it("confirms an indirect reply: a bare 'ok' and logistics after our proposal", async () => {
    const indirect: ConversationMessage[] = [
      { sender: "agent", direction: "outbound", text: "We can send the tech Tuesday between 10 and 12. Does that work?", message_time: "2026-11-30T11:00:00Z", quo_message_id: "a1" },
      { sender: "customer", direction: "inbound", text: "ok", message_time: "2026-11-30T11:05:00Z", quo_message_id: "a2" },
      { sender: "customer", direction: "inbound", text: "I'll leave the side gate open, dog will be inside", message_time: "2026-11-30T11:06:00Z", quo_message_id: "a3" },
    ];
    const fetcher = vi.fn().mockResolvedValue(aiAnswer({ analysis: "Tuesday 10-12 offered; customer said ok and gave access details.", our_proposal_item: 0, customer_changed_time: false, confirmed: true, confirming_items: [1, 2], reason: "Customer accepted Tuesday 10-12." }));
    // The longest cited customer line becomes the quote shown to the office team.
    expect(await assessScheduleCandidate({ ...job, messages: indirect }, "synthetic", fetcher))
      .toMatchObject({ decision: "confirmed", quote: "I'll leave the side gate open, dog will be inside" });
  });
  it("confirms a short spoken 'yeah' answering our team on a call", async () => {
    const choppy: ConversationMessage[] = [{ kind: "call_transcript", sender: "customer", direction: "inbound", text: null, message_time: "2026-11-30T13:00:00Z",
      quo_message_id: "c3:call.transcript.completed", dialogue: [
        { speaker: "our_team", content: "So I'll put you down for Thursday morning, eight to ten, is that alright?" },
        { speaker: "customer", content: "Yeah." }, { speaker: "customer", content: "Yeah, that's fine." }, { speaker: "our_team", content: "Perfect." }] }];
    const fetcher = vi.fn().mockResolvedValue(aiAnswer({ analysis: "Thursday 8-10 offered on the call; customer agreed.", our_proposal_item: 0, customer_changed_time: false, confirmed: true, confirming_items: [2, 1], reason: "Agreed on the call." }));
    expect(await assessScheduleCandidate({ ...job, messages: choppy }, "synthetic", fetcher)).toMatchObject({ decision: "confirmed", quote: "Yeah, that's fine." });
  });
  it("confirms from a phone call when the AI quotes the customer's spoken words", async () => {
    const callJob = { ...job, messages: call, evidence: { ...job.evidence!, quo_message_id: "c2:call.summary.completed", sender: "customer" } };
    const fetcher = vi.fn().mockResolvedValue(aiAnswer({ analysis: "", our_proposal_item: 0, customer_changed_time: false, confirmed: true, confirming_items: [1], reason: "Agreed on the call." }));
    expect(await assessScheduleCandidate(callJob, "synthetic", fetcher)).toMatchObject({ decision: "confirmed", quote: "Friday at 9 works great" });
    fetcher.mockResolvedValue(aiAnswer({ analysis: "", our_proposal_item: 0, customer_changed_time: false, confirmed: true, confirming_items: [2], reason: "Summary says so." }));
    expect((await assessScheduleCandidate(callJob, "synthetic", fetcher)).decision).toBe("needs_review");
  });
  it.each([
    ["our team's message", [1]], ["a customer text from before the waiting tag", [0]], ["a call summary", [3]],
    ["an id that does not exist", [42]], ["no item at all", []], ["a non-numeric id", ["2"]],
  ])("refuses a confirmation that cites %s", async (_label, ids) => {
    const fetcher = vi.fn().mockResolvedValue(aiAnswer({ analysis: "", our_proposal_item: 1, customer_changed_time: false, confirmed: true, confirming_items: ids, reason: "Agreed" }));
    expect(await assessScheduleCandidate(job, "synthetic", fetcher)).toMatchObject({ decision: "needs_review", reason: "AI said confirmed but did not point to the customer's own words." });
  });
  describe("only the schedule our team sent counts", () => {
    const proposal: ConversationMessage = { sender: "agent", direction: "outbound", text: "We can send the tech Friday 11/13 between 9 and 11. Does that work?", message_time: "2026-11-30T11:00:00Z", quo_message_id: "p1" };
    const reply = (text: string, minute = 5): ConversationMessage => ({ sender: "customer", direction: "inbound", text, message_time: `2026-11-30T11:${String(minute).padStart(2, "0")}:00Z`, quo_message_id: `r${minute}` });
    const answer = (patch: object) => aiAnswer({ analysis: "", our_proposal_item: 0, customer_changed_time: false, confirmed: true, confirming_items: [1], reason: "Agreed.", ...patch });
    // Real replies the previous worker wrongly applied in production on 2026-11-05.
    it.each(["How about the 14th?", "09:30 and 10:30 on Saturday.", "I do. In about 1 week", "Lets do it on Sat", "Can we do the 7th instead"])(
      "keeps the job waiting when the customer names their own day/time: %s", async (text) => {
        const fetcher = vi.fn().mockResolvedValue(answer({ customer_changed_time: true }));
        const result = await assessScheduleCandidate({ ...job, messages: [proposal, reply(text)] }, "synthetic", fetcher);
        expect(result).toMatchObject({ decision: "needs_review" });
        expect(result.reason).toMatch(/different day\/time/);
      });
    it("refuses a customer question even if the AI calls it a confirmation", async () => {
      const fetcher = vi.fn().mockResolvedValue(answer({}));
      expect(await assessScheduleCandidate({ ...job, messages: [proposal, reply("How about the 14th?")] }, "synthetic", fetcher))
        .toMatchObject({ decision: "needs_review", reason: "AI said confirmed but did not point to the customer's own words." });
    });
    it("refuses when there is no proposal from our team", async () => {
      const lone = [reply("Saturday works for me")];
      for (const our_proposal_item of [-1, 0]) {
        const fetcher = vi.fn().mockResolvedValue(answer({ our_proposal_item, confirming_items: [0] }));
        expect(await assessScheduleCandidate({ ...job, messages: lone }, "synthetic", fetcher))
          .toMatchObject({ decision: "needs_review", reason: "AI did not point to a schedule our team sent. No tag change." });
      }
    });
    it("refuses customer words from before our latest proposal", async () => {
      const messages = [reply("yes that works", 1), { ...proposal, message_time: "2026-11-30T11:03:00Z" }, reply("I'll check with my wife", 5)];
      const fetcher = vi.fn().mockResolvedValue(answer({ our_proposal_item: 1, confirming_items: [0] }));
      expect((await assessScheduleCandidate({ ...job, messages }, "synthetic", fetcher)).decision).toBe("needs_review");
    });
    it("confirms a plain yes to our proposal, by text or on a call", async () => {
      const fetcher = vi.fn().mockImplementation(async () => answer({}));
      expect(await assessScheduleCandidate({ ...job, messages: [proposal, reply("Yes It works")] }, "synthetic", fetcher))
        .toMatchObject({ decision: "confirmed", quote: "Yes It works" });
      const onCall: ConversationMessage[] = [{ kind: "call_transcript", sender: "customer", direction: "inbound", text: null, message_time: "2026-11-30T13:00:00Z",
        quo_message_id: "c9:call.transcript.completed", dialogue: [
          { speaker: "our_team", content: "We have you for Friday nine to eleven, does that still work?" }, { speaker: "customer", content: "Yes, Friday is good." }] }];
      expect(await assessScheduleCandidate({ ...job, messages: onCall }, "synthetic", fetcher)).toMatchObject({ decision: "confirmed", quote: "Yes, Friday is good." });
    });
    it("keeps a call waiting when the customer asks for another day on the phone", async () => {
      const onCall: ConversationMessage[] = [{ kind: "call_transcript", sender: "customer", direction: "inbound", text: null, message_time: "2026-11-30T13:00:00Z",
        quo_message_id: "c8:call.transcript.completed", dialogue: [
          { speaker: "our_team", content: "We have you for Friday nine to eleven." }, { speaker: "customer", content: "Can we do Saturday instead" },
          { speaker: "our_team", content: "Sure, Saturday works." }, { speaker: "customer", content: "Okay great." }] }];
      const fetcher = vi.fn().mockResolvedValue(answer({ our_proposal_item: 2, customer_changed_time: true, confirming_items: [3] }));
      expect((await assessScheduleCandidate({ ...job, messages: onCall }, "synthetic", fetcher)).decision).toBe("needs_review");
    });
    it("tells only-question lines apart from an acceptance followed by a question", () => {
      for (const q of ["How about the 14th?", "Is Tuesday an option?", "What is the name of your company?", "Can he come Tuesday? ", "So not on Wednesday??"]) expect(isOnlyQuestion(q)).toBe(true);
      for (const a of ["That is fine. How do you want payment?", "Yes, we are available. What is his name?", "Yes It works", "Si está bien", "ok"]) expect(isOnlyQuestion(a)).toBe(false);
    });
    it("confirms an acceptance followed by a question", async () => {
      const fetcher = vi.fn().mockResolvedValue(answer({}));
      expect(await assessScheduleCandidate({ ...job, messages: [proposal, reply("That is fine. How do you want payment?")] }, "synthetic", fetcher))
        .toMatchObject({ decision: "confirmed", quote: "That is fine. How do you want payment?" });
    });
    // Seen in 109 real chats: customer asks for another time, our team sends a new
    // schedule, customer accepts that one. The new message is our latest proposal.
    it("confirms when the customer accepts the new schedule our team sent after their request", async () => {
      const messages: ConversationMessage[] = [
        proposal, reply("Saturday morning would be better. Is that available", 5),
        { ...proposal, text: "My guy will be there on Saturday, October 31, between 9 and 11 AM. Is that work for you?", message_time: "2026-11-30T11:20:00Z", quo_message_id: "p2" },
        reply("Awesome thank you", 25),
      ];
      const fetcher = vi.fn().mockResolvedValue(answer({ our_proposal_item: 2, confirming_items: [3] }));
      expect(await assessScheduleCandidate({ ...job, messages }, "synthetic", fetcher)).toMatchObject({ decision: "confirmed", quote: "Awesome thank you" });
    });
    it("does not confirm when our team only agreed to the customer's own time and the customer said nothing after", async () => {
      const messages: ConversationMessage[] = [
        proposal, reply("Hi! We can do starting at 9. Does that work?", 5),
        { ...proposal, text: "Yes we can start 9am", message_time: "2026-11-30T11:10:00Z", quo_message_id: "p2" },
      ];
      // Even if the AI wrongly cites the customer's own request, it comes before our latest message.
      const fetcher = vi.fn().mockResolvedValue(answer({ our_proposal_item: 2, confirming_items: [1] }));
      expect((await assessScheduleCandidate({ ...job, messages }, "synthetic", fetcher)).decision).toBe("needs_review");
    });
    it("tells the AI to reject customer-proposed times and treats a missing field as an invalid answer", async () => {
      const fetcher = vi.fn().mockResolvedValue(aiAnswer({ analysis: "", confirmed: true, confirming_items: [1], reason: "old shape" }));
      expect((await assessScheduleCandidate({ ...job, messages: [proposal, reply("ok")] }, "synthetic", fetcher)).decision).toBe("unavailable");
      const prompt = JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content as string;
      expect(prompt).toContain("OUR TEAM");
      expect(prompt).toContain("customer_changed_time");
    });
  });
  it("keeps only valid customer items when the AI cites a mix", () => {
    const transcript = buildScheduleTranscript(conversation, enteredAt);
    expect(resolveConfirmingQuote(transcript, [1, 2, 3])).toBe("Yes 10am works for me");
    expect(resolveConfirmingQuote(transcript, "2")).toBeNull();
  });
  it("keeps the job waiting when the AI says the customer has not confirmed", async () => {
    const fetcher = vi.fn().mockResolvedValue(aiAnswer({ analysis: "Customer asked for another day.", our_proposal_item: 1, customer_changed_time: true, confirmed: false, confirming_items: [], reason: "Customer asked for Friday instead." }));
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
    fetcher.mockResolvedValue(aiAnswer({ confirmed: true, customer_quote: "Yes 10am works for me", reason: "old answer shape" }));
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
    const withCall = parseScheduleBatch({ ...claimed, rows: [{ ...job, messages: [{ kind: "call_transcript", sender: "customer", direction: "inbound", text: null,
      message_time: "2026-11-30T13:00:00Z", quo_message_id: "c2:call.transcript.completed", dialogue: [{ speaker: "customer", content: "yes" }, { speaker: "unknown", content: "x" }] }] }] });
    expect(withCall.rows[0].messages[0].dialogue).toEqual([{ speaker: "customer", content: "yes" }]);
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
