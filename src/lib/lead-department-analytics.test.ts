import { describe, expect, it } from "vitest";
import { buildDepartmentReport, statusLabel, statusStage } from "./lead-department-analytics";

const dept = (report: ReturnType<typeof buildDepartmentReport>, key: string) => report.departments.find((d) => d.key === key)!;

describe("buildDepartmentReport", () => {
  const report = buildDepartmentReport([
    { department: "ND", status: "paid", lead_count: 4 },
    { department: "ND", status: "partial_paid", lead_count: 1 },
    { department: "ND", status: "cancelled", lead_count: "3" },
    { department: "ND", status: "waiting_customer_response", lead_count: 12 },
    { department: "FB", status: "paid", lead_count: 3 },
    { department: "FB", status: "quote_sent_waiting", lead_count: 9 },
    { department: "SEO", status: "scheduled", lead_count: 1 },
    { department: "not_in_jellybean", status: "paid", lead_count: 5 },
    { department: "not_in_jellybean", status: "job_done", lead_count: 15 },
    { department: "pending", status: "waiting_customer_response", lead_count: 2 },
  ]);

  it("counts every lead once: departments, JellyBean share and still-checking leads", () => {
    expect(report.total).toBe(55);
    expect(report.inJellybean).toBe(33);
    expect(report.pending).toBe(2);
    expect(report.departments.map((d) => [d.key, d.total])).toEqual([["ND", 20], ["FB", 12], ["SEO", 1], ["Other", 0], ["not_in_jellybean", 20]]);
    expect(dept(report, "ND").share).toBeCloseTo((20 / 55) * 100);
  });

  it("groups statuses into simple stages and works out each department's paid rate", () => {
    expect(dept(report, "ND").stages).toEqual({ waiting: 12, quoting: 0, booked: 0, job_done: 0, paid: 5, lost: 3, other: 0 });
    expect(dept(report, "ND").paidRate).toBe(25);
    expect(dept(report, "FB").stages.quoting).toBe(9);
    expect(dept(report, "not_in_jellybean").stages.job_done).toBe(15);
  });

  it("lists a department's statuses in stage order, busiest first", () => {
    expect(dept(report, "ND").statuses.map((s) => [s.label, s.count])).toEqual([
      ["Waiting Customer Response", 12], ["Paid", 4], ["Partial Paid", 1], ["Cancelled", 3],
    ]);
  });

  it("names the best paid rate only among departments with at least 10 leads", () => {
    // SEO has 1 lead (100% would be meaningless); FB 3/12 = 25%, ND 5/20 = 25%, not_in_jellybean 5/20 = 25%.
    const tied = report.bestPaidRate;
    expect(tied && ["ND", "FB", "not_in_jellybean"]).toContain(tied);
    const clear = buildDepartmentReport([
      { department: "ND", status: "paid", lead_count: 1 }, { department: "ND", status: "cancelled", lead_count: 19 },
      { department: "FB", status: "paid", lead_count: 6 }, { department: "FB", status: "cancelled", lead_count: 6 },
      { department: "SEO", status: "paid", lead_count: 2 },
    ]);
    expect(clear.bestPaidRate).toBe("FB");
  });

  it("never drops leads: unknown departments count as Other and a blank status is kept", () => {
    const odd = buildDepartmentReport([
      { department: "TikTok", status: "paid", lead_count: 2 },
      { department: "FB", status: null, lead_count: 1 },
    ]);
    expect(odd.total).toBe(3);
    expect(dept(odd, "Other").total).toBe(2);
    expect(dept(odd, "FB").statuses[0]).toMatchObject({ label: "No status", stage: "other" });
  });

  it("is empty for no rows", () => {
    expect(buildDepartmentReport([])).toMatchObject({ total: 0, inJellybean: 0, pending: 0, bestPaidRate: null });
  });
});

describe("status names and stages", () => {
  it("gives old statuses readable names", () => {
    expect(statusLabel("need_quote")).toBe("Need Quote (old status)");
    expect(statusLabel("some_legacy_status")).toBe("Some legacy status");
    expect(statusLabel("payment_requested")).toBe("Paid Approval Pending");
  });
  it("puts every current status in a stage", () => {
    expect(statusStage("urgent_job")).toBe("booked");
    expect(statusStage("payment_requested")).toBe("job_done");
    expect(statusStage("scammed")).toBe("lost");
    expect(statusStage("something_new")).toBe("other");
  });
});
