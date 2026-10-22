import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { phoneKey } from "../../supabase/functions/_shared/processor-job-status";

export interface QuoChatMedia {
  type?: string | null;
  mime_type?: string | null;
  url?: string;
  src?: string;
}

type TranscriptEntry = { content?: unknown; text?: unknown; userId?: unknown; user?: unknown };
type TranscriptFields = { transcript?: unknown; transcriptText?: unknown; voicemailTranscript?: unknown };
type TranscriptPayload = { data?: TranscriptFields & { call?: TranscriptFields; message?: TranscriptFields } };

export interface QuoChatMessage {
  id: string;
  to: string[];
  from: string;
  text: string;
  phoneNumberId: string;
  conversationId?: string | null;
  direction: "incoming" | "outgoing";
  userId?: string | null;
  status?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  media?: QuoChatMedia[];
}

export interface QuoChatThreadResponse {
  contact: {
    participant: string;
  };
  phoneNumber: {
    id: string;
    number: string;
    formattedNumber: string;
    name?: string | null;
  };
  conversation?: {
    databaseId: string;
    id: string;
    phoneNumberId: string;
    participants: string[];
    assignedTo?: string | null;
    name?: string | null;
    updatedAt?: string | null;
    lastActivityAt?: string | null;
    current_status?: string | null;
    status?: string | null;
  } | null;
  messages: QuoChatMessage[];
}

function lastTen(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

import { isTechLineNumber, TECH_COMMUNICATIONS_NUMBER } from "@/lib/quo-dashboard";

/**
 * Reads the conversation stored by the Quo webhook (no Quo API calls).
 */
export function extractTranscriptFromPayload(payload: unknown): string | null {
  if (!payload || !(payload as TranscriptPayload).data) return null;
  const data = (payload as TranscriptPayload).data;
  const call = data.call || {};
  const msg = data.message || {};

  const extract = (value: unknown): string | null => {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      const extracted = value.map((v: TranscriptEntry | string | number | boolean | null) => {
        if (typeof v === "object" && v !== null) {
          if (typeof v.content === "string") {
            const speaker = v.userId ? "Agent" : "Customer";
            return `${speaker}: ${v.content}`;
          }
          if (typeof v.text === "string") {
            const speaker = v.user || v.userId ? "Agent" : "Customer";
            return `${speaker}: ${v.text}`;
          }
          // If we can't find content or text, just stringify it so it doesn't show as empty
          return JSON.stringify(v);
        }
        return String(v);
      }).filter(Boolean).join("\n");
      return extracted || null;
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return null;
  };

  return extract(call.transcript) || 
         extract(call.transcriptText) || 
         extract(data.transcript) || 
         extract(call.voicemailTranscript) || 
         extract(data.voicemailTranscript) ||
         extract(msg.transcript) ||
         extract(msg.voicemailTranscript);
}

export async function fetchQuoChatThread(participant: string, chatType?: "customer" | "tech", conversationId?: string): Promise<QuoChatThreadResponse> {
  const digits = lastTen(participant);
  if (conversationId && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId) || !phoneKey(participant))) {
    throw new Error("The saved CRM chat identity is invalid. Refresh the board; no conversation was guessed.");
  }
  const query = supabase
    .from("quo_conversations")
    .select(
      "id, quo_conversation_id, customer_name, customer_number, number_id, last_message_time, updated_at, quo_phone_numbers(id, quo_phone_number_id, number, display_number, name, label)",
    );
  // Processor Board pins its verified CRM UUID. Never substitute a newer chat,
  // another participant, or a customer line if that saved conversation disappears.
  const { data: conversations, error: conversationError } = conversationId
    ? await query.eq("id", conversationId).limit(1)
    : await query.or(`customer_number.eq.${participant},customer_number.ilike.%${digits}`)
      .order("last_message_time", { ascending: false, nullsFirst: false }).limit(10);

  if (conversationError) {
    throw new Error(conversationError.message || "Failed to load Quo chat");
  }

  let conversation = null;
  if (conversationId) {
    const saved = conversations?.[0];
    const line = saved?.quo_phone_numbers;
    if (!saved || saved.id !== conversationId || phoneKey(saved.customer_number) !== phoneKey(participant) ||
      (chatType === "tech" && phoneKey(line?.number || line?.display_number || null) !== phoneKey(TECH_COMMUNICATIONS_NUMBER))) {
      throw new Error("The verified technician chat is not available in your CRM scope or no longer matches this technician and line. Refresh or verify saved chat setup.");
    }
    conversation = saved;
  } else if (conversations && conversations.length > 0) {
    if (chatType === "tech") {
      conversation = conversations.find((c) => {
        const numRow = c.quo_phone_numbers;
        return isTechLineNumber(numRow?.number || numRow?.display_number || numRow?.name);
      }) ?? null;
    } else if (chatType === "customer") {
      conversation = conversations.find((c) => {
        const numRow = c.quo_phone_numbers;
        return !isTechLineNumber(numRow?.number || numRow?.display_number || numRow?.name);
      }) ?? null;
    }
    if (!conversation) {
      conversation = conversations[0];
    }
  }

  const numberRow = (conversation as unknown as {
    quo_phone_numbers?: {
      id: string;
      quo_phone_number_id: string;
      number: string;
      display_number: string | null;
      name: string | null;
      label: string | null;
    } | null;
  } | null)?.quo_phone_numbers ?? null;

  const messages: QuoChatMessage[] = [];

  if (conversation) {
    const pageSize = 500;
    // Existing general Quick Chat keeps its current viewport. A pinned board
    // review reads every page, rather than silently hiding replies after row 500.
    for (let offset = 0; ; offset += pageSize) {
      const { data: rows, error: messageError } = await supabase
        .from("quo_messages")
        .select("id, sender, recipients, text, direction, status, message_time, quo_created_at, created_at, conversation_id, media, raw_payload")
        .eq("conversation_id", conversation.id)
        .order("message_time", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (messageError || (conversationId && !rows)) {
        throw new Error(messageError?.message || "Failed to load Quo messages");
      }

      if (conversationId && offset + (rows?.length ?? 0) > 10000) throw new Error("This saved chat exceeds the safe review limit. No partial conversation was displayed; ask Admin to review history.");
      messages.push(...(rows ?? []).map<QuoChatMessage>((row) => ({
        id: row.id,
        to: Array.isArray(row.recipients) ? (row.recipients as unknown[]).map((entry) => String(entry)) : [],
        from: row.sender ?? "",
        text: row.text || extractTranscriptFromPayload(row.raw_payload) || "",
        phoneNumberId: numberRow?.quo_phone_number_id ?? "",
        conversationId: row.conversation_id,
        direction: row.direction === "outgoing" ? "outgoing" : "incoming",
        status: row.status,
        createdAt: row.message_time ?? row.quo_created_at ?? row.created_at,
        media: Array.isArray(row.media) ? (row.media as unknown as QuoChatMedia[]) : [],
      })));
      if (!conversationId || (rows?.length ?? 0) < pageSize) break;
    }
  }

  const queued: QuoChatMessage[] = [];

  return {
    contact: { participant },
    phoneNumber: {
      id: numberRow?.quo_phone_number_id ?? "",
      number: numberRow?.number ?? (chatType === "tech" ? TECH_COMMUNICATIONS_NUMBER : ""),
      formattedNumber: numberRow?.display_number ?? numberRow?.number ?? (chatType === "tech" ? "(747) 588-7812" : ""),
      name: numberRow?.name ?? numberRow?.label ?? (chatType === "tech" ? "Technicians Communications (NEW)" : null),
    },
    conversation: conversation
      ? {
          databaseId: conversation.id,
          id: conversation.quo_conversation_id,
          phoneNumberId: numberRow?.quo_phone_number_id ?? "",
          participants: [conversation.customer_number ?? participant],
          name: conversation.customer_name,
          updatedAt: conversation.updated_at,
          lastActivityAt: conversation.last_message_time,
        }
      : null,
    messages: [...messages, ...queued],
  };
}

/**
 * Queues an outbound message. The CRM browser extension picks it up and sends it through Quo.
 */
export async function sendQuoChatMessage(participant: string, content: string, chatType?: "customer" | "tech") {
  const { data: auth } = await supabase.auth.getUser();

  const insertData: TablesInsert<"quo_outbound_messages"> = {
    to_number: participant,
    body: content,
    created_by: auth.user?.id ?? null,
  };

  if (chatType === "tech") {
    insertData.phone_number_id = TECH_COMMUNICATIONS_NUMBER;
  }

  const { data, error } = await supabase
    .from("quo_outbound_messages")
    .insert(insertData)
    .select("id, to_number, body, status, created_at")
    .single();

  if (error) {
    throw new Error(error.message || "Failed to queue Quo message");
  }

  const message: QuoChatMessage = {
    id: `outbound-${data.id}`,
    to: [data.to_number],
    from: "",
    text: data.body,
    phoneNumberId: "",
    direction: "outgoing",
    status: data.status,
    createdAt: data.created_at,
  };

  return { message };
}
