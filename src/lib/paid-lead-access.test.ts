import { afterEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: vi.fn() } }));
import { companyDate, describePaidWindow, isInPaidWindow, setPaidLeadAccess, validatePaidChoice } from "./paid-lead-access";

afterEach(() => rpc.mockReset());

describe("paid lead window", () => {
  it("uses the New York calendar date of the lead", () => {
    expect(companyDate("2026-11-01T03:30:00Z")).toBe("2026-10-31"); // 11:30 pm Oct 31 in New York
    expect(companyDate("2026-11-01T04:30:00Z")).toBe("2026-11-01");
  });
  it("includes both end dates and nothing outside them", () => {
    const october = { start_date: "2026-10-01", end_date: "2026-10-31" };
    expect(isInPaidWindow("2026-10-01T04:00:00Z", october)).toBe(true);  // midnight Oct 1 NY
    expect(isInPaidWindow("2026-11-01T03:59:00Z", october)).toBe(true);  // 11:59 pm Oct 31 NY
    expect(isInPaidWindow("2026-11-01T04:00:00Z", october)).toBe(false); // midnight Nov 1 NY
    expect(isInPaidWindow("2026-10-01T03:59:00Z", october)).toBe(false); // 11:59 pm Sep 30 NY
    expect(isInPaidWindow(null, october)).toBe(false);
  });
  it("treats no dates as all time and no grant as no access", () => {
    expect(isInPaidWindow("2020-01-01T00:00:00Z", { start_date: null, end_date: null })).toBe(true);
    expect(isInPaidWindow("2026-10-10T00:00:00Z", null)).toBe(false);
  });
  it("describes the grant for the Settings grid", () => {
    expect(describePaidWindow({ start_date: null, end_date: null })).toBe("All time");
    expect(describePaidWindow({ start_date: "2026-10-01", end_date: "2026-10-31" })).toBe("Oct 1, 2026 – Oct 31, 2026");
    expect(describePaidWindow(null)).toBe("");
  });
  it("validates the Admin's choice", () => {
    expect(validatePaidChoice({ mode: "all" })).toBeNull();
    expect(validatePaidChoice({ mode: "range", start: "2026-10-01", end: "2026-10-31" })).toBeNull();
    expect(validatePaidChoice({ mode: "range", start: "2026-10-01", end: "2026-10-01" })).toBeNull();
    expect(validatePaidChoice({ mode: "range", start: "", end: "2026-10-31" })).toMatch(/start and an end/);
    expect(validatePaidChoice({ mode: "range", start: "2026-11-01", end: "2026-10-31" })).toMatch(/on or before/);
  });
});

describe("saving a grant", () => {
  it("sends all time, a range, or off to the Admin-only function", async () => {
    rpc.mockResolvedValue({ error: null });
    await setPaidLeadAccess("u1", { mode: "all" });
    await setPaidLeadAccess("u1", { mode: "range", start: "2026-10-01", end: "2026-10-31" });
    await setPaidLeadAccess("u1", null);
    expect(rpc.mock.calls).toEqual([
      ["set_paid_lead_access", { p_user_id: "u1", p_enabled: true, p_start: null, p_end: null }],
      ["set_paid_lead_access", { p_user_id: "u1", p_enabled: true, p_start: "2026-10-01", p_end: "2026-10-31" }],
      ["set_paid_lead_access", { p_user_id: "u1", p_enabled: false, p_start: null, p_end: null }],
    ]);
  });
  it("surfaces a refusal", async () => {
    rpc.mockResolvedValue({ error: new Error("Only an Admin can change paid lead access") });
    await expect(setPaidLeadAccess("u1", { mode: "all" })).rejects.toThrow("Only an Admin");
  });
});
