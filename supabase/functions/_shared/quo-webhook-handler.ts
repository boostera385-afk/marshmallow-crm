import type { SupabaseClient } from "@supabase/supabase-js";
import { corsHeaders, isProcessableQuoWebhookEvent, jsonResponse, normalizeQuoContactPayload, normalizeQuoPayload, verifySignature, type JsonObject } from "./quo-ai.ts";
import { ingestQuoMessage } from "./quo-ingestion.ts";

type Dependencies = {
  createClient: (url: string, key: string, options?: object) => SupabaseClient;
  env: (name: string) => string | undefined;
  /** Preserve the older quo-webhook endpoint's paused-delivery audit. */
  logPaused?: boolean;
};

/** Both public webhook URLs keep their authentication and pause controls here. */
export function createQuoWebhookHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const url = deps.env("SUPABASE_URL");
    const key = deps.env("SB_SERVICE_ROLE_KEY") ?? deps.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return jsonResponse({ error: "Missing Supabase service configuration." }, 500);
    let payload: JsonObject;
    const raw = await req.text();
    try {
      const parsed: unknown = JSON.parse(raw || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Invalid webhook payload" }, 400);
      payload = { ...parsed };
    } catch { return jsonResponse({ error: "Invalid webhook JSON" }, 400); }
    const secret = deps.env("QUO_WEBHOOK_SECRET") ?? deps.env("QUO_WEBHOOK_TOKEN");
    const strict = deps.env("QUO_ENFORCE_SIGNATURE") === "true" || deps.env("QUO_STRICT_SIGNATURE") === "true";
    const signature = req.headers.get("openphone-signature") ?? req.headers.get("x-openphone-signature") ?? req.headers.get("x-quo-signature") ?? req.headers.get("x-signature");
    const verified = await verifySignature(raw, signature, secret);
    if (secret && strict && !verified) return jsonResponse({ error: "Invalid webhook signature" }, 401);
    const eventType = [payload.type, payload.event_type, payload.eventType].find((value): value is string => typeof value === "string") ?? "message.received";
    const eventId = [payload.id, payload.event_id, payload.eventId].find((value): value is string => typeof value === "string") ?? null;
    const db = deps.createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const log = async (status: "processed" | "ignored", note: string) => {
      const { error } = await db.from("quo_webhook_events").upsert({ quo_event_id: eventId,
        event_type: eventType, raw_payload: payload, processing_status: status,
        signature_verified: verified, processed_at: new Date().toISOString(), error_message: note,
      }, { onConflict: eventId ? "quo_event_id" : "quo_message_id,event_type", ignoreDuplicates: true });
      if (error) throw new Error("Webhook audit unavailable");
    };
    try {
      const { data: paused, error: pauseError } = await db.from("quo_ai_settings").select("value").eq("key", "quo_webhook_ingestion_paused").maybeSingle();
      // An unreadable control is not proof that ingestion is enabled. Ask the
      // provider to retry; never bypass an Admin's pause during an outage.
      if (pauseError) throw new Error("Webhook ingestion control unavailable");
      if (paused?.value === true) {
        if (deps.logPaused) await log("ignored", "Quo Monitor ingestion is paused by an admin testing switch.");
        return jsonResponse({ success: true, ignored: true, paused: true, event_type: eventType, reason: "Quo Monitor ingestion is paused." });
      }
      if (eventType === "contact.updated") {
        const contact = normalizeQuoContactPayload(payload);
        let changed = 0;
        if (contact.name && contact.phoneNumbers.length) {
          const { data, error } = await db.from("quo_conversations").update({ customer_name: contact.name, raw_payload: payload }).in("customer_number", contact.phoneNumbers).select("id");
          if (error) throw new Error("Contact update unavailable");
          changed = data?.length ?? 0;
        }
        await log("processed", changed ? `Updated contact name on ${changed} existing Quo conversation(s).` : "Contact update accepted; no matching stored conversation found.");
        return jsonResponse({ success: true, event_type: eventType, updated_conversations: changed });
      }
      if (!isProcessableQuoWebhookEvent(eventType)) {
        await log("ignored", "Quo event logged but not processed by CRM webhook.");
        return jsonResponse({ success: true, ignored: true, event_type: eventType, reason: "This event does not update Quo AI conversations." });
      }
      let normalized: ReturnType<typeof normalizeQuoPayload>;
      try { normalized = normalizeQuoPayload(payload, eventType); }
      catch {
        await log("ignored", "Quo event did not include a processable payload.");
        return jsonResponse({ success: true, ignored: true, event_type: eventType, reason: "Quo event did not include a processable payload." });
      }
      return jsonResponse(await ingestQuoMessage(db, { eventId, eventType, payload, signatureVerified: verified, ...normalized }));
    } catch {
      // Do not return database details, raw payloads or customer text. A missing
      // migration/database failure is retryable, never a successful duplicate.
      return jsonResponse({ success: false, error: "Quo ingestion temporarily unavailable", retryable: true }, 503);
    }
  };
}
