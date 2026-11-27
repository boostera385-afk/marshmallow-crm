import { describe, expect, it } from "vitest";
import {
  needsModelCheck,
  phoneVariants,
  ruleVerdict,
  transcript,
  userPrompt,
  verifyModelVerdict,
  windowStart,
  type TechJob,
  type TechMessage,
} from "../../supabase/functions/_shared/lead-tech-status";

const job: TechJob = {
  id: "l1", service_type: "TV Mounting", service_details: "65in TV\non drywall", city: "Austin", state: "TX",
  zip_code: "78701", scheduled_date: "2026-11-28", customer_schedule_requirements: null, terms: "quoted",
  created_at: "2026-11-20T00:00:00Z",
};
const offer: TechMessage = { id: "1", sender: "agent", text: "Can you do TV mounting in Austin on Nov 28 for $120?", message_time: "2026-11-27T10:00:00Z" };
const yes: TechMessage = { id: "2", sender: "customer", text: "Yes I can do it, send the address", message_time: "2026-11-27T10:05:00Z" };

describe("lead tech status rules", () => {
  it("reads from 24h before contact but never before the lead existed", () => {
    expect(windowStart(job, { contacted_at: "2026-11-27T12:00:00Z" })).toBe("2026-11-26T12:00:00.000Z");
    expect(windowStart(job, { contacted_at: "2026-11-20T05:00:00Z" })).toBe("2026-11-20T00:00:00.000Z");
    expect(windowStart(job, { contacted_at: null })).toBeNull();
  });

  it("matches stored phone formats", () => {
    expect(phoneVariants("3055550123")).toEqual(["+13055550123", "13055550123", "3055550123"]);
    expect(phoneVariants("123")).toEqual([]);
  });

  it("decides no chat and no reply without the model", () => {
    expect(ruleVerdict([])?.verdict).toBe("no_chat");
    expect(ruleVerdict([offer])?.verdict).toBe("pending");
    expect(ruleVerdict([offer, yes])).toBeNull();
  });

  it("only re-asks the model when the tech wrote something new", () => {
    expect(needsModelCheck({ verdict: "agreed", verdict_checked_at: "2026-11-27T11:00:00Z" }, "2026-11-27T10:05:00Z")).toBe(false);
    expect(needsModelCheck({ verdict: "agreed", verdict_checked_at: "2026-11-27T11:00:00Z" }, "2026-11-27T12:00:00Z")).toBe(true);
    expect(needsModelCheck({ verdict: "pending", verdict_checked_at: null }, null)).toBe(true);
    expect(needsModelCheck({ verdict: "agreed", verdict_checked_at: "2026-11-27T11:00:00Z" }, null, true)).toBe(true);
  });

  it("keeps an agreed verdict only when the quote is the tech's own words", () => {
    expect(verifyModelVerdict({ verdict: "agreed", reason: "Said yes", quote: "yes I can do it" }, [offer, yes]))
      .toMatchObject({ verdict: "agreed", quote: "yes I can do it", quote_at: yes.message_time });
    // Quoting our own offer is not evidence.
    expect(verifyModelVerdict({ verdict: "agreed", reason: "x", quote: "Can you do TV mounting" }, [offer, yes]).verdict).toBe("unclear");
    expect(verifyModelVerdict({ verdict: "declined", reason: "x", quote: "made up" }, [offer, yes]).verdict).toBe("unclear");
    expect(verifyModelVerdict({ verdict: "sure" }, [offer, yes]).verdict).toBe("unclear");
    expect(verifyModelVerdict({ verdict: "pending", reason: "Asked about parking", quote: "" }, [offer, yes]))
      .toMatchObject({ verdict: "pending", quote: null });
  });

  it("fences the chat as data and labels speakers", () => {
    const prompt = userPrompt(job, [offer, yes]);
    expect(prompt).toContain("BEGIN CHAT");
    expect(prompt).toContain("Service: TV Mounting");
    expect(prompt).toContain("Details: 65in TV on drywall");
    expect(transcript([offer, yes])).toMatch(/OUR TEAM: Can you do.*\n.*TECH: Yes I can do it/);
  });
});
