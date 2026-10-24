import { phoneKey } from "./processor-job-status.ts";
import { SHARE_STATES, type LeadWindowJob, type ProcessorEvidence, type ProcessorFacts, type PromptMessage, type ShareState } from "./processor-lead-window.ts";

/**
 * Rule-based job timeline from the technician chat, built from how the team
 * actually works (measured on 1,079 exported technician chats):
 *   offer -> full customer details (tagged "*Customer # N*") -> "confirm if you
 *   received complete customer details?" -> tech "Yes/Ok" (took the job) ->
 *   automated visit reminder -> update request -> tech "Done" -> share request
 *   ("Active Zelle ... send our shares") -> tech "sent" -> "we received the payment".
 * Rules read texts only and stay conservative: a message counts for this job
 * only when it names this job, or no other job's details were sent before it in
 * the window. Calls and free-form replies are left to AI.
 */
export type TimelineEvent = { at: string; message_id: string; quote: string };
export type JobTimeline = {
  job_tag: string | null;
  details: TimelineEvent | null;
  took_job: TimelineEvent | null;
  visit_confirmed: TimelineEvent | null;
  update_requested: TimelineEvent | null;
  completed: (TimelineEvent & { by: "technician" | "share_request" }) | null;
  share_requested: TimelineEvent | null;
  share_promised: TimelineEvent | null;
  share_sent: TimelineEvent | null;
  share_received: TimelineEvent | null;
  share_state: ShareState;
  /** Another job's details appeared in this window: later generic replies are not attributed. */
  other_jobs_in_window: boolean;
};

const TAG = /\*\s*Customer\s*#?\s*-?\s*(\d{1,4})\s*\*/gi;
const DETAILS = /customer\s*name[\s\S]*customer\s*(?:number|phone)/i;
const CONFIRM_PROMPT = /confirm if you received|received (the )?complete customer details/i;
const REMINDER = /automated reminder/i;
const UPDATE_REQUEST = /in progress or completed|update (?:me )?(?:about|on) the job|what'?s (?:an |the )?update|any update/i;
const SHARE_REQUEST = /active zelle|send (?:our|the) shares?|our shares|zelle (?:name|email)|cash ?app name|venmo name|did you sen[dt] (?:our|the) (?:shares?|payment)|send (?:the|our) payment/i;
const SHARE_RECEIVED = /\b(?:we|i)(?:'ve| have)? received (?:the |your )?(?:payment|shares?|amount)/i;
const ACCEPT = /^\s*(?:yes|yeah|yep|yup|ok(?:ay)?|k|got it|received|confirm(?:ed)?|sounds good|agree[d]?|sure|👍)(?:[\s,.!]|\p{Emoji_Modifier}|👍|$)/iu;
const VISIT_ACK = /^\s*(?:yes|yeah|yep|ok(?:ay)?|sure|on my way|omw|heading)(?:[\s,.!]|$)/i;
// Reactions quote another message ("Liked “…”", "👍 to “…”"): never a reply of their own.
export const REACTION = /^\s*(?:reacted|liked|loved|laughed at|emphasi[sz]ed|questioned|disliked|le gustó|\S{1,4}\s+to\s+[“"])/i;
// Completion must be a short, plain statement; long or mixed messages go to AI.
const DONE = /^(?:hi|hello|hey|ok|okay|yes|sir)?[\s,!.]*(?:(?:the |this |that )?(?:job |work )?(?:is |was |has been |it'?s |its )?(?:all )?(?:done|finished|completed?|complete)(?=\s*(?:[.!,✅]|$|sir|bro|thanks|thank you|for )))|\b(?:job|work) (?:is|was|has been|got) (?:all )?(?:done|finished|completed)\b|^(?:hi[\s,]*)?(?:job|work) (?:done|finished|completed)\b|^\s*all set\b|^\s*done\s*✅|^\s*✅\s*$/i;
const DONE_MAX = 120;
// A bare reply right after our share request ("Done", "Sent", "Paid ✅").
const BARE_SENT = /^\s*(?:done|sent|paid|transferred|zelled)\s*(?:sir|bro|✅|👍|!|\.)*\s*$/i;
const NOT_DONE = /\b(?:not|never|haven'?t|hasn'?t|isn'?t|wasn'?t|didn'?t|won'?t|will|might|may|going to|gonna|plan to|tomorrow|almost)\s+(?:\w+\s+){0,3}(?:done|finish\w*|complet\w*)\b|\bwants? (?:the |it |this )?(?:job |work )?(?:to be )?(?:done|finished|completed)\b|\b(?:when|once|after|until|before) (?:the )?(?:job|work|it) (?:is |gets )?(?:done|finished|completed)\b/i;
const PROMISE = /\b(?:i'?ll|i will|will|gonna|going to)\s+(?:\w+\s+)?(?:send|zelle|pay|transfer|cash ?app|venmo)\b/i;
// "Sent" must be about money, not pictures or contact info.
const SENT = /\b(?:just|already|i)\s+(?:sent|zelle?d|paid|transferred)\b|\b(?:sent|zelle?d|transferred|paid)\s+(?:you\s+)?(?:it|the (?:money|payment|share|shares|amount)|(?:the )?payment|money|our share|\$|\d)|\b(?:payment|money|shares?)\s+(?:is |has been |was )?(?:sent|done|paid|transferred)\b/i;
const NOT_MONEY = /\b(?:he|she|they|customer|client)\s+(?:sent|paid)\b|\bsent (?:you )?(?:the )?(?:contact|info|pictures?|photos?|pics?|address|details|video)/i;
const NOT_SENT = /\b(?:not|haven'?t|didn'?t|never|will|gonna|going to)\s+(?:\w+\s+){0,2}(?:sent|send|paid|pay|zelle?d?)\b/i;
const ACK_WINDOW_MS = 48 * 60 * 60_000;
const quote = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, 200);
const event = (message: PromptMessage): TimelineEvent => ({ at: message.at, message_id: message.id, quote: quote(message.text) });
const tagsOf = (text: string) => [...text.matchAll(TAG)].map((match) => String(Number(match[1])));

/** Exact identity only (phone, full name or street) — not the loose first-name anchor. */
export function namesThisJob(text: string, job: Pick<LeadWindowJob, "customer_name" | "customer_phone" | "address">): boolean {
  const phone = phoneKey(job.customer_phone);
  if (phone && text.replace(/\D/g, "").includes(phone)) return true;
  const normalize = (value: string) => ` ${value.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim()} `;
  const name = normalize(job.customer_name ?? "");
  if (name.trim().split(" ").length >= 2 && normalize(text).includes(name)) return true;
  const street = normalize(job.address ?? "").match(/^ (\d+ [a-z0-9]+)/)?.[1];
  return Boolean(street && normalize(text).includes(` ${street} `));
}

export function buildJobTimeline(messages: PromptMessage[], job: Pick<LeadWindowJob, "customer_name" | "customer_phone" | "address">): JobTimeline {
  const texts = messages.filter((message) => message.via === "text").sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const timeline: JobTimeline = { job_tag: null, details: null, took_job: null, visit_confirmed: null, update_requested: null, completed: null,
    share_requested: null, share_promised: null, share_sent: null, share_received: null, share_state: "none", other_jobs_in_window: false };
  // This job's details message fixes its tag; every other details message is another job.
  for (const message of texts) {
    if (message.from !== "our_team" || !DETAILS.test(message.text)) continue;
    if (namesThisJob(message.text, job)) {
      if (!timeline.details) { timeline.details = event(message); timeline.job_tag = tagsOf(message.text)[0] ?? null; }
    } else timeline.other_jobs_in_window = true;
  }
  // Without this job's details message the rules say nothing; AI decides.
  if (!timeline.details) return timeline;
  let otherJobSeen = false;
  let lastTeam: PromptMessage | null = null;
  for (const message of texts) {
    // Only this job's details and what follows it; an earlier job's messages never count.
    if (message.at < timeline.details.at || (message.at === timeline.details.at && message.id !== timeline.details.message_id && message.id < timeline.details.message_id)) continue;
    if (REACTION.test(message.text)) continue;
    const tags = tagsOf(message.text);
    const named = namesThisJob(message.text, job) || (timeline.job_tag !== null && tags.includes(timeline.job_tag));
    const otherJob = (message.from === "our_team" && DETAILS.test(message.text) && !namesThisJob(message.text, job))
      || (tags.length > 0 && !named);
    if (otherJob) { otherJobSeen = true; lastTeam = message; continue; }
    // Generic replies count only until another job's details arrive.
    const ours = named || !otherJobSeen;
    if (!ours) { if (message.from === "our_team") lastTeam = message; continue; }
    if (message.from === "our_team") {
      if (UPDATE_REQUEST.test(message.text)) timeline.update_requested = event(message);
      if (SHARE_REQUEST.test(message.text)) timeline.share_requested = event(message);
      if (SHARE_RECEIVED.test(message.text) && !/\?/.test(message.text)) timeline.share_received = event(message);
      lastTeam = message;
      continue;
    }
    const recent = lastTeam && Date.parse(message.at) - Date.parse(lastTeam.at) <= ACK_WINDOW_MS ? lastTeam : null;
    const afterShareAsk = Boolean(recent && SHARE_REQUEST.test(recent.text));
    if (!timeline.took_job && recent && ACCEPT.test(message.text) && message.text.length <= 60
      && (CONFIRM_PROMPT.test(recent.text) || (DETAILS.test(recent.text) && namesThisJob(recent.text, job)))) timeline.took_job = event(message);
    if (!timeline.visit_confirmed && recent && REMINDER.test(recent.text) && VISIT_ACK.test(message.text)) timeline.visit_confirmed = event(message);
    if (afterShareAsk || timeline.share_requested) {
      if (SENT.test(message.text) && !NOT_SENT.test(message.text) && !NOT_MONEY.test(message.text)) { timeline.share_sent = event(message); continue; }
      // A bare "Done"/"Sent" right after our share request means the share, not the job.
      if (afterShareAsk && BARE_SENT.test(message.text)) { timeline.share_sent = event(message); continue; }
      if (PROMISE.test(message.text)) timeline.share_promised = event(message);
    }
    if (!timeline.completed && message.text.length <= DONE_MAX && DONE.test(message.text.trim()) && !NOT_DONE.test(message.text)
      && timeline.details && message.at > timeline.details.at) timeline.completed = { ...event(message), by: "technician" };
  }
  // The team asks for its share only after the work is done.
  if (!timeline.completed && timeline.share_requested) timeline.completed = { ...timeline.share_requested, by: "share_request" };
  timeline.share_state = timeline.share_received ? "received"
    : timeline.share_sent && (!timeline.share_requested || timeline.share_sent.at >= timeline.share_requested.at) ? "sent"
    : timeline.share_promised && (!timeline.share_requested || timeline.share_promised.at >= timeline.share_requested.at) ? "promised"
    : timeline.share_requested ? "requested" : "none";
  return timeline;
}

const rank = (state: ShareState) => SHARE_STATES.indexOf(state);
const asEvidence = (signal: ProcessorEvidence["signal"], item: TimelineEvent | null, from: ProcessorEvidence["from"]): ProcessorEvidence[] =>
  item ? [{ signal, quote: item.quote, message_id: item.message_id, message_time: item.at, from, via: "text" }] : [];
function timelineEvidence(timeline: JobTimeline): ProcessorEvidence[] {
  return [
    ...asEvidence("took_job", timeline.took_job, "technician"),
    ...asEvidence("completed", timeline.completed?.by === "technician" ? timeline.completed : null, "technician"),
    ...asEvidence("share_requested", timeline.share_requested, "our_team"),
    ...asEvidence("share_promised", timeline.share_promised, "technician"),
    ...asEvidence("share_sent", timeline.share_sent, "technician"),
    ...asEvidence("share_received", timeline.share_received, "our_team"),
  ];
}

/**
 * A text-only job whose completion the rules already found needs no AI call:
 * the status then depends only on the share and the clock.
 */
const SHORT_ACK = /^\s*(?:ok(?:ay)?|k|yes|yeah|yep|sure|thanks?|thank you|thx|great|perfect|👍\S*|🙏\S*)[\s.!]*$/i;
export function timelineSettlesJob(timeline: JobTimeline, messages: PromptMessage[]): boolean {
  if (!timeline.details || !timeline.completed || messages.some((message) => message.via === "call")) return false;
  // Anything else the technician wrote after the completion (a return visit, a
  // problem) is not settled by rules; AI must read it.
  const explained = new Set([timeline.completed.message_id, timeline.share_promised?.message_id, timeline.share_sent?.message_id]);
  return !messages.some((message) => message.from === "technician" && message.at >= timeline.completed!.at && !explained.has(message.id)
    && !SHORT_ACK.test(message.text) && !REACTION.test(message.text));
}

/** Facts from the rules alone, used when AI is skipped. */
export function timelineFacts(timeline: JobTimeline): ProcessorFacts {
  const steps = [timeline.took_job && "took the job", timeline.completed && (timeline.completed.by === "technician" ? "reported it completed" : "was asked for our share after the job"),
    timeline.share_state !== "none" && `share ${timeline.share_state}`].filter(Boolean);
  return {
    enough_context: true, tech_took_job: Boolean(timeline.took_job || timeline.completed), job_update: timeline.completed ? "completed" : "none",
    completed_at: timeline.completed?.at ?? null, waiting_since: null, waiting_message_id: null,
    summary: `From the standard chat messages: the technician ${steps.join(", ")}.`.slice(0, 300),
    evidence: timelineEvidence(timeline).sort((a, b) => a.message_time.localeCompare(b.message_time)).slice(0, 8), share_state: timeline.share_state,
  };
}

/**
 * Rule facts are exact for standard texts; AI adds calls and free-form replies.
 * A later AI "in progress" (parts, return visit) beats an earlier rule completion.
 */
export function mergeTimeline(facts: ProcessorFacts, timeline: JobTimeline): ProcessorFacts {
  const laterProgress = timeline.completed && facts.evidence.some((item) => item.signal === "in_progress" && item.message_time > timeline.completed!.at);
  const jobUpdate = facts.job_update === "completed" || (timeline.completed && !laterProgress) ? "completed" : facts.job_update;
  const completedTimes = [facts.completed_at, jobUpdate === "completed" ? timeline.completed?.at : null].filter((value): value is string => Boolean(value)).sort();
  const known = new Set(facts.evidence.map((item) => `${item.signal}:${item.message_id}`));
  return {
    ...facts,
    enough_context: facts.enough_context || Boolean(timeline.details),
    tech_took_job: facts.tech_took_job || Boolean(timeline.took_job),
    job_update: jobUpdate,
    completed_at: jobUpdate === "completed" ? completedTimes[0] ?? null : null,
    share_state: rank(timeline.share_state) > rank(facts.share_state) ? timeline.share_state : facts.share_state,
    evidence: [...facts.evidence, ...timelineEvidence(timeline).filter((item) => !known.has(`${item.signal}:${item.message_id}`))]
      .sort((a, b) => a.message_time.localeCompare(b.message_time)).slice(0, 12),
  };
}
