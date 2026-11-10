import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Database,
  Layers,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Timer,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  describeSyncStatus,
  fetchSyncHealth,
  formatSyncAge,
  pruneSyncErrorLog,
  retrySyncQueueNow,
  type SyncStatus,
} from "@/lib/sheets-sync-health";
import { premiumEase, silkySpring, smoothSpring } from "@/lib/motion";
import { backgroundInterval } from "@/lib/overload-guard";

const HEALTH_POLL_MS = 30_000;

/** Ring and dot colours, keyed to theme tokens so both themes stay readable. */
const TONE_RING: Record<SyncStatus, string> = {
  healthy: "stroke-emerald-500",
  syncing: "stroke-sky-500",
  degraded: "stroke-amber-500",
  down: "stroke-destructive",
  idle: "stroke-muted-foreground/40",
};

const TONE_DOT: Record<SyncStatus, string> = {
  healthy: "bg-emerald-500",
  syncing: "bg-sky-500",
  degraded: "bg-amber-500",
  down: "bg-destructive",
  idle: "bg-muted-foreground/40",
};

const TONE_TEXT: Record<SyncStatus, string> = {
  healthy: "text-emerald-600 dark:text-emerald-400",
  syncing: "text-sky-600 dark:text-sky-400",
  degraded: "text-amber-600 dark:text-amber-400",
  down: "text-destructive",
  idle: "text-muted-foreground",
};

const STATUS_ICON: Record<SyncStatus, typeof CheckCircle2> = {
  healthy: CheckCircle2,
  syncing: LoaderCircle,
  degraded: AlertTriangle,
  down: AlertCircle,
  idle: CircleSlash,
};

/**
 * Live state of the Google Sheets backup.
 *
 * Reads from the database rather than component state. Delivery is owned by a
 * scheduled server worker, so health and retries survive every browser closing.
 *
 * The headline figure is how many leads the sheet is missing, not how long ago
 * anything last synced. A backup that is 40 minutes idle but fully current is
 * healthy; one that synced a second ago while three thousand leads are
 * outstanding is not.
 */
export function SyncHealthCard({ autoSync = true }: { autoSync?: boolean }) {
  const queryClient = useQueryClient();
  const [showErrors, setShowErrors] = useState(false);
  const reduceMotion = useReducedMotion();

  const healthQuery = useQuery({
    queryKey: ["google-sheets-sync-health"],
    queryFn: () => fetchSyncHealth(),
    refetchInterval: backgroundInterval(HEALTH_POLL_MS),
    refetchIntervalInBackground: false,
  });

  const retryQueue = useMutation({
    // Keep an on-demand batch comfortably below the Apps Script request
    // timeout; the scheduled worker continues with the rest of the queue.
    mutationFn: () => retrySyncQueueNow(10),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["google-sheets-sync-health"] });
      if (result.failed > 0) {
        toast.error(`${result.failed} job${result.failed === 1 ? "" : "s"} still failed. They remain queued for automatic retry.`);
      } else if (result.acknowledged > 0) {
        toast.success(`Confirmed ${result.acknowledged} queued change${result.acknowledged === 1 ? "" : "s"}.`);
      } else if (result.claimed > 0) {
        toast.info("The worker claimed queued changes; refresh shortly for the confirmed result.");
      } else {
        toast.info("No due jobs. The server worker will retry scheduled items automatically.");
      }
    },
    onError: (err: Error) => toast.error(`Could not read the retry queue: ${err.message}`),
  });

  const pruneLog = useMutation({
    mutationFn: () => pruneSyncErrorLog(500),
    onSuccess: (removed) => {
      void queryClient.invalidateQueries({ queryKey: ["google-sheets-sync-health"] });
      toast.success(`Removed ${removed} old error${removed === 1 ? "" : "s"}`);
    },
    onError: (err: Error) => toast.error(`Could not prune the error log: ${err.message}`),
  });

  const health = healthQuery.data;
  const status: SyncStatus = health?.status ?? "idle";
  const behind = health?.leads_behind;
  const isProblem = status === "degraded" || status === "down";
  const StatusIcon = STATUS_ICON[status];
  const { label } = describeSyncStatus(status);

  // Before the first response there is nothing to report, and rendering the
  // defaults would claim Idle with zero leads behind and zero synced, which is
  // a reassuring answer built from no data at all.
  const isPending = healthQuery.isPending;
  const isUnavailable = healthQuery.isError;

  // Null means the watermark migration has not been applied, which is not the
  // same as zero outstanding. It is shown as unknown rather than as "current".
  const currencyKnown = typeof behind === "number";
  const isCurrent = currencyKnown && behind === 0 && (health?.queue_depth ?? 0) === 0 && status === "healthy";
  const watermarkAge = health?.watermark_at
    ? Math.max(0, Math.floor((Date.now() - new Date(health.watermark_at).getTime()) / 1000))
    : null;

  return (
    <Card className="glass-panel overflow-hidden border-border/60">
      <CardContent className="p-0">
        {/* Hero: is the backup current, and how much is missing. */}
        <div className="flex flex-col items-center gap-6 border-b border-border/50 bg-background/40 px-6 py-7 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-5">
            <div className="relative">
              <svg viewBox="0 0 44 44" className="h-20 w-20 -rotate-90" aria-hidden>
                <circle
                  cx="22"
                  cy="22"
                  r="19"
                  fill="none"
                  strokeWidth="3"
                  className="stroke-border/60"
                />
                <motion.circle
                  cx="22"
                  cy="22"
                  r="19"
                  fill="none"
                  strokeWidth="3"
                  strokeLinecap="round"
                  className={TONE_RING[status]}
                  strokeDasharray="2 119.4"
                  initial={{ strokeDashoffset: 119.4 }}
                  animate={{ strokeDashoffset: 0 }}
                  transition={reduceMotion ? { duration: 0 } : { ...smoothSpring }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.span
                  key={isPending || isUnavailable ? "none" : String(behind)}
                  initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ ...silkySpring }}
                  className={`text-lg font-bold tabular-nums ${isPending || isUnavailable ? "text-muted-foreground/50" : TONE_TEXT[status]}`}
                >
                  {isPending || isUnavailable ? "·" : behind}
                </motion.span>
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  behind
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  {healthQuery.isFetching && !reduceMotion ? (
                    <motion.span
                      className={`absolute inline-flex h-full w-full rounded-full ${TONE_DOT[status]}`}
                      animate={{ opacity: 1, scale: 2.2 }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
                    />
                  ) : null}
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${TONE_DOT[status]}`} />
                </span>
                <h3 className="text-base font-semibold text-foreground">
                  {!autoSync
                    ? "Automatic sync paused"
                    : isCurrent
                      ? "Backup current"
                      : label}
                </h3>
              </div>
              <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                {isUnavailable
                  ? "Could not read server sync health. Check that the outbox migration was applied and the worker is deployed."
                  : !autoSync
                    ? "Lead changes are being retained in the database queue. Turn automatic sync on to deliver them."
                    : isPending
                    ? "Checking the backup against the database."
                    : !currencyKnown
                      ? "Lead counts appear once the sync watermark migration is applied."
                      : isCurrent
                        ? "Every lead change is in the sheet."
                        : `${behind} lead${behind === 1 ? "" : "s"} changed after the last reconcile, the oldest ${formatSyncAge(health?.behind_seconds ?? null)}.`}
              </p>
              {isPending || isUnavailable ? null : (
                <Badge
                  variant="outline"
                  className={`gap-1.5 border-border/50 bg-muted/40 ${autoSync ? TONE_TEXT[status] : "text-amber-600 dark:text-amber-400"}`}
                >
                  <StatusIcon className={`h-3 w-3 ${status === "syncing" && !reduceMotion ? "animate-spin" : ""}`} />
                  {!autoSync ? "Paused" : label}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs"
              disabled={retryQueue.isPending}
              onClick={() => retryQueue.mutate()}
            >
              <RotateCcw className={`h-3.5 w-3.5 ${retryQueue.isPending ? "animate-spin" : ""}`} />
              Retry queued
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["google-sheets-sync-health"] })}
              aria-label="Refresh sync health"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${healthQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Tiles */}
        <div className="grid gap-px bg-border/40 sm:grid-cols-2 lg:grid-cols-5">
          <Tile
            icon={Timer}
            label="Last full reconcile"
            value={formatSyncAge(watermarkAge)}
          />
          <Tile
            icon={Layers}
            label="Pending jobs"
            value={`${health?.queue_depth ?? 0} · ${formatSyncAge(health?.queue_oldest_seconds ?? null)}`}
            highlight={(health?.queue_depth ?? 0) > 0}
          />
          <Tile
            icon={Activity}
            label="Leads behind"
            value={currencyKnown ? String(behind) : "Unknown"}
            highlight={currencyKnown && (behind ?? 0) > 0}
          />
          <Tile
            icon={AlertCircle}
            label="Failed jobs"
            value={String(health?.failed_jobs ?? 0)}
            highlight={(health?.failed_jobs ?? 0) > 0}
          />
          <Tile
            icon={Database}
            label="Leads synced"
            value={String(health?.synced_total ?? 0)}
          />
        </div>

        {/* Problem detail */}
        <AnimatePresence initial={false}>
          {isProblem ? (
            <motion.div
              key="alert"
              initial={reduceMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: premiumEase }}
              className="overflow-hidden"
            >
              <div className="mx-6 my-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                {status === "down"
                  ? `${health?.consecutive_failures ?? 0} consecutive failure(s); ${health?.failed_jobs ?? 0} failed job(s) remain queued for retry.`
                  : `${health?.failed_jobs ?? 0} failed job(s) remain queued; new changes are still being captured and retried.`}
                {health?.last_error_message ? (
                  <p className="mt-1 opacity-85">Last error: {health.last_error_message}</p>
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Error log */}
        {health?.recent_errors?.length ? (
          <div className="border-t border-border/50 px-6 py-4">
            <button
              type="button"
              onClick={() => setShowErrors((v) => !v)}
              className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              aria-expanded={showErrors}
            >
              <span className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                {health.recent_errors.length} recent error
                {health.recent_errors.length === 1 ? "" : "s"}
              </span>
              <motion.span animate={{ rotate: showErrors ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronDown className="h-3.5 w-3.5" />
              </motion.span>
            </button>

            <AnimatePresence initial={false}>
              {showErrors ? (
                <motion.ul
                  key="errors"
                  initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: premiumEase }}
                  className="mt-3 space-y-1.5 overflow-hidden"
                >
                  {health.recent_errors.map((entry, idx) => (
                    <motion.li
                      key={`${entry.occurred_at}-${idx}`}
                      initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: reduceMotion ? 0 : idx * 0.03, ...silkySpring }}
                      className="flex flex-col gap-0.5 rounded-lg border border-border/50 bg-muted/25 px-3 py-2 text-xs"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-border/50 text-[10px]">
                          {entry.action}
                        </Badge>
                        <span className="text-muted-foreground">
                          {new Date(entry.occurred_at).toLocaleString()}
                        </span>
                        {entry.lead_id ? (
                          <span className="font-mono text-[10px] text-muted-foreground/70">
                            {entry.lead_id.slice(0, 8)}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-foreground/90">{entry.message}</span>
                    </motion.li>
                  ))}
                </motion.ul>
              ) : null}
            </AnimatePresence>

            <div className="mt-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                disabled={pruneLog.isPending}
                onClick={() => pruneLog.mutate()}
              >
                Prune error log
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  highlight = false,
}: {
  icon: typeof Timer;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 bg-card px-5 py-3.5">
      <Icon
        className={`h-4 w-4 shrink-0 ${highlight ? "text-amber-500" : "text-muted-foreground"}`}
      />
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p
          className={`truncate text-sm font-semibold tabular-nums ${highlight ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
