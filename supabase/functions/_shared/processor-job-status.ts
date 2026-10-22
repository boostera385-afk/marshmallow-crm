/** Job-specific evidence rules. Shared with behavioral tests; never changes leads. */
export type JobIdentity = {
  id: string; job_id: string; customer_name: string; customer_phone: string | null;
  address: string | null; tech_number: string | null; scheduled_date: string | null;
  scheduled_time_start: string | null; scheduled_time_end: string | null;
  status: string; updated_at: string; created_at: string;
};
export type JobMessage = { id: string; conversation_id: string; sender: string; text: string | null; message_time: string | null; status?: string | null };
export type JobPeer = Pick<JobIdentity, "id" | "job_id" | "customer_name" | "customer_phone" | "address" | "tech_number">;
export type JobSignal = "accepted" | "progress" | "completed" | "update_request";
export type JobEvidence = { signal: JobSignal; quote: string; message_id: string; message_time: string; sender: string; identity_basis?: "source_message" };
export type ProcessorStatus = "take_job_update" | "job_in_progress" | "payment_pending" | "send_dose" | "needs_review" | "unavailable" | "scheduled";
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
// Canonical spellings only: never drop street numbers, directionals or unit values.
const addressWords: Record<string, string> = { street: "st", road: "rd", avenue: "ave", boulevard: "blvd", drive: "dr", lane: "ln", court: "ct", place: "pl", parkway: "pkwy", terrace: "ter", apartment: "unit", apt: "unit", suite: "unit", ste: "unit" };
const normalizeAddress = (value: string) => normalize(value.replace(/#\s*(?=[a-z0-9])/gi, " unit ")).split(" ").map((word) => addressWords[word] ?? word).join(" ");
export function phoneKey(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 10 ? digits : digits.length === 11 && digits[0] === "1" ? digits.slice(1) : null;
}
export function jobAnchors(job: Pick<JobIdentity, "job_id" | "address" | "customer_name">): string[] {
  const { job_id, address, customer_name } = job;
  return [job_id.length >= 4 ? normalize(job_id) : "", address && /\d/.test(address) ? normalize(address) : "",
    customer_name.trim().split(/\s+/).length >= 2 ? normalize(customer_name) : ""].filter((s) => s.length >= 4);
}
/** Compile once per review, not once per message/quote. No cross-request identity cache. */
export function createJobMatcher(job: JobIdentity, peers: JobPeer[]): (text: string) => boolean {
  const anchors = new Set(jobAnchors(job).filter((a) => !job.address || a !== normalize(job.address)));
  const peerAnchors = new Set<string>();
  const peerPhones = new Set<string>();
  const peerAddresses = new Set<string>();
  for (const peer of peers) {
    if (peer.id === job.id) continue;
    for (const anchor of jobAnchors(peer)) if (!peer.address || anchor !== normalize(peer.address)) peerAnchors.add(anchor);
    const peerPhone = phoneKey(peer.customer_phone);
    if (peerPhone) peerPhones.add(peerPhone);
    if (peer.address && /\d/.test(peer.address)) peerAddresses.add(normalizeAddress(peer.address));
  }
  const own = [...anchors].filter((anchor) => !peerAnchors.has(anchor)).map((anchor) => ` ${anchor} `);
  const others = [...peerAnchors].filter((anchor) => !anchors.has(anchor)).map((anchor) => ` ${anchor} `);
  const phone = phoneKey(job.customer_phone);
  const ownPhone = phone && !peerPhones.has(phone);
  const address = job.address && /\d/.test(job.address) ? normalizeAddress(job.address) : null;
  const ownAddress = address && !peerAddresses.has(address) ? ` ${address} ` : null;
  const otherAddresses = [...peerAddresses].filter((a) => a !== address).map((a) => ` ${a} `);
  const unit = address?.match(/^(.*?) unit (\S+)(?: |$)/);
  const addressBase = unit?.[1] ?? address;
  const unitPattern = addressBase ? new RegExp(` ${addressBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} unit (\\S+)(?: |$)`, "g") : null;
  return (text) => {
    const haystack = ` ${normalize(text)} `;
    const addressText = ` ${normalizeAddress(text)} `;
    if (unitPattern && [...addressText.matchAll(unitPattern)].some((m) => m[1] !== unit?.[2])) return false;
    const phones = new Set((text.match(/(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g) ?? []).map(phoneKey).filter(Boolean));
    if (!own.some((anchor) => haystack.includes(anchor)) && !(ownPhone && phones.has(phone)) && !(ownAddress && addressText.includes(ownAddress))) return false;
    return !others.some((anchor) => haystack.includes(anchor)) && !otherAddresses.some((a) => addressText.includes(a)) && ![...phones].some((p) => p !== phone && peerPhones.has(p!));
  };
}
/** An explicit identifier must be unique to this job, and no peer job may be mentioned. */
export function belongsToJob(text: string, job: JobIdentity, peers: JobPeer[]): boolean {
  return createJobMatcher(job, peers)(text);
}
export function localDateTime(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const p = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}`;
}
export function schedulePassed(job: { scheduled_date?: string | null; scheduled_time_start?: string | null }, now: Date, timezone: string): boolean {
  return !!job.scheduled_date && !!job.scheduled_time_start && localDateTime(now, timezone) >= `${job.scheduled_date}T${job.scheduled_time_start.length === 5 ? `${job.scheduled_time_start}:00` : job.scheduled_time_start}`;
}
export function verifyJobEvidence(value: unknown, job: JobIdentity, peers: JobPeer[], messages: JobMessage[], timezone: string, now = new Date(), matches = createJobMatcher(job, peers)): JobEvidence[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  return value.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { signal, quote, message_id } = item;
    if (!["accepted", "progress", "completed", "update_request"].includes(signal) || typeof quote !== "string" || quote.trim().length < 12 || quote.length > 1000) return [];
    const message = byId.get(message_id);
    if (!message?.text || !message.message_time || !Number.isFinite(Date.parse(message.message_time)) || Date.parse(message.message_time) > now.getTime() || Date.parse(message.message_time) < Date.parse(job.created_at)) return [];
    // The exact factual quote can omit the ID when its full source message uniquely
    // identifies this job. Never inherit identity from a different/nearby message.
    if (!message.text.includes(quote.trim()) || !matches(message.text)) return [];
    if ((signal === "update_request") !== (message.sender === "agent")) return [];
    if (signal === "update_request" && message.status !== "delivered") return [];
    if (signal !== "update_request" && message.sender !== "customer") return [];
    // A prior visit for the same customer cannot establish this appointment's outcome.
    if (["progress", "completed"].includes(signal) && (!job.scheduled_date || localDateTime(new Date(message.message_time), timezone).slice(0, 10) < job.scheduled_date)) return [];
    return [{ signal, quote: quote.trim().slice(0, 1000), message_id: message.id, message_time: message.message_time, sender: message.sender, ...(!matches(quote) ? { identity_basis: "source_message" as const } : {}) }];
  }).sort((a, b) => a.message_time.localeCompare(b.message_time));
}
export function deriveJobStatus(job: JobIdentity, evidence: JobEvidence[], messages: JobMessage[], complete: boolean, now: Date, timezone: string): ProcessorStatus {
  if (!complete) return "unavailable";
  // A missing conversation signal must not regress an already saved payment state.
  if (["payment_pending", "partial_paid"].includes(job.status)) return "payment_pending";
  const latest = [...evidence].reverse().find((e) => e.signal === "completed" || e.signal === "progress");
  if (latest?.signal === "completed") return "payment_pending";
  // Absence is only actionable after acceptance AND a specific unanswered request.
  const accepted = evidence.find((e) => e.signal === "accepted" || e.signal === "progress");
  const request = [...evidence].reverse().find((e) => e.signal === "update_request");
  if (schedulePassed(job, now, timezone) && accepted && request && request.message_time > accepted.message_time &&
      localDateTime(new Date(request.message_time), timezone).slice(0, 10) >= job.scheduled_date! &&
      now.getTime() - Date.parse(request.message_time) >= 60 * 60_000 &&
      !messages.some((m) => m.sender === "customer" && (!m.message_time || m.message_time > request.message_time))) return "send_dose";
  if (latest?.signal === "progress" || job.status === "job_in_progress") return "job_in_progress";
  // Other active workflows can be reviewed, but a date alone cannot override them.
  if (job.status !== "scheduled") return "needs_review";
  return schedulePassed(job, now, timezone) ? "take_job_update" : job.scheduled_date && job.scheduled_time_start ? "scheduled" : "needs_review";
}
