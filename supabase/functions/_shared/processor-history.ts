import { parseTechnicianQuoLink } from "./technician-quo-link.ts";
import { imageCount, phoneKey, type JobMessage } from "./processor-job-status.ts";
import { ProcessorReviewError } from "./processor-review.ts";

/** Current Quo text history, all pages for this saved chat. Never silently truncate. */
export async function readProcessorHistory(options: { chatLink: string; phone: string; since: string; until?: string; apiKey: string; apiBase?: string; fetcher?: typeof fetch }): Promise<JobMessage[]> {
  const link = parseTechnicianQuoLink(options.chatLink);
  const phone = phoneKey(options.phone);
  if (!link || !phone) throw new Error("Invalid saved technician identity.");
  const messages = new Map<string, JobMessage>();
  const seen = new Set<string>();
  let token: string | null = null;
  const signal = AbortSignal.timeout(45000);
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({ phoneNumberId: link.phoneNumberId, participants: `+1${phone}`, maxResults: "100", createdAfter: new Date(Date.parse(options.since) - 1).toISOString() });
    if (options.until) params.set("createdBefore", new Date(Date.parse(options.until) + 1).toISOString());
    if (token) params.set("pageToken", token);
    let response: Response;
    try { response = await (options.fetcher ?? fetch)(`${(options.apiBase || "https://api.quo.com/v1").replace(/\/$/, "")}/messages?${params}`, { headers: { Authorization: options.apiKey, Accept: "application/json" }, signal }); }
    catch { throw new ProcessorReviewError("Quo history timed out or could not connect. No full-history review was saved; retry this job.", "history_connection", true); }
    if (!response.ok) throw new ProcessorReviewError(response.status === 429 ? "Quo is rate limited. Wait a minute, then retry failed jobs." : [401, 403].includes(response.status) ? "Quo rejected its server credentials. Ask Admin to check configuration." : "Current Quo history is unavailable. Retry after checking Quo service health.", "history_provider", ![401, 403].includes(response.status));
    const payload = await response.json();
    if (!Array.isArray(payload.data) || !(payload.nextPageToken === null || typeof payload.nextPageToken === "string")) throw new ProcessorReviewError("Quo history returned invalid data or missing pagination state. No complete review was saved.", "history_invalid", true);
    for (const item of payload.data) {
      if (item.conversationId !== link.conversationId) continue;
      if (item.phoneNumberId !== link.phoneNumberId || !["incoming", "outgoing"].includes(item.direction)) throw new Error("Quo history contains an unverified line or sender.");
      if (typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))) throw new Error("Quo history contains an unknown message time.");
      if (Date.parse(item.createdAt) < Date.parse(options.since)) continue;
      if (options.until && Date.parse(item.createdAt) > Date.parse(options.until)) continue;
      // Non-text events cannot establish completion; inbound events still prevent false non-response.
      if (typeof item.id !== "string") throw new Error("Quo history contains an unknown message identity.");
      messages.set(item.id, { id: item.id, conversation_id: link.conversationId, sender: item.direction === "incoming" ? "customer" : "agent", text: typeof item.text === "string" ? item.text : null, message_time: item.createdAt, status: typeof item.status === "string" ? item.status : null, images: imageCount(item.media) });
    }
    token = typeof payload.nextPageToken === "string" && payload.nextPageToken ? payload.nextPageToken : null;
    if (!token) return [...messages.values()].sort((a, b) => Date.parse(a.message_time!) - Date.parse(b.message_time!) || a.id.localeCompare(b.id));
    if (seen.has(token)) throw new ProcessorReviewError("Quo history pagination repeated; full history was not verified.", "history_invalid", true);
    seen.add(token);
  }
  throw new ProcessorReviewError("Quo history exceeds the safe review limit; no full-history assessment was made. Review this job manually.", "history_limit", false, 422);
}
