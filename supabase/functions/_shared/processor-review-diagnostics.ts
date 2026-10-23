import { attributeTechnicianReplies, createJobMatcher, isCallOrSystemEvent, type JobIdentity, type JobMessage, type JobPeer } from "./processor-job-status.ts";

export const PROCESSOR_RECENT_AI_MESSAGES = 20;
// Attribution happens first. Review every attributable source, including older
// non-keyword/non-English updates; the handler fails explicitly at its context
// limit instead of silently losing an earlier verified job outcome.
export function selectProcessorAiMessages(attributable: JobMessage[]): JobMessage[] {
  return attributable;
}

/**
 * Attribution counts for one job. A technician text that names the job is
 * explicit; a text that follows this job's saved dispatch in the shared 1:1
 * thread is context-attributed; anything else stays unassigned. Call recordings,
 * transcripts, summaries, media and reactions are never technician replies.
 * No other job's text leaves the server.
 */
export function processorReviewDiagnostics(job: JobIdentity, peers: JobPeer[], messages: JobMessage[], matches = createJobMatcher(job, peers)) {
  const attribution = attributeTechnicianReplies(job, peers, messages, matches);
  const relevant = messages.filter((message) => !isCallOrSystemEvent(message) && typeof message.text === "string" &&
    (matches(message.text) || attribution.contextual.has(message.id)));
  const hasReply = attribution.explicit.size + attribution.contextual.size > 0;
  // A pure dispatch has no technician reply to interpret, so no AI is spent.
  // Otherwise retain every delivered agent message in this job's episode: an
  // update question need not contain an English keyword.
  const extractable = hasReply ? relevant.filter((message) => message.sender === "customer" || (message.sender === "agent" && (message.status === "delivered" || message.source === "call_transcript"))) : [];
  return {
    relevant,
    extractable,
    matched_technician_messages: attribution.explicit.size,
    context_technician_messages: attribution.contextual.size,
    unattributed_technician_messages: attribution.unattributed.size,
    technician_text_messages: messages.filter((m) => attribution.technicianTexts.has(m.id) && m.source !== "call_transcript").length,
    call_event_messages: attribution.callEvents,
    contextual_ids: new Set(attribution.contextual.keys()),
  };
}
