// =============================================================================
// quo-webhook-events-retention
//
// Daily 30-day retention for quo_webhook_events (the raw Quo delivery log, not
// the CRM's messages). Archives each batch to the private "archives" Storage
// bucket as gzipped JSON lines, then deletes exactly the archived rows. Rows
// still "processing" or "failed" are never touched.
// See supabase/functions/_shared/webhook-event-retention.ts.
//
// Caller: pg_cron (marshmallow_private.cron_quo_webhook_events_retention, which
// only calls while the load governor reports normal) with x-cron-secret.
// Body (optional): { keep_days?: >=7 (30), batch_size?: 100-1000 (1000),
//                    max_batches?: 1-20 (10) }
// Response: counts and archive file paths only.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/quo-ai.ts";
import { RETENTION_STATUSES, runRetention, type ArchivedEvent } from "../_shared/webhook-event-retention.ts";

const BUCKET = "archives";

function cronSecretFrom(value: unknown): string | null {
  if (Array.isArray(value)) return value.find((v): v is string => typeof v === "string" && v.trim().length > 0) ?? null;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).secret === "string") return String((value as Record<string, unknown>).secret);
  return null;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const intIn = (value: unknown, min: number, max: number, fallback: number) =>
  Number.isInteger(value) ? Math.min(max, Math.max(min, Number(value))) : fallback;

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

  try {
    const result = await runRetention({
      async fetchBatch(cutoffIso, limit) {
        const { data, error } = await admin.rpc("webhook_retention_batch", { p_cutoff: cutoffIso, p_limit: limit });
        if (error) throw new Error(`read failed: ${error.message}`);
        return (data ?? []) as ArchivedEvent[];
      },
      async upload(path, bytes) {
        const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "application/gzip", upsert: false });
        if (error) throw new Error(`archive upload failed: ${error.message}`);
      },
      async deleteIds(ids) {
        const { count, error } = await admin
          .from("quo_webhook_events")
          .delete({ count: "exact" })
          .in("id", ids)
          .in("processing_status", [...RETENTION_STATUSES]);
        if (error) throw new Error(`delete failed: ${error.message}`);
        return count ?? 0;
      },
    }, {
      keepDays: intIn(body.keep_days, 7, 3650, 30),
      batchSize: intIn(body.batch_size, 100, 1000, 1000), // PostgREST returns at most 1,000 rows
      maxBatches: intIn(body.max_batches, 1, 20, 10),
      now: new Date(),
      runId: crypto.randomUUID().slice(0, 8),
      gzip,
    });
    const status = result.stopped === "upload_failed" || result.stopped === "delete_failed" ? 500 : 200;
    await admin.rpc("record_webhook_retention_run", {
      p_result: { ok: status === 200, stopped: result.stopped, error: result.error ?? null },
    }).catch(() => { /* status recording must never affect the retention response itself */ });
    return jsonResponse({ ok: status === 200, bucket: BUCKET, ...result }, status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "retention failed";
    await admin.rpc("record_webhook_retention_run", { p_result: { ok: false, stopped: null, error: message } })
      .catch(() => { /* status recording must never affect the retention response itself */ });
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
