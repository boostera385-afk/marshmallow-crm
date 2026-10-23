import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneKey, type JobMessage } from "./processor-job-status.ts";
import { processorReadiness, ProcessorReviewError, PROCESSOR_TERMINAL } from "./processor-review.ts";
import { readProcessorChats, readProcessorRows, type ProcessorChatSetup } from "./processor-chat.ts";
import { readProcessorHistory } from "./processor-history.ts";
import { processorCallTranscripts, type StoredProcessorCall, type ProcessorCallCoverage } from "./processor-call-transcripts.ts";
import { leadWindowStart, NO_CHAT_FACTS, PROCESSOR_BOARD_STATUSES, PROCESSOR_POLICY, PROCESSOR_SYSTEM_PROMPT, selectLeadWindow, verifyProcessorFacts, type ProcessorFacts } from "./processor-lead-window.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
const LEAD_COLUMNS = "id,job_id,customer_name,customer_phone,address,service_type,tech_number,scheduled_date,scheduled_time_start,scheduled_time_end,status,updated_at,created_at";
const MODEL = "gpt-4o-mini";
const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu", "America/Anchorage"];
// Other jobs for the same technician, named so AI can ignore them. Recent only.
const PEER_LOOKBACK_MS = 30 * 24 * 60 * 60_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function isQueueJob(value: unknown): value is Record<string, unknown> & { id: string; tech_number: string | null } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "id" in value && typeof value.id === "string" && "tech_number" in value && (typeof value.tech_number === "string" || value.tech_number === null));
}
type Lead = { id: string; job_id: string; customer_name: string | null; customer_phone: string | null; address: string | null; service_type: string | null; tech_number: string | null; scheduled_date: string | null; scheduled_time_start: string | null; scheduled_time_end: string | null; status: string; updated_at: string; created_at: string };

export function createProcessorBoardHandler(deps: {
  createClient: (url: string, key: string, options?: object) => SupabaseClient;
  env: (key: string) => string | undefined; fetcher?: typeof fetch; now?: () => Date;
}) {
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
    if (body.action !== "assess" || typeof body.leadId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.leadId)) return json({ error: "A saved job ID is required." }, 400);
    // Saved lead is read with caller JWT, never a browser snapshot or unrestricted service lookup.
    const { data: job, error: jobError } = await caller.from("leads").select(LEAD_COLUMNS).eq("id", body.leadId).maybeSingle<Lead>();
    if (jobError || !job) return json({ error: "Job is not available in your scope." }, 404);
    const { data: visible, error: visibilityError } = await caller.rpc("processor_can_view_status", { p_status: job.status });
    if (visibilityError) return json({ error: "Processor Board migration is not installed." }, 503);
    if (!visible) return json({ error: "Job is not available in your status scope." }, 404);
    const readiness = processorReadiness(job);
    if (readiness) return json({ error: readiness, code: "job_setup", retryable: false }, PROCESSOR_TERMINAL.includes(job.status) ? 409 : 422);
    const phone = phoneKey(job.tech_number)!;
    const key = deps.env("SB_SERVICE_ROLE_KEY") ?? deps.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!key) return json({ error: "Processor Board server setup is unavailable." }, 503);
    const service = deps.createClient(deps.env("SUPABASE_URL") ?? "", key, { auth: { persistSession: false } });
    const token = crypto.randomUUID();
    let chat;
    try {
      chat = (await readProcessorChats(caller, [phone], Boolean(deps.env("QUO_API_KEY")))).get(phone);
    } catch (error) {
      return json({ error: error instanceof ProcessorReviewError ? error.message : "Technician chat lookup is unavailable.", code: "chat_lookup", retryable: true }, 503);
    }
    if (!chat?.link || chat.setup.state !== "ready") return json({ error: chat?.setup.message ?? "Verify the technician's saved chat.", code: chat?.setup.code ?? "chat_setup", retryable: false }, 422);
    const { data: claimed, error: claimError } = await service.rpc("claim_processor_job_refresh", { p_lead_id: job.id, p_token: token });
    if (claimError) return json({ error: "Processor Board migration is not installed." }, 503);
    if (!claimed) return json({ error: "This job is already being checked. Retry shortly." }, 429);
    try {
      const now = deps.now?.() ?? new Date();
      const since = leadWindowStart(job.created_at);
      const until = now.toISOString();
      const directKey = deps.env("QUO_API_KEY");
      const conversation = chat.mirror;
      const source = directKey ? "Quo current history" : "Quo CRM mirror";
      const history = directKey ? readProcessorHistory({ chatLink: chat.link.chatLink, phone: job.tech_number!, since, until, apiKey: directKey, apiBase: deps.env("QUO_API_BASE_URL"), fetcher: deps.fetcher })
        : readProcessorRows<JobMessage>((from, to) => caller.from("quo_messages")
          .select("id,conversation_id,sender,text,message_time,status").eq("conversation_id", conversation!.id)
          .gte("message_time", since).lte("message_time", until)
          .in("sender", ["customer", "agent"]).order("message_time").order("id").range(from, to));
      // Transcripts already saved in Tech Quick Chat: one scoped, paginated read,
      // not one provider download per call. Failure is independent of text history.
      const calls = conversation ? readProcessorRows<StoredProcessorCall>((from, to) => caller.from("quo_messages")
        .select("id,quo_message_id,conversation_id,raw_payload").eq("conversation_id", conversation.id)
        .gte("message_time", since).lte("message_time", until)
        .or("quo_message_id.like.%:call.completed,quo_message_id.like.%:call.transcript.completed")
        .order("message_time").order("id").range(from, to)).catch(() => null) : Promise.resolve(null);
      const peers = caller.from("leads").select("id,job_id,customer_name").ilike("tech_number", `%${phone.slice(-4)}%`)
        .gte("created_at", new Date(Date.parse(since) - PEER_LOOKBACK_MS).toISOString()).neq("id", job.id).order("created_at", { ascending: false }).limit(50)
        .then(({ data }) => (data ?? []) as { job_id: string; customer_name: string | null }[], () => []);
      const [textHistory, callRows, otherJobs] = await Promise.all([history, calls, peers]);
      // Do not claim mirror freshness when its latest metadata is ahead of the messages read.
      if (!directKey && conversation?.last_message_time && Date.parse(conversation.last_message_time) > Date.parse(textHistory.at(-1)?.message_time ?? "")
        && Date.parse(conversation.last_message_time) >= Date.parse(since)) return json({ error: "The technician chat mirror is behind its latest activity. Sync Quo, then check again.", code: "mirror_behind", retryable: true }, 422);
      const callHistory = callRows ? processorCallTranscripts(callRows, { conversationId: chat.link.conversationId, phoneNumberId: chat.link.phoneNumberId, technicianPhone: job.tech_number!, since, until }) : null;
      const callCoverage: ProcessorCallCoverage = callHistory?.coverage ?? { state: "unavailable", checked: 0, missing: 0, skipped_segments: 0 };
      const callIds = new Set(callRows?.map((row) => row.id) ?? []);
      const window = selectLeadWindow([...textHistory.filter((row) => !callIds.has(row.id)), ...(callHistory?.messages ?? [])], job);
      const target = { job_id: job.job_id, customer_name: job.customer_name, customer_phone: job.customer_phone, address: job.address, service: job.service_type, scheduled_date: job.scheduled_date, scheduled_time_start: job.scheduled_time_start, lead_created_at: job.created_at };
      const others = otherJobs.filter((peer) => peer.job_id !== job.job_id).map((peer) => ({ job_id: peer.job_id, customer_name: peer.customer_name }));
      // Time is not an input: the saved facts stay valid until the chat or the job changes.
      const inputHash = await hash({ target, phone, others, messages: window.messages, policy: PROCESSOR_POLICY });
      const { data: cache, error: cacheError } = await service.from("processor_job_assessments").select("input_hash,result").eq("lead_id", job.id).maybeSingle();
      if (cacheError) throw new Error("Saved assessment could not be read.");
      const reused = cache?.input_hash === inputHash && cache.result?.policy === PROCESSOR_POLICY;
      let facts: ProcessorFacts;
      if (reused) {
        facts = { enough_context: cache.result.enough_context, tech_took_job: cache.result.tech_took_job, job_update: cache.result.job_update, waiting_since: cache.result.waiting_since, waiting_message_id: cache.result.waiting_message_id, summary: cache.result.summary, evidence: cache.result.evidence };
      } else if (!window.messages.length) {
        facts = NO_CHAT_FACTS;
      } else {
        if (!deps.env("OPENAI_API_KEY")) return json({ error: "AI is not configured. Ask Admin to check OPENAI_API_KEY in Edge Function secrets.", code: "ai_setup", retryable: false }, 503);
        let response: Response;
        try {
          response = await (deps.fetcher ?? fetch)("https://api.openai.com/v1/chat/completions", {
            method: "POST", headers: { Authorization: `Bearer ${deps.env("OPENAI_API_KEY")}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(45000),
            body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 1200, response_format: { type: "json_object" }, messages: [
              { role: "system", content: PROCESSOR_SYSTEM_PROMPT },
              { role: "user", content: JSON.stringify({ target, otherJobs: others, windowStartsAt: window.anchor === "customer_mention" ? "first mention of the target customer" : "day before the lead was created (no customer mention found)", untrustedMessages: window.messages }) },
            ] }),
          });
        } catch { throw new ProcessorReviewError("AI review timed out or could not connect. Previous result is kept; check again.", "ai_connection", true); }
        if (!response.ok) throw new ProcessorReviewError(response.status === 429 ? "AI provider is rate limited. Wait a minute, then check again." : [401, 403].includes(response.status) ? "AI provider rejected its server credentials. Ask Admin to check configuration." : "AI provider is unavailable. Previous result is kept; check again.", "ai_provider", ![401, 403].includes(response.status));
        const payload = await response.json();
        if (payload.choices?.[0]?.finish_reason === "length") throw new ProcessorReviewError("AI review was cut off; nothing was saved. Check again.", "ai_invalid", true);
        let parsed;
        try { parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? "{}"); }
        catch { throw new ProcessorReviewError("AI returned an unreadable review; nothing was saved. Check again.", "ai_invalid", true); }
        facts = verifyProcessorFacts(parsed, window);
      }
      const result = {
        policy: PROCESSOR_POLICY, tech_phone: phone, ...facts,
        window: { start: window.start, anchor: window.anchor, anchor_message_id: window.anchor_message_id, messages: window.messages.length, omitted: window.omitted },
        call_transcripts: callCoverage, source, history_complete: Boolean(directKey),
        ai_used: !reused && window.messages.length > 0, ai_reused: reused,
        chat_fingerprint: chat.setup.fingerprint, timezone, checked_at: until, lead_updated_at: job.updated_at,
        mirror_conversation_id: conversation?.id ?? null, mirror_last_message_at: conversation?.last_message_time ?? null,
        status: null as string | null,
      };
      // The same SQL rule the board list uses; only for the audit line and response.
      const { data: status } = await service.rpc("processor_board_status", { p_lead_status: job.status, p_scheduled_date: job.scheduled_date, p_scheduled_time: job.scheduled_time_start, p_tech_number: job.tech_number, p_result: result, p_timezone: timezone, p_now: until });
      result.status = typeof status === "string" ? status : null;
      const { data: saved, error: saveError } = await service.rpc("save_processor_job_assessment", { p_lead_id: job.id, p_token: token, p_updated_at: job.updated_at, p_hash: inputHash, p_result: result, p_actor: auth.user.id });
      if (saveError || !saved) return json({ error: "Review could not be saved, or the job changed during review. Refresh and check again; lead status was not changed." }, 409);
      return json({ result, cached: reused });
    } catch (error) {
      if (error instanceof ProcessorReviewError) return json({ error: error.message, code: error.code, retryable: error.retryable }, error.status);
      return json({ error: "Job review is unavailable or the chat could not be fully read. Previous result is kept; sync Quo or check again." }, 503);
    } finally {
      // Cleanup is independent of persistence: a failed lease release must not
      // turn a successful audited save into an apparent failed save. The lease
      // expires automatically, so retry remains safe if cleanup is unavailable.
      try {
        await service.from("processor_job_refresh_locks").delete().eq("lead_id", job.id).eq("token", token);
      } catch { /* Lease expiry provides recovery without overwriting the result. */ }
    }
  };
}
