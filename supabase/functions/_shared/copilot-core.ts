// Shared, dependency-free contract: CRM browser and authenticated Edge Function.
// No database client, keys or customer data belong in this module.
export const COPILOT_ROLES = ["admin", "processor", "customer_service", "cs_admin", "opr", "opr_admin"] as const;
export type CopilotRole = typeof COPILOT_ROLES[number];
export interface CopilotFeature { id: string; section: string; label: string; href: string; aliases: string[]; help: string }
export const COPILOT_FEATURES: CopilotFeature[] = [
  { id: "leads", section: "leads", label: "Leads", href: "/leads", aliases: ["leads", "lead list", "customers"], help: "Search by job ID, customer name or phone. Open a saved lead to see permitted details. Visibility and status-change access are separate." },
  { id: "schedule", section: "schedule", label: "Schedule", href: "/schedule", aliases: ["schedule", "calendar", "scheduled jobs"], help: "Review scheduled jobs and the customer's agreed schedule. Urgent priority does not change the agreed date or time." },
  { id: "technicians", section: "technicians", label: "Technicians", href: "/technicians", aliases: ["technicians", "technician directory", "tech directory"], help: "Find technicians by name, service, phone or area. Operator scoping still applies. Active does not mean available right now." },
  { id: "map", section: "map_view", label: "Map View", href: "/map-view", aliases: ["map", "map view", "nearby technicians"], help: "Review lead locations and field coverage. Saved map coordinates use the authenticated Census-only endpoint." },
  { id: "analytics", section: "analytics", label: "Analytics", href: "/analytics", aliases: ["analytics", "performance", "statistics"], help: "Review operational trends. Report scope is limited by your access; paid-transition dates cannot be inferred from creation dates." },
  { id: "areas", section: "areas", label: "Area Insights", href: "/areas", aliases: ["areas", "area insights"], help: "Compare service areas and recorded job outcomes." },
  { id: "optimization", section: "optimization", label: "Optimization", href: "/optimization", aliases: ["optimization"], help: "Admin-only area optimization and paid technician performance." },
  { id: "quo", section: "quo_monitor", label: "Quo Inbox", href: "/quo-monitor", aliases: ["quo", "inbox", "openphone", "chats"], help: "Review mirrored Quo conversations. Photo handoff is not delivery: review the attachments and send them in Quo yourself." },
  { id: "followups", section: "ai_assistance", label: "CS Missed-Lead Tracker", href: "/ai-assistance", aliases: ["followups", "missed calls", "missed leads", "ai assistance"], help: "The existing rules-based CS worklist identifies missed calls and unanswered texts. It does not need OpenAI." },
  { id: "cancellations", section: "cancellation_requests", label: "Cancellation Requests", href: "/lead-cancellation-requests", aliases: ["cancellation", "cancellations", "cancel lead"], help: "Use the existing cancellation request and review process. Copilot cannot cancel or approve a job." },
  { id: "payments", section: "payment_requests", label: "Payment Approvals", href: "/lead-payment-requests", aliases: ["payments", "payment approval", "paid approval"], help: "Admin reviews payment evidence using the existing approval workflow. Paid is terminal. Copilot cannot approve payments or set a lead to paid." },
  { id: "quotes", section: "quote_approval_requests", label: "Quote Approval", href: "/quote-approval", aliases: ["quote approval", "quotation approval"], help: "Submit and review quotations through the existing approval gate. Copilot never sends a quote." },
  { id: "quotes-send", section: "quote_pending_requests", label: "Quotes to Send", href: "/quote-pending", aliases: ["quotes to send", "pending quotes"], help: "Review the approved sending queue. Quotation Master and role restrictions remain independent of Copilot." },
  { id: "tech-approvals", section: "technician_change_requests", label: "Tech Approvals", href: "/tech-approvals", aliases: ["tech approvals", "technician approvals"], help: "Review requested technician flag changes through the existing approval process." },
  { id: "urgent", section: "urgent_review_requests", label: "Urgent Review", href: "/urgent-review-requests", aliases: ["urgent review"], help: "AI urgent checks are advisory. Unavailable is not a passed check. The existing server-side review gate remains authoritative." },
  { id: "settings", section: "settings", label: "Settings", href: "/settings", aliases: ["settings", "feature access", "permissions", "copy details"], help: "Admin controls Copilot and Copy Details in Feature Access. A user override wins over its role default; neither grants additional record visibility." },
  { id: "activity", section: "activity_logs", label: "Activity Logs", href: "/activity-logs", aliases: ["activity logs", "audit"], help: "Review recorded actions. Logs are not guaranteed to contain complete historical transitions, and access remains Admin-only in Copilot." },
];

export interface CopilotAccess { allowed: boolean; aiEnabled: boolean; role: CopilotRole | null; timezone: string; sections: string[] }
export interface CopilotConfig { enabled: boolean; ai_enabled: boolean; monthly_budget_cents: number; daily_ai_limit: number; timezone: string }
export interface CopilotUsage { requests: number; reservedCents: number; inputTokens: number; outputTokens: number; unavailable: number }
export interface CopilotDiagnostics {
  configChangedAt: string | null; lastSuccessAt: string | null; remainingCents: number;
  remainingToday: number; completedThisMonth: number; keyConfigured: boolean;
  backendVersion: string; model: string; promptVersion: string;
}
export interface CopilotSettings { config: CopilotConfig; roles: { role: CopilotRole; allowed: boolean }[]; users: { user_id: string; allowed: boolean }[]; usage: CopilotUsage; diagnostics?: CopilotDiagnostics }
export type CopilotIntent = "features" | "help" | "leads" | "technicians" | "attention" | "report" | "health" | "ai" | "explain_report" | "blocked" | "brief" | "daily_brief" | "clarify";
export interface CopilotSearchContext {
  intent: "leads" | "technicians" | "report"; query?: string; status?: string;
  service?: string; area?: string; active?: boolean | null; date?: string;
  start?: string; end?: string; scope?: "mine" | "team";
}
export interface CopilotAsk {
  action: "ask"; message: string; requestId: string; allowAi: boolean; intent?: CopilotIntent;
  query?: string; status?: string; offset?: number; start?: string; end?: string; scope?: "mine" | "team";
  service?: string; area?: string; active?: boolean | null; date?: string;
  selectedLeadId?: string; previous?: CopilotSearchContext;
  conversation?: { question: string; answer: string }[];
}
export interface CopilotCard { id: string; title: string; subtitle: string; href: string; fields: { label: string; value: string }[] }
export interface CopilotResult {
  source: "crm" | "ai"; title: string; text: string; cards: CopilotCard[];
  links: { label: string; href: string }[]; metrics: { label: string; value: number | null; description: string }[];
  hasMore: boolean; nextOffset: number; resolvedIntent: CopilotIntent; refreshedAt: string;
  searchQuery?: string;
  aiUsed?: boolean;
  filters?: { label: string; value: string }[];
  requestId?: string; noticeCode?: string;
  followup?: CopilotSearchContext;
}
export function resolveCopilotAccess(role: CopilotRole | null, enabled: boolean, roleDefault = false, override?: boolean | null) {
  return Boolean(role && enabled && (role === "admin" || (override ?? roleDefault)));
}
export function accessibleFeatures(access: CopilotAccess) {
  return access.allowed ? COPILOT_FEATURES.filter((f) => access.sections.includes(f.section)) : [];
}
export function safeCopilotHref(href: string): boolean {
  return COPILOT_FEATURES.some((f) => href === f.href) || /^\/leads\/[0-9a-f-]{36}$/i.test(href) ||
    /^\/technicians\?copilot=[0-9a-f-]{36}$/i.test(href);
}
export function businessDate(now = new Date(), timezone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((name) => parts.find((p) => p.type === name)?.value).join("-");
}
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function reportRange(message: string, today: string) {
  if (/yesterday/i.test(message)) { const day = shiftDate(today, -1); return { start: day, end: day }; }
  if (/week|last 7/i.test(message)) return { start: shiftDate(today, -6), end: today };
  return { start: today, end: today };
}
export function routeCopilotMessage(message: string): { intent: CopilotIntent; query: string; status?: string; dayOffset?: number } {
  const text = message.trim(); const lower = text.toLowerCase();
  if (/^(draft|write|compose)\b/i.test(text)) return { intent: "ai", query: text };
  if (/\b(delete|approve|cancel|reassign|send|update|change|mark|pay)\b/i.test(text) && !/\b(how|where|help|open|find|show|explain|features)\b/i.test(text)) return { intent: "blocked", query: text };
  if (/\b(daily brief|work brief|start my day|morning work)\b/i.test(text)) return { intent: "daily_brief", query: "" };
  if (/\b(this lead|selected lead|lead brief)\b/i.test(text)) return { intent: "brief", query: "" };
  if (/\b(explain|summari[sz]e)\b.*\b(report|work|day)\b/i.test(text)) return { intent: "explain_report", query: text };
  if (/\b(report|daily work|my work|team work)\b/i.test(text)) return { intent: "report", query: text };
  if (/\b(health|sync status|system status)\b/i.test(text)) return { intent: "health", query: "" };
  if (/attention|overdue|incomplete|needs attention/i.test(text)) return { intent: "attention", query: "" };
  if (/^(hi|hello|hey|help)[!. ]*$/i.test(text) || /\b(features|what can you do|what can i access)\b/i.test(text)) return { intent: "features", query: "" };
  if (/^(open|go to|navigate|where|how)\b/i.test(text)) return { intent: "help", query: text };
  if (/\b(jobs|leads)\b/i.test(text) && /today|tomorrow|yesterday|scheduled|urgent|need tech/i.test(text)) {
    return { intent: "leads", query: "", status: /urgent/i.test(text) ? "urgent_job" : /need tech/i.test(text) ? "need_tech" : /scheduled/i.test(text) ? "scheduled" : undefined,
      dayOffset: /tomorrow/i.test(text) ? 1 : /yesterday/i.test(text) ? -1 : /today/i.test(text) ? 0 : undefined };
  }
  const strip = (value: string) => value.replace(/^(find|search|show|get|look up)\s+(for\s+)?/i, "").replace(/^(a |the |any )?(lead|job|customer|technician|tech)s?\s*(details\s*)?(named |called |for |in |by |number |id )?/i, "").replace(/\s+details$/i, "").trim();
  if (/\b(tech|technician)s?\b/i.test(text)) return { intent: "technicians", query: strip(text) };
  if (/\b(lead|job|customer)s?\b/i.test(text) || /^MM[-\s]?\d+/i.test(text) || (/^[+()\d\s.-]{4,}$/.test(text) && /\d/.test(text))) return { intent: "leads", query: strip(text) };
  if (COPILOT_FEATURES.some((f) => f.aliases.includes(lower))) return { intent: "help", query: text };
  return { intent: "ai", query: text };
}
export function matchingFeatures(query: string, access: CopilotAccess) {
  const text = query.toLowerCase();
  return accessibleFeatures(access).filter((f) => f.aliases.some((alias) => text.includes(alias)));
}
export function emptyCopilotResult(intent: CopilotIntent): CopilotResult {
  return { source: "crm", title: "Marshmallow Copilot", text: "", cards: [], links: [], metrics: [], hasMore: false, nextOffset: 0, resolvedIntent: intent, refreshedAt: new Date().toISOString() };
}
export function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function isCopilotDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export function parseCopilotAccess(value: unknown): CopilotAccess {
  if (!isObject(value) || typeof value.allowed !== "boolean" || typeof value.aiEnabled !== "boolean" || typeof value.timezone !== "string" ||
      !Array.isArray(value.sections) || !value.sections.every((s) => typeof s === "string") ||
      (value.role !== null && !COPILOT_ROLES.some((r) => r === value.role))) throw new Error("Invalid Copilot access response");
  return { allowed: value.allowed, aiEnabled: value.aiEnabled, timezone: value.timezone, sections: value.sections, role: value.role as CopilotRole | null };
}
export function parseCopilotAsk(value: unknown): CopilotAsk {
  if (!isObject(value) || value.action !== "ask" || typeof value.message !== "string" || value.message.length > 1200 || !value.message.trim() ||
    typeof value.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId) || typeof value.allowAi !== "boolean") throw new Error("Invalid request");
  const intents: CopilotIntent[] = ["features", "help", "leads", "technicians", "attention", "report", "health", "ai", "explain_report", "blocked", "brief", "daily_brief", "clarify"];
  if (value.intent !== undefined && !intents.includes(value.intent as CopilotIntent)) throw new Error("Invalid intent");
  for (const key of ["query", "service", "area", "status"]) if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > 200)) throw new Error("Invalid search filter");
  for (const key of ["start", "end", "date"]) if (value[key] !== undefined && (typeof value[key] !== "string" || !isCopilotDate(value[key]))) throw new Error("Invalid date");
  if (value.scope !== undefined && value.scope !== "mine" && value.scope !== "team") throw new Error("Invalid scope");
  if (value.offset !== undefined && (!Number.isInteger(value.offset) || Number(value.offset) < 0 || Number(value.offset) > 200)) throw new Error("Invalid page");
  if (value.active !== undefined && value.active !== null && typeof value.active !== "boolean") throw new Error("Invalid active filter");
  if (value.selectedLeadId !== undefined && (typeof value.selectedLeadId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.selectedLeadId))) throw new Error("Invalid selected lead");
  let previous: CopilotSearchContext | undefined;
  if (value.previous !== undefined) {
    if (!isObject(value.previous) || !["leads", "technicians", "report"].includes(String(value.previous.intent))) throw new Error("Invalid previous search");
    // Reuse validation and copy only known fields; client context is never authority.
    const parsed = parseCopilotAsk({ ...value.previous, previous: undefined, conversation: undefined, selectedLeadId: undefined, action: "ask", message: "previous", requestId: value.requestId, allowAi: false });
    previous = { intent: parsed.intent as CopilotSearchContext["intent"], query: parsed.query, status: parsed.status,
      service: parsed.service, area: parsed.area, active: parsed.active, date: parsed.date, start: parsed.start, end: parsed.end, scope: parsed.scope };
  }
  let conversation: CopilotAsk["conversation"];
  if (value.conversation !== undefined) {
    if (!Array.isArray(value.conversation) || value.conversation.length > 3 || !value.conversation.every((t) => isObject(t) && typeof t.question === "string" && t.question.length <= 500 && typeof t.answer === "string" && t.answer.length <= 1000)) throw new Error("Invalid conversation");
    conversation = value.conversation.map((t) => ({ question: t.question, answer: t.answer }));
  }
  return { action: "ask", message: value.message.trim(), requestId: value.requestId, allowAi: value.allowAi,
    intent: value.intent as CopilotIntent | undefined, query: value.query as string | undefined, status: value.status as string | undefined,
    offset: value.offset as number | undefined, start: value.start as string | undefined, end: value.end as string | undefined, scope: value.scope as "mine" | "team" | undefined,
    service: value.service as string | undefined, area: value.area as string | undefined, active: value.active as boolean | null | undefined, date: value.date as string | undefined,
    selectedLeadId: value.selectedLeadId as string | undefined, previous, conversation };
}
