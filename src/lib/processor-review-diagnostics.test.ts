import { describe, expect, it } from "vitest";
import { processorReviewDiagnostics } from "../../supabase/functions/_shared/processor-review-diagnostics";
import { createJobMatcher, type JobIdentity, type JobMessage } from "../../supabase/functions/_shared/processor-job-status";
const job: JobIdentity = { id: "target", job_id: "JOB-1001", customer_name: "Synthetic Customer", customer_phone: null, address: "10 Sample St", tech_number: "4155550199", scheduled_date: "2026-10-22", scheduled_time_start: "10:00", scheduled_time_end: null, status: "scheduled", updated_at: "2026-10-21T12:00:00Z", created_at: "2026-10-20T12:00:00Z" };
const message = (text: string | null, sender: string, status = "received"): JobMessage => ({ id: text ?? "media", text, sender, status, conversation_id: "saved-chat", message_time: "2026-10-22T15:00:00Z" });
describe("processor review attribution and provider budget", () => {
  it("does not spend AI on a pure dispatch or assign an adjacent generic reply to it", () => {
    const messages = [message("Dispatch JOB-1001 tomorrow at 10am", "agent", "delivered"), message("Finished and ready for payment", "customer")];
    const result = processorReviewDiagnostics(messages, createJobMatcher(job, [job]));
    expect(result).toMatchObject({ matched_technician_messages: 0, unattributed_technician_messages: 1, extractable: [] });
    expect(result.relevant).toEqual([messages[0]]);
  });
  it("retains identified technician replies and delivered request candidates, not peer text or unsent claims", () => {
    const peer = { ...job, id: "other", job_id: "JOB-1002", customer_name: "Other Customer", address: "12 Other St" };
    const messages = [message("JOB-1001 installation completed", "customer"), message("How is JOB-1001 going?", "agent", "delivered"), message("What is the update on JOB-1001?", "agent", "failed"), message("JOB-1002 is completed", "customer"), message(null, "customer")];
    const result = processorReviewDiagnostics(messages, createJobMatcher(job, [job, peer]));
    expect(result.extractable).toEqual(messages.slice(0, 2));
    expect(result).toMatchObject({ matched_technician_messages: 1, unattributed_technician_messages: 1 });
  });
});
