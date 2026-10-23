import { describe, expect, it } from "vitest";
import { paymentWindowStart, selectPaymentWindow, verifyPaymentFacts, type PaymentWindow } from "../../supabase/functions/_shared/processor-payment";
import type { JobMessage } from "../../supabase/functions/_shared/processor-job-status";

const msg = (id: string, sender: string, text: string | null, at: string, status = "received"): JobMessage => ({ id, conversation_id: "cust", sender, text, message_time: at, status });
const window: PaymentWindow = { start: "2026-10-14T16:00:00Z", omitted: 0, conversations: 1, messages: [
  { id: "ask", at: "2026-10-15T17:00:00Z", from: "our_team", text: "Your total is $180, please pay today" },
  { id: "promise", at: "2026-10-15T18:00:00Z", from: "customer", text: "I will pay on Friday" },
] };

describe("customer payment window", () => {
  it("starts a day before completion, or the appointment day, never before the lead", () => {
    const job = { created_at: "2026-10-08T15:00:00Z", scheduled_date: "2026-10-15" };
    expect(paymentWindowStart(job, "2026-10-15T16:00:00Z")).toBe("2026-10-14T16:00:00.000Z");
    expect(paymentWindowStart(job, null)).toBe("2026-10-14T00:00:00.000Z");
    expect(paymentWindowStart({ created_at: "2026-10-15T15:00:00Z", scheduled_date: null }, "2026-10-15T16:00:00Z")).toBe("2026-10-15T15:00:00.000Z");
  });
  it("keeps customer and our texts only, oldest first, from the window start", () => {
    const result = selectPaymentWindow([msg("late", "customer", "Paid", "2026-10-16T10:00:00Z"), msg("early", "customer", "hello", "2026-10-01T10:00:00Z"),
      msg("ask", "agent", "Please pay", "2026-10-15T17:00:00Z", "delivered"), msg("call", "customer", "Call completed.", "2026-10-15T17:30:00Z"), msg("blank", "customer", null, "2026-10-15T17:40:00Z")], "2026-10-14T16:00:00Z", 2);
    expect(result.messages.map((m) => [m.id, m.from])).toEqual([["ask", "our_team"], ["late", "customer"]]);
    expect(result).toMatchObject({ conversations: 2, omitted: 0 });
  });
});

describe("payment fact verification", () => {
  it("keeps a promise with the customer's words and a real date", () => {
    expect(verifyPaymentFacts({ state: "promised", promised_date: "2026-10-17", evidence: [{ signal: "promised", message_id: "promise", quote: "I will pay on Friday" }] }, window))
      .toMatchObject({ state: "promised", promised_date: "2026-10-17", waiting_since: null });
    expect(verifyPaymentFacts({ state: "promised", promised_date: "2026-02-30", evidence: [{ signal: "promised", message_id: "promise", quote: "I will pay" }] }, window).promised_date).toBeNull();
  });
  it.each([["promised", "promised"], ["refused", "refused"], ["customer_says_paid", "says_paid"]])("downgrades %s without the customer's own quote", (state, signal) => {
    expect(verifyPaymentFacts({ state, evidence: [{ signal, message_id: "ask", quote: "please pay today" }] }, window).state).toBe("unclear");
  });
  it("is waiting on the customer only when they have not replied since our request", () => {
    const silent: PaymentWindow = { ...window, messages: [window.messages[0]] };
    expect(verifyPaymentFacts({ state: "waiting_on_customer", evidence: [{ signal: "asked", message_id: "ask", quote: "please pay today" }] }, silent)).toMatchObject({ state: "waiting_on_customer", waiting_since: "2026-10-15T17:00:00Z" });
    expect(verifyPaymentFacts({ state: "waiting_on_customer", evidence: [{ signal: "asked", message_id: "ask", quote: "please pay today" }] }, window).state).toBe("unclear");
    expect(verifyPaymentFacts({ state: "waiting_on_customer", evidence: [] }, silent).state).toBe("unclear");
  });
  it("reports no chat instead of guessing, and treats junk output as unclear", () => {
    expect(verifyPaymentFacts({ state: "promised" }, { ...window, messages: [] }).state).toBe("no_chat");
    expect(verifyPaymentFacts("nonsense", window).state).toBe("unclear");
  });
});
