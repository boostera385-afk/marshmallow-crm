import { describe, expect, it } from "vitest";
import { operatorLaborForDisplay, operatorQuoteFormValue, operatorQuoteSummary, operatorVisibleLabor } from "./operator-quote";

describe("Operator-safe quote summary (business rule 2026-11-13)", () => {
  it("halves the labor amount and rounds to the cent", () => {
    expect(operatorVisibleLabor(100)).toBe(50);
    expect(operatorVisibleLabor(99.99)).toBe(50);
    expect(operatorVisibleLabor(0)).toBe(0);
    expect(operatorVisibleLabor(null)).toBeNull();
    expect(operatorVisibleLabor(undefined)).toBeNull();
  });

  it("shows the Free Estimate label with no amounts at all", () => {
    expect(operatorQuoteSummary({ terms: "free_estimate", labor_amount: 500, material_amount: 200 })).toBe(
      "Free Estimate Visit",
    );
  });

  it("shows half the labor and full materials when both are present", () => {
    expect(operatorQuoteSummary({ terms: "quoted", labor_amount: 200, material_amount: 60 })).toBe(
      "Quoted · Labor $100.00 · Parts/Materials $60.00",
    );
  });

  it("mentions nothing about materials when there is none", () => {
    expect(operatorQuoteSummary({ terms: "quoted", labor_amount: 200, material_amount: null })).toBe(
      "Quoted · Labor $100.00",
    );
    expect(operatorQuoteSummary({ terms: "quoted", labor_amount: 200, material_amount: 0 })).toBe(
      "Quoted · Labor $100.00",
    );
  });

  it("never reveals the full labor amount or the For You/For Us split", () => {
    const summary = operatorQuoteSummary({ terms: "quoted", labor_amount: 200, material_amount: 60 });
    expect(summary).not.toContain("200");
  });

  it("still shows Quoted when no labor or materials are recorded yet (same terms opr_admin sees)", () => {
    expect(operatorQuoteSummary({ terms: "quoted", labor_amount: null, material_amount: null, show_quote_to_opr: true })).toBe("Quoted");
    expect(operatorQuoteSummary({ terms: "quoted", labor_amount: null, material_amount: 0 })).toBe("Quoted");
  });

  it("returns null when there is nothing to tell yet", () => {
    expect(operatorQuoteSummary({ terms: null, labor_amount: 200, material_amount: 60 })).toBeNull();
    expect(operatorQuoteSummary({})).toBeNull();
  });

  it("respects an admin's per-lead show_quote_to_opr = false override", () => {
    expect(
      operatorQuoteSummary({ terms: "quoted", labor_amount: 200, material_amount: 60, show_quote_to_opr: false }),
    ).toBeNull();
    expect(
      operatorQuoteSummary({ terms: "free_estimate", show_quote_to_opr: false }),
    ).toBeNull();
  });
});

describe("Operator quote section on the lead page (business rule 2026-11-14)", () => {
  const value = { terms: "quoted" as const, laborAmount: "200", materialAmount: "50", includesMaterials: true };
  it("shows half the labor and the full parts/materials amount", () => {
    expect(operatorQuoteFormValue(value)).toEqual({ terms: "quoted", laborAmount: "100", materialAmount: "50", includesMaterials: true });
    expect(operatorQuoteFormValue({ ...value, laborAmount: "99.99" })?.laborAmount).toBe("50");
  });
  it("matches the lead card: materials shown whenever an amount is recorded", () => {
    expect(operatorQuoteFormValue({ ...value, includesMaterials: false })?.includesMaterials).toBe(true);
    expect(operatorQuoteFormValue({ ...value, materialAmount: "" })?.includesMaterials).toBe(false);
  });
  it("never infers labor that was not recorded", () => {
    expect(operatorQuoteFormValue({ ...value, laborAmount: "" })?.laborAmount).toBe("");
    expect(operatorQuoteFormValue({ ...value, laborAmount: "abc" })?.laborAmount).toBe("");
  });
  it("hides the whole section when an admin hid the quote from Operators", () => {
    expect(operatorQuoteFormValue(value, false)).toBeNull();
    expect(operatorQuoteFormValue(value, true)).not.toBeNull();
  });
});

describe("half labor sent by the database (20261219000000)", () => {
  it("shows the server's half as-is and never halves it again", () => {
    expect(operatorQuoteSummary({ terms: "quoted", labor_amount: null, operator_labor_amount: 100, material_amount: 40 }))
      .toBe("Quoted · Labor $100.00 · Parts/Materials $40.00");
    expect(operatorLaborForDisplay({ labor_amount: null, operator_labor_amount: 50 })).toBe(50);
  });
  it("shows no labor when the server sent none, even if a full figure were present", () => {
    expect(operatorLaborForDisplay({ labor_amount: 200, operator_labor_amount: null })).toBeNull();
    expect(operatorQuoteSummary({ terms: "quoted", labor_amount: null, operator_labor_amount: null })).toBe("Quoted");
  });
  it("before the migration (no column) halves the full labor on screen", () => {
    expect(operatorLaborForDisplay({ labor_amount: 200 })).toBe(100);
  });
  it("an older CRM build after the migration shows Quoted, never the full or a quartered amount", () => {
    // What the pre-change summary computes from the new response (labor_amount null).
    expect(operatorVisibleLabor(null)).toBeNull();
  });
});
