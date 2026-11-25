import { describe, expect, it } from "vitest";
import { NOTIFICATION_SEVERITY_STYLES, notificationSeverity } from "./notification-severity";

const sev = (title: string, extra: Record<string, unknown> = {}) => notificationSeverity({ title, ...extra });

describe("notificationSeverity", () => {
  it("marks urgent jobs and live problems critical", () => {
    expect(sev("[Alert] Urgent Job", { message: 'Lead "Sailesh Kumar" changed to Urgent Job' })).toBe("critical");
    expect(sev("Database load warning", { message: "CPU above 90%" })).toBe("critical");
    expect(sev("Google Sheets backup failed")).toBe("critical");
  });

  it("marks requests and approvals as needing action", () => {
    expect(sev("Lead cancellation request", { message: "Jeremy needs cancellation approval" })).toBe("warning");
    expect(sev("Quote approval request")).toBe("warning");
    expect(sev("Paid approval request for LD-1")).toBe("warning");
    expect(sev("AI: Customer requires new schedule")).toBe("warning");
    expect(sev("[Alert] Google Sheets backup is behind")).toBe("warning");
    expect(sev("[Alert] Incomplete Details")).toBe("warning");
    expect(sev("Anything", { action_required: true })).toBe("warning");
  });

  it("marks cleared problems and confirmations resolved, even when they name the problem", () => {
    expect(sev("Database load back to normal", { message: "All readings below warning levels" })).toBe("success");
    expect(sev("AI: Customer confirmed schedule — Ready to schedule")).toBe("success");
    expect(sev("CX update", { event_type: "update_resolved" })).toBe("success");
  });

  it("uses the stored event kind before wording", () => {
    // The server reports new-schedule alerts as schedule_ready for older builds; event_kind is exact.
    expect(sev("Schedule", { event_type: "schedule_ready", event_kind: "schedule_new_needed" })).toBe("warning");
    expect(sev("Your CX update request was answered", { event_type: "update_answered" })).toBe("info");
    expect(sev("Update", { event_type: "update_requested" })).toBe("warning");
  });

  it("falls back to info for everything else", () => {
    expect(sev("Lead Assigned", { message: "LD-123 was assigned to you" })).toBe("info");
    expect(sev("Lead Shared with You")).toBe("info");
  });

  it("gives every severity an icon and a text label (colour is never the only signal)", () => {
    for (const style of Object.values(NOTIFICATION_SEVERITY_STYLES)) {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.icon).toBeTruthy();
    }
  });
});
