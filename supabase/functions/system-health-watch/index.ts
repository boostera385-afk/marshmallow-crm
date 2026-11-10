// =============================================================================
// system-health-watch
//
// Overload early warning. Once a minute (pg_cron, marshmallow_private.
// cron_system_health_watch) this reads the database host's memory, swap, CPU
// and disk from Supabase's Metrics API and hands the numbers to
// public.record_system_health(), which decides the level and notifies Admins
// in the CRM. When it returns an alert, this also emails it (Resend).
// If the database itself cannot be reached and the host is already in the
// outage pattern, it still emails (at most every 10 minutes).
//
// Caller: pg_cron with x-cron-secret.
// Body (optional): { dry_run?: boolean, test_level?: "warning" | "critical" }
//   dry_run    records the minute without notifying (used to verify the setup)
//   test_level sends a labelled test alert without changing the stored level
// Secrets: SB_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY (already set),
//   optional HEALTH_METRICS_KEY (secret key for the Metrics API),
//   RESEND_API_KEY + HEALTH_ALERT_EMAILS (+ optional HEALTH_ALERT_FROM) for email.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/quo-ai.ts";
import {
  criticalWithoutDatabase,
  hostSample,
  parseRecipients,
  sendAlertEmail,
  type HealthSample,
} from "../_shared/system-health.ts";

function cronSecretFrom(value: unknown): string | null {
  if (Array.isArray(value)) return value.find((v): v is string => typeof v === "string" && v.trim().length > 0) ?? null;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).secret === "string") return String((value as Record<string, unknown>).secret);
  return null;
}

/** Reads the Metrics API with the first key it accepts. Never returns or logs a key. */
async function readMetrics(supabaseUrl: string, keys: string[]): Promise<{ text?: string; error?: string }> {
  let lastError = "no key available for the Metrics API";
  for (const key of keys) {
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/customer/v1/privileged/metrics`, {
        headers: { Authorization: `Basic ${btoa(`service_role:${key}`)}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) return { text: await res.text() };
      lastError = `Metrics API HTTP ${res.status}`;
      await res.body?.cancel();
      if (res.status !== 401 && res.status !== 403) break;
    } catch (error) {
      lastError = `Metrics API ${error instanceof Error ? error.name : "error"}`;
    }
  }
  return { error: lastError };
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

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const dryRun = body.dry_run === true;
  const testLevel = body.test_level === "warning" || body.test_level === "critical" ? body.test_level : undefined;

  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const recipients = parseRecipients(Deno.env.get("HEALTH_ALERT_EMAILS"));
  const from = Deno.env.get("HEALTH_ALERT_FROM") || "Marshmallow alerts <onboarding@resend.dev>";
  const emailConfigured = !!resendKey && recipients.length > 0;

  const keys = [...new Set([
    Deno.env.get("HEALTH_METRICS_KEY"),
    Deno.env.get("SB_SERVICE_ROLE_KEY"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  ].filter((k): k is string => !!k))];
  const metrics = await readMetrics(supabaseUrl, keys);
  const sample: HealthSample = metrics.text
    ? hostSample(metrics.text, emailConfigured)
    : { metrics_ok: false, metrics_error: metrics.error, email_configured: emailConfigured };

  const options: Record<string, unknown> = {};
  if (dryRun) options.dry_run = true;
  if (testLevel) options.test_level = testLevel;
  const { data, error } = await admin.rpc("record_system_health", { p_sample: sample, p_options: options });

  if (error) {
    // The database could not record the minute. If the host is already in the
    // outage pattern, email anyway - at most once every 10 minutes.
    const reasons = criticalWithoutDatabase(sample);
    let email = "not needed";
    if (reasons.length && !dryRun && new Date().getUTCMinutes() % 10 === 0) {
      email = await sendAlertEmail(fetch, resendKey, from, recipients, {
        subject: "[Marshmallow] Database overload critical (alert could not reach the database)",
        text: `The overload alert could not write to the database, and the host shows: ${reasons.join("; ")}.\n`
          + "Users are probably affected now. Ask everyone to close extra CRM tabs, pause Quo ingestion, "
          + "and upgrade compute (Supabase > Settings > Compute) if it does not ease within 10 minutes.",
      });
    }
    return jsonResponse({ ok: false, error: "could not record the sample", metrics_ok: sample.metrics_ok, email }, 503);
  }

  const result = (data ?? {}) as { email?: { subject: string; text: string } | null; [key: string]: unknown };
  let email = "not needed";
  if (result.email && !dryRun) {
    email = await sendAlertEmail(fetch, resendKey, from, recipients, result.email);
  }
  const { email: _sent, ...summary } = result;
  return jsonResponse({ ok: true, ...summary, metrics_error: sample.metrics_error, email });
});
