import { describe, expect, it } from "vitest";
import { belongsToJob, deriveJobStatus, schedulePassed, verifyJobEvidence, type JobIdentity, type JobMessage } from "../../supabase/functions/_shared/processor-job-status";

const job: JobIdentity = { id: "john", job_id: "JOB-1001", customer_name: "John Sample", customer_phone: "4155550101", address: "10 Sample St Apt 2", tech_number: "4155550199", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, status: "scheduled", updated_at: "2026-10-14T12:00:00Z", created_at: "2026-10-01T12:00:00Z" };
const peer = { ...job, id: "jane", job_id: "JOB-1002", customer_name: "Jane Example", customer_phone: "4155550102", address: "12 Example St" };
const now = new Date("2026-10-15T18:00:00Z");
const message = (text: string, sender = "customer", at = "2026-10-15T16:00:00Z", id = "m1"): JobMessage => ({ id, conversation_id: "tech-chat", sender, text, message_time: at, status: sender === "agent" ? "delivered" : "received" });
function evidence(messages: JobMessage[], signal = "completed") {
  return verifyJobEvidence(messages.map((m) => ({ signal, message_id: m.id, quote: m.text })), job, [job, peer], messages, "America/New_York", now);
}
describe("Processor job isolation", () => {
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
});
