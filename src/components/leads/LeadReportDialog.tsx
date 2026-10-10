import { useState, useEffect, useMemo } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabase-paginate";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";
import { CheckCircle2, AlertTriangle, Monitor, RefreshCw, Smartphone, Users, Download, CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { subDays, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

type ReportLead = Pick<Tables<"leads">, "id" | "created_at" | "created_by" | "reference_name" | "job_id" | "customer_name" | "customer_phone" | "status"> & { created_by_name?: string | null };
type ReportRange = "today" | "yesterday" | "7d" | "30d" | "custom";

interface LeadReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface UserStats {
  userId: string;
  fullName: string;
  extensionCount: number;
  crmCount: number;
  totalCount: number;
}

interface LeadAuditRow {
  id: string;
  jobId: string;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  createdByName: string;
  status: string;
}

export default function LeadReportDialog({ open, onOpenChange }: LeadReportDialogProps) {
  const { user, role } = useAuth();
  const [range, setRange] = useState<ReportRange>("today");
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [rawLeads, setRawLeads] = useState<ReportLead[]>([]);
  const [customRange, setCustomRange] = useState<DateRange | undefined>();

  const isCS = role === "customer_service";

  // Fetch all profiles to resolve creator names
  useEffect(() => {
    if (!open) return;

    const fetchProfiles = async () => {
      const { data, error } = await supabase.from("profiles_public" as never).select("id, full_name") as { data: { id: string; full_name: string | null }[] | null; error: unknown };
      if (error) {
        console.error("Error fetching profiles:", error);
        return;
      }
      if (data) {
        const map: Record<string, string> = {};
        data.forEach((p) => {
          map[p.id] = p.full_name;
        });
        setProfiles(map);
      }
    };

    void fetchProfiles();
  }, [open]);

  // Fetch leads based on date range
  const fetchReportData = async () => {
    setLoading(true);
    try {
      let start = new Date();
      let end: Date | null = null;

      if (range === "custom") {
        if (!customRange?.from) {
          setRawLeads([]);
          setLoading(false);
          return;
        }
        start = new Date(customRange.from);
        start.setHours(0, 0, 0, 0);
        end = customRange.to ? new Date(customRange.to) : new Date(customRange.from);
        end.setHours(23, 59, 59, 999);
      } else if (range === "today") {
        start.setHours(0, 0, 0, 0);
      } else if (range === "yesterday") {
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        end = todayStart;
      } else if (range === "7d") {
        start.setDate(start.getDate() - 7);
        start.setHours(0, 0, 0, 0);
      } else if (range === "30d") {
        start.setDate(start.getDate() - 30);
        start.setHours(0, 0, 0, 0);
      }

      // Page through the whole date range so the report/export isn't capped at
      // PostgREST's 1000-row limit.
      const data = await fetchAllRows<ReportLead>((from, to) => {
        let query = supabase
          .from("leads")
          .select("id, created_at, created_by, reference_name, job_id, customer_name, customer_phone, status")
          .gte("created_at", start.toISOString());
        if (end) {
          query = query.lte("created_at", end.toISOString());
        }
        // If user is CS, Supabase RLS will automatically restrict results,
        // but let's query explicitly just to be clean
        if (isCS && user) {
          query = query.eq("created_by", user.id);
        }
        return query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
      });
      setRawLeads(data);
    } catch (error) {
      toast.error((error as { message?: string }).message || "Failed to load report data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      if (range === "custom" && !customRange?.from) {
        return;
      }
      void fetchReportData();
    }
  }, [open, range, customRange]);

  // Export to CSV helper
  const exportToCSV = () => {
    try {
      if (rawLeads.length === 0) {
        toast.error("No data to export.");
        return;
      }

      const headers = [
        "Date",
        "Job ID",
        "Customer Name",
        "Phone",
        "Created By",
        "Status",
        "Reference"
      ];

      const csvRows = rawLeads.map((lead) => {
        const creatorName = (lead.created_by ? profiles[lead.created_by] || `User (${lead.created_by.slice(0, 8)})` : null) || lead.created_by_name || "Deleted user";
        const dateStr = lead.created_at
          ? format(new Date(lead.created_at), "yyyy-MM-dd HH:mm:ss")
          : "";
        return [
          dateStr,
          lead.job_id || "",
          lead.customer_name || "",
          lead.customer_phone || "",
          creatorName,
          lead.status || "",
          lead.reference_name || "Direct CRM"
        ];
      });

      // Escape values and join with commas
      const csvContent = [
        headers.join(","),
        ...csvRows.map((row) =>
          row
            .map((val) => `"${String(val).replace(/"/g, '""')}"`)
            .join(",")
        )
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `crm_leads_report_${range}_${format(new Date(), "yyyyMMdd_HHmmss")}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("CSV report downloaded successfully.");
    } catch (err) {
      toast.error("Failed to export report: " + (err as { message?: string }).message);
    }
  };

  // Compute stats per user
  const userStatsList = useMemo(() => {
    const statsMap: Record<string, UserStats> = {};

    // Initialize map with known profiles (only if user is admin/processor, or CS user themselves)
    Object.entries(profiles).forEach(([id, name]) => {
      if (!isCS || (user && id === user.id)) {
        statsMap[id] = {
          userId: id,
          fullName: name,
          extensionCount: 0,
          crmCount: 0,
          totalCount: 0,
        };
      }
    });

    // Process leads
    rawLeads.forEach((lead) => {
      const creatorId = lead.created_by || `deleted:${lead.created_by_name || "unknown"}`;
      const isExtension = lead.reference_name === "Chrome Extension";

      if (!statsMap[creatorId]) {
        // Fallback for users not in profiles
        statsMap[creatorId] = {
          userId: creatorId,
          fullName: (lead.created_by ? profiles[lead.created_by] || `User (${lead.created_by.slice(0, 8)})` : null) || lead.created_by_name || "Deleted user",
          extensionCount: 0,
          crmCount: 0,
          totalCount: 0,
        };
      }

      const stats = statsMap[creatorId];
      if (isExtension) {
        stats.extensionCount++;
      } else {
        stats.crmCount++;
      }
      stats.totalCount++;
    });

    // Return list, filter out users who have 0 leads in this range (except current user)
    return Object.values(statsMap)
      .filter((s) => s.totalCount > 0 || (user && s.userId === user.id))
      .sort((a, b) => b.totalCount - a.totalCount);
  }, [rawLeads, profiles, isCS, user]);

  // Compute total aggregates
  const totals = useMemo(() => {
    let extension = 0;
    let crm = 0;
    rawLeads.forEach((lead) => {
      if (lead.reference_name === "Chrome Extension") {
        extension++;
      } else {
        crm++;
      }
    });
    return {
      extension,
      crm,
      total: rawLeads.length,
    };
  }, [rawLeads]);

  // Map extension leads for recent captures audit list
  const extensionLeads = useMemo<LeadAuditRow[]>(() => {
    return rawLeads
      .filter((lead) => lead.reference_name === "Chrome Extension")
      .map((lead) => ({
        id: lead.id,
        jobId: lead.job_id,
        customerName: lead.customer_name,
        customerPhone: lead.customer_phone,
        createdAt: lead.created_at,
        createdByName: (lead.created_by ? profiles[lead.created_by] : null) || lead.created_by_name || "Deleted user",
        status: lead.status,
      }))
      .slice(0, 20); // Top 20 for audit
  }, [rawLeads, profiles]);

  const rangeLabels: Record<string, string> = {
    today: "Today",
    yesterday: "Yesterday",
    "7d": "Last 7 Days",
    "30d": "Last 30 Days",
    custom: "Custom Range",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-3xl border border-border/60 bg-card/95 shadow-brand backdrop-blur-xl">
          <DialogHeader className="flex flex-row flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border/50 pb-4">
          <div>
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              Lead Submission Report
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              Audit lead submissions across CRM channels and extensions.
            </DialogDescription>
          </div>

          <div className="flex items-center gap-3 pr-6">
            <Select value={range} onValueChange={(val) => setRange(val as ReportRange)}>
              <SelectTrigger className="w-[140px] h-9 rounded-xl border border-border/60">
                <SelectValue placeholder="Date Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
            </Select>
              {range === "custom" && (
                <div className="grid gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                          "w-auto justify-start text-left font-normal h-9",
                          !customRange && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
                        {customRange?.from ? (
                          customRange.to ? (
                            <>
                              {format(customRange.from, "LLL dd, y")} -{" "}
                              {format(customRange.to, "LLL dd, y")}
                            </>
                          ) : (
                            format(customRange.from, "LLL dd, y")
                          )
                        ) : (
                          <span>Pick a date range</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="center">
                      <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={customRange?.from}
                        selected={customRange}
                        onSelect={setCustomRange}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
              <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-xl border-border/60"
              onClick={() => void fetchReportData()}
              disabled={loading}
              title="Refresh report data"
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
            </Button>

            {role === "admin" && (
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-xl border-border/60"
                onClick={exportToCSV}
                disabled={loading || rawLeads.length === 0}
                title="Export all leads to CSV"
              >
                <Download className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Aggregated Totals Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mt-4">
          <Card className="rounded-2xl border-border/50 bg-muted/[0.12] shadow-none">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Extension Leads
                </p>
                <p className="text-2xl font-bold text-foreground mt-1.5 tabular-nums">
                  {totals.extension}
                </p>
              </div>
              <div className="h-9 w-9 rounded-xl bg-primary/[0.08] text-primary flex items-center justify-center border border-primary/10">
                <Smartphone className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/50 bg-muted/[0.12] shadow-none">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Direct CRM Leads
                </p>
                <p className="text-2xl font-bold text-foreground mt-1.5 tabular-nums">
                  {totals.crm}
                </p>
              </div>
              <div className="h-9 w-9 rounded-xl bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))] flex items-center justify-center border border-[hsl(var(--success)/0.12)]">
                <Monitor className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/50 bg-muted/[0.12] shadow-none">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Leads Added
                </p>
                <p className="text-2xl font-bold text-foreground mt-1.5 tabular-nums">
                  {totals.total}
                </p>
              </div>
              <div className="h-9 w-9 rounded-xl bg-muted text-foreground flex items-center justify-center border border-border">
                <Users className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* User Breakdown Table */}
        <div className="mt-6 space-y-3">
          <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
            User Statistics Breakdown ({rangeLabels[range]})
          </h3>
          <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
            <Table>
              <TableHeader className="bg-muted/[0.22]">
                <TableRow>
                  <TableHead className="font-semibold text-xs py-3 px-4">User Name</TableHead>
                  <TableHead className="font-semibold text-xs py-3 px-4 text-center">Extension Leads</TableHead>
                  <TableHead className="font-semibold text-xs py-3 px-4 text-center">Direct CRM Leads</TableHead>
                  <TableHead className="font-semibold text-xs py-3 px-4 text-right">Total Submissions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && userStatsList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm py-8 text-muted-foreground">
                      Loading statistics...
                    </TableCell>
                  </TableRow>
                ) : userStatsList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm py-8 text-muted-foreground">
                      No leads submitted in this date range.
                    </TableCell>
                  </TableRow>
                ) : (
                  userStatsList.map((stat) => (
                    <TableRow key={stat.userId} className="hover:bg-muted/[0.05]">
                      <TableCell className="font-medium text-sm py-3 px-4">
                        {stat.fullName}
                        {user && stat.userId === user.id && (
                          <Badge variant="secondary" className="ml-2 text-[9px] px-1.5 py-0">
                            You
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm py-3 px-4 tabular-nums">
                        {stat.extensionCount}
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm py-3 px-4 tabular-nums">
                        {stat.crmCount}
                      </TableCell>
                      <TableCell className="text-right font-semibold font-mono text-sm py-3 px-4 tabular-nums">
                        {stat.totalCount}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Audit Log for Extension leads */}
        <div className="mt-8 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
              Recent Extension Captures
            </h3>
            <span className="text-[10px] text-muted-foreground">
              Showing last {extensionLeads.length} extension leads
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
            <Table>
              <TableHeader className="bg-muted/[0.22]">
                <TableRow>
                  <TableHead className="font-semibold text-xs py-3 px-4">Captured At</TableHead>
                  <TableHead className="font-semibold text-xs py-3 px-4">Job ID</TableHead>
                  <TableHead className="font-semibold text-xs py-3 px-4">Customer Name</TableHead>
                  <TableHead className="font-semibold text-xs py-3 px-4">Created By</TableHead>
                  <TableHead className="font-semibold text-xs py-3 px-4 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && extensionLeads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm py-8 text-muted-foreground">
                      Loading audit trail...
                    </TableCell>
                  </TableRow>
                ) : extensionLeads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm py-8 text-muted-foreground">
                      No extension leads captured in this range.
                    </TableCell>
                  </TableRow>
                ) : (
                  extensionLeads.map((lead) => (
                    <TableRow key={lead.id} className="hover:bg-muted/[0.05]">
                      <TableCell className="text-xs text-muted-foreground py-3 px-4">
                        {format(new Date(lead.createdAt), "MMM d, h:mm a")}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold py-3 px-4">
                        {lead.jobId}
                      </TableCell>
                      <TableCell className="text-sm py-3 px-4">
                        <div className="font-medium">{lead.customerName || "No Name"}</div>
                        <div className="text-xs text-muted-foreground font-mono">{lead.customerPhone || "No Phone"}</div>
                      </TableCell>
                      <TableCell className="text-sm py-3 px-4 text-muted-foreground">
                        {lead.createdByName}
                      </TableCell>
                      <TableCell className="text-right py-3 px-4">
                        <Badge
                          variant="outline"
                          className="capitalize text-[10px] px-1.5 py-0 border-border/80"
                        >
                          {lead.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}




