/** Job-specific evidence rules. Shared with behavioral tests; never changes leads. */
export type JobIdentity = {
  id: string; job_id: string; customer_name: string; customer_phone: string | null;
  address: string | null; tech_number: string | null; scheduled_date: string | null;
  scheduled_time_start: string | null; scheduled_time_end: string | null;
  status: string; updated_at: string; created_at: string;
};
export type JobMessage = { id: string; conversation_id: string; sender: string; text: string | null; message_time: string | null; status?: string | null };
export type JobSignal = "accepted" | "progress" | "completed" | "update_request";
export type JobEvidence = { signal: JobSignal; quote: string; message_id: string; message_time: string; sender: string };
export type ProcessorStatus = "take_job_update" | "job_in_progress" | "payment_pending" | "send_dose" | "needs_review" | "unavailable" | "scheduled";
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
export function phoneKey(value: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 10 ? digits : digits.length === 11 && digits[0] === "1" ? digits.slice(1) : null;
}
export function jobAnchors(job: JobIdentity): string[] {
  return [job.job_id.length >= 4 ? normalize(job.job_id) : "", job.address && /\d/.test(job.address) ? normalize(job.address) : "",
    job.customer_name.trim().split(/\s+/).length >= 2 ? normalize(job.customer_name) : ""].filter((s) => s.length >= 4);
}
/** An explicit identifier must be unique to this job, and no peer job may be mentioned. */
export function belongsToJob(text: string, job: JobIdentity, peers: JobIdentity[]): boolean {
  const haystack = ` ${normalize(text)} `;
  const mentions = (anchor: string) => haystack.includes(` ${anchor} `);
  const phone = phoneKey(job.customer_phone);
  const phones = new Set((text.match(/(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g) ?? []).map(phoneKey).filter(Boolean));
  const own = jobAnchors(job).filter((a) => !peers.some((p) => p.id !== job.id && jobAnchors(p).includes(a)));
  const ownPhone = phone && !peers.some((p) => p.id !== job.id && phoneKey(p.customer_phone) === phone);
  if (!own.some(mentions) && !(ownPhone && phones.has(phone))) return false;
  return !peers.some((p) => p.id !== job.id && (
    jobAnchors(p).filter((a) => !jobAnchors(job).includes(a)).some(mentions) ||
    (phoneKey(p.customer_phone) && phoneKey(p.customer_phone) !== phone && phones.has(phoneKey(p.customer_phone)!))
  ));
}
export function localDateTime(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const p = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}`;
}
export function schedulePassed(job: { scheduled_date?: string | null; scheduled_time_start?: string | null }, now: Date, timezone: string): boolean {
  return !!job.scheduled_date && !!job.scheduled_time_start && localDateTime(now, timezone) >= `${job.scheduled_date}T${job.scheduled_time_start.length === 5 ? `${job.scheduled_time_start}:00` : job.scheduled_time_start}`;
}
export function verifyJobEvidence(value: unknown, job: JobIdentity, peers: JobIdentity[], messages: JobMessage[], timezone: string, now = new Date()): JobEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { signal, quote, message_id } = item;
    if (!["accepted", "progress", "completed", "update_request"].includes(signal) || typeof quote !== "string" || quote.trim().length < 12 || quote.length > 1000) return [];
    const message = messages.find((m) => m.id === message_id);
    if (!message?.text || !message.message_time || !Number.isFinite(Date.parse(message.message_time)) || Date.parse(message.message_time) > now.getTime() || Date.parse(message.message_time) < Date.parse(job.created_at)) return [];
    if (!message.text.includes(quote.trim()) || !belongsToJob(quote, job, peers) || !belongsToJob(message.text, job, peers)) return [];
    if ((signal === "update_request") !== (message.sender === "agent")) return [];
    if (signal === "update_request" && message.status !== "delivered") return [];
    if (signal !== "update_request" && message.sender !== "customer") return [];
    // A prior visit for the same customer cannot establish this appointment's outcome.
    if (["progress", "completed"].includes(signal) && (!job.scheduled_date || localDateTime(new Date(message.message_time), timezone).slice(0, 10) < job.scheduled_date)) return [];
    return [{ signal, quote: quote.trim().slice(0, 1000), message_id: message.id, message_time: message.message_time, sender: message.sender }];
  }).sort((a, b) => a.message_time.localeCompare(b.message_time));
}
export function deriveJobStatus(job: JobIdentity, evidence: JobEvidence[], messages: JobMessage[], complete: boolean, now: Date, timezone: string): ProcessorStatus {
  if (!complete) return "unavailable";
  const latest = [...evidence].reverse().find((e) => e.signal === "completed" || e.signal === "progress");
  if (latest?.signal === "completed") return "payment_pending";
  // Absence is only actionable after acceptance AND a specific unanswered request.
  const accepted = evidence.find((e) => e.signal === "accepted" || e.signal === "progress");
  const request = [...evidence].reverse().find((e) => e.signal === "update_request");
  if (schedulePassed(job, now, timezone) && accepted && request && request.message_time > accepted.message_time &&
      localDateTime(new Date(request.message_time), timezone).slice(0, 10) >= job.scheduled_date! &&
      now.getTime() - Date.parse(request.message_time) >= 60 * 60_000 &&
      !messages.some((m) => m.sender === "customer" && (!m.message_time || m.message_time > request.message_time))) return "send_dose";
  if (latest?.signal === "progress") return "job_in_progress";
  return schedulePassed(job, now, timezone) ? "take_job_update" : job.scheduled_date && job.scheduled_time_start ? "scheduled" : "needs_review";
}
