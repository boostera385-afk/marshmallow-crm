import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertCircle, ArrowRight, Layers, Loader2, RefreshCw, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { canViewLeadDepartmentAnalytics } from "@/lib/access";
import { supabase } from "@/integrations/supabase/client";
import { backgroundDelay } from "@/lib/overload-guard";
import {
  buildDepartmentReport, DEPARTMENT_COLORS, DEPARTMENT_DESCRIPTIONS, DEPARTMENT_LABELS, STAGE_COLORS, STAGE_LABELS,
  STAGE_SHORT_LABELS, STAGES, type DepartmentBreakdownRow, type DepartmentReport, type DepartmentSummary,
  type ReportDepartment, type Stage,
} from "@/lib/lead-department-analytics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const EMPTY: DepartmentBreakdownRow[] = [];
const n = (value: number) => value.toLocaleString();
const pct = (value: number) => (value > 0 && value < 0.1 ? "<0.1%" : `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1)}%`);
const share = (part: number, whole: number) => pct(whole ? (part / whole) * 100 : 0);
const pendingIn = (rows: DepartmentBreakdownRow[] | undefined) =>
  (rows ?? []).some((row) => row.department === "pending" && Number(row.lead_count) > 0);
const IN_PROGRESS: Stage[] = ["waiting", "quoting", "booked", "job_done"];
const TABLE_STAGES: Stage[] = ["waiting", "quoting", "booked", "job_done", "paid", "lost"];

/** A thin horizontal bar split into coloured parts. */
function SplitBar({ parts, total, label, className }: { parts: { key: string; value: number; color: string; title: string }[]; total: number; label: string; className?: string }) {
  return (
    <div role="img" aria-label={label} className={cn("flex w-full overflow-hidden rounded-full bg-muted", className)}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.key} title={p.title} style={{ width: `${(p.value / Math.max(total, 1)) * 100}%`, backgroundColor: p.color }} />
      ))}
    </div>
  );
}

function DepartmentCard({ d, best, onDetails }: { d: DepartmentSummary; best: boolean; onDetails: () => void }) {
  const inProgress = IN_PROGRESS.reduce((acc, s) => acc + d.stages[s], 0);
  return (
    <Card className="flex flex-col rounded-2xl">
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: DEPARTMENT_COLORS[d.key] }} aria-hidden />
              {DEPARTMENT_LABELS[d.key]}
            </h3>
            {best && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"><Trophy className="h-3 w-3" />Best paid rate</span>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{DEPARTMENT_DESCRIPTIONS[d.key]}</p>
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums" aria-label={`${DEPARTMENT_LABELS[d.key]}: ${d.total} leads`}>{n(d.total)}</p>
          <p className="text-xs text-muted-foreground">leads · {pct(d.share)} of all leads</p>
        </div>
        <SplitBar className="h-2" total={d.total} label={`${DEPARTMENT_LABELS[d.key]} leads by stage`}
          parts={STAGES.map((s) => ({ key: s, value: d.stages[s], color: STAGE_COLORS[s], title: `${STAGE_LABELS[s]}: ${n(d.stages[s])}` }))} />
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-emerald-500/10 px-2 py-2"><dt className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Paid</dt><dd className="text-lg font-bold tabular-nums">{n(d.stages.paid)}</dd><dd className="text-[11px] text-muted-foreground">{pct(d.paidRate)}</dd></div>
          <div className="rounded-xl bg-blue-500/10 px-2 py-2"><dt className="text-[11px] font-medium text-blue-700 dark:text-blue-300">In progress</dt><dd className="text-lg font-bold tabular-nums">{n(inProgress)}</dd><dd className="text-[11px] text-muted-foreground">{share(inProgress, d.total)}</dd></div>
          <div className="rounded-xl bg-rose-500/10 px-2 py-2"><dt className="text-[11px] font-medium text-rose-700 dark:text-rose-300">Cancelled</dt><dd className="text-lg font-bold tabular-nums">{n(d.stages.lost)}</dd><dd className="text-[11px] text-muted-foreground">{share(d.stages.lost, d.total)}</dd></div>
        </dl>
        <Button variant="ghost" size="sm" className="mt-auto justify-between" onClick={onDetails}>See every status<ArrowRight className="h-3.5 w-3.5" /></Button>
      </CardContent>
    </Card>
  );
}

/** Presentational report; all numbers come from the server's exact counts. */
export function LeadDepartmentReportView({ report, updatedAt, refreshing, onRefresh }: { report: DepartmentReport; updatedAt?: number; refreshing?: boolean; onRefresh?: () => void }) {
  // "Other JellyBean" is usually a handful of leads: it stays in the legend and table, but only gets a card once it matters.
  const listed = report.departments.filter((d) => d.key !== "Other" || d.total > 0);
  const carded = report.departments.filter((d) => d.key !== "Other" || d.total >= 10);
  const [selected, setSelected] = useState<ReportDepartment>(carded.find((d) => d.total > 0)?.key ?? "ND");
  const detailsRef = useRef<HTMLDivElement>(null);
  const detail = report.departments.find((d) => d.key === selected) ?? report.departments[0];
  const biggest = Math.max(1, ...detail.statuses.map((row) => row.count));
  const openDetails = (key: ReportDepartment) => {
    setSelected(key);
    detailsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="space-y-5" aria-label="Leads by Department report">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Leads by Department</h2>
          <p className="mt-1 text-sm text-muted-foreground">Which JellyBean team each lead came from (matched by phone number), and what happened to it.</p>
        </div>
        {onRefresh && <div className="flex items-center gap-3">
          {updatedAt ? <span className="text-xs text-muted-foreground">Updated {format(updatedAt, "h:mm a")}</span> : null}
          <Button variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}><RefreshCw className={cn("mr-2 h-3.5 w-3.5", refreshing && "animate-spin")} />Refresh</Button>
        </div>}
      </div>

      {!report.total ? (
        <div className="rounded-2xl border border-dashed p-10 text-center"><Layers className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h3 className="font-semibold">No leads in this period</h3><p className="mt-1 text-sm text-muted-foreground">Try a wider date range, or All Time for older leads.</p></div>
      ) : <>
        {/* 1. Where leads came from */}
        <Card className="rounded-2xl">
          <CardContent className="space-y-4 p-5 sm:p-6">
            <p className="text-base sm:text-lg">
              <strong className="text-2xl font-bold tabular-nums sm:text-3xl">{n(report.inJellybean)}</strong>
              <span className="text-muted-foreground"> of {n(report.total)} leads ({share(report.inJellybean, report.total)}) came from JellyBean</span>
            </p>
            <SplitBar className="h-4" total={report.total} label="Share of leads by department"
              parts={[
                ...report.departments.map((d) => ({ key: d.key as string, value: d.total, color: DEPARTMENT_COLORS[d.key], title: `${DEPARTMENT_LABELS[d.key]}: ${n(d.total)}` })),
                { key: "pending", value: report.pending, color: DEPARTMENT_COLORS.pending, title: `Still checking: ${n(report.pending)}` },
              ]} />
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {listed.map((d) => (
                <li key={d.key} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DEPARTMENT_COLORS[d.key] }} aria-hidden />
                  <span>{DEPARTMENT_LABELS[d.key]}</span>
                  <span className="font-semibold tabular-nums">{n(d.total)}</span>
                  <span className="text-muted-foreground tabular-nums">({pct(d.share)})</span>
                </li>
              ))}
            </ul>
            {report.pending > 0 && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{n(report.pending)} new lead{report.pending === 1 ? " is" : "s are"} still being checked. This updates by itself every minute.</p>}
          </CardContent>
        </Card>

        {/* 2. One card per department */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {carded.map((d) => <DepartmentCard key={d.key} d={d} best={report.bestPaidRate === d.key} onDetails={() => openDetails(d.key)} />)}
        </div>

        {/* 3. Side-by-side comparison by stage */}
        <Card className="overflow-hidden rounded-2xl">
          <CardContent className="p-0">
            <div className="p-5 pb-3">
              <h3 className="font-semibold">Compare departments</h3>
              <p className="mt-1 text-xs text-muted-foreground">Where each department&apos;s leads are now. The percentage is out of that department&apos;s leads.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-y text-xs text-muted-foreground">
                    <th scope="col" className="sticky left-0 z-10 bg-card px-5 py-2.5 text-left font-medium">Department</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Leads</th>
                    {TABLE_STAGES.map((s) => <th key={s} scope="col" className="px-3 py-2.5 text-right font-medium"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_COLORS[s] }} aria-hidden />{STAGE_SHORT_LABELS[s]}</span></th>)}
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Paid rate</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map((d) => (
                    <tr key={d.key} className="border-b last:border-0">
                      <th scope="row" className="sticky left-0 z-10 bg-card px-5 py-3 text-left font-medium"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DEPARTMENT_COLORS[d.key] }} aria-hidden />{DEPARTMENT_LABELS[d.key]}</span></th>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{n(d.total)}</td>
                      {TABLE_STAGES.map((s) => (
                        <td key={s} className="px-3 py-3 text-right tabular-nums">
                          <div className={cn(!d.stages[s] && "text-muted-foreground/50")}>{n(d.stages[s])}</div>
                          <div className="text-[11px] text-muted-foreground">{share(d.stages[s], d.total)}</div>
                        </td>
                      ))}
                      <td className="px-5 py-3 text-right">
                        <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", report.bestPaidRate === d.key ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted")}>{pct(d.paidRate)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* 4. Every status for one department */}
        <Card ref={detailsRef} className="scroll-mt-4 rounded-2xl">
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-semibold">Every status for one department</h3>
                <p className="mt-1 text-xs text-muted-foreground">Pick a department to see exactly how many of its leads are in each status.</p>
              </div>
              <ToggleGroup type="single" value={selected} onValueChange={(v) => v && setSelected(v as ReportDepartment)} aria-label="Department" className="flex-wrap justify-start">
                {carded.map((d) => <ToggleGroupItem key={d.key} value={d.key} size="sm" className="gap-1.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: DEPARTMENT_COLORS[d.key] }} aria-hidden />{DEPARTMENT_LABELS[d.key]}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
            {!detail.total ? <p className="py-6 text-center text-sm text-muted-foreground">No {DEPARTMENT_LABELS[detail.key]} leads in this period.</p> : (
              <div className="gap-8 lg:columns-2" aria-label={`${DEPARTMENT_LABELS[detail.key]} leads by status`}>
                {STAGES.filter((s) => detail.stages[s] > 0).map((s) => (
                  <div key={s} className="mb-6 break-inside-avoid">
                    <div className="mb-2 flex items-center justify-between border-b pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_COLORS[s] }} aria-hidden />{STAGE_LABELS[s]}</span>
                      <span className="tabular-nums">{n(detail.stages[s])} · {share(detail.stages[s], detail.total)}</span>
                    </div>
                    <ul className="space-y-2.5">
                      {detail.statuses.filter((row) => row.stage === s).map((row) => (
                        <li key={row.status} className="text-sm">
                          <div className="flex items-baseline justify-between gap-3">
                            <span>{row.label}</span>
                            <span className="shrink-0 tabular-nums"><span className="font-semibold">{n(row.count)}</span> <span className="text-xs text-muted-foreground">{share(row.count, detail.total)}</span></span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full" style={{ width: `${Math.max((row.count / biggest) * 100, 1.5)}%`, backgroundColor: STAGE_COLORS[s] }} /></div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </>}
    </section>
  );
}

export function LeadDepartmentReport({ startMs, endMs, rangeError }: { startMs: number; endMs: number; rangeError?: string | null }) {
  const { role, user } = useAuth();
  const allowed = canViewLeadDepartmentAnalytics(role);
  const effectiveRangeError = rangeError || (!Number.isFinite(startMs) || !Number.isFinite(endMs)
    ? "Choose valid start and end dates."
    : startMs > endMs ? "Start date must be on or before the end date." : null);
  const query = useQuery({
    queryKey: ["admin-lead-department-breakdown", user?.id, startMs, endMs],
    enabled: allowed && !effectiveRangeError,
    // Aggregated on the server (one small row per department x status); no lead rows are downloaded.
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc("get_lead_department_breakdown", { p_start: new Date(startMs).toISOString(), p_end: new Date(endMs).toISOString() })
        .abortSignal(signal);
      if (error) throw new Error(error.message);
      return (data ?? []) as DepartmentBreakdownRow[];
    },
    // Only while new leads are still being checked against JellyBean (about a minute).
    refetchInterval: (q) => (pendingIn(q.state.data) ? backgroundDelay(60_000) : false),
  });
  const rows = query.data ?? EMPTY;
  const report = useMemo(() => buildDepartmentReport(rows), [rows]);

  if (!allowed) return null;
  if (effectiveRangeError) return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">{effectiveRangeError}</div>;
  if (query.isPending) return <div role="status" aria-label="Loading department report" className="space-y-4"><Skeleton className="h-36 rounded-2xl" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}</div><Skeleton className="h-64 rounded-2xl" /></div>;
  if (query.isError) return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5"><p className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" />Could not load the department report</p><p className="mt-2 text-sm text-muted-foreground">{query.error.message}</p><Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>;

  return <LeadDepartmentReportView key={`${startMs}:${endMs}`} report={report} updatedAt={query.dataUpdatedAt} refreshing={query.isFetching} onRefresh={() => void query.refetch()} />;
}
