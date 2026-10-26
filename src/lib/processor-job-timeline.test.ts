import { describe, expect, it } from "vitest";
import { buildJobTimeline, namesThisJob, timelineFacts, timelineSettlesJob } from "../../supabase/functions/_shared/processor-job-timeline";
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
  it.each(["👍 to “Active Zelle: synthetic@example.invalid”", "Laughed at “Hi, kindly confirm if you received complete customer details?”", "Questioned “*Customer # 1* Customer Name: Dana Synthetic Customer Number: (212) 555-0142”", "Loved an image"])("ignores the reaction %s", (text) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:30:00Z", text), tech("2026-10-03T20:00:00Z", text)], job);
    expect(t).toMatchObject({ took_job: null, completed: null, share_sent: null });
  });
  it.each(["\u200b👍\u200b to “ Abraham, kindly check & confirm if you received complete customer details ? ” ", "Liked “*Customer # 1* Customer Name: Dana Synthetic Customer Number: (212) 555-0142”"])("reads a like on our confirm prompt or this job's details as taking the job: %s", (text) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:30:00Z", text)], job);
    expect(t.took_job).toMatchObject({ at: "2026-10-01T22:30:00Z" });
  });
  it("reads a like on the visit reminder as the visit confirmed, and so the job taken", () => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)),
      team("2026-10-03T11:00:00Z", "Hi Abraham, This is the Automated Reminder, You have to visit the following customer today between 9-11am"),
      tech("2026-10-03T11:05:00Z", "Liked “Hi Abraham, This is the Automated Reminder, You have to visit the following customer today between 9-11am”")], job);
    expect(t).toMatchObject({ visit_confirmed: { at: "2026-10-03T11:05:00Z" }, took_job: { at: "2026-10-03T11:05:00Z" } });
  });
  it.each([
    ["Duncan please confirm if you get the complete customer details here ?", "Ok."],
    ["Gini confirm if you get the complete details of Customer #1 ?", "Kk"],
    ["Gini, kindly check if you got the details ?", "K"],
    ["Isiah, kindly check & confirm if you also got the details for tomorrow's customer ?", "Sounds good"],
    ["Received??", "Confirmed"],
    ["Alex, kindly check & confirm if you received complete customer details ?", "Thank you, confirm"],
    ["Artnell, kindly check & confirm if you received complete customer details ?", "I received"],
    ["Tristan, kindly check & confirm if you received complete customer details?", "Recieved"],
    ["Glenn, kindly check & confirm if you received complete customer details?", "Comfirmed"],
    ["Haseeb, kindly check and confirm if you received complete customer details?", "Hi ok"],
    ["Carlos, kindly check & confirm if you received complete customer details?", "Si"],
    ["Gal, kindly check & confirm if you received complete customer details ?", "Got details will call the customer in a moment"],
  ])("reads the confirm prompt '%s' answered '%s' as taking the job", (prompt, reply) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), team("2026-10-01T22:28:00Z", prompt), tech("2026-10-01T22:35:00Z", reply)], job);
    expect(t.took_job).toMatchObject({ quote: reply });
  });
  it.each(["No I can't do it", "Ok but it's too far", "Received? Who is the customer?"])("does not read the refusal or question '%s' as taking the job", (reply) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), team("2026-10-01T22:28:00Z", "kindly check & confirm if you received complete customer details ?"), tech("2026-10-01T22:35:00Z", reply)], job);
    expect(t.took_job).toBeNull();
  });
  const updateTemplate = "Hi Abraham, how are you, Can you please update me about the job *Customer # 1* is it in progress or completed ?\n\n*Customer # 1*\nCustomer Name: Dana Synthetic\n\nActive Zelle:\nsynthetic@example.invalid\n\nHere you can send our shares on Zelle, and also send screenshot of the transaction";
  it("reads our update template (which carries the Zelle details) as an update request, not a share request or completion", () => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), team("2026-10-03T23:00:00Z", updateTemplate)], job);
    expect(t).toMatchObject({ update_requested: { at: "2026-10-03T23:00:00Z" }, share_requested: null, completed: null, share_state: "none" });
  });
  it.each([["Done", { completed: { quote: "Done", by: "technician" }, share_sent: null }], ["Sent", { share_sent: { quote: "Sent" }, share_state: "sent" }]] as const)("reads '%s' after the update template", (reply, expected) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), team("2026-10-03T23:00:00Z", updateTemplate), tech("2026-10-03T23:30:00Z", reply)], job);
    expect(t).toMatchObject(expected);
  });
  it.each([
    "okay, in the meantime you can send the payment for previous job please.",
    "We can compensate with you, we will not taking the our shares from the last scheduled job.",
    "I just updated my accounts department that you will send the payment once the job completed.",
    "The customer just agreed to send the payment now, can I get $345 in your cashapp?",
    "Hi, let me know if you completed the job yesterday? And let me know also if you sent our shares?",
  ])("does not read '%s' as this job's share request", (text) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), team("2026-10-03T23:00:00Z", text)], job);
    expect(t).toMatchObject({ share_requested: null, completed: null });
  });
  const asked = () => [team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), team("2026-10-04T00:33:00Z", "Active Zelle: synthetic@example.invalid\nHere you can send our shares on Zelle, and also send screenshot of the transaction")];
  it.each(["Thanks, let me check & confirm with my accounts department.", "Got screenshot, let me check with my accounts department.", "Thanks Let me forward this to accounts department"])("reads our screenshot acknowledgement '%s' as the share sent", (text) => {
    const t = buildJobTimeline([...asked(), team("2026-10-04T02:00:00Z", text)], job);
    expect(t).toMatchObject({ share_checking: { quote: text }, share_state: "sent" });
  });
  it("does not read an accounts-department reply without any payment talk, or about arranging payment, as the share sent", () => {
    expect(buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), team("2026-10-02T10:00:00Z", "Thanks, let me check with my accounts department.")], job).share_checking).toBeNull();
    expect(buildJobTimeline([...asked(), team("2026-10-04T02:00:00Z", "Ok Let me ask our accounts department if they can arrange the cashapp")], job)).toMatchObject({ share_checking: null, share_state: "requested" });
  });
  it.each(["We haven't received the payment yet, kindly check.", "Kindly check, it shows pending on our side."])("goes back to requested when we say '%s' after checking", (text) => {
    const t = buildJobTimeline([...asked(), team("2026-10-04T02:00:00Z", "Thanks, let me check & confirm with my accounts department."), team("2026-10-05T10:00:00Z", text)], job);
    expect(t.share_state).toBe("requested");
  });
  it.each([["Yea", "sent"], ["yes", "sent"], ["Yes tomorrow", "requested"], ["I have to send 60?", "requested"]] as const)("reads '%s' to 'Did you send the payment?' as %s", (reply, state) => {
    const t = buildJobTimeline([...asked(), team("2026-10-05T10:00:00Z", "Hi, did you send the payment ?"), tech("2026-10-05T10:05:00Z", reply)], job);
    expect(t.share_state).toBe(state);
  });
  it.each(["I sent over the estimate. I haven't heard anything back yet", "I sent the report and the invoice just now.", "Sent- hot tub job"])("reads the reply '%s' after the update template correctly", (reply) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), team("2026-10-03T23:00:00Z", updateTemplate), tech("2026-10-03T23:30:00Z", reply)], job);
    expect(t.share_sent?.quote ?? null).toBe(reply.startsWith("Sent") ? reply : null);
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
  it.each(["Hey, I'm done", "I just finished now.", "Done with the work", "good morning Ryan the job is completed. The customer is very satisfied.", "Its completed. She was happy. The shelves were straight and level.",
    "Good evening. Everything went successfully, the client is happy.", "She paid $190 by check.", "Yes, I collected the 199", "I already fixed the electrical problem. The light was flickering."])("reads the completion report '%s'", (text) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), tech("2026-10-03T20:00:00Z", text)], job);
    expect(t.completed).toMatchObject({ by: "technician", quote: text });
  });
  it.each(["I did, he paid his deposit.", "I'm already here. I finished my previous job early, so I arrived ahead of schedule.", "I fixed the leak but need to come back for the faucet.",
    "Everything went well with the diagnostic. It needs a new motor.", "She only paid me $40 for my visit."])("does not read '%s' as this job completed", (text) => {
    const t = buildJobTimeline([team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), tech("2026-10-03T20:00:00Z", text)], job);
    expect(t.completed).toBeNull();
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
  const picture = (at: string, text = "[picture]"): PromptMessage => ({ ...tech(at, text), images: 1 });
  it("reads the technician's picture after our share request as the payment screenshot", () => {
    const t = buildJobTimeline([...asked(), picture("2026-10-04T03:00:00Z")], job);
    expect(t).toMatchObject({ share_screenshot: { at: "2026-10-04T03:00:00Z", quote: "[picture]" }, share_state: "sent" });
    expect(timelineFacts(t).evidence).toContainEqual(expect.objectContaining({ signal: "share_sent", from: "technician", quote: "[picture]" }));
  });
  it("reads a picture days after the technician promised our share as the screenshot", () => {
    const t = buildJobTimeline([...asked(), tech("2026-10-04T01:00:00Z", "I will send you the money tonight"), picture("2026-10-07T09:00:00Z")], job);
    expect(t).toMatchObject({ share_state: "sent", share_screenshot: { at: "2026-10-07T09:00:00Z" } });
  });
  it.each([
    ["job photos before we asked for our share", () => [team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), picture("2026-10-03T20:00:00Z")]],
    ["a picture captioned as job photos", () => [...asked(), picture("2026-10-04T03:00:00Z", "Before and after of the install")]],
    ["a picture after only our update template", () => [team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), team("2026-10-03T23:00:00Z", updateTemplate), picture("2026-10-03T23:30:00Z")]],
  ])("does not read %s as the payment screenshot", (_label, chat) => {
    const t = buildJobTimeline(chat(), job);
    expect(t.share_screenshot).toBeNull();
    expect(t.share_state).not.toBe("sent");
  });
  it("goes back to requested when we say we did not receive it after the screenshot", () => {
    const t = buildJobTimeline([...asked(), picture("2026-10-04T03:00:00Z"), team("2026-10-05T10:00:00Z", "We haven't received the payment yet, kindly check.")], job);
    expect(t.share_state).toBe("requested");
  });
  it("lets a picture-only message after the job settle it by rules", () => {
    const chat = [team("2026-10-01T22:27:00Z", details(1)), tech("2026-10-01T22:40:00Z", "ok"), tech("2026-10-03T20:00:00Z", "Done"), picture("2026-10-03T20:01:00Z")];
    expect(timelineSettlesJob(buildJobTimeline(chat, job), chat)).toBe(true);
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
