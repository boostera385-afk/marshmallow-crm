import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertCircle, Layers, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { canViewLeadDepartmentAnalytics } from "@/lib/access";
import { supabase } from "@/integrations/supabase/client";
import { backgroundDelay } from "@/lib/overload-guard";
import {
  buildDepartmentReport, DEPARTMENT_COLORS, DEPARTMENT_DESCRIPTIONS, DEPARTMENT_KEYS, DEPARTMENT_LABELS,
  DEPARTMENT_SHORT_LABELS, type DepartmentBreakdownRow,
} from "@/lib/lead-department-analytics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const EMPTY: DepartmentBreakdownRow[] = [];
const count = (value: number) => value.toLocaleString();
const share = (value: number, total: number) => `${total ? (value / total * 100).toFixed(1) : "0.0"}%`;
const pendingIn = (rows: DepartmentBreakdownRow[] | undefined) =>
  (rows ?? []).some((row) => row.department === "pending" && Number(row.lead_count) > 0);

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
  if (query.isPending) return <div role="status" aria-label="Loading department report" className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div><Skeleton className="h-80 rounded-2xl" /></div>;
  if (query.isError) return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5"><p className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" />Could not load the department report</p><p className="mt-2 text-sm text-muted-foreground">{query.error.message}</p><Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>;

  const { totals, total, inJellybean, statuses } = report;
  return (
    <section className="space-y-5" aria-label="Leads by Department report">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-primary"><ShieldCheck className="h-3.5 w-3.5" />Admin report</div>
          <h2 className="text-xl font-semibold tracking-tight">Leads by Department</h2>
          <p className="mt-1 text-sm text-muted-foreground">Which JellyBean department each lead came from, and where those leads stand now.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Updated {format(query.dataUpdatedAt, "h:mm a")}</span>
          <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {DEPARTMENT_KEYS.filter((key) => key !== "pending" || totals.pending > 0).map((key) => (
          <Card key={key} className="rounded-2xl">
            <CardContent className="p-5">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DEPARTMENT_COLORS[key] }} aria-hidden />
                {DEPARTMENT_LABELS[key]}
              </p>
              <div className="mt-3 flex items-end justify-between gap-2">
                <p className="text-3xl font-bold tabular-nums" aria-label={`${DEPARTMENT_LABELS[key]}: ${totals[key]} leads`}>{count(totals[key])}</p>
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">{share(totals[key], total)}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{DEPARTMENT_DESCRIPTIONS[key]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-xl border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <strong className="text-foreground">How leads are matched:</strong> by customer phone or landline against JellyBean leads created before the lead was added here. When several JellyBean leads share the number, the latest one counts.
        ND = JellyBean maturing / sub-admin (Nextdoor), FB = Facebook team, SEO = SEO team. Statuses are each lead&apos;s current status. {count(inJellybean)} of {count(total)} leads ({share(inJellybean, total)}) were found in JellyBean.
        {totals.pending > 0 && <span className="mt-1 flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />{count(totals.pending)} lead{totals.pending === 1 ? " is" : "s are"} still being checked; this report refreshes every minute until they are done.</span>}
      </div>

      {!total ? (
        <div className="rounded-2xl border border-dashed p-10 text-center"><Layers className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h3 className="font-semibold">No leads in this period</h3><p className="mt-1 text-sm text-muted-foreground">Try a wider date range, or All Time for older leads.</p></div>
      ) : (
        <Card className="overflow-hidden rounded-2xl">
          <CardContent className="p-0">
            <div className="p-5"><h3 className="font-semibold">Status by department</h3><p className="mt-1 text-xs text-muted-foreground">How many leads from each department are in each status right now.</p></div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Status</TableHead>
                    {DEPARTMENT_KEYS.map((key) => <TableHead key={key} className="text-right" title={DEPARTMENT_LABELS[key]}><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: DEPARTMENT_COLORS[key] }} aria-hidden />{DEPARTMENT_SHORT_LABELS[key]}</span></TableHead>)}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statuses.map((row) => (
                    <TableRow key={row.status}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      {DEPARTMENT_KEYS.map((key) => <TableCell key={key} className={`text-right tabular-nums ${row.counts[key] ? "" : "text-muted-foreground/50"}`}>{count(row.counts[key])}</TableCell>)}
                      <TableCell className="text-right font-semibold tabular-nums">{count(row.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">All statuses</TableCell>
                    {DEPARTMENT_KEYS.map((key) => <TableCell key={key} className="text-right font-semibold tabular-nums">{count(totals[key])}</TableCell>)}
                    <TableCell className="text-right font-bold tabular-nums">{count(total)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
