import { describe, expect, it } from "vitest";
import { isLocationOnlyOperator, parseLocationLabel, redactLeadForOperator, withOperatorLocation } from "./operator-privacy";

const lead = {
  id: "lead-1", customer_name: "Jane Sample", service_type: "Plumbing",
  address: "123 Main St, Coral Springs, FL 33071", half_address: "123 Main St", city: "Kistler Dr Little Elm", state: "FL", zip_code: "33071",
  latitude: 26.27, longitude: -80.27, customer_phone: "5550100000", customer_landline: "5550109999",
  tech_name: "Sam Tech", tech_number: "5550108888", quote: "$200", location_label: "Coral Springs, FL 33071",
};

describe("Operator location-only view", () => {
  it("applies to the Operator role only, not Operator Admin or anyone else", () => {
    expect(isLocationOnlyOperator("opr")).toBe(true);
    for (const role of ["opr_admin", "admin", "processor", "cs_admin", "customer_service", null, undefined] as const) {
      expect(isLocationOnlyOperator(role)).toBe(false);
      expect(redactLeadForOperator(lead, role)).toBe(lead);
      expect(withOperatorLocation("id, address", role)).toBe("id, address");
    }
    expect(withOperatorLocation("id, address", "opr")).toBe("id, address, location_label");
  });

  it("shows an Operator City, ST ZIP and nothing from the street, phone or technician", () => {
    const safe = redactLeadForOperator(lead, "opr");
    expect(safe).toMatchObject({
      address: "Coral Springs, FL 33071", city: "Coral Springs", state: "FL", zip_code: "33071",
      half_address: null, latitude: null, longitude: null, customer_phone: null, customer_landline: null, tech_name: null, tech_number: null,
      customer_name: null, service_type: "Plumbing", quote: null,
    });
    const text = JSON.stringify(safe);
    for (const secret of ["Jane Sample", "123 Main St", "5550100000", "5550109999", "5550108888", "Sam Tech", "Kistler", "26.27", "$200"]) expect(text).not.toContain(secret);
    expect(lead.customer_phone).toBe("5550100000"); // the original object is not modified
  });

  it("never falls back to the raw address when the server label is missing", () => {
    const { location_label: _omit, ...withoutLabel } = lead;
    const safe = redactLeadForOperator(withoutLabel, "opr");
    expect(safe).toMatchObject({ address: null, city: null, state: null, zip_code: null, customer_phone: null, customer_name: null });
    expect(JSON.stringify(safe)).not.toContain("Main St");
  });

  it.each([
    ["Coral Springs, FL 33071", { city: "Coral Springs", state: "FL", zip: "33071" }],
    ["St. Louis, MO 63101", { city: "St. Louis", state: "MO", zip: "63101" }],
    ["Browns Summit, GA", { city: "Browns Summit", state: "GA", zip: null }],
    ["TX 75068", { city: null, state: "TX", zip: "75068" }],
    ["90026", { city: null, state: null, zip: "90026" }],
    ["", { city: null, state: null, zip: null }],
    [null, { city: null, state: null, zip: null }],
  ])("reads the label %j", (label, parts) => {
    expect(parseLocationLabel(label)).toEqual(parts);
  });
});
