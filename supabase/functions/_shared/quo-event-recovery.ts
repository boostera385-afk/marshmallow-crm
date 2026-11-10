// =============================================================================
// Recovery of Quo webhook events that never finished processing.
//
// During the 2026-11-07 and 2026-11-09 outages the webhook (quo-message-webhook)
// logged each delivery in quo_webhook_events as "processing" and then timed out
// before saving the message. Quo's retries were treated as duplicates, so those
// messages never reached quo_messages. The raw payload is still in the event
// row; this module replays it with the webhook's own steps:
//   phone number upsert -> conversation -> message upsert (on quo_message_id)
//   -> conversation flags -> mark the event processed.
//
// Deliberate differences from the live webhook, because these are OLD events:
//   - An existing conversation is never reopened and its name, status, raw
//     payload and lead link are left as they are. Only its "last message"
//     fields move, and only if the recovered message is newer than what it has.
//   - Every event ends as processed or failed (with the reason); none is left
//     "processing".
//   - Dry run reads only and reports what would happen.
// =============================================================================
import { getQuoMessagePreview, normalizeQuoPayload } from "./quo-ai.ts";

export interface StuckEvent {
  id: string;
  event_type: string | null;
  raw_payload: Record<string, unknown>;
}

export interface ConversationRow {
  id: string;
  linked_lead_id: string | null;
  last_message_at: string | null;
}

/** The few reads and writes recovery needs; implemented over supabase-js below. */
export interface RecoveryStore {
  findConversationIdByMessage(quoMessageId: string): Promise<string | null>;
  findLeadIdByPhone(phone: string): Promise<string | null>;
  getConversation(quoConversationId: string): Promise<ConversationRow | null>;
  messageExists(quoMessageId: string): Promise<boolean>;
  upsertPhoneNumber(row: Record<string, unknown>): Promise<string>;
  insertConversation(row: Record<string, unknown>): Promise<ConversationRow>;
  updateConversation(id: string, patch: Record<string, unknown>): Promise<void>;
  upsertMessage(row: Record<string, unknown>): Promise<string>;
  ensureFlags(conversationId: string): Promise<void>;
  markEvent(id: string, status: "processed" | "failed" | "ignored", note: string): Promise<void>;
}

export type RecoveryOutcome =
  | { result: "recovered"; messageExisted: boolean; conversationCreated: boolean }
  | { result: "ignored"; reason: string }
  | { result: "failed"; reason: string };

export const RECOVERY_NOTE = "Recovered from stored payload after the 2026-11 outage.";

/** Replay one stuck event. With dryRun nothing is written. */
export async function recoverStuckEvent(store: RecoveryStore, event: StuckEvent, dryRun: boolean): Promise<RecoveryOutcome> {
  const eventType = event.event_type ?? "message.received";
  let normalized: ReturnType<typeof normalizeQuoPayload>;
  try {
    normalized = normalizeQuoPayload(event.raw_payload, eventType);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Payload could not be read.";
    if (!dryRun) await store.markEvent(event.id, "ignored", `Recovery: ${reason}`);
    return { result: "ignored", reason };
  }
  const { message, conversation } = normalized;

  try {
    const messageExisted = await store.messageExists(message.id);
    const messageTime = new Date(message.createdAt).toISOString();
    let conversationRowId: string | null = null;
    let conversationCreated = false;

    if (!conversation.id) {
      // Transcript / summary without a conversation id: use the call's own message.
      conversationRowId = await store.findConversationIdByMessage(`${message.id.split(":")[0]}:call.completed`);
    } else {
      const existing = await store.getConversation(conversation.id);
      if (existing) {
        conversationRowId = existing.id;
        const isNewer = new Date(messageTime).getTime() >= (existing.last_message_at ? new Date(existing.last_message_at).getTime() : 0);
        if (isNewer && !dryRun) {
          const patch: Record<string, unknown> = {
            last_message_preview: getQuoMessagePreview(message.text, message.media),
            last_message_time: messageTime,
            last_message_at: messageTime,
            direction: message.direction === "inbound" ? "incoming" : "outgoing",
          };
          if (message.sender === "customer") patch.last_customer_message_at = messageTime;
          if (message.sender === "agent") patch.last_agent_message_at = messageTime;
          await store.updateConversation(existing.id, patch);
        }
      } else {
        conversationCreated = true;
        if (!dryRun) {
          let phoneNumberRowId: string | null = null;
          if (conversation.phoneNumberId) {
            phoneNumberRowId = await store.upsertPhoneNumber({
              quo_phone_number_id: conversation.phoneNumberId,
              number: conversation.phoneNumberDisplay ?? conversation.phoneNumberId,
              display_number: conversation.phoneNumberDisplay,
              name: conversation.phoneNumberName,
              label: conversation.phoneNumberName,
              active: true,
            });
          }
          const leadId = conversation.customerNumber ? await store.findLeadIdByPhone(conversation.customerNumber) : null;
          const created = await store.insertConversation({
            quo_conversation_id: conversation.id,
            customer_name: conversation.customerName,
            customer_number: conversation.customerNumber,
            number_id: phoneNumberRowId,
            linked_lead_id: leadId,
            status: "active",
            current_status: "open",
            raw_payload: event.raw_payload,
            last_message_preview: getQuoMessagePreview(message.text, message.media),
            last_message_time: messageTime,
            last_message_at: messageTime,
            direction: message.direction === "inbound" ? "incoming" : "outgoing",
            ...(message.sender === "customer" ? { last_customer_message_at: messageTime } : {}),
            ...(message.sender === "agent" ? { last_agent_message_at: messageTime } : {}),
          });
          conversationRowId = created.id;
        }
      }
    }

    if (!conversationRowId && !(dryRun && conversationCreated)) {
      const reason = "Could not determine the conversation for this event.";
      if (!dryRun) await store.markEvent(event.id, "failed", `Recovery: ${reason}`);
      return { result: "failed", reason };
    }

    if (!dryRun && conversationRowId) {
      await store.upsertMessage({
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
        raw_payload: event.raw_payload,
      });
      await store.ensureFlags(conversationRowId);
      await store.markEvent(event.id, "processed", RECOVERY_NOTE);
    }
    return { result: "recovered", messageExisted, conversationCreated };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    if (!dryRun) await store.markEvent(event.id, "failed", `Recovery: ${reason}`).catch(() => undefined);
    return { result: "failed", reason };
  }
}

/** Calls events with a conversation id first, so their transcripts/summaries can find them. */
export function recoveryOrder<T extends StuckEvent & { received_at: string }>(events: T[]): T[] {
  const rank = (type: string | null) => (type === "call.transcript.completed" || type === "call.summary.completed" ? 1 : 0);
  return [...events].sort((a, b) => rank(a.event_type) - rank(b.event_type) || a.received_at.localeCompare(b.received_at));
}

type Result = { data: unknown; error: { message: string } | null };
/** The slice of the supabase-js query builder used here (each step returns the builder; awaiting it gives a result). */
interface Query extends PromiseLike<Result> {
  select(columns: string, options?: Record<string, unknown>): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options?: Record<string, unknown>): Query;
  limit(count: number): Query;
  upsert(row: Record<string, unknown>, options?: Record<string, unknown>): Query;
  update(patch: Record<string, unknown>): Query;
  maybeSingle(): PromiseLike<Result>;
  single(): PromiseLike<Result>;
}
type Client = { from(table: string): unknown };
const table = (db: Client, name: string) => db.from(name) as Query;

/** RecoveryStore over a service-role supabase-js client. */
export function supabaseRecoveryStore(db: Client): RecoveryStore {
  const must = (r: Result, what: string) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data;
  };
  return {
    async findConversationIdByMessage(quoMessageId) {
      const data = must(await table(db, "quo_messages").select("conversation_id").eq("quo_message_id", quoMessageId).maybeSingle(), "message lookup");
      return (data as { conversation_id?: string } | null)?.conversation_id ?? null;
    },
    async findLeadIdByPhone(phone) {
      const data = must(await table(db, "leads").select("id").eq("customer_phone", phone).order("created_at", { ascending: false }).limit(1).maybeSingle(), "lead lookup");
      return (data as { id?: string } | null)?.id ?? null;
    },
    async getConversation(quoConversationId) {
      return must(await table(db, "quo_conversations").select("id, linked_lead_id, last_message_at").eq("quo_conversation_id", quoConversationId).maybeSingle(), "conversation lookup") as ConversationRow | null;
    },
    async messageExists(quoMessageId) {
      const data = must(await table(db, "quo_messages").select("id").eq("quo_message_id", quoMessageId).maybeSingle(), "message lookup");
      return Boolean(data);
    },
    async upsertPhoneNumber(row) {
      return (must(await table(db, "quo_phone_numbers").upsert(row, { onConflict: "quo_phone_number_id" }).select("id").single(), "phone number upsert") as { id: string }).id;
    },
    async insertConversation(row) {
      // On conflict (created meanwhile) leave the existing conversation untouched.
      const inserted = must(await table(db, "quo_conversations").upsert(row, { onConflict: "quo_conversation_id", ignoreDuplicates: true }).select("id, linked_lead_id, last_message_at").maybeSingle(), "conversation insert") as ConversationRow | null;
      if (inserted) return inserted;
      const existing = must(await table(db, "quo_conversations").select("id, linked_lead_id, last_message_at").eq("quo_conversation_id", row.quo_conversation_id).single(), "conversation lookup") as ConversationRow;
      return existing;
    },
    async updateConversation(id, patch) {
      must(await table(db, "quo_conversations").update(patch).eq("id", id), "conversation update");
    },
    async upsertMessage(row) {
      return (must(await table(db, "quo_messages").upsert(row, { onConflict: "quo_message_id" }).select("id").single(), "message upsert") as { id: string }).id;
    },
    async ensureFlags(conversationId) {
      must(await table(db, "quo_conversation_flags").upsert({ conversation_id: conversationId }, { onConflict: "conversation_id", ignoreDuplicates: true }), "flags upsert");
    },
    async markEvent(id, status, note) {
      must(await table(db, "quo_webhook_events").update({ processing_status: status, processed_at: new Date().toISOString(), error_message: note }).eq("id", id), "event update");
    },
  };
}
