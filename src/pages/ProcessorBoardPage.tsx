import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, CheckCheck, ChevronLeft, ChevronRight, Clock3, ListChecks, Loader2, MessageSquareText, RefreshCw, Search, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessProcessorBoard } from "@/lib/access";
import { useProcessorBoard, PROCESSOR_QUERY_KEY } from "@/hooks/useProcessorBoard";
import { assessProcessorJob, currentAssessment, processorReadiness, processorStatus, ProcessorReviewFailure, PROCESSOR_STATUS_UI, PROCESSOR_TIMEZONES, type ProcessorJob, type ProcessorStatus, type ProcessorQueue } from "@/lib/processor-board";
import { STATUS_LABELS } from "@/lib/constants";
import type { LeadStatus } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const EMPTY_JOBS: ProcessorJob[] = [];
type ReviewIssue = { message: string; retryable: boolean; revision: string; timezone: string };
const PAGE_FILTERS = ["all", "setup", "unavailable", "needs_review", "scheduled", "take_job_update", "job_in_progress", "payment_pending", "send_dose"] as const;
type PageFilter = typeof PAGE_FILTERS[number];
const time = (value: string | null) => value ? `${Number(value.slice(0, 2)) % 12 || 12}:${value.slice(3, 5)} ${Number(value.slice(0, 2)) >= 12 ? "PM" : "AM"}` : "Time missing";
function Schedule({ job }: { job: ProcessorJob }) {
  return <div className="space-y-1"><p className="font-medium tabular-nums">{job.scheduled_date ?? "Date missing"}</p>
    <p className="text-xs text-muted-foreground">{time(job.scheduled_time_start)}{job.scheduled_time_end ? ` – ${time(job.scheduled_time_end)}` : ""}</p></div>;
}
function StatusPill({ status }: { status: ProcessorStatus }) {
  const config = PROCESSOR_STATUS_UI[status];
  return <Badge variant="outline" className={cn("gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold", config.color)}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{config.label}</Badge>;
}
export default function ProcessorBoardPage() {
  const { user, role } = useAuth();
  if (!canAccessProcessorBoard(role)) return <p role="alert">Processor Board is restricted to Admin and Processor.</p>;
  return <ProcessorBoard key={`${user?.id}:${role}`} />;
}
function ProcessorBoard() {
  const { user, role } = useAuth();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ offset: 0, search: "", history: false, timezone: "America/New_York" });
  const [statusFilter, setStatusFilter] = useState<PageFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, ReviewIssue>>({});
  const [progress, setProgress] = useState<{ done: number; total: number; job?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => new Date());
  const inFlight = useRef(false);
  const stopRequested = useRef(false);
  const mounted = useRef(true);
  const queryClient = useQueryClient();
  const query = useProcessorBoard(filters);
  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((f) => ({ ...f, offset: 0, search: search.trim() })), 350);
    return () => window.clearTimeout(timer);
  }, [search]);
  const rows = query.data?.rows ?? EMPTY_JOBS;
  const selected = rows.find((job) => job.id === selectedId);
  const issues = useMemo(() => new Map(rows.flatMap((job) => {
    const error = errors[job.id];
    return error?.revision === job.updated_at && error.timezone === filters.timezone ? [[job.id, error] as const] : [];
  })), [rows, errors, filters.timezone]);
  const displayStatus = (job: ProcessorJob): ProcessorStatus => processorReadiness(job) ? "needs_review" : issues.has(job.id) ? "unavailable" : processorStatus(job, filters.timezone, now);
  const visible = rows.filter((job) => statusFilter === "all" || (statusFilter === "setup" ? !!processorReadiness(job) : displayStatus(job) === statusFilter));
  const counts = useMemo(() => {
    const result: Partial<Record<ProcessorStatus, number>> = {};
    for (const job of rows) { const s = processorReadiness(job) ? "needs_review" : issues.has(job.id) ? "unavailable" : processorStatus(job, filters.timezone, now); result[s] = (result[s] ?? 0) + 1; }
    return result;
  }, [rows, filters.timezone, now, issues]);
  const setupCount = rows.filter((job) => !!processorReadiness(job)).length;
  const retryableJobs = rows.filter((job) => !processorReadiness(job) && issues.get(job.id)?.retryable);
  const reviewNote = (job: ProcessorJob) => processorReadiness(job) || issues.get(job.id)?.message || (currentAssessment(job, filters.timezone, now) ? "Evidence checked · review source quotes" : job.checked_at ? "Review stale · refresh AI" : "Saved record / schedule rule · not AI checked");
  async function refreshAi(jobs: ProcessorJob[], skipFresh = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    stopRequested.current = false;
    const eligible = jobs.filter((job) => !processorReadiness(job) && (!skipFresh || !currentAssessment(job, filters.timezone, now)));
    setProgress({ done: 0, total: eligible.length }); setNotice("");
    let failed = 0; let done = 0;
    try {
      for (const [index, job] of eligible.entries()) {
        if (!mounted.current || stopRequested.current) break;
        setProgress({ done: index, total: eligible.length, job: job.job_id });
        try {
          const response = await assessProcessorJob(job.id, filters.timezone);
          // Show each successful result immediately, but never attach it to a changed record.
          queryClient.setQueryData<ProcessorQueue>([...PROCESSOR_QUERY_KEY, user?.id, role, filters], (old) => old ? { ...old, rows: old.rows.map((row) => row.id === job.id && row.updated_at === response.result.lead_updated_at ? { ...row, assessment: response.result, checked_at: response.result.checked_at } : row) } : old);
          if (mounted.current) setErrors((prev) => { const next = { ...prev }; delete next[job.id]; return next; });
        } catch (error) {
          failed++;
          if (mounted.current) setErrors((prev) => ({ ...prev, [job.id]: { message: error instanceof Error ? error.message : "Review unavailable. Retry.", retryable: error instanceof ProcessorReviewFailure ? error.retryable : true, revision: job.updated_at, timezone: filters.timezone } }));
        }
        done++;
        if (mounted.current) setProgress({ done, total: eligible.length });
      }
      if (done) await queryClient.invalidateQueries({ queryKey: [...PROCESSOR_QUERY_KEY, user?.id, role] });
      if (mounted.current) setNotice(`${done - failed} reviewed · ${failed} failed · ${jobs.length - eligible.length} skipped (setup needed or evidence still fresh)${done < eligible.length ? ` · ${eligible.length - done} not started` : ""}. ${failed ? "See row details; retry failed jobs without rechecking successful reviews. " : ""}No lead statuses or messages were changed.`);
    } finally { inFlight.current = false; if (mounted.current) setProgress(null); }
  }
  const selectedAssessment = selected ? currentAssessment(selected, filters.timezone, now) : null;
  const selectedStatus = selected ? displayStatus(selected) : "needs_review";
  return <div className="mx-auto max-w-[1600px] space-y-6">
    <section className="relative overflow-hidden rounded-2xl border bg-card p-5 sm:p-7">
      <div className="pointer-events-none absolute -right-12 -top-24 h-72 w-72 rounded-full bg-primary/5 blur-3xl" />
      <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
        <div><div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.18em] text-primary"><ListChecks className="h-4 w-4" />Dispatch workspace</div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Processor Board</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">Every scheduled job. The right technician. One clear next action.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={query.isFetching || !!progress} onClick={() => void query.refetch()}><RefreshCw className={cn("mr-2 h-3.5 w-3.5", query.isFetching && "animate-spin")} />Refresh board</Button>
          <Button disabled={!!progress || query.isError || !visible.some((j) => !processorReadiness(j))} onClick={() => void refreshAi(visible, true)}>
            {progress ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {progress ? `Reviewing ${progress.done}/${progress.total}` : "Refresh AI · this page"}</Button>
          {progress && <Button variant="ghost" onClick={() => { stopRequested.current = true; setNotice("Stopping after the current job. Completed reviews will be retained."); }}>Stop after current job</Button>}
        </div>
      </div>
      {progress && <div role="status" className="mt-4 space-y-2"><div className="flex justify-between text-xs text-muted-foreground"><span>{progress.job ? `Checking #${progress.job}` : "Preparing reviews"}</span><span>{progress.done} / {progress.total}</span></div><div role="progressbar" aria-label="Job review progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? progress.done / progress.total * 100 : 0}%` }} /></div></div>}
      <div className="mt-5 flex items-start gap-2 border-t pt-4 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
        <span>Job-specific evidence only. AI labels are advisory—not saved lead status changes. Payment approvals stay protected.</span></div>
    </section>

    <section aria-label="Action counts on this page" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {(["take_job_update", "job_in_progress", "payment_pending", "send_dose"] as const).map((status, i) => {
        const Icon = [Clock3, Wrench, CheckCheck, MessageSquareText][i];
        return <button key={status} onClick={() => setStatusFilter(statusFilter === status ? "all" : status)} aria-pressed={statusFilter === status}
          className={cn("rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", statusFilter === status && "border-primary bg-primary/5")}>
          <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-muted-foreground">{PROCESSOR_STATUS_UI[status].label}</span><Icon className="h-4 w-4 text-muted-foreground" /></div>
          <div className="mt-3 flex items-baseline gap-2"><span className="text-2xl font-semibold tabular-nums">{counts[status] ?? 0}</span><span className="text-[11px] text-muted-foreground">on this page</span></div>
        </button>;
      })}
    </section>

    <section className="overflow-hidden rounded-2xl border bg-card" aria-label="Scheduled jobs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-primary" />{filters.history ? "Scheduled job history" : "Active scheduled jobs"}
          <Badge variant="secondary" className="tabular-nums">{query.data?.total ?? "—"}</Badge></div>
        <span className="text-[11px] text-muted-foreground">{query.isFetching ? "Refreshing…" : query.data ? `Board read ${new Date(query.data.observed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not loaded"} · reads every 30s</span>
      </div>
      <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 xl:flex-row xl:items-end">
        <label className="relative flex-1"><span className="sr-only">Search jobs or technicians</span><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search customer, job ID, technician or area…" maxLength={100} value={search} disabled={!!progress} onChange={(e) => setSearch(e.target.value)} /></label>
        <label className="space-y-1 text-[11px] text-muted-foreground">Schedule timezone
          <select aria-label="Schedule timezone" className="block h-10 w-full rounded-md border bg-background px-3 text-xs text-foreground" disabled={!!progress} value={filters.timezone} onChange={(e) => { setErrors({}); setFilters({ ...filters, timezone: e.target.value, offset: 0 }); }}>
            {PROCESSOR_TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
          </select></label>
        <label className="flex h-10 items-center gap-2 whitespace-nowrap text-xs"><input type="checkbox" checked={filters.history} disabled={!!progress} onChange={(e) => { setSelectedId(null); setFilters({ ...filters, history: e.target.checked, offset: 0 }); }} />Include closed/history</label>
      </div>
      <p className="px-4 pt-3 text-[11px] text-muted-foreground">Schedule times use the timezone above, not the customer's state. AI reads the saved Quo chat (CRM mirror if direct access is unavailable). Calls need manual review.</p>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">This page
          <select aria-label="Filter this page" className="h-9 rounded-md border bg-background px-2 text-xs text-foreground" value={statusFilter} onChange={(e) => { const value = PAGE_FILTERS.find((filter) => filter === e.target.value); if (value) setStatusFilter(value); }}>
            {PAGE_FILTERS.map((filter) => <option key={filter} value={filter}>{filter === "all" ? `All ${rows.length} jobs` : filter === "setup" ? `Setup needed (${setupCount})` : `${PROCESSOR_STATUS_UI[filter].label} (${counts[filter] ?? 0})`}</option>)}
          </select></label>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {!!setupCount && <button className="flex items-center gap-1 text-amber-700 underline-offset-4 hover:underline dark:text-amber-300" onClick={() => setStatusFilter("setup")}><AlertTriangle className="h-3.5 w-3.5" />{setupCount} need setup / saved-record review</button>}
          {!!retryableJobs.length && <Button size="sm" variant="outline" disabled={!!progress || query.isError} onClick={() => void refreshAi(retryableJobs)}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry failed · {retryableJobs.length}</Button>}
        </div>
      </div>
      <p className="px-4 pt-2 text-[11px] text-muted-foreground">Page refresh skips incomplete jobs and evidence checked within 5 minutes. Open a job to recheck it explicitly. Filters and counts apply to this page only.</p>
      {notice && <p role="status" className="mx-4 mt-3 rounded-lg border bg-muted/40 p-3 text-xs">{notice}</p>}
      {query.isError && <div role="alert" className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>{query.error.message}</p><Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>Retry loading board</Button></div>}
      {statusFilter !== "all" && <div className="flex items-center gap-2 px-4 pt-3 text-xs">This page: {statusFilter === "setup" ? "Setup needed" : PROCESSOR_STATUS_UI[statusFilter].label}<Button variant="ghost" size="sm" onClick={() => setStatusFilter("all")}>Clear filter</Button></div>}
      {query.isLoading ? <div aria-label="Loading jobs" className="space-y-3 p-5">{[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-14 w-full" />)}</div> : !query.isError && <>
        <div className="hidden md:block"><Table><TableHeader><TableRow>
          {["Customer / job", "Technician", "AI status", "Area / service", "Schedule", "Terms", "Action"].map((label) => <TableHead key={label} className="text-[10px] uppercase tracking-wider">{label}</TableHead>)}
        </TableRow></TableHeader><TableBody>{visible.map((job) => <TableRow key={job.id} className={cn(issues.has(job.id) && "bg-destructive/[.025]", !!processorReadiness(job) && "bg-amber-500/[.025]")}>
          <TableCell><Link className="font-semibold hover:text-primary hover:underline" to={`/leads/${job.id}`}>{job.customer_name}</Link><p className="mt-1 text-[11px] text-muted-foreground">#{job.job_id}</p><p className="mt-1 text-[10px] text-muted-foreground">Saved: {STATUS_LABELS[job.status as LeadStatus] ?? job.status}</p></TableCell>
          <TableCell><p className="font-medium">{job.tech_name || "Not assigned"}</p><p className="mt-1 text-xs tabular-nums text-muted-foreground">{job.tech_number || "Number missing"}</p></TableCell>
          <TableCell className="min-w-[180px] max-w-[260px]"><StatusPill status={displayStatus(job)} /><p className={cn("mt-1.5 text-[11px] leading-relaxed", issues.has(job.id) ? "text-destructive" : "text-muted-foreground")}>{reviewNote(job)}</p></TableCell>
          <TableCell className="max-w-[190px]"><p className="truncate" title={[job.city, job.state].filter(Boolean).join(", ")}>{[job.city, job.state].filter(Boolean).join(", ") || "Area missing"}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={job.service_type ?? ""}>{job.service_type || "Service missing"}</p></TableCell>
          <TableCell><Schedule job={job} /></TableCell><TableCell className="text-xs capitalize">{job.terms?.replace(/_/g, " ") || "—"}</TableCell>
          <TableCell><Button size="sm" variant="ghost" aria-label={`Review ${job.job_id}`} onClick={() => setSelectedId(job.id)}>Review<ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Button></TableCell>
        </TableRow>)}</TableBody></Table></div>
        <div className="divide-y md:hidden">{visible.map((job) => <article key={job.id} className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><Link className="font-semibold" to={`/leads/${job.id}`}>{job.customer_name}</Link><StatusPill status={displayStatus(job)} /></div>
          <p className="text-xs text-muted-foreground">#{job.job_id} · {job.service_type} · {[job.city, job.state].filter(Boolean).join(", ")}</p>
          <div className="flex items-start justify-between gap-3 text-sm"><div><p className="font-medium">{job.tech_name || "Not assigned"}</p><p className="mt-1 text-xs text-muted-foreground">{job.tech_number || "Number missing"}</p></div><Schedule job={job} /></div>
          <p className="text-[11px] text-muted-foreground">Saved: {STATUS_LABELS[job.status as LeadStatus] ?? job.status}</p>
          <p className={cn("text-xs leading-relaxed", issues.has(job.id) ? "text-destructive" : "text-muted-foreground")}>{reviewNote(job)}</p>
          <Button className="w-full" variant="outline" size="sm" aria-label={`Review ${job.job_id}`} onClick={() => setSelectedId(job.id)}>Review job & evidence<ArrowUpRight className="ml-2 h-3.5 w-3.5" /></Button>
        </article>)}</div>
        {!visible.length && <div className="px-5 py-14 text-center"><ListChecks className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" /><p className="font-medium">No jobs in this view</p><p className="mt-1 text-xs text-muted-foreground">Try another search, clear the page filter, or include history.</p></div>}
      </>}
      <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground"><span>{query.data?.total ? `${filters.offset + 1}–${Math.min(filters.offset + rows.length, query.data.total)} of ${query.data.total} jobs` : "0 jobs"}</span>
        <div className="flex gap-2"><Button variant="outline" size="sm" aria-label="Previous page" disabled={!!progress || query.isFetching || filters.offset === 0} onClick={() => { setSelectedId(null); setFilters({ ...filters, offset: Math.max(0, filters.offset - 25) }); }}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" aria-label="Next page" disabled={!!progress || query.isFetching || filters.offset + 25 >= (query.data?.total ?? 0)} onClick={() => { setSelectedId(null); setFilters({ ...filters, offset: filters.offset + 25 }); }}><ChevronRight className="h-4 w-4" /></Button></div></div>
    </section>
    <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelectedId(null); }}><SheetContent className="w-full overflow-y-auto bg-background sm:max-w-lg">
      {selected && <><SheetHeader className="text-left"><div className="mb-2 text-[10px] font-semibold uppercase tracking-[.18em] text-primary">Job-specific review · #{selected.job_id}</div>
        <SheetTitle>{selected.customer_name}</SheetTitle><SheetDescription>{selected.service_type} · {selected.address || "Address missing"}</SheetDescription></SheetHeader>
        <div className="mt-6 space-y-6"><div className="rounded-xl border bg-muted/20 p-4"><StatusPill status={selectedStatus} /><p className="mt-3 text-sm">{PROCESSOR_STATUS_UI[selectedStatus].action}</p>
          <p className="mt-3 text-xs text-muted-foreground">Saved lead status: {STATUS_LABELS[selected.status as LeadStatus] ?? selected.status}</p></div>
          <div className="grid grid-cols-2 gap-4 text-sm"><div><p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Technician</p><p className="font-medium">{selected.tech_name || "Not assigned"}</p><p className="mt-1 text-xs">{selected.tech_number || "Number missing"}</p></div><div><p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Agreed schedule</p><Schedule job={selected} /><p className="mt-1 text-[10px] text-muted-foreground">{filters.timezone}</p></div></div>
          {selected.customer_schedule_requirements && <div><h2 className="text-xs font-semibold">Customer schedule requirements</h2><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{selected.customer_schedule_requirements}</p></div>}
          {(processorReadiness(selected) || issues.has(selected.id)) && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><p className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{processorReadiness(selected) ? "Saved details need attention" : "Review could not finish"}</p><p className="leading-relaxed">{reviewNote(selected)}</p><p className="mt-2 text-xs text-muted-foreground">{processorReadiness(selected) || issues.get(selected.id)?.retryable === false ? "Correct the saved record or technician chat setup before checking again." : "Previous evidence is retained. Retry this job without rechecking successful jobs."}</p></div>}
          <div><h2 className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="h-4 w-4 text-primary" />Conversation evidence</h2>
            {selectedAssessment ? <><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{selectedAssessment.summary}</p><p className="mt-2 text-[11px] text-muted-foreground">{selectedAssessment.messages_reviewed} conversation events examined · {selectedAssessment.matched_messages} explicitly identify this job · {selectedAssessment.source}</p>
              <div className="mt-4 space-y-3">{selectedAssessment.evidence.map((item, index) => <blockquote key={`${item.message_id}:${index}`} className="rounded-lg border-l-2 border-primary bg-muted/30 p-3"><p className="whitespace-pre-wrap break-words text-sm">“{item.quote}”</p><footer className="mt-2 text-[10px] text-muted-foreground">{item.sender === "customer" ? "Technician" : "Our team"} · {new Date(item.message_time).toLocaleString([], { timeZone: filters.timezone })} · {item.signal.replace(/_/g, " ")}</footer></blockquote>)}</div></>
              : <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{selected.assessment ? "Previous evidence is stale or belongs to another saved schedule/timezone. Refresh this job before relying on it." : "This label comes from the saved job and schedule, not a completed AI review. Check this job to look for explicit technician evidence."}</p>}
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mb-2 h-4 w-4 text-primary" />A technician can have multiple jobs. Generic replies such as “done” are excluded. Send Dose requires acceptance, an unanswered job-specific update request, and a 60-minute wait. Review in Quo before sending anything.</div>
          <div className="flex flex-wrap gap-2"><Button disabled={!!progress || !!processorReadiness(selected)} onClick={() => void refreshAi([selected])}>{progress ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Check this job</Button><Button variant="outline" asChild><Link to={`/leads/${selected.id}`}>Open saved lead<ArrowUpRight className="ml-2 h-4 w-4" /></Link></Button></div>
        </div></>}
    </SheetContent></Sheet>
  </div>;
}
