import { describe, expect, it } from "vitest";
import type { Lead } from "@/types";
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_CHECK_TEMPLATE,
  DEFAULT_MESSAGE_TEMPLATES,
  resolveTemplate,
  formatTechnicianSchedule,
  renderLeadTemplate,
  technicianMessageTemplate,
} from "./message-templates";

const lead = (over: Partial<Lead> = {}) =>
  ({
    id: "lead-1",
    customer_name: "Synthetic Customer",
    customer_phone: "555-0100",
    address: "1 Test St",
    service_details: "Fix sink",
    scheduled_date: "2024-12-12",
    scheduled_time_start: "09:00",
    scheduled_time_end: "11:30",
    reference_name: null,
    terms: "quoted",
    labor_amount: 300,
    material_amount: 100,
    for_you_amount: 250,
    for_us_amount: 150,
    quote: null,
    ...over,
  }) as unknown as Lead;

const message = (l: Lead, extras: Record<string, string> = {}) =>
  renderLeadTemplate(technicianMessageTemplate(l), l, {
    customer_number: "12",
    reference_name: "",
    ...extras,
  });

describe("technician message by terms (original wording restored)", () => {
  it("writes the quoted message word for word as before June 2026", () => {
    expect(message(lead())).toBe(
      [
        "*Customer # 12*",
        "",
        "Customer Name: Synthetic Customer",
        "Customer Number: 555-0100",
        "Customer Address: 1 Test St",
        "Service: Fix sink",
        "",
        "Customer is agreed to pay ($300) total labor",
        "($100) FOR MATERIALS",
        "",
        "For you: $250 labor including material",
        "For us: $150 from total labor",
        "",
        "Job Scheduled for: THURSDAY 12th December between 9:00am-11:30am",
        "",
      ].join("\n"),
    );
  });

  it("writes the free estimate message word for word as before June 2026", () => {
    expect(message(lead({ terms: "free_estimate" }), { reference_name: "Ali" })).toBe(
      [
        "*Customer # 12*",
        "",
        "Customer Name: Synthetic Customer",
        "Customer Number: 555-0100",
        "Customer Address: 1 Test St",
        "Service Details: Fix sink",
        "",
        "FREE ESTIMATE VISIT",
        "",
        "FREE ESTIMATE VISIT Scheduled for: THURSDAY 12th December between 9:00am-11:30am",
        "",
        "-",
        '(Give the reference of "Ali" if customer ask)',
      ].join("\n"),
    );
  });

  it("omits materials when no charge exists instead of inventing a $0 materials charge", () => {
    const text = message(lead({ labor_amount: null, material_amount: null, for_you_amount: null, for_us_amount: null }));
    expect(text).toContain("Customer is agreed to pay ($0) total labor");
    expect(text).not.toMatch(/material|parts/i);
    expect(text).toContain("For you: $0 labor\nFor us: $0 from total labor");
  });

  it("uses the built-in message for leads with no terms", () => {
    expect(technicianMessageTemplate(lead({ terms: null }))).toBe(DEFAULT_MESSAGE_TEMPLATES.technician_message);
    expect(message(lead({ terms: null }))).toContain("Job Scheduled for: ");
  });

  it("formats the schedule the original way", () => {
    const now = new Date("2024-12-12T15:00:00");
    expect(formatTechnicianSchedule(lead(), now)).toBe("Today THURSDAY 12th December between 9:00am-11:30am");
    expect(formatTechnicianSchedule(lead({ scheduled_time_end: null }))).toBe("THURSDAY 12th December");
    expect(formatTechnicianSchedule(lead({ scheduled_date: null }))).toBe("TBD");
    expect(formatTechnicianSchedule(lead({ scheduled_date: "2024-12-01", scheduled_time_start: "13:05", scheduled_time_end: "00:00" })))
      .toBe("SUNDAY 1st December between 1:05pm-12:00am");
  });
});

describe("admin-saved templates", () => {
  it("uses a saved template for the lead's terms and the built-in text for the rest", () => {
    const saved = { technician_message_quoted: "Q {customer_name}", technician_message: "STD {customer_name}" };
    expect(technicianMessageTemplate(lead(), saved)).toBe("Q {customer_name}");
    expect(technicianMessageTemplate(lead({ terms: null }), saved)).toBe("STD {customer_name}");
    expect(technicianMessageTemplate(lead({ terms: "free_estimate" }), saved)).toBe(BUILT_IN_TEMPLATES.technician_message_free_estimate);
  });

  it("ignores blank saved texts", () => {
    expect(resolveTemplate("check_template", { check_template: "   " })).toBe(DEFAULT_CHECK_TEMPLATE);
    expect(resolveTemplate("check_template", undefined)).toBe(DEFAULT_CHECK_TEMPLATE);
  });
});

describe("Check Template", () => {
  const checkLead = (over: Partial<Lead> = {}) =>
    lead({
      tech_name: "Sam",
      service_type: "Plumbing",
      service_details: "Leaking kitchen sink",
      city: "Austin",
      state: "TX",
      customer_schedule_requirements: "tomorrow after 2pm",
      quote: "$250",
      ...over,
    } as Partial<Lead>);

  it("fills the built-in check message from the lead", () => {
    expect(renderLeadTemplate(DEFAULT_CHECK_TEMPLATE, checkLead())).toBe(
      [
        "Hi Sam, How are you? I have a new customer looking for Plumbing, kindly check and confirm if you can visit tomorrow after 2pm?",
        "",
        "Service Details: Leaking kitchen sink",
        "",
        "Area: Austin TX",
        "",
        "Schedule Requirement: tomorrow after 2pm",
        "",
        "QUOTE : $250",
      ].join("\n"),
    );
  });

  it("uses the typed technician name and falls back to TECH NAME", () => {
    expect(renderLeadTemplate("Hi {tech_name}", checkLead(), { tech_name: "Jo" })).toBe("Hi Jo");
    expect(renderLeadTemplate("Hi {tech_name}", checkLead({ tech_name: null }))).toBe("Hi TECH NAME");
  });

  it("uses the scheduled visit when there is no written schedule requirement, and leaves it blank if neither", () => {
    expect(renderLeadTemplate("{schedule_requirement}", checkLead({ customer_schedule_requirements: null }), {}))
      .toBe("THURSDAY 12th December between 9:00am-11:30am");
    expect(renderLeadTemplate("{schedule_requirement}|{area}", checkLead({ customer_schedule_requirements: null, scheduled_date: null, city: "", state: "TX" })))
      .toBe("|TX");
  });
});

describe("technician reminder time", () => {
  it("says the visit window in 12-hour AM/PM time", () => {
    const text = renderLeadTemplate(DEFAULT_MESSAGE_TEMPLATES.technician_reminder,
      lead({ tech_name: "Synthetic Tech", scheduled_time_start: "15:00:00", scheduled_time_end: "17:00:00" }));
    expect(text).toContain("today between 3:00 PM - 5:00 PM, Please Text back");
    expect(text).not.toContain("15:00");
  });
});
