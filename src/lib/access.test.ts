import { describe, expect, it } from "vitest";
import { canAccessNavItem, canAddLeadViaExtension, canAddManualLead, canDeleteTechnicians, canSeeTechDetails, canViewLeadCoverageAnalytics, getDefaultNavAccess } from "@/lib/access";
import type { NavigationPermission } from "@/types";

describe("cancellation request navigation access", () => {
  it.each(["admin", "processor"] as const)("is always visible to %s", (role) => {
    const deniedOverride = [{ nav_section: "cancellation_requests", allowed: false }] as NavigationPermission[];

    expect(getDefaultNavAccess(role).has("cancellation_requests")).toBe(true);
    expect(canAccessNavItem(role, "cancellation_requests", deniedOverride)).toBe(true);
  });

  // Operators were narrowed to All Leads only in "set default nav access for opr to only all leads".
  it("is not part of the Operator default navigation", () => {
    expect(getDefaultNavAccess("opr").has("cancellation_requests")).toBe(false);
    expect(canAccessNavItem("opr", "cancellation_requests")).toBe(false);
  });

  it("remains hidden from roles outside the requested audience", () => {
    expect(canAccessNavItem("customer_service", "cancellation_requests")).toBe(false);
    expect(canAccessNavItem("cs_admin", "cancellation_requests")).toBe(false);
    expect(canAccessNavItem(null, "cancellation_requests")).toBe(false);
  });
});

describe("quo monitor navigation access", () => {
  it("is visible to admin by default", () => {
    expect(getDefaultNavAccess("admin").has("quo_monitor")).toBe(true);
    expect(canAccessNavItem("admin", "quo_monitor")).toBe(true);
  });

  it.each(["processor", "customer_service", "opr"] as const)("is hidden from %s", (role) => {
    expect(getDefaultNavAccess(role).has("quo_monitor")).toBe(false);
    expect(canAccessNavItem(role, "quo_monitor")).toBe(false);
  });

  it("denies navigation entirely when the user has no valid role", () => {
    expect(canAccessNavItem(null, "quo_monitor")).toBe(false);
    expect(canAccessNavItem(null, "leads")).toBe(false);
  });

  it("respects per-user navigation overrides for quo monitor", () => {
    const allowedOverride = [{ nav_section: "quo_monitor", allowed: true }] as NavigationPermission[];

    expect(canAccessNavItem("processor", "quo_monitor", allowedOverride)).toBe(true);
    expect(canAccessNavItem("customer_service", "quo_monitor", allowedOverride)).toBe(true);
  });
});

describe("technician details", () => {
  it("are hidden from CS Admins", () => {
    expect(canSeeTechDetails("cs_admin")).toBe(false);
  });

  it("stay visible to everyone else", () => {
    for (const role of ["admin", "processor", "customer_service", "opr"] as const) {
      expect(canSeeTechDetails(role)).toBe(true);
    }
  });
});

describe("lead coverage and source analytics", () => {
  it("is available only to Admin, independent of broader Analytics navigation grants", () => {
    expect(canViewLeadCoverageAnalytics("admin")).toBe(true);
    for (const role of ["processor", "customer_service", "cs_admin", "opr", "opr_admin", null, undefined] as const) {
      expect(canViewLeadCoverageAnalytics(role)).toBe(false);
    }
  });
});

describe("quote approval navigation access", () => {
  it.each(["customer_service", "cs_admin"] as const)("is visible to %s by default", (role) => {
    expect(getDefaultNavAccess(role).has("quote_approval_requests")).toBe(true);
    expect(canAccessNavItem(role, "quote_approval_requests")).toBe(true);
  });

  it("respects an admin-managed deny override", () => {
    const deniedOverride = [{ nav_section: "quote_approval_requests", allowed: false }] as NavigationPermission[];

    expect(canAccessNavItem("customer_service", "quote_approval_requests", deniedOverride)).toBe(false);
    expect(canAccessNavItem("cs_admin", "quote_approval_requests", deniedOverride)).toBe(false);
  });

  it("can be granted to another non-admin role", () => {
    const allowedOverride = [{ nav_section: "quote_approval_requests", allowed: true }] as NavigationPermission[];

    expect(canAccessNavItem("processor", "quote_approval_requests", allowedOverride)).toBe(true);
  });
});

describe("AI Assistance (CS missed-lead tracker) navigation access", () => {
  it("is in the default navigation of the CS team and visible to them", () => {
    for (const role of ["cs_admin", "customer_service"] as const) {
      expect(getDefaultNavAccess(role).has("ai_assistance")).toBe(true);
      expect(canAccessNavItem(role, "ai_assistance")).toBe(true);
    }
  });

  it("is always visible to admin", () => {
    expect(canAccessNavItem("admin", "ai_assistance")).toBe(true);
  });

  it("is hidden from non-CS roles, by default", () => {
    for (const role of ["processor", "opr", "opr_admin"] as const) {
      expect(getDefaultNavAccess(role).has("ai_assistance")).toBe(false);
      expect(canAccessNavItem(role, "ai_assistance")).toBe(false);
    }
    expect(canAccessNavItem(null, "ai_assistance")).toBe(false);
  });

  it("is NOT grantable to non-CS roles via a navigation override", () => {
    const allowedOverride = [{ nav_section: "ai_assistance", allowed: true }] as NavigationPermission[];
    expect(canAccessNavItem("processor", "ai_assistance", allowedOverride)).toBe(false);
    expect(canAccessNavItem("opr", "ai_assistance", allowedOverride)).toBe(false);
  });

  it("cannot be revoked from the CS team via a deny override (gate wins)", () => {
    const deniedOverride = [{ nav_section: "ai_assistance", allowed: false }] as NavigationPermission[];
    expect(canAccessNavItem("cs_admin", "ai_assistance", deniedOverride)).toBe(true);
    expect(canAccessNavItem("customer_service", "ai_assistance", deniedOverride)).toBe(true);
  });
});

describe("OPR Admin inheritance", () => {
  it("has the same default navigation as OPR", () => {
    expect([...getDefaultNavAccess("opr_admin")]).toEqual([...getDefaultNavAccess("opr")]);
  });

  it("allows OPR Admin, but not regular OPR, to delete technicians", () => {
    expect(canDeleteTechnicians("opr_admin")).toBe(true);
    expect(canDeleteTechnicians("opr")).toBe(false);
  });
});

describe("manual lead addition", () => {
  const granted = { can_add_manual_leads: true };
  const notGranted = { can_add_manual_leads: false };

  it("always allows admin and cs_admin, without needing a profile", () => {
    expect(canAddManualLead("admin", null)).toBe(true);
    expect(canAddManualLead("admin", notGranted)).toBe(true);
    expect(canAddManualLead("cs_admin", null)).toBe(true);
    expect(canAddManualLead("cs_admin", notGranted)).toBe(true);
  });

  it("denies customer_service until the flag is granted", () => {
    expect(canAddManualLead("customer_service", notGranted)).toBe(false);
    expect(canAddManualLead("customer_service", null)).toBe(false);
    expect(canAddManualLead("customer_service", undefined)).toBe(false);
    expect(canAddManualLead("customer_service", granted)).toBe(true);
  });

  it("never applies to roles that do not add leads", () => {
    expect(canAddManualLead("processor", granted)).toBe(false);
    expect(canAddManualLead("opr", granted)).toBe(false);
    expect(canAddManualLead("opr_admin", granted)).toBe(false);
  });

  it("denies an unauthenticated caller", () => {
    expect(canAddManualLead(null)).toBe(false);
    expect(canAddManualLead(undefined, granted)).toBe(false);
  });
});

describe("add lead via extension", () => {
  const granted = { can_add_manual_leads: true };
  const notGranted = { can_add_manual_leads: false };

  it("is offered to a customer_service user without the manual grant", () => {
    expect(canAddLeadViaExtension("customer_service", notGranted)).toBe(true);
    expect(canAddLeadViaExtension("customer_service", null)).toBe(true);
    expect(canAddLeadViaExtension("customer_service", undefined)).toBe(true);
  });

  it("is not offered once that user can add leads manually", () => {
    expect(canAddLeadViaExtension("customer_service", granted)).toBe(false);
    expect(canAddLeadViaExtension("admin", notGranted)).toBe(false);
    expect(canAddLeadViaExtension("cs_admin", notGranted)).toBe(false);
  });

  // The reported bug: these roles do not add leads by either route, yet the
  // button fell out of the "cannot add manually" branch and showed for them.
  it("is never offered to roles that do not add leads", () => {
    expect(canAddLeadViaExtension("processor", notGranted)).toBe(false);
    expect(canAddLeadViaExtension("opr", notGranted)).toBe(false);
    expect(canAddLeadViaExtension("opr_admin", notGranted)).toBe(false);
    expect(canAddLeadViaExtension(null)).toBe(false);
  });
});
