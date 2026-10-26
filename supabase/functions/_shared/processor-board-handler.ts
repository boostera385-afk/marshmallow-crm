import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneKey, type JobMessage } from "./processor-job-status.ts";
import { processorReadiness, ProcessorReviewError, PROCESSOR_TERMINAL } from "./processor-review.ts";
import { readProcessorChats, readProcessorRows, type ProcessorChatSetup } from "./processor-chat.ts";
import { readProcessorHistory } from "./processor-history.ts";
import { processorCallTranscripts, type StoredProcessorCall, type ProcessorCallCoverage } from "./processor-call-transcripts.ts";
import { leadWindowStart, NO_CHAT_FACTS, PROCESSOR_BOARD_STATUSES, PROCESSOR_POLICY, PROCESSOR_SYSTEM_PROMPT, selectLeadWindow, verifyProcessorFacts, type ProcessorFacts } from "./processor-lead-window.ts";
import { buildJobTimeline, mergeTimeline, timelineFacts, timelineSettlesJob, TIMELINE_RULES_VERSION } from "./processor-job-timeline.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
const LEAD_COLUMNS = "id,job_id,customer_name,customer_phone,address,service_type,tech_number,scheduled_date,scheduled_time_start,scheduled_time_end,status,updated_at,created_at";
const MODEL = "gpt-4o-mini";
const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu", "America/Anchorage"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Other jobs for the same technician, named so AI can ignore them. Recent only.
const PEER_LOOKBACK_MS = 30 * 24 * 60 * 60_000;
// The daily worker stops starting new jobs after this, well inside the Edge limit.
const DAILY_BUDGET_MS = 100_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function isQueueJob(value: unknown): value is Record<string, unknown> & { id: string; tech_number: string | null } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "id" in value && typeof value.id === "string" && "tech_number" in value && (typeof value.tech_number === "string" || value.tech_number === null));
}
type Lead = { id: string; job_id: string; customer_name: string | null; customer_phone: string | null; address: string | null; service_type: string | null; tech_number: string | null; scheduled_date: string | null; scheduled_time_start: string | null; scheduled_time_end: string | null; status: string; updated_at: string; created_at: string };
type Deps = { createClient: (url: string, key: string, options?: object) => SupabaseClient; env: (key: string) => string | undefined; fetcher?: typeof fetch; now?: () => Date };
type Outcome = { status: number; body: Record<string, unknown> };

async function askAi(deps: Deps, system: string, user: unknown, maxTokens: number): Promise<unknown> {
  let response: Response;
  try {
    response = await (deps.fetcher ?? fetch)("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${deps.env("OPENAI_API_KEY")}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(user) }] }),
    });
  } catch { throw new ProcessorReviewError("AI review timed out or could not connect. Previous result is kept; check again.", "ai_connection", true); }
  if (!response.ok) throw new ProcessorReviewError(response.status === 429 ? "AI provider is rate limited. Wait a minute, then check again." : [401, 403].includes(response.status) ? "AI provider rejected its server credentials. Ask Admin to check configuration." : "AI provider is unavailable. Previous result is kept; check again.", "ai_provider", ![401, 403].includes(response.status));
  const payload = await response.json();
  if (payload.choices?.[0]?.finish_reason === "length") throw new ProcessorReviewError("AI review was cut off; nothing was saved. Check again.", "ai_invalid", true);
  try { return JSON.parse(payload.choices?.[0]?.message?.content ?? "{}"); }
  catch { throw new ProcessorReviewError("AI returned an unreadable review; nothing was saved. Check again.", "ai_invalid", true); }
}

/**
 * One job check, shared by a signed-in user and the daily worker. `reader` is the
 * caller's client for a user (lead/chat RLS applies) or the service client for the
 * worker. Exact rules read the standard texts first; AI covers calls and the rest.
 */
async function assessLead(deps: Deps, reader: SupabaseClient, service: SupabaseClient, job: Lead, actor: string | null, timezone: string): Promise<Outcome> {
  const readiness = processorReadiness(job);
  if (readiness) return { status: PROCESSOR_TERMINAL.includes(job.status) ? 409 : 422, body: { error: readiness, code: "job_setup", retryable: false } };
  const phone = phoneKey(job.tech_number)!;
  let chat;
  try {
    chat = (await readProcessorChats(reader, [phone], Boolean(deps.env("QUO_API_KEY")))).get(phone);
  } catch (error) {
    return { status: 503, body: { error: error instanceof ProcessorReviewError ? error.message : "Technician chat lookup is unavailable.", code: "chat_lookup", retryable: true } };
  }
  if (!chat?.link || chat.setup.state !== "ready") return { status: 422, body: { error: chat?.setup.message ?? "Verify the technician's saved chat.", code: chat?.setup.code ?? "chat_setup", retryable: false } };
  const token = crypto.randomUUID();
  const { data: claimed, error: claimError } = await service.rpc("claim_processor_job_refresh", { p_lead_id: job.id, p_token: token });
  if (claimError) return { status: 503, body: { error: "Processor Board migration is not installed." } };
  if (!claimed) return { status: 429, body: { error: "This job is already being checked. Retry shortly.", code: "busy", retryable: true } };
  try {
    const now = deps.now?.() ?? new Date();
    const since = leadWindowStart(job.created_at);
    const until = now.toISOString();
    const directKey = deps.env("QUO_API_KEY");
    const conversation = chat.mirror;
    const source = directKey ? "Quo current history" : "Quo CRM mirror";
    const history = directKey ? readProcessorHistory({ chatLink: chat.link.chatLink, phone: job.tech_number!, since, until, apiKey: directKey, apiBase: deps.env("QUO_API_BASE_URL"), fetcher: deps.fetcher })
      : readProcessorRows<JobMessage>((from, to) => reader.from("quo_messages")
        .select("id,conversation_id,sender,text,message_time,status").eq("conversation_id", conversation!.id)
        .gte("message_time", since).lte("message_time", until)
        .in("sender", ["customer", "agent"]).order("message_time").order("id").range(from, to));
    // Transcripts already saved in Tech Quick Chat: one scoped, paginated read,
    // not one provider download per call. Failure is independent of text history.
    const calls = conversation ? readProcessorRows<StoredProcessorCall>((from, to) => reader.from("quo_messages")
      .select("id,quo_message_id,conversation_id,raw_payload").eq("conversation_id", conversation.id)
      .gte("message_time", since).lte("message_time", until)
      .or("quo_message_id.like.%:call.completed,quo_message_id.like.%:call.transcript.completed")
      .order("message_time").order("id").range(from, to)).catch(() => null) : Promise.resolve(null);
    const peers = reader.from("leads").select("id,job_id,customer_name").ilike("tech_number", `%${phone.slice(-4)}%`)
      .gte("created_at", new Date(Date.parse(since) - PEER_LOOKBACK_MS).toISOString()).neq("id", job.id).order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => (data ?? []) as { job_id: string; customer_name: string | null }[], () => []);
    const [textHistory, callRows, otherJobs] = await Promise.all([history, calls, peers]);
    // Do not claim mirror freshness when its latest metadata is ahead of the messages read.
    if (!directKey && conversation?.last_message_time && Date.parse(conversation.last_message_time) > Date.parse(textHistory.at(-1)?.message_time ?? "")
      && Date.parse(conversation.last_message_time) >= Date.parse(since)) return { status: 422, body: { error: "The technician chat mirror is behind its latest activity. Sync Quo, then check again.", code: "mirror_behind", retryable: true } };
    const callHistory = callRows ? processorCallTranscripts(callRows, { conversationId: chat.link.conversationId, phoneNumberId: chat.link.phoneNumberId, technicianPhone: job.tech_number!, since, until }) : null;
    const callCoverage: ProcessorCallCoverage = callHistory?.coverage ?? { state: "unavailable", checked: 0, missing: 0, skipped_segments: 0 };
    const callIds = new Set(callRows?.map((row) => row.id) ?? []);
    const window = selectLeadWindow([...textHistory.filter((row) => !callIds.has(row.id)), ...(callHistory?.messages ?? [])], job);
    const target = { job_id: job.job_id, customer_name: job.customer_name, customer_phone: job.customer_phone, address: job.address, service: job.service_type, scheduled_date: job.scheduled_date, scheduled_time_start: job.scheduled_time_start, lead_created_at: job.created_at };
    const others = otherJobs.filter((peer) => peer.job_id !== job.job_id).map((peer) => ({ job_id: peer.job_id, customer_name: peer.customer_name }));
    // Time is not an input: the saved facts stay valid until the chat or the job changes.
    const inputHash = await hash({ target, phone, others, messages: window.messages, policy: PROCESSOR_POLICY, rules: TIMELINE_RULES_VERSION });
    const { data: cache, error: cacheError } = await service.from("processor_job_assessments").select("input_hash,result").eq("lead_id", job.id).maybeSingle();
    if (cacheError) throw new Error("Saved assessment could not be read.");
    const saved = cache?.result?.policy === PROCESSOR_POLICY ? cache.result : null;
    const reused = Boolean(saved) && cache?.input_hash === inputHash;
    // Exact rules over every in-window message (not just what fits the AI request).
    const timeline = buildJobTimeline(window.all, job);
    const skipAi = !reused && window.messages.length > 0 && timelineSettlesJob(timeline, window.all);
    let facts: ProcessorFacts;
    if (reused) {
      facts = { enough_context: saved.enough_context, tech_took_job: saved.tech_took_job, job_update: saved.job_update, completed_at: saved.completed_at ?? null, waiting_since: saved.waiting_since, waiting_message_id: saved.waiting_message_id, summary: saved.summary, evidence: saved.evidence, share_state: saved.share_state ?? "none" };
    } else if (!window.messages.length) {
      facts = NO_CHAT_FACTS;
    } else if (skipAi) {
      facts = timelineFacts(timeline);
    } else {
      if (!deps.env("OPENAI_API_KEY")) return { status: 503, body: { error: "AI is not configured. Ask Admin to check OPENAI_API_KEY in Edge Function secrets.", code: "ai_setup", retryable: false } };
      const knownFacts = { job_tag: timeline.job_tag ? `*Customer # ${timeline.job_tag}*` : null, details_sent_at: timeline.details?.at ?? null, took_job: timeline.took_job, visit_confirmed: timeline.visit_confirmed,
        update_requested: timeline.update_requested, completed: timeline.completed, share_state: timeline.share_state };
      facts = mergeTimeline(verifyProcessorFacts(await askAi(deps, PROCESSOR_SYSTEM_PROMPT, { target, otherJobs: others, knownFacts, windowStartsAt: window.anchor === "customer_mention" ? "first mention of the target customer" : "day before the lead was created (no customer mention found)", untrustedMessages: window.messages }, 1200), window), timeline);
    }
    const result = {
      policy: PROCESSOR_POLICY, tech_phone: phone, ...facts,
      window: { start: window.start, anchor: window.anchor, anchor_message_id: window.anchor_message_id, messages: window.messages.length, omitted: window.omitted },
      call_transcripts: callCoverage, source, history_complete: Boolean(directKey),
      timeline: reused && saved.timeline ? saved.timeline : timeline,
      ai_used: !reused && !skipAi && window.messages.length > 0, ai_reused: reused, rules_only: skipAi,
      checked_by: actor ? "user" : "daily_check",
      chat_fingerprint: chat.setup.fingerprint, timezone, checked_at: until, lead_updated_at: job.updated_at,
      mirror_conversation_id: conversation?.id ?? null, mirror_last_message_at: conversation?.last_message_time ?? null,
      status: null as string | null,
    };
    // The same SQL rule the board list uses; only for the audit line and response.
    const { data: status } = await service.rpc("processor_board_status", { p_lead_status: job.status, p_scheduled_date: job.scheduled_date, p_scheduled_time: job.scheduled_time_start, p_tech_number: job.tech_number, p_result: result, p_timezone: timezone, p_now: until });
    result.status = typeof status === "string" ? status : null;
    const { data: stored, error: saveError } = await service.rpc("save_processor_job_assessment", { p_lead_id: job.id, p_token: token, p_updated_at: job.updated_at, p_hash: inputHash, p_result: result, p_actor: actor });
    if (saveError || !stored) return { status: 409, body: { error: "Review could not be saved, or the job changed during review. Refresh and check again; lead status was not changed.", code: "save_conflict", retryable: true } };
    return { status: 200, body: { result, cached: reused } };
  } catch (error) {
    if (error instanceof ProcessorReviewError) return { status: error.status, body: { error: error.message, code: error.code, retryable: error.retryable } };
    return { status: 503, body: { error: "Job review is unavailable or the chat could not be fully read. Previous result is kept; sync Quo or check again." } };
  } finally {
    // Cleanup is independent of persistence: a failed lease release must not
    // turn a successful audited save into an apparent failed save. The lease
    // expires automatically, so retry remains safe if cleanup is unavailable.
    try {
      await service.from("processor_job_refresh_locks").delete().eq("lead_id", job.id).eq("token", token);
    } catch { /* Lease expiry provides recovery without overwriting the result. */ }
  }
}

const serviceClient = (deps: Deps) => {
  const key = deps.env("SB_SERVICE_ROLE_KEY") ?? deps.env("SUPABASE_SERVICE_ROLE_KEY");
  return key ? deps.createClient(deps.env("SUPABASE_URL") ?? "", key, { auth: { persistSession: false } }) : null;
};

export function createProcessorBoardHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return json({ ok: true });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Not signed in." }, 401);
    const caller = deps.createClient(deps.env("SUPABASE_URL") ?? "", deps.env("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: auth, error: authError } = await caller.auth.getUser();
    if (authError || !auth.user) return json({ error: "Not signed in." }, 401);
    const { data: roles, error: roleError } = await caller.from("user_roles").select("role").eq("user_id", auth.user.id);
    if (roleError || !roles?.some((r) => ["admin", "processor"].includes(r.role))) return json({ error: "Only Admin and Processor may use Processor Board." }, 403);
    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request." }, 400);
    const timezone = body.timezone ?? "America/New_York";
    if (!TIMEZONES.includes(timezone)) return json({ error: "Choose a supported schedule timezone." }, 400);
    if (body.action === "list") {
      if ((body.offset !== undefined && (!Number.isInteger(body.offset) || body.offset < 0)) || (body.search !== undefined && (typeof body.search !== "string" || body.search.length > 100))
        || (body.aiStatus !== undefined && body.aiStatus !== null && !PROCESSOR_BOARD_STATUSES.includes(body.aiStatus))) return json({ error: "Invalid filters." }, 400);
      const { data, error } = await caller.rpc("list_processor_board_jobs", { p_offset: body.offset ?? 0, p_search: body.search ?? "", p_timezone: timezone, p_ai_status: body.aiStatus ?? null });
      if (error || !data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.rows) || !data.rows.every(isQueueJob)) return json({ error: "Processor Board database setup is unavailable. Ask Admin to apply the reviewed Processor Board migration." }, 503);
      const rows = data.rows;
      const phones = rows.flatMap((row) => { const phone = phoneKey(row.tech_number); return phone ? [phone] : []; });
      const monitoring = { ai_configured: Boolean(deps.env("OPENAI_API_KEY")), current_history_configured: Boolean(deps.env("QUO_API_KEY")), evidence_policy: PROCESSOR_POLICY };
      try {
        const chats = await readProcessorChats(caller, phones, monitoring.current_history_configured);
        return json({ ...data, monitoring, rows: rows.map((row) => ({ ...row, chat_setup: chats.get(phoneKey(row.tech_number) ?? "")?.setup ?? null })) });
      } catch (error) {
        const message = error instanceof ProcessorReviewError ? error.message : "Technician/chat setup is unavailable. Retry after reconnecting.";
        const setup: ProcessorChatSetup = { state: "unavailable", code: "chat_lookup", message, fingerprint: "lookup-unavailable", conversation_id: null, last_message_at: null, source: null };
        // List/count success is independent of chat lookup availability. Never hide saved jobs.
        return json({ ...data, monitoring, rows: rows.map((row) => ({ ...row, chat_setup: setup })) });
      }
    }
    if (body.action === "detail") {
      if (typeof body.leadId !== "string" || !UUID.test(body.leadId)) return json({ error: "A saved job ID is required." }, 400);
      // Caller-scoped read: the assessment policy already limits rows to Admin/Processor and visible leads.
      const { data, error } = await caller.from("processor_job_assessments").select("result,checked_at").eq("lead_id", body.leadId).maybeSingle();
      if (error) return json({ error: "Saved review is unavailable. Retry." }, 503);
      return json({ result: data?.result ?? null, checked_at: data?.checked_at ?? null });
    }
    if (body.action !== "assess" || typeof body.leadId !== "string" || !UUID.test(body.leadId)) return json({ error: "A saved job ID is required." }, 400);
    // Saved lead is read with caller JWT, never a browser snapshot or unrestricted service lookup.
    const { data: job, error: jobError } = await caller.from("leads").select(LEAD_COLUMNS).eq("id", body.leadId).maybeSingle<Lead>();
    if (jobError || !job) return json({ error: "Job is not available in your scope." }, 404);
    const { data: visible, error: visibilityError } = await caller.rpc("processor_can_view_status", { p_status: job.status });
    if (visibilityError) return json({ error: "Processor Board migration is not installed." }, 503);
    if (!visible) return json({ error: "Job is not available in your status scope." }, 404);
    const readiness = processorReadiness(job);
    if (readiness) return json({ error: readiness, code: "job_setup", retryable: false }, PROCESSOR_TERMINAL.includes(job.status) ? 409 : 422);
    const service = serviceClient(deps);
    if (!service) return json({ error: "Processor Board server setup is unavailable." }, 503);
    const outcome = await assessLead(deps, caller, service, job, auth.user.id, timezone);
    return json(outcome.body, outcome.status);
  };
}

function sameSecret(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

/**
 * Server-side checks, called by pg_cron with a dedicated secret (no user JWT).
 * The database picks the due jobs: a changed lead or new chat message first,
 * then jobs never checked, then completed unpaid jobs not checked in 20 hours.
 * A changed chat costs AI; an unchanged one reuses the saved answer. Failures
 * are recorded so the database backs them off. The response carries counts and
 * codes only, never customer data.
 */
export function createProcessorDailyHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const expected = deps.env("PROCESSOR_DAILY_CRON_SECRET");
    if (!expected) return json({ error: "Daily check is not configured." }, 503);
    if (!sameSecret(req.headers.get("x-cron-secret") ?? "", expected)) return json({ error: "Invalid cron secret." }, 401);
    const service = serviceClient(deps);
    if (!service) return json({ error: "Processor Board server setup is unavailable." }, 503);
    const body = await req.json().catch(() => ({}));
    const limit = Number.isInteger(body?.limit) ? Math.min(Math.max(body.limit, 1), 5) : 3;
    const { data: ids, error } = await service.rpc("processor_board_due_jobs", { p_limit: limit });
    if (error || !Array.isArray(ids)) return json({ error: "Processor Board worker migration is not installed." }, 503);
    const started = Date.now();
    const results: { lead_id: string; ok: boolean; code?: string; status?: string | null }[] = [];
    for (const raw of ids) {
      const id = typeof raw === "string" ? raw : (raw as Record<string, unknown>)?.processor_board_due_jobs;
      if (typeof id !== "string" || !UUID.test(id)) continue;
      if (Date.now() - started > DAILY_BUDGET_MS) break;
      const { data: job } = await service.from("leads").select(LEAD_COLUMNS).eq("id", id).maybeSingle<Lead>();
      const outcome: Outcome = job ? await assessLead(deps, service, service, job, null, "America/New_York") : { status: 404, body: { code: "missing" } };
      const result = outcome.body.result as { status?: string | null } | undefined;
      const code = String(outcome.body.code ?? outcome.status);
      // A successful save clears retry state itself; failures back off in the database.
      if (outcome.status !== 200) await service.rpc("record_processor_check_attempt", { p_lead_id: id, p_ok: false, p_code: code });
      results.push(outcome.status === 200 ? { lead_id: id, ok: true, status: result?.status ?? null } : { lead_id: id, ok: false, code });
    }
    return json({ checked: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
  };
}
