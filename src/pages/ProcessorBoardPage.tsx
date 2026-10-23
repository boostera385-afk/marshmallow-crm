import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Portal as TooltipPortal } from "@radix-ui/react-tooltip";
import { AlertTriangle, ArrowUpRight, ChevronLeft, ChevronRight, ListChecks, Loader2, MessageSquareText, RefreshCw, Search, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessProcessorBoard } from "@/lib/access";
import { useProcessorBoard, PROCESSOR_QUERY_KEY } from "@/hooks/useProcessorBoard";
import { assessProcessorJob, compatibleProcessorAssessment, currentAssessment, processorHasTechnicianReply, processorSetupIssue, processorRowSummary, processorReviewSignature, processorStatus, processorWorkflowMessage, ProcessorReviewFailure, PROCESSOR_ACTION_HELP, PROCESSOR_STATUS_UI, PROCESSOR_TIMEZONES, type ProcessorJob, type ProcessorStatus, type ProcessorQueue } from "@/lib/processor-board";
import { automaticProcessorJobs, processorFocusHasActivity, processorReviewFocus, recordProcessorAttempt, type ProcessorAutoAttempts, type ProcessorReviewFocus } from "@/lib/processor-auto";
import { STATUS_LABELS } from "@/lib/constants";
import type { LeadStatus } from "@/types";
import { cn } from "@/lib/utils";
import { pageVariants } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ProcessorJobViewport } from "@/components/processor-board/ProcessorJobViewport";
import { ProcessorReviewEvidence } from "@/components/processor-board/ProcessorReviewEvidence";
import QuoPhoneTrigger from "@/components/leads/QuoPhoneTrigger";
import { phoneKey } from "../../supabase/functions/_shared/processor-job-status";
import { processorTrackingKey, readProcessorTracking, saveProcessorTracking } from "@/lib/processor-tracking";
import { processorLocation } from "@/lib/processor-location";
import "./ProcessorBoardPage.css";

const EMPTY_JOBS: ProcessorJob[] = [];
type ReviewIssue = { message: string; retryable: boolean; signature: string };
type PendingReview = { jobs: ProcessorJob[]; focused: boolean };
const PAGE_FILTERS = ["all", "setup", "needs_review", "take_job_update", "job_in_progress", "payment_pending", "send_dose"] as const;
const ROW_LIMITS = [5, 10, 15, 25] as const;
type PageFilter = typeof PAGE_FILTERS[number];
const time = (value: string | null) => value ? `${Number(value.slice(0, 2)) % 12 || 12}:${value.slice(3, 5)} ${Number(value.slice(0, 2)) >= 12 ? "PM" : "AM"}` : "Time missing";
function Schedule({ job }: { job: ProcessorJob }) {
  return <div className="space-y-1"><p className="font-medium tabular-nums">{job.scheduled_date ?? "Date missing"}</p>
    <p className="text-xs text-muted-foreground">{time(job.scheduled_time_start)}{job.scheduled_time_end ? ` – ${time(job.scheduled_time_end)}` : ""}</p></div>;
}
function JobLocation({ job }: { job: ProcessorJob }) {
  const location = processorLocation(job);
  return <div className="text-muted-foreground"><p className="line-clamp-2 break-words" title={location.text}>{location.text}</p>{location.note && <p className="mt-0.5 text-[9px]">{location.note}</p>}</div>;
}
function StatusPill({ status, pending }: { status: ProcessorStatus; pending?: string | null }) {
  if (pending) return <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className={cn("h-3 w-3", pending === "Checking…" && "motion-safe:animate-spin")} aria-hidden="true" />{pending}</span>;
  if (status === "scheduled") return <span className="block text-[11px] text-muted-foreground">Appointment upcoming</span>;
  const config = PROCESSOR_STATUS_UI[status];
  return <Badge variant="outline" data-processor-status={status} className={cn("processor-status gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium", config.color)}>
    <span className="h-1 w-1 rounded-full bg-current" aria-hidden="true" />{config.label}</Badge>;
}
function CheckTime({ value, now, timezone, previous = false }: { value: string | null; now: Date; timezone: string; previous?: boolean }) {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return <span className="block text-[10px] text-muted-foreground">Not checked yet</span>;
  const minutes = Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000));
  const relative = minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  const exact = new Date(timestamp).toLocaleString([], { timeZone: timezone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  return <div className="text-[10px] text-muted-foreground"><time dateTime={value ?? undefined} title={exact} className="block">{previous ? "Previous check" : "Checked"} {relative}</time><span className="block" aria-label="Last checked date and time">{exact}</span></div>;
}
export default function ProcessorBoardPage() {
  const { user, role } = useAuth();
  if (!canAccessProcessorBoard(role)) return <p role="alert">Processor Board is restricted to Admin and Processor.</p>;
  return <ProcessorBoard key={`${user?.id}:${role}:${user?.last_sign_in_at}`} />;
}
function ProcessorBoard() {
  const { user, role, canAccess } = useAuth();
  const reduceMotion = useReducedMotion();
  const preferenceKey = processorTrackingKey(user?.id ?? "", role ?? "", user?.last_sign_in_at);
  const [preference] = useState(() => readProcessorTracking(preferenceKey));
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ offset: 0, search: "", history: false, timezone: preference.timezone });
  const [statusFilter, setStatusFilter] = useState<PageFilter>("all");
  const [savedStatusFilter, setSavedStatusFilter] = useState("all");
  const [rowLimit, setRowLimit] = useState<number>(5);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatReview, setChatReview] = useState<{ jobId: string; phone: string; conversationId: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, ReviewIssue>>({});
  const [progress, setProgress] = useState<{ done: number; total: number; job?: string; leadId?: string; automatic?: boolean } | null>(null);
  const [autoTracking, setAutoTracking] = useState(preference.automatic);
  const [timezoneConfirmed, setTimezoneConfirmed] = useState(preference.confirmed);
  const [queuedManualIds, setQueuedManualIds] = useState<string[]>([]);
  const manualQueued = queuedManualIds.length > 0;
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== "hidden");
  const [notice, setNotice] = useState("");
  const [lastRun, setLastRun] = useState<{ summary: string; details: string } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const inFlight = useRef(false);
  const stopRequested = useRef(false);
  const mounted = useRef(true);
  const autoAttempts = useRef<ProcessorAutoAttempts>(new Map());
  const latestRows = useRef<ProcessorJob[]>([]);
  const pendingManual = useRef<PendingReview | null>(null);
  const reviewScope = useRef<string | null>(null);
  const reviewActivity = useRef<ProcessorReviewFocus | null>(null);
  const activeJob = useRef<string | null>(null);
  const timezoneConfirmation = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const query = useProcessorBoard(filters);
  useEffect(() => {
    saveProcessorTracking(preferenceKey, { timezone: filters.timezone, confirmed: timezoneConfirmed, automatic: autoTracking });
  }, [preferenceKey, filters.timezone, timezoneConfirmed, autoTracking]);
  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    const visibility = () => {
      const visible = document.visibilityState !== "hidden";
      setPageVisible(visible);
      if (!visible) {
        stopRequested.current = true;
        if (pendingManual.current) {
          pendingManual.current = null;
          setQueuedManualIds([]);
          setNotice("Queued manual check cancelled because this tab is hidden. Completed results are retained.");
        }
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => { mounted.current = false; stopRequested.current = true; pendingManual.current = null; window.clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((f) => ({ ...f, offset: 0, search: search.trim() })), 350);
    return () => window.clearTimeout(timer);
  }, [search]);
  const rows = query.data?.rows ?? EMPTY_JOBS;
  latestRows.current = rows;
  const selected = rows.find((job) => job.id === selectedId);
  const canReadTechChat = role === "admin" || canAccess?.("tech_quick_chat") === true;
  const chatJob = canReadTechChat && chatReview ? rows.find((job) => job.id === chatReview.jobId &&
    phoneKey(job.tech_number) === chatReview.phone && job.chat_setup?.state === "ready" && job.chat_setup.conversation_id === chatReview.conversationId) : null;
  reviewScope.current = selected?.id ?? chatJob?.id ?? null;
  useEffect(() => { if (chatReview && !chatJob) setChatReview(null); }, [chatReview, chatJob]);
  function openReview(id: string) {
    // Focus immediately, before the next promise continuation can start another job.
    const returningToFocus = reviewScope.current === id;
    reviewScope.current = id;
    const job = latestRows.current.find((row) => row.id === id);
    const focus = job ? processorReviewFocus(job, filters.timezone) : null;
    if (!returningToFocus || reviewActivity.current?.identity !== focus?.identity) reviewActivity.current = focus;
    if (inFlight.current) stopRequested.current = true;
    if (pendingManual.current && (!pendingManual.current.focused || !pendingManual.current.jobs.some((job) => job.id === id))) {
      pendingManual.current = null;
      setQueuedManualIds([]);
    }
    setSelectedId(id);
  }
  function closeReview() {
    reviewScope.current = null;
    reviewActivity.current = null;
    if (pendingManual.current?.focused) {
      pendingManual.current = null;
      setQueuedManualIds([]);
      setNotice("Queued job check cancelled because its review was closed. An in-flight check may still finish.");
    }
    setSelectedId(null);
  }
  const issues = useMemo(() => new Map(rows.flatMap((job) => {
    const error = errors[job.id];
    return error?.signature === processorReviewSignature(job, filters.timezone) ? [[job.id, error] as const] : [];
  })), [rows, errors, filters.timezone]);
  const awaitingAutomaticCheck = (job: ProcessorJob) => autoTracking && pageVisible && !selected && !chatJob && !query.isError && query.data?.monitoring?.ai_configured && job.chat_setup?.state === "ready" && !compatibleProcessorAssessment(job, filters.timezone);
  const displayStatus = (job: ProcessorJob): ProcessorStatus => {
    if (processorSetupIssue(job) || issues.has(job.id) || ((!timezoneConfirmed || awaitingAutomaticCheck(job)) && !["job_in_progress", "payment_pending", "partial_paid"].includes(job.status))) return "needs_review";
    const status = processorStatus(job, filters.timezone, now);
    return status === "unavailable" ? "needs_review" : status;
  };
  const savedStatuses = [...new Set([...rows.map((job) => job.status), ...(savedStatusFilter === "all" ? [] : [savedStatusFilter])])].sort();
  const visible = rows.filter((job) => (savedStatusFilter === "all" || job.status === savedStatusFilter) && (statusFilter === "all" || (statusFilter === "setup" ? !!processorSetupIssue(job) : displayStatus(job) === statusFilter)));
  // At most 25 rows: reuse exactly the displayed decision, not a second subtly
  // different status implementation for counts/filters.
  const counts: Partial<Record<ProcessorStatus, number>> = {};
  for (const job of rows) { const status = displayStatus(job); counts[status] = (counts[status] ?? 0) + 1; }
  const setupCount = rows.filter((job) => !!processorSetupIssue(job)).length;
  const retryableJobs = rows.filter((job) => !processorSetupIssue(job) && issues.get(job.id)?.retryable);
  const latestCheck = rows.reduce<string | null>((latest, job) => job.checked_at && Number.isFinite(Date.parse(job.checked_at)) && (!latest || Date.parse(job.checked_at) > Date.parse(latest)) ? job.checked_at : latest, null);
  const reviewNote = (job: ProcessorJob) => processorSetupIssue(job) || issues.get(job.id)?.message || (!timezoneConfirmed ? "Confirm the schedule timezone before checking this job." : processorRowSummary(job, filters.timezone, now));
  const freshChecks = timezoneConfirmed ? rows.flatMap((job) => { const a = currentAssessment(job, filters.timezone, now); return a && !processorSetupIssue(job) && !issues.has(job.id) ? [a] : []; }) : [];
  const verifiedUpdates = freshChecks.filter(processorHasTechnicianReply).length;
  const contextUpdates = freshChecks.filter((a) => (a.context_technician_messages ?? 0) > 0 && !(a.matched_technician_messages ?? 0)).length;
  const jobStatus = (job: ProcessorJob, compact = false) => {
    const assessment = compatibleProcessorAssessment(job, filters.timezone);
    const pending = !assessment && !processorSetupIssue(job) && !issues.has(job.id) && timezoneConfirmed
      ? progress?.leadId === job.id ? "Checking…" : queuedManualIds.includes(job.id) ? "Queued for check" : awaitingAutomaticCheck(job) ? "Queued for check" : null : null;
    return <div className={compact ? "processor-cell-status space-y-0.5" : "space-y-1.5"}>
    <CheckTime value={job.checked_at} now={now} timezone={filters.timezone} previous={!timezoneConfirmed || !!processorSetupIssue(job) || issues.has(job.id) || !currentAssessment(job, filters.timezone, now)} />
    <StatusPill status={displayStatus(job)} pending={pending} />
    <p className={cn("text-[10px] leading-snug", issues.has(job.id) ? "text-destructive" : "text-muted-foreground")}>{reviewNote(job)}</p>
  </div>;
  };
  async function refreshAi(jobs: ProcessorJob[], skipFresh = false, automatic = false, focused = false) {
    if (!timezoneConfirmed) { setNotice("Confirm the saved schedules' timezone before starting any manual or automatic check. No timezone was inferred."); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    stopRequested.current = false;
    const eligible = jobs.filter((job) => !processorSetupIssue(job) && (!skipFresh || !currentAssessment(job, filters.timezone, new Date())));
    setProgress({ done: 0, total: eligible.length, automatic }); setNotice("");
    let failed = 0; let done = 0; let verified = 0;
    const attempted = new Set<string>();
    try {
      for (const [index, job] of eligible.entries()) {
        if (!mounted.current || stopRequested.current || (automatic && (document.visibilityState === "hidden" || (reviewScope.current && !focused))) || (focused && reviewScope.current !== job.id)) break;
        const live = latestRows.current.find((row) => row.id === job.id);
        if (!live || processorReviewSignature(live, filters.timezone) !== processorReviewSignature(job, filters.timezone)) continue;
        activeJob.current = job.id;
        setProgress({ done: index, total: eligible.length, job: job.job_id, leadId: job.id, automatic });
        attempted.add(job.id);
        try {
          const response = await assessProcessorJob(job.id, filters.timezone);
          if (processorHasTechnicianReply(response.result)) verified++;
          recordProcessorAttempt(autoAttempts.current, job, filters.timezone, Date.now(), true);
          // Advance only the activity actually read, not a newer message that
          // arrived during this request. Its changed fingerprint needs a follow-up.
          if (reviewScope.current === job.id && reviewActivity.current?.identity === processorReviewFocus(job, filters.timezone).identity) reviewActivity.current = processorReviewFocus(job, filters.timezone);
          // Show each successful result immediately, but never attach it to a changed record.
          queryClient.setQueryData<ProcessorQueue>([...PROCESSOR_QUERY_KEY, user?.id, role, filters], (old) => old ? { ...old, rows: old.rows.map((row) => row.id === job.id && row.updated_at === response.result.lead_updated_at && processorReviewSignature(row, filters.timezone) === processorReviewSignature(job, filters.timezone) && (!row.chat_setup || row.chat_setup.fingerprint === response.result.chat_fingerprint) ? { ...row, assessment: response.result, checked_at: response.result.checked_at } : row) } : old);
          if (mounted.current) setErrors((prev) => { const next = { ...prev }; delete next[job.id]; return next; });
        } catch (error) {
          failed++;
          const retryable = error instanceof ProcessorReviewFailure ? error.retryable : true;
          recordProcessorAttempt(autoAttempts.current, job, filters.timezone, Date.now(), false, retryable);
          if (mounted.current) setErrors((prev) => ({ ...prev, [job.id]: { message: error instanceof Error ? error.message : "Review unavailable. Retry.", retryable, signature: processorReviewSignature(job, filters.timezone) } }));
        }
        done++;
        if (mounted.current) setProgress({ done, total: eligible.length, automatic });
      }
      // Recovery list reads must not keep completed AI controls locked. The query
      // owns read errors; individual successful results are already cached above.
      if (done) void queryClient.invalidateQueries({ queryKey: [...PROCESSOR_QUERY_KEY, user?.id, role] }).catch(() => { /* Query errors stay visible. */ });
      if (mounted.current) {
        const summary = `${done - failed} checked · ${failed} failed${done < eligible.length ? ` · ${eligible.length - done} not started` : ""}. Saved statuses unchanged.`;
        const details = `${automatic ? "Automatic check: " : ""}${done - failed} reviewed · ${failed} failed · ${jobs.length - eligible.length} skipped (setup needed or evidence still fresh)${done < eligible.length ? ` · ${eligible.length - done} not started` : ""}. ${verified} with a technician reply tied to the job · ${done - failed - verified} without a tied technician reply. ${failed ? "See row details; retry failed jobs without rechecking successful reviews. " : ""}No lead statuses or messages were changed.`;
        setLastRun({ summary, details });
        setNotice(summary);
      }
    } finally {
      inFlight.current = false;
      activeJob.current = null;
      if (mounted.current) {
        setProgress(null);
        const pending = pendingManual.current;
        pendingManual.current = null;
        setQueuedManualIds([]);
        // Never race the active save; retire jobs whose scope/identity changed.
        if (pending && document.visibilityState !== "hidden") {
          const current = pending.jobs.flatMap((job) => {
            if (attempted.has(job.id)) return [];
            if (pending.focused && reviewScope.current !== job.id) return [];
            const live = latestRows.current.find((row) => row.id === job.id);
            return live && processorReviewSignature(live, filters.timezone) === processorReviewSignature(job, filters.timezone) ? [live] : [];
          });
          if (current.length) void autoReviewRef.current(current, false, false, pending.focused);
          else setNotice("Queued jobs were already attempted or left this board scope. Review their latest results or row errors; no duplicate check was started.");
        } else if (pending) {
          setNotice("Queued manual check cancelled because this tab is hidden. Return and refresh AI when ready; completed results are retained.");
        }
      }
    }
  }
  function manualReview(jobs: ProcessorJob[], focused = false) {
    if (!timezoneConfirmed) {
      setNotice("Confirm the saved schedules' timezone below once to enable AI checks. This confirmation is remembered only for your signed-in browser tab; no timezone is guessed.");
      timezoneConfirmation.current?.focus();
      return;
    }
    if (inFlight.current) {
      // A selected job already in flight is reused, not invoked a second time.
      if (focused && jobs[0]?.id === activeJob.current) { stopRequested.current = true; return; }
      if ((!focused && !progress?.automatic) || pendingManual.current) return;
      pendingManual.current = { jobs, focused };
      setQueuedManualIds(jobs.map((job) => job.id));
      stopRequested.current = true;
      if (!focused) setAutoTracking(false);
      setNotice(focused ? `Only #${jobs[0].job_id} is queued after the current request. No other page checks will start while this review is open.` : "Manual check queued after the current automatic job. Automatic tracking is paused; completed reviews will be retained.");
      return;
    }
    void refreshAi(jobs, false, false, focused);
  }
  const autoReviewRef = useRef(refreshAi);
  autoReviewRef.current = refreshAi;
  const autoReady = query.data?.monitoring?.ai_configured === true && timezoneConfirmed;
  useEffect(() => {
    const focused = selected ?? chatJob;
    if (focused) {
      const next = processorReviewFocus(focused, filters.timezone);
      if (reviewActivity.current?.identity !== next.identity) { reviewActivity.current = next; return; }
      // Opening Review never invokes AI. Only later activity in this exact saved
      // conversation can auto-refresh it; unrelated page jobs stay paused.
      if (!processorFocusHasActivity(reviewActivity.current, focused, filters.timezone)) return;
    } else reviewActivity.current = null;
    if (!autoTracking || !pageVisible || !autoReady || progress || query.isFetching || query.isError) return;
    const candidates = automaticProcessorJobs(focused ? [focused] : rows, filters.timezone, now, autoAttempts.current);
    if (candidates.length) void autoReviewRef.current(candidates, true, true, Boolean(focused));
  }, [autoTracking, pageVisible, autoReady, progress, query.isFetching, query.isError, rows, filters.timezone, now, selected, chatJob]);
  const selectedStatus = selected ? displayStatus(selected) : "needs_review";
  const selectedChecking = Boolean(selected && progress?.leadId === selected.id);
  const selectedQueued = Boolean(selected && queuedManualIds.includes(selected.id));
  const viewportResetKey = JSON.stringify([filters, statusFilter, savedStatusFilter]);
  return <div className="processor-board mx-auto max-w-[1600px] space-y-3">
    <motion.section variants={pageVariants} initial={reduceMotion ? false : "initial"} animate="animate" className="processor-panel glass-panel overflow-hidden rounded-[26px] dark:shadow-none" aria-label="Scheduled jobs">
      <div className="processor-titlebar flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2"><span className={cn("h-2 w-2 shrink-0 rounded-full", autoTracking && pageVisible && autoReady && !query.isError && !selected && !chatJob ? "bg-destructive status-pulse" : "bg-muted-foreground")} aria-hidden="true" />
          <h1 className="text-sm font-semibold">Processor Board</h1>
          <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-destructive" aria-label="Total matching jobs">{query.data?.total ?? "—"}</span></div>
        <div className="flex flex-wrap items-center gap-2">
          <div aria-label="Latest job check on this page" className="hidden items-center gap-1 text-[10px] text-muted-foreground sm:flex">Latest on page · <CheckTime value={latestCheck} now={now} timezone={filters.timezone} /></div>
          <Button size="sm" variant="outline" className="processor-ai-button h-7 gap-1.5 border-border/60 text-[11px]" disabled={manualQueued || (!!progress && !progress.automatic) || query.isError || !visible.some((j) => !processorSetupIssue(j))} onClick={() => manualReview(visible)}>
            {progress ? <Loader2 className="mr-1.5 h-3 w-3 motion-safe:animate-spin" /> : <Sparkles className="mr-1.5 h-3 w-3" />}
            {manualQueued ? "Manual check queued" : progress?.automatic ? "Refresh AI next · this page" : progress ? `Reviewing ${progress.done}/${progress.total}` : "Refresh AI · this page"}</Button>
          {progress && <Button variant="ghost" onClick={() => { stopRequested.current = true; pendingManual.current = null; setQueuedManualIds([]); setAutoTracking(false); setNotice("Stopping after the current job. Completed reviews will be retained."); }}>Stop after current job</Button>}
        </div>
      </div>
      {progress && <div role="status" className="space-y-2 px-4 py-3"><div className="flex justify-between text-xs text-muted-foreground"><span>{progress.automatic ? "Automatic · " : ""}{progress.job ? `Checking #${progress.job}` : "Preparing reviews"}</span><span>{progress.done} / {progress.total}</span></div><div role="progressbar" aria-label="Job review progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-primary to-sky-400 motion-safe:transition-[width]" style={{ width: `${progress.total ? progress.done / progress.total * 100 : 0}%` }} /></div></div>}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-start gap-1.5"><ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" /><span>{filters.history ? "Scheduled job history" : "Unfinished scheduled-job radar"} · Includes other saved statuses, not just Scheduled. AI never changes saved statuses.</span></span>
        <span className="text-[11px] text-muted-foreground">{query.isFetching ? "Refreshing…" : query.data ? `Board read ${new Date(query.data.observed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not loaded"} · reads every 30s</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-1.5 text-[10px] text-muted-foreground" aria-label="Tracking summary">
        <Badge variant="outline" aria-label="Automatic tracking state">{!autoTracking ? "Tracking paused" : !pageVisible ? "Tracking paused · hidden tab" : !timezoneConfirmed ? "Tracking not started · confirm timezone" : !autoReady ? "Tracking unavailable · backend setup" : query.isError ? "Tracking paused · board read failed" : selected || chatJob ? "Page checks paused · reviewing one job" : progress?.automatic ? "Tracking · checking jobs" : "Tracking enabled · loaded page only"}</Badge>
        <label className="flex items-center gap-2"><input ref={timezoneConfirmation} type="checkbox" aria-label="Confirm schedule timezone" checked={timezoneConfirmed} disabled={!!progress} onChange={(e) => setTimezoneConfirmed(e.target.checked)} />Schedule time confirmed · {filters.timezone.replace(/_/g, " ")}</label>
        <span>{rows.length} loaded / {query.data?.total ?? "—"} matching · newest schedules first</span>
      </div>
      {query.data?.monitoring && (query.data.monitoring.evidence_policy ?? 0) < 6 && <p role="alert" className="px-4 py-2 text-xs text-amber-700 dark:text-amber-300">The latest-job / keyword AI filter is awaiting backend deployment. Previous checks may use the earlier job-specific review scope.</p>}
      {query.data?.monitoring && (query.data.monitoring.evidence_policy ?? 0) >= 6 && (query.data.monitoring.evidence_policy ?? 0) < 7 && <p role="alert" className="px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">The clearer job-attribution review checks are awaiting backend deployment. Verify unclear updates in Review.</p>}
      <details className="processor-options border-b px-4 py-2 text-[11px] text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Filters & tracking</summary>
      <div className="processor-toolbar my-2 flex flex-col gap-3 rounded-xl border p-3 xl:flex-row xl:items-end">
        <label className="space-y-1 text-[11px] text-muted-foreground">Schedule timezone
          <select aria-label="Schedule timezone" className="block h-10 w-full rounded-xl border bg-background px-3 text-xs text-foreground" disabled={!!progress} value={filters.timezone} onChange={(e) => { setErrors({}); setTimezoneConfirmed(false); setFilters({ ...filters, timezone: e.target.value, offset: 0 }); }}>
            {PROCESSOR_TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
          </select></label>
        <label className="flex h-10 items-center gap-2 whitespace-nowrap text-xs"><input type="checkbox" checked={filters.history} disabled={!!progress} onChange={(e) => { setSelectedId(null); setSavedStatusFilter("all"); setFilters({ ...filters, history: e.target.checked, offset: 0 }); }} />Include closed/history</label>
        <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={query.isFetching || !!progress} onClick={() => void query.refetch()}><RefreshCw className={cn("mr-1.5 h-3 w-3", query.isFetching && "motion-safe:animate-spin")} />Refresh board</Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-[11px] text-muted-foreground" aria-label="Automatic tracking controls">
        <label className="flex items-center gap-2"><input type="checkbox" aria-label="Automatic AI tracking" checked={autoTracking} onChange={(e) => { setAutoTracking(e.target.checked); if (!e.target.checked) stopRequested.current = true; }} />Automatic AI tracking · this page</label>
        <p>{!autoTracking ? "Paused. Manual checks remain available." : !pageVisible ? "Paused while this tab is hidden." : selected || chatJob ? "Other page checks pause during Review/chat. New chat activity can refresh only this job; close to resume the page." : !timezoneConfirmed ? "Confirm the schedule timezone to start automatic checks; no timezone is inferred from the state." : !query.data?.monitoring ? "Automatic checks need the updated Processor Board backend." : !query.data.monitoring.ai_configured ? "AI is not configured; ask Admin to check server setup." : `Watching ${rows.length} loaded jobs · fresh checks reused for 5 minutes · retries use backoff.`}</p>
        {query.data?.monitoring && !query.data.monitoring.current_history_configured && <p>Current Quo access is unavailable. Mirror-only checks cannot establish non-response or Send Dose.</p>}
        {query.data?.monitoring && (query.data.monitoring.evidence_policy ?? 0) < 5 && <p className="text-amber-700 dark:text-amber-300">The job-context AI update is not active on this backend. Ask Admin to deploy the latest Processor Board function; existing checks may not attribute replies that omit job identifiers.</p>}
      </div>
      <div aria-label="Evidence quality on this page" className="px-4 py-2 text-[11px] text-muted-foreground">{freshChecks.length} fresh successful checks · {verifiedUpdates} with a technician reply tied to the job · {freshChecks.length - verifiedUpdates} without a tied technician reply.{contextUpdates ? ` ${contextUpdates} rely on this job's saved dispatch; verify in Quo before acting.` : ""} Saved In Progress / Payment Pending labels alone are not AI findings.</div>
      <div aria-label="Action counts on this page" className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <span className="text-[10px] text-muted-foreground">On this page</span>
        <TooltipProvider delayDuration={200}>{(["take_job_update", "job_in_progress", "payment_pending", "send_dose"] as const).map((status) => <Tooltip key={status}><TooltipTrigger asChild><button data-processor-status={status} onClick={() => setStatusFilter(statusFilter === status ? "all" : status)} aria-pressed={statusFilter === status}
          className="processor-filter inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />{PROCESSOR_STATUS_UI[status].label}<span className="processor-filter-count rounded-full px-1.5 py-0.5 tabular-nums">{counts[status] ?? 0}</span>
        </button></TooltipTrigger><TooltipPortal><TooltipContent side="top" collisionPadding={8} className="max-w-[min(21rem,calc(100vw-1rem))] text-xs leading-relaxed"><p className="font-semibold">{PROCESSOR_STATUS_UI[status].label}</p><p className="mt-1">{PROCESSOR_ACTION_HELP[status]}</p><p className="mt-2 text-muted-foreground">Filters this loaded page only · advisory action, not a saved status change.</p></TooltipContent></TooltipPortal></Tooltip>)}</TooltipProvider>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
        <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs text-muted-foreground">This page
          <select aria-label="Filter this page" className="h-9 rounded-xl border bg-background px-2 text-xs text-foreground" value={statusFilter} onChange={(e) => { const value = PAGE_FILTERS.find((filter) => filter === e.target.value); if (value) setStatusFilter(value); }}>
            {PAGE_FILTERS.map((filter) => <option key={filter} value={filter}>{filter === "all" ? `All ${rows.length} jobs` : filter === "setup" ? `Setup needed (${setupCount})` : `${PROCESSOR_STATUS_UI[filter].label} (${counts[filter] ?? 0})`}</option>)}
          </select></label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Saved status · this page
            <select aria-label="Saved status on this page" className="h-9 rounded-xl border bg-background px-2 text-xs text-foreground" value={savedStatusFilter} onChange={(e) => setSavedStatusFilter(e.target.value)}>
              <option value="all">All saved statuses</option>{savedStatuses.map((status) => <option key={status} value={status}>{STATUS_LABELS[status as LeadStatus] ?? status}</option>)}
            </select></label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Rows in view
            <select aria-label="Rows in view" className="h-9 rounded-xl border bg-background px-2 text-xs text-foreground" value={rowLimit} onChange={(e) => { const value = ROW_LIMITS.find((limit) => limit === Number(e.target.value)); if (value) setRowLimit(value); }}>
              {ROW_LIMITS.map((limit) => <option key={limit} value={limit}>Show {limit}</option>)}
            </select></label></div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {!!setupCount && <button className="flex items-center gap-1 text-amber-700 underline-offset-4 hover:underline dark:text-amber-300" onClick={() => setStatusFilter("setup")}><AlertTriangle className="h-3.5 w-3.5" />{setupCount} need setup / saved-record review</button>}
          {!!retryableJobs.length && <Button size="sm" variant="outline" disabled={manualQueued || (!!progress && !progress.automatic) || query.isError} onClick={() => manualReview(retryableJobs)}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry failed · {retryableJobs.length}</Button>}
        </div>
      </div>
      <details className="px-4 py-3 text-[11px] text-muted-foreground"><summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">How checks, freshness & timezone work</summary>
          <div className="mt-2 space-y-1.5 leading-relaxed"><p>Schedule times use the timezone above, not the customer's state. Checks use current Quo texts when available, otherwise saved Tech Quick Chat texts, plus saved structured call transcripts from the same verified technician chat. Only that job's attributable texts and speaker-verified call segments reach AI. Missing transcripts and unknown speakers are reported, never treated as a passed check. Summaries, audio alone and reactions are not proof.</p>
          <p>Previously scheduled jobs stay on radar until paid, cancelled or job done/completed. Incomplete scheduled records remain visible for repair; AI waits for a valid assigned technician number and appointment. Pending approvals and reschedules still require existing saved-record actions. Newest appointment date/time comes first; ties use newest job creation. Undated records appear last. Location uses saved city/state, then the full address, then the partial address; nothing is guessed or changed.</p>
          <p>AI interprets job-linked technician messages, not authorization. A reply that names the job is direct evidence; a reply that follows this job's unique saved dispatch in the same 1:1 thread is context-attributed and is labelled so it can be verified in Quo. A reply after another job's dispatch, or one that mentions another job, is never used. Each row identifies whether the action comes from AI evidence, the saved status or a schedule rule. An AI review with no job-linked reply is not a confirmed job outcome.</p>
          <p>Both manual and automatic checks require the saved schedules' timezone to be confirmed. Your explicit confirmation and tracking pause are remembered for this signed-in browser tab; changing the timezone requires confirmation again. The Schedule page stores plain date/time values and displays the browser's GMT offset; that is not proof that every saved job uses that timezone. No customer's timezone is inferred from a state or ZIP.</p>
          <p>After you confirm the schedule timezone, automatic checks cover this loaded page (up to 25 jobs), not every page or only the five rows in view. They react to saved conversation activity and the 30-second recovery read, reusing fresh results for 5 minutes. Explicit Refresh AI rechecks history even for recent results; unchanged evidence can still reuse server extraction. Opening Review pauses new page checks after the active request without invoking AI. Check this job queues only the selected job next and reuses its active request if already running. With tracking on, later chat activity rechecks only this job through Review/Tech Quick Chat; other page jobs stay paused. Closing returns to your previous tracking setting; closing an unstarted job check cancels it. A page-level manual takeover still pauses tracking explicitly. Hidden/closed tabs stop starting checks; an in-flight job may finish. No background worker runs. Setup failures wait for corrected saved details; transient failures retry with backoff.</p>
          <p>A missing technician-directory link can use one exact-number saved chat on the verified Technician Communications line. Conflicting links, wrong lines and invalid numbers are never guessed or repaired automatically.</p></div></details>
      </details>
      {notice && <div role="status" className="mx-4 mt-3 rounded-lg border bg-muted/40 p-3 text-xs"><p>{notice}</p>{lastRun?.summary === notice && <details className="mt-1 text-[10px] text-muted-foreground"><summary className="w-fit cursor-pointer">Check details</summary><p className="mt-1">{lastRun.details}</p></details>}</div>}
      {query.isError && <div role="alert" className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>{query.error.message}</p><Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>Retry loading board</Button></div>}
      {(statusFilter !== "all" || savedStatusFilter !== "all") && <div className="flex items-center gap-2 px-4 pt-3 text-xs">This page: {statusFilter === "all" ? "All actions" : statusFilter === "setup" ? "Setup needed" : PROCESSOR_STATUS_UI[statusFilter].label}{savedStatusFilter !== "all" ? ` · ${STATUS_LABELS[savedStatusFilter as LeadStatus] ?? savedStatusFilter}` : ""}<Button variant="ghost" size="sm" onClick={() => { setStatusFilter("all"); setSavedStatusFilter("all"); }}>Clear filter</Button></div>}
      <p id="processor-scroll-help" className="sr-only">{visible.length} matching jobs on this page · Scroll inside the list to see more. Rows in view only changes its height; AI refresh checks all matching jobs on this page.</p>
      {query.isLoading ? <div aria-label="Loading jobs" className="space-y-3 p-5">{[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-14 w-full" />)}</div> : !query.isError && <>
        <ProcessorJobViewport rowLimit={rowLimit} resetKey={viewportResetKey} className="processor-table hidden md:block"><Table className="table-fixed border-collapse text-xs [&_td]:px-2 [&_td]:py-2"><TableHeader className="bg-muted/20"><TableRow>
          {["Customer / job", "Service", "Technician", "AI status", "Area", "Schedule", "Terms", "Action"].map((label) => <TableHead key={label} className="h-9 px-3 text-[10px] uppercase tracking-wider">{label}</TableHead>)}
        </TableRow></TableHeader><TableBody>{visible.map((job) => <TableRow key={job.id} data-processor-status={displayStatus(job)} className="processor-row">
          <TableCell className="min-w-[130px] max-w-[180px]"><Link className="font-semibold hover:text-primary hover:underline" to={`/leads/${job.id}`}>{job.customer_name}</Link><p className="mt-1 text-[10px] text-muted-foreground">#{job.job_id} · Saved: {STATUS_LABELS[job.status as LeadStatus] ?? job.status}</p></TableCell>
          <TableCell className="max-w-[150px]"><p className="truncate text-muted-foreground" title={job.service_type ?? ""}>{job.service_type || "Service missing"}</p></TableCell>
          <TableCell className="min-w-[110px] max-w-[150px]"><p className="truncate font-medium" title={job.tech_name ?? ""}>{job.tech_name || "Not assigned"}</p><p className="mt-1 text-[10px] tabular-nums text-muted-foreground">{job.tech_number || "Number missing"}</p></TableCell>
          <TableCell className="min-w-[150px] max-w-[200px]">{jobStatus(job, true)}</TableCell>
          <TableCell className="max-w-[170px]"><JobLocation job={job} /></TableCell>
          <TableCell><Schedule job={job} /></TableCell><TableCell className="text-xs capitalize">{job.terms?.replace(/_/g, " ") || "—"}</TableCell>
           <TableCell><Button size="sm" variant="ghost" className="processor-review-button h-7 px-1 text-[11px] text-primary" aria-label={`Review ${job.job_id}`} onClick={() => openReview(job.id)}>Review<ArrowUpRight className="ml-0.5 h-3 w-3" /></Button></TableCell>
        </TableRow>)}</TableBody></Table></ProcessorJobViewport>
        <ProcessorJobViewport rowLimit={rowLimit} resetKey={viewportResetKey} className="md:hidden"><div className="divide-y">{visible.map((job) => <article key={job.id} data-processor-status={displayStatus(job)} className="processor-row space-y-3 p-4">
          <div className="flex items-center justify-between gap-2"><Link className="font-semibold" to={`/leads/${job.id}`}>{job.customer_name}</Link><span className="text-[10px] capitalize text-muted-foreground">{job.terms?.replace(/_/g, " ") || "Terms not set"}</span></div>
          {jobStatus(job, true)}
          <p className="text-xs text-muted-foreground">#{job.job_id} · {job.service_type}</p><JobLocation job={job} />
          <div className="flex items-start justify-between gap-3 text-sm"><div><p className="font-medium">{job.tech_name || "Not assigned"}</p><p className="mt-1 text-xs text-muted-foreground">{job.tech_number || "Number missing"}</p></div><Schedule job={job} /></div>
          <p className="text-[11px] text-muted-foreground">Saved: {STATUS_LABELS[job.status as LeadStatus] ?? job.status}</p>
          <Button className="w-full" variant="outline" size="sm" aria-label={`Review ${job.job_id}`} onClick={() => openReview(job.id)}>Review job & evidence<ArrowUpRight className="ml-2 h-3.5 w-3.5" /></Button>
        </article>)}</div></ProcessorJobViewport>
        {!visible.length && <div className="px-5 py-14 text-center"><ListChecks className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><p className="font-medium">No jobs in this view</p><p className="mt-1 text-xs text-muted-foreground">Try another search, clear the page filter, or include history.</p></div>}
      </>}
      <div className="border-t border-border/40 px-3 pt-3">
        <label className="relative block"><span className="sr-only">Search jobs or technicians</span><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="rounded-2xl border-border/60 bg-muted/20 pl-9" placeholder="Search customer, job ID, technician or area…" maxLength={100} value={search} disabled={!!progress} onChange={(e) => setSearch(e.target.value)} /></label>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-muted-foreground"><span>{query.data?.total ? `${filters.offset + 1}–${Math.min(filters.offset + rows.length, query.data.total)} of ${query.data.total} jobs` : "0 jobs"}</span>
        <div className="flex gap-2"><Button variant="outline" size="sm" aria-label="Previous page" disabled={!!progress || query.isFetching || filters.offset === 0} onClick={() => { setSelectedId(null); setFilters({ ...filters, offset: Math.max(0, filters.offset - 25) }); }}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" aria-label="Next page" disabled={!!progress || query.isFetching || filters.offset + 25 >= (query.data?.total ?? 0)} onClick={() => { setSelectedId(null); setFilters({ ...filters, offset: filters.offset + 25 }); }}><ChevronRight className="h-4 w-4" /></Button></div></div>
    </motion.section>
    <Sheet open={!!selected} onOpenChange={(open) => { if (!open) closeReview(); }}><SheetContent className="processor-board flex h-dvh w-full flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-lg">
      {selected && <>
        <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-primary">Job-specific review · #{selected.job_id}</div>
          <SheetTitle>{selected.customer_name}</SheetTitle><SheetDescription>{selected.service_type} · {processorLocation(selected).text}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" role="region" aria-label="Job review content" tabIndex={0}>
          <p className="text-[11px] text-muted-foreground">Other page checks pause here. With automatic tracking on, new chat activity rechecks only this job. Opening Review alone does not run AI.</p>
          {(selectedChecking || selectedQueued) && <p role="status" aria-label="This job check" className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs" aria-live="polite">{selectedChecking ? `Checking only #${selected.job_id}. Reading its assigned technician's job-specific messages; this may take up to two minutes.` : `Waiting for #${progress?.job ?? "the current request"} to finish, then checking only #${selected.job_id}. No other page jobs will be checked while this review is open.`}</p>}
          <div className="rounded-xl border bg-muted/20 p-3">{jobStatus(selected, true)}<p className="mt-2 text-sm font-medium">{PROCESSOR_STATUS_UI[selectedStatus].action}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">Saved lead status: {STATUS_LABELS[selected.status as LeadStatus] ?? selected.status}</p>
            {processorWorkflowMessage(selected.status) && <p className="mt-2 text-xs text-muted-foreground">{processorWorkflowMessage(selected.status)}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs"><div><p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Technician</p><p className="font-medium">{selected.tech_name || "Not assigned"}</p><p className="mt-1">{selected.tech_number || "Number missing"}</p></div><div><p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Agreed schedule</p><Schedule job={selected} /><p className="mt-1 text-[10px] text-muted-foreground">{filters.timezone}</p></div></div>
          {selected.customer_schedule_requirements && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">Customer schedule requirements</summary><p className="mt-2 whitespace-pre-wrap">{selected.customer_schedule_requirements}</p></details>}
          {(processorSetupIssue(selected) || issues.has(selected.id)) && <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs"><p className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />{processorSetupIssue(selected) ? "Saved details need attention" : "Review could not finish"}</p><p>{reviewNote(selected)}</p><p className="mt-2 text-muted-foreground">{processorSetupIssue(selected) || issues.get(selected.id)?.retryable === false ? "Correct the saved record or technician chat setup before checking again. Use Open saved lead; never infer missing phone digits." : "Previous evidence is retained. Retry this job without rechecking successful jobs."}</p></div>}
          <ProcessorReviewEvidence job={selected} timezone={filters.timezone} now={now} />
          {!timezoneConfirmed && <p className="text-xs text-muted-foreground">Close this review and confirm the schedule timezone in the board controls once to enable AI checks for this signed-in tab.</p>}
          {!canReadTechChat ? <p className="text-xs text-muted-foreground">Tech Quick Chat access is required. Ask Admin to verify your existing chat permission.</p> : !selected.chat_setup?.conversation_id && <p className="text-xs text-muted-foreground">No verified CRM conversation is available. Sync or verify the saved technician chat; no external Quo tab will be opened.</p>}
        </div>
        <div className="shrink-0 space-y-2 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" aria-label="Job review actions">
          <Button className="w-full" aria-label="Check this job" aria-busy={selectedChecking} disabled={!timezoneConfirmed || selectedChecking || selectedQueued || !!processorSetupIssue(selected)} onClick={() => manualReview([selected], true)}>
            {selectedChecking ? <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{selectedChecking ? "Checking this job…" : selectedQueued ? "Queued · this job only" : "Check this job"}
          </Button>
          <div className="grid grid-cols-2 gap-2"><Button className="h-auto min-h-9 whitespace-normal px-2 text-xs" variant="outline" disabled={!canReadTechChat || selected.chat_setup?.state !== "ready" || !selected.chat_setup.conversation_id || !phoneKey(selected.tech_number)} onClick={() => {
            if (!selected.chat_setup?.conversation_id || !phoneKey(selected.tech_number)) return;
            setChatReview({ jobId: selected.id, phone: phoneKey(selected.tech_number)!, conversationId: selected.chat_setup.conversation_id });
            setSelectedId(null);
          }}><MessageSquareText className="mr-1 h-3.5 w-3.5 shrink-0" />Open technician chat in CRM</Button><Button className="h-auto min-h-9 px-2 text-xs" variant="outline" asChild><Link to={`/leads/${selected.id}`}>Open saved lead<ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link></Button></div>
          <p className="text-center text-[10px] text-muted-foreground">Only #{selected.job_id} · AI is advisory · nothing is sent automatically</p>
        </div>
      </>}
    </SheetContent></Sheet>
    {chatJob && chatReview && <QuoPhoneTrigger key={`${chatJob.id}:${chatReview.conversationId}:${chatReview.phone}`} contactName={chatJob.tech_name || "Technician"} phone={chatJob.tech_number} chatType="tech" conversationId={chatReview.conversationId} defaultOpen hideTrigger readOnly onClose={() => { setChatReview(null); openReview(chatJob.id); }} />}
  </div>;
}
