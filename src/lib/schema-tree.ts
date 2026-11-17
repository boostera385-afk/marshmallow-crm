/**
 * Admin schema tree: a readable map of Marshmallow's database (public schema).
 *
 * The structure (tables, columns, foreign keys, views, functions, enums) is
 * parsed from the generated `src/integrations/supabase/types.ts`, so it follows
 * the schema every time the types are regenerated. Only the grouping into
 * business areas and the one-line purposes below are written by hand; a table
 * missing from SCHEMA_DOMAINS still appears, under "Not yet grouped".
 *
 * This is a read-only description for Admins. It grants nothing: access is
 * enforced by RLS, RPC checks and Edge Functions, never by this map.
 */

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface SchemaForeignKey {
  columns: string[];
  table: string;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  foreignKeys: SchemaForeignKey[];
}

export interface SchemaFunction {
  name: string;
  args: string[];
}

export interface SchemaEnum {
  name: string;
  values: string[];
}

export interface ParsedSchema {
  tables: SchemaTable[];
  views: SchemaTable[];
  functions: SchemaFunction[];
  enums: SchemaEnum[];
}

/** profiles_public is a name-only view over profiles; links to it are links to profiles. */
const VIEW_ALIASES: Record<string, string> = { profiles_public: "profiles" };

function sectionBetween(source: string, start: string, end: string, from: number): string {
  const startIndex = source.indexOf(start, from);
  if (startIndex < 0) return "";
  const endIndex = source.indexOf(end, startIndex + start.length);
  return source.slice(startIndex + start.length, endIndex < 0 ? undefined : endIndex);
}

/** Splits a section into its top-level entries (keys indented by six spaces). */
function entries(section: string): Array<{ name: string; body: string }> {
  const result: Array<{ name: string; body: string }> = [];
  const pattern = /^ {6}(\w+):/gm;
  const matches = [...section.matchAll(pattern)];
  matches.forEach((match, index) => {
    const bodyEnd = index + 1 < matches.length ? matches[index + 1].index : section.length;
    result.push({ name: match[1], body: section.slice((match.index ?? 0) + match[0].length, bodyEnd) });
  });
  return result;
}

function parseRelations(name: string, body: string): SchemaTable {
  const rowStart = body.indexOf("Row: {");
  const rowEnd = body.indexOf("\n        }", rowStart);
  const rowText = rowStart >= 0 ? body.slice(rowStart, rowEnd) : "";
  const columns = [...rowText.matchAll(/^ {10}(\w+): (.+)$/gm)].map(([, column, rawType]) => {
    const parts = rawType.split("|").map((part) => part.trim());
    const nullable = parts.includes("null");
    return { name: column, type: parts.filter((part) => part !== "null").join(" | ") || "null", nullable };
  });

  const relationshipText = body.slice(body.indexOf("Relationships:"));
  const seen = new Set<string>();
  const foreignKeys: SchemaForeignKey[] = [];
  for (const match of relationshipText.matchAll(/columns: \[([^\]]*)\][\s\S]*?referencedRelation: "(\w+)"/g)) {
    const fkColumns = [...match[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    const table = VIEW_ALIASES[match[2]] ?? match[2];
    const key = `${fkColumns.join(",")}->${table}`;
    if (seen.has(key)) continue;
    seen.add(key);
    foreignKeys.push({ columns: fkColumns, table });
  }
  return { name, columns, foreignKeys };
}

/** Parses the public schema out of the generated Supabase types file. */
export function parseSupabaseTypes(source: string): ParsedSchema {
  const publicStart = source.indexOf("\n  public: {");
  if (publicStart < 0) return { tables: [], views: [], functions: [], enums: [] };

  const tables = entries(sectionBetween(source, "\n    Tables: {", "\n    Views: {", publicStart)).map(({ name, body }) =>
    parseRelations(name, body),
  );
  const views = entries(sectionBetween(source, "\n    Views: {", "\n    Functions: {", publicStart)).map(({ name, body }) =>
    parseRelations(name, body),
  );
  const functions = entries(sectionBetween(source, "\n    Functions: {", "\n    Enums: {", publicStart)).map(({ name, body }) => {
    const args = new Set<string>();
    for (const argsMatch of body.matchAll(/Args: (\{[^}]*\}|never)/g)) {
      for (const arg of argsMatch[1].matchAll(/(\w+)\??:/g)) args.add(arg[1]);
    }
    return { name, args: [...args] };
  });
  const enums = entries(sectionBetween(source, "\n    Enums: {", "\n    CompositeTypes: {", publicStart)).map(({ name, body }) => ({
    name,
    values: [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  }));

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return { tables: tables.sort(byName), views: views.sort(byName), functions: functions.sort(byName), enums: enums.sort(byName) };
}

export interface SchemaDomain {
  id: string;
  label: string;
  description: string;
  /** table name -> one-line purpose */
  tables: Record<string, string>;
}

export const SCHEMA_DOMAINS: SchemaDomain[] = [
  {
    id: "leads",
    label: "Leads",
    description: "The job record at the centre of Marshmallow and everything attached directly to one lead.",
    tables: {
      leads: "One row per job: customer, address and map point, service, status and tag, schedule, quote terms and amounts, technician share, assignment.",
      lead_notes: "Note threads on a lead (General, CS, Processor, OPR), with author and \"Edited by\" stamps.",
      lead_photos: "Photos attached to a lead; files live in the private lead-photos bucket.",
      lead_payments: "Payments recorded against a lead, with amount and screenshot.",
      lead_paid_dates: "When each lead became Paid; used by date-limited Paid lead access.",
      lead_updates: "Older free-text updates on a lead, with author and role.",
      lead_drafts: "Per-user unsaved lead form drafts.",
      lead_shares: "Admin shares of a single lead with a CS user.",
      lead_operator_assignments: "Which Operator a lead is assigned to.",
      lead_ai_statuses: "AI Status label for an urgent lead, read from the customer chat.",
      lead_hold_alerts: "Operator \"Hold This Job\" cards for urgent jobs, built by the server; the Operator can only mark them read.",
    },
  },
  {
    id: "approvals",
    label: "Approvals & requests",
    description: "Changes that need someone else's sign-off. The lead moves only when the request is approved through its RPC.",
    tables: {
      lead_quote_approval_requests: "Quote approval: CS asks, Admin or CS Admin approves or declines.",
      lead_cancellation_requests: "Cancellation requests with reason, proof image and AI-suggested reason.",
      lead_payment_requests: "Paid / Partial Paid requests from Processors; only Admin approves.",
      lead_urgent_review_requests: "Urgent jobs whose urgent check found issues, waiting for CS Admin review.",
      lead_cx_update_requests: "Get CX Update / Get Tech Update threads between teams.",
      technician_change_requests: "Processor requests to change a technician's Good Tech or active flag.",
    },
  },
  {
    id: "access",
    label: "People, roles & access",
    description: "Who someone is and what they may see or do. Roles live in user_roles; per-user switches sit beside them.",
    tables: {
      profiles: "One row per user: name, email, OPR code and per-user privilege flags (set by Admin only).",
      user_roles: "Each user's role (admin, cs_admin, customer_service, processor, opr, opr_admin).",
      user_access_codes: "6-digit sign-in access codes for non-admin users.",
      navigation_permissions: "Per-user overrides for which sidebar tabs are visible (Feature Access).",
      status_permissions: "Older per-user status switches; Status Visibility now uses lead_status_visibility.",
      lead_status_visibility: "Which lead statuses a role or user can see (Status Visibility).",
      user_status_change_permissions: "Per-user list of statuses the user may change a lead to.",
      lead_copy_role_permissions: "Role defaults for Copy Details.",
      lead_copy_user_permissions: "Per-user Copy Details switch.",
      paid_lead_access: "Date range of Paid leads a user may see.",
      organizations: "Organizations (multi-company foundation).",
      organization_members: "Which users belong to which organization.",
    },
  },
  {
    id: "technicians",
    label: "Technicians & coverage",
    description: "The technician directory and the geography used to decide whether a lead is covered.",
    tables: {
      technicians: "Technician directory: name, phone, service, Area, OPR code, Good Tech and active flags.",
      technician_area_coordinate_cache: "Cached map points for technician Areas, refreshed in the background.",
      technician_workflow_assessments: "AI Technician Intelligence results per technician.",
      map_coverage_areas: "Named coverage circles drawn on the Map view.",
      optimized_areas: "Areas an Admin marked for Optimization.",
      us_places: "US Census populated places used for nearby-places and coverage (Sync Population Data).",
    },
  },
  {
    id: "quo",
    label: "Quo / OpenPhone",
    description: "Customer and technician conversations brought in from Quo by signed webhooks and syncs.",
    tables: {
      quo_conversations: "One row per Quo conversation, optionally linked to a lead.",
      quo_messages: "Individual texts in a conversation.",
      quo_conversation_flags: "Follow-up, delay and importance flags for Quo Monitor.",
      quo_phone_numbers: "The company's Quo phone numbers.",
      quo_number_preferences: "Display label, emoji, order and hiding of each Quo number.",
      quo_pinned_conversations: "Conversations pinned in Quo Monitor.",
      quo_outbound_messages: "Messages queued or sent to Quo from the CRM.",
      quo_webhook_events: "Raw incoming Quo webhook events with signature check and processing state.",
      quo_sync_logs: "History of Quo sync runs.",
      quo_ai_settings: "Key/value settings for Quo: AI analysis, ingestion controls and Quo number display names.",
      calls: "Call records used by the Processor Board lead window.",
    },
  },
  {
    id: "ai",
    label: "AI & Processor Board",
    description: "Stored results and run bookkeeping for advisory AI features. Nothing here approves or changes a lead.",
    tables: {
      processor_job_assessments: "Cached Processor Board AI review per lead, keyed by an input hash.",
      processor_job_refresh_locks: "Short leases that stop two refreshes of the same lead running at once.",
      ai_status_refresh_runs: "When the urgent AI Status refresh last ran.",
      copilot_config: "Marshmallow Copilot switch and budget (Copilot is paused).",
      copilot_role_permissions: "Copilot access by role.",
      copilot_user_permissions: "Copilot access per user.",
    },
  },
  {
    id: "notifications",
    label: "Notifications & messages",
    description: "What users are told, and the reusable text they copy.",
    tables: {
      notifications: "In-app notifications per user.",
      workflow_notification_events: "Links notifications to the request and lead revision that caused them, so none is sent twice.",
      crm_updates: "One-time announcements to chosen roles (CRM Updates).",
      crm_update_receipts: "Who acknowledged each announcement.",
      message_templates: "Admin-edited Copy Technician Message and Check Template texts.",
      user_notepads: "Each user's floating notepad.",
    },
  },
  {
    id: "audit",
    label: "Audit & Google Sheets",
    description: "The audit trail and the outbox that keeps the Google Sheets copy of leads in step.",
    tables: {
      activity_logs: "Audited actions in plain English with the actor's name.",
      google_sheets_sync_queue: "Outbox of lead changes waiting to be written to Google Sheets.",
      google_sheets_sync_health: "Sync watermark, last success and failure count for the health watchdog.",
      google_sheets_sync_errors: "Recent Sheets sync errors.",
    },
  },
];

export const UNGROUPED_DOMAIN_ID = "ungrouped";

export interface SchemaTreeTable extends SchemaTable {
  purpose: string | null;
  domainId: string;
  referencedBy: Array<{ table: string; columns: string[] }>;
}

export interface SchemaTreeDomain {
  id: string;
  label: string;
  description: string;
  tables: SchemaTreeTable[];
}

/** Groups the parsed tables into business areas and adds reverse links. */
export function buildSchemaTree(schema: ParsedSchema, domains: SchemaDomain[] = SCHEMA_DOMAINS): SchemaTreeDomain[] {
  const referencedBy = new Map<string, Array<{ table: string; columns: string[] }>>();
  for (const table of schema.tables) {
    for (const fk of table.foreignKeys) {
      if (!referencedBy.has(fk.table)) referencedBy.set(fk.table, []);
      referencedBy.get(fk.table)!.push({ table: table.name, columns: fk.columns });
    }
  }

  const tableByName = new Map(schema.tables.map((table) => [table.name, table]));
  const placed = new Set<string>();
  const toTree = (table: SchemaTable, domainId: string, purpose: string | null): SchemaTreeTable => {
    placed.add(table.name);
    return { ...table, purpose, domainId, referencedBy: referencedBy.get(table.name) ?? [] };
  };

  const tree: SchemaTreeDomain[] = domains.map((domain) => ({
    id: domain.id,
    label: domain.label,
    description: domain.description,
    tables: Object.entries(domain.tables)
      .filter(([name]) => tableByName.has(name))
      .map(([name, purpose]) => toTree(tableByName.get(name)!, domain.id, purpose)),
  }));

  const ungrouped = schema.tables.filter((table) => !placed.has(table.name));
  if (ungrouped.length > 0) {
    tree.push({
      id: UNGROUPED_DOMAIN_ID,
      label: "Not yet grouped",
      description: "Tables in the database types that are not yet placed in an area of this map.",
      tables: ungrouped.map((table) => toTree(table, UNGROUPED_DOMAIN_ID, null)),
    });
  }
  return tree.filter((domain) => domain.tables.length > 0);
}

/** Shortens generated type text for display, e.g. Database["public"]["Enums"]["app_role"] -> enum app_role. */
export function displayType(type: string): string {
  return type.replace(/Database\["public"\]\["Enums"\]\["(\w+)"\]/g, "enum $1").replace(/\bJson\b/g, "json");
}

/** Case-insensitive match on a table's name, purpose or any column name. */
export function tableMatches(table: SchemaTreeTable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    table.name.toLowerCase().includes(needle) ||
    (table.purpose ?? "").toLowerCase().includes(needle) ||
    table.columns.some((column) => column.name.toLowerCase().includes(needle))
  );
}
