import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { customerQuoteSummary, validateQuoteBreakdown, type QuoteFormValue } from "./quote-breakdown";
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
});
