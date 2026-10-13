import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { useDeferredValue } from "react";
import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Lead, LeadStatus, STATUS_LABELS, STATUS_DOT_COLORS, ALL_LEAD_STATUSES, compareLeadDisplayPriority } from "@/lib/constants";
import { countTechs } from "@/lib/lead-techs";
import { extractCity, extractState } from "@/lib/address-utils";
import { buildNearbyUrgentMap, isUrgentLead } from "@/lib/lead-proximity";
import { preloadZipDataset } from "@/lib/zipCentroids";
import { useAllowedStatuses } from "@/hooks/useAllowedStatuses";
import { normalizePhoneE164 } from "@/lib/phone";
import { openLeadFromClick } from "@/lib/lead-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { type DateRange } from "react-day-picker";
import { ScheduleDateFilter } from "@/components/leads/ScheduleDateFilter";
import { doesLeadMatchScheduleDateRange, leadNeedsAttention } from "@/lib/schedule-date-filter";
import { readLeadsCache, writeLeadsCache } from "@/lib/leadsCache";
import { LEADS_INDEX_COLUMNS } from "@/lib/leads-index-columns";
import { Plus, Search, Download, Share2, X, SlidersHorizontal, BarChart3, Puzzle, FileText, Calendar as CalendarIcon, LayoutGrid, List, MapPin, Copy, RefreshCw } from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useNotepad } from "@/contexts/NotepadContext";
import LeadCard from "@/components/leads/LeadCard";
import OprLeadCard from "@/components/leads/OprLeadCard";
import LeadTable from "@/components/leads/LeadTable";
import type { LeadCancellationRequest } from "@/types";
import AddLeadDialog from "@/components/leads/AddLeadDialog";
import UrgentAICheckDialog from "@/components/leads/UrgentAICheckDialog";
import { showsUrgentCheck } from "@/lib/urgent-verification";
import LeadReportDialog from "@/components/leads/LeadReportDialog";
import ExportLeadsDialog, { ExportOptions } from "@/components/leads/ExportLeadsDialog";
import InstallExtensionDialog from "@/components/leads/InstallExtensionDialog";
import { toast } from "sonner";
import { canAddLeadViaExtension, canAddManualLead, isOperatorRole } from "@/lib/access";


import { motion } from "framer-motion";
import { heroTitle, premiumEase, cardGridContainer, cardGridItem } from "@/lib/motion";
import { formatDistanceToNow } from "date-fns";

const PAGE_SIZES = [20, 40, 60, 100];

interface ProfileRow {
  id: string;
  full_name: string;
}

interface LeadShareRow {
  lead_id: string;
}

interface LeadNoteExportRow {
  lead_id: string;
  note_type: "general" | "cs" | "processor";
  content: string;
  user_id: string | null;
  user_name?: string | null;
  created_at: string | null;
}

// Columns the leads list/cards actually use. This is every `leads` column
// EXCEPT `nearby_areas` — a potentially large JSON blob only the detail view
// reads (and that view fetches its own row). Selecting explicitly keeps the
// list payload small instead of pulling that blob for every lead.
// NOTE: if a new leads column needs to appear on the card/list, add it here.
const LEAD_LIST_COLUMNS =
  "address, amount, assigned_cs, booked_at, cancellation_reason, city, coverage_area_label, coverage_level, coverage_tech_count, created_at, created_by, created_by_name, cs_notes, cs_tag, customer_email, customer_landline, customer_name, customer_phone, customer_schedule_requirements, direction, expected_completion_date, for_us_amount, for_you_amount, general_notes, half_address, id, job_id, labor_amount, last_edited_at, last_edited_by, last_edited_by_name, latitude, longitude, material_amount, number_name, payment_amount, payment_screenshot_url, processor_notes, quote, quote_requested_by, reference_name, scheduled_date, scheduled_time_end, scheduled_time_start, service_details, service_type, show_quote_to_opr, source_url, state, status, tech_name, tech_number, terms, updated_at, urgent_at, zip_code";

// Only the few columns the Urgent-leads overview table shows (plus zip/city for
// the "Urgent in area" proximity count) — kept tiny so its frequent live refresh
// stays a featherweight, filtered (status=urgent_job) indexed read.
const URGENT_TABLE_COLUMNS = "id, customer_name, customer_phone, service_type, city, state, address, zip_code, urgent_at, created_at, customer_schedule_requirements, terms";
// How often to refresh the urgent overview while the page is visible. Small,
// because it only reads the tiny urgent subset, not the whole leads table.
const URGENT_TABLE_POLL_MS = 5000;

type UrgentRow = Pick<Lead, "id" | "customer_name" | "customer_phone" | "service_type" | "city" | "state" | "address" | "zip_code" | "urgent_at" | "created_at" | "customer_schedule_requirements" | "terms"> & { lead_ai_statuses?: { status: string; checked_at?: string } | null };

function CopyableCell({ text, title, className, defaultWidth = true, emptyClassName = "text-muted-foreground", align = "left", truncate = true }: { text: string; title?: string; className?: string; defaultWidth?: boolean; emptyClassName?: string; align?: "left" | "right"; truncate?: boolean }) {
  if (!text || text === "—") return <td className={`px-2 py-2 ${className || ""}`}><span className={emptyClassName}>—</span></td>;

  return (
    <td className={`px-2 py-2 ${defaultWidth ? "max-w-[160px]" : ""} ${className || ""}`}>
      <div className={`group/copy relative flex items-center gap-1.5 ${align === "right" ? "justify-end" : ""}`} title={title || text}>
        <span className={truncate ? "truncate" : "whitespace-normal break-words leading-tight"}>{text}</span>
        <button
          type="button"
          className="opacity-0 group-hover/copy:opacity-100 p-1 rounded-md hover:bg-muted-foreground/20 transition-opacity flex-shrink-0 focus:opacity-100"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            navigator.clipboard.writeText(text);
            toast.success("Copied!");
          }}
          title="Copy"
        >
          <Copy className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    </td>
  );
}

function formatSchedule(text: string | null | undefined) {
  if (!text) return "—";
  let result = text;
  // Remove year 2026
  result = result.replace(/,? \b2026\b/g, "");
  result = result.replace(/-\b2026\b/g, "");
  result = result.replace(/\b2026\b/g, "");
  
  // Replace month names to match user's requested half words
  const map: Record<string, string> = {
    'january': 'Jan',
    'february': 'Feb',
    'march': 'March',
    'mar': 'March',
    'april': 'Apr',
    'may': 'May',
    'june': 'Jun',
    'july': 'Jul',
    'august': 'Aug',
    'september': 'Sept',
    'sep': 'Sept',
    'october': 'Oct',
    'november': 'Nov',
    'december': 'Dec'
  };

  for (const [key, val] of Object.entries(map)) {
    const regex = new RegExp(`\\b${key}\\b`, 'gi');
    result = result.replace(regex, val);
  }

  return result.trim() || "—";
}

function isTodayOrTomorrow(scheduleText: string | null | undefined): boolean {
  if (!scheduleText) return false;
  const lower = scheduleText.toLowerCase();
  
  if (lower.includes("today") || lower.includes("tomorrow") || lower.includes("tonight") || lower.includes("tmrw")) return true;
  
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  
  const checkDate = (d: Date) => {
    const m = d.getMonth();
    const dt = d.getDate();
    const p1 = new RegExp(`\\b${months[m]}[a-z]*\\s*${dt}\\b`, 'i');
    const p2 = new RegExp(`\\b${dt}(?:st|nd|rd|th)?\\s*${months[m]}[a-z]*\\b`, 'i');
    const p3 = new RegExp(`\\b${m + 1}/${dt}\\b`, 'i');
    return p1.test(lower) || p2.test(lower) || p3.test(lower);
  };
  
  return checkDate(today) || checkDate(tomorrow);
}

export default function LeadsPage() {
  const { user, role, profile } = useAuth();
  const { toggleNotepad, isNotepadOpen, activeUserIds } = useNotepad();
  const isAnyNotepadOpen = activeUserIds.length > 0;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [sharedLeads, setSharedLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const [scheduleDateRange, setScheduleDateRange] = useState<DateRange | undefined>();
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(0);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"my" | "shared">("my");
  const [showAddDialog, setShowAddDialog] = useState(false);
  // A lead created as urgent lands in its ordinary starting status first, because
  // the check reads the saved row. The verification dialog then opens against the
  // new lead's id.
  const [urgentCheckFor, setUrgentCheckFor] = useState<{
    leadId: string; jobId: string; customerName: string; previousStatus: string;
  } | null>(null);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">(() => {
    return (localStorage.getItem("leadsViewMode") as "grid" | "table") || "grid";
  });

  useEffect(() => {
    localStorage.setItem("leadsViewMode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (search) params.set("search", search);
    else params.delete("search");
    
    // Only update if it actually changed to avoid infinite re-renders
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [search, searchParams, setSearchParams]);
  const [pagedMetadata, setPagedMetadata] = useState<Record<string, {
    hasNotes: { general: boolean; cs: boolean; processor: boolean; opr: boolean };
    techCount: number;
    photoCount: number;
    photoPaths: string[];
    pendingCancellationRequest: LeadCancellationRequest | null;
    cancellationReason: string | null;
    pendingQuoteApproval: boolean;
  }>>({});
  const [metadataFallbackKey, setMetadataFallbackKey] = useState<string | null>(null);
  // Bumped when a quote approval is filed or decided, so the "Pending CS Admin
  // approval" badge clears as soon as the request is approved or declined.
  const [quoteApprovalVersion, setQuoteApprovalVersion] = useState(0);
  const deferredSearch = useDeferredValue(search);

  const rawStatusFilter = searchParams.get("status") || "all";
  // "Need Attention" view: urgent leads whose schedule is due/overdue (auto tag).
  const attentionView = searchParams.get("attention") === "1";
  const isAdmin = role === "admin";
  const isCS = role === "customer_service";
  // Manual creation is admin / cs_admin, or a CS that Settings granted
  // "Manual Lead Addition". Everyone else adds leads through the extension.
  const canCreateLead = canAddManualLead(role, profile);
  // Only a CS user who lacks the manual grant is pointed at the extension;
  // Processors and Operators add leads by neither route.
  const canAddViaExtension = canAddLeadViaExtension(role, profile);

  const { filterLeads, allowedStatuses } = useAllowedStatuses();

  const safeStatusFilter =
    rawStatusFilter === "all" ||
    allowedStatuses.has(rawStatusFilter) ||
    (isOperatorRole(role) && leads.some((l) => Boolean(l.cs_tag) && l.status === rawStatusFilter))
      ? rawStatusFilter
      : "all";

  useEffect(() => {
    if (rawStatusFilter !== safeStatusFilter) {
      if (safeStatusFilter === "all") setSearchParams({});
      else setSearchParams({ status: safeStatusFilter });
    }
  }, [rawStatusFilter, safeStatusFilter, setSearchParams]);

  const setStatusFilter = (value: string) => {
    setPage(0);
    if (value === "all") setSearchParams({});
    else setSearchParams({ status: value });
  };

  // Reset to the first page when entering or leaving the Need Attention view.
  useEffect(() => {
    setPage(0);
  }, [attentionView]);

  const fetchProfiles = useCallback(async () => {
    const { data, error } = await supabase.from("profiles_public" as never).select("id, full_name") as { data: { id: string; full_name: string | null }[] | null; error: unknown };

    if (error) {
      toast.error((error as { message?: string })?.message ?? "Failed to load users");
      return;
    }

    if (data) {
      const map: Record<string, string> = {};
      (data as ProfileRow[]).forEach((p) => {
        map[p.id] = p.full_name;
      });
      setProfiles(map);
    }
  }, []);

  // Guards against stale/overlapping loads: each call bumps this, and a load
  // abandons its remaining work if a newer load has started since.
  const leadsLoadGenRef = useRef(0);

  const fetchLeads = useCallback(async (isBackground = false) => {
    if (!user || !role) return;

    const gen = ++leadsLoadGenRef.current;
    if (!isBackground) setLoading(true);

    // Page through the WHOLE table — PostgREST caps a single response at 1000
    // rows, so we keep fetching pages until one comes back short. Every lead is
    // loaded (no cap), and the list is only shown once the full set is in hand,
    // so status counts always reflect every lead — never a partial/short count.
    const PAGE = 1000;
    const acc = new Map<string, Lead>();
    try {
      for (let page = 0; ; page++) {
        let query = supabase
          .from("leads")
          .select(LEADS_INDEX_COLUMNS)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        // CS can see only own created leads
        if (role === "customer_service") {
          query = query.eq("created_by", user.id);
        }
        const { data, error } = await query;
        if (error) throw error;
        if (gen !== leadsLoadGenRef.current) return; // superseded by a newer load

        const rows = (data ?? []) as unknown as Lead[];
        for (const r of rows) if (r?.id) acc.set(r.id, r);
        if (rows.length < PAGE) break; // last page reached — every lead is loaded
      }
      if (gen !== leadsLoadGenRef.current) return;
      // Atomic replace with the complete dataset — counts are never partial.
      const full = Array.from(acc.values());
      setLeads(full);
      if (!isBackground) setLoading(false);
      // Persist the complete set so the next visit paints instantly from cache.
      void writeLeadsCache(`${role}:${user.id}`, full);
    } catch (err) {
      if (gen !== leadsLoadGenRef.current) return;
      toast.error(err instanceof Error ? err.message : "Failed to load leads");
      setLeads([]);
      if (!isBackground) setLoading(false);
    }
  }, [role, user]);

  const fetchSharedLeads = useCallback(async () => {
    if (!user || role !== "customer_service") return;

    const { data: shares, error: sharesError } = await supabase
      .from("lead_shares")
      .select("lead_id")
      .eq("shared_with_user_id", user.id);

    if (sharesError) {
      toast.error(sharesError.message);
      setSharedLeads([]);
      return;
    }

    if (!shares || shares.length === 0) {
      setSharedLeads([]);
      return;
    }

    const leadIds = (shares as LeadShareRow[]).map((share) => share.lead_id);

    const { data: leadsData, error: leadsError } = await supabase
      .from("leads")
      .select(LEAD_LIST_COLUMNS)
      .in("id", leadIds)
      .order("created_at", { ascending: false });

    if (leadsError) {
      toast.error(leadsError.message);
      setSharedLeads([]);
      return;
    }

    setSharedLeads((leadsData ?? []) as unknown as Lead[]);
  }, [role, user]);

  useEffect(() => {
    if (!user || !role) return;
    let cancelled = false;

    // Stale-while-revalidate: paint instantly from the last complete set in the
    // browser cache (no spinner), then refresh in the background. Only the very
    // first load (empty cache) shows the loading state. The cache always holds
    // the whole list, so counts from it are complete — never capped.
    void (async () => {
      const cached = await readLeadsCache(`${role}:${user.id}`);
      if (cancelled) return;
      if (cached && cached.length > 0) {
        setLeads(cached);
        setLoading(false);
        void fetchLeads(true); // refresh quietly in the background
      } else {
        void fetchLeads(false); // first load — show the loading state
      }
    })();

    void fetchProfiles();

    if (role === "customer_service") {
      void fetchSharedLeads();
    } else {
      setSharedLeads([]);
    }

    return () => {
      cancelled = true;
    };
  }, [fetchLeads, fetchProfiles, fetchSharedLeads, role, user]);

  // Safety-net polling. The realtime subscription above already merges every
  // INSERT/UPDATE/DELETE surgically, so a full refetch is only a fallback for
  // missed events (e.g. RLS-blocked realtime). Instead of re-downloading every
  // lead every 15s in every open tab — including hidden ones — poll only while
  // the tab is visible, and far less often, plus refresh once when the user
  // returns to the tab so it's immediately up to date.
  useEffect(() => {
    if (!user || !role) return;

    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void fetchLeads(true);
      if (role === "customer_service") {
        void fetchSharedLeads();
      }
    };

    const intervalId = setInterval(refresh, 60000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchLeads, fetchSharedLeads, user, role]);




  // Bridge so a realtime urgent change refreshes the overview table instantly.
  // A ref keeps the channel subscription stable (no re-subscribe on identity change).
  const refreshUrgentRef = useRef<(() => void) | null>(null);

  // Realtime subscription for leads table updates & Activate Customer chime
  useEffect(() => {
    if (!user || !role) return;

    const channel = supabase
      .channel("leads-realtime-page")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
        },
        (payload) => {
          const newRow = payload.new as Lead | undefined;
          const oldRow = payload.old as Lead | undefined;

          // Surgical merge — no full refetch needed
          if (payload.eventType === "INSERT" && newRow) {
            // Only add if this user should see the lead
            const shouldSee =
              role === "admin" || role === "processor" || role === "cs_admin" || isOperatorRole(role) ||
              (role === "customer_service" && newRow.created_by === user.id);
            if (shouldSee) {
              // Dedupe by id: the creator's own refetch (AddLeadDialog's
              // onSuccess) can land before this event, and a blind prepend
              // would then show the lead twice until the next full refresh.
              setLeads((prev) => {
                const i = prev.findIndex((l) => l.id === newRow.id);
                if (i === -1) return [newRow, ...prev];
                const next = [...prev];
                next[i] = { ...next[i], ...newRow };
                return next;
              });
            }
          } else if (payload.eventType === "UPDATE" && newRow) {
            setLeads((prev) =>
              prev.map((l) => (l.id === newRow.id ? { ...l, ...newRow } : l))
            );
            // Also update shared leads if applicable
            if (role === "customer_service") {
              setSharedLeads((prev) =>
                prev.map((l) => (l.id === newRow.id ? { ...l, ...newRow } : l))
              );
            }
          } else if (payload.eventType === "DELETE" && oldRow) {
            setLeads((prev) => prev.filter((l) => l.id !== oldRow.id));
            if (role === "customer_service") {
              setSharedLeads((prev) => prev.filter((l) => l.id !== oldRow.id));
            }
          }

          // A lead becoming (or changing while) urgent refreshes the overview
          // table right away, so it never waits for the next poll tick.
          if (
              newRow?.status === "urgent_job" || 
              oldRow?.status === "urgent_job"
            ) {
              refreshUrgentRef.current?.();
            }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [role, user]);

  // Quote approval decisions do not always touch the lead row (a decline leaves
  // it untouched), so the badge listens to the request table itself.
  useEffect(() => {
    if (!user || !role) return;
    const channel = supabase
      .channel("leads-page-quote-approvals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_quote_approval_requests" },
        () => setQuoteApprovalVersion((v) => v + 1),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [role, user]);

  const visibleMyLeads = useMemo(() => filterLeads([...leads]), [leads, filterLeads]);
  const visibleSharedLeads = useMemo(() => [...sharedLeads], [sharedLeads]);

  const currentLeads = activeTab === "shared" ? visibleSharedLeads : visibleMyLeads;

  // Distances come from the US ZIP centroid dataset, which is ~1.8MB and loaded lazily. Only
  // pulled in when there are urgent leads to compare, and the flag re-runs the grouping below
  // once it is in memory.
  const [zipDataReady, setZipDataReady] = useState(false);
  const hasUrgentLeads = useMemo(() => currentLeads.some((l) => isUrgentLead(l.status)), [currentLeads]);

  useEffect(() => {
    if (!hasUrgentLeads || zipDataReady) return;
    let active = true;
    void preloadZipDataset().then(() => {
      if (active) setZipDataReady(true);
    });
    return () => {
      active = false;
    };
  }, [hasUrgentLeads, zipDataReady]);

  // Derived from the live leads state, so a status change anywhere updates every card in the
  // cluster at once - the realtime subscription already keeps that state current.
  const nearbyUrgentMap = useMemo(
    () => buildNearbyUrgentMap(currentLeads),
    // zipDataReady is not read here, but recomputing once the centroids land is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentLeads, zipDataReady],
  );

  const filtered = useMemo(() => {
    let result = [...currentLeads];

    // The Need Attention view overrides the status filter: it always shows the
    // auto-tagged urgent leads (due/overdue schedule), never a single status.
    if (attentionView) {
      result = result.filter((l) => leadNeedsAttention(l));
    } else if (safeStatusFilter !== "all") {
      result = result.filter((l) => l.status === safeStatusFilter);
    }

    if (deferredSearch) {
      const s = deferredSearch.toLowerCase();
      result = result.filter(
        (l) =>
          l.customer_name?.toLowerCase().includes(s) ||
          l.job_id?.toLowerCase().includes(s) ||
          l.customer_phone?.toLowerCase().includes(s) ||
          l.customer_landline?.toLowerCase().includes(s) ||
          l.address?.toLowerCase().includes(s) ||
          l.city?.toLowerCase().includes(s) ||
          l.state?.toLowerCase().includes(s) ||
          l.service_type?.toLowerCase().includes(s),
      );
    }

    if (scheduleDateRange?.from) {
      result = result.filter((l) =>
        doesLeadMatchScheduleDateRange(l.customer_schedule_requirements, scheduleDateRange)
      );
    }

    result.sort((a, b) => compareLeadDisplayPriority(a, b, user?.id, role));

    return result;
  }, [currentLeads, deferredSearch, safeStatusFilter, scheduleDateRange, user?.id, role, attentionView]);

  // Status choices for the export dialog — the same set the on-page status
  // filter offers, so a user can export any status section they can see.
  const statusExportOptions = useMemo(
    () =>
      ALL_LEAD_STATUSES.filter(
        (s) => allowedStatuses.has(s) || (isOperatorRole(role) && leads.some((l) => Boolean(l.cs_tag) && l.status === s)),
      ).map((s) => ({ value: s, label: STATUS_LABELS[s] })),
    [allowedStatuses, role, leads],
  );

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  useEffect(() => {
    if (filtered.length === 0 && page !== 0) {
      setPage(0);
      return;
    }

    if (totalPages > 0 && page >= totalPages) {
      setPage(totalPages - 1);
    }
  }, [filtered.length, page, totalPages]);

  const pagedIdsStr = paged.map((l) => l.id).join(",");
  const usingMetadataFallback = metadataFallbackKey === pagedIdsStr;
  const pagedMetadataReady = usingMetadataFallback
    || paged.every((lead) => pagedMetadata[lead.id] !== undefined);

  // --- Visible-page hydration -------------------------------------------------
  // The index read above only carries what the status counts, filters, search and
  // sort need. The card-only columns (amounts, tech details, quote text) are
  // fetched here for the leads actually on screen, because sending them for all
  // ~3.9k rows was ~1.96 MB per load. Measured: the index projection is 577 kB
  // against 2,110 kB for every column.
  const [pageRows, setPageRows] = useState<Record<string, Lead>>({});
  const [pageRowsKey, setPageRowsKey] = useState<string | null>(null);
  const [pageRowsLoading, setPageRowsLoading] = useState(false);

  const loadPagedLeadRows = useCallback(async (ids: string[]) => {
    setPageRowsLoading(true);
    try {
      const { data, error } = await supabase
        .from("leads")
        .select(LEAD_LIST_COLUMNS)
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, Lead> = {};
      for (const row of (data ?? []) as unknown as Lead[]) {
        if (row?.id) map[row.id] = row;
      }
      setPageRows(map);
    } catch (err) {
      console.error("Failed to load visible lead rows", err);
      setPageRows({});
    } finally {
      setPageRowsLoading(false);
    }
  }, []);

  // Re-hydrate on page change, keeping the previous rows in state so pagination
  // never paints a half-loaded card.
  useEffect(() => {
    if (loading) return;
    const ids = pagedIdsStr ? pagedIdsStr.split(",") : [];
    if (ids.length === 0) {
      setPageRows({});
      setPageRowsKey(null);
      return;
    }
    if (pageRowsKey === pagedIdsStr) return;
    void loadPagedLeadRows(ids).then(() => setPageRowsKey(pagedIdsStr));
  }, [pagedIdsStr, loading, pageRowsKey, loadPagedLeadRows]);

  const renderRows = useMemo(
    () => paged.map((lead) => pageRows[lead.id] ?? lead),
    [paged, pageRows],
  );

  // Only paint once every visible lead has its full row.
  const pageRowsReady =
    !pageRowsLoading &&
    (paged.length === 0 || paged.every((lead) => pageRows[lead.id] !== undefined));

  useEffect(() => {
    let active = true;
    const loadPagedMetadata = async () => {
      const pagedIds = pagedIdsStr ? pagedIdsStr.split(",") : [];
      if (pagedIds.length === 0) {
        setPagedMetadata({});
        setMetadataFallbackKey(null);
        return;
      }

      setMetadataFallbackKey(null);

      try {
        const [notesRes, techNotesRes, photosRes, cancelRes, quoteApprovalRes] = await Promise.all([
          supabase
            .from("lead_notes")
            .select("lead_id, note_type")
            .in("lead_id", pagedIds),
          // Bodies of the processor notes only, so the card can show how many techs are inside
          // without pulling every note body on the page.
          supabase
            .from("lead_notes")
            .select("lead_id, content")
            .eq("note_type", "processor")
            .in("lead_id", pagedIds),
          supabase
            .from("lead_photos")
            .select("lead_id, photo_url, created_at")
            .in("lead_id", pagedIds)
            .order("created_at", { ascending: true }),
          // Not filtered to pending any more: the newest request per lead also supplies the
          // reason shown on a cancelled card, without a second round trip.
          supabase
            .from("lead_cancellation_requests")
            .select("*")
            .in("lead_id", pagedIds)
            .order("created_at", { ascending: false }),
          // Quote approvals still awaiting a CS Admin decision, for the badge on
          // the card. Kept out of the batch error below: a role that cannot read
          // this table just gets no badge, rather than losing all card metadata.
          supabase
            .from("lead_quote_approval_requests" as never)
            .select("lead_id")
            .eq("status", "pending")
            .in("lead_id", pagedIds)
        ]);

        if (!active) return;
        const batchError = notesRes.error || techNotesRes.error || photosRes.error || cancelRes.error;
        if (batchError) throw batchError;

        const metadataMap: Record<string, {
          hasNotes: { general: boolean; cs: boolean; processor: boolean; opr: boolean };
          techCount: number;
          photoCount: number;
          photoPaths: string[];
          pendingCancellationRequest: LeadCancellationRequest | null;
          cancellationReason: string | null;
          pendingQuoteApproval: boolean;
        }> = {};

        pagedIds.forEach((id) => {
          metadataMap[id] = {
            hasNotes: { general: false, cs: false, processor: false, opr: false },
            techCount: 0,
            photoCount: 0,
            photoPaths: [],
            pendingCancellationRequest: null,
            cancellationReason: null,
            pendingQuoteApproval: false,
          };
        });

        if (notesRes.data) {
          notesRes.data.forEach((note) => {
            const mapItem = metadataMap[note.lead_id];
            if (mapItem) {
              if (note.note_type === "general") mapItem.hasNotes.general = true;
              else if (note.note_type === "cs") mapItem.hasNotes.cs = true;
              else if (note.note_type === "processor") mapItem.hasNotes.processor = true;
              else if (note.note_type === "opr") mapItem.hasNotes.opr = true;
            }
          });
        }

        if (techNotesRes.data) {
          const byLead = new Map<string, string[]>();
          (techNotesRes.data as { lead_id: string; content: string | null }[]).forEach((note) => {
            const bodies = byLead.get(note.lead_id) ?? [];
            bodies.push(note.content ?? "");
            byLead.set(note.lead_id, bodies);
          });

          byLead.forEach((bodies, leadIdKey) => {
            const mapItem = metadataMap[leadIdKey];
            if (mapItem) mapItem.techCount = countTechs(bodies);
          });
        }

        if (photosRes.data) {
          photosRes.data.forEach((photo) => {
            const mapItem = metadataMap[photo.lead_id];
            if (mapItem) {
              mapItem.photoCount += 1;
              mapItem.photoPaths.push(photo.photo_url);
            }
          });
        }

        if (cancelRes.data) {
          // Rows arrive newest first, so the first one seen for a lead is its latest request.
          const seenLatest = new Set<string>();

          cancelRes.data.forEach((req) => {
            const mapItem = metadataMap[req.lead_id];
            if (!mapItem) return;

            const requestCopy = { ...req } as unknown as LeadCancellationRequest;
            if (requestCopy.requested_by) {
              requestCopy.requester_name = profiles[requestCopy.requested_by] || requestCopy.requested_by_name || null;
            } else {
              requestCopy.requester_name = requestCopy.requested_by_name || null;
            }

            if (requestCopy.status === "pending") {
              mapItem.pendingCancellationRequest = requestCopy;
            }

            if (!seenLatest.has(req.lead_id)) {
              seenLatest.add(req.lead_id);
              mapItem.cancellationReason = requestCopy.comment || null;
            }
          });
        }

        if (!quoteApprovalRes.error && quoteApprovalRes.data) {
          (quoteApprovalRes.data as unknown as { lead_id: string }[]).forEach((req) => {
            const mapItem = metadataMap[req.lead_id];
            if (mapItem) mapItem.pendingQuoteApproval = true;
          });
        }

        setPagedMetadata(metadataMap);
      } catch (err) {
        console.error("Failed to load paged metadata", err);
        if (active) setMetadataFallbackKey(pagedIdsStr);
      }
    };

    void loadPagedMetadata();

    return () => {
      active = false;
    };
  }, [pagedIdsStr, profiles, quoteApprovalVersion]);

  const countSource = activeTab === "shared" ? visibleSharedLeads : visibleMyLeads;

  const scheduledCount = countSource.filter((l) => l.status === "scheduled").length;
  const activeCount = countSource.filter(
    (l) => l.status !== "cancelled" && l.status !== "paid" && l.status !== "job_done",
  ).length;

  // Urgent-leads overview kept live by a light, visibility-gated poll of just
  // the urgent subset — a tiny filtered indexed read, independent of the heavy
  // main list. So new urgent leads land on top within a few seconds even if the
  // broad leads realtime hiccups, without polling the whole table. Server-
  // ordered newest-urgent first.
  const [urgentTableLeads, setUrgentTableLeads] = useState<UrgentRow[]>([]);

  const refreshUrgentTable = useCallback(async () => {
    if (!user || !role) return;
    let q = supabase
      .from("leads")
      .select(URGENT_TABLE_COLUMNS + ", lead_ai_statuses(status, checked_at)")
      .eq("status", "urgent_job")
      .order("urgent_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1000);
    if (role === "customer_service") q = q.eq("created_by", user.id);
    const { data, error } = await q;
    if (error) return; // keep the last good list on a transient error
    const next = (data ?? []) as unknown as UrgentRow[];
    setUrgentTableLeads((prev) => {
      // Keep the same array reference when nothing changed, so a quiet poll
      // doesn't re-render the table or recompute the proximity map.
      if (
        prev.length === next.length &&
        prev.every((p, i) => p.id === next[i].id && p.urgent_at === next[i].urgent_at && p.terms === next[i].terms && p.lead_ai_statuses?.status === next[i].lead_ai_statuses?.status && p.lead_ai_statuses?.checked_at === next[i].lead_ai_statuses?.checked_at)
      ) {
        return prev;
      }
      return next;
    });
  }, [user, role]);
  refreshUrgentRef.current = refreshUrgentTable;

  // Most recent AI-status check across the urgent leads — shown as a freshness
  // stamp so staff can tell how current the labels are (statuses auto-refresh
  // every 30 min and can be refreshed on demand).
  const aiStatusLastChecked = useMemo(() => {
    let latest = 0;
    for (const l of urgentTableLeads) {
      const checkedAt = l.lead_ai_statuses?.checked_at;
      const t = checkedAt ? new Date(checkedAt).getTime() : 0;
      if (t > latest) latest = t;
    }
    return latest ? new Date(latest) : null;
  }, [urgentTableLeads]);

  useEffect(() => {
    if (!user || !role) return;
    void refreshUrgentTable();
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refreshUrgentTable();
    };
    const id = setInterval(tick, URGENT_TABLE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUrgentTable();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, role, refreshUrgentTable]);

  // "Urgent in area" counts, computed from the fresh urgent subset (all rows are
  // urgent, so tag them for the proximity helper). Recomputes once ZIP centroids
  // are in memory.
  const urgentTableNearbyMap = useMemo(
    () => buildNearbyUrgentMap(urgentTableLeads.map((l) => ({ ...l, status: "urgent_job" as LeadStatus }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [urgentTableLeads, zipDataReady],
  );

  const [urgentNeedsCxReply, setUrgentNeedsCxReply] = useState<UrgentRow[]>([]);

    const checkCxReplies = useCallback(async () => {
    if (urgentTableLeads.length === 0) {
      setUrgentNeedsCxReply([]);
      return;
    }

    const phoneToLeads = new Map<string, UrgentRow[]>();
    for (const lead of urgentTableLeads) {
      if (!lead.customer_phone) continue;
      const normalized = normalizePhoneE164(lead.customer_phone) || lead.customer_phone.replace(/\D/g, "").slice(-10);
      if (!normalized) continue;
      const arr = phoneToLeads.get(normalized) || [];
      arr.push(lead);
      phoneToLeads.set(normalized, arr);
    }

    const phones = Array.from(phoneToLeads.keys());
    if (phones.length === 0) {
      setUrgentNeedsCxReply([]);
      return;
    }

    const { data, error } = await supabase
      .from("quo_conversations")
      .select("customer_number,last_customer_message_at,last_agent_message_at")
      .in("customer_number", phones);

    if (error) {
      console.error("Failed to check CX replies", error);
      return;
    }

    const needsReplyIds = new Set<string>();

    for (const row of data || []) {
      const cTime = row.last_customer_message_at ? new Date(row.last_customer_message_at).getTime() : 0;
      const aTime = row.last_agent_message_at ? new Date(row.last_agent_message_at).getTime() : 0;

      if (cTime > aTime) {
        const matchingLeads = phoneToLeads.get(row.customer_number || "") || [];
        for (const ml of matchingLeads) {
          needsReplyIds.add(ml.id);
        }
      }
    }

    setUrgentNeedsCxReply(urgentTableLeads.filter(l => needsReplyIds.has(l.id)));
  }, [urgentTableLeads]);

  useEffect(() => {
    void checkCxReplies();
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void checkCxReplies();
    };
    const id = setInterval(tick, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkCxReplies();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [checkCxReplies]);


  const hasActiveFilters = Boolean(search) || safeStatusFilter !== "all" || Boolean(scheduleDateRange?.from);

  const handleExportData = async (options: ExportOptions) => {
    setIsExporting(true);
    try {
      const allLeadMap = new Map<string, Lead>();
      leads.forEach((l) => allLeadMap.set(l.id, l));
      sharedLeads.forEach((l) => allLeadMap.set(l.id, l));
      const allLeadsList = Array.from(allLeadMap.values());

      let baseLeads = options.scope === "current" ? filtered : allLeadsList;

      // The list only holds the index projection, so the card-only columns are
      // not in memory. Export is an explicit, infrequent action, so re-read the
      // full rows for exactly the leads being exported rather than paying for
      // them on every list load. Batched to stay clear of the 1000-row cap.
      if (baseLeads.length > 0) {
        const full = new Map<string, Lead>();
        const CHUNK = 500;
        for (let i = 0; i < baseLeads.length; i += CHUNK) {
          const chunkIds = baseLeads.slice(i, i + CHUNK).map((l) => l.id);
          const { data, error } = await supabase
            .from("leads")
            .select(LEAD_LIST_COLUMNS)
            .in("id", chunkIds);
          if (error) throw error;
          for (const row of (data ?? []) as unknown as Lead[]) {
            if (row?.id) full.set(row.id, row);
          }
        }
        baseLeads = baseLeads.map((l) => full.get(l.id) ?? l);
      }

      // Apply Status Filter (from the export dialog). Lets the user export a
      // specific status section even from the "Entire Database" scope.
      if (options.status && options.status !== "all") {
        baseLeads = baseLeads.filter((lead) => lead?.status === options.status);
      }

      // Apply Date Filter
      if (options.dateRangePreset !== "all_time") {
        const now = new Date();
        let startDate: Date | undefined;
        let endDate: Date | undefined = new Date();

        if (options.dateRangePreset === "custom") {
          if (options.customDateRange?.from) {
            startDate = new Date(options.customDateRange.from);
            startDate.setHours(0, 0, 0, 0);
            endDate = options.customDateRange.to
              ? new Date(options.customDateRange.to)
              : new Date(options.customDateRange.from);
            endDate.setHours(23, 59, 59, 999);
          }
        } else if (options.dateRangePreset === "today") {
          startDate = new Date(now.setHours(0, 0, 0, 0));
        } else if (options.dateRangePreset === "yesterday") {
          startDate = new Date(now.setHours(0, 0, 0, 0));
          startDate.setDate(startDate.getDate() - 1);
          endDate = new Date(startDate);
          endDate.setHours(23, 59, 59, 999);
        } else if (options.dateRangePreset === "7d") {
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (options.dateRangePreset === "30d") {
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        if (startDate && endDate) {
          baseLeads = baseLeads.filter((lead) => {
            if (!lead || !lead.created_at) return false;
            const created = new Date(lead.created_at).getTime();
            return created >= startDate!.getTime() && created <= endDate!.getTime();
          });
        }
      }

      // Apply Limit
      let finalLeads = baseLeads;
      if (options.limit !== "all") {
        finalLeads = finalLeads.slice(0, options.limit);
      }

      const leadIdsToExport = finalLeads.map((l) => l.id);

      if (leadIdsToExport.length === 0) {
        toast.error("No leads match the selected criteria for export.");
        setIsExporting(false);
        return;
      }

      const noteSummaryByLead: Record<string, { general: string; cs: string; processor: string }> = {};
        const historyByLead: Record<string, string> = {};
        let noteRows: LeadNoteExportRow[] = [];
        let historyRows: { target_id: string; user_name: string | null; action: string; created_at: string; details: string | { status_to?: unknown } | null }[] = [];
        const chunkSize = 100;
  
        for (let i = 0; i < leadIdsToExport.length; i += chunkSize) {
          const chunk = leadIdsToExport.slice(i, i + chunkSize);
          const [notesRes, logsRes] = await Promise.all([
            supabase
              .from("lead_notes")
              .select("lead_id, note_type, content, user_id, user_name, created_at")
              .in("lead_id", chunk)
              .order("created_at", { ascending: true }),
            supabase
              .from("activity_logs")
              .select("target_id, user_name, action, created_at, details")
              .eq("target_type", "lead")
              .in("target_id", chunk)
              .order("created_at", { ascending: true })
          ]);
  
          if (notesRes.error) {
            toast.error(`Failed to prepare note export: ${notesRes.error.message}`);
            setIsExporting(false);
            return;
          }
          if (notesRes.data) {
            noteRows = noteRows.concat(notesRes.data as LeadNoteExportRow[]);
          }
          if (logsRes.data) {
            historyRows = historyRows.concat(logsRes.data as typeof historyRows);
          }
        }
  
        (noteRows as LeadNoteExportRow[] | null)?.forEach((note) => {
          const key = note.note_type;
          if (!noteSummaryByLead[note.lead_id]) {
            noteSummaryByLead[note.lead_id] = { general: "", cs: "", processor: "" };
          }
          noteSummaryByLead[note.lead_id][key as keyof typeof noteSummaryByLead[string]] += `[${new Date(note.created_at || "").toLocaleString()}] ${note.user_name || "Unknown"}: ${note.content}\n\n`;
        });

        historyRows.forEach((log) => {
          if (!historyByLead[log.target_id]) {
            historyByLead[log.target_id] = "";
          }
          
          let actionText = log.action;
          if (log.action === "status_changed" || log.action === "status_change") {
            let parsed = null;
            if (typeof log.details === "string") {
              try { parsed = JSON.parse(log.details); } catch(e) { /* Keep the original action text when details are not valid JSON. */ }
            } else {
              parsed = log.details;
            }
            if (parsed && parsed.status_to) {
              actionText = `changed status to ${parsed.status_to}`;
            }
          } else if (log.action === "created") {
            actionText = "created the lead";
          }
          
          historyByLead[log.target_id] += `[${new Date(log.created_at || "").toLocaleString()}] ${log.user_name || "Unknown"} ${actionText}\n`;
        });

      const exportRows = leadIdsToExport.map((id) => {
        const lead = allLeadMap.get(id);
        return {
          "Job ID": lead?.job_id,
          "Reference Name": lead?.reference_name,
          Status: lead?.status,
          "Customer Name": lead?.customer_name,
          "Customer Phone": lead?.customer_phone,
            "Customer Landline": lead?.customer_landline || "",
            "Customer Address": lead?.address,
            "Date Created": lead?.created_at ? new Date(lead.created_at).toLocaleString() : "",
            "Direction": lead?.direction || "",
            "Number Name": lead?.number_name || "",
            "Source URL": lead?.source_url || "",
            "Cancellation Reason": lead?.cancellation_reason || "",
            "Total Amount": lead?.amount || "",
            "Labor Amount": lead?.labor_amount || "",
            "Material Amount": lead?.material_amount || "",
            "For You Amount": lead?.for_you_amount || "",
            "For Us Amount": lead?.for_us_amount || "",
            "Scheduled Date": lead?.scheduled_date || "",
            "Last Edited At": lead?.last_edited_at ? new Date(lead.last_edited_at).toLocaleString() : "",
            "System ID": lead?.id || "",
            "Customer Email": lead?.customer_email || "",
            "City": lead?.city || "",
            "State": lead?.state || "",
            "Zip Code": lead?.zip_code || "",
            "Half Address": lead?.half_address || "",
            "Scheduled Time Start": lead?.scheduled_time_start || "",
            "Scheduled Time End": lead?.scheduled_time_end || "",
            "Expected Completion Date": lead?.expected_completion_date || "",
            "Booked At": lead?.booked_at ? new Date(lead.booked_at).toLocaleString() : "",
            "Urgent At": lead?.urgent_at ? new Date(lead.urgent_at).toLocaleString() : "",
            "Updated At": lead?.updated_at ? new Date(lead.updated_at).toLocaleString() : "",
            "Last Edited By": lead?.last_edited_by_name || lead?.editor_name || lead?.last_edited_by || "",
            "Assigned CS": lead?.assigned_cs || "",
            "Quote Requested By": lead?.quote_requested_by || "",
            "Payment Amount": lead?.payment_amount || "",
            "Payment Screenshot URL": lead?.payment_screenshot_url || "",
            "Show Quote To OPR": lead?.show_quote_to_opr ? "Yes" : "No",

          "Created By": lead?.created_by_name || (lead?.created_by ? profiles[lead.created_by] : "") || "",
          "Schedule Requirement": lead?.customer_schedule_requirements,
          "Assigned Technician": lead?.tech_name || "",
          "Technician Number": lead?.tech_number || "",
          Tag: lead?.cs_tag || "",
          Service: lead?.service_type || "",
          "Service Details": lead?.service_details || "",
          Quote: lead?.quote || "",
          Terms: lead?.terms === "free_estimate" ? "Free Estimate" : lead?.terms === "quoted" ? "Quote" : "",
          "General Notes": noteSummaryByLead[id]?.general || "",
          "CS Notes": noteSummaryByLead[id]?.cs || "",
          "Processor Notes": noteSummaryByLead[id]?.processor || "",
            "History": historyByLead[id] || "",
        };
      });

      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Leads");

      const filename = `leads_${new Date().toISOString().slice(0, 10)}`;
      XLSX.writeFile(wb, `${filename}.${options.format}`, options.format === "csv" ? { bookType: "csv" } : undefined);

      toast.success(`Exported ${exportRows.length} leads successfully`);
      setShowExportDialog(false);
    } catch (err) {
      toast.error(`Export failed: ${(err as { message?: string }).message}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Drops a deleted lead from the list at once, so the card goes when the toast appears rather
  // than when the refetch lands.
  const handleLeadDeleted = useCallback((leadId: string) => {
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    setSharedLeads((prev) => prev.filter((l) => l.id !== leadId));
  }, []);

  const handleRefresh = useCallback(async () => {
    await fetchLeads();
    if (role === "customer_service") {
      await fetchSharedLeads();
    }
  }, [fetchLeads, fetchSharedLeads, role]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: premiumEase }}
        className="glass-panel-strong relative overflow-visible rounded-[26px] px-4 py-3 shadow-[0_38px_82px_-42px_rgba(59,130,246,0.28),0_18px_32px_-24px_rgba(125,211,252,0.18)] sm:px-5 sm:py-3.5 dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_28%),radial-gradient(circle_at_top_right,hsl(198_100%_62%/0.10),transparent_24%),linear-gradient(180deg,hsl(var(--card)/0.84),hsl(var(--muted)/0.30))] dark:shadow-none"
      >
        <div className="pointer-events-none absolute inset-0 rounded-[32px] overflow-hidden bg-[radial-gradient(circle_at_top_left,hsl(194_100%_86%/0.22),transparent_30%),radial-gradient(circle_at_top_right,hsl(211_100%_88%/0.24),transparent_30%),radial-gradient(circle_at_bottom_left,hsl(188_100%_90%/0.16),transparent_26%)]" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <motion.div variants={heroTitle} initial="initial" animate="animate">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-[-0.04em] text-foreground">
            {attentionView ? (
              <span className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_10px_#f43f5e]" />
                </span>
                Need Attention
              </span>
            ) : safeStatusFilter !== "all" ? (
              <span className="flex items-center gap-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT_COLORS[safeStatusFilter as LeadStatus]}`} />
                {STATUS_LABELS[safeStatusFilter as LeadStatus]}
              </span>
            ) : activeTab === "shared" ? (
              "Shared Leads"
            ) : (
              "All Leads"
            )}
          </h1>
            <p className="whitespace-nowrap text-[12px] text-muted-foreground/90 tabular-nums">
              {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
              {totalPages > 1 && ` · Page ${page + 1} of ${totalPages}`}
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, duration: 0.35 }}
          className="flex items-center gap-2 flex-wrap sm:justify-end"
        >
          {canCreateLead ? (
            <Button onClick={() => setShowAddDialog(true)} size="sm" className="gap-1.5 h-9 order-first">
              <Plus className="h-4 w-4" />
              New Lead
            </Button>
          ) : canAddViaExtension ? (
            <Button onClick={() => setShowInstallDialog(true)} size="sm" className="gap-1.5 h-9 order-first">
              <Puzzle className="h-4 w-4" />
              Add Lead via Extension
            </Button>
          ) : null}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-[12px] h-9 border-border/60 hover:bg-muted/30"
              onClick={() => setShowExportDialog(true)}
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          )}

          {canCreateLead && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInstallDialog(true)}
              className="gap-1.5 text-[12px] h-9 border-border/60 hover:bg-muted/30"
            >
              <Puzzle className="h-3.5 w-3.5" />
              Extension
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleNotepad()}
            className={`gap-1.5 text-[12px] h-9 border-border/60 ${
              isAnyNotepadOpen ? "bg-primary/10 border-primary/30 text-primary" : "hover:bg-muted/30"
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Notepad
          </Button>

          {(isAdmin || isCS) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowReportDialog(true)}
              className="gap-1.5 text-[12px] h-9 border-border/60 hover:bg-muted/30"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Report
            </Button>
          )}

          <ScheduleDateFilter
            date={scheduleDateRange}
            setDate={(range) => {
              setScheduleDateRange(range);
              setPage(0);
            }}
            leads={leads}
          />

<AddLeadDialog
              open={showAddDialog}
              onOpenChange={setShowAddDialog}
              onSuccess={() => {
                fetchLeads();
                if (role === "customer_service") {
                  fetchSharedLeads();
                }
              }}
              onUrgentCheckCreated={setUrgentCheckFor}
            />

            <UrgentAICheckDialog
              open={!!urgentCheckFor && showsUrgentCheck(role)}
              onOpenChange={(next) => { if (!next) setUrgentCheckFor(null); }}
              leadId={urgentCheckFor?.leadId ?? ""}
            onProceed={() => {
                fetchLeads();
                if (role === "customer_service") {
                  fetchSharedLeads();
                }
              }}
            />

          <LeadReportDialog
            open={showReportDialog}
            onOpenChange={setShowReportDialog}
          />
        <ExportLeadsDialog
          open={showExportDialog}
          onOpenChange={setShowExportDialog}
          onExport={handleExportData}
          isExporting={isExporting}
          totalFiltered={filtered.length}
          currentStatus={safeStatusFilter}
          statusOptions={statusExportOptions}
        />

          <InstallExtensionDialog
            open={showInstallDialog}
            onOpenChange={setShowInstallDialog}
          />
        </motion.div>
        </div>
      </motion.section>

      {/* Urgent leads overview and CX Needs Reply panels side-by-side */}
      <div className="flex flex-col 2xl:flex-row gap-4 w-full">
        
        {["admin", "cs_admin", "customer_service"].includes(role || "") && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-panel overflow-hidden rounded-[26px] shadow-[0_28px_54px_-34px_rgba(59,130,246,0.22)] dark:bg-[linear-gradient(180deg,hsl(var(--card)/0.86),hsl(var(--muted)/0.28))] dark:shadow-none w-full 2xl:w-[35%] shrink-0"
          >
            <div className="flex items-center justify-between gap-8 border-b border-border/50 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500 status-pulse" />
                <h3 className="text-sm font-semibold text-foreground">Cx Awaiting Response</h3>
                <span className="rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-600 dark:text-amber-500">
                  {urgentNeedsCxReply.length}
                </span>
              </div>
            </div>

            {urgentNeedsCxReply.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 gap-1">
                <span className="text-xs font-medium text-muted-foreground">All caught up!</span>
                <span className="text-[10px] text-muted-foreground/60">No leads waiting for a response</span>
              </div>
            ) : (
              <div className="max-h-[240px] overflow-auto">
                <table className="w-full table-fixed border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                    <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-1.5 font-semibold w-[25%]">Customer name</th>
                      <th className="px-2 py-1.5 font-semibold w-[30%]">Service</th>
                      <th className="px-2 py-1.5 font-semibold w-[45%]">Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {urgentNeedsCxReply.map((l) => (
                      <tr
                        key={l.id}
                        onClick={(event) => openLeadFromClick(event, l.id, navigate)}
                        className="cursor-pointer border-t border-border/40 transition-colors hover:bg-muted/40"
                        title="Open lead"
                      >
                        <CopyableCell text={l.customer_name || "—"} defaultWidth={false} className="font-medium text-foreground" />
                        <CopyableCell text={l.service_type || "—"} defaultWidth={false} className="text-muted-foreground" />
                        <CopyableCell text={l.address || "—"} defaultWidth={false} className="text-muted-foreground" />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-panel overflow-hidden rounded-[26px] shadow-[0_28px_54px_-34px_rgba(59,130,246,0.22)] dark:bg-[linear-gradient(180deg,hsl(var(--card)/0.86),hsl(var(--muted)/0.28))] dark:shadow-none w-full 2xl:w-[63%] flex-1 min-w-0"
        >
        <div className="flex items-center justify-between gap-8 border-b border-border/50 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-destructive status-pulse" />
            <h3 className="text-sm font-semibold text-foreground">Urgent leads</h3>
            <span className="rounded-full bg-destructive/12 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-destructive">
              {urgentTableLeads.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {aiStatusLastChecked && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline" title={aiStatusLastChecked.toLocaleString()}>
                Updated {formatDistanceToNow(aiStatusLastChecked, { addSuffix: true })}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={async () => {
              toast.info("Checking AI statuses in the background...");
              const { data, error } = await supabase.functions.invoke("refresh-urgent-statuses");
              if (error) {
                // supabase-js hides the function's JSON body in error.context (a Response);
                // read it so the cooldown/busy message reaches the user instead of a generic error.
                let message = error.message || "Failed to trigger AI refresh";
                const body = await (error as { context?: Response }).context?.json()?.catch(() => null);
                if (body?.error) message = body.error as string;
                toast.error(message);
                return;
              }
              const refreshed = (data as { refreshed?: number } | null)?.refreshed;
              toast.success(
                typeof refreshed === "number"
                  ? `AI statuses refreshed — ${refreshed} updated.`
                  : "AI statuses refreshed.",
              );
              await refreshUrgentTable();
            }} className="h-7 text-[11px] gap-1.5 border-border/60">
               <RefreshCw className="h-3 w-3" />
               Refresh AI Status
            </Button>
            <div className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
              <span>Active <b className="tabular-nums text-foreground">{activeCount}</b></span>
              <span>Scheduled <b className="tabular-nums text-foreground">{scheduledCount}</b></span>
            </div>
          </div>
        </div>

        {urgentTableLeads.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">No urgent leads right now.</div>
        ) : (
          <div className="max-h-[240px] overflow-auto">
            <table className="w-full table-fixed border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5 font-semibold w-[14%]">Customer</th>
                  <th className="px-2 py-1.5 font-semibold w-[16%]">Service</th>
                  <th className="px-2 py-1.5 font-semibold w-[14%]">AI Status</th>
                  <th className="px-2 py-1.5 font-semibold w-[16%]">Area</th>
                  <th className="px-2 py-1.5 font-semibold w-[18%]">Schedule</th>
                  <th className="px-2 py-1.5 font-semibold w-[10%]">Terms</th>
                  <th className="px-2 py-1.5 font-semibold text-right w-[12%]">Date</th>
                </tr>
              </thead>
              <tbody>
                {urgentTableLeads.map((l) => {
                  const c = l.city || extractCity(l.address);
                  const s = l.state || extractState(l.address);
                  const areaText = [c, s].filter((x) => x && x !== "Unknown").join(", ") || "—";
                  
                  const nearby = urgentTableNearbyMap.get(l.id);
                  const nearbyCount = nearby?.length || 0;
                  const dateStr = l.created_at ? new Date(l.created_at).toLocaleDateString() : "—";

                  return (
                    <tr
                      key={l.id}
                      onClick={(event) => openLeadFromClick(event, l.id, navigate)}
                      className="cursor-pointer border-t border-border/40 transition-colors hover:bg-muted/40"
                      title="Open lead"
                    >
                      <CopyableCell text={l.customer_name || "—"} defaultWidth={false} className="font-medium text-foreground" />
                      <CopyableCell text={l.service_type || "—"} defaultWidth={false} className="text-muted-foreground" />
                      <td className="px-2 py-2 text-[11px] font-medium whitespace-nowrap">
                        {l.lead_ai_statuses?.status ? (
                          <span className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-sky-700 dark:text-sky-400">
                            {l.lead_ai_statuses.status}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <CopyableCell text={areaText} defaultWidth={false} className="text-muted-foreground" />
                      
                      <CopyableCell 
                          text={formatSchedule(l.customer_schedule_requirements)} 
                          defaultWidth={false} 
                          className={isTodayOrTomorrow(l.customer_schedule_requirements) ? "text-red-500 font-bold animate-pulse" : "text-muted-foreground"} 
                          truncate={false} 
                        />
                      <td className="whitespace-nowrap px-2 py-2 text-foreground">
                        {l.terms === "free_estimate" ? "Free Estimate" : l.terms === "quoted" ? "Quoted" : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right text-muted-foreground">
                        {dateStr}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
      </div>

      {isCS && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-panel inline-flex gap-1 rounded-[22px] p-1.5 dark:bg-[linear-gradient(180deg,hsl(var(--card)/0.84),hsl(var(--muted)/0.28))]"
          role="tablist"
          aria-label="Lead ownership"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "my"}
            onClick={() => {
              setActiveTab("my");
              setPage(0);
            }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
              activeTab === "my"
                ? "crm-lead-card-inner text-foreground shadow-[0_12px_24px_-18px_rgba(59,130,246,0.2)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            My Leads
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "shared"}
            onClick={() => {
              setActiveTab("shared");
              setPage(0);
            }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-1.5 ${
              activeTab === "shared"
                ? "crm-lead-card-inner text-foreground shadow-[0_12px_24px_-18px_rgba(59,130,246,0.2)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Share2 className="h-3.5 w-3.5" />
            Shared with me
            {visibleSharedLeads.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                {visibleSharedLeads.length}
              </span>
            )}
          </button>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass-panel-strong rounded-[22px] p-2.5 shadow-[0_34px_74px_-40px_rgba(59,130,246,0.24)] dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_24%),linear-gradient(180deg,hsl(var(--card)/0.84),hsl(var(--muted)/0.30))] dark:shadow-none"
      >
        <div className="crm-lead-card-soft flex flex-col gap-3 rounded-[26px] p-3.5 shadow-[0_20px_34px_-26px_rgba(59,130,246,0.18)] lg:flex-row lg:items-center dark:shadow-none">
          <div className="relative flex-1 group">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/40 transition-colors group-focus-within:text-primary" />
            <Input
              placeholder="Search by name, phone, address, job ID..."
              className="crm-lead-card-inner h-11 rounded-[18px] border-border/70 bg-transparent pl-10 pr-10 shadow-[0_22px_32px_-24px_rgba(59,130,246,0.18)]"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setPage(0);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground/55 transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Clear lead search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Select value={safeStatusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="crm-lead-card-inner h-11 w-full rounded-[18px] border-border/70 bg-transparent shadow-[0_18px_28px_-22px_rgba(56,189,248,0.2)] sm:w-[220px]">
                <SlidersHorizontal className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {ALL_LEAD_STATUSES.filter((s) => allowedStatuses.has(s) || (isOperatorRole(role) && leads.some((l) => Boolean(l.cs_tag) && l.status === s))).map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_COLORS[s]}`} />
                      {STATUS_LABELS[s]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
            >
              <SelectTrigger className="crm-lead-card-inner h-11 w-full rounded-[18px] border-border/70 bg-transparent shadow-[0_18px_28px_-22px_rgba(56,189,248,0.2)] sm:w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    Show {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center rounded-2xl border border-border/70 bg-transparent p-1 shadow-[0_18px_28px_-22px_rgba(56,189,248,0.2)] crm-lead-card-inner h-11">
              <Button
                variant="ghost"
                size="sm"
                className={`h-full rounded-xl px-3 ${viewMode === "grid" ? "bg-background shadow-sm" : "hover:bg-muted/50"}`}
                onClick={() => setViewMode("grid")}
                aria-label="Use lead card view"
                aria-pressed={viewMode === "grid"}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-full rounded-xl px-3 ${viewMode === "table" ? "bg-background shadow-sm" : "hover:bg-muted/50"}`}
                onClick={() => setViewMode("table")}
                aria-label="Use lead table view"
                aria-pressed={viewMode === "table"}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>

            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                className="h-11 rounded-[18px] px-4 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setScheduleDateRange(undefined);
                }}
              >
                <X className="mr-1.5 h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {loading || (paged.length > 0 && !pageRowsReady) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-56 rounded-xl skeleton-shimmer border border-border/30" />
          ))}
        </div>
      ) : paged.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35 }}
        >
          <Card className="crm-lead-card flex min-h-[260px] flex-col items-center justify-center gap-3 border-dashed border-2 px-6 text-center shadow-[0_34px_74px_-40px_rgba(59,130,246,0.22)] dark:shadow-none">
            <div className="crm-lead-card-inner flex h-14 w-14 items-center justify-center rounded-2xl">
              <Search className="h-5 w-5 text-muted-foreground/30" />
            </div>
            <p className="font-medium text-foreground text-base">
              {activeTab === "shared" ? "No leads have been shared with you yet" : "No leads found"}
            </p>
            <p className="max-w-sm text-[13px] text-muted-foreground">
              {search || safeStatusFilter !== "all" || scheduleDateRange?.from
                ? "Try adjusting your search or filter"
                : 'Click "New Lead" to get started'}
            </p>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="outline"
                className="mt-1 rounded-xl"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setScheduleDateRange(undefined);
                }}
              >
                Reset Filters
              </Button>
            )}
          </Card>
        </motion.div>
      ) : viewMode === "table" ? (
        <LeadTable leads={renderRows} />
      ) : (
        <motion.div
          variants={cardGridContainer}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {renderRows.map((lead) => {
            const metadata = usingMetadataFallback ? undefined : pagedMetadata[lead.id];
            return (
            <motion.div key={lead.id} variants={cardGridItem}>
              <LeadCard
                lead={lead}
                profiles={profiles}
                onRefresh={handleRefresh}
                onDeleted={handleLeadDeleted}
                nearbyUrgentLeads={nearbyUrgentMap.get(lead.id)}
                initialHasNotes={metadata?.hasNotes}
                initialTechCount={metadata?.techCount}
                initialCancellationReason={metadata?.cancellationReason}
                initialPhotoCount={metadata?.photoCount}
                initialPhotoPaths={metadata?.photoPaths}
                initialPendingCancellationRequest={metadata?.pendingCancellationRequest}
                pendingQuoteApproval={metadata?.pendingQuoteApproval}
              />
            </motion.div>
            );
          })}
        </motion.div>
      )}

      {totalPages > 1 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center justify-center gap-1.5 pt-2"
        >
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>

          <div className="flex gap-1">
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
                  className="w-9"
                  onClick={() => setPage(p)}
                >
                  {p + 1}
                </Button>
              );
            })}
          </div>

          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </motion.div>
      )}
    </div>
  );
}





