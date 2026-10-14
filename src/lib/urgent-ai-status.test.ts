import { describe, expect, it } from "vitest";
import { normalizeUrgentStatus, PREFERRED_URGENT_STATUSES } from "../../supabase/functions/_shared/urgent-status";
import { urgentAiStatusClass, URGENT_AI_STATUS_CLASSES } from "./urgent-ai-status";

describe("urgent AI status vocabulary", () => {
  it("gives every preferred status its own color", () => {
    const colors = PREFERRED_URGENT_STATUSES.map((status) => urgentAiStatusClass(status));
    expect(new Set(colors).size).toBe(PREFERRED_URGENT_STATUSES.length);
    expect(Object.keys(URGENT_AI_STATUS_CLASSES)).toEqual([...PREFERRED_URGENT_STATUSES]);
  });

  it("accepts a specific two or three word fallback and rejects prose", () => {
    expect(normalizeUrgentStatus("  Parts   Delayed ")).toBe("Parts Delayed");
    expect(normalizeUrgentStatus("Technician Visit Pending")).toBe("Technician Visit Pending");
    expect(normalizeUrgentStatus("Waiting")).toBeNull();
    expect(normalizeUrgentStatus("The customer asked us to call tomorrow")).toBeNull();
  });

  it("assigns novel statuses a stable non-default color", () => {
    expect(urgentAiStatusClass("Parts Delayed")).toBe(urgentAiStatusClass("Parts Delayed"));
    expect(urgentAiStatusClass("Parts Delayed")).toContain("border-");
  });
});
