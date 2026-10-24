/** Shared chat/time helpers for the Processor Board. Never changes leads. */
export type JobMessage = { id: string; conversation_id: string; sender: string; text: string | null; message_time: string | null; status?: string | null; source?: "call_transcript"; source_message_id?: string; call_id?: string };
const CALL_EVENT_TEXT = /^(?:call (?:recording )?completed\.?|call summary(?: completed\.?|:)|call transcript(?: completed\.?|:))/i;
// Quo stores reactions as texts that quote another message: "Liked “…”", "👍 to “…”".
const REACTION_TEXT = /^\s*(?:reacted|liked|loved|laughed at|emphasi[sz]ed|questioned|disliked|le gustó|\S{1,4}\s+to\s+[“"])/i;
/** Quo stores call recordings, transcripts, summaries and reactions as inbound rows. */
export function isCallOrSystemEvent(message: JobMessage): boolean {
  if (typeof message.status === "string" && (message.status.startsWith("call.") || message.status === "no-answer")) return true;
  const text = message.text?.trim() ?? "";
  return !text || CALL_EVENT_TEXT.test(text) || REACTION_TEXT.test(text);
}
export function phoneKey(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 10 ? digits : digits.length === 11 && digits[0] === "1" ? digits.slice(1) : null;
}
export function localDateTime(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const p = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}`;
}
export function schedulePassed(job: { scheduled_date?: string | null; scheduled_time_start?: string | null }, now: Date, timezone: string): boolean {
  return !!job.scheduled_date && !!job.scheduled_time_start && localDateTime(now, timezone) >= `${job.scheduled_date}T${job.scheduled_time_start.length === 5 ? `${job.scheduled_time_start}:00` : job.scheduled_time_start}`;
}
