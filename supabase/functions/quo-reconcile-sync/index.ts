import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  getQuoMessagePreview,
  jsonResponse,
  normalizeQuoPayload,
} from "../_shared/quo-ai.ts";

type PaginatedResponse<T> = {
  data?: T[];
  nextPageToken?: string | null;
};

type JsonObject = Record<string, unknown>;

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function extractCronSecret(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === "string" && item.trim().length > 0) ?? null;
  }
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).secret === "string") {
    return String((value as Record<string, unknown>).secret);
  }
  return null;
}

async function safeJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function authorizeJob(req: Request, supabase: ReturnType<typeof createClient>) {
  const cronSecret = Deno.env.get("FUNCTION_CRON_SECRET");
  const requestSecret = req.headers.get("x-cron-secret");

  if (cronSecret && requestSecret === cronSecret) {
    return null;
  }

  if (requestSecret) {
    const { data: setting } = await supabase
      .from("quo_ai_settings")
      .select("value")
      .eq("key", "cron_secret")
      .maybeSingle();
    const storedCronSecret = extractCronSecret(setting?.value);
    if (storedCronSecret && requestSecret === storedCronSecret) return null;
  }

  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : null;
  const apiKey = req.headers.get("apikey");

  if (serviceRoleKey && (bearerToken === serviceRoleKey || apiKey === serviceRoleKey)) return null;

  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Admin token or valid x-cron-secret required" }, 401);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(bearerToken ?? "");

  if (userError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { data: roleData, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError) {
    return jsonResponse({ error: "Could not verify role" }, 500);
  }

  if (roleData?.role !== "admin") {
    return jsonResponse({ error: "Admin access required" }, 403);
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey =
      Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const quoApiKey = Deno.env.get("QUO_API_KEY");
    const quoBaseUrl = Deno.env.get("QUO_API_BASE_URL") ?? "https://api.openphone.com/v1";
    if (!supabaseUrl || !serviceRoleKey || !quoApiKey) {
      return jsonResponse({ error: "Missing Supabase or Quo API configuration." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authErrorResponse = await authorizeJob(req, supabase);
    if (authErrorResponse) return authErrorResponse;

    const body = await req.json().catch(() => ({}));
    const since =
      typeof body.createdAfter === "string"
        ? body.createdAfter
        : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const limit = Math.max(1, Math.min(Number(body.limit ?? 100), 100));
    const maxPages = Math.max(1, Math.min(Number(body.maxPages ?? 4), 20));

    let syncLogId: string | null = null;
    const { data: syncLog } = await supabase
      .from("quo_sync_logs")
      .insert({
        sync_type: "reconcile",
        status: "running",
        details: { createdAfter: since, limit, maxPages },
      })
      .select("id")
      .single();
    syncLogId = syncLog?.id ?? null;

    const allMessages: Record<string, unknown>[] = [];
    const conversationsToSync: Record<string, unknown>[] = [];
    let pageToken: string | null | undefined = undefined;
    let pagesFetched = 0;

    do {
      const params = new URLSearchParams();
      params.set("updatedAfter", since);
      params.set("excludeInactive", "false");
      params.set("maxResults", String(limit));
      if (pageToken) params.set("pageToken", pageToken);
      if (typeof body.phoneNumberId === "string") params.append("phoneNumbers", body.phoneNumberId);

      const response = await fetch(`${quoBaseUrl}/conversations?${params.toString()}`, {
        headers: {
          Authorization: quoApiKey,
          Accept: "application/json",
        },
      });
      const data = await safeJson(response) as PaginatedResponse<Record<string, unknown>>;
      if (!response.ok) {
        throw new Error(`Quo conversations request failed with status ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
      }

      conversationsToSync.push(...(data?.data ?? []));
      pageToken = data?.nextPageToken ?? null;
      pagesFetched += 1;
    } while (pageToken && pagesFetched < maxPages);

    let messagePagesFetched = 0;

    for (const rawConversation of conversationsToSync) {
      const conversation = rawConversation as JsonObject;
      const conversationId = asString(conversation.id);
      const phoneNumberId = asString(conversation.phoneNumberId) ?? asString(conversation.phone_number_id);
      const participants = arrayOfStrings(conversation.participants);

      if (!conversationId || !phoneNumberId || participants.length === 0) {
        continue;
      }

      let messagePageToken: string | null | undefined = undefined;
      let conversationMessagePages = 0;

      do {
        const messageParams = new URLSearchParams();
        messageParams.set("phoneNumberId", phoneNumberId);
        participants.slice(0, 10).forEach((participant) => messageParams.append("participants", participant));
        messageParams.set("createdAfter", since);
        messageParams.set("maxResults", String(limit));
        if (messagePageToken) messageParams.set("pageToken", messagePageToken);

        const response = await fetch(`${quoBaseUrl}/messages?${messageParams.toString()}`, {
          headers: {
            Authorization: quoApiKey,
            Accept: "application/json",
          },
        });
        const data = await safeJson(response) as PaginatedResponse<Record<string, unknown>>;
        if (!response.ok) {
          throw new Error(`Quo messages request failed with status ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
        }

        allMessages.push(
          ...(data?.data ?? []).map((message) => ({
            ...message,
            conversationId: asString((message as JsonObject).conversationId) ?? conversationId,
            phoneNumberId: asString((message as JsonObject).phoneNumberId) ?? phoneNumberId,
            contact: (message as JsonObject).contact ?? {
              name: asString(conversation.name),
              phoneNumbers: participants.map((value) => ({ value })),
            },
          })),
        );
        messagePageToken = data?.nextPageToken ?? null;
        conversationMessagePages += 1;
        messagePagesFetched += 1;
      } while (messagePageToken && conversationMessagePages < 3);
    }

    let insertedOrUpdated = 0;
    const analyzed = 0;
    let skipped = 0;

    for (const rawMessage of allMessages) {
      const rawContact = (rawMessage as Record<string, unknown>).contact;
      const payload = {
        type: "message.reconciled",
        data: {
          message: rawMessage,
          conversation: {
            id: (rawMessage as Record<string, unknown>).conversationId,
            phoneNumberId: (rawMessage as Record<string, unknown>).phoneNumberId,
            // Preserve contact info so normalizeQuoPayload can derive the real customer number
            contact: rawContact ?? undefined,
          },
        },
      };

      let normalized: ReturnType<typeof normalizeQuoPayload>;
      try {
        normalized = normalizeQuoPayload(payload);
      } catch {
        skipped += 1;
        continue;
      }

      const { message, conversation } = normalized;

      let phoneNumberRowId: string | null = null;
      if (conversation.phoneNumberId) {
        const { data: phoneRow } = await supabase
          .from("quo_phone_numbers")
          .upsert(
            {
              quo_phone_number_id: conversation.phoneNumberId,
              number: conversation.phoneNumberDisplay ?? conversation.phoneNumberId,
              display_number: conversation.phoneNumberDisplay,
              name: conversation.phoneNumberName,
              label: conversation.phoneNumberName,
              active: true,
            },
            { onConflict: "quo_phone_number_id" },
          )
          .select("id")
          .single();
        phoneNumberRowId = phoneRow?.id ?? null;
      }

      const messageTime = new Date(message.createdAt).toISOString();
      const { data: existingConversation } = await supabase
        .from("quo_conversations")
        .select("linked_lead_id")
        .eq("quo_conversation_id", conversation.id)
        .maybeSingle();

      const { data: conversationRow, error: conversationError } = await supabase
        .from("quo_conversations")
        .upsert(
          {
            quo_conversation_id: conversation.id,
            customer_name: conversation.customerName,
            customer_number: conversation.customerNumber,
            number_id: phoneNumberRowId,
            linked_lead_id: existingConversation?.linked_lead_id ?? null,
            last_message_preview: getQuoMessagePreview(message.text, message.media),
            last_message_time: messageTime,
            last_message_at: messageTime,
            last_customer_message_at: message.sender === "customer" ? messageTime : undefined,
            last_agent_message_at: message.sender === "agent" ? messageTime : undefined,
            direction: message.direction === "inbound" ? "incoming" : "outgoing",
            status: "active",
            current_status: "open",
            raw_payload: payload,
          },
          { onConflict: "quo_conversation_id" },
        )
        .select("id")
        .single();

      if (conversationError || !conversationRow) continue;

      await supabase.from("quo_conversation_flags").upsert(
        { conversation_id: conversationRow.id },
        { onConflict: "conversation_id", ignoreDuplicates: true },
      );

      const { data: messageRow, error: messageError } = await supabase
        .from("quo_messages")
        .upsert(
          {
            quo_message_id: message.id,
            conversation_id: conversationRow.id,
            sender: message.sender,
            direction: message.direction,
            recipients: message.to,
            text: message.text,
            media: message.media,
            status: message.status,
            message_time: messageTime,
            quo_created_at: messageTime,
            raw_payload: payload,
          },
          { onConflict: "quo_message_id" },
        )
        .select("id")
        .single();

      if (!messageError) {
        insertedOrUpdated += 1;
      }
    }


    if (syncLogId) {
      await supabase
        .from("quo_sync_logs")
        .update({
          status: "completed",
          details: {
            createdAfter: since,
            conversationsFetched: conversationsToSync.length,
            fetched: allMessages.length,
            conversationPagesFetched: pagesFetched,
            messagePagesFetched,
            insertedOrUpdated,
            analyzed,
            skipped,
          },
        })
        .eq("id", syncLogId);
    }

    return jsonResponse({
      success: true,
      conversations_fetched: conversationsToSync.length,
      fetched: allMessages.length,
      conversation_pages_fetched: pagesFetched,
      message_pages_fetched: messagePagesFetched,
      inserted_or_updated: insertedOrUpdated,
      queued_analysis: analyzed,
      skipped,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown reconcile error";

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceRoleKey) {
        const supabase = createClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        await supabase
          .from("quo_sync_logs")
          .update({
            status: "failed",
            details: { error: errorMessage },
          })
          .eq("status", "running")
          .eq("sync_type", "reconcile")
          .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
      }
    } catch (logError) {
      console.error("Failed to mark Quo reconcile sync failed:", logError);
    }

    console.error("quo-reconcile-sync error:", errorMessage);
    return jsonResponse(
      {
        success: false,
        error: errorMessage,
      },
      400,
    );
  }
});
