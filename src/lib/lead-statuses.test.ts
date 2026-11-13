import { describe, expect, it } from "vitest";
import { getDefaultVisibleStatuses } from "@/lib/access";
import { ALL_LEAD_STATUSES, STATUS_LABELS, canChangeStatus } from "@/lib/constants";
import { LEAD_STATUS_CONFIG } from "@/types";

describe("payment outcome status choices", () => {
  it("only offers payment outcomes to Admin and Processor", () => {
    for (const role of ["admin", "processor", "customer_service", "cs_admin", "opr", "opr_admin"]) {
      for (const status of ["paid", "partial_paid"] as const) {
        expect(canChangeStatus(role, status)).toBe(role === "admin" || role === "processor");
      }
    }
  });
});

describe("post-visit confirmation status", () => {
  it("is a real status with a label", () => {
    expect(ALL_LEAD_STATUSES).toContain("post_visit_confirmation");
    expect(STATUS_LABELS.post_visit_confirmation).toBe("Post Visit Confirmation");
    expect(LEAD_STATUS_CONFIG.post_visit_confirmation.label).toBe("Post Visit Confirmation");
  });

  it("can be set by Admin, CS, CS Admin and Processor", () => {
    for (const role of ["admin", "customer_service", "cs_admin", "processor"] as const) {
      expect(canChangeStatus(role, "post_visit_confirmation")).toBe(true);
    }
  });

  it("cannot be set by Operators", () => {
    expect(canChangeStatus("opr", "post_visit_confirmation")).toBe(false);
  });

  it("is visible by default to the roles that set it", () => {
    for (const role of ["admin", "customer_service", "cs_admin", "processor"] as const) {
      expect(getDefaultVisibleStatuses(role).has("post_visit_confirmation")).toBe(true);
    }
  });
});
