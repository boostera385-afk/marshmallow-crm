import { describe, expect, it } from "vitest";
import { buildJobTimeline, namesThisJob } from "../../supabase/functions/_shared/processor-job-timeline";
import type { PromptMessage } from "../../supabase/functions/_shared/processor-lead-window";

// Synthetic chats in the team's real templates; no real customer data.
const job = { customer_name: "Dana Synthetic", customer_phone: "(212) 555-0142", address: "12 Beverly Rd, New Rochelle, NY 10801" };
let seq = 0;
const team = (at: string, text: string): PromptMessage => ({ id: `m${++seq}`, at, from: "our_team", via: "text", text });
const tech = (at: string, text: string, via: "text" | "call" = "text"): PromptMessage => ({ id: `m${++seq}`, at, from: "technician", via, text });
const details = (n: number, name = "Dana Synthetic", phone = "(212) 555-0142", street = "12 Beverly Rd") =>
  `*Customer # ${n}*\nCustomer Name: ${name}\nCustomer Number: ${phone}\nCustomer Address: ${street}, New Rochelle, NY 10801\nService Details: tile floor restoration`;
const offer = team("2026-10-01T13:59:00Z", "Service Details: Want Floor Restoration of bathroom\nArea: New Rochelle, NY 10801\nplease give me two hours window");

describe("job timeline rules", () => {
  it("reads the standard job flow end to end", () => {
    const t = buildJobTimeline([
      offer,
      tech("2026-10-01T14:14:00Z", "$350"),
      team("2026-10-01T22:27:00Z", details(1)),
      team("2026-10-01T22:28:00Z", "Abraham, kindly check & confirm if you received complete customer details ?"),
      tech("2026-10-01T22:42:00Z", "Ok"),
      team("2026-10-03T11:00:00Z", "Hi Abraham, This is the Automated Reminder, You have to visit the following customer today between 9-11am, Please Text back by \"Yes\""),
      tech("2026-10-03T11:08:00Z", "Yes"),
      team("2026-10-03T23:11:00Z", "Can you please update me about the job *Customer # 1* is it in progress or completed ?"),
      tech("2026-10-04T00:10:00Z", "Done ✅"),
      team("2026-10-04T00:33:00Z", "Thanks for the update this is the Zelle Email:\n\nActive Zelle:\nsynthetic@example.invalid\n\nHere you can send our shares on Zelle"),
      tech("2026-10-04T03:16:00Z", "I'll Zelle you now"),
      tech("2026-10-04T03:20:00Z", "Sent"),
      team("2026-10-05T15:37:00Z", "We received the payment of *Customer # 1*. Thanks"),
    ], job);
    expect(t).toMatchObject({ job_tag: "1", other_jobs_in_window: false, share_state: "received",
      took_job: { quote: "Ok" }, visit_confirmed: { quote: "Yes" }, completed: { quote: "Done ✅", by: "technician" },
      update_requested: { at: "2026-10-03T23:11:00Z" }, share_promised: { quote: "I'll Zelle you now" }, share_sent: { quote: "Sent" } });
  });
  it.each(["Done", "All done.", "Job is done waiting for payment", "The job was completed Saturday", "Yes sir. Work is done", "Completed. Breaker issue with the plug."])("reads the plain completion '%s'", (text) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), tech("2026-10-03T20:00:00Z", text)], job);
    expect(t.completed).toMatchObject({ by: "technician" });
  });
  it.each(["Liked “Hi, kindly confirm if you received complete customer details?”", "👍 to “Active Zelle: synthetic@example.invalid”"])("ignores the reaction %s", (text) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:30:00Z", text), tech("2026-10-03T20:00:00Z", text)], job);
    expect(t).toMatchObject({ took_job: null, completed: null, share_sent: null });
  });
  it.each(["I sent you the contact info for the other contractor", "He sent me Venmo - do you have?", "This is the only screen I can screenshot"])("does not read '%s' as our share being sent", (text) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), team("2026-10-04T00:33:00Z", "Active Zelle: synthetic@example.invalid"), tech("2026-10-04T02:00:00Z", text)], job);
    expect(t.share_sent).toBeNull();
  });
  it("treats a short 'Done' right after our share request as the share, not the job", () => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(2)), tech("2026-10-01T22:40:00Z", "Got it"),
      team("2026-10-04T00:33:00Z", "Active Zelle: synthetic@example.invalid\nHere you can send our shares on Zelle"), tech("2026-10-04T01:00:00Z", "Done")], job);
    expect(t).toMatchObject({ share_state: "sent", share_sent: { quote: "Done" }, completed: { by: "share_request" } });
  });
  it("counts a share request as completion when the tech never typed 'done'", () => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(2)), tech("2026-10-01T22:40:00Z", "Yes"),
      team("2026-10-04T00:33:00Z", "Hi, did you sent our shares ?")], job);
    expect(t).toMatchObject({ share_state: "requested", completed: { by: "share_request", at: "2026-10-04T00:33:00Z" } });
  });
  it.each(["Not done yet", "I will finish tomorrow", "almost done", "She doesn't want the work done today", "He wants to pay when work is done", "I will send it once job is completed", "The complete address please", "I completed the diagnostic, they need to order a replacement screen and I will come back next week to install it"])("never reads '%s' as completed", (text) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), tech("2026-10-03T20:00:00Z", text)], job);
    expect(t.completed).toBeNull();
  });
  it.each([["I haven't sent it", "requested"], ["I will send tomorrow", "promised"], ["sent", "sent"]] as const)("reads the tech's share reply '%s' as %s", (text, state) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"),
      team("2026-10-04T00:33:00Z", "Active Zelle: synthetic@example.invalid"), tech("2026-10-04T02:00:00Z", text)], job);
    expect(t.share_state).toBe(state);
  });
  it("does not give this job another job's replies once that job's details arrive", () => {
    const t = buildJobTimeline([
      team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "Yes"),
      team("2026-10-02T15:00:00Z", details(2, "Other Person", "(212) 555-0199", "40 Elm St")), tech("2026-10-02T15:10:00Z", "Ok"),
      tech("2026-10-03T20:00:00Z", "Done ✅"),
      team("2026-10-03T21:00:00Z", "Active Zelle: synthetic@example.invalid"),
    ], job);
    expect(t).toMatchObject({ job_tag: "1", other_jobs_in_window: true, took_job: { quote: "Yes" }, completed: null, share_state: "none" });
  });
  it("still counts messages that name this job after another job started", () => {
    const t = buildJobTimeline([
      team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "Yes"),
      team("2026-10-02T15:00:00Z", details(2, "Other Person", "(212) 555-0199", "40 Elm St")),
      team("2026-10-05T15:37:00Z", "We received the payment of *Customer # 1*. Thanks"),
    ], job);
    expect(t.share_state).toBe("received");
  });
  it("ignores questions, call lines and replies from days later as acceptance", () => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), team("2026-10-01T22:28:00Z", "kindly check & confirm if you received complete customer details ?"),
      tech("2026-10-01T22:30:00Z", "Yes", "call"), tech("2026-10-05T10:00:00Z", "ok"), team("2026-10-06T10:00:00Z", "Did we received the payment?")], job);
    expect(t).toMatchObject({ took_job: null, share_received: null });
  });
  it("never counts an earlier job's share request or replies sent before this job's details", () => {
    const t = buildJobTimeline([
      team("2026-09-28T10:00:00Z", details(4, "Other Person", "(212) 555-0199", "40 Elm St")), tech("2026-09-28T10:05:00Z", "Done ✅"),
      team("2026-09-29T10:00:00Z", "Active Zelle: synthetic@example.invalid"), tech("2026-09-29T11:00:00Z", "Sent"),
      team("2026-10-01T22:27:00Z", details(5)), tech("2026-10-01T22:40:00Z", "Yes"),
    ], job);
    expect(t).toMatchObject({ job_tag: "5", took_job: { quote: "Yes" }, completed: null, share_requested: null, share_sent: null, share_state: "none", other_jobs_in_window: true });
  });
  it("finds nothing without this job's details message, leaving it to AI", () => {
    const t = buildJobTimeline([offer, tech("2026-10-01T14:20:00Z", "Yes I can do it"), team("2026-10-03T19:00:00Z", "Active Zelle: synthetic@example.invalid"), tech("2026-10-03T20:00:00Z", "done")], job);
    expect(t).toMatchObject({ details: null, took_job: null, completed: null, share_state: "none" });
  });
  it("identifies the job only by exact phone, full name or street", () => {
    expect(namesThisJob("Customer Number: 212-555-0142", job)).toBe(true);
    expect(namesThisJob("Customer Name: Dana Synthetic", job)).toBe(true);
    expect(namesThisJob("Customer Address: 12 Beverly Rd", job)).toBe(true);
    expect(namesThisJob("Customer Name: Dana Other", job)).toBe(false);
  });
});
