import { phoneKey, type JobMessage } from "./processor-job-status.ts";

export type StoredProcessorCall = { id: string; quo_message_id: string; conversation_id: string; raw_payload: unknown };
export type ProcessorCallCoverage = { state: "available" | "partial" | "unavailable"; checked: number; missing: number; skipped_segments: number };
const record = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
function object(row: StoredProcessorCall) {
  const payload = record(row.raw_payload);
  const data = record(payload?.data);
  return { type: payload?.type, value: record(data?.object) ?? record(data?.resource) };
}

/** Read saved, structured transcripts only. Flattened text/summary is never speaker proof. */
export function processorCallTranscripts(rows: StoredProcessorCall[], options: { conversationId: string; phoneNumberId: string; technicianPhone: string; since: string; until: string }) {
  const messages: JobMessage[] = [];
  const coverage: ProcessorCallCoverage = { state: "available", checked: 0, missing: 0, skipped_segments: 0 };
  const phone = phoneKey(options.technicianPhone);
  const calls = new Map<string, { start: number; end: number; answered: boolean; storedConversationId: string }>();
  const transcripts = new Map<string, StoredProcessorCall>();
  for (const row of rows) {
    const { type, value } = object(row);
    if (!value) continue;
    if (type === "call.completed" && typeof value.id === "string" && row.quo_message_id === `${value.id}:call.completed`) {
      const participants = [value.from, ...(Array.isArray(value.to) ? value.to : [])].filter((v): v is string => typeof v === "string");
      const start = Date.parse(String(value.createdAt ?? ""));
      const end = Date.parse(String(value.completedAt ?? ""));
      if (!phone || !participants.some((v) => phoneKey(v) === phone) || value.conversationId !== options.conversationId || value.phoneNumberId !== options.phoneNumberId || !Number.isFinite(start) || !Number.isFinite(end) || end < start || start < Date.parse(options.since) || end > Date.parse(options.until)) continue;
      const answeredAt = typeof value.answeredAt === "string" ? Date.parse(value.answeredAt) : NaN;
      calls.set(value.id, { start, end, answered: Number.isFinite(answeredAt) && answeredAt >= start && answeredAt <= end, storedConversationId: row.conversation_id });
    } else if (type === "call.transcript.completed" && typeof value.callId === "string" && row.quo_message_id === `${value.callId}:call.transcript.completed`) {
      // Replayed events for one call must never duplicate evidence.
      transcripts.set(value.callId, row);
    }
  }
  for (const [callId, call] of calls) {
    if (!call.answered) continue;
    // Answered calls prevent a false non-response finding even without a usable transcript.
    messages.push({ id: `call:${callId}`, conversation_id: options.conversationId, sender: "customer", text: null, message_time: new Date(call.end).toISOString(), status: "call.completed" });
    const row = transcripts.get(callId);
    const value = row ? object(row).value : null;
    const dialogue = value?.dialogue;
    if (!row || row.conversation_id !== call.storedConversationId || value?.status !== "completed" || !Array.isArray(dialogue) || !dialogue.length) { coverage.missing++; continue; }
    coverage.checked++;
    let previous: JobMessage | null = null;
    let lastStart = -1;
    for (const [index, raw] of dialogue.entries()) {
      const part = record(raw);
      const start = part?.start;
      const end = part?.end;
      const valid = part && typeof part.content === "string" && part.content.trim() && typeof start === "number" && Number.isFinite(start) && start >= 0 && start >= lastStart && typeof end === "number" && Number.isFinite(end) && end >= start && call.start + end * 1000 <= call.end + 1000;
      if (typeof start === "number" && Number.isFinite(start)) lastStart = Math.max(lastStart, start);
      const sender = valid && typeof part.userId === "string" && /^US/.test(part.userId) ? "agent"
        : valid && part.userId === null && typeof part.identifier === "string" && phoneKey(part.identifier) === phone ? "customer" : "unknown";
      if (!valid || sender === "unknown") coverage.skipped_segments++;
      if (sender !== "unknown" && previous?.sender === sender) {
        previous.text += `\n${part!.content}`;
        continue;
      }
      previous = { id: `transcript:${row.id}:${index}`, conversation_id: `${options.conversationId}:call:${callId}`, sender,
        text: sender === "unknown" ? null : String(part!.content), message_time: new Date(call.start + (valid && typeof start === "number" ? start * 1000 : 0)).toISOString(), status: "transcript.verified",
        source: "call_transcript", source_message_id: row.id, call_id: callId };
      messages.push(previous);
    }
  }
  // A transcript lacking the original call cannot establish the appointment date or line.
  coverage.missing += [...transcripts.keys()].filter((id) => !calls.has(id)).length;
  if (coverage.missing || coverage.skipped_segments) coverage.state = "partial";
  return { messages, coverage };
}
