import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSharedQuery } from "@/hooks/useCrossTab";
import { subscribeToLeadChanges } from "@/lib/realtime";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { useAuth } from "@/contexts/AuthContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Calendar, LayoutList, FileText } from "lucide-react";
import { useNotepad } from "@/contexts/NotepadContext";
import StatusBadge from "@/components/leads/StatusBadge";
import AddLeadDialog from "@/components/leads/AddLeadDialog";
import LeadDetailPanel from "@/components/leads/LeadDetailPanel";
import LeadCoverageBadge from "@/components/leads/LeadCoverageBadge";
import UrgentAICheckDialog from "@/components/leads/UrgentAICheckDialog";
import { showsUrgentCheck } from "@/lib/urgent-verification";
import type { Lead } from "@/types";
import { LEAD_STATUS_CONFIG } from "@/types";
import { format } from "date-fns";
import { useAllowedStatuses } from "@/hooks/useAllowedStatuses";
import { compareLeadDisplayPriority } from "@/lib/constants";

const ALL_LEADS_TABLE_COLUMNS =
  "id, job_id, customer_name, customer_phone, address, status, service_type, created_at, last_edited_at, cs_tag, created_by, quote_requested_by, urgent_at, coverage_level, coverage_tech_count, coverage_area_label";

/**
 * Everything this table renders, plus every field the sort needs.
 * `compareLeadDisplayPriority` reads cs_tag, quote_requested_by and urgent_at
 * (tag rank, quote pinning, urgent ordering) and `isLeadPinnedForUser` reads
 * created_by / quote_requested_by, so those are not optional.
 *
 * `nearby_areas`, `quote`, `service_details` and `customer_schedule_requirements`
 * are deliberately excluded: they are only read by the detail view, which loads
 * its own row by id. Measured across the table they were ~674 kB of the 2.1 MB
 * that `select("*")` transferred, on every poll, for every client.
 *
 * Realtime `postgres_changes` delivers whole rows, so INSERT/UPDATE events merge
 * as a superset of this projection and the table stays correct between refetches.
 */
type AllLeadsRow = Pick<
  Lead,
  | "id" | "job_id" | "customer_name" | "customer_phone" | "address" | "status"
  | "service_type" | "created_at" | "last_edited_at" | "cs_tag" | "created_by"
  | "quote_requested_by" | "urgent_at"
  | "coverage_level" | "coverage_tech_count" | "coverage_area_label"
>;

const AllLeads = () => {
  const { user, role } = useAuth();
  const { toggleNotepad, activeUserIds } = useNotepad();
  const isAnyNotepadOpen = activeUserIds.length > 0;
  const [addOpen, setAddOpen] = useState(false);
  // Set when a lead is created in a safe status because the user asked for it to
  // be urgent. The check needs a saved row to read, so it runs after the insert.
  const [urgentCheckFor, setUrgentCheckFor] = useState<{
    leadId: string; jobId: string; customerName: string; previousStatus: string;
  } | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { filterLeads, allowedStatuses } = useAllowedStatuses();

  const queryClient = useQueryClient();
  const {
    data: leads = [],
    isLoading,
    refetch,
  } = useSharedQuery({
    queryKey: ["leads", role, user?.id],
    queryFn: async () => {
      // Page through the whole table so "All Leads" and its status counts don't
      // silently drop older leads past PostgREST's 1000-row response cap.
      return fetchAllRows<AllLeadsRow>((from, to) => {
        let query = supabase
          .from("leads")
          .select(ALL_LEADS_TABLE_COLUMNS)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);
        // CS can only see their own created leads
        if (role === "customer_service") {
          query = query.eq("created_by", user!.id);
        }
        return query;
      });
    },
    enabled: !!user,
    // The shared lead-changes subscription below applies INSERT/UPDATE/DELETE as
    // they happen, so this interval is only a safety net for missed events. It
    // used to be a plain per-tab refetchInterval; useSharedQuery keeps the same
    // 60s cadence but runs it in ONE tab per browser (other tabs receive the
    // result) and skips its turn while the overload guard has background
    // polling paused. Manual refetches and mutations are unaffected.
    sharedPoll: { intervalMs: 60000 },
    staleTime: 30000,
  });

  useEffect(() => {
    if (!user || !role) return;

    // One shared `leads` channel per tab (src/lib/realtime.ts): every change on
    // a leads row is security-checked server-side per open channel, so this page
    // must not open its own duplicate next to the other lead screens'.
    const unsubscribe = subscribeToLeadChanges((payload) => {
      const newRow = payload.new as AllLeadsRow | undefined;
      const oldRow = payload.old as AllLeadsRow | undefined;

      queryClient.setQueryData<AllLeadsRow[]>(["leads", role, user.id], (oldData) => {
        if (!oldData) return oldData;

        if (payload.eventType === "INSERT" && newRow) {
          const shouldSee = role !== "customer_service" || newRow.created_by === user.id;
          if (shouldSee) return [newRow, ...oldData];
        } else if (payload.eventType === "UPDATE" && newRow) {
          return oldData.map((l) => (l.id === newRow.id ? { ...l, ...newRow } : l));
        } else if (payload.eventType === "DELETE" && oldRow) {
          return oldData.filter((l) => l.id !== oldRow.id);
        }
        return oldData;
      });
    });

    return unsubscribe;
  }, [user, role, queryClient]);

  const visibleLeads = useMemo(() => {
    return filterLeads([...leads]);
  }, [leads, filterLeads]);

  const safeStatusFilter = statusFilter === "all" || allowedStatuses.has(statusFilter) ? statusFilter : "all";

  const filteredLeads = useMemo(() => {
    let result = [...visibleLeads];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.customer_name?.toLowerCase().includes(q) ||
          l.customer_phone?.toLowerCase().includes(q) ||
          l.job_id?.toLowerCase().includes(q) ||
          l.address?.toLowerCase().includes(q),
      );
    }

    if (safeStatusFilter !== "all") {
      result = result.filter((l) => l.status === safeStatusFilter);
    }

    return result.sort((a, b) => compareLeadDisplayPriority(a, b, user?.id, role));
  }, [visibleLeads, search, safeStatusFilter, user?.id, role]);

  const urgentCount = visibleLeads.filter((l) => l.status === "urgent_job").length;
  const scheduledCount = visibleLeads.filter((l) => l.status === "scheduled").length;
  const activeCount = visibleLeads.filter(
    (l) => l.status !== "cancelled" && l.status !== "paid" && l.status !== "job_done",
  ).length;

  const totalCount = visibleLeads.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">All Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">{totalCount} total leads</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleNotepad()}
            className={`gap-1.5 text-xs h-9 border-border/60 ${
              isAnyNotepadOpen ? "bg-primary/10 border-primary/30 text-primary" : "hover:bg-muted/30"
            }`}
          >
            <FileText className="h-4 w-4" />
            Notepad
          </Button>

          {(role === "admin" || role === "customer_service") && (
            <Button onClick={() => setAddOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add New Lead
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border text-sm">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="font-medium">{activeCount}</span>
          <span className="text-muted-foreground">Active</span>
        </div>

        {urgentCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-sm">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="font-medium text-red-700">{urgentCount}</span>
            <span className="text-red-600">Urgent</span>
          </div>
        )}

        {scheduledCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border text-sm">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{scheduledCount}</span>
            <span className="text-muted-foreground">Scheduled</span>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, address, or job ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={safeStatusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>

            {Object.entries(LEAD_STATUS_CONFIG)
              .filter(([key]) => allowedStatuses.has(key))
              .map(([key, cfg]) => (
                <SelectItem key={key} value={key}>
                  {cfg.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="bg-card border rounded-lg p-1">
          <div className="space-y-0">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 border-b last:border-0">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-card border rounded-lg">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <LayoutList className="h-7 w-7 text-muted-foreground" />
          </div>

          <p className="text-foreground font-medium mb-1">
            {search || safeStatusFilter !== "all" ? "No leads match your filters" : "No leads yet"}
          </p>

          <p className="text-sm text-muted-foreground mb-4">
            {search || safeStatusFilter !== "all"
              ? "Try adjusting your search or filter criteria"
              : 'Click "Add New Lead" to create your first lead'}
          </p>

          {!search && safeStatusFilter === "all" && (role === "admin" || role === "customer_service") && (
            <Button onClick={() => setAddOpen(true)} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Add New Lead
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-card border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[110px] px-5">Job ID</TableHead>
                <TableHead className="px-5">Customer</TableHead>
                <TableHead className="px-5">Status</TableHead>
                <TableHead className="px-5">Service</TableHead>
                <TableHead className="px-5">Last Edit</TableHead>
                <TableHead className="px-5">Created</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filteredLeads.map((lead) => (
                <TableRow
                  key={lead.id}
                  className="cursor-pointer transition-colors hover:bg-muted/50"
                  onClick={() => setSelectedLeadId(lead.id)}
                >
                  <TableCell className="font-mono text-xs px-5 py-4">{lead.job_id}</TableCell>
                  <TableCell className="font-medium px-5 py-4">{lead.customer_name}</TableCell>
                  <TableCell className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={lead.status} />
                      <LeadCoverageBadge
                        level={lead.coverage_level}
                        count={lead.coverage_tech_count}
                        areaLabel={lead.coverage_area_label}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground px-5 py-4">{lead.service_type}</TableCell>
                  <TableCell className="text-xs text-muted-foreground px-5 py-4">
                    {lead.last_edited_at ? format(new Date(lead.last_edited_at), "MMM d, h:mm a") : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground px-5 py-4">
                    {format(new Date(lead.created_at), "MMM d, yyyy")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddLeadDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSuccess={refetch}
          onUrgentCheckCreated={setUrgentCheckFor}
        />

        <UrgentAICheckDialog
          open={!!urgentCheckFor && showsUrgentCheck(role)}
          onOpenChange={(next) => { if (!next) setUrgentCheckFor(null); }}
          leadId={urgentCheckFor?.leadId ?? ""}
            onProceed={() => {
            void queryClient.invalidateQueries({ queryKey: ["leads"] });
            refetch();
          }}
        />

      {selectedLeadId && (
        <LeadDetailPanel leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} onUpdate={refetch} />
      )}
    </div>
  );
};

export default AllLeads;
