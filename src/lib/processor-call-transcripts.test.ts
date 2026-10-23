// @vitest-environment node
import { describe, expect, it } from "vitest";
import { processorCallTranscripts, type StoredProcessorCall } from "../../supabase/functions/_shared/processor-call-transcripts";
import { selectLeadWindow, verifyProcessorFacts } from "../../supabase/functions/_shared/processor-lead-window";
const options = { conversationId: "CN12345678", phoneNumberId: "PN12345678", technicianPhone: "4155550199", since: "2026-10-01T00:00:00Z", until: "2026-10-23T18:00:00Z" };
const job = { id: "job", job_id: "JOB-1001", customer_name: "John Sample", customer_phone: "4155550101", address: "10 Sample St", tech_number: options.technicianPhone, scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00", created_at: "2026-10-02T00:00:00Z" };
const part = (content: string, start = 5, userId: string | null = null, identifier: string | null = "+14155550199") => ({ content, start, end: start + 2, userId, identifier });
function fixture(dialogue: unknown[] = [part("John Sample job is completed")], answered = true): StoredProcessorCall[] {
  return [{ id: "original", quo_message_id: "AC123456:call.completed", conversation_id: "mirror", raw_payload: { type: "call.completed", data: { object: { id: "AC123456", conversationId: options.conversationId, phoneNumberId: options.phoneNumberId, from: "+14155550199", to: ["+17475887812"], createdAt: "2026-10-15T16:00:00Z", ...(answered ? { answeredAt: "2026-10-15T16:00:01Z" } : {}), completedAt: "2026-10-15T16:01:00Z" } } } },
    { id: "transcript", quo_message_id: "AC123456:call.transcript.completed", conversation_id: "mirror", raw_payload: { type: "call.transcript.completed", data: { object: { callId: "AC123456", status: "completed", createdAt: "2026-10-20T00:00:00Z", dialogue } } } }];
}
describe("speaker-verified saved call transcripts", () => {
  it("uses the exact technician, source row and actual call time, not the later transcript delivery time", () => {
    const read = processorCallTranscripts(fixture(), options);
    expect(read.messages.find((m) => m.source === "call_transcript")).toMatchObject({ sender: "customer", source_message_id: "transcript", call_id: "AC123456", message_time: "2026-10-15T16:00:05.000Z" });
    expect(read.coverage).toEqual({ state: "available", checked: 1, missing: 0, skipped_segments: 0 });
  });
  it("labels our team's words as ours and drops unknown or other speakers", () => {
    const read = processorCallTranscripts(fixture([part("How is John Sample's job going?", 0, "USagent", null), part("Done", 5, null, "+14155550188"), part("Done", 8, null, null)]), options);
    expect(read.messages.filter((m) => m.source === "call_transcript").map((m) => [m.sender, m.text])).toEqual([["agent", "How is John Sample's job going?"], ["unknown", null], ["unknown", null]]);
    expect(read.coverage).toMatchObject({ state: "partial", skipped_segments: 2 });
  });
  it("keeps an answered call as a response signal when the transcript is missing, without inventing words", () => {
    const read = processorCallTranscripts(fixture().slice(0, 1), options);
    expect(read.messages).toEqual([expect.objectContaining({ id: "call:AC123456", sender: "customer", text: null, status: "call.completed" })]);
    expect(read.coverage).toMatchObject({ state: "partial", missing: 1 });
    expect(processorCallTranscripts(fixture(undefined, false), options).messages).toEqual([]);
  });
  it("never accepts a completion quoted out of negated or future call speech", () => {
    const read = processorCallTranscripts(fixture([part("Job for John Sample is not completed yet, I will finish tomorrow")]), options);
    const window = selectLeadWindow(read.messages, job);
    const segment = window.messages.find((m) => m.via === "call" && m.from === "technician" && m.text.includes("John"))!;
    const facts = verifyProcessorFacts({ enough_context: true, tech_took_job: true, job_update: "completed", evidence: [{ signal: "completed", message_id: segment.id, quote: "is completed" }] }, window);
    expect(facts).toMatchObject({ job_update: "none", evidence: [] });
    expect(verifyProcessorFacts({ enough_context: true, tech_took_job: true, job_update: "completed", evidence: [{ signal: "completed", message_id: segment.id, quote: "all finished" }] }, window).job_update).toBe("none");
  });
});
