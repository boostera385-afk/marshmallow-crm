import { describe, expect, it } from "vitest";
import { attributeTechnicianReplies, belongsToJob, deriveJobStatus, isTechnicianText, schedulePassed, verifyJobEvidence, type JobIdentity, type JobMessage } from "../../supabase/functions/_shared/processor-job-status";

const job: JobIdentity = { id: "john", job_id: "JOB-1001", customer_name: "John Sample", customer_phone: "4155550101", address: "10 Sample St Apt 2", tech_number: "4155550199", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, status: "scheduled", updated_at: "2026-10-14T12:00:00Z", created_at: "2026-10-01T12:00:00Z" };
const peer = { ...job, id: "jane", job_id: "JOB-1002", customer_name: "Jane Example", customer_phone: "4155550102", address: "12 Example St" };
const now = new Date("2026-10-15T18:00:00Z");
const message = (text: string, sender = "customer", at = "2026-10-15T16:00:00Z", id = "m1"): JobMessage => ({ id, conversation_id: "tech-chat", sender, text, message_time: at, status: sender === "agent" ? "delivered" : "received" });
function evidence(messages: JobMessage[], signal = "completed") {
  return verifyJobEvidence(messages.map((m) => ({ signal, message_id: m.id, quote: m.text })), job, [job, peer], messages, "America/New_York", now);
}
describe("Processor job isolation", () => {
  it.each(["JOB-1001 is not completed yet", "JOB-1001 will be completed tomorrow", "JOB-1001 might finish later"])("rejects a false affirmative completion selected by the model: %s", (text) => {
    const messages = [message(text)];
    expect(evidence(messages)).toEqual([]);
    expect(deriveJobStatus(job, evidence(messages), messages, true, now, "America/New_York")).toBe("take_job_update");
  });
  it("keeps John's completion separate from the other jobs in Alex's chat", () => {
    const messages = [message("JOB-1002 is completed and ready for payment.")];
    expect(evidence(messages)).toEqual([]);
    expect(deriveJobStatus(job, evidence(messages), messages, true, now, "America/New_York")).toBe("take_job_update");
    expect(belongsToJob(messages[0].text!, peer, [job, peer])).toBe(true);
  });
  it.each(["Done", "John is done", "JOB-10010 is completed", "JOB-1001 and JOB-1002 are both completed"])("rejects ambiguous or cross-job text: %s", (text) => {
    expect(evidence([message(text)])).toEqual([]);
  });
  it("accepts an exact technician quote tied to this job only", () => {
    const messages = [message("JOB-1001 is completed and ready for payment.")];
    expect(evidence(messages)).toHaveLength(1);
    expect(deriveJobStatus(job, evidence(messages), messages, true, now, "America/New_York")).toBe("payment_pending");
  });
  it("grounds a factual substring in its uniquely identified full source message, not a nearby dispatch", () => {
    const quote = "I have finished the installation and cleaned up.";
    const messages = [message(`JOB-1001\n${quote}`)];
    const result = verifyJobEvidence([{ signal: "completed", message_id: "m1", quote }], job, [job, peer], messages, "America/New_York", now);
    expect(result).toMatchObject([{ quote, identity_basis: "source_message" }]);
    expect(deriveJobStatus(job, result, messages, true, now, "America/New_York")).toBe("payment_pending");
    const generic = [message("Please update JOB-1001", "agent", "2026-10-15T15:00:00Z", "dispatch"), message(quote)];
    expect(verifyJobEvidence([{ signal: "completed", message_id: "m1", quote }], job, [job, peer], generic, "America/New_York", now)).toEqual([]);
    expect(verifyJobEvidence([{ signal: "completed", message_id: "m1", quote }], job, [job, peer], [message(`JOB-1001 and JOB-1002\n${quote}`)], "America/New_York", now)).toEqual([]);
  });
  it("recognizes equivalent street/unit spellings without dropping or guessing units", () => {
    expect(belongsToJob("10 Sample Street Apartment 2 is completed", job, [job, peer])).toBe(true);
    expect(belongsToJob("10 Sample St #2 is completed", job, [job, peer])).toBe(true);
    expect(belongsToJob("10 Sample Street Unit 22 is completed", job, [job, peer])).toBe(false);
    expect(belongsToJob("10 Sample Street is completed", job, [job, peer])).toBe(false);
    expect(belongsToJob("10 Sample Street Unit 2 is completed", { ...job, address: "10 Sample St" }, [peer])).toBe(false);
    const duplicate = { ...peer, address: "10 Sample Street Unit 2" };
    expect(belongsToJob("10 Sample St Apt 2 is completed", job, [job, duplicate])).toBe(false);
    expect(belongsToJob("JOB-1001 and 12 Example Street are completed", job, [job, peer])).toBe(false);
  });
  it("rejects an agent's completion claim, fabricated quote, wrong message ID and old visit", () => {
    expect(evidence([message("JOB-1001 is completed and ready for payment.", "agent")])).toEqual([]);
    expect(evidence([message("JOB-1001 is completed and ready for payment.", "customer", "2026-10-12T16:00:00Z")])).toEqual([]);
    const messages = [message("JOB-1001 is completed and ready for payment.")];
    expect(verifyJobEvidence([{ signal: "completed", message_id: "wrong", quote: messages[0].text }], job, [job], messages, "UTC", now)).toEqual([]);
    expect(verifyJobEvidence([{ signal: "completed", message_id: "m1", quote: "JOB-1001 is all paid and completed" }], job, [job], messages, "UTC", now)).toEqual([]);
  });
  it("does not match a shared customer name or a different apartment", () => {
    expect(belongsToJob("John Sample is completed", job, [job, { ...peer, customer_name: job.customer_name }])).toBe(false);
    expect(belongsToJob("10 Sample St Apt 22 is done", job, [job])).toBe(false);
  });
  it("uses explicit timezone and DST, and does not invent missing times", () => {
    expect(schedulePassed(job, new Date("2026-10-15T14:00:00Z"), "America/New_York")).toBe(true);
    expect(schedulePassed(job, new Date("2026-10-15T14:00:00Z"), "America/Los_Angeles")).toBe(false);
    expect(schedulePassed({ ...job, scheduled_time_start: null }, now, "UTC")).toBe(false);
    expect(schedulePassed({ ...job, scheduled_date: "2026-11-01", scheduled_time_start: "01:30" }, new Date("2026-11-01T06:30:00Z"), "America/New_York")).toBe(true);
  });
  it("requires acceptance, overdue schedule, specific request, complete history and 60 minutes before Send Dose", () => {
    const messages = [message("JOB-1001 accepted, I will take this job", "customer", "2026-10-15T14:00:00Z", "accept"), message("Please give an update on JOB-1001 now", "agent", "2026-10-15T16:00:00Z", "request")];
    const ev = verifyJobEvidence([{ signal: "accepted", message_id: "accept", quote: messages[0].text }, { signal: "update_request", message_id: "request", quote: messages[1].text }], job, [job, peer], messages, "America/New_York", now);
    expect(deriveJobStatus(job, ev, messages, true, now, "America/New_York")).toBe("send_dose");
    expect(deriveJobStatus(job, ev, messages, false, now, "America/New_York")).toBe("unavailable");
    expect(deriveJobStatus(job, ev.slice(1), messages, true, now, "America/New_York")).toBe("take_job_update");
    expect(deriveJobStatus(job, ev, messages, true, new Date("2026-10-15T16:30:00Z"), "America/New_York")).toBe("take_job_update");
    // Even a generic reply or media event prevents an unsafe accusation of silence.
    expect(deriveJobStatus(job, ev, [...messages, message("ok", "customer", "2026-10-15T17:30:00Z", "reply")], true, now, "America/New_York")).toBe("take_job_update");
    const undelivered = messages.map((m) => m.sender === "agent" ? { ...m, status: "undelivered" } : m);
    const safe = verifyJobEvidence([{ signal: "accepted", message_id: "accept", quote: messages[0].text }, { signal: "update_request", message_id: "request", quote: messages[1].text }], job, [job, peer], undelivered, "America/New_York", now);
    expect(deriveJobStatus(job, safe, undelivered, true, now, "America/New_York")).toBe("take_job_update");
  });
  it("shows progress from this job's technician report and never completes from missing history", () => {
    const messages = [message("I have started work on JOB-1001 at the property")];
    expect(deriveJobStatus(job, evidence(messages, "progress"), messages, true, now, "America/New_York")).toBe("job_in_progress");
    expect(deriveJobStatus(job, evidence(messages), messages, false, now, "America/New_York")).toBe("unavailable");
  });
  it.each(["payment_pending", "partial_paid", "job_in_progress"])("does not regress saved %s when AI finds no new job update", (status) => {
    const expected = status === "job_in_progress" ? status : "payment_pending";
    expect(deriveJobStatus({ ...job, status }, [], [message("JOB-1002 is completed")], true, now, "America/New_York")).toBe(expected);
    expect(deriveJobStatus({ ...job, status }, [], [], false, now, "America/New_York")).toBe("unavailable");
  });
  it("attributes a generic technician reply only inside this job's saved dispatch episode", () => {
    const messages = [
      message("JOB-1001 details for tomorrow at 10am", "agent", "2026-10-15T14:00:00Z", "dispatch"),
      message("Yes sir thank you for the details", "customer", "2026-10-15T14:05:00Z", "reply"),
      message("JOB-1002 is scheduled for another property", "agent", "2026-10-15T14:10:00Z", "peer-dispatch"),
      message("Done with the other property", "customer", "2026-10-15T14:15:00Z", "peer-reply"),
    ];
    const attribution = attributeTechnicianReplies(job, [job, peer], messages);
    expect([...attribution.explicit]).toEqual([]);
    expect([...attribution.contextual.keys()]).toEqual(["reply"]);
    expect(attribution.contextual.get("reply")).toBe("dispatch");
    expect([...attribution.unattributed]).toEqual(["peer-reply"]);
  });
  it("verifies a context-attributed reply but never uses it to accuse the technician of silence", () => {
    const messages = [
      message("JOB-1001 details for tomorrow at 10am", "agent", "2026-10-15T14:00:00Z", "dispatch"),
      message("Yes sir thank you for the details", "customer", "2026-10-15T14:05:00Z", "reply"),
      message("Please give an update on JOB-1001 now", "agent", "2026-10-15T16:00:00Z", "request"),
    ];
    const contextual = new Set(["reply"]);
    const accepted = verifyJobEvidence([{ signal: "accepted", message_id: "reply", quote: "Yes sir thank you for the details" }], job, [job, peer], messages, "America/New_York", now, undefined, contextual);
    expect(accepted).toMatchObject([{ signal: "accepted", identity_basis: "thread_context" }]);
    const withRequest = verifyJobEvidence([{ signal: "accepted", message_id: "reply", quote: "Yes sir thank you for the details" }, { signal: "update_request", message_id: "request", quote: "Please give an update on JOB-1001 now" }], job, [job, peer], messages, "America/New_York", now, undefined, contextual);
    expect(deriveJobStatus(job, withRequest, messages, true, now, "America/New_York")).toBe("take_job_update");
    const explicit = verifyJobEvidence([{ signal: "accepted", message_id: "accept2", quote: "JOB-1001 accepted, I will take this job" }, { signal: "update_request", message_id: "request", quote: "Please give an update on JOB-1001 now" }], job, [job, peer], [message("JOB-1001 accepted, I will take this job", "customer", "2026-10-15T13:00:00Z", "accept2"), ...messages.slice(2)], "America/New_York", now);
    expect(deriveJobStatus(job, explicit, [message("JOB-1001 accepted, I will take this job", "customer", "2026-10-15T13:00:00Z", "accept2"), ...messages.slice(2)], true, now, "America/New_York")).toBe("send_dose");
  });
  it("accepts a context-attributed completion for this job and marks how identity was established", () => {
    const quote = "I have finished the installation and cleaned up.";
    const messages = [message("JOB-1001 details for tomorrow at 10am", "agent", "2026-10-15T13:00:00Z", "dispatch"), message(quote, "customer", "2026-10-15T14:30:00Z", "reply")];
    const attribution = attributeTechnicianReplies(job, [job, peer], messages);
    const result = verifyJobEvidence([{ signal: "completed", message_id: "reply", quote }], job, [job, peer], messages, "America/New_York", now, undefined, new Set(attribution.contextual.keys()));
    expect(result).toMatchObject([{ quote, identity_basis: "thread_context" }]);
    expect(deriveJobStatus(job, result, messages, true, now, "America/New_York")).toBe("payment_pending");
  });
  it("does not treat call recordings, transcripts, summaries or reactions as technician replies", () => {
    const messages = [
      { ...message("JOB-1001 details for tomorrow at 10am", "agent", "2026-10-15T13:00:00Z", "dispatch"), status: "delivered" },
      { ...message("Call transcript: Customer: I am on my way.", "customer", "2026-10-15T14:00:00Z", "transcript"), status: "call.transcript.completed" },
      { ...message("Reacted 🙏 to “JOB-1001 details”", "customer", "2026-10-15T14:01:00Z", "reaction"), status: "received" },
      { ...message("Call completed.", "customer", "2026-10-15T14:02:00Z", "call"), status: "completed" },
    ];
    expect(isTechnicianText(messages[1])).toBe(false);
    expect(isTechnicianText(messages[2])).toBe(false);
    expect(isTechnicianText(messages[3])).toBe(false);
    const attribution = attributeTechnicianReplies(job, [job, peer], messages);
    expect(attribution.technicianTexts.size).toBe(0);
    expect(attribution.callEvents).toBe(3);
  });
  it("ends context when the technician switches to another job before a generic completion", () => {
    const messages = [message("JOB-1001 details", "agent", "2026-10-15T13:00:00Z", "dispatch"),
      message("About JOB-1002, I need more materials", "customer", "2026-10-15T14:00:00Z", "switch"),
      message("Finished the installation and cleaned up", "customer", "2026-10-15T14:01:00Z", "done")];
    const attribution = attributeTechnicianReplies(job, [job, peer], messages);
    expect(attribution.contextual.size).toBe(0);
    const verified = verifyJobEvidence([{ signal: "completed", message_id: "done", quote: messages[2].text }], job, [job, peer], messages, "America/New_York", now, undefined, new Set(attribution.contextual.keys()));
    expect(verified).toEqual([]);
    expect(deriveJobStatus(job, verified, messages, true, now, "America/New_York")).toBe("take_job_update");
  });
  it("requires a delivered earlier dispatch in the same conversation", () => {
    const dispatch = message("JOB-1001 details", "agent", "2026-10-15T13:00:00Z", "dispatch");
    const reply = message("Finished the installation and cleaned up", "customer", "2026-10-15T14:00:00Z", "done");
    for (const messages of [
      [{ ...dispatch, status: "failed" }, reply],
      [dispatch, { ...reply, message_time: dispatch.message_time }],
      [dispatch, { ...reply, conversation_id: "another-chat" }],
    ]) expect(attributeTechnicianReplies(job, [job, peer], messages).contextual.size).toBe(0);
  });
  it.each(["Ok", "Done"])("supports the complete short reply %s only within verified job context", (quote) => {
    const signal = quote === "Ok" ? "accepted" : "completed";
    const messages = [message("JOB-1001 details", "agent", "2026-10-15T13:00:00Z", "dispatch"), message(quote, "customer", "2026-10-15T14:30:00Z", "reply")];
    const contextual = new Set(attributeTechnicianReplies(job, [job, peer], messages).contextual.keys());
    const candidate = [{ signal, message_id: "reply", quote }];
    const verified = verifyJobEvidence(candidate, job, [job, peer], messages, "America/New_York", now, undefined, contextual);
    expect(verified).toMatchObject([{ signal, quote, identity_basis: "thread_context" }]);
    expect(deriveJobStatus(job, verified, messages, true, now, "America/New_York")).toBe(quote === "Done" ? "payment_pending" : "take_job_update");
    expect(verifyJobEvidence(candidate, job, [job, peer], messages, "America/New_York", now)).toEqual([]);
    expect(verifyJobEvidence(candidate, job, [job, peer], [messages[0], { ...messages[1], text: `Not ${quote} yet` }], "America/New_York", now, undefined, contextual)).toEqual([]);
  });
  it("rejects a model-selected transcript or reaction even when its text names the job", () => {
    const messages = [
      { ...message("Call transcript: JOB-1001 is completed"), status: "call.transcript.completed" },
      message("Reacted to JOB-1001 is completed"),
    ];
    for (const source of messages) expect(evidence([source])).toEqual([]);
  });
  it.each(["10 Sample St Apt 22 is completed", "10 Sample St is completed"])("does not bypass a conflicting/missing apartment through thread context: %s", (text) => {
    const messages = [message("JOB-1001 details", "agent", "2026-10-15T13:00:00Z", "dispatch"),
      message(text, "customer", "2026-10-15T14:00:00Z", "conflict"),
      message("Finished the installation and cleaned up", "customer", "2026-10-15T14:01:00Z", "done")];
    const attribution = attributeTechnicianReplies(job, [job, peer], messages);
    expect(attribution.contextual.size).toBe(0);
    expect([...attribution.unattributed]).toEqual(["conflict", "done"]);
  });
  it.each(["customer_name", "customer_phone", "address"] as const)("does not use context to resolve shared %s that direct matching found ambiguous", (field) => {
    const duplicate = { ...peer, [field]: job[field] };
    const text = `${job[field]} is completed`;
    const messages = [message("JOB-1001 details", "agent", "2026-10-15T13:00:00Z", "dispatch"),
      message(text, "customer", "2026-10-15T14:00:00Z", "ambiguous"),
      message("Finished the installation and cleaned up", "customer", "2026-10-15T14:01:00Z", "done")];
    const attribution = attributeTechnicianReplies(job, [job, duplicate], messages);
    expect(attribution.explicit.size).toBe(0);
    expect(attribution.contextual.size).toBe(0);
  });
});
