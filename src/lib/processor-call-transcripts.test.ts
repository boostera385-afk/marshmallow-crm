// @vitest-environment node
import { describe, expect, it } from "vitest";
import { processorCallTranscripts, type StoredProcessorCall } from "../../supabase/functions/_shared/processor-call-transcripts";
import { attributeTechnicianReplies, deriveJobStatus, verifyJobEvidence, type JobIdentity } from "../../supabase/functions/_shared/processor-job-status";
const options = { conversationId: "CN12345678", phoneNumberId: "PN12345678", technicianPhone: "4155550199", since: "2026-10-01T00:00:00Z", until: "2026-10-23T18:00:00Z" };
const job: JobIdentity = { id: "job", job_id: "JOB-1001", customer_name: "John Sample", customer_phone: "4155550101", address: "10 Sample St", tech_number: options.technicianPhone, status: "scheduled", scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", scheduled_time_end: null, updated_at: options.since, created_at: options.since };
const part = (content: string, start = 5, userId: string | null = null, identifier: string | null = "+14155550199") => ({ content, start, end: start + 2, userId, identifier });
function fixture(dialogue: unknown[] = [part("JOB-1001 is completed and ready for payment")]): StoredProcessorCall[] {
  return [{ id: "original", quo_message_id: "AC123456:call.completed", conversation_id: "mirror", raw_payload: { type: "call.completed", data: { object: { id: "AC123456", conversationId: options.conversationId, phoneNumberId: options.phoneNumberId, from: "+14155550199", to: ["+17475887812"], createdAt: "2026-10-15T16:00:00Z", answeredAt: "2026-10-15T16:00:01Z", completedAt: "2026-10-15T16:01:00Z" } } } },
    { id: "transcript", quo_message_id: "AC123456:call.transcript.completed", conversation_id: "mirror", raw_payload: { type: "call.transcript.completed", data: { object: { callId: "AC123456", status: "completed", createdAt: "2026-10-20T00:00:00Z", dialogue } } } }];
}
describe("speaker-verified saved call transcripts", () => {
  it("uses the exact technician, source row and actual call time, not the later transcript delivery time", () => {
    const read = processorCallTranscripts(fixture(), options);
    const segment = read.messages.find((m) => m.source === "call_transcript")!;
    expect(segment).toMatchObject({ sender: "customer", source_message_id: "transcript", call_id: "AC123456", message_time: "2026-10-15T16:00:05.000Z" });
    const evidence = verifyJobEvidence([{ signal: "completed", quote: segment.text, message_id: segment.id }], job, [], read.messages, "America/New_York", new Date(options.until));
    expect(evidence).toMatchObject([{ source: "call_transcript", call_id: "AC123456", source_message_id: "transcript" }]);
    expect(deriveJobStatus(job, evidence, read.messages, true, new Date(options.until), "America/New_York")).toBe("payment_pending");
    expect(read.coverage).toEqual({ state: "available", checked: 1, missing: 0, skipped_segments: 0 });
  });
  it.each([part("JOB-1001 is completed", 5, "USagent"), part("JOB-1001 is completed", 5, null, "+1415550188"), part("JOB-1001 is completed", 5, null, null)])("never turns our team's words or unknown/other speakers into technician evidence: %j", (dialogue) => {
    const read = processorCallTranscripts(fixture([dialogue]), options);
    const segment = read.messages.find((m) => m.source === "call_transcript")!;
    expect(verifyJobEvidence([{ signal: "completed", quote: "JOB-1001 is completed", message_id: segment.id }], job, [], read.messages, "America/New_York", new Date(options.until))).toEqual([]);
  });
  it("allows context only within this call, stops at another job and never borrows a text dispatch", () => {
    const rows = fixture([part("Update on JOB-1001 please", 0, "USagent", null), part("Finished and cleaned up", 5), part("Update on JOB-1002 please", 10, "USagent", null), part("Also finished and cleaned up", 15)]);
    const read = processorCallTranscripts(rows, options);
    const peer = { ...job, id: "peer", job_id: "JOB-1002", customer_name: "Jane Example", customer_phone: "4155550102", address: "20 Other Rd" };
    const attributed = attributeTechnicianReplies(job, [job, peer], read.messages);
    expect([...attributed.contextual.keys()]).toEqual(["transcript:transcript:1"]);
    const noCallQuestion = processorCallTranscripts(fixture([part("Finished and cleaned up")]), options);
    expect(attributeTechnicianReplies(job, [], [{ id: "sms", conversation_id: options.conversationId, sender: "agent", text: "Dispatch JOB-1001", message_time: "2026-10-15T15:00:00Z", status: "delivered" }, ...noCallQuestion.messages]).contextual.size).toBe(0);
  });
  it("stops at an unknown job even when that peer is outside the caller's roster", () => {
    const read = processorCallTranscripts(fixture([part("Update on JOB-1001 please", 0, "USagent", null), part("Update on LD-UNSEEN123 please", 5, "USagent", null), part("Finished and cleaned up", 10)]), options);
    expect(attributeTechnicianReplies(job, [], read.messages).contextual.size).toBe(0);
    const mixed = processorCallTranscripts(fixture([part("JOB-1001 is in progress; LD-UNSEEN123 is completed")]), options);
    const segment = mixed.messages.find((m) => m.source === "call_transcript")!;
    expect(verifyJobEvidence([{ signal: "completed", quote: segment.text, message_id: segment.id }], job, [], mixed.messages, "America/New_York", new Date(options.until))).toEqual([]);
  });
  it.each(["missing_original", "wrong_line", "wrong_technician", "wrong_conversation", "outside_lifetime", "unfinished", "plain_text"])("refuses unverifiable transcript input: %s", (kind) => {
    const rows = fixture();
    const original = (rows[0].raw_payload as { data: { object: Record<string, unknown> } }).data.object;
    const transcript = (rows[1].raw_payload as { data: { object: Record<string, unknown> } }).data.object;
    if (kind === "missing_original") rows.shift();
    if (kind === "wrong_line") original.phoneNumberId = "PNother";
    if (kind === "wrong_technician") original.from = "+1415550188";
    if (kind === "wrong_conversation") original.conversationId = "CNother";
    if (kind === "outside_lifetime") original.createdAt = "2026-09-01T00:00:00Z";
    if (kind === "unfinished") transcript.status = "in-progress";
    if (kind === "plain_text") { delete transcript.dialogue; transcript.transcript = "Customer: JOB-1001 completed"; }
    const read = processorCallTranscripts(rows, options);
    expect(read.messages.filter((m) => m.source === "call_transcript")).toEqual([]);
    expect(read.coverage.state).toBe("partial");
  });
  it("does not use a late transcript to claim an older visit completed the new appointment", () => {
    const read = processorCallTranscripts(fixture(), options);
    const segment = read.messages.find((m) => m.source === "call_transcript")!;
    expect(verifyJobEvidence([{ signal: "completed", quote: segment.text, message_id: segment.id }], { ...job, scheduled_date: "2026-10-20" }, [], read.messages, "America/New_York", new Date(options.until))).toEqual([]);
  });
  it("retains an answered-call response event when the transcript is missing, without inventing an outcome", () => {
    const read = processorCallTranscripts(fixture().slice(0, 1), options);
    expect(read.coverage).toMatchObject({ state: "partial", checked: 0, missing: 1 });
    expect(read.messages).toMatchObject([{ status: "call.completed", sender: "customer", text: null }]);
    expect(deriveJobStatus(job, [], read.messages, true, new Date(options.until), "America/New_York")).toBe("take_job_update");
  });
  it("prevents Send Dose after an answered call, even when its transcript is missing", () => {
    const read = processorCallTranscripts(fixture().slice(0, 1), options);
    const evidence = [{ signal: "accepted" as const, message_id: "accept", sender: "customer", quote: "JOB-1001 accepted", message_time: "2026-10-15T14:00:00Z" }, { signal: "update_request" as const, message_id: "request", sender: "agent", quote: "Update on JOB-1001 please", message_time: "2026-10-15T15:00:00Z" }];
    expect(deriveJobStatus(job, evidence, [], true, new Date(options.until), "America/New_York")).toBe("send_dose");
    expect(deriveJobStatus(job, evidence, read.messages, true, new Date(options.until), "America/New_York")).toBe("take_job_update");
    expect(deriveJobStatus(job, evidence.map((item) => item.signal === "accepted" ? { ...item, source: "call_transcript" as const } : item), [], true, new Date(options.until), "America/New_York")).toBe("take_job_update");
  });
  it.each(["JOB-1001 is not completed yet", "JOB-1001 will be completed tomorrow"])("rejects affirmative fragments from negated/future call speech: %s", (text) => {
    const read = processorCallTranscripts(fixture([part(text)]), options);
    const segment = read.messages.find((m) => m.source === "call_transcript")!;
    expect(verifyJobEvidence([{ signal: "completed", quote: text, message_id: segment.id }], job, [], read.messages, "America/New_York", new Date(options.until))).toEqual([]);
  });
  it("excludes invalid segment times without throwing or hiding incomplete coverage", () => {
    const read = processorCallTranscripts(fixture([part("JOB-1001 completed", 1e300)]), options);
    expect(read.coverage).toMatchObject({ state: "partial", skipped_segments: 1 });
    expect(read.messages.find((m) => m.source === "call_transcript")).toMatchObject({ sender: "unknown", text: null });
  });
});
