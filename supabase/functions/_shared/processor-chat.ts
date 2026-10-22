import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneKey } from "./processor-job-status.ts";
import { parseTechnicianQuoLink } from "./technician-quo-link.ts";
import { ProcessorReviewError } from "./processor-review.ts";

// Same saved Technician Communications line used by CRM Tech Quick Chat/photos.
const TECH_LINE = "7475887812";
type DirectoryRow = { phone_number: string | null; chat_link: string | null };
export type ProcessorMirror = {
  id: string; customer_number: string | null; quo_conversation_id: string;
  last_message_time: string | null;
  quo_phone_numbers: { quo_phone_number_id: string; number: string; display_number: string | null } | null;
};
export type ProcessorChatSetup = {
  state: "ready" | "blocked" | "unavailable"; code: string; message: string;
  fingerprint: string; conversation_id: string | null; last_message_at: string | null;
  source: "saved_link" | "verified_mirror" | null;
};
export type ProcessorChat = {
  setup: ProcessorChatSetup;
  link: { phoneNumberId: string; conversationId: string; chatLink: string } | null;
  mirror: ProcessorMirror | null;
};
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
function parseMirror(value: unknown): ProcessorMirror {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.quo_conversation_id !== "string" || !(typeof value.customer_number === "string" || value.customer_number === null) || !(typeof value.last_message_time === "string" || value.last_message_time === null)) throw new ProcessorReviewError("Saved conversation metadata is invalid. Ask Admin to verify chat setup.", "chat_lookup", true);
  const raw = value.quo_phone_numbers;
  if (Array.isArray(raw) && raw.length > 1) throw new ProcessorReviewError("Saved conversation has conflicting phone-line metadata. No chat was guessed.", "chat_lookup", false, 422);
  const line = Array.isArray(raw) ? raw[0] ?? null : raw;
  if (line !== null && (!isRecord(line) || typeof line.quo_phone_number_id !== "string" || typeof line.number !== "string" || !(typeof line.display_number === "string" || line.display_number === null))) throw new ProcessorReviewError("Saved phone-line metadata is unavailable. Ask Admin to verify chat setup.", "chat_lookup", true);
  return { id: value.id, customer_number: typeof value.customer_number === "string" ? value.customer_number : null, quo_conversation_id: value.quo_conversation_id, last_message_time: typeof value.last_message_time === "string" ? value.last_message_time : null,
    quo_phone_numbers: line === null ? null : { quo_phone_number_id: line.quo_phone_number_id, number: line.number, display_number: line.display_number } };
}

/** Complete caller-scoped reads; a cap is an error, never a partial identity match. */
export async function readProcessorRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max = 10000): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from <= max; from += 500) {
    const { data, error } = await query(from, from + 499);
    if (error || !data) throw new ProcessorReviewError("Saved technician/chat setup could not be read. Retry after reconnecting.", "chat_lookup", true);
    rows.push(...data);
    if (rows.length > max) throw new ProcessorReviewError("Saved chat lookup exceeds the safe limit. No conversation was guessed; ask Admin to review setup.", "chat_limit", false, 422);
    if (data.length < 500) return rows;
  }
  throw new ProcessorReviewError("Saved chat lookup is incomplete. Retry; no conversation was guessed.", "chat_lookup", true);
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Exact participant + saved line/conversation only. Never select the newest/name match. */
export async function resolveProcessorChat(phone: string, directory: DirectoryRow[], mirrors: ProcessorMirror[], directConfigured: boolean): Promise<ProcessorChat> {
  const entries = directory.filter((row) => phoneKey(row.phone_number) === phone);
  const saved = entries.map((row) => row.chat_link?.trim()).filter((link): link is string => Boolean(link));
  const parsed = saved.map(parseTechnicianQuoLink);
  const links = [...new Map(parsed.flatMap((link) => link ? [[`${link.phoneNumberId}:${link.conversationId}`, link] as const] : [])).values()];
  const relevantMirrors = mirrors.filter((row) => phoneKey(row.customer_number) === phone || links.some((link) => link.conversationId === row.quo_conversation_id));
  const revision = await fingerprint([phone, directConfigured, [...saved].sort(), relevantMirrors.map((m) => [m.id, m.customer_number, m.quo_conversation_id, m.quo_phone_numbers, m.last_message_time]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
  const blocked = (code: string, message: string): ProcessorChat => ({ setup: { state: "blocked", code, message, fingerprint: revision, conversation_id: null, last_message_at: null, source: null }, link: null, mirror: null });
  if (parsed.some((link) => !link)) return blocked("invalid_chat_link", "The technician directory has an invalid saved Quo link. Correct it; no chat was guessed.");
  if (links.length > 1) return blocked("ambiguous_chat", "Conflicting saved technician Quo chats match this number. Verify the directory links before reviewing.");
  let link = links[0];
  let mirror: ProcessorMirror | undefined;
  let source: ProcessorChatSetup["source"] = "saved_link";
  if (link) {
    const matches = mirrors.filter((row) => row.quo_conversation_id === link.conversationId);
    if (matches.length > 1) return blocked("ambiguous_chat", "Several saved conversations share this technician chat ID. Ask Admin to verify setup.");
    mirror = matches[0];
    if (mirror && (phoneKey(mirror.customer_number) !== phone || (mirror.quo_phone_numbers && mirror.quo_phone_numbers.quo_phone_number_id !== link.phoneNumberId))) return blocked("chat_identity", "The saved chat participant or phone line does not match this job's technician. Verify the saved link.");
    if (!mirror && !directConfigured) return blocked("missing_mirror", "The saved technician chat is not mirrored and current Quo access is unavailable. Sync the chat or ask Admin to check Quo setup.");
  } else {
    const candidates = relevantMirrors.filter((row) => phoneKey(row.customer_number) === phone &&
      phoneKey(row.quo_phone_numbers?.number || row.quo_phone_numbers?.display_number || null) === TECH_LINE &&
      /^CN[A-Za-z0-9_-]{6,}$/.test(row.quo_conversation_id) && /^PN[A-Za-z0-9_-]{6,}$/.test(row.quo_phone_numbers?.quo_phone_number_id ?? ""));
    if (candidates.length > 1) return blocked("ambiguous_chat", "Multiple exact-number chats exist on the Technician Communications line. Verify which saved conversation belongs to this technician.");
    mirror = candidates[0];
    if (!mirror) return blocked(entries.length ? "missing_chat_link" : "missing_directory", entries.length
      ? "No saved Quo link or unique exact-number chat on the Technician Communications line. Save the verified chat in the technician directory."
      : "No technician directory match or unique exact-number chat on the Technician Communications line. Verify the saved technician number and chat.");
    link = { phoneNumberId: mirror.quo_phone_numbers!.quo_phone_number_id, conversationId: mirror.quo_conversation_id };
    source = "verified_mirror";
  }
  const chatLink = `https://my.quo.com/inbox/${link.phoneNumberId}/c/${link.conversationId}`;
  return { setup: { state: "ready", code: "ready", message: source === "verified_mirror" ? "Exact technician number and saved Technician Communications conversation verified." : "Saved technician Quo link verified.", fingerprint: revision,
    conversation_id: mirror?.id ?? null, last_message_at: mirror?.last_message_time ?? null, source }, link: { ...link, chatLink }, mirror: mirror ?? null };
}

/** Two batched reads per loaded page, not one directory/conversation lookup per row. */
export async function readProcessorChats(caller: SupabaseClient, phones: string[], directConfigured: boolean): Promise<Map<string, ProcessorChat>> {
  const unique = [...new Set(phones)];
  if (!unique.length) return new Map();
  const suffixes = [...new Set(unique.map((phone) => phone.slice(-4)))];
  const directory = await readProcessorRows<DirectoryRow>((from, to) => caller.from("technicians").select("phone_number,chat_link")
    .or(suffixes.map((suffix) => `phone_number.ilike.%${suffix}%`).join(",")).order("id").range(from, to));
  const savedIds = [...new Set(directory.filter((row) => unique.includes(phoneKey(row.phone_number) ?? "")).flatMap((row) => {
    const parsed = parseTechnicianQuoLink(row.chat_link); return parsed ? [parsed.conversationId] : [];
  }))];
  const rawMirrors = await readProcessorRows<unknown>((from, to) => caller.from("quo_conversations")
    .select("id,customer_number,quo_conversation_id,last_message_time,quo_phone_numbers(quo_phone_number_id,number,display_number)")
    .or([...suffixes.map((suffix) => `customer_number.ilike.%${suffix}%`), ...savedIds.map((id) => `quo_conversation_id.eq.${id}`)].join(","))
    .order("id").range(from, to));
  const mirrors = rawMirrors.map(parseMirror);
  return new Map(await Promise.all(unique.map(async (phone) => [phone, await resolveProcessorChat(phone, directory, mirrors, directConfigured)] as const)));
}
