/**
 * Data for the Admin "Graph" view of Settings > Structure: an Obsidian-style
 * network of Marshmallow's parts and how they connect.
 *
 * The facts below (which Edge Functions use OpenAI, call the Quo API, receive
 * Quo webhooks or touch leads; which screens touch leads or Quo data) are
 * checked against the source code by system-graph.test.ts, which follows each
 * function's and screen's imports. Read-only; it grants nothing.
 */
import {
  DONUT_CAPABILITIES,
  EDGE_FUNCTIONS,
  SCREENS,
  screenAccessRule,
  screenLabel,
  defaultRolesFor,
} from "@/lib/app-structure";
import { ROLE_LABELS } from "@/lib/documentation-content";
import type { NavItem } from "@/lib/constants";

export type GraphNodeKind = "app" | "screen" | "function" | "data" | "service";

export type GraphEdgeKind = "ai" | "quo-api" | "webhook" | "leads" | "data" | "calls" | "scheduled" | "external" | "contains";

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  description: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: GraphEdgeKind;
}

export const EDGE_KIND_INFO: Record<GraphEdgeKind, { label: string; sentence: string; color: string }> = {
  ai: { label: "AI used here", sentence: "uses AI (OpenAI)", color: "#a855f7" },
  "quo-api": { label: "Quo API connected", sentence: "calls the Quo API", color: "#3b82f6" },
  webhook: { label: "Webhook", sentence: "receives Quo webhooks", color: "#f97316" },
  leads: { label: "Leads", sentence: "reads or changes leads", color: "#22c55e" },
  data: { label: "Other data", sentence: "reads or changes data", color: "#14b8a6" },
  calls: { label: "Calls a function", sentence: "calls an Edge Function", color: "#94a3b8" },
  scheduled: { label: "Scheduled", sentence: "runs on a timer", color: "#eab308" },
  external: { label: "Other outside service", sentence: "uses an outside service", color: "#ec4899" },
  contains: { label: "Part of", sentence: "is part of", color: "#cbd5e1" },
};

export const NODE_KIND_INFO: Record<GraphNodeKind, { label: string; color: string }> = {
  app: { label: "App", color: "#6366f1" },
  screen: { label: "CRM screen", color: "#8b5cf6" },
  function: { label: "Edge Function", color: "#0ea5e9" },
  data: { label: "Data", color: "#10b981" },
  service: { label: "Outside service", color: "#f43f5e" },
};

/** Groups of tables shown as one data dot. Login/role checks (user_roles, profiles) are left out. */
export const DATA_HUBS = {
  leads: { label: "Leads", description: "Lead records and what hangs off them: notes, photos, payments, shares, Operator assignments.", tables: ["leads", "lead_notes", "lead_photos", "lead_payments", "lead_updates", "lead_shares", "lead_operator_assignments"] },
  quo_data: { label: "Quo conversations", description: "The CRM's copy of Quo texts and calls: conversations, messages, webhook events, numbers, flags.", tables: ["quo_conversations", "quo_messages", "quo_webhook_events", "quo_phone_numbers", "quo_conversation_flags", "quo_sync_logs", "quo_outbound_messages", "quo_pinned_conversations", "quo_number_preferences"] },
  approvals: { label: "Approval requests", description: "Quote, payment, cancellation, urgent-review, CX/Tech update and technician-change requests.", tables: ["lead_cancellation_requests", "lead_payment_requests", "lead_quote_approval_requests", "lead_urgent_review_requests", "lead_cx_update_requests", "technician_change_requests"] },
  notifications: { label: "Notifications", description: "In-app notifications for each user.", tables: ["notifications"] },
  technicians: { label: "Technicians", description: "Technician directory and Technician Intelligence results.", tables: ["technicians", "technician_workflow_assessments"] },
  ai_results: { label: "AI results", description: "Saved advisory AI output: Processor Board reviews and urgent AI Status labels.", tables: ["processor_job_assessments", "processor_job_refresh_locks", "lead_ai_statuses"] },
  places: { label: "Census places", description: "US populated places and population used for nearby areas and coverage.", tables: ["us_places"] },
} as const;

export type DataHub = keyof typeof DATA_HUBS;

export type OutsideService = "openai" | "quo" | "census" | "google_maps" | "google_sheets";

export const SERVICES: Record<OutsideService, { label: string; description: string }> = {
  openai: { label: "OpenAI", description: "gpt-4o-mini, used only from Edge Functions. Advisory: it never approves or changes a status. The key is an Edge Function secret." },
  quo: { label: "Quo / OpenPhone", description: "Customer and technician texts and calls. Sends signed webhooks to Marshmallow; some functions read its API; Donut works inside the Quo web app." },
  census: { label: "US Census", description: "Address lookup for lead map points and population data." },
  google_maps: { label: "Google Maps geocoding", description: "Address corrections suggested by the urgent check." },
  google_sheets: { label: "Google Sheets", description: "A copy of every lead for reporting." },
};

export interface FunctionFacts {
  ai?: boolean;
  quoApi?: boolean;
  webhook?: boolean;
  census?: boolean;
  google?: Array<"maps" | "sheets">;
  /** Data the function's own code reads or writes. */
  data: DataHub[];
  /** Data it changes only through a database function (not visible as a table read). */
  dataViaDatabaseFunction?: DataHub[];
}

export const FUNCTION_FACTS: Record<string, FunctionFacts> = {
  "quo-webhook": { webhook: true, data: ["quo_data"] },
  "quo-message-webhook": { webhook: true, data: ["quo_data"] },
  "quo-reconcile-sync": { quoApi: true, data: ["quo_data"] },
  "quo-sync-contacts": { quoApi: true, data: ["quo_data"] },
  "quo-sync-history": { quoApi: true, data: ["quo_data"] },
  "quo-reprocess-stuck-events": { data: ["quo_data"] },
  "quo-webhook-events-retention": { data: ["quo_data"] },
  "quo-admin-controls": { data: ["quo_data"] },
  "geocode-lead-address": { census: true, data: [] },
  "generate-nearby-areas": { census: true, data: ["leads", "places"] },
  "check-urgent-lead": { ai: true, google: ["maps"], data: ["leads", "quo_data"] },
  "refresh-urgent-statuses": { ai: true, data: ["leads", "quo_data", "ai_results"] },
  "suggest-cancellation-reason": { ai: true, data: ["leads", "quo_data"] },
  "schedule-confirmation-monitor": { ai: true, data: [], dataViaDatabaseFunction: ["leads", "quo_data", "notifications"] },
  "technician-chat-assessment": { ai: true, quoApi: true, data: ["leads", "quo_data", "technicians"] },
  "marshmallow-copilot": { ai: true, data: [] },
  "processor-board": { ai: true, quoApi: true, data: ["leads", "quo_data", "technicians", "ai_results"] },
  "processor-board-daily": { ai: true, quoApi: true, data: ["leads", "quo_data", "technicians", "ai_results"] },
  "workflow-inbox": { data: [], dataViaDatabaseFunction: ["notifications", "approvals"] },
  "cx-update-requests": { data: [], dataViaDatabaseFunction: ["approvals"] },
  "admin-users": { data: ["leads", "approvals", "notifications"] },
  "google-sheets-sync": { google: ["sheets"], data: ["leads"] },
  "sync-us-places": { census: true, data: ["places"] },
  "jellybean-match-leads": { data: [], dataViaDatabaseFunction: ["leads"] },
  "system-health-watch": { data: [] },
};

/**
 * Data each screen's code (with the components it imports) reads or writes
 * directly by table. Screens can reach more through database functions.
 */
export const SCREEN_DATA: Partial<Record<NavItem, DataHub[]>> = {
  leads: ["leads", "quo_data", "approvals"],
  schedule: ["leads", "quo_data"],
  processor_board: ["quo_data"],
  map_view: ["leads", "technicians", "places"],
  quo_monitor: ["quo_data"],
  ai_assistance: ["quo_data"],
  cancellation_requests: ["leads", "approvals"],
  payment_requests: ["leads", "approvals", "technicians"],
  quote_approval_requests: ["leads", "quo_data", "approvals"],
  quote_pending_requests: ["leads", "quo_data", "approvals"],
  technician_change_requests: ["technicians", "places"],
  technicians: ["leads", "quo_data", "technicians", "places"],
  areas: ["leads"],
  optimization: ["leads", "technicians"],
  analytics: ["leads"],
  settings: ["leads", "places"],
};

/** Donut capabilities -> data, from the tables Donut writes (verified by the test). */
const DONUT_TABLE_HUB: Record<string, DataHub> = { leads: "leads", lead_photos: "leads" };

export interface GraphNodeFull extends GraphNode {
  /** Extra plain-English lines for the side panel. */
  facts: string[];
}

export interface SystemGraph {
  nodes: GraphNodeFull[];
  edges: GraphEdge[];
}

const CALLER_SENTENCE: Record<string, string> = {
  crm: "Called from the CRM",
  donut: "Called from Donut",
  quo: "Called by Quo webhooks",
  schedule: "Runs on a timer",
  manual: "Run by hand when needed",
};

export function buildSystemGraph(): SystemGraph {
  const nodes = new Map<string, GraphNodeFull>();
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  const addNode = (node: GraphNodeFull) => nodes.set(node.id, node);
  const addEdge = (source: string, target: string, kind: GraphEdgeKind) => {
    const key = `${source}|${target}|${kind}`;
    if (seenEdges.has(key) || source === target) return;
    seenEdges.add(key);
    edges.push({ source, target, kind });
  };

  addNode({ id: "app:crm", label: "Marshmallow CRM", kind: "app", description: "The web app the team signs in to (React, hosted on Lovable).", facts: [] });
  addNode({ id: "app:donut", label: "Donut extension", kind: "app", description: "Chrome extension used inside the Quo web app. Signs in as the user and uses the same server checks as the CRM.", facts: DONUT_CAPABILITIES.map((c) => c.title) });
  addNode({ id: "app:scheduler", label: "Scheduled jobs", kind: "app", description: "Database timers (pg_cron) that start some Edge Functions on their own.", facts: [] });

  (Object.keys(SERVICES) as OutsideService[]).forEach((key) =>
    addNode({ id: `svc:${key}`, label: SERVICES[key].label, kind: "service", description: SERVICES[key].description, facts: [] }),
  );
  (Object.keys(DATA_HUBS) as DataHub[]).forEach((key) =>
    addNode({ id: `data:${key}`, label: DATA_HUBS[key].label, kind: "data", description: DATA_HUBS[key].description, facts: [`Tables: ${DATA_HUBS[key].tables.join(", ")}`] }),
  );

  for (const screen of SCREENS) {
    const id = `screen:${screen.navItem}`;
    const roles = defaultRolesFor(screen.navItem).map((role) => ROLE_LABELS[role]).join(", ");
    addNode({
      id,
      label: screenLabel(screen.navItem),
      kind: "screen",
      description: screen.purpose,
      facts: [screen.path ? `Address: ${screen.path}` : "Inside another screen", `Opens by default for: ${roles}`, `Access rule: ${screenAccessRule(screen.navItem)}`],
    });
    addEdge("app:crm", id, "contains");
    screen.edgeFunctions.forEach((fn) => addEdge(id, `fn:${fn}`, "calls"));
    (SCREEN_DATA[screen.navItem] ?? []).forEach((hub) => addEdge(id, `data:${hub}`, hub === "leads" ? "leads" : "data"));
  }

  for (const fn of EDGE_FUNCTIONS) {
    const id = `fn:${fn.name}`;
    const facts = FUNCTION_FACTS[fn.name] ?? { data: [] };
    addNode({
      id,
      label: fn.name,
      kind: "function",
      description: fn.purpose,
      facts: [fn.group, ...(fn.callers.length ? fn.callers.map((c) => CALLER_SENTENCE[c]) : ["Not called by anything"])],
    });
    if (facts.ai) addEdge(id, "svc:openai", "ai");
    if (facts.quoApi) addEdge(id, "svc:quo", "quo-api");
    if (facts.webhook) addEdge("svc:quo", id, "webhook");
    if (facts.census) addEdge(id, "svc:census", "external");
    if (facts.google?.includes("maps")) addEdge(id, "svc:google_maps", "external");
    if (facts.google?.includes("sheets")) addEdge(id, "svc:google_sheets", "external");
    [...facts.data, ...(facts.dataViaDatabaseFunction ?? [])].forEach((hub) => addEdge(id, `data:${hub}`, hub === "leads" ? "leads" : "data"));
    if (fn.callers.includes("schedule")) addEdge("app:scheduler", id, "scheduled");
    if (fn.callers.includes("donut")) addEdge("app:donut", id, "calls");
  }

  for (const capability of DONUT_CAPABILITIES) {
    for (const target of capability.talksTo) {
      if (target.kind === "table" && DONUT_TABLE_HUB[target.name]) addEdge("app:donut", `data:${DONUT_TABLE_HUB[target.name]}`, "leads");
      if (target.kind === "site" && target.name === "quo.com") addEdge("app:donut", "svc:quo", "external");
    }
  }

  return { nodes: [...nodes.values()], edges };
}

const HEADINGS: Record<GraphEdgeKind, { out: string; in: string }> = {
  ai: { out: "Uses AI", in: "AI is used by" },
  "quo-api": { out: "Calls the Quo API", in: "Quo API is called by" },
  webhook: { out: "Sends webhooks to", in: "Receives webhooks from" },
  leads: { out: "Reads or changes leads", in: "Leads are read or changed by" },
  data: { out: "Reads or changes", in: "Read or changed by" },
  calls: { out: "Calls", in: "Called by" },
  scheduled: { out: "Starts on a timer", in: "Started on a timer by" },
  external: { out: "Uses", in: "Used by" },
  contains: { out: "Contains", in: "Part of" },
};

export interface ConnectionGroup {
  kind: GraphEdgeKind;
  heading: string;
  nodeIds: string[];
}

/** The connections of one node, grouped into plain-English headings. */
export function describeConnections(graph: SystemGraph, nodeId: string): ConnectionGroup[] {
  const groups = new Map<string, ConnectionGroup>();
  for (const edge of graph.edges) {
    const outgoing = edge.source === nodeId;
    if (!outgoing && edge.target !== nodeId) continue;
    const key = `${edge.kind}:${outgoing ? "out" : "in"}`;
    if (!groups.has(key)) groups.set(key, { kind: edge.kind, heading: HEADINGS[edge.kind][outgoing ? "out" : "in"], nodeIds: [] });
    groups.get(key)!.nodeIds.push(outgoing ? edge.target : edge.source);
  }
  const order: GraphEdgeKind[] = ["ai", "quo-api", "webhook", "leads", "data", "calls", "scheduled", "external", "contains"];
  return [...groups.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
