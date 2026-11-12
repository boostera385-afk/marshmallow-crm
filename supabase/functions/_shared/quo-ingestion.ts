import { getQuoMessagePreview, type JsonObject, type NormalizedQuoConversation, type NormalizedQuoMessage } from "./quo-ai.ts";

export interface IngestionClient {
  rpc(name: string, args: { p_input: JsonObject }): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/** One server-only transaction, shared by both webhook endpoints. No replay job. */
export async function ingestQuoMessage(client: IngestionClient, input: {
  eventId: string | null; eventType: string; payload: JsonObject; signatureVerified: boolean;
  message: NormalizedQuoMessage; conversation: NormalizedQuoConversation;
}): Promise<JsonObject> {
  const { data, error } = await client.rpc("ingest_quo_message", { p_input: {
    event_id: input.eventId, event_type: input.eventType, raw_payload: input.payload,
    signature_verified: input.signatureVerified, message: input.message, conversation: input.conversation,
    preview: getQuoMessagePreview(input.message.text, input.message.media),
  } });
  if (error) throw new Error(`Quo ingestion unavailable (${error.code ?? "database_error"})`);
  if (!data || typeof data !== "object" || !("success" in data) || data.success !== true) {
    throw new Error("Quo ingestion returned an invalid acknowledgement");
  }
  return { ...data };
}
