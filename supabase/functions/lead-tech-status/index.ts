// =============================================================================
// lead-tech-status
//
// For every tech a processor marked Texted / Called on a lead, reads that tech's
// stored Quo chat (quo_messages, matched by phone) and records whether they
// agreed to THIS job. Writes only the verdict columns of lead_tech_contacts.
//
// Callers
//   manual  signed-in user with AI Tech Status (Admin, Processor by default, or
//           granted in Feature Access; public.can_see_tech_status(), migration
//           20261127085131). Body { leadIds?: string[], force?: boolean }. Users
//           other than Admin / Processor must name leads, and only leads they can
//           see (their own RLS) are checked.
//           Called after a tech is marked Texted/Called, from the tech status
//           popover, and with the urgent table's Refresh AI Status button.
//   cron    x-cron-secret header (pg_cron, see 20261127061709). All active
//           urgent / need-tech leads.
//
// Cost control: rules decide "no chat" and "no reply yet" without the model, and
// the model runs only when the tech wrote something new since the last check
// (or force). At most MAX_MODEL_CALLS per run.
//
// The processor's remark on the tech's line ("ooa", "today 1-3pm for $950")
// is given to the model next to the chat. Both are fenced as data, and an
// agreed/declined verdict must quote the tech's own words or the processor's
// note (verified, source recorded) or it is stored as "unclear".
// =============================================================================

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  lastTechMessageAt,
  needsModelCheck,
  phoneVariants,
  ruleVerdict,
  userPrompt,
  verifyModelVerdict,
  windowStart,
  type TechJob,
  type TechMessage,
  type TechRow,
  type VerdictResult,
} from "../_shared/lead-tech-status.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_LEADS = 100;
const MAX_MODEL_CALLS = 40;
const MAX_MESSAGES = 80;
const CONCURRENCY = 4;
const ACTIVE_STATUSES = ["urgent_job", "need_tech"];

const JOB_COLUMNS = "id, service_type, service_details, city, state, zip_code, scheduled_date, customer_schedule_requirements, terms, created_at";
const TECH_COLUMNS = "id, lead_id, tech_number, name, phone_key, state, contacted_at, verdict, verdict_checked_at, last_tech_message_at, processor_note";

function extractCronSecret(value: unknown): string | null {
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string" && item.trim().length > 0) ?? null;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).secret === "string") {
    return String((value as Record<string, unknown>).secret);
  }
  return null;
}

async function askModel(apiKey: string, job: TechJob, messages: TechMessage[], processorNote: string | null): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_schema", json_schema: { name: "tech_verdict", strict: true, schema: RESPONSE_SCHEMA } },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(job, messages, processorNote) },
        ],
      }),
    });
    if (!response.ok) {
      console.error("openai_error", response.status);
      return null;
    }
    const payload = await response.json();
    return JSON.parse(payload?.choices?.[0]?.message?.content ?? "null");
  } catch (error) {
    console.error("tech_verdict_failed", error instanceof DOMException ? error.name : "exception");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadTechMessages(admin: SupabaseClient, tech: TechRow, since: string): Promise<TechMessage[]> {
  const variants = phoneVariants(tech.phone_key);
  if (!variants.length) return [];
  const { data: conversations, error: convError } = await admin
    .from("quo_conversations")
    .select("id")
    .in("customer_number", variants)
    .limit(10);
  if (convError) throw new Error("Could not read the tech's Quo conversation.");
  const ids = (conversations ?? []).map((row) => row.id as string);
  if (!ids.length) return [];
  const { data, error } = await admin
    .from("quo_messages")
    .select("id, sender, text, message_time")
    .in("conversation_id", ids)
    .gte("message_time", since)
    .order("message_time", { ascending: false })
    .limit(MAX_MESSAGES);
  if (error) throw new Error("Could not read the tech's Quo messages.");
  return ((data ?? []) as TechMessage[]).reverse();
}

async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "Server is not configured." }, 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Who is calling.
  let trigger: "cron" | "manual" = "manual";
  let staff = false; // Admin / Processor: may run a check over every active lead.
  let userClient: SupabaseClient | null = null;
  const requestSecret = req.headers.get("x-cron-secret");
  if (requestSecret) {
    const envSecret = Deno.env.get("FUNCTION_CRON_SECRET");
    let valid = !!envSecret && requestSecret === envSecret;
    if (!valid) {
      const { data: setting } = await admin.from("quo_ai_settings").select("value").eq("key", "cron_secret").maybeSingle();
      const stored = extractCronSecret(setting?.value);
      valid = !!stored && requestSecret === stored;
    }
    if (!valid) return jsonResponse({ error: "Invalid cron secret." }, 401);
    trigger = "cron";
  } else {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "Not signed in." }, 401);
    const { data: userData, error: userError } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData?.user) return jsonResponse({ error: "Not signed in." }, 401);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!anonKey) return jsonResponse({ error: "Server is not configured." }, 500);
    userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: allowed, error: accessError } = await userClient.rpc("can_see_tech_status");
    if (accessError) return jsonResponse({ error: "Could not check your access." }, 500);
    if (allowed !== true) return jsonResponse({ error: "AI Tech Status is not enabled for you." }, 403);
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", userData.user.id);
    const roles = new Set((roleRows ?? []).map((row) => String(row.role)));
    staff = roles.has("admin") || roles.has("processor");
  }

  let body: { leadIds?: unknown; force?: unknown } = {};
  try { body = await req.json(); } catch { body = {}; }
  let requested = Array.isArray(body.leadIds)
    ? [...new Set(body.leadIds.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))]
    : null;
  if (requested && requested.length > MAX_LEADS) return jsonResponse({ error: `At most ${MAX_LEADS} leads per request.` }, 400);
  if (trigger === "manual" && !staff) {
    // Granted users check only leads they name and can see.
    if (!requested) return jsonResponse({ error: "Choose the leads to check." }, 400);
    if (requested.length && userClient) {
      const { data: visible, error: visibleError } = await userClient.from("leads").select("id").in("id", requested);
      if (visibleError) return jsonResponse({ error: "Could not load the jobs." }, 500);
      requested = (visible ?? []).map((row) => String(row.id));
    }
  }
  const force = trigger === "manual" && body.force === true;

  // Techs being tracked.
  let techQuery = admin.from("lead_tech_contacts").select(TECH_COLUMNS).neq("state", "not_texted");
  if (requested) techQuery = techQuery.in("lead_id", requested.length ? requested : ["00000000-0000-0000-0000-000000000000"]);
  const { data: techData, error: techError } = await techQuery.limit(1000);
  if (techError) return jsonResponse({ error: "Could not load tracked techs." }, 500);
  const techs = (techData ?? []) as TechRow[];
  if (!techs.length) return jsonResponse({ checked: 0, model_calls: 0, deferred: 0, failed: 0, trigger });

  const leadIds = [...new Set(techs.map((tech) => tech.lead_id))];
  let jobQuery = admin.from("leads").select(JOB_COLUMNS + ", status").in("id", leadIds);
  if (!requested) jobQuery = jobQuery.in("status", ACTIVE_STATUSES);
  const { data: jobData, error: jobError } = await jobQuery;
  if (jobError) return jsonResponse({ error: "Could not load the jobs." }, 500);
  const jobs = new Map(((jobData ?? []) as TechJob[]).map((job) => [job.id, job]));

  let checked = 0;
  let modelCalls = 0;
  let deferred = 0;
  let failed = 0;
  let modelUnavailable = false;

  await pool(techs.filter((tech) => jobs.has(tech.lead_id)), CONCURRENCY, async (tech) => {
    const job = jobs.get(tech.lead_id)!;
    const since = windowStart(job, tech);
    if (!since) return;
    try {
      const messages = await loadTechMessages(admin, tech, since);
      let result: VerdictResult | null = ruleVerdict(messages, tech.processor_note);
      if (!result) {
        const latest = lastTechMessageAt(messages);
        if (!needsModelCheck(tech, latest, force)) return;
        if (!apiKey) { modelUnavailable = true; deferred++; return; }
        if (modelCalls >= MAX_MODEL_CALLS) { deferred++; return; }
        modelCalls++;
        const raw = await askModel(apiKey, job, messages, tech.processor_note ?? null);
        if (raw === null) { failed++; return; } // keep the previous verdict on an AI failure
        result = verifyModelVerdict(raw, messages, tech.processor_note);
      }
      const { error } = await admin
        .from("lead_tech_contacts")
        .update({
          verdict: result.verdict,
          verdict_reason: result.reason,
          evidence_quote: result.quote,
          evidence_at: result.quote_at,
          evidence_source: result.quote_source,
          last_tech_message_at: result.last_tech_message_at,
          verdict_checked_at: new Date().toISOString(),
        })
        .eq("id", tech.id)
        // Skip if the processor moved the tech back to Not Texted or the phone changed meanwhile.
        .neq("state", "not_texted")
        .eq("phone_key", tech.phone_key ?? "");
      if (error) failed++;
      else checked++;
    } catch (error) {
      console.error("tech_check_failed", error instanceof Error ? error.message : "exception");
      failed++;
    }
  });

  return jsonResponse({
    checked,
    model_calls: modelCalls,
    deferred,
    failed,
    trigger,
    ...(modelUnavailable ? { warning: "AI is not configured; only rule-based results were saved." } : {}),
  });
});
