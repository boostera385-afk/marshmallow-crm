import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format, formatDistanceToNow } from "date-fns";
import {
  Activity,
  Edit,
  Plus,
  Trash2,
  Eye,
  DollarSign,
  StickyNote,
  Share2,
  KeyRound,
  UserPlus,
  Camera,
  RefreshCw,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ActivityLog } from "@/types";
import { motion } from "framer-motion";

const PAGE_SIZE = 20;

const actionIcons: Record<string, React.ElementType> = {
  create: Plus,
  created: Plus,
  update: Edit,
  updated: Edit,
  delete: Trash2,
  deleted: Trash2,
  view: Eye,
  viewed: Eye,
  status_change: RefreshCw,
  status_changed: RefreshCw,
  payment_recorded: DollarSign,
  note_added: StickyNote,
  shared: Share2,
  password_changed: KeyRound,
  user_created: UserPlus,
  photos_uploaded: Camera,
};

const actionBadgeClasses: Record<string, string> = {
  create: "bg-emerald-50 text-emerald-700 border-emerald-200",
  created: "bg-emerald-50 text-emerald-700 border-emerald-200",
  update: "bg-blue-50 text-blue-700 border-blue-200",
  updated: "bg-blue-50 text-blue-700 border-blue-200",
  delete: "bg-red-50 text-red-700 border-red-200",
  deleted: "bg-red-50 text-red-700 border-red-200",
  status_change: "bg-amber-50 text-amber-700 border-amber-200",
  status_changed: "bg-amber-50 text-amber-700 border-amber-200",
  payment_recorded: "bg-green-50 text-green-700 border-green-200",
  note_added: "bg-violet-50 text-violet-700 border-violet-200",
  shared: "bg-cyan-50 text-cyan-700 border-cyan-200",
  password_changed: "bg-orange-50 text-orange-700 border-orange-200",
  photos_uploaded: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
};

const FIELD_LABELS: Record<string, string> = {
  customer_name: "Customer name",
  customer_email: "Customer email",
  customer_phone: "Customer phone",
  customer_landline: "Landline",
  service_type: "Service type",
  address: "Address",
  city: "City",
  state: "State",
  zip_code: "ZIP code",
  status: "Status",
  scheduled_date: "Scheduled date",
  scheduled_time_start: "Scheduled start time",
  scheduled_time_end: "Scheduled end time",
  general_notes: "General notes",
  cs_notes: "CS notes",
  processor_notes: "Processor notes",
  number_name: "Number name",
  quote: "Quote",
  service_details: "Service details",
  customer_schedule_requirements: "Customer schedule requirements",
  reference_name: "Reference",
  tech_name: "Tech name",
  tech_number: "Tech number",
  terms: "Terms",
  labor_amount: "Labor amount",
  material_amount: "Material amount",
  for_you_amount: "For you amount",
  for_us_amount: "For us amount",
  amount: "Amount",
  payment_amount: "Payment amount",
  payment_screenshot_url: "Payment screenshot",
};

const prettyText = (value?: string | null) => {
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const getFieldLabel = (field: string) => FIELD_LABELS[field] || prettyText(field);

const ActivityLogs = () => {
  const [page, setPage] = useState(0);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["activity-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) throw error;
      return data as ActivityLog[];
    },
  });

  const totalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
  const pagedLogs = useMemo(() => {
    const start = page * PAGE_SIZE;
    return logs.slice(start, start + PAGE_SIZE);
  }, [logs, page]);

  const getInitials = (name: string) =>
    name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  const parseDetails = (details: unknown) => {
    if (!details) return null;

    if (typeof details === "object") return details as Record<string, unknown>;

    if (typeof details === "string") {
      try {
        return JSON.parse(details) as Record<string, unknown>;
      } catch {
        return { raw: details };
      }
    }

    return null;
  };

  const getReadableMessage = (log: ActivityLog) => {
    const parsed = parseDetails(log.details);
    const actor = log.user_name || "Unknown user";
    const action = log.action.toLowerCase();
    const targetType = prettyText(log.target_type).toLowerCase();
    const targetName =
      typeof parsed?.target_name === "string"
        ? parsed.target_name
        : typeof parsed?.customer_name === "string"
          ? parsed.customer_name
          : log.target_id || targetType;

    if (parsed?.message && typeof parsed.message === "string") {
      return `${actor}: ${parsed.message}`;
    }

    if (action === "created" || action === "create") {
      return `${actor} created ${targetType} "${targetName}".`;
    }

    if (action === "deleted" || action === "delete") {
      return `${actor} deleted ${targetType} "${targetName}".`;
    }

    if (action === "viewed" || action === "view") {
      return `${actor} viewed ${targetType} "${targetName}".`;
    }

    if (action === "shared") {
      return `${actor} shared ${targetType} "${targetName}".`;
    }

    if (action === "payment_recorded") {
      const amount = parsed?.amount !== undefined && parsed?.amount !== null ? ` for $${parsed.amount}` : "";
      return `${actor} recorded a payment${amount} on "${targetName}".`;
    }

    if (action === "note_added") {
      return `${actor} added a note on "${targetName}".`;
    }

    if (action === "status_changed" || action === "status_change") {
      const from = parsed?.status_from || parsed?.from;
      const to = parsed?.status_to || parsed?.to;

      if (from || to) {
        return `${actor} changed the status of "${targetName}" from "${formatValue(from)}" to "${formatValue(to)}".`;
      }

      return `${actor} changed the status of "${targetName}".`;
    }

    if (action === "updated" || action === "update") {
      return `${actor} updated ${targetType} "${targetName}".`;
    }

    if (parsed?.raw && typeof parsed.raw === "string") {
      return `${actor}: ${parsed.raw}`;
    }

    return `${actor} ${prettyText(log.action).toLowerCase()} ${targetType} "${targetName}".`;
  };

  const getChangeLines = (log: ActivityLog) => {
    const parsed = parseDetails(log.details);
    if (!parsed || typeof parsed !== "object") return [];

    const changes = parsed.changes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];

    return Object.entries(changes as Record<string, { before?: unknown; after?: unknown }>)
      .map(([field, value]) => {
        if (!value || typeof value !== "object") return null;

        const before = formatValue(value.before);
        const after = formatValue(value.after);

        if (before === after) return null;

        return {
          field: getFieldLabel(field),
          before,
          after,
        };
      })
      .filter(Boolean) as Array<{ field: string; before: string; after: string }>;
  };

  const getActionLabel = (action: string) => prettyText(action);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-[28px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/[0.35] p-6 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.45)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_28%)]" />

        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="mb-3 inline-flex items-center gap-1 rounded-full border border-primary/10 bg-primary/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
              <Sparkles className="h-2.5 w-2.5" />
              Activity
            </div>

            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-3xl">Activity Logs</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Recent actions across the system, written in plain English.
            </p>
          </motion.div>

          <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">Total Logs</p>
            <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-foreground tabular-nums">{logs.length}</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-4 items-start">
              <Skeleton className="w-10 h-10 rounded-full shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-4 w-[70%]" />
                <Skeleton className="h-4 w-[55%]" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <Card className="rounded-[28px] border-2 border-dashed border-border/45 bg-gradient-to-br from-card to-muted/[0.22] shadow-[0_18px_48px_-34px_rgba(0,0,0,0.35)]">
          <CardContent className="flex min-h-[280px] flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/50 bg-muted/[0.4]">
              <Activity className="h-6 w-6 text-muted-foreground/35" />
            </div>
            <div>
              <p className="text-base font-semibold tracking-[-0.02em] text-foreground">No activity yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Actions will appear here as they happen.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="relative">
            <div className="absolute left-[23px] top-4 bottom-4 w-px bg-border/70" />

            <div className="space-y-3">
              {pagedLogs.map((log, index) => {
                const Icon = actionIcons[log.action.toLowerCase()] || Activity;
                const badgeClass =
                  actionBadgeClasses[log.action.toLowerCase()] || "bg-muted text-muted-foreground border-border";
                const message = getReadableMessage(log);
                const changeLines = getChangeLines(log);

                return (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="relative flex items-start gap-4"
                  >
                    <div className="z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-border bg-card shadow-sm">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>

                    <Card className="flex-1 rounded-2xl border border-border/60 bg-card/95 shadow-[0_14px_40px_-28px_rgba(0,0,0,0.35)]">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                            {getInitials(log.user_name)}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-foreground">
                                {log.user_name || "Unknown"}
                              </span>

                              <span className={`rounded-full border px-2.5 py-0.5 text-[10px] ${badgeClass}`}>
                                {getActionLabel(log.action)}
                              </span>

                              <span className="text-[11px] text-muted-foreground capitalize">
                                {prettyText(log.target_type)}
                              </span>
                            </div>

                            <p className="text-sm leading-6 text-foreground">{message}</p>

                            {changeLines.length > 0 && (
                              <div className="mt-3 rounded-xl border border-border/50 bg-muted/[0.18] p-3">
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
                                  Changed Details
                                </p>

                                <div className="space-y-1.5">
                                  {changeLines.map((line, idx) => (
                                    <div key={idx} className="text-[12px] leading-5 text-muted-foreground">
                                      <span className="font-semibold text-foreground">{line.field}:</span>{" "}
                                      <span className="text-red-600">{line.before}</span>{" "}
                                      <span className="text-muted-foreground">→</span>{" "}
                                      <span className="text-emerald-600">{line.after}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {log.target_id && (
                              <p className="mt-3 text-[11px] text-muted-foreground">Target ID: {log.target_id}</p>
                            )}
                          </div>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="shrink-0 whitespace-nowrap pt-0.5 text-[11px] text-muted-foreground">
                                {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{format(new Date(log.created_at), "MMM d, yyyy h:mm a")}</TooltipContent>
                          </Tooltip>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex flex-col items-center justify-center gap-3 pt-2">
              <div className="text-[12px] text-muted-foreground">
                Page <span className="font-semibold text-foreground">{page + 1}</span> of{" "}
                <span className="font-semibold text-foreground">{totalPages}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  className="h-9 rounded-xl border-border/60 bg-background px-3 shadow-sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>

                <div className="flex gap-1.5">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let p = i;

                    if (totalPages > 7) {
                      if (page < 4) p = i;
                      else if (page > totalPages - 5) p = totalPages - 7 + i;
                      else p = page - 3 + i;
                    }

                    return (
                      <Button
                        key={p}
                        variant={p === page ? "default" : "outline"}
                        size="sm"
                        className={`h-9 w-9 rounded-xl ${
                          p === page ? "shadow-sm" : "border-border/60 bg-background shadow-sm"
                        }`}
                        onClick={() => setPage(p)}
                      >
                        {p + 1}
                      </Button>
                    );
                  })}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  className="h-9 rounded-xl border-border/60 bg-background px-3 shadow-sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ActivityLogs;
