import { ArrowUpRight, Loader2, MessageSquareText, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { STATUS_LABELS } from "@/lib/constants";
import type { LeadStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { processorFacts, processorSetupIssue, processorWorkflowMessage, PROCESSOR_STATUS_UI, type ProcessorJob } from "@/lib/processor-board";
import { processorLocation } from "@/lib/processor-location";

const UPDATE_LABEL = { none: "No update yet", in_progress: "Working on it", completed: "Completed" } as const;
const SIGNAL_LABEL = { took_job: "Took the job", in_progress: "Work update", completed: "Completed", waiting: "Our unanswered message" } as const;

/** Inline job review: the AI's facts, their quotes and what part of the chat was read. */
export function ProcessorReviewPanel({ job, timezone, checking, queued, error, canChat, onCheck, onChat }: {
  job: ProcessorJob; timezone: string; checking: boolean; queued: boolean;
  error?: { message: string; retryable: boolean }; canChat: boolean; onCheck: () => void; onChat: () => void;
}) {
  const facts = processorFacts(job);
  const setup = processorSetupIssue(job);
  const status = PROCESSOR_STATUS_UI[job.board_status];
  const when = (value: string) => new Date(value).toLocaleString([], { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const workflow = processorWorkflowMessage(job.status);
  return <section aria-label={`Review ${job.job_id}`} className="space-y-3 rounded-2xl border border-border/50 bg-muted/20 p-3 text-xs">
    <div className="space-y-1">
      <p className="font-semibold">{status.label}</p>
      <p className="text-muted-foreground">{status.help}</p>
    </div>
    {setup && <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-amber-800 dark:text-amber-200">{setup}</p>}
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-destructive">{error.message}</p>}
    {!facts ? <p className="text-muted-foreground">{job.assessment ? "The last check was made by an older version or for another technician. Check this job again." : "AI has not checked this job's chat yet. The status above comes from the saved lead and its schedule."}</p> : <>
      {job.ai_stale && <p className="text-amber-700 dark:text-amber-300">The chat or lead changed after this check. It is rechecked automatically while auto-check is on.</p>}
      {facts.summary && <p className="text-sm leading-relaxed" aria-label="AI summary">{facts.summary}</p>}
      <dl className="grid gap-2 sm:grid-cols-3">
        <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Technician took job</dt><dd className="font-medium">{facts.tech_took_job ? "Yes" : "Not confirmed"}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Latest job update</dt><dd className="font-medium">{UPDATE_LABEL[facts.job_update]}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Waiting on technician</dt><dd className="font-medium">{facts.waiting_since ? `Since ${when(facts.waiting_since)}` : "No"}</dd></div>
      </dl>
      {facts.evidence.length > 0 && <ul className="space-y-2" aria-label="Chat quotes">{facts.evidence.map((item, index) => <li key={`${item.message_id}:${index}`}>
        <blockquote className="rounded-lg border-l-2 border-primary bg-background/60 px-3 py-2">
          <p className="whitespace-pre-wrap break-words text-sm">“{item.quote}”</p>
          <footer className="mt-1 text-[10px] text-muted-foreground">{SIGNAL_LABEL[item.signal]} · {item.from === "technician" ? "Technician" : "Our team"} · {item.via === "call" ? "Call" : "Text"} · {when(item.message_time)}</footer>
        </blockquote></li>)}</ul>}
      <p className="text-[11px] text-muted-foreground" aria-label="Chat window">
        Read {facts.window.messages} message{facts.window.messages === 1 ? "" : "s"} from {when(facts.window.start)} · {facts.window.anchor === "customer_mention" ? `starting where ${job.customer_name || "the customer"} is first mentioned` : `no mention of ${job.customer_name || "the customer"} found, so the chat from the day before the lead was read`}.
        {facts.window.omitted > 0 && ` ${facts.window.omitted} middle message${facts.window.omitted === 1 ? " was" : "s were"} too long to include; the job dispatch and newest messages were kept.`}
        {` ${facts.call_transcripts.state === "unavailable" ? "Call transcripts could not be read." : `${facts.call_transcripts.checked} call transcript${facts.call_transcripts.checked === 1 ? "" : "s"} included${facts.call_transcripts.missing ? `, ${facts.call_transcripts.missing} unavailable` : ""}.`}`}
        {!facts.history_complete && " Read from the CRM chat mirror; confirm silence in Quo before sending a dose."}
        {` Checked ${when(facts.checked_at)}${facts.ai_reused ? " · chat unchanged, previous AI answer reused" : ""}.`}
      </p>
    </>}
    <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
      <p>Saved lead status: <span className="text-foreground">{STATUS_LABELS[job.status as LeadStatus] ?? job.status}</span>{workflow ? ` · ${workflow}` : ""}</p>
      <p>Area: <span className="text-foreground">{processorLocation(job).text}</span></p>
      {job.customer_schedule_requirements && <p className="sm:col-span-2">Customer schedule notes: <span className="whitespace-pre-wrap text-foreground">{job.customer_schedule_requirements}</span></p>}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" className="h-8 text-xs" disabled={checking || queued || !!setup} aria-busy={checking} onClick={onCheck}>
        {checking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 motion-safe:animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{checking ? "Checking…" : queued ? "Queued" : "Check again"}</Button>
      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!canChat} onClick={onChat}><MessageSquareText className="mr-1.5 h-3.5 w-3.5" />Tech chat</Button>
      <Button size="sm" variant="outline" className="h-8 text-xs" asChild><Link to={`/leads/${job.id}`}>Open lead<ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
    </div>
    <p className="text-[10px] text-muted-foreground">AI is advisory. It never changes the lead's saved status and never sends messages.</p>
  </section>;
}
