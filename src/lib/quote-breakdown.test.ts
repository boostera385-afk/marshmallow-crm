import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { customerQuoteSummary, technicianShareFieldsForTerms, validateDiagnosticFee, validateLaborPercent, validateQuoteBreakdown, type QuoteFormValue } from "./quote-breakdown";
const donut = runInNewContext(readFileSync("tmp_extension/quo-crm-extension/quote-breakdown.js", "utf8") + "; globalThis.DonutQuote");
const quoted: QuoteFormValue = { terms: "quoted", laborAmount: "200", materialAmount: "60", includesMaterials: true };

describe("CRM and Donut customer quote breakdown", () => {
  it("shows full customer labor and full materials, without internal technician shares", () => {
    expect(customerQuoteSummary({ terms: "quoted", labor_amount: 200, material_amount: 60, quote: "Private legacy notes" })).toBe("Quoted · Labor $200.00 · Parts/Materials $60.00");
  });
  it.each([null, 0])("omits every materials mention for %s", (material_amount) => {
    expect(customerQuoteSummary({ terms: "quoted", labor_amount: 200, material_amount, quote: null })).toBe("Quoted · Labor $200.00");
  });
  it("does not present old numeric notes as a recorded labor amount", () => {
    expect(customerQuoteSummary({ terms: "quoted", labor_amount: null, material_amount: null, quote: "$200" })).toBe("Quoted");
  });
  it.each(["", "-1", "NaN", "Infinity"])("rejects invalid selected materials %j in both clients", (amount) => {
    expect(validateQuoteBreakdown({ ...quoted, materialAmount: amount })).toMatch(/positive/);
    expect(() => donut.fields({ terms: "quoted", laborAmount: "200", materialsIncluded: "yes", materialAmount: amount })).toThrow(/positive/);
  });
  it("No ignores stale materials values and stores no charge in Donut", () => {
    expect(validateQuoteBreakdown({ ...quoted, includesMaterials: false })).toBeNull();
    expect(donut.fields({ terms: "quoted", laborAmount: "200", materialsIncluded: "no", materialAmount: "60" })).toEqual({ terms: "quoted", labor_amount: 200, material_amount: null });
  });
  it("Free Estimate Visit never emits quoted charges", () => {
    expect(customerQuoteSummary({ terms: "free_estimate", labor_amount: 200, material_amount: 60, quote: null })).toBe("Free Estimate Visit");
    expect(donut.fields({ terms: "free_estimate", laborAmount: "200", materialsIncluded: "yes", materialAmount: "60" })).toEqual({ terms: "free_estimate", labor_amount: null, material_amount: null });
  });
  it("Diagnostic/Service Call keeps its fee in diagnostic_fee_amount, never labor or materials, in both clients", () => {
    expect(customerQuoteSummary({ terms: "diagnostic_service_call", diagnostic_fee_amount: 89, labor_amount: 300, material_amount: 60, quote: "notes" })).toBe("Diagnostic/Service Call · Fee $89.00");
    expect(customerQuoteSummary({ terms: "diagnostic_service_call", diagnostic_fee_amount: null, labor_amount: 300, material_amount: null, quote: null })).toBe("Diagnostic/Service Call");
    expect(validateQuoteBreakdown({ terms: "diagnostic_service_call", laborAmount: "-1", materialAmount: "", includesMaterials: true })).toBeNull();
    expect(donut.fields({ terms: "diagnostic_service_call", laborAmount: "89", materialsIncluded: "yes", materialAmount: "60" })).toEqual({ terms: "diagnostic_service_call", labor_amount: null, material_amount: null, diagnostic_fee_amount: 89 });
    expect(donut.fields({ terms: "diagnostic_service_call", laborAmount: "", materialsIncluded: "no", materialAmount: "" })).toEqual({ terms: "diagnostic_service_call", labor_amount: null, material_amount: null, diagnostic_fee_amount: null });
  });
  it.each(["-5", "abc"])("rejects an invalid diagnostic fee %j in both clients", (fee) => {
    expect(validateDiagnosticFee(fee)).toMatch(/diagnostic fee/);
    expect(() => donut.fields({ terms: "diagnostic_service_call", laborAmount: fee, materialsIncluded: "no", materialAmount: "" })).toThrow(/diagnostic fee/);
  });
  it("Donut drops unknown terms", () => {
    expect(donut.fields({ terms: "made_up", laborAmount: "10" })).toEqual({ terms: null, labor_amount: null, material_amount: null });
  });
  it("picks the Internal Technician Share fields by terms (owner formats)", () => {
    expect(technicianShareFieldsForTerms("quoted")).toEqual(["for_you_amount", "for_us_amount", "diagnostic_fee_amount"]);
    expect(technicianShareFieldsForTerms("free_estimate")).toEqual(["for_you_labor_percent", "for_us_labor_percent", "diagnostic_fee_amount"]);
    expect(technicianShareFieldsForTerms("diagnostic_service_call")).toEqual(["for_you_amount", "for_us_amount", "for_you_labor_percent", "for_us_labor_percent", "diagnostic_fee_amount"]);
    expect(technicianShareFieldsForTerms(null)).toEqual(["for_you_amount", "for_us_amount", "diagnostic_fee_amount"]);
  });
  it.each([["", null], ["0", null], ["100", null], ["50.5", null], ["-1", /0 to 100/], ["101", /0 to 100/], ["x", /0 to 100/]])("labor percent %j", (value, expected) => {
    const result = validateLaborPercent(value);
    if (expected) expect(result).toMatch(expected); else expect(result).toBeNull();
  });
});
