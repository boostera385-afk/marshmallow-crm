/**
 * Admin "Marshmallow Structure" map: how the app fits together.
 *
 *   - Screens: every sidebar item, its route, which roles open it by default
 *     (computed from canAccessNavItem, so it follows src/lib/access.ts) and the
 *     Edge Functions it calls.
 *   - Edge Functions: every function in supabase/functions and who calls it.
 *   - Donut: what the extension does and what it talks to.
 *   - Lead journey: how a lead moves from a Quo chat to Paid.
 *
 * Descriptions are hand-written; structure.test.ts checks them against the
 * code (routes in App.tsx, function folders, CRM/Donut call sites, statuses),
 * so adding a screen, function or Donut call without updating this file fails
 * the tests. Read-only: it grants nothing.
 */
import { canAccessNavItem } from "@/lib/access";
import { ALL_NAV_ITEMS, STATUS_LABELS, type NavItem } from "@/lib/constants";
import { NAV_ACCESS_ROWS, ROLE_LABELS } from "@/lib/documentation-content";
import type { AppRole, LeadStatus } from "@/types";

export type EdgeCaller = "crm" | "donut" | "quo" | "schedule" | "manual";

export const EDGE_CALLER_LABELS: Record<EdgeCaller, string> = {
  crm: "CRM",
  donut: "Donut",
  quo: "Quo webhook",
  schedule: "Scheduled job",
  manual: "Run by hand",
};

export interface EdgeFunctionInfo {
  name: string;
  group: string;
  purpose: string;
  callers: EdgeCaller[];
}

export const EDGE_FUNCTION_GROUPS = [
  "Quo / OpenPhone ingestion",
  "Leads, addresses & maps",
  "AI checks (advisory)",
  "Processor Board",
  "Notifications & requests",
  "Admin, data & health",
] as const;

export const EDGE_FUNCTIONS: EdgeFunctionInfo[] = [
  { name: "quo-webhook", group: "Quo / OpenPhone ingestion", purpose: "Main Quo webhook: checks the signature, then saves conversations and messages. Never replaces an existing conversation-to-lead link.", callers: ["quo"] },
  { name: "quo-message-webhook", group: "Quo / OpenPhone ingestion", purpose: "Second Quo webhook receiver for message events.", callers: ["quo"] },
  { name: "quo-reconcile-sync", group: "Quo / OpenPhone ingestion", purpose: "Safety-net backfill of recent messages from the Quo API. Its schedule was removed in 2026-08; run when needed.", callers: ["manual"] },
  { name: "quo-sync-contacts", group: "Quo / OpenPhone ingestion", purpose: "Copies contact names and numbers onto conversations. Its schedule was removed in 2026-08; run when needed.", callers: ["manual"] },
  { name: "quo-sync-history", group: "Quo / OpenPhone ingestion", purpose: "Backfills the message history of one conversation.", callers: ["manual"] },
  { name: "quo-reprocess-stuck-events", group: "Quo / OpenPhone ingestion", purpose: "One-off recovery of webhook events stuck during the 2026-11-07 / 11-09 outages.", callers: ["manual"] },
  { name: "quo-webhook-events-retention", group: "Quo / OpenPhone ingestion", purpose: "Daily: archives raw webhook events older than 30 days to private storage, then removes them. Messages are kept.", callers: ["schedule"] },
  { name: "quo-admin-controls", group: "Quo / OpenPhone ingestion", purpose: "Admin-only pause / resume of Quo ingestion.", callers: ["manual"] },

  { name: "geocode-lead-address", group: "Leads, addresses & maps", purpose: "Find Address: US Census-only lookup for a lead's map point. City/ZIP guesses are never saved.", callers: ["crm", "donut"] },
  { name: "generate-nearby-areas", group: "Leads, addresses & maps", purpose: "The five largest nearby populated places shown in the lead form.", callers: ["crm"] },

  { name: "check-urgent-lead", group: "AI checks (advisory)", purpose: "Urgent check: compares the saved lead with the customer chat before a lead becomes Urgent. Unavailable is never treated as passed.", callers: ["crm", "donut"] },
  { name: "refresh-urgent-statuses", group: "AI checks (advisory)", purpose: "Short AI Status label for each urgent lead, from its customer chat.", callers: ["crm", "schedule"] },
  { name: "suggest-cancellation-reason", group: "AI checks (advisory)", purpose: "Suggests a cancellation reason from a fixed list.", callers: ["crm"] },
  { name: "schedule-confirmation-monitor", group: "AI checks (advisory)", purpose: "Reads replies on leads Waiting for CX for schedule confirmation and sets Ready to schedule or Customer Require New Schedule.", callers: ["schedule"] },
  { name: "technician-chat-assessment", group: "AI checks (advisory)", purpose: "Technician Intelligence: advisory labels from technicians' recent Quo messages (Admin and Processor).", callers: ["crm", "donut"] },
  { name: "marshmallow-copilot", group: "AI checks (advisory)", purpose: "Read-only Copilot assistant. Paused.", callers: ["crm"] },

  { name: "processor-board", group: "Processor Board", purpose: "Reads the technician chat for each job and returns advisory facts for the Processor Board.", callers: ["crm"] },
  { name: "processor-board-daily", group: "Processor Board", purpose: "Background re-check (every 5 minutes) of completed, unpaid jobs, including Send Dose.", callers: ["schedule"] },

  { name: "workflow-inbox", group: "Notifications & requests", purpose: "Notification center and request resolution API.", callers: ["crm"] },
  { name: "cx-update-requests", group: "Notifications & requests", purpose: "Older proxy for Get CX / Tech Update. The CRM now calls the workflow_requests database function directly.", callers: [] },

  { name: "admin-users", group: "Admin, data & health", purpose: "Admin user API (create, password, delete, 2FA) and the sign-in access-code check.", callers: ["crm", "donut"] },
  { name: "google-sheets-sync", group: "Admin, data & health", purpose: "Keeps the Google Sheets copy of leads in step: outbox worker, retries, full rebuild.", callers: ["crm", "schedule"] },
  { name: "sync-us-places", group: "Admin, data & health", purpose: "Refreshes US Census places and population (Sync Population Data).", callers: ["crm"] },
  { name: "jellybean-match-leads", group: "Admin, data & health", purpose: "Every minute while leads are waiting: asks JellyBean whether each lead's phone was already a JellyBean lead, and which department (ND / FB / SEO). Feeds Leads by Department analytics.", callers: ["schedule"] },
  { name: "system-health-watch", group: "Admin, data & health", purpose: "Every minute: reads database memory, CPU and disk and slows background work when the server is under load.", callers: ["schedule"] },
];

export interface ScreenInfo {
  navItem: NavItem;
  /** Route path, or null for a feature that lives inside another screen. */
  path: string | null;
  purpose: string;
  edgeFunctions: string[];
}

export const SCREENS: ScreenInfo[] = [
  { navItem: "leads", path: "/leads", purpose: "All Leads, Urgent Leads, Need Attention and the lead page: create, edit, status, tags, notes, photos, quotes and requests.", edgeFunctions: ["check-urgent-lead", "refresh-urgent-statuses", "geocode-lead-address", "generate-nearby-areas", "suggest-cancellation-reason"] },
  { navItem: "schedule", path: "/schedule", purpose: "Scheduled jobs by date.", edgeFunctions: [] },
  { navItem: "processor_board", path: "/processor-board", purpose: "Processors' assigned, unfinished jobs with AI facts from the technician chat.", edgeFunctions: ["processor-board"] },
  { navItem: "map_view", path: "/map-view", purpose: "Leads and technicians on a map, with coverage circles.", edgeFunctions: [] },
  { navItem: "quo_monitor", path: "/quo-monitor", purpose: "QUO Inbox: the mirrored Quo conversations, flags and follow-ups.", edgeFunctions: [] },
  { navItem: "ai_assistance", path: "/ai-assistance", purpose: "Missed-Lead Tracker: Quo chats that may be leads nobody created.", edgeFunctions: [] },
  { navItem: "notifications", path: "/notifications", purpose: "Notification center and workflow alerts.", edgeFunctions: ["workflow-inbox"] },
  { navItem: "cancellation_requests", path: "/lead-cancellation-requests", purpose: "Review cancellation requests.", edgeFunctions: [] },
  { navItem: "payment_requests", path: "/lead-payment-requests", purpose: "Approve Paid / Partial Paid requests.", edgeFunctions: [] },
  { navItem: "quote_approval_requests", path: "/quote-approval", purpose: "Approve or decline quote requests from CS.", edgeFunctions: [] },
  { navItem: "quote_pending_requests", path: "/quote-pending", purpose: "Quotes to Send for Quotation Masters.", edgeFunctions: [] },
  { navItem: "technician_change_requests", path: "/tech-approvals", purpose: "Approve technician Good Tech / active flag changes.", edgeFunctions: [] },
  { navItem: "urgent_review_requests", path: "/urgent-review-requests", purpose: "Review urgent jobs the urgent check flagged.", edgeFunctions: ["check-urgent-lead"] },
  { navItem: "cx_updates", path: "/get-cx-update", purpose: "Get CX Update and Get Tech Update threads between teams.", edgeFunctions: [] },
  { navItem: "technicians", path: "/technicians", purpose: "Technician directory, OPR / Tech reports and Processing Workflow.", edgeFunctions: ["technician-chat-assessment"] },
  { navItem: "areas", path: "/areas", purpose: "Area Insights: totals, closure and cancel rates by area.", edgeFunctions: [] },
  { navItem: "optimization", path: "/optimization", purpose: "Areas ranked on closed jobs; mark areas to track.", edgeFunctions: [] },
  { navItem: "analytics", path: "/analytics", purpose: "Operations, lead coverage, Leads by Department (JellyBean ND / FB / SEO) and CS team performance analytics.", edgeFunctions: [] },
  { navItem: "cs_team_performance", path: null, purpose: "CS Team Performance section of Analytics, grantable on its own.", edgeFunctions: [] },
  { navItem: "activity_logs", path: "/activity-logs", purpose: "Audit trail of every recorded action.", edgeFunctions: [] },
  { navItem: "settings", path: "/settings", purpose: "Users, Feature Access, Status Visibility, Templates, Security, CRM Updates, Google Sheets, Documentation, Structure.", edgeFunctions: ["admin-users", "google-sheets-sync", "sync-us-places"] },
  { navItem: "quick_chat", path: null, purpose: "Quick Chat with the customer from a lead.", edgeFunctions: [] },
  { navItem: "tech_quick_chat", path: null, purpose: "Quick Chat with the technician from a lead.", edgeFunctions: [] },
];

export type DonutTargetKind = "edge" | "rpc" | "table" | "storage" | "site";

export interface DonutCapability {
  title: string;
  description: string;
  talksTo: Array<{ kind: DonutTargetKind; name: string }>;
}

export const DONUT_CAPABILITIES: DonutCapability[] = [
  {
    title: "Sign in",
    description: "Signs in with the same Supabase account as the CRM, reads the user's role and checks the 6-digit access code.",
    talksTo: [{ kind: "table", name: "user_roles" }, { kind: "table", name: "profiles" }, { kind: "edge", name: "admin-users" }],
  },
  {
    title: "Create a lead from a Quo chat",
    description: "Builds a lead from highlighted chat text in Quo, finds the address, previews technician coverage and saves the lead with its photos.",
    talksTo: [
      { kind: "site", name: "quo.com" },
      { kind: "edge", name: "geocode-lead-address" },
      { kind: "rpc", name: "preview_lead_technician_coverage" },
      { kind: "rpc", name: "preview_lead_technician_coverage_at_point" },
      { kind: "table", name: "leads" },
      { kind: "table", name: "lead_photos" },
      { kind: "storage", name: "lead-photos" },
    ],
  },
  {
    title: "Check Lead / Urgent",
    description: "Updates an existing lead's schedule requirement and runs the same urgent check as the CRM before a lead becomes Urgent.",
    talksTo: [{ kind: "table", name: "leads" }, { kind: "edge", name: "check-urgent-lead" }, { kind: "rpc", name: "approve_urgent_verification" }],
  },
  {
    title: "Quote approval request",
    description: "Sends a quote for approval through the same database function the CRM uses.",
    talksTo: [{ kind: "rpc", name: "request_quote_approval" }],
  },
  {
    title: "Technician Intelligence",
    description: "Admin and Processor: advisory technician labels in Quo.",
    talksTo: [{ kind: "edge", name: "technician-chat-assessment" }],
  },
  {
    title: "CRM bridge",
    description: "Inside the CRM tab: reports the installed Donut version and hands lead photos to a Quo chat. The user still presses Send in Quo.",
    talksTo: [{ kind: "site", name: "marshmallow-crm.lovable.app" }, { kind: "site", name: "quo.com" }],
  },
];

export interface JourneyStep {
  title: string;
  who: string;
  description: string;
  statuses: LeadStatus[];
  edgeFunctions: string[];
}

export const LEAD_JOURNEY: JourneyStep[] = [
  {
    title: "1. Customer texts or calls in Quo",
    who: "Customer",
    description: "Quo sends each message to the signed webhook; the chat appears in the QUO Inbox and the Missed-Lead Tracker.",
    statuses: [],
    edgeFunctions: ["quo-webhook", "quo-message-webhook"],
  },
  {
    title: "2. Lead created",
    who: "CS (Donut in Quo, or New Lead in the CRM)",
    description: "Customer, address (Census map point), service, schedule requirement, quote terms and photos are saved. Duplicate phone numbers are blocked.",
    statuses: ["waiting_complete_details"],
    edgeFunctions: ["geocode-lead-address", "generate-nearby-areas"],
  },
  {
    title: "3. Urgent check (when made urgent)",
    who: "CS / CS Admin / Admin; Processors set Urgent directly",
    description: "The AI compares the saved lead with the chat. Clean: Urgent Job. Issues: Urgent Review for a CS Admin. Unavailable: must be acknowledged.",
    statuses: ["urgent_job"],
    edgeFunctions: ["check-urgent-lead"],
  },
  {
    title: "4. Quote",
    who: "CS asks; Admin / CS Admin approve; Quotation Masters send",
    description: "Quote approval request, then Quote Pending to Send, then Quote Updated (pinned for the requester) and Quote Sent - Waiting.",
    statuses: ["needs_quote", "tech_making_quote", "pending_to_send", "quote_updated", "quote_sent_waiting"],
    edgeFunctions: [],
  },
  {
    title: "5. Technician and schedule",
    who: "Processor and CS",
    description: "A technician is found and recorded in the Processor notes; the schedule is agreed with the customer. The AI can confirm the customer's reply.",
    statuses: ["need_tech", "scheduled"],
    edgeFunctions: ["schedule-confirmation-monitor"],
  },
  {
    title: "6. Job and Processor Board",
    who: "Processor",
    description: "The Processor Board follows the job through the technician chat until it is done.",
    statuses: ["job_in_progress", "job_done", "payment_pending"],
    edgeFunctions: ["processor-board", "processor-board-daily"],
  },
  {
    title: "7. Payment",
    who: "Processor requests; only Admin approves",
    description: "A Paid / Partial Paid request with amount and screenshot puts the lead in Paid Approval Pending. Admin approves (Paid is final) or rejects.",
    statuses: ["payment_requested", "partial_paid", "paid"],
    edgeFunctions: [],
  },
  {
    title: "Side exit: cancellation",
    who: "Any team member requests; Admin or Processor reviews",
    description: "A reason and optional proof put the lead in Cancellation Pending; approval cancels it, rejection restores the previous status.",
    statuses: ["cancellation_requested", "cancelled"],
    edgeFunctions: ["suggest-cancellation-reason"],
  },
];

export const STRUCTURE_ROLES = Object.keys(ROLE_LABELS) as AppRole[];

/** Roles that open a screen with no per-user overrides (Admin always does). */
export function defaultRolesFor(navItem: NavItem): AppRole[] {
  return STRUCTURE_ROLES.filter((role) => canAccessNavItem(role, navItem, []));
}

const NAV_ROW_BY_KEY = new Map(NAV_ACCESS_ROWS.map(([key, label, rule]) => [key, { label, rule }]));

export function screenLabel(navItem: NavItem): string {
  return NAV_ROW_BY_KEY.get(navItem)?.label ?? navItem;
}

export function screenAccessRule(navItem: NavItem): string {
  return NAV_ROW_BY_KEY.get(navItem)?.rule ?? "";
}

export function statusLabel(status: LeadStatus): string {
  return STATUS_LABELS[status];
}

export const ALL_SCREEN_KEYS: readonly NavItem[] = ALL_NAV_ITEMS;

export interface OutsideService {
  name: string;
  role: string;
  via: string;
}

export const OUTSIDE_SERVICES: OutsideService[] = [
  { name: "Supabase", role: "Database, sign-in, file storage, realtime updates and Edge Functions.", via: "CRM and Donut, signed in as the user" },
  { name: "Quo / OpenPhone", role: "Customer and technician texts and calls.", via: "Signed webhooks in; Donut works inside the Quo web app" },
  { name: "OpenAI (gpt-4o-mini)", role: "Advisory AI checks. The key is an Edge Function secret only.", via: "Edge Functions" },
  { name: "US Census geocoder", role: "Lead map points and population data.", via: "geocode-lead-address, sync-us-places" },
  { name: "Google Sheets", role: "A copy of every lead for reporting.", via: "google-sheets-sync" },
  { name: "Lovable", role: "Hosts the CRM; users get changes only after Publish.", via: "CRM Publish" },
];

export type StructureNodeKind =
  | "root"
  | "branch"
  | "group"
  | "step"
  | "screen"
  | "function"
  | "capability"
  | "service"
  | "role"
  | "status"
  | "caller"
  | "target"
  | "note";

export interface StructureNode {
  id: string;
  label: string;
  kind: StructureNodeKind;
  /** One line shown beside or under the label. */
  detail?: string;
  children?: StructureNode[];
}

const TARGET_PREFIX: Record<DonutTargetKind, string> = {
  edge: "Edge Function",
  rpc: "Database function",
  table: "Table",
  storage: "Storage bucket",
  site: "Website",
};

const fnLeaf = (parent: string, name: string): StructureNode => ({ id: `${parent}/fn:${name}`, label: name, kind: "function" });

/** The whole of Marshmallow as one tree: root → five branches → their items → details. */
export function buildStructureTree(): StructureNode {
  const journey: StructureNode = {
    id: "journey",
    label: "Lead journey",
    kind: "branch",
    detail: "From a Quo chat to Paid",
    children: LEAD_JOURNEY.map((step, index) => {
      const id = `journey/${index}`;
      const children: StructureNode[] = [{ id: `${id}/who`, label: step.who, kind: "note", detail: "Who acts" }];
      if (step.statuses.length > 0) {
        children.push({
          id: `${id}/statuses`,
          label: "Statuses",
          kind: "group",
          children: step.statuses.map((status) => ({ id: `${id}/status:${status}`, label: STATUS_LABELS[status], kind: "status" })),
        });
      }
      if (step.edgeFunctions.length > 0) {
        children.push({ id: `${id}/fns`, label: "Edge Functions", kind: "group", children: step.edgeFunctions.map((fn) => fnLeaf(`${id}/fns`, fn)) });
      }
      return { id, label: step.title, kind: "step", detail: step.description, children };
    }),
  };

  const screens: StructureNode = {
    id: "screens",
    label: "CRM screens",
    kind: "branch",
    detail: "Every sidebar item and who opens it",
    children: SCREENS.map((screen) => {
      const id = `screens/${screen.navItem}`;
      const children: StructureNode[] = [
        {
          id: `${id}/roles`,
          label: "Opens by default",
          kind: "group",
          children: defaultRolesFor(screen.navItem).map((role) => ({ id: `${id}/role:${role}`, label: ROLE_LABELS[role], kind: "role" })),
        },
        { id: `${id}/rule`, label: screenAccessRule(screen.navItem), kind: "note", detail: "Access rule" },
      ];
      if (screen.edgeFunctions.length > 0) {
        children.push({ id: `${id}/fns`, label: "Calls", kind: "group", children: screen.edgeFunctions.map((fn) => fnLeaf(`${id}/fns`, fn)) });
      }
      return { id, label: screenLabel(screen.navItem), kind: "screen", detail: `${screen.path ?? "Inside another screen"} · ${screen.purpose}`, children };
    }),
  };

  const functions: StructureNode = {
    id: "edge",
    label: "Edge Functions",
    kind: "branch",
    detail: "Server code that holds the secrets",
    children: EDGE_FUNCTION_GROUPS.map((group) => ({
      id: `edge/${group}`,
      label: group,
      kind: "group",
      children: EDGE_FUNCTIONS.filter((fn) => fn.group === group).map((fn) => ({
        id: `edge/fn:${fn.name}`,
        label: fn.name,
        kind: "function",
        detail: fn.purpose,
        children: fn.callers.length > 0
          ? fn.callers.map((caller) => ({ id: `edge/fn:${fn.name}/by:${caller}`, label: EDGE_CALLER_LABELS[caller], kind: "caller", detail: "Called by" }))
          : [{ id: `edge/fn:${fn.name}/by:none`, label: "Not called by anything", kind: "note" }],
      })),
    })),
  };

  const donut: StructureNode = {
    id: "donut",
    label: "Donut extension",
    kind: "branch",
    detail: "Chrome extension used inside Quo",
    children: DONUT_CAPABILITIES.map((capability, index) => ({
      id: `donut/${index}`,
      label: capability.title,
      kind: "capability",
      detail: capability.description,
      children: capability.talksTo.map((target) => ({
        id: `donut/${index}/${target.kind}:${target.name}`,
        label: target.name,
        kind: target.kind === "edge" ? "function" : "target",
        detail: TARGET_PREFIX[target.kind],
      })),
    })),
  };

  const services: StructureNode = {
    id: "services",
    label: "Outside services",
    kind: "branch",
    detail: "What Marshmallow depends on",
    children: OUTSIDE_SERVICES.map((service) => ({
      id: `services/${service.name}`,
      label: service.name,
      kind: "service",
      detail: service.role,
      children: [{ id: `services/${service.name}/via`, label: service.via, kind: "note", detail: "Used through" }],
    })),
  };

  return { id: "root", label: "Marshmallow", kind: "root", detail: "CRM + Donut on Supabase", children: [journey, screens, functions, donut, services] };
}

/**
 * Keeps nodes whose label or detail matches, plus their ancestors (so the path
 * stays visible) and, for a matching node, all of its children. Returns null
 * when nothing matches.
 */
export function filterStructureTree(node: StructureNode, query: string): StructureNode | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return node;
  const selfMatches = node.label.toLowerCase().includes(needle) || (node.detail ?? "").toLowerCase().includes(needle);
  if (selfMatches && node.kind !== "root") return node;
  const children = (node.children ?? []).map((child) => filterStructureTree(child, query)).filter((child): child is StructureNode => child !== null);
  if (children.length === 0) return node.kind === "root" && selfMatches ? node : null;
  return { ...node, children };
}

/** Ids of every node that has children (for Expand all and for search results). */
export function branchIds(node: StructureNode): string[] {
  if (!node.children?.length) return [];
  return [node.id, ...node.children.flatMap(branchIds)];
}
