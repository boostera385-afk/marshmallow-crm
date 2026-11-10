import { describe, expect, it } from "vitest";
import type { Lead } from "@/types";
import {
  DEFAULT_MESSAGE_TEMPLATES,
  buildQuoteLines,
  renderLeadTemplate,
  withQuotePlaceholder,
} from "./message-templates";

const lead = (over: Partial<Lead> = {}) =>
  ({
    id: "lead-1",
    customer_name: "Synthetic Customer",
    customer_phone: "555-0100",
    address: "1 Test St",
    service_details: "Fix sink",
    scheduled_date: null,
    scheduled_time_start: null,
    scheduled_time_end: null,
    reference_name: null,
    terms: "quoted",
    labor_amount: 200,
    material_amount: 50.5,
    for_you_amount: 150,
    for_us_amount: 100.5,
    quote: null,
    ...over,
  }) as unknown as Lead;

const render = (l: Lead, includeQuote = true, template = DEFAULT_MESSAGE_TEMPLATES.technician_message) =>
  renderLeadTemplate(withQuotePlaceholder(template), l, {
    customer_number: "12",
    reference_name: "",
    include_quote: includeQuote ? "true" : "false",
  });

describe("technician message quote lines", () => {
  it("adds total, for you and for us after the schedule for a quoted lead", () => {
    expect(render(lead())).toBe(
      [
        "*Customer #12*",
        "",
        "Customer Name: Synthetic Customer",
        "Customer Number: 555-0100",
        "Customer Address: 1 Test St",
        "Service Details: Fix sink",
        "",
        "Job Scheduled for: Not scheduled",
        "",
        "Customer is agreed to pay total : $250.50",
        "",
        "For you : $150",
        "For us : $100.50",
        "",
        "",
      ].join("\n"),
    );
  });

  it("leaves a free-estimate lead's message exactly as before", () => {
    const text = render(lead({ terms: "free_estimate" }));
    expect(text).not.toContain("agreed to pay");
    expect(text.endsWith("Job Scheduled for: Not scheduled\n")).toBe(true);
  });

  it("omits the money lines when the caller may not see them", () => {
    expect(render(lead(), false)).not.toMatch(/agreed to pay|For you|For us/);
  });

  it("keeps the labels when amounts are not filled in yet", () => {
    expect(buildQuoteLines(lead({ labor_amount: null, material_amount: null, for_you_amount: null, for_us_amount: null })))
      .toBe("Customer is agreed to pay total :\n\nFor you :\nFor us :");
  });

  it("falls back to the free-text quote when labor and materials are empty", () => {
    expect(buildQuoteLines(lead({ labor_amount: null, material_amount: null, quote: "$300 flat" })))
      .toMatch(/^Customer is agreed to pay total : \$300 flat\n/);
  });

  it("counts a zero material amount and formats thousands", () => {
    expect(buildQuoteLines(lead({ labor_amount: 1200, material_amount: 0 }))).toMatch(/total : \$1,200\n/);
  });

  it("adds the lines to a saved template that predates the placeholder", () => {
    const old = "Name: {customer_name}\nJob Scheduled for: {schedule}\n{reference_line}";
    expect(render(lead(), true, old)).toBe(
      "Name: Synthetic Customer\nJob Scheduled for: Not scheduled\n\nCustomer is agreed to pay total : $250.50\n\nFor you : $150\nFor us : $100.50\n\n",
    );
    expect(withQuotePlaceholder("Hi {customer_name}")).toBe("Hi {customer_name}{quote_line}");
  });
});
