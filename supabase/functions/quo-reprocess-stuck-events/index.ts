// =============================================================================
// quo-reprocess-stuck-events
//
// One-off recovery of Quo webhook events left "processing" when the webhook
// timed out during the 2026-11-07 / 2026-11-09 outages (their messages never
// reached quo_messages). See supabase/functions/_shared/quo-event-recovery.ts.
//
// Caller: pg_cron/SQL only, with the x-cron-secret used by the other scheduled
// functions. No browser access.
//
// Body: { from: ISO time, until: ISO time, limit?: 1-300 (default 150),
//         dry_run?: boolean (default true) }
// Response: counts and event ids only - no message text or customer data.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/quo-ai.ts";
import { recoverStuckEvent, recoveryOrder, supabaseRecoveryStore, type StuckEvent } from "../_shared/quo-event-recovery.ts";

function cronSecretFrom(value: unknown): string | null {
  if (Array.isArray(value)) return value.find((v): v is string => typeof v === "string" && v.trim().length > 0) ?? null;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).secret === "string") return String((value as Record<string, unknown>).secret);
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "Server is not configured." }, 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const requestSecret = req.headers.get("x-cron-secret");
  if (!requestSecret) return jsonResponse({ error: "Not allowed." }, 401);
  const envSecret = Deno.env.get("FUNCTION_CRON_SECRET");
  let valid = !!envSecret && requestSecret === envSecret;
  if (!valid) {
    const { data: setting } = await admin.from("quo_ai_settings").select("value").eq("key", "cron_secret").maybeSingle();
    const stored = cronSecretFrom(setting?.value);
    valid = !!stored && requestSecret === stored;
  }
  if (!valid) return jsonResponse({ error: "Not allowed." }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON." }, 400); }
  const from = typeof body.from === "string" ? new Date(body.from) : null;
  const until = typeof body.until === "string" ? new Date(body.until) : null;
  if (!from || !until || Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || from >= until) {
    return jsonResponse({ error: "from and until (ISO times, from < until) are required." }, 400);
  }
  const limit = Math.min(300, Math.max(1, Number.isInteger(body.limit) ? Number(body.limit) : 150));
  const dryRun = body.dry_run !== false;

  const { data: rows, error } = await admin
    .from("quo_webhook_events")
    .select("id, event_type, raw_payload, received_at")
    .eq("processing_status", "processing")
    .gte("received_at", from.toISOString())
    .lt("received_at", until.toISOString())
    .order("received_at", { ascending: true })
    .limit(limit);
  if (error) return jsonResponse({ error: `Could not read events: ${error.message}` }, 500);

  const store = supabaseRecoveryStore(admin);
  const summary = { dry_run: dryRun, examined: 0, recovered: 0, message_already_saved: 0, conversations_created: 0, ignored: 0, failed: 0 };
  const byType: Record<string, Record<string, number>> = {};
  const problems: { id: string; result: string; reason: string }[] = [];

  for (const event of recoveryOrder((rows ?? []) as (StuckEvent & { received_at: string })[])) {
    const out = await recoverStuckEvent(store, event, dryRun);
    summary.examined++;
    const type = event.event_type ?? "unknown";
    byType[type] ??= {};
    byType[type][out.result] = (byType[type][out.result] ?? 0) + 1;
    if (out.result === "recovered") {
      summary.recovered++;
      if (out.messageExisted) summary.message_already_saved++;
      if (out.conversationCreated) summary.conversations_created++;
    } else {
      summary[out.result]++;
      if (problems.length < 50) problems.push({ id: event.id, result: out.result, reason: out.reason.slice(0, 200) });
    }
  }

  const { count: remaining } = await admin
    .from("quo_webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("processing_status", "processing")
    .gte("received_at", from.toISOString())
    .lt("received_at", until.toISOString());

  return jsonResponse({ ok: true, ...summary, by_type: byType, problems, still_processing_in_window: remaining ?? null });
});
