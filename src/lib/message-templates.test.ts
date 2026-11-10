import { describe, expect, it } from "vitest";
import type { Lead } from "@/types";
import {
  DEFAULT_MESSAGE_TEMPLATES,
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

  it("shows $0 for amounts that are not filled in, as before", () => {
    const text = message(lead({ labor_amount: null, material_amount: null, for_you_amount: null, for_us_amount: null }));
    expect(text).toContain("Customer is agreed to pay ($0) total labor\n($0) FOR MATERIALS");
    expect(text).toContain("For you: $0 labor including material\nFor us: $0 from total labor");
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
