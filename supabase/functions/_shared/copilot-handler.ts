import {
  accessibleFeatures, businessDate, emptyCopilotResult, isObject, matchingFeatures, parseCopilotAccess,
  parseCopilotAsk, reportRange, routeCopilotMessage, shiftDate, type CopilotAccess, type CopilotAsk,
  type CopilotIntent, type CopilotResult,
} from "./copilot-core.ts";
import { clarification, interpretedFilters, resolveCopilotQuestion } from "./copilot-conversation.ts";
import { COPILOT_BACKEND_VERSION, COPILOT_MODEL, COPILOT_PROMPT_VERSION, CopilotProviderError } from "./copilot-provider.ts";

export interface CopilotRpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}
export interface CopilotAiAnswer { kind: "answer" | "leads" | "technicians" | "report" | "help"; query: string; text: string; inputTokens: number | null; outputTokens: number | null }
export interface CopilotServices {
  authenticate(request: Request): Promise<{ userId: string; db: CopilotRpcClient }>;
  budgetDb(): CopilotRpcClient;
  aiConfigured(): boolean;
  generate(question: string, context?: string, conversation?: { question: string; answer: string }[]): Promise<CopilotAiAnswer>;
  observe?(event: { requestId: string; code: string; durationMs: number; aiUsed: boolean; model: string; promptVersion: string }): void;
}
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
class CopilotError extends Error { constructor(message: string, public status = 400, public code = "crm_unavailable") { super(message); } }
async function rpc(db: CopilotRpcClient, name: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (error.code === "42501") throw new CopilotError("You do not have access to this Copilot feature.", 403, "access_denied");
    if (error.code === "40001") throw new CopilotError("Configuration changed in another session. Reload saved settings before saving.", 409, "config_conflict");
    if (error.message === "Choose a date range of at most 31 days") throw new CopilotError(error.message, 400, "invalid_range");
    if (error.message === "Invalid timezone") throw new CopilotError("Choose a valid IANA business timezone, such as America/New_York.", 400, "invalid_timezone");
    if (/limit reached|budget reached|Please wait|already reserved/.test(error.message)) throw new CopilotError(error.message, 429, /budget reached/.test(error.message) ? "budget_reached" : /Daily/.test(error.message) ? "daily_limit" : "request_throttled");
    if (error.code === "42883" || /schema cache|does not exist/.test(error.message)) throw new CopilotError("Copilot is not installed yet. Ask Admin to apply its migration and deploy the function.", 503);
    throw new CopilotError("The CRM request could not be completed. No records were changed.", 503);
  }
  return data;
}
const text = (value: unknown) => typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const bounded = (value: unknown) => { const s = text(value); return s.length > 650 ? `${s.slice(0, 650)}… (open record for full details)` : s; };

export async function runCopilotQuery(db: CopilotRpcClient, ask: CopilotAsk, access: CopilotAccess, intent: CopilotIntent, query: string): Promise<CopilotResult> {
  const result = emptyCopilotResult(intent);
  if (intent === "clarify") return clarification();
  if (intent === "daily_brief") {
    const report = await runCopilotQuery(db, { ...ask, scope: "mine" }, access, "report", "");
    const attention = await runCopilotQuery(db, { ...ask, offset: 0 }, access, "attention", "");
    return { ...attention, resolvedIntent: "daily_brief", title: "Your daily work brief", metrics: report.metrics,
      text: `${report.text}\n\n${attention.text}${attention.hasMore ? " Showing the first 10 attention records; use Needs attention to browse the full accessible worklist." : ""}`, hasMore: false };
  }
  if (intent === "brief") {
    if (!ask.selectedLeadId) return { ...clarification(), text: "Select a lead from a search result or open its saved detail page, then choose Lead brief. No AI allowance was used." };
    const row = await rpc(db, "copilot_lead_brief", { p_lead_id: ask.selectedLeadId });
    if (row === null) throw new CopilotError("No accessible lead was found. It may be unavailable or outside your scope.", 404, "record_unavailable");
    if (!isObject(row)) throw new CopilotError("Invalid saved lead response.", 503);
    const missing = [["Service details", row.service_details], ["Address", row.address], ["Customer schedule requirement", row.customer_schedule_requirements]].filter(([, value]) => !text(value).trim()).map(([label]) => label);
    result.title = "Saved lead brief";
    result.text = `Verified saved record · ${text(row.status).replace(/_/g, " ")}. ${missing.length ? `Missing saved information: ${missing.join(", ")}.` : "Service details, address and customer schedule requirements are recorded."} This is not an urgent-verification result. Review the source and existing approval workflow before taking action.`;
    result.cards = [{ id: text(row.id), title: `${text(row.job_id)} · ${text(row.customer_name)}`, subtitle: `${text(row.status).replace(/_/g, " ")} · ${text(row.service_type)}`, href: `/leads/${text(row.id)}`, fields: [
      { label: "Phone", value: bounded(row.customer_phone) },
      { label: "Service details", value: bounded(row.service_details) }, { label: "Address", value: [row.address, row.city, row.state, row.zip_code].map(text).filter(Boolean).join(", ") },
      { label: "Schedule requirement", value: bounded(row.customer_schedule_requirements) },
      ...(access.sections.includes("schedule") ? [{ label: "Scheduled", value: [row.scheduled_date, row.scheduled_time_start].map(text).filter(Boolean).join(" ") }] : []),
      ...(row.quote != null ? [{ label: "Quote", value: bounded(row.quote) }] : []),
      ...(access.role !== "cs_admin" && row.tech_name ? [{ label: "Technician", value: [row.tech_name, row.tech_number].map(text).filter(Boolean).join(" · ") }] : []),
    ] }];
    result.links = matchingFeatures("urgent review quote approval cancellation payments processor board cx updates tech updates", access).map((f) => ({ label: f.label, href: f.href }));
  } else if (intent === "blocked") {
    result.title = "Read-only assistant";
    result.text = "I can find records and take you to an authorised workflow, but cannot change records, approve requests or send messages.";
    result.links = matchingFeatures(query, access).map((f) => ({ label: f.label, href: f.href }));
  } else if (intent === "features" || intent === "help") {
    const features = intent === "features" ? accessibleFeatures(access) : matchingFeatures(query, access);
    result.title = intent === "features" ? "Your accessible features" : "CRM guide";
    result.text = features.length ? "Choose a feature below. Existing permissions and approval workflows still apply." : "I couldn't find an accessible feature with that name. Try Explore features or a more specific name.";
    result.cards = features.map((f) => ({ id: f.id, title: f.label, subtitle: f.help, href: f.href, fields: [] }));
  } else if (intent === "leads" || intent === "technicians" || intent === "attention") {
    const rows = await rpc(db, "copilot_search", { p_kind: intent, p_query: query, p_status: ask.status ?? null,
      p_offset: ask.offset ?? 0, p_service: ask.service ?? "", p_area: ask.area ?? "", p_active: ask.active ?? null, p_date: ask.date ?? null });
    if (!Array.isArray(rows) || !rows.every(isObject)) throw new CopilotError("Invalid CRM search response.", 503);
    result.hasMore = rows.length > 10 && (ask.offset ?? 0) < 200;
    result.nextOffset = (ask.offset ?? 0) + 10;
    result.searchQuery = query;
    result.title = intent === "technicians" ? "Technician results" : intent === "attention" ? "Needs attention" : "Lead results";
    result.text = rows.length ? "Only accessible saved records are shown. Open a record to review complete details." : "No accessible matching records found. Try a job ID, phone number, or a different search.";
    if (intent === "attention") result.text += " This worklist includes incomplete details, technician needs, follow-up and reschedule statuses, and explicit due schedule dates. Free-text schedules are not inferred here.";
    result.cards = rows.slice(0, 10).map((row) => {
      if (intent === "technicians") return { id: text(row.id), title: text(row.name), subtitle: [text(row.service), text(row.area)].filter(Boolean).join(" · "),
        href: `/technicians?copilot=${text(row.id)}`, fields: [
          { label: "Phone", value: bounded(row.phone_number) }, { label: "Active", value: row.is_active === true ? "Yes (not a live availability check)" : "No" },
          { label: "Good Tech", value: row.is_good_tech === true ? "Saved flag" : "Not flagged" }, { label: "OPR code", value: bounded(row.opr_code) },
        ] };
      const fields = [
        { label: "Phone", value: bounded(row.customer_phone) }, { label: "Service details", value: bounded(row.service_details) },
        { label: "Address", value: [row.address, row.city, row.state, row.zip_code].map(text).filter(Boolean).join(", ") },
        { label: "Schedule requirement", value: bounded(row.customer_schedule_requirements) },
        { label: "Scheduled", value: [row.scheduled_date, row.scheduled_time_start].map(text).filter(Boolean).join(" ") },
      ];
      // Defence in depth: SQL has already redacted restricted fields.
      if (row.quote !== null && row.quote !== undefined) fields.push({ label: "Quote", value: bounded(row.quote) });
      if (access.role !== "cs_admin" && row.tech_name) fields.push({ label: "Technician", value: [row.tech_name, row.tech_number].map(text).filter(Boolean).join(" · ") });
      return { id: text(row.id), title: `${text(row.job_id)} · ${text(row.customer_name)}`, subtitle: `${text(row.status).replace(/_/g, " ")} · ${text(row.service_type)}`,
        href: `/leads/${text(row.id)}`, fields };
    });
    if (intent === "attention") result.links = accessibleFeatures(access).filter((f) => ["followups", "quotes", "payments", "cancellations", "urgent", "tech-approvals", "processor-board", "cx-updates", "tech-updates"].includes(f.id)).map((f) => ({ label: f.label, href: f.href }));
  } else if (intent === "report" || intent === "explain_report") {
    const range = reportRange(ask.message, businessDate(new Date(), access.timezone));
    const scope = ask.scope ?? (/\bteam\b/i.test(ask.message) ? "team" : "mine");
    ask.start ??= range.start; ask.end ??= range.end; ask.scope ??= scope;
    const report = await rpc(db, "copilot_report", { p_start: ask.start ?? range.start, p_end: ask.end ?? range.end, p_scope: scope });
    if (!isObject(report) || !isObject(report.metrics)) throw new CopilotError("Invalid report response.", 503);
    const m = report.metrics;
    result.title = scope === "team" ? "Team work report" : "My work report";
    result.text = `${text(report.start)} to ${text(report.end)} · ${text(report.timezone)}. Personal scope includes accessible records you created, are assigned to, or last edited. Workload figures are current snapshots, not historical transitions. Payments, revenue and total actions are not inferred from this snapshot.`;
    result.metrics = [
      { label: "Leads created in range", value: number(m.created), description: "Creation timestamp within the selected range and scope." },
      { label: "My latest edits in range", value: number(m.latestEdits), description: "Records whose most recent saved edit is yours in this range; not a count of every action." },
      { label: "Scheduled in range", value: number(m.scheduled), description: "Saved schedule date in range. Unavailable without Schedule access." },
      { label: "Urgent now", value: number(m.urgent), description: "Current urgent status." },
      { label: "Incomplete now", value: number(m.incomplete), description: "Incomplete status or saved incomplete-details tag." },
      { label: "Need technician now", value: number(m.needTech), description: "Current Need Tech status." },
      { label: "Follow-up now", value: number(m.followups), description: "Current Quote Sent – Need Follow Up status." },
    ];
    result.links = [{ label: "Open leads", href: "/leads" }];
  } else if (intent === "health") {
    const health = await rpc(db, "copilot_health");
    if (!isObject(health)) throw new CopilotError("Invalid health response.", 503);
    const sheets = isObject(health.sheets) ? health.sheets : {};
    const webhook = isObject(health.webhook) ? health.webhook : {};
    result.title = "Measured system health";
    result.text = `Database request succeeded. Sheets: ${text(sheets.status) || "Unavailable / not monitored"}. Quo: ${health.webhook === null ? "Unavailable / not monitored" : webhook.lastReceivedAt ? `last observed webhook ${text(webhook.lastReceivedAt)}` : "no webhook observed in the last 24 hours; this alone is not an outage"}. Ingestion: ${typeof webhook.ingestionPaused === "boolean" ? webhook.ingestionPaused ? "paused by Admin" : "configured to accept events" : "not monitored"}. This is not a full infrastructure or uptime audit. Configuration does not prove an integration works.`;
    result.metrics = [
      { label: "Sheets queued", value: number(sheets.queueDepth), description: "Existing sync health RPC." },
      { label: "Sheets failed jobs", value: number(sheets.failedJobs), description: "Existing sync health RPC." },
      { label: "Leads behind", value: number(sheets.leadsBehind), description: "Unavailable when no watermark is recorded." },
      { label: "Quo errors in 24h", value: number(webhook.errors24h), description: "Observed webhook error entries; idle is not an outage." },
    ];
    result.links = [{ label: "Open integration settings", href: "/settings" }];
  }
  return result;
}

export function createCopilotHandler(services: CopilotServices) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const startedAt = Date.now();
    let requestId = ""; let attemptedAi = false;
    const observe = (code: string) => { try { services.observe?.({ requestId, code, durationMs: Date.now() - startedAt, aiUsed: attemptedAi, model: COPILOT_MODEL, promptVersion: COPILOT_PROMPT_VERSION }); } catch { /* Telemetry must not redefine an outcome. */ } };
    try {
      const { userId, db } = await services.authenticate(request);
      if (!userId) return json({ error: "Sign in to use Copilot." }, 401);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 8000) return json({ error: "Request is too large." }, 413);
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON request." }, 400); }
      if (!isObject(body)) return json({ error: "Invalid request." }, 400);
      if (body.action === "access") return json(parseCopilotAccess(await rpc(db, "copilot_get_access")));
      if (["settings", "set_permission", "configure", "diagnostics", "test_ai"].includes(text(body.action))) {
        // Authorisation is also enforced inside every administrative RPC.
        await rpc(db, "copilot_get_settings");
        if (body.action === "diagnostics") {
          const diagnostics = await rpc(db, "copilot_diagnostics");
          if (!isObject(diagnostics)) throw new CopilotError("Pilot diagnostics are not installed yet.", 503, "installation_required");
          return json({ ...diagnostics, keyConfigured: services.aiConfigured(), backendVersion: COPILOT_BACKEND_VERSION, model: COPILOT_MODEL, promptVersion: COPILOT_PROMPT_VERSION });
        }
        if (body.action === "test_ai") {
          if (body.confirmed !== true) return json({ error: "Confirm the allowance-consuming AI test first.", code: "consent_required" }, 400);
          const testRequestId = body.requestId;
          // A diagnostic test is always nonsensitive, even if a direct caller
          // supplies history, a selected record or extra filters in the envelope.
          for (const key of Object.keys(body)) delete body[key];
          Object.assign(body, { action: "ask", message: "What is a heat pump? Reply with one brief sentence.", intent: "ai", allowAi: true, requestId: testRequestId });
        }
        if (body.action === "set_permission") {
          if ((body.role !== null && !["processor", "customer_service", "cs_admin", "opr", "opr_admin"].includes(text(body.role))) ||
              (body.userId !== null && (typeof body.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.userId))) ||
              (body.allowed !== null && typeof body.allowed !== "boolean")) return json({ error: "Invalid permission target." }, 400);
          await rpc(db, "copilot_set_permission", { p_role: body.role, p_user_id: body.userId, p_allowed: body.allowed });
          return json({ saved: true });
        }
        if (body.action === "configure") {
          if (!isObject(body.config) || typeof body.config.enabled !== "boolean" || typeof body.config.ai_enabled !== "boolean" ||
              !Number.isInteger(body.config.monthly_budget_cents) || !Number.isInteger(body.config.daily_ai_limit) || typeof body.config.timezone !== "string" ||
              Number(body.config.monthly_budget_cents) < 0 || Number(body.config.monthly_budget_cents) > 100000 || Number(body.config.daily_ai_limit) < 0 || Number(body.config.daily_ai_limit) > 100) return json({ error: "Invalid budget settings." }, 400);
          await rpc(db, body.expected === undefined ? "copilot_configure" : "copilot_configure_checked", { p_enabled: body.config.enabled, p_ai_enabled: body.config.ai_enabled,
            p_monthly_budget_cents: body.config.monthly_budget_cents, p_daily_ai_limit: body.config.daily_ai_limit, p_timezone: body.config.timezone,
            ...(body.expected !== undefined ? { p_expected: body.expected } : {}) });
          return json({ saved: true });
        }
        if (body.action === "settings") {
          const settings = await rpc(db, "copilot_get_settings");
          if (!isObject(settings)) throw new CopilotError("Invalid settings response.", 503);
          return json({ ...settings, usage: await rpc(db, "copilot_usage_summary") });
        }
      }
      let ask: CopilotAsk;
      try { ask = parseCopilotAsk(body); } catch { return json({ error: "Invalid Copilot question or filters." }, 400); }
      requestId = ask.requestId;
      const access = parseCopilotAccess(await rpc(db, "copilot_get_access"));
      if (!access.allowed) return json({ error: "Copilot is disabled or not available to your account." }, 403);
      const routed = routeCopilotMessage(ask.message);
      ask = resolveCopilotQuestion(ask, access);
      if (ask.status === undefined && routed.status) ask.status = routed.status;
      if (ask.date === undefined && routed.dayOffset !== undefined) ask.date = shiftDate(businessDate(new Date(), access.timezone), routed.dayOffset);
      let intent = routed.intent === "blocked" ? "blocked" : ask.intent ?? routed.intent;
      let query = ask.query ?? routed.query;
      let aiText: string | null = null;
      let aiUsed = false;
      if (intent === "ai" || intent === "explain_report") {
        if (!ask.allowAi || !access.aiEnabled || !services.aiConfigured()) {
          const result = emptyCopilotResult("features");
          result.title = "CRM tools remain available";
          result.noticeCode = !access.aiEnabled ? "ai_disabled" : !ask.allowAi ? "consent_required" : "key_missing";
          result.text = !access.aiEnabled ? "AI is disabled in the saved Admin configuration. Ask Admin to enable optional AI and save. CRM tools still work; no AI tokens were used."
            : !ask.allowAi ? "AI-assisted mode requires your consent. Turn on AI-assisted mode to send your question and recent AI turns to OpenAI. CRM tools still work; no AI tokens were used."
            : "The server-side OpenAI credential is not configured. Ask Admin to check Edge Function secrets. CRM tools still work; no AI tokens were used.";
          result.links = accessibleFeatures(access).map((f) => ({ label: f.label, href: f.href }));
          return json(result);
        }
        let context: string | undefined;
        if (intent === "explain_report") {
          const report = await runCopilotQuery(db, ask, access, "report", "");
          context = JSON.stringify({ definitions: report.text, metrics: report.metrics });
        } else if (ask.selectedLeadId && /^(draft|write|compose)\b/i.test(ask.message)) {
          const row = await rpc(db, "copilot_lead_brief", { p_lead_id: ask.selectedLeadId });
          if (!isObject(row)) throw new CopilotError("No accessible selected lead was found.", 404, "record_unavailable");
          // Explicit drafting consent sends only service/status. Never names,
          // addresses, quotes, phones, details, dates or transcript/card history.
          context = JSON.stringify({ service: text(row.service_type).slice(0, 100), status: text(row.status).slice(0, 100), instruction: "Draft only. Use placeholders for missing personal details and agreed schedule; do not invent them." });
        } else {
          context = JSON.stringify({ crmGuide: accessibleFeatures(access).map(({ label, help }) => ({ label, help })) });
        }
        const budget = services.budgetDb();
        await rpc(budget, "copilot_reserve_ai", { p_user_id: userId, p_request_id: ask.requestId });
        aiUsed = true;
        attemptedAi = true;
        let answer: CopilotAiAnswer;
        try {
          answer = ask.conversation?.length && intent !== "explain_report" ? await services.generate(ask.message, context, ask.conversation) : await services.generate(ask.message, context);
        } catch (error) {
          // Never auto-retry a paid request or refund an unknown provider outcome.
          await rpc(budget, "copilot_finish_ai", { p_request_id: ask.requestId, p_input: null, p_output: null, p_success: false }).catch(() => undefined);
          if (error instanceof CopilotProviderError) throw new CopilotError(error.message, error.status, error.code);
          throw new CopilotError("AI is unavailable. CRM tools still work. This request was not automatically retried.", 503, "provider_unavailable");
        }
        // An accounting follow-up failure must not redefine a successful provider
        // answer as a failed call. The reservation remains conservatively charged.
        await rpc(budget, "copilot_finish_ai", { p_request_id: ask.requestId, p_input: answer.inputTokens, p_output: answer.outputTokens, p_success: true }).catch(() => observe("accounting_pending"));
        if (intent === "explain_report" || answer.kind === "answer") aiText = answer.text;
        else { intent = answer.kind; query = answer.query.slice(0, 200); }
      }
      const result = aiText === null ? await runCopilotQuery(db, ask, access, intent, query) : {
        ...emptyCopilotResult(intent), source: "ai" as const, title: intent === "explain_report" ? "AI report explanation" : "AI answer",
        text: `${aiText}\n\nAI is advisory. No live web search was performed. CRM records and permissions are not changed.`,
      };
      // Recheck after potentially slow work: revocation must not leak a late result.
      const latest = parseCopilotAccess(await rpc(db, "copilot_get_access"));
      if (!latest.allowed || latest.role !== access.role || access.sections.some((section) => !latest.sections.includes(section))) throw new CopilotError("Copilot access changed. Results were discarded.", 403, "access_changed");
      if (aiUsed && !latest.aiEnabled) throw new CopilotError("AI access changed. Results were discarded.", 403, "ai_access_changed");
      result.aiUsed = aiUsed;
      result.filters = interpretedFilters(ask);
      result.requestId = ask.requestId;
      if (["leads", "technicians", "report", "explain_report"].includes(intent)) result.followup = { intent: intent === "explain_report" ? "report" : intent as "leads" | "technicians" | "report", query: result.searchQuery ?? ask.query,
        status: ask.status, service: ask.service, area: ask.area, active: ask.active, date: ask.date, start: ask.start, end: ask.end, scope: ask.scope };
      if (intent === "health") result.text += ` OpenAI key: ${services.aiConfigured() ? "configured (provider availability not probed)" : "not configured"}.`;
      observe("success");
      return json(result);
    } catch (error) {
      const code = error instanceof CopilotError ? error.code : "crm_unavailable";
      observe(code);
      return json({ error: error instanceof CopilotError ? error.message : "Copilot is unavailable. No CRM records were changed.", code, ...(requestId ? { requestId } : {}) }, error instanceof CopilotError ? error.status : 503);
    }
  };
}
