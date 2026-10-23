import { MessageSquareText } from "lucide-react";
import { compatibleProcessorAssessment, currentAssessment, processorAttributionMessage, type ProcessorJob } from "@/lib/processor-board";

/** Keep the actionable result/quotes visible; retain full diagnostics on demand. */
export function ProcessorReviewEvidence({ job, timezone, now }: { job: ProcessorJob; timezone: string; now: Date }) {
  const assessment = compatibleProcessorAssessment(job, timezone);
  const attribution = processorAttributionMessage(job, timezone, now);
  const tied = (assessment?.matched_technician_messages ?? 0) + (assessment?.context_technician_messages ?? 0);
  return <section className="space-y-3" aria-label="Job conversation evidence">
    <h2 className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="h-4 w-4 text-primary" />Conversation evidence</h2>
    {!assessment ? <p className="text-xs leading-relaxed text-muted-foreground">{job.assessment ? "Previous evidence is stale or belongs to another saved schedule/timezone. Refresh this job before relying on it." : "This label comes from the saved job and schedule, not a completed AI review. Check this job to look for explicit technician evidence."}</p> : <>
      {!currentAssessment(job, timezone, now) && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Previous evidence for this saved job and technician · refresh due. This is not a fresh check.</p>}
      <p className="text-xs leading-relaxed text-muted-foreground" aria-label="Job evidence summary">{!assessment.evidence.length
        ? attribution ?? "No verified technician update for this job. Open the technician chat to review."
        : `${assessment.evidence.length} job-specific source ${assessment.evidence.length === 1 ? "quote" : "quotes"} below. ${assessment.evidence.some((item) => item.identity_basis === "thread_context") ? "Context matched through this job's dispatch — verify in chat." : "Evidence belongs only to this job."}`}</p>
      <p className="text-[10px] text-primary">{assessment.ai_used === true ? "AI reviewed job-linked messages" : assessment.ai_used === false ? "No AI used · no job-linked text to interpret" : "AI usage not recorded for this previous check"}</p>
      {assessment.evidence.map((item, index) => <blockquote key={`${item.message_id}:${index}`} className="rounded-lg border-l-2 border-primary bg-muted/30 p-3">
        <p className="whitespace-pre-wrap break-words text-sm">“{item.quote}”</p>
        <footer className="mt-2 text-[10px] text-muted-foreground">{item.sender === "customer" ? "Technician" : "Our team"} · {new Date(item.message_time).toLocaleString([], { timeZone: timezone })} · {item.signal.replace(/_/g, " ")}
          {item.identity_basis === "source_message" && <span className="mt-1 block">Job identity was verified in this same source message, outside the quoted factual span. No identity was inherited from another message.</span>}
          {item.identity_basis === "thread_context" && <span className="mt-1 block">This reply does not name the job. It follows this job's saved dispatch in the same 1:1 thread, before any other job's dispatch. Verify it in Quo before acting.</span>}
        </footer>
      </blockquote>)}
      <details className="rounded-lg border border-border/50 p-3 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Check details & safety</summary>
        <div className="mt-3 space-y-3 leading-relaxed">
          <p>{assessment.messages_reviewed} messages examined · {assessment.matched_messages} used for this job · {assessment.matched_technician_messages ?? 0} technician replies name this job · {assessment.context_technician_messages ?? 0} follow this job's saved dispatch · {assessment.source === "Quo current history" ? "Quo current history · saved Tech Quick Chat" : "webhook-stored Tech Quick Chat"}</p>
          {tied > 0 && attribution && <p>{attribution}</p>}
          <p>{assessment.summary}</p>
          <p>A technician can have multiple jobs. Only this job's identified messages or verified dispatch-context replies are used. Call recordings, transcripts and reactions are not technician replies. Send Dose requires a directly identified acceptance, a delivered unanswered job-specific request and a 60-minute wait with current history. No messages or saved status changes are made.</p>
        </div>
      </details>
    </>}
  </section>;
}
