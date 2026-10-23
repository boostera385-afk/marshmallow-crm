import { describe, expect, it } from "vitest";
import { isCallOrSystemEvent, phoneKey, schedulePassed, type JobMessage } from "../../supabase/functions/_shared/processor-job-status";

const job = { scheduled_date: "2026-10-15", scheduled_time_start: "10:00:00" };
const message = (text: string | null, status: string | null = "received"): JobMessage => ({ id: "m", conversation_id: "c", sender: "customer", text, message_time: "2026-10-15T16:00:00Z", status });

describe("Processor chat/time helpers", () => {
  it("evaluates the agreed start in the chosen schedule timezone", () => {
    expect(schedulePassed(job, new Date("2026-10-15T14:00:00Z"), "America/New_York")).toBe(true);
    expect(schedulePassed(job, new Date("2026-10-15T14:00:00Z"), "America/Los_Angeles")).toBe(false);
    expect(schedulePassed({ ...job, scheduled_time_start: null }, new Date("2026-10-16T00:00:00Z"), "UTC")).toBe(false);
    expect(schedulePassed({ scheduled_date: "2026-11-01", scheduled_time_start: "01:30" }, new Date("2026-11-01T06:30:00Z"), "America/New_York")).toBe(true);
  });
  it("treats call rows, summaries and reactions as events, not technician words", () => {
    expect(isCallOrSystemEvent(message("Call completed."))).toBe(true);
    expect(isCallOrSystemEvent(message("Liked \"on my way\""))).toBe(true);
    expect(isCallOrSystemEvent(message(null, "call.completed"))).toBe(true);
    expect(isCallOrSystemEvent(message("On my way to Shanice"))).toBe(false);
  });
  it("normalizes only complete US numbers", () => {
    expect(phoneKey("+1 (415) 555-0199")).toBe("4155550199");
    expect(phoneKey("555-0199")).toBeNull();
  });
});
