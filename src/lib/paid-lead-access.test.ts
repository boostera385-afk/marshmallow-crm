import { afterEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: vi.fn() } }));
import { describePaidWindow, fetchMyPaidLeadIds, isInPaidGrant, setPaidLeadAccess, validatePaidChoice } from "./paid-lead-access";

afterEach(() => rpc.mockReset());

describe("paid lead window", () => {
  it("ranges use the database's became-paid ids, never the created date", () => {
    const october = { start_date: "2026-10-01", end_date: "2026-10-31" };
    const paidInOctober = new Set(["created-in-september"]);
    expect(isInPaidGrant("created-in-september", october, paidInOctober)).toBe(true);
    expect(isInPaidGrant("created-in-october-paid-in-november", october, paidInOctober)).toBe(false);
  });
  it("shows no ranged paid leads until the ids are known", () => {
    const october = { start_date: "2026-10-01", end_date: "2026-10-31" };
    expect(isInPaidGrant("any", october, undefined)).toBe(false);
    expect(isInPaidGrant("any", october, null)).toBe(false);
  });
  it("treats no dates as all time and no grant as no access", () => {
    expect(isInPaidGrant("any", { start_date: null, end_date: null }, null)).toBe(true);
    expect(isInPaidGrant("any", null, new Set(["any"]))).toBe(false);
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

describe("in-range paid lead ids", () => {
  it("reads the caller's ids from the database function", async () => {
    rpc.mockResolvedValue({ data: ["17100000-0000-4000-8000-000000000001"], error: null });
    await expect(fetchMyPaidLeadIds()).resolves.toEqual(["17100000-0000-4000-8000-000000000001"]);
    expect(rpc).toHaveBeenCalledWith("my_paid_lead_ids");
  });
  it("surfaces a failure instead of returning an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("function my_paid_lead_ids() does not exist") });
    await expect(fetchMyPaidLeadIds()).rejects.toThrow("does not exist");
  });
});
