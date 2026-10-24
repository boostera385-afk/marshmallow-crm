import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, ChevronDown, ListChecks, Loader2, MessageSquareText, RefreshCw, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessProcessorBoard } from "@/lib/access";
import { useProcessorBoard, PROCESSOR_QUERY_KEY } from "@/hooks/useProcessorBoard";
import { useIsMobile } from "@/hooks/use-mobile";
import { assessProcessorJob, processorCheckSignature, processorShareNote, processorSchedulePassed, processorSetupIssue, processorSummary, ProcessorReviewFailure, PROCESSOR_BOARD_STATUSES, PROCESSOR_STATUS_UI, PROCESSOR_TIMEZONES, type ProcessorFilters, type ProcessorJob, type ProcessorStatus } from "@/lib/processor-board";
import { processorTrackingKey, readProcessorTracking, saveProcessorTracking } from "@/lib/processor-tracking";
import { cn } from "@/lib/utils";
import { pageVariants } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ProcessorReviewPanel } from "@/components/processor-board/ProcessorReviewPanel";
import QuoPhoneTrigger from "@/components/leads/QuoPhoneTrigger";
import "./ProcessorBoardPage.css";

const EMPTY_JOBS: ProcessorJob[] = [];
type CheckIssue = { message: string; retryable: boolean; signature: string };
const time = (value: string | null) => value ? `${Number(value.slice(0, 2)) % 12 || 12}:${value.slice(3, 5)} ${Number(value.slice(0, 2)) >= 12 ? "PM" : "AM"}` : null;
const shortDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
const terms = (value: string | null) => value === "free_estimate" ? "Free Estimate" : value === "quoted" ? "Quoted" : value ? value.replace(/_/g, " ") : "—";

function Schedule({ job, overdue }: { job: ProcessorJob; overdue: boolean }) {
  if (!job.scheduled_date) return <span className="text-muted-foreground">Not scheduled</span>;
  const start = time(job.scheduled_time_start);
  const end = time(job.scheduled_time_end);
  return <div className={cn("leading-tight", overdue ? "font-semibold text-red-500" : "text-muted-foreground")} data-overdue={overdue || undefined}>
    <p className="tabular-nums">{shortDate(job.scheduled_date)}</p>
    <p className="text-[10px] tabular-nums">{start ? `${start}${end ? ` – ${end}` : ""}` : "Time missing"}</p>
    {overdue && <span className="sr-only">Appointment time has passed</span>}
  </div>;
}
function StatusPill({ status }: { status: ProcessorStatus }) {
  return <span data-processor-status={status} className={cn("inline-flex max-w-full items-center truncate rounded-full border px-1.5 py-0.5 text-[11px] font-medium", PROCESSOR_STATUS_UI[status].color)} title={PROCESSOR_STATUS_UI[status].help}>{PROCESSOR_STATUS_UI[status].label}</span>;
}

export default function ProcessorBoardPage() {
  const { user, role } = useAuth();
  if (!canAccessProcessorBoard(role)) return <p role="alert">Processor Board is restricted to Admin and Processor.</p>;
  return <ProcessorBoard key={`${user?.id}:${role}:${user?.last_sign_in_at}`} />;
}

function ProcessorBoard() {
  const { user, role, canAccess } = useAuth();
  const reduceMotion = useReducedMotion();
  // One layout at a time, so each review/action exists once in the page.
  const isMobile = useIsMobile();
  const preferenceKey = processorTrackingKey(user?.id ?? "", role ?? "", user?.last_sign_in_at);
  const [preference] = useState(() => readProcessorTracking(preferenceKey));
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ProcessorFilters>({ search: "", timezone: preference.timezone, aiStatus: null });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, CheckIssue>>({});
  // At most one explicit single-job check at a time. Nothing runs on page load:
  // the server checks jobs when a message arrives or the lead changes, and daily.
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const mounted = useRef(true);
  const queryClient = useQueryClient();
  const query = useProcessorBoard(filters);
  const rows = query.data?.rows ?? EMPTY_JOBS;
  const canChat = role === "admin" || canAccess?.("tech_quick_chat") === true;
  const chatJob = chatJobId ? rows.find((job) => job.id === chatJobId) : undefined;

  useEffect(() => { saveProcessorTracking(preferenceKey, { timezone: filters.timezone }); }, [preferenceKey, filters.timezone]);
  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((f) => f.search === search.trim() ? f : { ...f, search: search.trim() }), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Errors belong to the exact job version that failed; a changed job starts clean.
  const issueFor = (job: ProcessorJob) => { const issue = errors[job.id]; return issue?.signature === processorCheckSignature(job) ? issue : undefined; };
  async function checkJob(job: ProcessorJob) {
    if (checkingId || processorSetupIssue(job)) return;
    setCheckingId(job.id);
    try {
      await assessProcessorJob(job.id, filters.timezone);
      if (mounted.current) setErrors((prev) => { const next = { ...prev }; delete next[job.id]; return next; });
    } catch (error) {
      if (mounted.current) setErrors((prev) => ({ ...prev, [job.id]: { message: error instanceof Error ? error.message : "Check unavailable. Try again.", retryable: error instanceof ProcessorReviewFailure ? error.retryable : true, signature: processorCheckSignature(job) } }));
    } finally {
      if (mounted.current) setCheckingId(null);
      // The saved status and counts come from the server; read them once.
      void queryClient.invalidateQueries({ queryKey: [...PROCESSOR_QUERY_KEY, user?.id, role] }).catch(() => { /* Query error stays visible. */ });
    }
  }

  const counts = query.data?.counts ?? {};
  const latestCheck = rows.reduce<number | null>((latest, job) => { const at = Date.parse(job.checked_at ?? ""); return Number.isFinite(at) && (latest === null || at > latest) ? at : latest; }, null);
  const setStatusFilter = (aiStatus: ProcessorStatus | null) => { setExpandedId(null); setFilters((f) => ({ ...f, aiStatus })); };
  const shareLine = (job: ProcessorJob) => {
    const note = processorShareNote(job, filters.timezone);
    return note && <p className={cn("mt-0.5 truncate text-[10px] font-medium", note.attention ? "text-red-600 dark:text-red-400" : "text-foreground/80")} title={note.text}>{note.text}</p>;
  };
  const rowNote = (job: ProcessorJob) => {
    if (checkingId === job.id) return <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden="true" />Checking…</span>;
    if (issueFor(job)) return <span className="text-destructive">Check failed</span>;
    if (job.board_status === "wrong_tech_number") return <span className="text-orange-700 dark:text-orange-300">Fix the tech number on the lead</span>;
    if (processorSetupIssue(job)) return <span className="text-amber-700 dark:text-amber-300">Setup needed</span>;
    if (!processorSummary(job)) return "Waiting for its first server check";
    const checked = job.checked_at ? `Checked ${formatDistanceToNow(new Date(job.checked_at), { addSuffix: true })}` : "Checked";
    return job.ai_stale ? `${checked} · new activity, server re-checks soon` : checked;
  };
  const actions = (job: ProcessorJob, expanded: boolean) => <div className="flex items-center justify-end gap-1">
    <Button size="sm" variant="ghost" className="h-7 px-1.5 text-[11px]" aria-label={`Tech chat for ${job.job_id}`} disabled={!canChat || !job.tech_number} onClick={() => setChatJobId(job.id)}><MessageSquareText className="h-3.5 w-3.5" /><span className="ml-1 hidden xl:inline">Chat</span></Button>
    <Button size="sm" variant={expanded ? "secondary" : "ghost"} className="h-7 px-1.5 text-[11px]" aria-expanded={expanded} aria-controls={`review-${job.id}`} aria-label={`Review ${job.job_id}`} onClick={() => setExpandedId(expanded ? null : job.id)}>Review<ChevronDown className={cn("ml-0.5 h-3 w-3 transition-transform", expanded && "rotate-180")} /></Button>
    <Button size="sm" variant="ghost" className="h-7 px-1.5 text-[11px]" asChild><Link to={`/leads/${job.id}`} aria-label={`Open lead ${job.job_id}`}>Open<ArrowUpRight className="ml-0.5 h-3 w-3" /></Link></Button>
  </div>;
  const panel = (job: ProcessorJob) => <ProcessorReviewPanel job={job} timezone={filters.timezone} checking={checkingId === job.id} busy={!!checkingId && checkingId !== job.id} error={issueFor(job)} canChat={canChat && !!job.tech_number}
    onCheck={() => void checkJob(job)} onChat={() => setChatJobId(job.id)} />;

  return <div className="processor-board mx-auto max-w-[1600px] space-y-3">
    <motion.section variants={pageVariants} initial={reduceMotion ? false : "initial"} animate="animate" aria-label="Processor Board"
      className="processor-panel glass-panel overflow-hidden rounded-[26px] shadow-[0_28px_54px_-34px_rgba(59,130,246,0.22)] dark:shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-destructive status-pulse" aria-hidden="true" />
          <h1 className="text-sm font-semibold text-foreground">Processor Board</h1>
          <span className="rounded-full bg-destructive/12 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-destructive" aria-label="Jobs on the board">{query.data?.all_total ?? "—"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {latestCheck !== null && <span className="hidden text-[11px] text-muted-foreground sm:inline" title={new Date(latestCheck).toLocaleString()}>Updated {formatDistanceToNow(new Date(latestCheck), { addSuffix: true })}</span>}
          <Button size="sm" variant="outline" className="h-7 gap-1.5 border-border/60 text-[11px]" disabled={query.isFetching} onClick={() => void query.refetch()} title="Reload the board. AI checks run on the server.">
            <RefreshCw className={cn("h-3 w-3", query.isFetching && "motion-safe:animate-spin")} />Refresh</Button>
          <span className="hidden text-[11px] text-muted-foreground md:inline">Showing <b className="tabular-nums text-foreground">{query.data?.total ?? "—"}</b></span>
        </div>
      </div>

      <div role="group" aria-label="Filter by AI status" className="flex flex-wrap items-center gap-1.5 border-b border-border/40 px-4 py-2">
        <button type="button" aria-pressed={filters.aiStatus === null} onClick={() => setStatusFilter(null)}
          className={cn("processor-filter inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", filters.aiStatus === null ? "border-foreground/40 bg-foreground/10" : "border-border/60 text-muted-foreground")}>
          All<span className="tabular-nums">{query.data?.all_total ?? 0}</span></button>
        {PROCESSOR_BOARD_STATUSES.map((status) => <button key={status} type="button" data-processor-status={status} aria-pressed={filters.aiStatus === status} title={PROCESSOR_STATUS_UI[status].help} onClick={() => setStatusFilter(filters.aiStatus === status ? null : status)}
          className={cn("processor-filter inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", PROCESSOR_STATUS_UI[status].color, filters.aiStatus === status && "ring-2 ring-current/30")}>
          {PROCESSOR_STATUS_UI[status].label}<span className="tabular-nums">{counts[status] ?? 0}</span></button>)}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/40 px-4 py-2 text-[11px] text-muted-foreground">
        <label className="relative min-w-[220px] flex-1"><span className="sr-only">Search jobs or technicians</span><Search className="absolute left-2.5 top-2 h-3.5 w-3.5" aria-hidden="true" />
          <Input className="h-8 rounded-xl border-border/60 bg-muted/20 pl-8 text-xs" placeholder="Search lead, job ID, technician, service or area…" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label className="flex items-center gap-1.5">Schedule timezone
          <select aria-label="Schedule timezone" className="h-8 rounded-lg border bg-background px-2 text-xs text-foreground" value={filters.timezone} onChange={(e) => setFilters((f) => ({ ...f, timezone: e.target.value }))}>
            {PROCESSOR_TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ").replace("America/", "")}</option>)}
          </select></label>
        <span>{query.data?.monitoring && !query.data.monitoring.ai_configured ? "AI is not configured on the server; ask Admin." : "Opening the board never runs AI. The server checks a job when a new message comes or the lead changes, and completed unpaid jobs once a day."}</span>
      </div>

      {query.data?.monitoring && !query.data.monitoring.current_history_configured && <p className="border-b border-border/40 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">Current Quo history is unavailable; checks read the CRM chat mirror. Confirm silence in Quo before sending a dose.</p>}
      {query.isError && <div role="alert" className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>{query.error.message}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void query.refetch()}>Retry loading board</Button></div>}

      {query.isLoading ? <div aria-label="Loading jobs" className="space-y-2 p-4">{[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-10 w-full" />)}</div> : !query.isError && <>
        {!isMobile ? <div className="processor-table max-h-[70vh] overflow-auto" role="region" aria-label="Board jobs" tabIndex={0}>
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="w-[15%] px-2 py-1.5 font-semibold">Lead</th>
                <th className="w-[13%] px-2 py-1.5 font-semibold">Technician</th>
                <th className="w-[13%] px-2 py-1.5 font-semibold">Service</th>
                <th className="w-[8%] px-2 py-1.5 font-semibold">Terms</th>
                <th className="w-[11%] px-2 py-1.5 font-semibold">Schedule</th>
                <th className="w-[16%] px-2 py-1.5 font-semibold">AI Status</th>
                <th className="w-[16%] px-2 py-1.5 text-right font-semibold">Actions</th>
                <th className="w-[8%] px-2 py-1.5 text-right font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>{rows.map((job) => {
              const expanded = expandedId === job.id;
              return <Fragment key={job.id}>
                <tr data-processor-status={job.board_status} className={cn("processor-row border-t border-border/40 align-top transition-colors hover:bg-muted/40", expanded && "bg-muted/30")}>
                  <td className="px-2 py-2"><p className="truncate font-medium text-foreground" title={job.customer_name ?? ""}>{job.customer_name || "Name missing"}</p><p className="truncate text-[10px] text-muted-foreground">#{job.job_id}</p></td>
                  <td className="px-2 py-2"><p className="truncate text-foreground" title={job.tech_name ?? ""}>{job.tech_name || "Name missing"}</p><p className="truncate text-[10px] tabular-nums text-muted-foreground">{job.tech_number || "Number missing"}</p></td>
                  <td className="px-2 py-2"><p className="truncate text-muted-foreground" title={job.service_type ?? ""}>{job.service_type || "—"}</p></td>
                  <td className="px-2 py-2 capitalize text-foreground">{terms(job.terms)}</td>
                  <td className="px-2 py-2"><Schedule job={job} overdue={processorSchedulePassed(job, filters.timezone, now)} /></td>
                  <td className="px-2 py-2"><StatusPill status={job.board_status} />{shareLine(job)}<p className="mt-0.5 truncate text-[10px] text-muted-foreground">{rowNote(job)}</p></td>
                  <td className="px-2 py-1.5">{actions(job, expanded)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right text-muted-foreground">{new Date(job.created_at).toLocaleDateString()}</td>
                </tr>
                {expanded && <tr id={`review-${job.id}`}><td colSpan={8} className="px-2 pb-3">{panel(job)}</td></tr>}
              </Fragment>;
            })}</tbody>
          </table>
        </div> : <div className="divide-y divide-border/40">{rows.map((job) => {
          const expanded = expandedId === job.id;
          return <article key={job.id} data-processor-status={job.board_status} className="processor-row space-y-2 p-3 text-xs">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-medium">{job.customer_name || "Name missing"}</p><p className="text-[10px] text-muted-foreground">#{job.job_id} · {new Date(job.created_at).toLocaleDateString()}</p></div><StatusPill status={job.board_status} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><p>{job.tech_name || "Name missing"}</p><p className="text-[10px] text-muted-foreground">{job.tech_number || "Number missing"}</p></div>
              <Schedule job={job} overdue={processorSchedulePassed(job, filters.timezone, now)} />
              <p className="text-muted-foreground">{job.service_type || "—"}</p><p className="capitalize">{terms(job.terms)}</p>
            </div>
            {shareLine(job)}<p className="text-[10px] text-muted-foreground">{rowNote(job)}</p>
            {actions(job, expanded)}
            {expanded && <div id={`review-${job.id}`}>{panel(job)}</div>}
          </article>;
        })}</div>}
        {!rows.length && <div className="px-5 py-12 text-center"><ListChecks className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" aria-hidden="true" /><p className="font-medium">No jobs in this view</p><p className="mt-1 text-xs text-muted-foreground">{filters.aiStatus || filters.search ? "Try another search or status." : "No assigned, unfinished jobs right now."}</p></div>}
      </>}

      <div className="border-t border-border/40 px-4 py-2.5 text-xs text-muted-foreground">
        {query.data ? `${query.data.total} job${query.data.total === 1 ? "" : "s"} · newest leads first` : "0 jobs"}
      </div>
    </motion.section>
    {chatJob && <QuoPhoneTrigger key={chatJob.id} contactName={chatJob.tech_name || "Technician"} phone={chatJob.tech_number} chatType="tech" conversationId={chatJob.chat_setup?.state === "ready" ? chatJob.chat_setup.conversation_id ?? undefined : undefined} defaultOpen hideTrigger onClose={() => setChatJobId(null)} />}
  </div>;
}
