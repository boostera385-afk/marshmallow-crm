import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  getQuoMessagePreview,
  isProcessableQuoWebhookEvent,
  jsonResponse,
  normalizeQuoContactPayload,
  normalizeQuoPayload,
  verifySignature,
} from "../_shared/quo-ai.ts";

async function isIngestionPaused(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from("quo_ai_settings")
    .select("value")
    .eq("key", "quo_webhook_ingestion_paused")
    .maybeSingle();

  if (error) {
    console.error("Could not read Quo webhook pause setting:", error.message);
    return false;
  }

  return data?.value === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey =
    Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing Supabase service configuration." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const rawBody = await req.text();
  const payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
  const webhookSecret = Deno.env.get("QUO_WEBHOOK_SECRET") ?? Deno.env.get("QUO_WEBHOOK_TOKEN") ?? undefined;
  const enforceSignature = Deno.env.get("QUO_ENFORCE_SIGNATURE") === "true" || Deno.env.get("QUO_STRICT_SIGNATURE") === "true";
  const signature =
    req.headers.get("openphone-signature") ??
    req.headers.get("x-openphone-signature") ??
    req.headers.get("x-quo-signature") ??
    req.headers.get("x-signature");
  const signatureVerified = await verifySignature(rawBody, signature, webhookSecret);

  if (webhookSecret && !signatureVerified && enforceSignature) {
    return jsonResponse({ error: "Invalid webhook signature" }, 401);
  }

  const eventType =
    typeof payload.type === "string"
      ? payload.type
      : typeof payload.event_type === "string"
        ? payload.event_type
        : typeof payload.eventType === "string"
          ? payload.eventType
          : "message.received";
  const eventId =
    typeof payload.id === "string"
      ? payload.id
      : typeof payload.event_id === "string"
        ? payload.event_id
        : typeof payload.eventId === "string"
          ? payload.eventId
          : null;
  const isProcessableEvent = isProcessableQuoWebhookEvent(eventType);

  let webhookEventId: string | null = null;

  try {
    if (await isIngestionPaused(supabase)) {
      await supabase
        .from("quo_webhook_events")
        .upsert(
          {
            quo_event_id: eventId,
            event_type: eventType,
            raw_payload: payload,
            processing_status: "ignored",
            signature_verified: signatureVerified,
            processed_at: new Date().toISOString(),
            error_message: "Quo Monitor ingestion is paused by an admin testing switch.",
          },
          {
            onConflict: eventId ? "quo_event_id" : "quo_message_id,event_type",
            ignoreDuplicates: true,
          },
        );

      return jsonResponse({
        success: true,
        ignored: true,
        paused: true,
        event_type: eventType,
        reason: "Quo Monitor ingestion is paused.",
      });
    }

    if (eventType === "contact.updated") {
      const contact = normalizeQuoContactPayload(payload);
      let updatedConversations = 0;

      if (contact.name && contact.phoneNumbers.length > 0) {
        const { data: updatedRows, error: updateError } = await supabase
          .from("quo_conversations")
          .update({ customer_name: contact.name, raw_payload: payload })
          .in("customer_number", contact.phoneNumbers)
          .select("id");

        if (updateError) throw updateError;
        updatedConversations = updatedRows?.length ?? 0;
      }

      await supabase
        .from("quo_webhook_events")
        .upsert(
          {
            quo_event_id: eventId,
            event_type: eventType,
            raw_payload: payload,
            processing_status: "processed",
            signature_verified: signatureVerified,
            processed_at: new Date().toISOString(),
            error_message: updatedConversations
              ? `Updated contact name on ${updatedConversations} existing Quo conversation(s).`
              : "Contact update accepted; no matching stored conversation found.",
          },
          {
            onConflict: eventId ? "quo_event_id" : "quo_message_id,event_type",
            ignoreDuplicates: true,
          },
        );

      return jsonResponse({
        success: true,
        event_type: eventType,
        updated_conversations: updatedConversations,
      });
    }

    if (!isProcessableEvent) {
      await supabase
        .from("quo_webhook_events")
        .upsert(
          {
            quo_event_id: eventId,
            event_type: eventType,
            raw_payload: payload,
            processing_status: "ignored",
            signature_verified: signatureVerified,
            processed_at: new Date().toISOString(),
            error_message: "Quo event logged but not processed by CRM webhook.",
          },
          {
            onConflict: eventId ? "quo_event_id" : "quo_message_id,event_type",
            ignoreDuplicates: true,
          },
        );

      return jsonResponse({
        success: true,
        ignored: true,
        event_type: eventType,
        reason: "This event does not update Quo AI conversations.",
      });
    }

    let normalizedPayload: ReturnType<typeof normalizeQuoPayload>;
    try {
      normalizedPayload = normalizeQuoPayload(payload, eventType);
    } catch (error) {
      await supabase
        .from("quo_webhook_events")
        .upsert(
          {
            quo_event_id: eventId,
            event_type: eventType,
            raw_payload: payload,
            processing_status: "ignored",
            signature_verified: signatureVerified,
            processed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : "Quo event did not include a processable payload.",
          },
          {
            onConflict: eventId ? "quo_event_id" : "quo_message_id,event_type",
            ignoreDuplicates: true,
          },
        );

      return jsonResponse({
        success: true,
        ignored: true,
        event_type: eventType,
        reason: "Quo event did not include a processable payload.",
      });
    }

    const { message, conversation } = normalizedPayload;

    const { data: eventData, error: eventError } = await supabase
      .from("quo_webhook_events")
      .upsert(
        {
          quo_event_id: eventId,
          event_type: eventType,
          quo_message_id: message.id,
          quo_conversation_id: conversation.id,
          quo_phone_number_id: conversation.phoneNumberId,
          raw_payload: payload,
          processing_status: "processing",
          signature_verified: signatureVerified,
        },
        {
          onConflict: eventId ? "quo_event_id" : "quo_message_id,event_type",
          ignoreDuplicates: true,
        },
      )
      .select("id")
      .maybeSingle();

    if (eventError) throw eventError;
    webhookEventId = eventData?.id ?? null;

    if (!eventData) {
      return jsonResponse({
        success: true,
        ignored: true,
        duplicate: true,
        event_type: eventType,
        quo_message_id: message.id,
      });
    }

    let conversationRowId = null;
    const existingLead = { id: null };

    if (!conversation.id && message.id) {
      // For transcript/summary events, we might not have the conversation ID in the payload.
      // We can look it up from the original call message.
      const originalMessageId = message.id.split(':')[0] + ':call.completed';
      const { data: existingMsg } = await supabase
        .from("quo_messages")
        .select("conversation_id")
        .eq("quo_message_id", originalMessageId)
        .single();
        
      if (existingMsg?.conversation_id) {
        conversationRowId = existingMsg.conversation_id;
        // Also look up the conversation to get the linked lead
        const { data: convData } = await supabase
          .from("quo_conversations")
          .select("linked_lead_id")
          .eq("id", conversationRowId)
          .single();
        if (convData) existingLead.id = convData.linked_lead_id;
      }
    }

    let phoneNumberRowId: string | null = null;
    if (conversation.phoneNumberId) {
      const { data: phoneRow, error: phoneError } = await supabase
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

      if (phoneError) throw phoneError;
      phoneNumberRowId = phoneRow.id;
    }

    const messageTime = new Date(message.createdAt).toISOString();

    if (conversation.id) {
      const { data: dbLead } = conversation.customerNumber
        ? await supabase
            .from("leads")
            .select("id")
            .eq("customer_phone", conversation.customerNumber)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null };
      if (dbLead) existingLead.id = dbLead.id;

      // Preserve any previously-set linked_lead_id so re-upserts don't wipe manual/AI links.
      const { data: existingConversation } = await supabase
        .from("quo_conversations")
        .select("linked_lead_id, last_message_at")
        .eq("quo_conversation_id", conversation.id)
        .maybeSingle();

      const preservedLinkedLeadId =
        existingLead?.id ?? existingConversation?.linked_lead_id ?? null;

      const existingLastAt = existingConversation?.last_message_at
        ? new Date(existingConversation.last_message_at).getTime()
        : 0;
      const isNewer = new Date(messageTime).getTime() >= existingLastAt;

      const conversationUpsert: Record<string, unknown> = {
        quo_conversation_id: conversation.id,
        customer_name: conversation.customerName,
        customer_number: conversation.customerNumber,
        number_id: phoneNumberRowId,
        linked_lead_id: preservedLinkedLeadId,
        status: "active",
        current_status: "open",
        raw_payload: payload,
      };

      // Only overwrite "last message" fields when this event is actually the newest one seen.
      if (isNewer) {
        conversationUpsert.last_message_preview = getQuoMessagePreview(message.text, message.media);
        conversationUpsert.last_message_time = messageTime;
        conversationUpsert.last_message_at = messageTime;
        conversationUpsert.direction = message.direction === "inbound" ? "incoming" : "outgoing";
        if (message.sender === "customer") conversationUpsert.last_customer_message_at = messageTime;
        if (message.sender === "agent") conversationUpsert.last_agent_message_at = messageTime;
      }

      const { data: conversationRow, error: conversationError } = await supabase
        .from("quo_conversations")
        .upsert(conversationUpsert, { onConflict: "quo_conversation_id" })
        .select("id, linked_lead_id")
        .single();

      if (conversationError) throw conversationError;
      conversationRowId = conversationRow.id;
      existingLead.id = existingLead?.id ?? conversationRow.linked_lead_id ?? null;
    }

    if (!conversationRowId) {
      throw new Error("Could not determine conversation_id for message.");
    }

    const { data: messageRow, error: messageError } = await supabase
      .from("quo_messages")
      .upsert(
        {
          quo_message_id: message.id,
          conversation_id: conversationRowId,
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

    if (messageError) throw messageError;

    await supabase.from("quo_conversation_flags").upsert(
      { conversation_id: conversationRowId },
      { onConflict: "conversation_id", ignoreDuplicates: true },
    );

    if (webhookEventId) {
      await supabase
        .from("quo_webhook_events")
        .update({ processing_status: "processed", processed_at: new Date().toISOString() })
        .eq("id", webhookEventId);
    }

    return jsonResponse({
      success: true,
      conversation_id: conversationRowId,
      message_id: messageRow.id,
      linked_lead_id: existingLead?.id ?? null,
    });

  } catch (error) {
    if (webhookEventId) {
      await supabase
        .from("quo_webhook_events")
        .update({
          processing_status: "failed",
          error_message: error instanceof Error ? error.message : "Unknown webhook error",
          processed_at: new Date().toISOString(),
        })
        .eq("id", webhookEventId);
    }

    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown webhook error",
      },
      400,
    );
  }
});
