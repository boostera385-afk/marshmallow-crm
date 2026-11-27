/**
 * A tech's saved Quo chat for one job (get_lead_tech_chat, migration 20261127085859): text
 * messages plus call events. Pure helpers, shared by the chat dialog and its tests.
 */

export interface TechChatRow {
  id: string;
  /** "agent" = our team; anything else is the tech. */
  sender: string;
  kind: "text" | "call";
  text: string | null;
  message_time: string | null;
  has_media: boolean;
}

export type TechChatItem =
  | { type: "text"; id: string; fromUs: boolean; text: string; at: string | null; hasMedia: boolean }
  | { type: "call"; id: string; fromUs: boolean; label: string; detail: string | null; at: string | null };

/** Bookkeeping events Quo sends for every call; they add nothing to the conversation. */
const CALL_NOISE = /^call (recording|summary) completed\.?$/i;

export function parseTechChat(data: unknown): TechChatRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string") return [];
    return [{
      id: row.id,
      sender: typeof row.sender === "string" ? row.sender : "customer",
      kind: row.kind === "call" ? "call" : "text",
      text: typeof row.text === "string" ? row.text : null,
      message_time: typeof row.message_time === "string" ? row.message_time : null,
      has_media: row.has_media === true,
    } satisfies TechChatRow];
  });
}

/** Rows to display, oldest first: text bubbles and one line per meaningful call event. */
export function techChatItems(rows: TechChatRow[]): TechChatItem[] {
  return rows.flatMap((row): TechChatItem[] => {
    const fromUs = row.sender === "agent";
    const text = (row.text ?? "").trim();
    if (row.kind === "call") {
      if (!text || CALL_NOISE.test(text)) return [];
      const transcript = /^call transcript:\s*/i.exec(text);
      return [{
        type: "call",
        id: row.id,
        fromUs,
        label: transcript ? "Call transcript" : text.replace(/\.$/, ""),
        detail: transcript ? text.slice(transcript[0].length) : null,
        at: row.message_time,
      }];
    }
    if (!text && !row.has_media) return [];
    return [{ type: "text", id: row.id, fromUs, text, at: row.message_time, hasMedia: row.has_media }];
  });
}

/** The message the AI quoted, so the dialog can point at it. */
export function isEvidenceMessage(item: TechChatItem, quote: string | null | undefined): boolean {
  if (item.type !== "text" || item.fromUs || !quote) return false;
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const needle = norm(quote);
  return needle.length >= 2 && norm(item.text).includes(needle);
}
