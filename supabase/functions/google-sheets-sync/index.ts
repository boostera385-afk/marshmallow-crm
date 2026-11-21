import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-cron-secret",
};

type JsonObject = Record<string, unknown>;
type SyncConfig = {
  webhookUrl?: string;
  autoSync?: boolean;
  spreadsheetUrl?: string;
};
type QueueJob = {
  lead_id: string;
  op: "upsert" | "delete";
  job_id: string | null;
  attempts: number;
  generation: number;
  lease_token: string;
  previous_statuses: string[];
};

const STATUS_LABELS: Record<string, string> = {
  waiting_complete_details: "Waiting Complete Details",
  urgent_job: "Urgent Job",
  quote_sent_waiting: "Quote Sent - Waiting",
  post_visit_quote_sent_waiting: "Post Visit-Quote Sent-Waiting",
  post_visit_confirmation: "Post Visit Confirmation",
  activate_customer: "Activate Customer",
  quote_sent_need_follow_up: "Quote Sent - Need Follow Up",
  needs_quote: "Needs Quote",
  tech_making_quote: "Tech Making Quote",
  quote_change: "Quote Change",
  waiting_customer_response: "Waiting Customer Response",
  need_tech: "Need Tech",
  scheduled: "Scheduled",
  job_in_progress: "Job in Progress",
  needs_reschedule: "Needs Reschedule",
  job_done: "Job Done",
  payment_pending: "Payment Pending",
  cancellation_requested: "Cancellation Pending",
  cancelled: "Cancelled",
  paid: "Paid",
  partial_paid: "Partial Paid",
  payment_requested: "Paid Approval Pending",
  scammed: "Scammed",
  pending_to_send: "Pending to Send",
  quote_updated: "Quote Updated",
};

const TAG_LABELS: Record<string, string> = {
  confirmation_sent: "Customer Require New Schedule",
  waiting_schedule_confirmation: "Waiting for CX for schedule confirmation",
  booked: "Booked",
  ready_to_schedule: "Ready to schedule",
  incomplete_details: "Incomplete details",
};

function jsonResponse(body: JsonObject, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatPhone(value: unknown): string {
  const raw = asString(value).trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

function formatCreatedAt(value: unknown): string {
  const text = asString(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime())
    ? text
    : date.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
}

function formatLeadRow(
  lead: JsonObject,
  notes: JsonObject[],
  photos: string[],
  profileNames: Map<string, string>,
) {
  const notesByType: Record<string, string[]> = { cs: [], processor: [], opr: [] };
  for (const note of notes) {
    const type = asString(note.note_type);
    const bucket = type === "cs" ? "cs" : type === "processor" ? "processor" : "opr";
    const date = formatCreatedAt(note.created_at);
    const userId = asString(note.user_id);
    const author = asString(note.user_name) || profileNames.get(userId) || "Unknown";
    const content = asString(note.content);
    notesByType[bucket].push(date ? `[${date}] ${author}: ${content}` : `${author}: ${content}`);
  }

  const address = [lead.address, lead.city, lead.state, lead.zip_code]
    .filter((part) => typeof part === "string" && part.trim())
    .map((part) => String(part).trim())
    .join(", ");
  const status = asString(lead.status);
  const tag = asString(lead.cs_tag);
  const customerPhone = lead.customer_phone
    ? formatPhone(lead.customer_phone)
    : lead.customer_landline
      ? `${formatPhone(lead.customer_landline)} (Landline)`
      : "";

  return {
    "Lead ID": asString(lead.job_id) || asString(lead.id),
    "Lead Creation Date": formatCreatedAt(lead.created_at),
    "Customer Name": asString(lead.customer_name),
    "Customer Phone No": customerPhone,
    Address: address,
    "Service Type": asString(lead.service_type),
    "Service Details": asString(lead.service_details),
    "Number Name": asString(lead.number_name),
    "Schedule Requirements": asString(lead.customer_schedule_requirements),
    // Private bucket: a count only, never a storage link (see src/lib/google-sheets.ts).
    Pictures: photos.length ? `${photos.length} ${photos.length === 1 ? "photo" : "photos"} — view in Marshmallow` : "",
    Tag: TAG_LABELS[tag] || tag,
    Status: STATUS_LABELS[status] || status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    "Tech Name": asString(lead.tech_name),
    "Tech Number": formatPhone(lead.tech_number),
    "Cs Notes": notesByType.cs.join("\n"),
    "Processor Notes": notesByType.processor.join("\n"),
    "Opr Notes": notesByType.opr.join("\n"),
    _created_at: asString(lead.created_at),
    _id: asString(lead.id),
    _job_id: asString(lead.job_id),
  };
}

function isAppsScriptUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "script.google.com" && url.pathname.includes("/macros/s/") && url.pathname.endsWith("/exec");
  } catch {
    return false;
  }
}

async function readStoredConfig(admin: ReturnType<typeof createClient>): Promise<SyncConfig> {
  const { data, error } = await admin
    .from("quo_ai_settings")
    .select("value")
    .eq("key", "google_sheets_sync_config")
    .maybeSingle();
  if (error) throw new Error(`Could not read Google Sheets settings: ${error.message}`);
  return (data?.value && typeof data.value === "object" ? data.value : {}) as SyncConfig;
}

async function authorize(
  req: Request,
  admin: ReturnType<typeof createClient>,
  serviceRoleKey: string,
): Promise<{ kind: "admin" | "worker" } | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (bearer === serviceRoleKey) return { kind: "worker" };

  const suppliedCronSecret = req.headers.get("x-cron-secret") ?? "";
  if (suppliedCronSecret) {
    let storedSecret = "";
    const { data } = await admin.from("quo_ai_settings").select("value").eq("key", "cron_secret").maybeSingle();
    const value = data?.value;
    if (Array.isArray(value)) storedSecret = String(value[0] ?? "");
    else if (typeof value === "string") storedSecret = value;
    else if (value && typeof value === "object") storedSecret = String((value as JsonObject).secret ?? "");
    const envSecret = Deno.env.get("FUNCTION_CRON_SECRET") ?? "";
    if ((storedSecret && suppliedCronSecret === storedSecret) || (envSecret && suppliedCronSecret === envSecret)) {
      return { kind: "worker" };
    }
  }

  if (!bearer) return jsonResponse({ success: false, error: "Authentication required." }, 401);
  const { data, error } = await admin.auth.getUser(bearer);
  if (error || !data.user) return jsonResponse({ success: false, error: "Unauthorized." }, 401);
  const { data: roleRow, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (roleError) return jsonResponse({ success: false, error: "Could not verify administrator access." }, 500);
  if (roleRow?.role !== "admin") return jsonResponse({ success: false, error: "Admin access required." }, 403);
  return { kind: "admin" };
}

async function postToSheet(webhookUrl: string, payload: JsonObject, timeoutMs = 55_000): Promise<JsonObject> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let result: JsonObject;
  try {
    result = JSON.parse(text) as JsonObject;
  } catch {
    if (response.status === 404) {
      throw new Error("Google Apps Script returned HTTP 404. Check that the saved URL is the deployed Web App URL ending in /exec, then deploy the latest script version.");
    }
    throw new Error(`Apps Script returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok || result.success !== true) {
    const remoteMessage = asString(result.error || result.message);
    throw new Error(
      `Apps Script returned HTTP ${response.status}${remoteMessage ? `: ${remoteMessage}` : "."}`,
    );
  }
  return result;
}

function isRetryableMirrorFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof Error && error.name === "AbortError"
    || /signal has been aborted|HTTP (?:404|408|429|5\d\d)|Server busy, another sync is still running|MIRROR_ACK_MISMATCH/i.test(message);
}

async function postMirrorBatch(
  webhookUrl: string,
  ops: JsonObject[],
): Promise<JsonObject> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await postToSheet(webhookUrl, {
        action: "sync_mirror",
        source: "supabase-outbox",
        ops,
      });
      if (Number(result.processedOps) !== ops.length) {
        const responseFields = Object.keys(result).sort().join(", ") || "none";
        throw new Error(
          `MIRROR_ACK_MISMATCH: Apps Script did not confirm all ${ops.length} operations (processedOps=${String(result.processedOps ?? "missing")}; response fields: ${responseFields}). The batch remains queued for a safe retry.`,
        );
      }
      return result;
    } catch (err) {
      if (attempt > 0 || !isRetryableMirrorFailure(err)) throw err;
      // sync_mirror applies idempotent upserts/deletes. A single retry helps
      // recover from transient Apps Script 404s, lock contention, and lost
      // responses without acknowledging the durable jobs prematurely.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw new Error("Apps Script delivery retry ended unexpectedly.");
}

async function verifyMirrorDeployment(webhookUrl: string): Promise<void> {
  let ping: JsonObject;
  try {
    // Apps Script web apps stall for tens of seconds while a version spins up,
    // so allow a generous budget before treating the deployment as unreachable.
    ping = await postToSheet(webhookUrl, { action: "ping" }, 45_000);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Google Apps Script did not answer the health ping within 45s. The Web App may be paused, still deploying, or restricted to your own account.");
    }
    throw err;
  }
  const capabilities = Array.isArray(ping.capabilities) ? ping.capabilities : [];
  if (!capabilities.includes("sync_mirror")) {
    throw new Error("The deployed Apps Script is outdated: it does not support sync_mirror. Copy the current script from Settings and deploy a new version of the existing Web App.");
  }
}

async function makeOps(admin: ReturnType<typeof createClient>, jobs: QueueJob[]) {
  const upserts = jobs.filter((job) => job.op === "upsert");
  const leadIds = upserts.map((job) => job.lead_id);
  const leadsById = new Map<string, JsonObject>();
  const notesByLead = new Map<string, JsonObject[]>();
  const photosByLead = new Map<string, string[]>();
  const profileNames = new Map<string, string>();

  if (leadIds.length) {
    const [leadsRes, notesRes, photosRes] = await Promise.all([
      admin.from("leads").select("*").in("id", leadIds),
      admin.from("lead_notes").select("lead_id,note_type,content,user_id,user_name,created_at").in("lead_id", leadIds).order("created_at", { ascending: true }),
      admin.from("lead_photos").select("lead_id,photo_url,created_at").in("lead_id", leadIds).order("created_at", { ascending: true }),
    ]);
    if (leadsRes.error) throw new Error(`Could not read queued leads: ${leadsRes.error.message}`);
    if (notesRes.error) throw new Error(`Could not read lead notes: ${notesRes.error.message}`);
    if (photosRes.error) throw new Error(`Could not read lead photos: ${photosRes.error.message}`);
    for (const lead of (leadsRes.data ?? []) as JsonObject[]) leadsById.set(asString(lead.id), lead);
    const noteRows = (notesRes.data ?? []) as JsonObject[];
    const userIds = [...new Set(noteRows.map((note) => asString(note.user_id)).filter(Boolean))];
    if (userIds.length) {
      const { data: profiles } = await admin
        .from("profiles_public")
        .select("id,full_name")
        .in("id", userIds);
      for (const profile of (profiles ?? []) as JsonObject[]) {
        const id = asString(profile.id);
        const fullName = asString(profile.full_name);
        if (id && fullName) profileNames.set(id, fullName);
      }
    }
    for (const note of noteRows) {
      const leadId = asString(note.lead_id);
      notesByLead.set(leadId, [...(notesByLead.get(leadId) ?? []), note]);
    }
    for (const photo of (photosRes.data ?? []) as JsonObject[]) {
      const leadId = asString(photo.lead_id);
      const path = asString(photo.photo_url);
      if (!path) continue;
      photosByLead.set(leadId, [...(photosByLead.get(leadId) ?? []), path]);
    }
  }

  return jobs.map((job) => {
    if (job.op === "delete") {
      return { op: "delete", db_id: job.lead_id, lead_id: job.job_id || job.lead_id, job_id: job.job_id || undefined };
    }
    const lead = leadsById.get(job.lead_id);
    // A delete committed while this lease was being read; send an idempotent
    // delete now. A newer outbox generation still protects the later ack.
    if (!lead) {
      return { op: "delete", db_id: job.lead_id, lead_id: job.job_id || job.lead_id, job_id: job.job_id || undefined };
    }
    return {
      op: "upsert",
      db_id: job.lead_id,
      job_id: asString(lead.job_id) || job.job_id || undefined,
      lead_id: asString(lead.job_id) || job.lead_id,
      previousStatuses: (job.previous_statuses ?? []).map((status) => STATUS_LABELS[status] || status),
      lead: formatLeadRow(
        lead,
        notesByLead.get(job.lead_id) ?? [],
        photosByLead.get(job.lead_id) ?? [],
        profileNames,
      ),
    };
  });
}

async function processQueue(
  admin: ReturnType<typeof createClient>,
  webhookUrl: string,
  limit: number,
  force = false,
) {
  const { data: runState, error: stateError } = await admin
    .from("google_sheets_sync_health")
    .select("reconcile_lock_token,reconcile_clear_pending,reconcile_active,last_success_at")
    .eq("id", "global")
    .maybeSingle();
  if (stateError) throw new Error(`Could not read reconciliation state: ${stateError.message}`);

  // Fail before claiming or clearing anything when the configured deployment
  // is missing, points at an obsolete version, or cannot acknowledge writes.
  // A mirror that delivered successfully in the last few minutes is trusted so
  // the scheduled worker does not spend a second Apps Script request per minute.
  const lastSuccessAt = asString(runState?.last_success_at);
  const lastSuccessMs = lastSuccessAt ? Date.parse(lastSuccessAt) : Number.NaN;
  const mirrorNeedsPreflight = !Number.isFinite(lastSuccessMs) || Date.now() - lastSuccessMs > 5 * 60_000;
  try {
    if (mirrorNeedsPreflight) await verifyMirrorDeployment(webhookUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.rpc("record_sheets_sync_failure", {
      p_message: message,
      p_lead_id: null,
      p_action: "apps_script_preflight",
      p_detail: { stage: "mirror_capability_check" },
    });
    return { success: false, claimed: 0, processed: 0, failed: 0, error: message };
  }

  if (runState?.reconcile_clear_pending) {
    const lockToken = asString(runState.reconcile_lock_token);
    if (!lockToken) throw new Error("A full rebuild is pending but its recovery token is missing.");
    try {
      await postToSheet(webhookUrl, { action: "clear_all" }, 90_000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.rpc("record_sheets_sync_failure", {
        p_message: `Full reconcile retry could not clear the Sheet: ${message}`,
        p_lead_id: null,
        p_action: "reconcile_clear",
        p_detail: { stage: "clear_all_retry" },
      });
      return { success: false, claimed: 0, processed: 0, failed: 0, error: message, reconcilePending: true };
    }
    const { error: releaseError } = await admin.rpc("finish_google_sheets_full_reconcile", {
      p_lock_token: lockToken,
    });
    if (releaseError) throw new Error(`Sheet cleared but the rebuild lease could not be released: ${releaseError.message}`);
  }

  if (force) {
    const { error } = await admin.rpc("retry_sheets_sync_queue_now", { p_limit: limit });
    if (error) throw new Error(`Could not release queued retries: ${error.message}`);
  }

  const { data, error } = await admin.rpc("claim_sheets_sync_queue", { p_limit: limit });
  if (error) throw new Error(`Could not claim sync jobs: ${error.message}`);
  const jobs = (data ?? []) as QueueJob[];
  if (!jobs.length) {
    const { data: depthData, error: depthError } = await admin.rpc("get_sheets_sync_queue_depth");
    if (!depthError && Number(depthData ?? 0) === 0) await admin.rpc("advance_sheets_sync_watermark");
    return { success: true, claimed: 0, processed: 0, failed: 0, queueDepth: Number(depthData ?? 0) };
  }

  let ops: JsonObject[];
  try {
    ops = await makeOps(admin, jobs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await Promise.all(jobs.map((job) => admin.rpc("finish_sheets_sync_job", {
      p_lead_id: job.lead_id,
      p_generation: job.generation,
      p_lease_token: job.lease_token,
      p_success: false,
      p_message: message,
      p_detail: { stage: "read_source_data" },
    })));
    return { success: false, claimed: jobs.length, processed: 0, failed: jobs.length, error: message };
  }

  try {
    const result = await postMirrorBatch(webhookUrl, ops);
    const acknowledgements = await Promise.all(jobs.map((job) => admin.rpc("finish_sheets_sync_job", {
      p_lead_id: job.lead_id,
      p_generation: job.generation,
      p_lease_token: job.lease_token,
      p_success: true,
      p_message: null,
      p_detail: null,
    })));
    const acked = acknowledgements.filter((item) => !item.error && item.data === true).length;
    const { data: depthData } = await admin.rpc("get_sheets_sync_queue_depth");
    if (Number(depthData ?? 0) === 0) await admin.rpc("advance_sheets_sync_watermark");
    return { success: true, claimed: jobs.length, processed: ops.length, acknowledged: acked, failed: 0, queueDepth: Number(depthData ?? 0) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const details = { stage: "apps_script_write", operations: ops.length };
    const outcomes = await Promise.all(jobs.map((job) => admin.rpc("finish_sheets_sync_job", {
      p_lead_id: job.lead_id,
      p_generation: job.generation,
      p_lease_token: job.lease_token,
      p_success: false,
      p_message: message,
      p_detail: details,
    })));
    const failed = outcomes.filter((item) => !item.error && item.data === true).length;
    return { success: false, claimed: jobs.length, processed: 0, failed, error: message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ success: false, error: "Supabase environment is not configured." }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const access = await authorize(req, admin, serviceRoleKey);
    if (access instanceof Response) return access;

    const body = await req.json().catch(() => ({})) as JsonObject;
    const action = asString(body.action);
    if (access.kind === "worker" && action !== "process_queue") {
      return jsonResponse({ success: false, error: "Worker credentials may only process the outbox." }, 403);
    }

    if (action === "get_config") {
      if (access.kind !== "admin") return jsonResponse({ success: false, error: "Admin access required." }, 403);
      const { data, error } = await admin.from("quo_ai_settings").select("value").eq("key", "google_sheets_sync_config").maybeSingle();
      if (error) return jsonResponse({ success: false, error: error.message }, 500);
      return jsonResponse({ success: true, config: data?.value ?? { webhookUrl: "", autoSync: false, spreadsheetUrl: "" } });
    }

    if (action === "save_config") {
      if (access.kind !== "admin") return jsonResponse({ success: false, error: "Admin access required." }, 403);
      const config = body.config as SyncConfig | undefined;
      if (!config || typeof config.autoSync !== "boolean"
          || (config.webhookUrl !== "" && !isAppsScriptUrl(config.webhookUrl))
          || (config.autoSync && !isAppsScriptUrl(config.webhookUrl))) {
        return jsonResponse({ success: false, error: "Enter a valid Google Apps Script Web App URL before enabling sync." }, 400);
      }
      const { error } = await admin.from("quo_ai_settings").upsert({
        key: "google_sheets_sync_config",
        value: config,
        description: "Google Sheets transactional outbox configuration",
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      if (error) return jsonResponse({ success: false, error: error.message }, 500);
      return jsonResponse({ success: true, message: "Configuration saved." });
    }

    if (action === "process_queue") {
      const config = await readStoredConfig(admin);
      const force = access.kind === "admin" && body.force === true;
      if (!isAppsScriptUrl(config.webhookUrl)) {
        return jsonResponse({ success: false, configured: false, error: "Configure and save the Apps Script Web App URL first." }, 409);
      }
      const { data: runState, error: stateError } = await admin
        .from("google_sheets_sync_health")
        .select("reconcile_active")
        .eq("id", "global")
        .maybeSingle();
      if (stateError) return jsonResponse({ success: false, error: stateError.message }, 500);
      if (config.autoSync !== true && !force && !runState?.reconcile_active) {
        return jsonResponse({ success: true, paused: true, claimed: 0, processed: 0, failed: 0 });
      }
      const requestedLimit = Number(body.limit ?? 10);
      const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 10, 10));
      const result = await processQueue(admin, config.webhookUrl, limit, force);
      return jsonResponse(result, result.success ? 200 : 502);
    }

    if (action === "reconcile_all") {
      if (access.kind !== "admin") return jsonResponse({ success: false, error: "Admin access required." }, 403);
      const config = await readStoredConfig(admin);
      if (!isAppsScriptUrl(config.webhookUrl)) {
        return jsonResponse({ success: false, error: "Configure the Apps Script Web App URL first." }, 409);
      }
      if (config.autoSync !== true) {
        return jsonResponse({ success: false, error: "Enable automatic sync before rebuilding the Sheet." }, 409);
      }
      const { data: mirrorHealth } = await admin
        .from("google_sheets_sync_health")
        .select("last_success_at")
        .eq("id", "global")
        .maybeSingle();
      try {
        // A mirror that delivered moments ago is trusted, so a slow cold start
        // cannot block a rebuild the user is waiting on. Anything else has to
        // answer before the workbook is cleared.
        const recentSuccess = asString(mirrorHealth?.last_success_at);
        const recentSuccessMs = recentSuccess ? Date.parse(recentSuccess) : Number.NaN;
        if (!Number.isFinite(recentSuccessMs) || Date.now() - recentSuccessMs > 10 * 60_000) {
          await verifyMirrorDeployment(config.webhookUrl);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResponse({ success: false, error: message }, 409);
      }
      const { data: reconcile, error: beginError } = await admin.rpc("begin_google_sheets_full_reconcile");
      if (beginError) return jsonResponse({ success: false, error: beginError.message }, 409);
      const lock = (Array.isArray(reconcile) ? reconcile[0] : reconcile) as { lock_token?: string; queued?: number } | null;
      if (!lock?.lock_token) return jsonResponse({ success: false, error: "The full reconcile could not acquire its lock." }, 409);

      try {
        // Keep the preflight plus this clear inside the function's wall-clock
        // budget; clearing the workbook is a metadata operation, not a row
        // rewrite, so it finishes well inside this window.
        await postToSheet(config.webhookUrl, { action: "clear_all" }, 75_000);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await admin.rpc("record_sheets_sync_failure", {
          p_message: `Full reconcile could not clear the Sheet: ${message}`,
          p_lead_id: null,
          p_action: "reconcile_clear",
          p_detail: { stage: "clear_all" },
        });
        // Keep the durable clear-pending lock. The cron worker retries the
        // clear before it resumes the queued snapshot.
        throw err;
      }

      const { error: finishError } = await admin.rpc("finish_google_sheets_full_reconcile", {
        p_lock_token: lock.lock_token,
      });
      if (finishError) {
        // The ten-minute lease expires if this release call fails; the queue
        // remains durable and the cron worker resumes after that lease.
        return jsonResponse({
          success: false,
          error: `Sheet cleared, but worker release failed: ${finishError.message}`,
          queued: Number(lock.queued ?? 0),
        }, 500);
      }

      return jsonResponse({
        success: true,
        queued: Number(lock.queued ?? 0),
        message: `Sheet cleared. ${Number(lock.queued ?? 0)} leads are queued for server-side rebuild.`,
      });
    }

    // All proxy/test/reconciliation actions require a verified CRM Admin. The
    // worker path above is the only operation admitted through service_role.
    if (access.kind !== "admin") return jsonResponse({ success: false, error: "Admin access required." }, 403);
    const config = await readStoredConfig(admin);
    const webhookUrl = action === "ping" ? body.webhookUrl : config.webhookUrl;
    if (!isAppsScriptUrl(webhookUrl)) return jsonResponse({ success: false, error: "Google Apps Script URL is missing or invalid." }, 400);

    const payload = { ...body, action: action || "sync_all" };
    const result = await postToSheet(webhookUrl, payload);
    if (action === "sync_mirror" && Number(result.processedOps) !== (Array.isArray(body.ops) ? body.ops.length : 0)) {
      return jsonResponse({ success: false, error: "Apps Script did not acknowledge every operation.", result }, 502);
    }
    return jsonResponse({ ...result, httpStatus: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("google-sheets-sync error:", message);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
