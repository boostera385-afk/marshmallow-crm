import { ArrowUpRight, Loader2, MessageSquareText, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { STATUS_LABELS } from "@/lib/constants";
import type { LeadStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProcessorDetail } from "@/hooks/useProcessorBoard";
import { processorFacts, SHARE_STATE_UI, processorSetupIssue, processorWorkflowMessage, PROCESSOR_STATUS_UI, type ProcessorJob } from "@/lib/processor-board";
import { processorLocation } from "@/lib/processor-location";

const UPDATE_LABEL = { none: "No update yet", in_progress: "Working on it", completed: "Completed" } as const;
const CUSTOMER_LABEL = { none: "Nothing about the job's progress", in_progress: "Says the work is in progress", completed: "Says the work is done", problem: "Reports a problem" } as const;
const SIGNAL_LABEL = { took_job: "Took the job", in_progress: "Work update", completed: "Completed", waiting: "Our unanswered message",
  share_requested: "Share requested", share_promised: "Share promised", share_sent: "Share sent", share_received: "Share received" } as const;
// The team's standard steps, in order, as read by the exact rules.
const TIMELINE_STEPS = [["details", "Customer details sent"], ["took_job", "Technician took the job"], ["visit_confirmed", "Visit confirmed (reminder)"],
  ["update_requested", "We asked for an update"], ["completed", "Job completed"], ["share_requested", "Share requested"], ["share_promised", "Share promised"],
  ["share_sent", "Tech says share sent"], ["share_screenshot", "Tech sent a picture (payment screenshot)"], ["share_checking", "Screenshot received · accounts checking"], ["share_received", "Share received"]] as const;

/** Inline job review: the AI's facts, their quotes and what part of the chat was read. */
export function ProcessorReviewPanel({ job, timezone, checking, busy, error, canChat, onCheck, onChat }: {
  job: ProcessorJob; timezone: string; checking: boolean; busy: boolean;
  error?: { message: string; retryable: boolean }; canChat: boolean; onCheck: () => void; onChat: () => void;
}) {
  // Full evidence is loaded only for the open Review, not with every board row.
  const detail = useProcessorDetail(job);
  const facts = processorFacts(job, detail.data);
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
    {detail.isLoading ? <div aria-label="Loading review" className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>
      : detail.isError ? <p role="alert" className="text-destructive">The saved review could not be loaded. Close and open Review to retry.</p>
      : !facts ? <p className="text-muted-foreground">{job.checked_at ? "The last check was made by an older version or for another technician. The server re-checks it soon, or use Check again." : "The server has not checked this job's chat yet. The status above comes from the saved lead and its schedule."}</p> : <>
      {job.ai_stale && <p className="text-amber-700 dark:text-amber-300">New activity since this check. The server re-checks it within a few minutes.</p>}
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
        {` Checked ${when(facts.checked_at)}${facts.checked_by === "daily_check" ? " by the daily check" : ""}${facts.ai_reused ? " · chat unchanged, previous AI answer reused" : ""}.`}
      </p>
      {facts.timeline && <section aria-label="Job timeline" className="space-y-1.5 rounded-xl border border-border/50 bg-background/40 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Job timeline{facts.timeline.job_tag ? ` · *Customer # ${facts.timeline.job_tag}*` : ""}</p>
        {!facts.timeline.details ? <p className="text-muted-foreground">This lead's customer-details message was not found in the technician chat, so the standard steps could not be read. The AI review above covers it.</p>
          : <ol className="space-y-1">{TIMELINE_STEPS.map(([key, label]) => {
            const step = facts.timeline![key];
            return <li key={key} className={step ? "" : "text-muted-foreground"}>
              <span className="font-medium">{step ? "✓" : "–"} {label}</span>{step && <span className="text-muted-foreground"> · {when(step.at)}{key === "completed" && facts.timeline!.completed?.by === "share_request" ? " (from our share request)" : ""}{key !== "details" ? ` · “${step.quote}”` : ""}</span>}
            </li>;
          })}</ol>}
        {facts.timeline.other_jobs_in_window && <p className="text-[11px] text-muted-foreground">This technician has other jobs in the same chat; replies after another job's details are counted only when they name this job.</p>}
        <p className="text-[11px] text-muted-foreground">{facts.rules_only ? "Read from the team's standard messages only — no AI was needed." : "Standard messages read by exact rules; calls and other replies by AI."}</p>
      </section>}
      {facts.customer_chat && <section aria-label="Customer's side" className="space-y-1.5 rounded-xl border border-border/50 bg-background/40 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Customer's side</p>
        {facts.customer_chat.state === "unavailable" ? <p className="text-muted-foreground">The customer's chat could not be read in this check; the status uses the technician chat only.</p>
          : facts.customer_chat.state === "none" ? <p className="text-muted-foreground">No customer texts since the day before the lead.</p> : <>
          <p className="text-sm font-medium">{CUSTOMER_LABEL[facts.customer_view?.update ?? "none"]}</p>
          {facts.customer_view?.note && <p className="text-muted-foreground">{facts.customer_view.note}</p>}
          {facts.customer_view?.quote && facts.customer_view.message_time && <blockquote className="rounded-lg border-l-2 border-primary bg-background/60 px-3 py-2">
            <p className="whitespace-pre-wrap break-words text-sm">“{facts.customer_view.quote}”</p>
            <footer className="mt-1 text-[10px] text-muted-foreground">Customer · Text · {when(facts.customer_view.message_time)}</footer>
          </blockquote>}
          <p className="text-[11px] text-muted-foreground">Read {facts.customer_chat.messages} customer chat message{facts.customer_chat.messages === 1 ? "" : "s"}{facts.customer_chat.omitted ? ` (${facts.customer_chat.omitted} middle messages left out)` : ""}. Used for the job's progress only, never for our share.</p>
        </>}
      </section>}
      {["payment_pending", "send_dose"].includes(job.board_status) && <section aria-label="Our share" className="space-y-1 rounded-xl border border-border/50 bg-background/40 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Our share</p>
        <p className="text-sm font-medium">{SHARE_STATE_UI[facts.share_state ?? "none"].label}</p>
        <p className="text-muted-foreground">{facts.completed_at ? `Job completed ${when(facts.completed_at)}.` : "The lead is saved as completed."} Becomes Send Dose 3 days after the scheduled date until the technician sends our share.</p>
      </section>}
    </>}
    <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
      <p>Saved lead status: <span className="text-foreground">{STATUS_LABELS[job.status as LeadStatus] ?? job.status}</span>{workflow ? ` · ${workflow}` : ""}</p>
      <p>Area: <span className="text-foreground">{processorLocation(job).text}</span></p>
      {job.customer_schedule_requirements && <p className="sm:col-span-2">Customer schedule notes: <span className="whitespace-pre-wrap text-foreground">{job.customer_schedule_requirements}</span></p>}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" className="h-8 text-xs" disabled={checking || busy || !!setup} aria-busy={checking} onClick={onCheck}>
        {checking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 motion-safe:animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{checking ? "Checking…" : "Check again"}</Button>
      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!canChat} onClick={onChat}><MessageSquareText className="mr-1.5 h-3.5 w-3.5" />Tech chat</Button>
      <Button size="sm" variant="outline" className="h-8 text-xs" asChild><Link to={`/leads/${job.id}`}>Open lead<ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
    </div>
    <p className="text-[10px] text-muted-foreground">AI is advisory. It never changes the lead's saved status and never sends messages.</p>
  </section>;
}
