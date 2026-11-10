import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sparkles,
  RefreshCw,
  Search,
  PhoneCall,
  PhoneMissed,
  MessageSquareDashed,
  MessageSquare,
  Calendar,
  ChevronDown,
  Clock,
  ExternalLink,
  Copy,
  Check,
  Filter,
  UserPlus,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { premiumEase } from "@/lib/motion";
import {
  formatEasternTime,
  formatUsPhone,
  getQuoChatUrl,
  isTechLineNumber,
  normalizeQuoLeadStatus,
  QUO_LEAD_STATUS_CONFIG,
} from "@/lib/quo-dashboard";
import {
  QUO_NUMBER_DISPLAY_SETTING_KEY,
  resolveQuoNumberDisplay,
  type QuoNumberDisplayMap,
} from "@/lib/quo-number-display";
import {
  CS_MISSED_TYPE_LABELS,
  CS_MISSED_WINDOW_LABELS,
  formatWaited,
  resolveCsMissedWindow,
  waitSeverity,
  type CsMissedFollowup,
  type CsMissedWindow,
} from "@/lib/cs-missed";
import QuoChatDialog from "@/components/quo-dashboard/QuoChatDialog";
import RenderEmoji from "@/components/common/RenderEmoji";
import { DateInput } from "@/components/ui/date-input";
import { backgroundInterval } from "@/lib/overload-guard";

type TypeFilter = "all" | "missed_call" | "unanswered_text" | "new_lead";

const WINDOW_ORDER: CsMissedWindow[] = ["last24", "today", "yesterday", "last7", "all", "custom"];

const SEVERITY_CLASS: Record<ReturnType<typeof waitSeverity>, string> = {
  fresh: "text-muted-foreground",
  warm: "text-amber-600 dark:text-amber-400 font-semibold",
  stale: "text-rose-600 dark:text-rose-400 font-semibold",
};

export default function AiAssistancePage() {
  const queryClient = useQueryClient();
  const [window, setWindow] = useState<CsMissedWindow>("last24");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedNumberIds, setSelectedNumberIds] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [activeChat, setActiveChat] = useState<CsMissedFollowup | null>(null);

  // Custom number display names / emojis (shared with the Quo dashboard).
  const { data: numberDisplayMap = {} } = useQuery<QuoNumberDisplayMap>({
    queryKey: ["quo-number-display-map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quo_ai_settings" as never)
        .select("value")
        .eq("key", QUO_NUMBER_DISPLAY_SETTING_KEY)
        .maybeSingle();
      if (error) return {};
      const value = (data as { value?: unknown } | null)?.value;
      return value && typeof value === "object" ? (value as QuoNumberDisplayMap) : {};
    },
  });

  // CS phone numbers (tech lines excluded) for the number filter.
  const { data: phoneNumbers = [] } = useQuery({
    queryKey: ["quo-phone-numbers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quo_phone_numbers")
        .select("id, quo_phone_number_id, number, name, label, display_number")
        .order("name", { ascending: true });
      if (error) return [];
      return (data ?? []).filter(
        (p: { number?: string | null; display_number?: string | null; name?: string | null }) =>
          !isTechLineNumber(p.number || p.display_number || p.name),
      );
    },
  });

  const { since, until } = useMemo(
    () => resolveCsMissedWindow(window, { startDate, endDate }),
    [window, startDate, endDate],
  );

  const {
    data: rows = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useQuery<CsMissedFollowup[]>({
    queryKey: ["cs-missed-followups", since, until, selectedNumberIds],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_cs_missed_followups" as never, {
        p_since: since,
        p_until: until,
        p_number_ids: selectedNumberIds.length > 0 ? selectedNumberIds : null,
      } as never);
      if (error) throw new Error(error.message);
      return (data as CsMissedFollowup[]) ?? [];
    },
    refetchInterval: backgroundInterval(30000),
  });

  const markHandled = useMutation({
    mutationFn: async ({ conversationId, handled }: { conversationId: string; handled: boolean }) => {
      const { error } = await supabase.rpc("mark_cs_followup_handled" as never, {
        p_conversation_id: conversationId,
        p_handled: handled,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cs-missed-followups"] });
      queryClient.invalidateQueries({ queryKey: ["cs-missed-followup-count"] });
      if (variables.handled) {
        toast.success("Marked as handled", {
          action: {
            label: "Undo",
            onClick: () => markHandled.mutate({ conversationId: variables.conversationId, handled: false }),
          },
        });
      } else {
        toast.success("Moved back to the follow-up list");
      }
    },
    onError: (err: Error) => toast.error(`Could not update: ${err.message}`),
  });

  // Client-side type/search refinement over the already-scoped list.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = search.replace(/\D/g, "");
    return rows.filter((r) => {
      if (typeFilter === "new_lead" && !r.is_new_lead) return false;
      if (typeFilter === "missed_call" && r.type !== "missed_call") return false;
      if (typeFilter === "unanswered_text" && r.type !== "unanswered_text") return false;
      if (!q) return true;
      const name = (r.customer_name || "").toLowerCase();
      const numberDigits = (r.customer_number || "").replace(/\D/g, "");
      const preview = (r.preview || "").toLowerCase();
      return (
        name.includes(q) ||
        preview.includes(q) ||
        (digits.length > 0 && numberDigits.includes(digits))
      );
    });
  }, [rows, typeFilter, search]);

  const stats = useMemo(() => {
    let missed = 0;
    let unanswered = 0;
    let newLeads = 0;
    for (const r of rows) {
      if (r.type === "missed_call") missed += 1;
      else unanswered += 1;
      if (r.is_new_lead) newLeads += 1;
    }
    return { total: rows.length, missed, unanswered, newLeads };
  }, [rows]);

  const toggleNumber = (id: string) =>
    setSelectedNumberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("QUO chat link copied");
  };

  const typeFilterLabel =
    typeFilter === "all"
      ? "All types"
      : typeFilter === "new_lead"
        ? "New leads"
        : CS_MISSED_TYPE_LABELS[typeFilter];

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 pb-12">
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: premiumEase }}
        className="glass-panel-strong relative overflow-hidden rounded-[28px] px-5 py-5 shadow-[0_38px_82px_-42px_rgba(59,130,246,0.28)] sm:px-6 sm:py-6"
      >
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              AI Assistance
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-[-0.04em] text-foreground">
              Missed-Lead Tracker
            </h1>
            <p className="mt-1 max-w-2xl text-xs sm:text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span>
                Missed calls and unanswered texts across all CS numbers — anything a customer sent that
                nobody has replied to yet. Items clear automatically once an agent responds.
              </span>
              <Badge variant="secondary" className="font-semibold text-foreground text-[11px] px-2 py-0 border-primary/20">
                Eastern Time (US/Eastern)
              </Badge>
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2 text-xs h-9 bg-background/80 self-start"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-primary" : ""}`} />
            Refresh
          </Button>
        </div>
      </motion.section>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Outstanding" value={stats.total} icon={<Sparkles className="h-4 w-4 text-primary" />} tone="text-foreground" />
        <KpiCard label="Missed calls" value={stats.missed} icon={<PhoneMissed className="h-4 w-4 text-rose-500" />} tone="text-rose-600 dark:text-rose-400" />
        <KpiCard label="Unanswered texts" value={stats.unanswered} icon={<MessageSquareDashed className="h-4 w-4 text-amber-500" />} tone="text-amber-600 dark:text-amber-400" />
        <KpiCard label="New leads" value={stats.newLeads} icon={<UserPlus className="h-4 w-4 text-emerald-500" />} tone="text-emerald-600 dark:text-emerald-400" />
      </div>

      {/* Filter bar */}
      <div className="glass-panel-strong rounded-2xl p-2 px-3 flex flex-wrap items-center gap-2 border border-border/60">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer or message…"
            className="pl-8 h-8 text-xs bg-background/80"
          />
        </div>

        {/* Window preset */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-border/70 bg-background/80">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              <span>{CS_MISSED_WINDOW_LABELS[window]}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[300px] p-4 space-y-3">
            <div className="text-xs font-semibold text-foreground border-b pb-2 flex items-center justify-between">
              <span>Time window</span>
              <Badge variant="secondary" className="text-[10px] font-mono">Eastern Time</Badge>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {WINDOW_ORDER.filter((w) => w !== "custom").map((w) => (
                <Button
                  key={w}
                  size="sm"
                  variant={window === w ? "default" : "outline"}
                  onClick={() => setWindow(w)}
                  className="h-7 text-xs"
                >
                  {CS_MISSED_WINDOW_LABELS[w]}
                </Button>
              ))}
            </div>
            <div className="pt-2 border-t space-y-2">
              <span className="text-[11px] font-medium text-muted-foreground">Custom range (ET)</span>
              <div className="space-y-1.5">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Start date</Label>
                  <DateInput
                    aria-label="Start date"
                    value={startDate}
                    onChange={(value) => { setStartDate(value); setWindow("custom"); }}
                    className="h-8 px-3 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">End date</Label>
                  <DateInput
                    aria-label="End date"
                    value={endDate}
                    onChange={(value) => { setEndDate(value); setWindow("custom"); }}
                    className="h-8 px-3 text-xs"
                  />
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Number multi-select */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-border/70 bg-background/80">
              <PhoneCall className="h-3.5 w-3.5 text-primary" />
              <span>
                {selectedNumberIds.length === 0
                  ? "All CS numbers"
                  : `${selectedNumberIds.length} number${selectedNumberIds.length > 1 ? "s" : ""}`}
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[260px] p-3">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-xs font-semibold text-foreground">Filter by CS number</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedNumberIds([])}
                className="h-6 text-[10px] px-2 text-primary"
              >
                Clear
              </Button>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1.5 pt-2">
              {phoneNumbers.map((num) => {
                const disp = resolveQuoNumberDisplay(num, numberDisplayMap);
                return (
                  <div
                    key={num.id}
                    onClick={() => toggleNumber(num.id)}
                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/40 cursor-pointer text-xs select-none"
                  >
                    <Checkbox checked={selectedNumberIds.includes(num.id)} onCheckedChange={() => toggleNumber(num.id)} />
                    <RenderEmoji emoji={disp.emoji} size="sm" />
                    <span className="truncate font-medium text-foreground">{disp.name}</span>
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        {/* Type filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-border/70 bg-background/80">
              <Filter className="h-3.5 w-3.5 text-primary" />
              <span>{typeFilterLabel}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[190px]">
            {([
              ["all", "All types"],
              ["missed_call", CS_MISSED_TYPE_LABELS.missed_call],
              ["unanswered_text", CS_MISSED_TYPE_LABELS.unanswered_text],
              ["new_lead", "New leads only"],
            ] as [TypeFilter, string][]).map(([key, label]) => (
              <DropdownMenuItem
                key={key}
                onClick={() => setTypeFilter(key)}
                className="text-xs flex items-center justify-between"
              >
                <span>{label}</span>
                {typeFilter === key && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      <div className="glass-panel-strong rounded-2xl border border-border/60 overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[56px] text-center text-xs font-semibold text-foreground">#</TableHead>
              <TableHead className="text-xs font-semibold text-foreground w-[180px]">Type</TableHead>
              <TableHead className="text-xs font-semibold text-foreground">CS Number</TableHead>
              <TableHead className="text-xs font-semibold text-foreground">Customer</TableHead>
              <TableHead className="text-xs font-semibold text-foreground">Last message</TableHead>
              <TableHead className="text-xs font-semibold text-foreground w-[110px]">Waiting</TableHead>
              <TableHead className="text-xs font-semibold text-foreground w-[120px]">Received (ET)</TableHead>
              <TableHead className="text-xs font-semibold text-foreground text-right w-[280px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-center"><Skeleton className="h-4 w-4 mx-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-7 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell colSpan={8} className="h-40 text-center text-xs text-rose-600 dark:text-rose-400">
                  Could not load the follow-up list. {String((error as Error).message)}
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-44 text-center text-muted-foreground text-xs">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <CheckCircle2 className="h-9 w-9 text-emerald-400/70" />
                    <span className="text-sm font-medium text-foreground">All caught up</span>
                    <span>No missed calls or unanswered texts in this window.</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row, index) => {
                const disp = resolveQuoNumberDisplay(
                  {
                    id: row.number_id ?? undefined,
                    name: row.number_name,
                    label: row.number_label,
                    number: row.number,
                    display_number: row.number_display,
                  },
                  numberDisplayMap,
                );
                const sev = waitSeverity(row.waited_minutes);
                const quoUrl = getQuoChatUrl(row.quo_conversation_id, row.customer_number, row.quo_phone_number_id);
                const triage = QUO_LEAD_STATUS_CONFIG[normalizeQuoLeadStatus(row.triage_status)];
                const isMissed = row.type === "missed_call";

                return (
                  <TableRow key={row.conversation_id} className="hover:bg-muted/30 transition-colors border-b border-border/40">
                    <TableCell className="text-center font-mono text-xs text-muted-foreground font-semibold">
                      {index + 1}
                    </TableCell>

                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${
                            isMissed
                              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
                              : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
                          }`}
                        >
                          {isMissed ? <PhoneMissed className="h-3 w-3" /> : <MessageSquareDashed className="h-3 w-3" />}
                          {CS_MISSED_TYPE_LABELS[row.type]}
                        </span>
                        {row.is_new_lead && (
                          <span className="inline-flex w-fit items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-300">
                            <UserPlus className="h-2.5 w-2.5" /> New lead
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="text-xs font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        <RenderEmoji emoji={disp.emoji} size="sm" />
                        <span className="truncate">{disp.name}</span>
                      </div>
                    </TableCell>

                    <TableCell className="text-xs text-foreground font-mono">
                      {formatUsPhone(row.customer_number)}
                      {row.customer_name && (
                        <span className="block text-[11px] font-sans font-normal text-muted-foreground">
                          {row.customer_name}
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground max-w-[320px]">
                      <span className="line-clamp-2">{row.preview || "—"}</span>
                      {triage && (
                        <Badge variant="outline" className={`mt-1 text-[10px] font-medium ${triage.badgeClass}`}>
                          {triage.label}
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className={`text-xs font-mono ${SEVERITY_CLASS[sev]}`}>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3 shrink-0 opacity-70" />
                        {formatWaited(row.waited_minutes)}
                      </span>
                    </TableCell>

                    <TableCell className="text-xs text-foreground font-mono">
                      {formatEasternTime(row.last_customer_at, "short")}
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => markHandled.mutate({ conversationId: row.conversation_id, handled: true })}
                          disabled={markHandled.isPending}
                          className="h-7 px-2.5 text-xs gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900/50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                          title="Mark this follow-up as handled"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Handled
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setActiveChat(row)}
                          className="h-7 px-2.5 text-xs gap-1.5 border-border/70 hover:bg-primary/10 hover:text-primary hover:border-primary/30"
                        >
                          <MessageSquare className="h-3.5 w-3.5 text-primary" />
                          Open
                        </Button>
                        <a href={quoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-primary hover:bg-primary/10" title="Open in QUO">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </a>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => copyLink(quoUrl)}
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          title="Copy QUO link"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        <div className="p-3 border-t border-border/40 bg-muted/20 flex flex-col sm:flex-row gap-2 items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing <strong className="text-foreground">{filtered.length}</strong>
            {filtered.length !== rows.length && <> of <strong className="text-foreground">{rows.length}</strong></>} follow-up{filtered.length === 1 ? "" : "s"}
          </span>
          <span className="text-[11px] font-mono hidden sm:inline-block">Auto-refreshes every 30s · Eastern Time</span>
        </div>
      </div>

      <QuoChatDialog
        open={!!activeChat}
        onOpenChange={(open) => !open && setActiveChat(null)}
        conversation={
          activeChat
            ? {
                id: activeChat.conversation_id,
                customer_name: activeChat.customer_name,
                customer_number: activeChat.customer_number,
                number_name: resolveQuoNumberDisplay(
                  {
                    id: activeChat.number_id ?? undefined,
                    name: activeChat.number_name,
                    label: activeChat.number_label,
                    number: activeChat.number,
                    display_number: activeChat.number_display,
                  },
                  numberDisplayMap,
                ).full,
                status: activeChat.triage_status,
              }
            : null
        }
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <Card className="glass-panel-strong border-border/60">
      <CardContent className="p-4 flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <span className={`text-2xl font-bold mt-1 ${tone}`}>{value}</span>
      </CardContent>
    </Card>
  );
}
