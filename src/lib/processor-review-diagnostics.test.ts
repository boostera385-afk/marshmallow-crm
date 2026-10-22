import { describe, expect, it } from "vitest";
import { processorReviewDiagnostics, selectProcessorAiMessages } from "../../supabase/functions/_shared/processor-review-diagnostics";
import type { JobIdentity, JobMessage } from "../../supabase/functions/_shared/processor-job-status";
const job: JobIdentity = { id: "target", job_id: "JOB-1001", customer_name: "Synthetic Customer", customer_phone: null, address: "10 Sample St", tech_number: "4155550199", scheduled_date: "2026-10-22", scheduled_time_start: "10:00", scheduled_time_end: null, status: "scheduled", updated_at: "2026-10-21T12:00:00Z", created_at: "2026-10-20T12:00:00Z" };
const peer = { ...job, id: "other", job_id: "JOB-1002", customer_name: "Other Customer", address: "12 Other St" };
const message = (id: string, text: string | null, sender: string, status = "received"): JobMessage => ({ id, text, sender, status, conversation_id: "saved-chat", message_time: "2026-10-22T15:00:00Z" });
describe("processor review attribution and provider budget", () => {
  it("sends only latest job messages plus older update keywords, never another job's keyword", () => {
    const messages = [message("old-completion", "JOB-1001 was completed", "customer"),
      ...Array.from({ length: 100 }, (_, i) => message(`note-${i}`, `JOB-1001 fixture colour note ${i}`, "customer")),
      message("peer-completion", "JOB-1002 was completed", "customer")];
    const attributed = processorReviewDiagnostics(job, [job, peer], messages).extractable;
    const selected = selectProcessorAiMessages(attributed);
    expect(attributed).toHaveLength(101);
    expect(selected).toHaveLength(21);
    expect(selected[0].id).toBe("old-completion");
    expect(selected.at(-1)?.id).toBe("note-99");
    expect(selected.some((item) => item.id === "peer-completion" || item.id === "note-0")).toBe(false);
  });
  it("keeps negation/future wording intact and retains latest non-English replies without keyword guesses", () => {
    const messages = [message("negative", "JOB-1001 is not done yet; might finish tomorrow", "customer"),
      ...Array.from({ length: 25 }, (_, i) => message(`note-${i}`, `JOB-1001 fixture colour ${i}`, "customer")),
      message("latest", "JOB-1001 کام ابھی جاری ہے", "customer")];
    const selected = selectProcessorAiMessages(processorReviewDiagnostics(job, [job], messages).extractable);
    expect(selected[0]).toEqual(messages[0]);
    expect(selected.at(-1)).toEqual(messages.at(-1));
    expect(selected).toHaveLength(21);
  });
  it("context-attributes a technician reply to this job's saved dispatch", () => {
    const messages = [message("dispatch", "Dispatch JOB-1001 tomorrow at 10am", "agent", "delivered"), { ...message("reply", "Finished and ready for payment", "customer"), message_time: "2026-10-22T15:01:00Z" }];
    const result = processorReviewDiagnostics(job, [job], messages);
    expect(result).toMatchObject({ matched_technician_messages: 0, context_technician_messages: 1, unattributed_technician_messages: 0, technician_text_messages: 1, call_event_messages: 0 });
    expect(result.relevant).toEqual(messages);
    expect(result.extractable).toEqual(messages);
    expect([...result.contextual_ids]).toEqual(["reply"]);
  });
  it("retains identified technician replies and delivered request candidates, not peer text or unsent claims", () => {
    const messages = [message("done", "JOB-1001 installation completed", "customer"), message("request", "How is JOB-1001 going?", "agent", "delivered"), message("unsent", "What is the update on JOB-1001?", "agent", "failed"), message("peer", "JOB-1002 is completed", "customer"), message("media", null, "customer")];
    const result = processorReviewDiagnostics(job, [job, peer], messages);
    expect(result.extractable).toEqual(messages.slice(0, 2));
    expect(result).toMatchObject({ matched_technician_messages: 1, context_technician_messages: 0, unattributed_technician_messages: 1, call_event_messages: 1 });
  });
  it("never assigns a reply that follows another job's dispatch or names another job", () => {
    const messages = [message("mine", "Dispatch JOB-1001 tomorrow at 10am", "agent", "delivered"), message("peer-dispatch", "Customer Name: Other Customer Customer Address: 12 Other St", "agent", "delivered"), message("reply", "Ok thank you", "customer")];
    const result = processorReviewDiagnostics(job, [job, peer], messages);
    expect(result).toMatchObject({ matched_technician_messages: 0, context_technician_messages: 0, unattributed_technician_messages: 1 });
    expect(result.extractable).toEqual([]);
  });
  it("excludes call recordings, transcripts, summaries and reactions from technician replies", () => {
    const messages = [message("dispatch", "Dispatch JOB-1001 tomorrow at 10am", "agent", "delivered"),
      { ...message("call", "Call completed.", "customer", "completed"), message_time: "2026-10-22T15:01:00Z" },
      { ...message("transcript", "Call transcript: Agent: hello. Customer: I am on my way.", "customer", "call.transcript.completed"), message_time: "2026-10-22T15:02:00Z" },
      { ...message("reaction", "Reacted 🙏 to “Dispatch JOB-1001…”", "customer"), message_time: "2026-10-22T15:03:00Z" },
      { ...message("reply", "Ok thank you", "customer"), message_time: "2026-10-22T15:04:00Z" }];
    const result = processorReviewDiagnostics(job, [job], messages);
    expect(result).toMatchObject({ matched_technician_messages: 0, context_technician_messages: 1, unattributed_technician_messages: 0, technician_text_messages: 1, call_event_messages: 3 });
    expect(result.extractable.map((item) => item.id)).toEqual(["dispatch", "reply"]);
  });
  it("does not inherit context across an unknown job's customer-details dispatch", () => {
    const messages = [{ ...message("mine", "Dispatch JOB-1001 tomorrow at 10am", "agent", "delivered"), message_time: "2026-10-22T15:00:00Z" },
      { ...message("unknown", "Customer Name: Someone Else Customer Address: 99 Unknown Rd", "agent", "delivered"), message_time: "2026-10-22T15:10:00Z" },
      { ...message("reply", "Done", "customer"), message_time: "2026-10-22T15:15:00Z" }];
    const result = processorReviewDiagnostics(job, [job], messages);
    expect(result).toMatchObject({ context_technician_messages: 0, unattributed_technician_messages: 1 });
    expect(result.extractable).toEqual([]);
  });
  it("does not carry an old dispatch across the bounded context window", () => {
    const messages = [{ ...message("mine", "Dispatch JOB-1001 tomorrow at 10am", "agent", "delivered"), message_time: "2026-10-20T15:00:00Z" },
      { ...message("reply", "Done", "customer"), message_time: "2026-10-30T15:00:00Z" }];
    const result = processorReviewDiagnostics(job, [job], messages);
    expect(result).toMatchObject({ context_technician_messages: 0, unattributed_technician_messages: 1 });
  });
});
