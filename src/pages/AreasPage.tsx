import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToLeadChanges } from "@/lib/realtime";
import { Lead, LeadStatus } from "@/lib/constants";
import { extractCity } from "@/lib/address-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CalendarIcon, MapPin, Search, X, Loader2, LayoutGrid, List, Grid3X3 } from "lucide-react";
import { format, subDays, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, isSameDay, isSameWeek, isSameMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import AreaKPICards from "@/components/areas/AreaKPICards";
import AreaRankingList, { AREA_COLORS } from "@/components/areas/AreaRankingList";
import AreaCrossTab from "@/components/areas/AreaCrossTab";
import AreaStatusBreakdown from "@/components/areas/AreaStatusBreakdown";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { fetchAllRows } from "@/lib/supabase-paginate";

type Granularity = "daily" | "weekly" | "monthly";
type TabType = "all" | "closed" | "cancelled";
type GroupBy = "city" | "service" | "city_service";

const QUICK_RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
];

const TOP_N_OPTIONS = [
  { label: "Top 10", value: 10 },
  { label: "Top 25", value: 25 },
  { label: "Top 50", value: 50 },
  { label: "All", value: 10000 },
];

const CLOSED_STATUSES: LeadStatus[] = ["job_done", "paid"];
const CANCELLED_STATUSES: LeadStatus[] = ["cancelled"];

const TAB_CONFIG: { value: TabType; label: string }[] = [
  { value: "all", label: "All Leads" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

const GROUP_ICONS: Record<GroupBy, React.ElementType> = {
  city: MapPin,
  service: List,
  city_service: Grid3X3,
};

export default function AreasPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [loading, setLoading] = useState(true);
  const [activeQuick, setActiveQuick] = useState(30);
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("city");
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [topN, setTopN] = useState(10);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => { fetchLeads(); }, [dateRange]);

  useEffect(() => {
    // Shared per-tab leads channel (src/lib/realtime.ts): same events, instantly.
    const unsubscribe = subscribeToLeadChanges(
        (payload) => {
          const newRow = payload.new as Lead | undefined;
          const oldRow = payload.old as Lead | undefined;

          // Simple local state merge
          if (payload.eventType === "INSERT" && newRow) {
            const createdAt = new Date(newRow.created_at || "");
            if (createdAt >= dateRange.from && createdAt <= dateRange.to) {
              setLeads(prev => [...prev, newRow]);
            }
          } else if (payload.eventType === "UPDATE" && newRow) {
            setLeads(prev => {
              const exists = prev.some(l => l.id === newRow.id);
              if (exists) {
                return prev.map(l => l.id === newRow.id ? { ...l, ...newRow } : l);
              } else {
                const createdAt = new Date(newRow.created_at || "");
                if (createdAt >= dateRange.from && createdAt <= dateRange.to) {
                  return [...prev, newRow];
                }
              }
              return prev;
            });
          } else if (payload.eventType === "DELETE" && oldRow) {
            setLeads(prev => prev.filter(l => l.id !== oldRow.id));
          }
        }
      );

    return unsubscribe;
  }, [dateRange]);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const data = await fetchAllRows<Lead>((from, to) =>
        supabase
          .from("leads")
          .select("id, address, city, service_type, status, created_at")
          .gte("created_at", dateRange.from.toISOString())
          .lte("created_at", dateRange.to.toISOString())
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to)
      );
      setLeads(data);
    } catch (error) {
      console.error("Failed to fetch area leads:", error);
    }
    setLoading(false);
  };

  const filteredByTab = useMemo(() => {
    if (activeTab === "closed") return leads.filter((l) => CLOSED_STATUSES.includes(l.status as LeadStatus));
    if (activeTab === "cancelled") return leads.filter((l) => CANCELLED_STATUSES.includes(l.status as LeadStatus));
    return leads;
  }, [leads, activeTab]);

  const areaData = useMemo(() => {
    const counts: Record<string, { count: number; leads: Lead[] }> = {};
    filteredByTab.forEach((l) => {
      const area = groupBy === "service" ? (l.service_type || "Unknown") : (l.city || extractCity(l.address));
      if (!counts[area]) counts[area] = { count: 0, leads: [] };
      counts[area].count++;
      counts[area].leads.push(l);
    });
    let sorted = Object.entries(counts)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      sorted = sorted.filter((a) => a.name.toLowerCase().includes(q));
    }
    return sorted;
  }, [filteredByTab, groupBy, searchQuery]);

  const displayedAreas = areaData.slice(0, topN);

  const timeSeriesData = useMemo(() => {
    const filtered = selectedArea
      ? filteredByTab.filter((l) =>
          groupBy === "service"
            ? (l.service_type || "Unknown") === selectedArea
            : (l.city || extractCity(l.address)) === selectedArea
        )
      : filteredByTab;

    if (granularity === "daily") {
      const days = eachDayOfInterval({ start: dateRange.from, end: dateRange.to });
      return days.map((day) => ({
        label: format(day, "MMM d"),
        count: filtered.filter((l) => isSameDay(new Date(l.created_at), day)).length,
      }));
    }
    if (granularity === "weekly") {
      const weeks = eachWeekOfInterval({ start: dateRange.from, end: dateRange.to });
      return weeks.map((week) => ({
        label: format(week, "MMM d"),
        count: filtered.filter((l) => isSameWeek(new Date(l.created_at), week)).length,
      }));
    }
    const months = eachMonthOfInterval({ start: dateRange.from, end: dateRange.to });
    return months.map((month) => ({
      label: format(month, "MMM yyyy"),
      count: filtered.filter((l) => isSameMonth(new Date(l.created_at), month)).length,
    }));
  }, [filteredByTab, selectedArea, granularity, dateRange, groupBy]);

  const selectedAreaLeads = useMemo(() => {
    if (!selectedArea) return [];
    return filteredByTab.filter((l) =>
      groupBy === "service"
        ? (l.service_type || "Unknown") === selectedArea
        : (l.city || extractCity(l.address)) === selectedArea
    );
  }, [filteredByTab, selectedArea, groupBy]);

  const handleQuickRange = (days: number) => {
    setActiveQuick(days);
    setDateRange({ from: subDays(new Date(), days), to: new Date() });
  };

  const groupLabel = groupBy === "city" ? "Cities" : groupBy === "service" ? "Services" : "City × Service";
  const GroupIcon = GROUP_ICONS[groupBy];

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={staggerItem} className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
              <MapPin className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Area Insights</h1>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                <span className="font-mono">{format(dateRange.from, "MMM d")}</span>
                <span>–</span>
                <span className="font-mono">{format(dateRange.to, "MMM d, yyyy")}</span>
                <span className="mx-1">·</span>
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="font-semibold text-foreground">{filteredByTab.length}</span>}
                <span>leads</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-lg border border-border/60 bg-card p-0.5 gap-0.5">
            {QUICK_RANGES.map((r) => (
              <button key={r.days} onClick={() => handleQuickRange(r.days)}
                className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200",
                  activeQuick === r.days ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}>
                {r.label}
              </button>
            ))}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs border-border/60">
                <CalendarIcon className="h-3.5 w-3.5" /> Custom
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={{ from: dateRange.from, to: dateRange.to }}
                onSelect={(range) => {
                  if (range?.from && range?.to) {
                    setActiveQuick(0);
                    setDateRange({ from: range.from, to: range.to });
                  }
                }}
                numberOfMonths={2}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-card p-1 w-fit" role="tablist" aria-label="Area result type">
        {TAB_CONFIG.map((tab) => (
          <button key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            onClick={() => { setActiveTab(tab.value); setSelectedArea(null); }}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 relative",
              activeTab === tab.value ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}>
            {tab.label}
            {activeTab === tab.value && tab.value !== "all" && (
              <span className="ml-1.5 text-[10px] font-mono opacity-80">{filteredByTab.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="relative flex-1 max-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
          <Input placeholder={`Search ${groupBy === "service" ? "service" : "city"}...`} value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm bg-card border-border/60 focus-visible:border-primary/40" />
          {searchQuery && (
            <button type="button" aria-label="Clear area search" onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="h-6 w-px bg-border/60" />

        <Select value={groupBy} onValueChange={(v) => { setGroupBy(v as GroupBy); setSelectedArea(null); }}>
          <SelectTrigger className="w-[155px] h-9 text-sm bg-card border-border/60 gap-2">
            <GroupIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="city">By City</SelectItem>
            <SelectItem value="service">By Service</SelectItem>
            <SelectItem value="city_service">City × Service</SelectItem>
          </SelectContent>
        </Select>

        <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
          <SelectTrigger className="w-[110px] h-9 text-sm bg-card border-border/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>

        <Select value={String(topN)} onValueChange={(v) => setTopN(Number(v))}>
          <SelectTrigger className="w-[110px] h-9 text-sm bg-card border-border/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TOP_N_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedArea && (
          <Button variant="secondary" size="sm" className="h-9 text-sm gap-1.5 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15"
            onClick={() => setSelectedArea(null)}>
            <X className="h-3 w-3" /> {selectedArea}
          </Button>
        )}
      </div>

      {/* KPIs */}
      <AreaKPICards leads={filteredByTab} allLeads={leads} activeTab={activeTab} />

      {/* Main Content */}
      {groupBy === "city_service" ? (
        <Card className="border-border/40">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Grid3X3 className="h-4 w-4 text-primary" /> City × Service Matrix
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <AreaCrossTab leads={filteredByTab} topN={topN} searchQuery={searchQuery} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-2 border-border/40">
            <CardContent className="pt-5 pb-3">
              <AreaRankingList areas={displayedAreas} totalLeads={filteredByTab.length} selectedArea={selectedArea}
                onSelectArea={setSelectedArea} label={`Top ${groupLabel}`} />
            </CardContent>
          </Card>

          <Card className="lg:col-span-3 border-border/40">
            <CardHeader className="pb-2 border-b border-border/30">
              <CardTitle className="text-sm font-semibold text-foreground">
                {selectedArea ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                    {selectedArea}
                  </span>
                ) : `All ${groupLabel}`}
                <span className="text-muted-foreground font-normal ml-2">— {granularity}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timeSeriesData} barCategoryGap="12%">
                    <defs>
                      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      interval={timeSeriesData.length > 15 ? Math.floor(timeSeriesData.length / 7) : 0}
                      angle={timeSeriesData.length > 10 ? -40 : 0}
                      textAnchor={timeSeriesData.length > 10 ? "end" : "middle"}
                      height={timeSeriesData.length > 10 ? 55 : 30}
                      axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: "hsl(var(--muted))", radius: 4 }}
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px", fontSize: "12px" }} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="url(#barGradient)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Volume bar chart */}
      {groupBy !== "city_service" && displayedAreas.length > 0 && (
        <Card className="border-border/40">
          <CardHeader className="pb-2 border-b border-border/30">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-primary" />
              Lead Volume by {groupBy === "city" ? "City" : "Service"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={displayedAreas.slice(0, 10)} layout="vertical" barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "hsl(var(--muted))" }}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "10px", fontSize: "12px" }} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {displayedAreas.slice(0, 10).map((_, i) => (
                      <Cell key={i} fill={AREA_COLORS[i % AREA_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status breakdown */}
      {selectedArea && selectedAreaLeads.length > 0 && (
        <AreaStatusBreakdown leads={selectedAreaLeads} areaName={selectedArea} />
      )}
    </motion.div>
  );
}
