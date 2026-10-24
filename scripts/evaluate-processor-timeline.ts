// Offline check of the Processor Board timeline rules against a technician chat
// export (the JSON-per-chat CSV). Reads a local file only, sends nothing anywhere
// and prints aggregate counts — never names, numbers or message text.
// Usage: npx vite-node scripts/evaluate-processor-timeline.ts -- <export.csv>
import { readFileSync } from "node:fs";
import { buildJobTimeline, timelineSettlesJob } from "../supabase/functions/_shared/processor-job-timeline";
import type { PromptMessage } from "../supabase/functions/_shared/processor-lead-window";

const file = process.argv.slice(2).find((arg) => arg.endsWith(".csv"));
if (!file) throw new Error("Pass the exported CSV path.");

/** Minimal RFC 4180 reader: quoted fields may contain commas, quotes and newlines. */
function* csvRows(text: string): Generator<string[]> {
  let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; yield row; row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); yield row; }
}

type Exported = { time_eastern: string; speaker: string; channel: string; message: string | null; source_id: string };
const rows = csvRows(readFileSync(file, "utf8"));
const header = rows.next().value as string[];
const col = (name: string) => header.indexOf(name);
const DETAILS = /customer\s*name[\s\S]*customer\s*(?:number|phone)/i;
const counts: Record<string, number> = {};
const bump = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
let chats = 0;
for (const row of rows) {
  if (row.length < header.length) continue;
  chats++;
  const messages: PromptMessage[] = (JSON.parse(row[col("messages")]) as Exported[])
    .filter((m) => m.message && (m.speaker === "technician" || m.speaker === "our_team"))
    .map((m) => ({ id: m.source_id + m.time_eastern, at: m.time_eastern.replace(" ", "T"), from: m.speaker as PromptMessage["from"], via: m.channel === "call" ? "call" : "text", text: m.message! }));
  for (const [index, message] of messages.entries()) {
    if (message.from !== "our_team" || message.via !== "text" || !DETAILS.test(message.text)) continue;
    // Each details message stands in for one CRM lead: its own name/number/address.
    const job = {
      customer_name: message.text.match(/customer\s*name\s*:\s*([^\n|]+)/i)?.[1]?.trim() ?? null,
      customer_phone: message.text.match(/customer\s*(?:number|phone)\s*:\s*([^\n|]+)/i)?.[1]?.trim() ?? null,
      address: message.text.match(/customer\s*address\s*:\s*([^\n|]+)/i)?.[1]?.trim() ?? null,
    };
    const timeline = buildJobTimeline(messages.slice(index), job);
    bump("jobs");
    if (!timeline.details) { bump("details not matched to its own job"); continue; }
    if (timeline.job_tag) bump("job tag found");
    if (timeline.other_jobs_in_window) bump("other jobs later in the same chat");
    for (const key of ["took_job", "visit_confirmed", "update_requested", "share_requested", "share_promised", "share_sent", "share_received"] as const) if (timeline[key]) bump(key);
    if (timeline.completed) bump(`completed (by ${timeline.completed.by})`);
    bump(`share state: ${timeline.share_state}`);
    const rest = messages.slice(index);
    bump(rest.some((m) => m.via === "call") ? "has calls after details (AI still needed)" : "text only after details");
    if (timelineSettlesJob(timeline, rest)) bump("settled by rules alone (AI skipped)");
  }
}
console.log(JSON.stringify({ chats, ...counts }, null, 2));
