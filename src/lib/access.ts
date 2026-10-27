import type { AppRole, NavigationPermission, LeadStatus } from "@/types";
import { ALL_LEAD_STATUSES, ALL_NAV_ITEMS, type NavItem } from "@/lib/constants";

const DEFAULT_NAV_ACCESS: Record<AppRole, Set<NavItem>> = {
  admin: new Set(ALL_NAV_ITEMS),
  processor: new Set(["leads", "schedule", "processor_board", "cancellation_requests", "map_view", "technicians", "cx_updates", "notifications"]),
  customer_service: new Set(["leads", "schedule", "quote_approval_requests", "ai_assistance", "cx_updates", "notifications"]),
  opr: new Set(["leads"]),
  // The urgent review queue is the CS Admin side of the AI check. customer_service
    // is left out on purpose: they raise requests, they do not clear them, and a
    // CS Admin cannot approve a request they raised themselves.
    //
    // ai_assistance (the CS Missed-Lead Tracker) is a shared CS shift-start
    // worklist — admin, cs_admin and customer_service. See the gate in
    // canAccessNavItem below; it is not grantable to processor/opr.
    cs_admin: new Set(["leads", "schedule", "quote_approval_requests", "urgent_review_requests", "ai_assistance", "cx_updates", "notifications"]),
  // opr_admin mirrors opr's default access; the Technicians tab is granted per
  // user via navigation permissions, and unlocks add/import for this role.
  opr_admin: new Set(["leads"]),
};

export function canRequestCxUpdate(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "processor";
}

export function canAccessProcessorBoard(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "processor";
}

export function canAccessCxUpdates(role: AppRole | null | undefined): boolean {
  return canRequestCxUpdate(role) || role === "cs_admin" || role === "customer_service";
}

/** Full notification history is recipient-only, not an organization-wide inbox. */
export const canAccessNotifications = canAccessCxUpdates;

export function canResolveUpdateRequest(role: AppRole | null | undefined, userId: string | undefined, ownerId: string | null) {
  return canAccessCxUpdates(role) && Boolean(userId) && userId === ownerId;
}

export function canCompleteCxUpdate(role: AppRole | null | undefined): boolean {
  return role === "cs_admin" || role === "customer_service";
}

export function canRequestTechUpdate(role: AppRole | null | undefined): boolean {
  return role === "cs_admin" || role === "customer_service";
}

/** Admin can monitor the queue; Processor is the role that records the reply. */
export function canCompleteTechUpdate(role: AppRole | null | undefined): boolean {
  return role === "processor";
}

/** Roles that may add a technician when they have the Technicians tab. */
export function canAddTechnicians(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "processor" || role === "opr" || role === "opr_admin";
}

/** Roles that may bulk-import technicians (regular opr cannot). */
export function canImportTechnicians(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "processor" || role === "opr_admin";
}

/** Regular OPR users can maintain their technicians but cannot delete them. */
export function canDeleteTechnicians(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "processor" || role === "opr_admin";
}

/** Only admins may export data anywhere in the app. */
export function canExportData(role: AppRole | null | undefined): boolean {
  return role === "admin";
}

/**
 * Analytics opens for the whole page ("analytics") or for the CS Team Performance
 * section alone ("cs_team_performance"), which can be granted without Analytics.
 */
export function canOpenAnalytics(canAccess: (navItem: string) => boolean): boolean {
  return canAccess("analytics") || canAccess("cs_team_performance");
}

/** Full lead intake coverage/source reporting is an Admin-only Analytics view. */
export function canViewLeadCoverageAnalytics(role: AppRole | null | undefined): boolean {
  return role === "admin";
}

/**
 * Whether this user may create a lead from inside the CRM (the "New Lead"
 * button and the ⌘N command). Admin and CS Admin always may; a CS user needs
 * the per-user `can_add_manual_leads` grant from Settings.
 *
 * Everyone else adds leads through the Chrome extension, which does not go
 * through this check.
 */
export function canAddManualLead(
  role: AppRole | null | undefined,
  profile?: { can_add_manual_leads?: boolean | null } | null,
): boolean {
  if (!role) {
    return false;
  }

  if (role === "admin" || role === "cs_admin") {
    return true;
  }

  if (role === "customer_service") {
    return Boolean(profile?.can_add_manual_leads);
  }

  return false;
}

/**
 * Who is offered the "Add Lead via Extension" button: a Customer Service user
 * who has not been granted Manual Lead Addition, and so captures leads through
 * the extension instead. Processors and Operators create no leads by either
 * route, so they get neither this nor the New Lead button.
 */
export function canAddLeadViaExtension(
  role: AppRole | null | undefined,
  profile?: { can_add_manual_leads?: boolean | null } | null,
): boolean {
  return role === "customer_service" && !canAddManualLead(role, profile);
}

/** Roles that manage technicians across OPRs must choose an OPR code. */
export function mustChooseOprCode(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "processor" || role === "opr_admin";
}

/**
 * How the Technicians list is scoped for a role:
 * - "all": admin / processor see every technician
 * - "coded": opr_admin sees any technician with an OPR code (legacy ones hidden)
 * - "own": opr sees only technicians with their own OPR code
 */
export function technicianVisibility(role: AppRole | null | undefined): "all" | "coded" | "own" {
  if (role === "opr") return "own";
  if (role === "opr_admin") return "coded";
  return "all";
}

export const canAccessCancellationRequests = (role: AppRole | null | undefined) =>
  role === "admin" || role === "processor";

/**
 * opr_admin has the same access as a regular opr (read-only leads, urgent-only,
 * etc.), so lead-side restrictions treat both the same.
 */
export function isOperatorRole(role: AppRole | null | undefined): boolean {
  return role === "opr" || role === "opr_admin";
}

export function getDefaultNavAccess(role: AppRole): Set<NavItem> {
  return new Set(DEFAULT_NAV_ACCESS[role]);
}

export function canAccessNavItem(
  role: AppRole | null | undefined,
  navItem: string,
  permissions: NavigationPermission[] = [],
): boolean {
  if (!role) {
    return false;
  }

  if (!ALL_NAV_ITEMS.includes(navItem as NavItem)) {
    return false;
  }

  if (role === "admin") {
    return true;
  }

  if (navItem === "payment_requests") {
    // Admin-only page
    return false;
  }

  if (navItem === "cx_updates") return canAccessCxUpdates(role);
  if (navItem === "notifications") return canAccessNotifications(role);
  if (navItem === "processor_board") return canAccessProcessorBoard(role);

  if (navItem === "ai_assistance") {
    // CS Missed-Lead Tracker — a shared CS worklist. Admin is handled above;
    // CS Admin and CS agents get it, and it is deliberately NOT grantable to
    // processor/opr, so a navigation_permissions override cannot widen it. The
    // backend RPC (list_cs_missed_followups) enforces the same role gate.
    return role === "cs_admin" || role === "customer_service";
  }

if (navItem === "crm_updates") {
      // Admin-only page
      return false;
    }

    if (navItem === "optimization") {
      // Admin-only. tech_paid_performance aggregates every lead across every
      // technician, so it cannot be narrowed per user the way a lead list can,
      // and the database refuses the call for any non-admin. Returning false
      // here stops Feature Access from offering a grant that would then fail.
      return false;
    }



  if (navItem === "cancellation_requests" && canAccessCancellationRequests(role)) {
    return true;
  }

  const override = permissions.find((permission) => permission.nav_section === navItem);
  if (override) {
    return override.allowed;
  }

  return getDefaultNavAccess(role).has(navItem as NavItem);
}

const CS_ADMIN_HIDDEN_STATUSES: LeadStatus[] = ["paid", "partial_paid", "cancelled", "job_done"];
const ADMIN_ONLY_STATUSES: LeadStatus[] = ["pending_to_send", "quote_updated"];

export function getDefaultVisibleStatuses(role: AppRole | null | undefined): Set<LeadStatus> {
  if (!role) {
    return new Set();
  }
  if (role === "admin") {
    return new Set(ALL_LEAD_STATUSES);
  }
  
  const baseExclude = ["scammed", "quote_change", ...ADMIN_ONLY_STATUSES];
  
  if (role === "opr" || role === "opr_admin") {
    return new Set<LeadStatus>(["urgent_job"]);
  }
  if (role === "processor") {
    return new Set(ALL_LEAD_STATUSES.filter((s) => !ADMIN_ONLY_STATUSES.includes(s)));
  }
  if (role === "cs_admin") {
    const csAdminExclude = ["scammed", "quote_change", "quote_updated", ...CS_ADMIN_HIDDEN_STATUSES];
    return new Set<LeadStatus>(ALL_LEAD_STATUSES.filter((s) => !csAdminExclude.includes(s)));
  }

  // customer_service never see base exclusions by default.
  return new Set<LeadStatus>(ALL_LEAD_STATUSES.filter((s) => !baseExclude.includes(s)));
}

/**
 * Technician name, number and details. Hidden from CS Admins wherever a lead is shown - the
 * lead card, the lead detail page, and the Schedule page (64a67ac) - so the rule lives here once.
 */
export function canSeeTechDetails(role: AppRole | null | undefined): boolean {
  return role !== "cs_admin";
}
