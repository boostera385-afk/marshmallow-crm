import { useEffect, useMemo, useState } from "react";
import {
  NEARBY_RADIUS_MILES,
  buildUrgentClusters,
  countLeadsInSharedAreas,
  type ProximityLead,
} from "@/lib/lead-proximity";
import { preloadZipDataset } from "@/lib/zipCentroids";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { useAuth } from "@/contexts/AuthContext";
import { canViewLeadCoverageAnalytics } from "@/lib/access";
import { fetchCsTeamPerformance, toCsMemberRow } from "@/lib/cs-team-performance";
import { LeadCoverageSources } from "@/components/analytics/LeadCoverageSources";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { format, subDays, eachDayOfInterval, parseISO, startOfDay, endOfDay, isValid } from "date-fns";
import { TrendingUp, Users, Calendar, Sparkles, Activity, CheckCircle2, AlertTriangle, Clock3, Percent, Briefcase, UserCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { heroTitle } from "@/lib/motion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AnalyticsLeadRow {
  id: string;
  created_at: string;
  status: string;
  service_type: string;
  number_name: string | null;
  assigned_cs: string | null;
  created_by: string | null;
}

const Analytics = () => {
  const { role, user, canAccess } = useAuth();
  const canCoverageReport = canViewLeadCoverageAnalytics(role);
  // "analytics" opens the whole page; "cs_team_performance" alone opens only the
  // CS Team Performance section, with team-wide counts from the database.
  const fullAnalytics = canAccess("analytics");
  const teamWideCs = canAccess("cs_team_performance");
  const csOnly = !fullAnalytics && teamWideCs;
  const [activeTab, setActiveTab] = useState<"overview" | "cs_report" | "coverage_sources">("overview");
  const tab = csOnly ? "cs_report" : activeTab;
  const [dateFilter, setDateFilter] = useState<"7d" | "30d" | "90d" | "all" | "custom">("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const rangeError = dateFilter === "custom" && (
    (customStart && !isValid(parseISO(customStart))) || (customEnd && !isValid(parseISO(customEnd)))
      ? "Choose valid start and end dates."
      : customStart && customEnd && parseISO(customStart) > parseISO(customEnd)
        ? "Start date must be on or before the end date." : null
  );

  // Fetch full details of all leads (operational fields only)
  const { data: allLeads = [] } = useQuery<AnalyticsLeadRow[]>({
    queryKey: ["analytics-total-operational"],
    enabled: fullAnalytics,
    queryFn: async () => {
      // Page through so analytics counts reflect every lead, not just the
      // newest 1000 (PostgREST's default single-response cap).
      return fetchAllRows<AnalyticsLeadRow>((from, to) =>
        supabase
          .from("leads")
          .select("id, status, created_at, service_type, number_name, assigned_cs, created_by")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      );
    },
  });

  // Urgent leads carry the fields needed to place them; the main query above deliberately
  // leaves addresses out, and this set is small.
  const { data: urgentLeads = [] } = useQuery<ProximityLead[]>({
    queryKey: ["analytics-urgent-areas"],
    enabled: fullAnalytics,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, customer_name, status, address, city, state, zip_code, job_id")
        .eq("status", "urgent_job");
      if (error) throw error;
      return (data ?? []) as ProximityLead[];
    },
    refetchInterval: 60000,
  });

  const [zipDataReady, setZipDataReady] = useState(false);

  useEffect(() => {
    if (urgentLeads.length === 0 || zipDataReady) return;
    let active = true;
    void preloadZipDataset().then(() => {
      if (active) setZipDataReady(true);
    });
    return () => {
      active = false;
    };
  }, [urgentLeads.length, zipDataReady]);

  const urgentClusters = useMemo(
    () => buildUrgentClusters(urgentLeads),
    // Recompute once the centroids are in memory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [urgentLeads, zipDataReady],
  );

  const urgentLeadsInSharedAreas = countLeadsInSharedAreas(urgentClusters);

  // Fetch profiles list to map CS Agent UUIDs to names
  const { data: profiles = [] } = useQuery({
    queryKey: ["analytics-profiles"],
    enabled: fullAnalytics,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles_public" as never)
        .select("id, full_name");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string | null }[];
    },
  });

  // Fetch user roles
  const { data: userRoles = [] } = useQuery({
    queryKey: ["analytics-user-roles"],
    enabled: fullAnalytics,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (error) throw error;
      return (data ?? []) as { user_id: string; role: string }[];
    },
  });

  // Create a fast map lookup for profiles
  const profileMap = useMemo(() => {
    return new Map(profiles.map((p) => [p.id, p.full_name]));
  }, [profiles]);

  const roleMap = useMemo(() => {
    return new Map(userRoles.map((ur) => [ur.user_id, ur.role]));
  }, [userRoles]);

  // Calculate current range start/end timestamps
  const filteredRange = useMemo(() => {
    let startMs = 0;
    let endMs = endOfDay(new Date()).getTime();

    if (dateFilter === "7d") {
      startMs = subDays(new Date(), 7).getTime();
    } else if (dateFilter === "30d") {
      startMs = subDays(new Date(), 30).getTime();
    } else if (dateFilter === "90d") {
      startMs = subDays(new Date(), 90).getTime();
    } else if (dateFilter === "custom") {
      if (customStart) {
        const start = parseISO(customStart);
        start.setHours(0, 0, 0, 0);
        startMs = start.getTime();
      }
      if (customEnd) {
        const end = parseISO(customEnd);
        end.setHours(23, 59, 59, 999);
        endMs = end.getTime();
      }
    } else {
      startMs = 0;
    }

    return { startMs, endMs };
  }, [dateFilter, customStart, customEnd]);

  // Calculate previous range of equal length
  const prevRange = useMemo(() => {
    let startMs = 0;
    let endMs = 0;
    let durationMs = 0;

    if (dateFilter === "7d") {
      durationMs = 7 * 24 * 60 * 60 * 1000;
      endMs = subDays(new Date(), 7).getTime();
      startMs = endMs - durationMs;
    } else if (dateFilter === "30d") {
      durationMs = 30 * 24 * 60 * 60 * 1000;
      endMs = subDays(new Date(), 30).getTime();
      startMs = endMs - durationMs;
    } else if (dateFilter === "90d") {
      durationMs = 90 * 24 * 60 * 60 * 1000;
      endMs = subDays(new Date(), 90).getTime();
      startMs = endMs - durationMs;
    } else if (dateFilter === "custom") {
      const s = customStart ? new Date(customStart).getTime() : 0;
      const e = customEnd ? new Date(customEnd).getTime() : Date.now();
      durationMs = e - s;
      endMs = s;
      startMs = s - durationMs;
    }

    return { startMs, endMs };
  }, [dateFilter, customStart, customEnd]);

  // Filter leads for the selected range
  const leads = useMemo(() => {
    const { startMs, endMs } = filteredRange;
    return allLeads.filter((lead) => {
      const leadTime = new Date(lead.created_at).getTime();
      return leadTime >= startMs && leadTime <= endMs;
    });
  }, [allLeads, filteredRange]);

  // Filter leads for the previous range
  const prevLeads = useMemo(() => {
    if (dateFilter === "all") return [];
    const { startMs, endMs } = prevRange;
    return allLeads.filter((lead) => {
      const leadTime = new Date(lead.created_at).getTime();
      return leadTime >= startMs && leadTime <= endMs;
    });
  }, [allLeads, prevRange, dateFilter]);

  // Calculate dynamic start/end dates for the chart interval
  const chartInterval = useMemo(() => {
    let start = subDays(new Date(), 30);
    let end = new Date();

    if (dateFilter === "7d") {
      start = subDays(new Date(), 7);
    } else if (dateFilter === "30d") {
      start = subDays(new Date(), 30);
    } else if (dateFilter === "90d") {
      start = subDays(new Date(), 90);
    } else if (dateFilter === "custom") {
      if (customStart && isValid(parseISO(customStart))) start = parseISO(customStart);
      if (customEnd && isValid(parseISO(customEnd))) end = parseISO(customEnd);
    } else {
      if (allLeads.length > 0) {
        const times = allLeads.map((l) => new Date(l.created_at).getTime());
        const minTime = Math.min(...times);
        const maxAgo = subDays(new Date(), 120).getTime();
        start = new Date(Math.max(minTime, maxAgo));
      } else {
        start = subDays(new Date(), 30);
      }
    }

    return { start, end };
  }, [dateFilter, customStart, customEnd, allLeads]);

  // Generate Date interval steps
  const days = useMemo(() => {
    return eachDayOfInterval({
      start: startOfDay(chartInterval.start),
      end: startOfDay(chartInterval.end < chartInterval.start ? chartInterval.start : chartInterval.end),
    });
  }, [chartInterval]);

  // Daily leads intake chart data
  const chartData = useMemo(() => {
    const countsByDate = new Map<string, number>();

    for (const lead of leads) {
      const dateKey = lead.created_at.slice(0, 10);
      countsByDate.set(dateKey, (countsByDate.get(dateKey) ?? 0) + 1);
    }

    return days.map((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      return {
        date: format(day, "MMM d"),
        count: countsByDate.get(dateStr) ?? 0,
      };
    });
  }, [days, leads]);

  // Calculate current range summaries
  const currentStats = useMemo(() => {
    const totalLeads = leads.length;
    const scheduled = leads.filter(l => ["scheduled", "need_tech", "tech_making_quote"].includes(l.status)).length;
    const completed = leads.filter(l => ["job_done", "paid", "partial_paid"].includes(l.status)).length;
    const conversionRate = totalLeads > 0 ? (completed / totalLeads) * 100 : 0;

    return { totalLeads, scheduled, completed, conversionRate };
  }, [leads]);

  // Calculate previous range summaries (for delta metrics)
  const prevStats = useMemo(() => {
    const totalLeads = prevLeads.length;
    const scheduled = prevLeads.filter(l => ["scheduled", "need_tech", "tech_making_quote"].includes(l.status)).length;
    const completed = prevLeads.filter(l => ["job_done", "paid", "partial_paid"].includes(l.status)).length;
    const conversionRate = totalLeads > 0 ? (completed / totalLeads) * 100 : 0;

    return { totalLeads, scheduled, completed, conversionRate };
  }, [prevLeads]);

  // Calculate funnel progression stages
  const funnelData = useMemo(() => {
    const total = leads.length;
    const engaged = leads.filter(l => !["needs_quote", "waiting_complete_details"].includes(l.status)).length;
    const scheduled = leads.filter(l => ["scheduled", "job_in_progress", "job_done", "paid", "partial_paid"].includes(l.status)).length;
    const completed = leads.filter(l => ["job_done", "paid", "partial_paid"].includes(l.status)).length;

    return [
      { step: "Captured", count: total, pct: 100, color: "bg-blue-500" },
      { step: "Details Acquired", count: engaged, pct: total > 0 ? Math.round((engaged / total) * 100) : 0, color: "bg-purple-500" },
      { step: "Visits Scheduled", count: scheduled, pct: total > 0 ? Math.round((scheduled / total) * 100) : 0, color: "bg-indigo-500" },
      { step: "Jobs Completed", count: completed, pct: total > 0 ? Math.round((completed / total) * 100) : 0, color: "bg-emerald-500" },
    ];
  }, [leads]);

  // Lead aging distribution for active leads
  const agingData = useMemo(() => {
    const active = leads.filter(l => !["job_done", "paid", "cancelled"].includes(l.status));
    let under24h = 0;
    let oneToThreeDays = 0;
    let fourToSevenDays = 0;
    let eightPlusDays = 0;

    const now = Date.now();
    for (const lead of active) {
      const ageMs = now - new Date(lead.created_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < 1) under24h += 1;
      else if (ageDays <= 3) oneToThreeDays += 1;
      else if (ageDays <= 7) fourToSevenDays += 1;
      else eightPlusDays += 1;
    }

    return [
      { name: "< 24 Hrs", count: under24h, fill: "hsl(217, 91%, 60%)" },
      { name: "1 - 3 Days", count: oneToThreeDays, fill: "hsl(142, 72%, 50%)" },
      { name: "4 - 7 Days", count: fourToSevenDays, fill: "hsl(38, 92%, 50%)" },
      { name: "8+ Days", count: eightPlusDays, fill: "hsl(0, 84%, 60%)" },
    ];
  }, [leads]);

  // CS Agent Performance (Assignments count)
  const agentPerformance = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of leads) {
      const name = lead.assigned_cs ? (profileMap.get(lead.assigned_cs) ?? "Unassigned / Bot") : "Unassigned / Bot";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [leads, profileMap]);

  // Team Lead Creation Performance (CS & CS Admin)
  const creatorPerformance = useMemo(() => {
    const counts = new Map<string, { role: string; total: number; engaged: number; scheduled: number; completed: number }>();
    
    for (const lead of leads) {
      if (lead.created_by) {
        const role = roleMap.get(lead.created_by);
        if (role === "customer_service" || role === "cs_admin") {
          const name = profileMap.get(lead.created_by) || "Unknown CS Agent";
          const current = counts.get(name) || { role, total: 0, engaged: 0, scheduled: 0, completed: 0 };
          current.total += 1;
          
          if (!["needs_quote", "waiting_complete_details"].includes(lead.status)) {
            current.engaged += 1;
          }
          if (["scheduled", "job_in_progress", "job_done", "paid", "partial_paid"].includes(lead.status)) {
            current.scheduled += 1;
          }
          if (["job_done", "paid", "partial_paid"].includes(lead.status)) {
            current.completed += 1;
          }
          
          counts.set(name, current);
        }
      }
    }
    
    return Array.from(counts.entries())
      .map(([name, stats]) => toCsMemberRow({ id: name, name, role: stats.role === "cs_admin" ? "cs_admin" : "customer_service", total: stats.total, engaged: stats.engaged, scheduled: stats.scheduled, completed: stats.completed }))
      .sort((a, b) => b.totalAdded - a.totalAdded);
  }, [leads, profileMap, roleMap]);

  // Team-wide counts for users granted CS Team Performance (and Admin); others with
  // Analytics keep the report built from the leads they can see.
  const csTeam = useQuery({
    queryKey: ["analytics-cs-team-performance", user?.id, filteredRange.startMs, filteredRange.endMs],
    enabled: teamWideCs && !rangeError && tab === "cs_report",
    queryFn: () => fetchCsTeamPerformance(filteredRange.startMs, filteredRange.endMs),
  });
  const csRows = teamWideCs ? csTeam.data ?? [] : creatorPerformance;

  // Calculate stats for all-time totals
  const summary = useMemo(() => {
    const todayStart = startOfDay(new Date());
    const weekAgo = subDays(new Date(), 7);
    const counts = {
      urgent: 0,
      scheduled: 0,
      done: 0,
      cancelled: 0,
      waiting: 0,
      today: 0,
      thisWeek: 0,
    };

    for (const lead of allLeads) {
      const createdAt = new Date(lead.created_at);

      if (createdAt >= weekAgo) counts.thisWeek += 1;
      if (createdAt >= todayStart) counts.today += 1;
      if (lead.status === "urgent_job") counts.urgent += 1;
      if (lead.status === "scheduled") counts.scheduled += 1;
      if (lead.status === "job_done" || lead.status === "paid") counts.done += 1;
      if (lead.status === "cancelled") counts.cancelled += 1;
      if (
        [
          "waiting_customer_response",
          "waiting_complete_details",
          "quote_sent_waiting",
          "quote_sent_need_follow_up",
          "needs_quote",
          "needs_reschedule",
        ].includes(lead.status)
      ) {
        counts.waiting += 1;
      }
    }

    return counts;
  }, [allLeads]);

  // Service Type Breakdown by lead volume
  const serviceDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of leads) {
      const type = lead.service_type?.trim() || "General / Unknown";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // top 5
  }, [leads]);

  // Lead Phone Source Breakdown by lead volume
  const sourceDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of leads) {
      const source = lead.number_name?.trim() || "Web / Scraper";
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [leads]);

  const getGrowth = (current: number, prev: number) => {
    if (prev === 0) return current > 0 ? 100 : 0;
    const delta = ((current - prev) / prev) * 100;
    return Math.round(delta);
  };

  const formatDelta = (growth: number) => {
    if (growth > 0) return `+${growth}%`;
    if (growth < 0) return `${growth}%`;
    return "0%";
  };

  const stats = [
    {
      label: "Total Leads",
      value: currentStats.totalLeads,
      sub: `${formatDelta(getGrowth(currentStats.totalLeads, prevStats.totalLeads))} vs last period`,
      icon: Users,
      tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    },
    {
      label: "Scheduled Visits",
      value: currentStats.scheduled,
      sub: `${formatDelta(getGrowth(currentStats.scheduled, prevStats.scheduled))} vs last period`,
      icon: Calendar,
      tone: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    },
    {
      label: "Completed Jobs",
      value: currentStats.completed,
      sub: `${formatDelta(getGrowth(currentStats.completed, prevStats.completed))} vs last period`,
      icon: CheckCircle2,
      tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    },
    {
      label: "Conversion Rate",
      value: `${currentStats.conversionRate.toFixed(1)}%`,
      sub: `${formatDelta(getGrowth(currentStats.conversionRate, prevStats.conversionRate))} vs last period`,
      icon: Percent,
      tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    },
  ];

  const statusSummary = [
    {
      label: "Urgent Attention",
      value: summary.urgent,
      icon: AlertTriangle,
      tone: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    },
    {
      label: "Scheduled Visits",
      value: summary.scheduled,
      icon: Calendar,
      tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    },
    {
      label: "Completed Jobs",
      value: summary.done,
      icon: CheckCircle2,
      tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    },
    {
      label: "Waiting Response",
      value: summary.waiting,
      icon: Clock3,
      tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    },
  ];

  const CustomCountTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;

    return (
      <div className="rounded-2xl border border-border bg-popover px-4 py-3 shadow-sm">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-sm font-semibold text-foreground">{payload[0].value} leads</p>
      </div>
    );
  };

  return (
    <div className="quo-theme analytics-workspace mx-auto max-w-[1450px] space-y-6 text-foreground">
      {/* Header Block */}
      <div className="relative overflow-hidden rounded-[28px] border border-border bg-card p-6 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.10)] dark:shadow-[0_22px_60px_-34px_rgba(0,0,0,0.45)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--foreground)/0.03),transparent_28%)]" />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <motion.div variants={heroTitle} initial="initial" animate="animate">
            <div className="mb-3 inline-flex items-center gap-1 rounded-full border border-blue-500/10 bg-blue-500/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400">
              <Sparkles className="h-2.5 w-2.5" />
              Advanced Analytics
            </div>

            <h1 className="text-2xl font-bold tracking-[-0.03em] text-foreground sm:text-3xl">{csOnly ? "CS Team Performance" : tab === "coverage_sources" && canCoverageReport ? "Lead Coverage & Sources" : "Operations Performance"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {csOnly ? "Leads added by each Customer Service and CS Admin team member, and how far they progressed." : tab === "coverage_sources" && canCoverageReport ? "Track incoming jobs by technician coverage, geographic area, and intake source." : "Monitor conversions, stage progressions, response rates, and team assignments."}
            </p>
          </motion.div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-2xl border border-border bg-muted p-1.5 shadow-[0_14px_34px_-28px_rgba(0,0,0,0.08)] dark:shadow-[0_14px_34px_-28px_rgba(0,0,0,0.35)]">
              {(["7d", "30d", "90d", "all"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setDateFilter(r);
                    setCustomStart("");
                    setCustomEnd("");
                  }}
                  className={cn(
                    "rounded-xl px-4 py-2 text-[12px] font-semibold transition-all duration-200",
                    dateFilter === r
                      ? "bg-card dark:bg-accent text-foreground shadow-sm border border-border/40"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r === "all" ? "All Time" : r}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label="Analytics start date"
                value={customStart}
                onChange={(e) => {
                  setCustomStart(e.target.value);
                  setDateFilter("custom");
                }}
                className="h-9 w-[130px] rounded-xl border border-border bg-muted px-3 text-[11px] text-foreground"
              />
              <span className="text-[10px] text-muted-foreground/70">to</span>
              <input
                type="date"
                aria-label="Analytics end date"
                value={customEnd}
                onChange={(e) => {
                  setCustomEnd(e.target.value);
                  setDateFilter("custom");
                }}
                className="h-9 w-[130px] rounded-xl border border-border bg-muted px-3 text-[11px] text-foreground"
              />
            </div>
          </div>
        </div>
      </div>

      {!csOnly && <div className="flex flex-wrap gap-2 border-b border-border pb-px" role="tablist" aria-label="Analytics views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "overview"}
          onClick={() => setActiveTab("overview")}
          className={cn(
            "px-4 py-2.5 text-[13px] font-semibold transition-colors rounded-t-lg",
            activeTab === "overview"
              ? "bg-card text-blue-600 dark:text-blue-400 border border-b-0 border-border relative z-10 -mb-px"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "cs_report"}
          onClick={() => setActiveTab("cs_report")}
          className={cn(
            "px-4 py-2.5 text-[13px] font-semibold transition-colors rounded-t-lg",
            activeTab === "cs_report"
              ? "bg-card text-blue-600 dark:text-blue-400 border border-b-0 border-border relative z-10 -mb-px"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          CS Team Performance
        </button>
        {canCoverageReport && <button type="button" role="tab" aria-selected={activeTab === "coverage_sources"} onClick={() => setActiveTab("coverage_sources")} className={cn("rounded-t-lg px-4 py-2.5 text-[13px] font-semibold transition-colors", activeTab === "coverage_sources" ? "relative z-10 -mb-px border border-b-0 border-border bg-card text-blue-600 dark:text-blue-400" : "text-muted-foreground hover:text-foreground")}>Lead Coverage &amp; Sources</button>}
      </div>}

      {tab === "overview" ? (
        <div className="space-y-6">
          {/* KPI Cards */}
      <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-4 sm:grid sm:grid-cols-2 xl:grid-cols-4 sm:overflow-x-visible sm:pb-0 scrollbar-hide">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-[85vw] snap-center sm:min-w-0">
            <Card className="rounded-2xl border border-border bg-card shadow-[0_14px_40px_-28px_rgba(0,0,0,0.08)] dark:shadow-[0_14px_40px_-28px_rgba(0,0,0,0.35)]">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                      {stat.label}
                    </p>
                    <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-foreground tabular-nums">
                      {stat.value}
                    </p>
                    <p className={cn(
                      "mt-1 text-[11px] font-medium flex items-center gap-1",
                      stat.sub.startsWith("-") ? "text-red-600 dark:text-red-400" : stat.sub.startsWith("0") ? "text-muted-foreground/70" : "text-emerald-600 dark:text-emerald-400"
                    )}>
                      {stat.sub}
                    </p>
                  </div>

                  <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl border", stat.tone)}>
                    <stat.icon className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {/* Main Layout Rows */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {/* Urgent leads sharing an area */}
          <Card className="rounded-[28px] border border-border bg-card shadow-[0_18px_52px_-34px_rgba(0,0,0,0.09)] dark:shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">
                    Urgent Leads Sharing an Area
                  </h3>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Urgent jobs in the same city or within {NEARBY_RADIUS_MILES} miles of each other.
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-[28px] font-semibold leading-none tabular-nums text-red-600 dark:text-red-400">
                    {urgentLeadsInSharedAreas}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    across {urgentClusters.length === 1 ? "1 area" : `${urgentClusters.length} areas`}
                  </p>
                </div>
              </div>

              {urgentClusters.length === 0 ? (
                <p className="rounded-2xl border border-border bg-muted/50 px-4 py-6 text-center text-[12px] text-muted-foreground">
                  No urgent leads are sharing an area right now.
                </p>
              ) : (
                <div className="space-y-2">
                  {urgentClusters.map((cluster) => (
                    <div
                      key={cluster.key}
                      className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-muted/50 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-foreground">{cluster.label}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {cluster.leads
                            .map((lead) => lead.customer_name || lead.job_id || "Lead")
                            .join(", ")}
                        </p>
                      </div>

                      <span className="shrink-0 rounded-full bg-red-500/15 px-2.5 py-0.5 text-[12px] font-semibold tabular-nums text-red-600 dark:text-red-400">
                        {cluster.leads.length}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Daily Leads Volume */}
          <Card className="rounded-[28px] border border-border bg-card shadow-[0_18px_52px_-34px_rgba(0,0,0,0.09)] dark:shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-5">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">Daily Leads Intake</h3>
                <p className="mt-1 text-[12px] text-muted-foreground">Track the number of leads received daily over the period.</p>
              </div>

              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barCategoryGap={10}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomCountTooltip />} cursor={{ fill: "rgba(120,130,150,0.10)" }} />
                    <Bar dataKey="count" fill="hsl(217, 91%, 60%)" radius={[8, 8, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Lead Funnel Analysis */}
          <Card className="rounded-[28px] border border-border bg-card shadow-[0_18px_52px_-34px_rgba(0,0,0,0.09)] dark:shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-5">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">Operational Conversion Funnel</h3>
                <p className="mt-1 text-[12px] text-muted-foreground">Conversion stages of leads captured in range.</p>
              </div>

              <div className="space-y-4 py-2">
                {funnelData.map((step) => (
                  <div key={step.step} className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-foreground/80">{step.step}</span>
                      <span className="text-foreground flex items-center gap-2">
                        <span>{step.count} leads</span>
                        <span className="text-muted-foreground/70">|</span>
                        <span className="text-blue-600 dark:text-blue-400">{step.pct}% conversion</span>
                      </span>
                    </div>
                    <div className="relative h-3.5 w-full overflow-hidden rounded-full bg-muted border border-border/80">
                      <div
                        className={cn("h-full rounded-full transition-all duration-500", step.color)}
                        style={{ width: `${step.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Lead Aging Analysis */}
          <Card className="rounded-[28px] border border-border bg-card shadow-[0_18px_52px_-34px_rgba(0,0,0,0.09)] dark:shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-5">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">Active Lead Aging (Unresolved)</h3>
                <p className="mt-1 text-[12px] text-muted-foreground">Duration active leads have remained in pipeline.</p>
              </div>

              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomCountTooltip />} />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]} isAnimationActive={false}>
                      {agingData.map((entry, idx) => (
                        <Cell key={`cell-${idx}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Columns */}
        <div className="space-y-6">
          {/* Pipelines status list */}
          <Card className="rounded-[28px] border border-border bg-card shadow-[0_18px_52px_-34px_rgba(0,0,0,0.09)] dark:shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-4">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">CRM Pipelines Status</h3>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Global pipelines summary of all leads in database.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {statusSummary.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-2xl border border-border/80 bg-muted/50 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl border", item.tone)}>
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-foreground">{item.label}</p>
                        <p className="text-[11px] text-muted-foreground/70">Pipeline active leads</p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-xl font-bold tracking-[-0.03em] text-foreground tabular-nums">
                        {item.value}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* CS Agent Performance */}
          <Card className="rounded-[28px] border border-border bg-card shadow-[0_18px_52px_-34px_rgba(0,0,0,0.09)] dark:shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-4">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">CS Agent Performance</h3>
                <p className="mt-1 text-[12px] text-muted-foreground">Leads assigned per CS staff representative.</p>
              </div>

              {agentPerformance.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground/70">No agent assignments recorded yet.</div>
              ) : (
                <div className="space-y-4">
                  {agentPerformance.map((item) => (
                    <div key={item.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="truncate text-foreground/80 flex items-center gap-1.5">
                          <UserCheck className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
                          {item.name}
                        </span>
                        <span className="text-foreground">{item.count} leads</span>
                      </div>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full"
                          style={{
                            width: `${currentStats.totalLeads > 0 ? (item.count / currentStats.totalLeads) * 100 : 0}%`
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
                        <span>Active range</span>
                        <span>
                          {currentStats.totalLeads > 0
                            ? ((item.count / currentStats.totalLeads) * 100).toFixed(0)
                            : 0}
                          % share
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Service Types Performance */}
          <Card className="rounded-[28px] border border-border bg-card shadow-[0_18px_52px_-34px_rgba(0,0,0,0.09)] dark:shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-4">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">Top Service Sectors</h3>
                <p className="mt-1 text-[12px] text-muted-foreground">Distribution by lead volume.</p>
              </div>

              {serviceDistribution.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground/70">No services metadata recorded yet.</div>
              ) : (
                <div className="space-y-4">
                  {serviceDistribution.map((item) => (
                    <div key={item.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="truncate text-foreground/80 flex items-center gap-1.5">
                          <Briefcase className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
                          {item.name}
                        </span>
                        <span className="text-foreground">{item.count} leads</span>
                      </div>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full"
                          style={{
                            width: `${currentStats.totalLeads > 0 ? (item.count / currentStats.totalLeads) * 100 : 0}%`
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
                        <span>Active range</span>
                        <span>
                          {currentStats.totalLeads > 0
                            ? ((item.count / currentStats.totalLeads) * 100).toFixed(0)
                            : 0}
                          % share
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Lead Generating Sources */}
          <Card className="rounded-[28px] border border-border bg-card shadow-[0_18px_52px_-34px_rgba(0,0,0,0.09)] dark:shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-4">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">Top Ingestion Sources</h3>
                <p className="mt-1 text-[12px] text-muted-foreground">Leads grouped by phone line or scraper source.</p>
              </div>

              {sourceDistribution.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground/70">No lead sources mapped in this range.</div>
              ) : (
                <div className="space-y-4">
                  {sourceDistribution.map((item) => (
                    <div key={item.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="truncate text-foreground/80 flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
                          {item.name}
                        </span>
                        <span className="text-foreground">{item.count} leads</span>
                      </div>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
                          style={{
                            width: `${currentStats.totalLeads > 0 ? (item.count / currentStats.totalLeads) * 100 : 0}%`
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
                        <span>Active range</span>
                        <span>
                          {currentStats.totalLeads > 0
                            ? ((item.count / currentStats.totalLeads) * 100).toFixed(0)
                            : 0}
                          % share
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
        </div>
      ) : tab === "coverage_sources" ? (
        <LeadCoverageSources startMs={filteredRange.startMs} endMs={filteredRange.endMs} rangeError={rangeError} />
      ) : (
        <div className="space-y-6">
          <Card className="rounded-[28px] border border-border bg-card shadow-[0_18px_52px_-34px_rgba(0,0,0,0.09)] dark:shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)] overflow-hidden">
            <CardContent className="p-0">
              <div className="p-6 border-b border-border/60">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">CS Team Performance Report</h3>
                <p className="mt-1 text-[12px] text-muted-foreground">Detailed breakdown of leads added by each Customer Service and Admin team member for the selected date range.</p>
              </div>

              {teamWideCs && rangeError ? (
                <div role="alert" className="py-12 text-center text-sm text-destructive">{rangeError}</div>
              ) : teamWideCs && csTeam.isPending ? (
                <div aria-label="Loading CS Team Performance" className="py-12 text-center text-sm text-muted-foreground/70">Loading…</div>
              ) : teamWideCs && csTeam.isError ? (
                <div role="alert" className="space-y-3 py-12 text-center text-sm text-destructive">
                  <p>{csTeam.error.message}</p>
                  <button type="button" onClick={() => void csTeam.refetch()} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Retry</button>
                </div>
              ) : csRows.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground/70">No leads added by CS/Admin in this date range.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/60 hover:bg-transparent">
                        <TableHead className="text-muted-foreground font-medium">Team Member</TableHead>
                        <TableHead className="text-muted-foreground font-medium">Role</TableHead>
                        <TableHead className="text-muted-foreground font-medium text-right">Total Added</TableHead>
                        <TableHead className="text-muted-foreground font-medium text-right">Engaged</TableHead>
                        <TableHead className="text-muted-foreground font-medium text-right">Scheduled</TableHead>
                        <TableHead className="text-muted-foreground font-medium text-right">Jobs Completed</TableHead>
                        <TableHead className="text-muted-foreground font-medium text-right">Conversion Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csRows.map((member) => (
                        <TableRow key={member.id} className="border-border/60 hover:bg-muted/50">
                          <TableCell className="font-medium text-foreground flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                              <UserCheck className="w-3.5 h-3.5" />
                            </div>
                            {member.name}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <span className={cn(
                              "text-[11px] px-2 py-0.5 rounded-full border",
                              member.role === "CS Admin" ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                            )}>
                              {member.role}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium text-foreground/80">
                            {member.totalAdded}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {member.engaged}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {member.scheduled}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400/80 font-medium">
                            {member.completed}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              <span className={cn(
                                "tabular-nums font-semibold",
                                parseFloat(member.conversionRate) > 50 ? "text-emerald-600 dark:text-emerald-400" : parseFloat(member.conversionRate) > 20 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                              )}>
                                {member.conversionRate}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Analytics;
