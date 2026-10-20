import { describe, expect, it } from "vitest";
import { ALL_NAV_ITEMS } from "./constants";
import { canAccessNavItem } from "./access";
import { accessibleFeatures, COPILOT_FEATURES, COPILOT_ROLES, matchingFeatures, routeCopilotMessage, safeCopilotHref, type CopilotAccess } from "../../supabase/functions/_shared/copilot-core";

describe("Copilot current feature catalogue", () => {
  it("covers every current CRM navigation section with safe destinations", () => {
    expect([...new Set(COPILOT_FEATURES.map((f) => f.section))].sort()).toEqual([...ALL_NAV_ITEMS].sort());
    for (const feature of COPILOT_FEATURES) expect(safeCopilotHref(feature.href)).toBe(true);
  });
  for (const role of COPILOT_ROLES) it(`mirrors existing ${role} defaults without granting features`, () => {
    const sections = ALL_NAV_ITEMS.filter((section) => canAccessNavItem(role, section));
    const access: CopilotAccess = { role, allowed: true, aiEnabled: false, timezone: "America/New_York", sections: [...sections] };
    expect([...new Set(accessibleFeatures(access).map((f) => f.section))].sort()).toEqual([...sections].sort());
    expect(matchingFeatures("processor board", access).some((f) => f.id === "processor-board")).toBe(role === "admin" || role === "processor");
    expect(matchingFeatures("get tech update", access).some((f) => f.id === "tech-updates")).toBe(!["opr", "opr_admin"].includes(role));
    expect(accessibleFeatures({ ...access, allowed: false })).toEqual([]);
  });
  it("defends fixed role gates even with stale or malicious sections", () => {
    for (const role of ["opr", "opr_admin", "customer_service", "cs_admin"] as const) {
      const features = accessibleFeatures({ role, allowed: true, aiEnabled: false, timezone: "UTC", sections: ["processor_board", "cx_updates"] });
      expect(features.some((f) => f.id === "processor-board")).toBe(false);
      if (role.startsWith("opr")) expect(features).toEqual([]);
    }
  });
  it.each(["Processor Board", "open the Processor Board", "Get CX Update", "Get Tech Update", "Notifications", "notification history", "update Donut", "install Donut", "Quotes to Send", "Tech Quickchat"])("routes %s to deterministic help", (message) => {
    expect(routeCopilotMessage(message).intent).toBe("help");
  });
  it.each(["update technician MM-101", "send dose MM-101", "approve paid MM-101", "update Donut and mark MM-101 paid"])("still blocks %s", (message) => {
    expect(routeCopilotMessage(message).intent).toBe("blocked");
  });
  it("keeps normal lead and technician searches and matches complete words", () => {
    expect(routeCopilotMessage("find technicians").intent).toBe("technicians");
    expect(routeCopilotMessage("show leads").intent).toBe("leads");
    const access: CopilotAccess = { role: "admin", allowed: true, aiEnabled: false, timezone: "UTC", sections: [...ALL_NAV_ITEMS] };
    expect(matchingFeatures("where is the Processor-Board?", access).map((f) => f.id)).toEqual(["processor-board"]);
    expect(matchingFeatures("roadmap", access)).toEqual([]);
    expect(matchingFeatures("CX updates", access).map((f) => f.id)).toEqual(["cx-updates"]);
  });
});
