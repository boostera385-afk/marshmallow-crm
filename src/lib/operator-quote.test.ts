import { describe, expect, it } from "vitest";
import { operatorQuoteSummary, operatorVisibleLabor } from "./operator-quote";

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
