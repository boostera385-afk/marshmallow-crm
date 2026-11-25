import { describe, expect, it } from "vitest";
import { buildDepartmentReport, statusLabel } from "./lead-department-analytics";

describe("buildDepartmentReport", () => {
  it("totals each department and lays out every status with all department columns", () => {
    const report = buildDepartmentReport([
      { department: "ND", status: "paid", lead_count: 4 },
      { department: "ND", status: "cancelled", lead_count: "2" },
      { department: "FB", status: "paid", lead_count: 3 },
      { department: "SEO", status: "scheduled", lead_count: 1 },
      { department: "not_in_jellybean", status: "paid", lead_count: 5 },
      { department: "pending", status: "waiting_customer_response", lead_count: 1 },
    ]);
    expect(report.totals).toEqual({ ND: 6, FB: 3, SEO: 1, Other: 0, not_in_jellybean: 5, pending: 1 });
    expect(report.total).toBe(16);
    expect(report.inJellybean).toBe(10);
    expect(report.statuses.map((s) => [s.status, s.total])).toEqual([
      ["paid", 12], ["cancelled", 2], ["scheduled", 1], ["waiting_customer_response", 1],
    ]);
    expect(report.statuses[0].counts).toEqual({ ND: 4, FB: 3, SEO: 0, Other: 0, not_in_jellybean: 5, pending: 0 });
    expect(report.statuses[0].label).toBe("Paid");
  });

  it("never drops leads: unknown departments count as Other and a blank status is kept", () => {
    const report = buildDepartmentReport([
      { department: "TikTok", status: "paid", lead_count: 2 },
      { department: "FB", status: null, lead_count: 1 },
    ]);
    expect(report.total).toBe(3);
    expect(report.totals.Other).toBe(2);
    expect(report.statuses.find((s) => s.status === "unknown")?.label).toBe("No status");
  });

  it("is empty for no rows", () => {
    expect(buildDepartmentReport([])).toMatchObject({ total: 0, inJellybean: 0, statuses: [] });
  });
});

describe("statusLabel", () => {
  it("falls back to a readable label for statuses the CRM no longer lists", () => {
    expect(statusLabel("some_legacy_status")).toBe("some legacy status");
  });
});
