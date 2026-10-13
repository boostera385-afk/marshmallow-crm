import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import * as XLSX from "xlsx";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TechnicianDialog, TechnicianRecord } from "@/components/technicians/TechnicianDialog";
import { ImportTechniciansDialog } from "@/components/technicians/ImportTechniciansDialog";
import { TechnicianReport } from "@/components/technicians/TechnicianReport";
import { TechnicianPerformance } from "@/components/technicians/TechnicianPerformance";
import { TechnicianProcessingWorkflow } from "@/components/technicians/TechnicianProcessingWorkflow";
import { GoodTechFlagCell, ActiveFlagCell } from "@/components/technicians/TechnicianFlagCells";
import { TechnicianNameBadges } from "@/components/technicians/TechnicianNameCell";
import { buildTechnicianNameCounts } from "@/lib/technician-names";
import { toast } from "@/hooks/use-toast";
import {
  fetchAllTechnicians,
  fetchTechniciansPage,
  TECHNICIANS_ROOT_KEY,
  TechnicianSortOption,
  type TechnicianVisibility,
} from "@/lib/technicians";
import { canAddTechnicians, canDeleteTechnicians, canImportTechnicians, technicianVisibility } from "@/lib/access";
import { toTelHref } from "@/lib/phone";
import {
  Contact,
  Plus,
  Upload,
  Download,
  Search,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  Copy,
  X,
  Filter,
  ArrowUp,
  ArrowDown,
  Star,
  BarChart,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [100, 200, 500, 1000] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSizeOption = 100;
const PAGE_SIZE_STORAGE_KEY = "marshmallow.technicians.pageSize";

function loadInitialPageSize(): PageSizeOption {
  try {
    const raw = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    if (PAGE_SIZE_OPTIONS.includes(n as PageSizeOption)) return n as PageSizeOption;
  } catch {
    // ignore storage errors
  }
  return DEFAULT_PAGE_SIZE;
}

function buildPageWindow(current: number, total: number): Array<number | "ellipsis-left" | "ellipsis-right"> {
  if (total <= 1) return total === 1 ? [1] : [];
  const pages = new Set<number>([1, total, current]);
  for (let i = 1; i <= 2; i++) {
    if (current - i >= 1) pages.add(current - i);
    if (current + i <= total) pages.add(current + i);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const out: Array<number | "ellipsis-left" | "ellipsis-right"> = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (i > 0 && p - sorted[i - 1] > 1) {
      out.push(p < current ? "ellipsis-left" : "ellipsis-right");
    }
    out.push(p);
  }
  return out;
}

const COPY_COLUMNS = ["Tech (Name)", "Number", "Service", "Area", "Chat Link", "Good Tech", "Notes", "OPR Code"] as const;

/** Format a technician's created_at as a plain date for tables and exports. */
function formatAddedDate(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Strip tabs/newlines from a single clipboard cell so one row stays on one TSV line. */
function sanitizeClipboardCell(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value).replace(/[\t\r\n]+/g, " ").trim();
}

function technicianToClipboardCells(t: TechnicianRecord): string[] {
  return [
    sanitizeClipboardCell(t.name),
    sanitizeClipboardCell(t.phone_number),
    sanitizeClipboardCell(t.service),
    sanitizeClipboardCell(t.area),
    sanitizeClipboardCell(t.chat_link),
    t.is_good_tech ? "Yes" : "No",
    sanitizeClipboardCell(t.notes),
    sanitizeClipboardCell(t.opr_code),
  ];
}

function buildTechniciansTsv(techs: TechnicianRecord[]): string {
  const header = COPY_COLUMNS.join("\t");
  const body = techs.map((t) => technicianToClipboardCells(t).join("\t"));
  return [header, ...body].join("\n");
}

function buildSingleTechnicianText(t: TechnicianRecord): string {
  const pairs: Array<[string, string | null | undefined]> = [
    ["Name", t.name],
    ["OPR Code", t.opr_code],
    ["Phone Number", t.phone_number],
    ["Service", t.service],
    ["Area", t.area],
    ["Quo Chat Link", t.chat_link],
    ["Notes", t.notes],
    ["Added Date", formatAddedDate(t.created_at)],
  ];
  return pairs
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${String(v).replace(/\r?\n/g, " ").trim()}`)
    .join("\n");
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function sortTechnicians(list: TechnicianRecord[]): TechnicianRecord[] {
  return [...list].sort((a, b) => {
    const nameCmp = (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
    if (nameCmp !== 0) return nameCmp;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
}

// Google-Sheets-style column control that lives on the header cell itself: a
// funnel button that opens a small popover with sort (A–Z / Z–A) and a text
// filter for that column. The funnel highlights when either is active.
function HeaderColumnFilter({
  label,
  value,
  onChange,
  sortKey,
  sortBy,
  onSort,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  sortKey: "name" | "code" | "service" | "area";
  sortBy: TechnicianSortOption;
  onSort: (next: TechnicianSortOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const filterActive = value.trim().length > 0;
  const ascOption = `${sortKey}_asc` as TechnicianSortOption;
  const descOption = `${sortKey}_desc` as TechnicianSortOption;
  const sortActive = sortBy === ascOption || sortBy === descOption;
  const active = filterActive || sortActive;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Sort or filter by ${label}`}
          className={`ml-1 inline-flex h-5 w-5 items-center justify-center rounded transition-colors ${
            active ? "bg-primary/15 text-primary" : "text-muted-foreground/50 hover:text-foreground hover:bg-muted"
          }`}
        >
          <Filter className={`h-3 w-3 ${active ? "fill-current" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Sort {label}
        </div>
        <div className="mb-2 flex gap-1">
          <Button
            variant={sortBy === ascOption ? "default" : "outline"}
            size="sm"
            className="h-7 flex-1 px-1 text-[11px]"
            onClick={() => onSort(ascOption)}
          >
            <ArrowUp className="mr-0.5 h-3 w-3" /> A–Z
          </Button>
          <Button
            variant={sortBy === descOption ? "default" : "outline"}
            size="sm"
            className="h-7 flex-1 px-1 text-[11px]"
            onClick={() => onSort(descOption)}
          >
            <ArrowDown className="mr-0.5 h-3 w-3" /> Z–A
          </Button>
        </div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Filter {label}
        </div>
        <Input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Contains…`}
          className="h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") setOpen(false);
          }}
        />
        <div className="mt-1.5 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            disabled={!filterActive}
            onClick={() => onChange("")}
          >
            <X className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function TechniciansPage() {
  const qc = useQueryClient();
  const { role, profile } = useAuth();
  const isAdmin = role === "admin";
  const canDelete = canDeleteTechnicians(role);
  const canReport = isAdmin || profile?.can_view_tech_report === true;
  // The performance view is backed by tech_paid_performance, which aggregates
  // every lead in the database and is admin-only at the database level, so the
  // tab is not offered to anyone else - including the per-user tech report grant.
  const canPerformance = isAdmin;
  const [searchParams, setSearchParams] = useSearchParams();
  const copilotIdRaw = searchParams.get("copilot");
  const copilotTechnicianId = copilotIdRaw && /^[0-9a-f-]{36}$/i.test(copilotIdRaw) ? copilotIdRaw : undefined;
  const [activeView, setActiveView] = useState<"directory" | "report" | "performance" | "workflow">("directory");
  const canWorkflow = role === "admin" || role === "processor";
  const workflowTechnicianIds = useMemo(
    () => (searchParams.get("workflow") ?? "").split(",").filter(Boolean).slice(0, 8),
    [searchParams],
  );
  const workflowTechniciansQuery = useQuery({
    queryKey: [...TECHNICIANS_ROOT_KEY, "processing-workflow"],
    queryFn: fetchAllTechnicians,
    enabled: canWorkflow && activeView === "workflow",
    staleTime: 60_000,
  });
  // Name-based job counts and Good Tech edits merge technicians who share a
  // name, so the directory flags those rows rather than presenting a combined
  // count as if it belonged to one person.
  const nameCountsQuery = useQuery({
    queryKey: [...TECHNICIANS_ROOT_KEY, "all"],
    queryFn: fetchAllTechnicians,
    enabled: activeView === "directory",
    staleTime: 60_000,
  });
  const nameCounts = useMemo(() => buildTechnicianNameCounts(nameCountsQuery.data ?? []), [nameCountsQuery.data]);

  useEffect(() => {
    if (canWorkflow && (workflowTechnicianIds.length || searchParams.get("view") === "workflow")) setActiveView("workflow");
  }, [canWorkflow, workflowTechnicianIds, searchParams]);

  // Scope of technicians this user may see (opr → own, opr_admin → coded).
  const visibility = useMemo<TechnicianVisibility>(
    () => ({ mode: technicianVisibility(role), oprCode: profile?.opr_code ?? null }),
    [role, profile?.opr_code],
  );
  const visibilityKey = `${visibility.mode}:${visibility.oprCode ?? ""}`;

  const [addOpen, setAddOpen] = useState(false);
  const [editTech, setEditTech] = useState<TechnicianRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTech, setDeleteTech] = useState<TechnicianRecord | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [codeFilter, setCodeFilter] = useState<string>("all");
  // Per-column header filters (Name / Code / Service / Area).
  const [columnFilters, setColumnFilters] = useState({ name: "", code: "", service: "", area: "" });
  const [debouncedColumnFilters, setDebouncedColumnFilters] = useState(columnFilters);
  const [sortBy, setSortBy] = useState<TechnicianSortOption>("name_asc");
  const [pageSize, setPageSize] = useState<PageSizeOption>(() => loadInitialPageSize());
  const [currentPage, setCurrentPage] = useState(1);
  // Selected technicians persisted across pagination/search by id.
  const [selected, setSelected] = useState<Map<string, TechnicianRecord>>(() => new Map());
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  // Debounce search input
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  // Debounce the per-column filters together
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedColumnFilters(columnFilters), 300);
    return () => window.clearTimeout(t);
  }, [columnFilters]);

  const columnFiltersKey = `${debouncedColumnFilters.name}|${debouncedColumnFilters.code}|${debouncedColumnFilters.service}|${debouncedColumnFilters.area}`;
  const hasColumnFilters = Boolean(columnFiltersKey.replace(/\|/g, ""));

  // Reset to page 1 whenever search, page size, code filter, sort, or a column filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, pageSize, codeFilter, sortBy, columnFiltersKey, copilotTechnicianId]);

  // Persist page size
  useEffect(() => {
    try {
      localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
    } catch {
      // ignore
    }
  }, [pageSize]);

  // Total-only query for the page header (uses the shared full-list cache when available)
  const totalCountQuery = useQuery({
    queryKey: [...TECHNICIANS_ROOT_KEY, "count"] as const,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("technicians")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  // Summarize the OPR codes that own technicians (drives the OPR filter).
  const codesSummaryQuery = useQuery({
    queryKey: [...TECHNICIANS_ROOT_KEY, "opr-codes-summary", visibilityKey] as const,
    queryFn: async () => {
        try {
          const { data, error } = await supabase.rpc("get_opr_codes_summary");
          if (error || !data) return { codes: [], totalWithCode: 0 };
          
          let totalWithCode = 0;
          let codes = data.map(r => {
             const c = Number(r.count);
             totalWithCode += c;
             return { code: r.opr_code, count: c };
          });
          
          if (visibility.mode === "own") {
             codes = codes.filter(c => c.code === visibility.oprCode);
             totalWithCode = codes.reduce((sum, c) => sum + c.count, 0);
          }
          
          codes.sort((a, b) => a.code.localeCompare(b.code));
          return { codes, totalWithCode };
        } catch (err) {
          console.error(err);
          return { codes: [], totalWithCode: 0 };
        }
      },
    staleTime: 30_000,
  });

  const distinctCodes = codesSummaryQuery.data?.codes ?? [];
  const totalWithCode = codesSummaryQuery.data?.totalWithCode ?? 0;

  const paginatedQuery = useQuery({
    queryKey: [
      ...TECHNICIANS_ROOT_KEY,
      "paginated",
      { page: currentPage, pageSize, search: debouncedSearch, codeFilter, sortBy, columnFilters: columnFiltersKey, visibility: visibilityKey, copilotTechnicianId },
    ] as const,
    queryFn: () =>
      fetchTechniciansPage({
        page: currentPage,
        pageSize,
        search: debouncedSearch,
        technicianId: copilotTechnicianId,
        codeFilter,
        sortBy,
        columnFilters: debouncedColumnFilters,
        visibility,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const rows = paginatedQuery.data?.technicians ?? [];
  const filteredTotal = paginatedQuery.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const hasResults = filteredTotal > 0;

  // Clamp current page when total shrinks
  useEffect(() => {
    if (paginatedQuery.data && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [paginatedQuery.data, currentPage, totalPages]);

  // Scroll table container to top on page/pageSize/search change
  useEffect(() => {
    tableScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [currentPage, pageSize, debouncedSearch]);

  const startRecord = hasResults ? (currentPage - 1) * pageSize + 1 : 0;
  const endRecord = hasResults ? Math.min(currentPage * pageSize, filteredTotal) : 0;
  const headerTotal = totalCountQuery.data ?? 0;

  const invalidateAll = async () => {
    await qc.invalidateQueries({ queryKey: TECHNICIANS_ROOT_KEY });
  };

  /**
   * Keep the list live when someone else changes a technician.
   *
   * An approval is applied by an admin, usually in a different tab or a
   * different session from the person watching this list. Invalidating from the
   * page that performed the write only reaches that page, so a processor would
   * keep seeing the old Good Tech star until the query went stale. The event is
   * used only as a signal to refetch rather than to patch from, so nothing is
   * read out of the payload and the table policies still decide what the
   * refetch can see.
   */
  useEffect(() => {
    if (!role) return;

    const channel = supabase
      .channel("technicians-realtime-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "technicians" },
        () => {
          void qc.invalidateQueries({ queryKey: TECHNICIANS_ROOT_KEY });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [role, qc]);

  const handleSaved = async (saved: TechnicianRecord) => {
    // If a currently-selected technician was edited, refresh its cached snapshot
    // so the copied output uses the latest values.
    setSelected((prev) => {
      if (!prev.has(saved.id)) return prev;
      const next = new Map(prev);
      next.set(saved.id, saved);
      return next;
    });
    await invalidateAll();
  };
  // Keep the selection map in sync with the currently-visible page rows so
  // edits from other places (or refetches) are reflected in copy output.
  useEffect(() => {
    if (!rows.length) return;
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const r of rows) {
        if (next.has(r.id) && next.get(r.id) !== r) {
          next.set(r.id, r);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const handleConfirmDelete = async () => {
    if (!deleteTech || !canDelete) return;
    const { error } = await supabase.from("technicians").delete().eq("id", deleteTech.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Technician deleted" });
      // Remove the deleted technician from any active selection.
      setSelected((prev) => {
        if (!prev.has(deleteTech.id)) return prev;
        const next = new Map(prev);
        next.delete(deleteTech.id);
        return next;
      });
      // If we're on a page that just became empty, step back one.
      if (rows.length === 1 && currentPage > 1) setCurrentPage((p) => p - 1);
      await invalidateAll();
    }
    setDeleteTech(null);
  };

  const EXPORT_HEADERS = [
    "Technician ID",
    "Tech (Name)",
    "Number",
    "Service",
    "Area",
    "Chat Link",
    "Good Tech",
    "Notes",
    "OPR Code",
    "Status",
    "Added Date",
    "Last Updated",
    "Legacy Code",
    "Latitude",
    "Longitude",
    "Created By User ID",
  ];
  const toExportRow = (t: TechnicianRecord) => ({
    "Technician ID": t.id ?? "",
    "Tech (Name)": t.name ?? "",
    "Number": t.phone_number ?? "",
    "Service": t.service ?? "",
    "Area": t.area ?? "",
    "Chat Link": t.chat_link ?? "",
    "Good Tech": t.is_good_tech ? "Yes" : "No",
    "Notes": t.notes ?? "",
    "OPR Code": t.opr_code ?? "",
    "Status": t.is_active === false ? "Inactive" : "Active",
    "Added Date": formatAddedDate(t.created_at),
    "Last Updated": formatAddedDate(t.updated_at),
    "Legacy Code": t.code ?? "",
    "Latitude": t.latitude ?? "",
    "Longitude": t.longitude ?? "",
    "Created By User ID": t.created_by ?? "",
  });
  const [exporting, setExporting] = useState(false);

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const getExportRows = async () => {
    // Export the full dataset (respecting current search when active).
    setExporting(true);
    try {
      const all = await fetchAllTechnicians();
      const q = debouncedSearch.toLowerCase();
      const filtered = q
        ? all.filter((t) =>
            [t.name, t.service, t.area, t.notes, t.chat_link, t.phone_number]
              .some((v) => (v ?? "").toString().toLowerCase().includes(q)),
          )
        : all;
      return filtered.map(toExportRow);
    } finally {
      setExporting(false);
    }
  };

  const exportCsv = async () => {
    const data = await getExportRows();
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const csv = [
      EXPORT_HEADERS.join(","),
      ...data.map((r) => EXPORT_HEADERS.map((h) => esc((r as Record<string, string>)[h] ?? "")).join(",")),
    ].join("\n");
    download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `technicians-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const exportXlsx = async () => {
    const data = await getExportRows();
    const ws = XLSX.utils.json_to_sheet(data, { header: EXPORT_HEADERS });
    const phoneColIdx = EXPORT_HEADERS.indexOf("Phone Number");
    for (let i = 0; i < data.length; i++) {
      const addr = XLSX.utils.encode_cell({ r: i + 1, c: phoneColIdx });
      const cell = ws[addr];
      if (cell) { cell.t = "s"; cell.v = String(cell.v ?? ""); cell.z = "@"; }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Technicians");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    download(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `technicians-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  const isSearching = debouncedSearch.length > 0;
  const pageWindow = useMemo(() => buildPageWindow(currentPage, totalPages), [currentPage, totalPages]);
  const disablePrev = currentPage <= 1 || !hasResults;
  const disableNext = currentPage >= totalPages || !hasResults;

  // ---- Selection derivations ----
  const selectedCount = selected.size;
  const visibleSelectedCount = useMemo(
    () => rows.reduce((n, r) => n + (selected.has(r.id) ? 1 : 0), 0),
    [rows, selected],
  );
  const allVisibleSelected = rows.length > 0 && visibleSelectedCount === rows.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;
  const headerCheckboxState: boolean | "indeterminate" = allVisibleSelected
    ? true
    : someVisibleSelected
      ? "indeterminate"
      : false;

  const toggleRow = (t: TechnicianRecord, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) next.set(t.id, t);
      else next.delete(t.id);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) for (const r of rows) next.set(r.id, r);
      else for (const r of rows) next.delete(r.id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Map());

  const handleCopySelected = async () => {
    if (selected.size === 0) return;
    const sorted = sortTechnicians(Array.from(selected.values()));
    const text = buildTechniciansTsv(sorted);
    const ok = await copyTextToClipboard(text);
    if (ok) {
      toast({
        title: sorted.length === 1 ? "1 technician copied" : `${sorted.length} technicians copied`,
      });
    } else {
      toast({ title: "Unable to copy technician data", variant: "destructive" });
    }
  };

  const handleCopyOne = async (t: TechnicianRecord) => {
    const text = buildSingleTechnicianText(t);
    const ok = await copyTextToClipboard(text);
    if (ok) toast({ title: "Technician copied" });
    else toast({ title: "Unable to copy technician data", variant: "destructive" });
  };

  const handleBulkDelete = async () => {
    if (!canDelete || bulkDeleting) return;
    const ids = Array.from(selected.keys());
    if (ids.length === 0) return;
    setBulkDeleting(true);
    const BATCH = 200;
    const deletedIds: string[] = [];
    let firstError: string | null = null;
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const { error, data } = await supabase
          .from("technicians")
          .delete()
          .in("id", batch)
          .select("id");
        if (error) {
          firstError = error.message;
          break;
        }
        for (const row of data ?? []) deletedIds.push(row.id as string);
      }
    } catch (e) {
      firstError = e instanceof Error ? e.message : String(e);
    }

    // Remove successfully deleted from selection
    if (deletedIds.length > 0) {
      setSelected((prev) => {
        const next = new Map(prev);
        for (const id of deletedIds) next.delete(id);
        return next;
      });
    }

    await invalidateAll();
    setBulkDeleting(false);

    const total = ids.length;
    if (firstError && deletedIds.length === 0) {
      toast({
        title: "Unable to delete selected technicians",
        description: firstError,
        variant: "destructive",
      });
      return;
    }
    if (firstError && deletedIds.length > 0) {
      toast({
        title: `${deletedIds.length} technician${deletedIds.length === 1 ? "" : "s"} deleted, but ${
          total - deletedIds.length
        } could not be deleted`,
        description: firstError,
        variant: "destructive",
      });
      setBulkDeleteOpen(false);
      return;
    }
    setBulkDeleteOpen(false);
    toast({
      title: deletedIds.length === 1 ? "1 technician deleted" : `${deletedIds.length} technicians deleted`,
    });
  };



  return (
    <div className={`space-y-4 ${selectedCount > 0 ? "pb-28" : ""}`}>
      {copilotTechnicianId && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-primary/5 p-3 text-sm"><p>Showing the technician selected in Copilot. Existing access and editing rules apply.</p><Button variant="outline" size="sm" onClick={() => { const params = new URLSearchParams(searchParams); params.delete("copilot"); setSearchParams(params); }}>Show all accessible technicians</Button></div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Contact className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Technicians</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalCountQuery.isLoading ? "Loading…" : `${headerTotal.toLocaleString()} technicians`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={exporting}>
                  {exporting ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-1.5 h-4 w-4" />
                  )}
                  Export
                  <ChevronDown className="ml-1 h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportCsv}>Export as CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={exportXlsx}>Export as XLSX</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canImportTechnicians(role) && (
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-4 w-4" /> Import
            </Button>
          )}
          {canAddTechnicians(role) && (
            <Button size="sm" onClick={() => { setEditTech(null); setAddOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" /> Add Technician
            </Button>
          )}
        </div>
      </div>

      {(canReport || canPerformance || canWorkflow) && (
        <div className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setActiveView("directory")}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${activeView === "directory" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Directory
          </button>
          {canReport && (
            <button
              type="button"
              onClick={() => setActiveView("report")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${activeView === "report" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              OPR Report
            </button>
          )}
          {canPerformance && (
            <button
              type="button"
              onClick={() => setActiveView("performance")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${activeView === "performance" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Tech Report
            </button>
          )}
          {canWorkflow && (
            <button
              type="button"
              onClick={() => setActiveView("workflow")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${activeView === "workflow" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Processing Workflow
            </button>
          )}
        </div>
      )}

      {canReport && activeView === "report" && (
        <TechnicianReport isAdmin={isAdmin} />
      )}

      {canPerformance && activeView === "performance" && <TechnicianPerformance />}

      {canWorkflow && activeView === "workflow" && (
        <TechnicianProcessingWorkflow
          technicians={workflowTechniciansQuery.data ?? []}
          initialTechnicianIds={workflowTechnicianIds}
        />
      )}

      <div hidden={(canReport && activeView === "report") || (canPerformance && activeView === "performance") || (canWorkflow && activeView === "workflow")}>

      <Card className="border-border/60">
        <CardContent className="p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, service, area, notes"
                className="h-10 pl-8 text-sm sm:h-8 sm:text-xs"
              />
            </div>

            {/* Code Filter Dropdown */}
            <div className="flex items-center gap-1.5">
              <Select
                value={codeFilter}
                onValueChange={(val) => {
                  setCodeFilter(val);
                  setCurrentPage(1);
                }}
              >
              <SelectTrigger className="h-10 w-full text-sm sm:h-8 sm:w-[190px] sm:text-xs">
                  <SelectValue placeholder="Filter by OPR..." />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="all">All OPRs ({headerTotal})</SelectItem>
                  <SelectItem value="has_code">With OPR ({totalWithCode})</SelectItem>
                  <SelectItem value="none">Without OPR ({Math.max(0, headerTotal - totalWithCode)})</SelectItem>
                  {distinctCodes.length > 0 && (
                    <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border mt-1 pt-1.5">
                      Technicians per OPR ({distinctCodes.length})
                    </div>
                  )}
                  {distinctCodes.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      <span className="font-medium">{item.code}</span>
                      <span className="ml-1.5 text-muted-foreground text-[11px]">
                        ({item.count} tech{item.count === 1 ? "" : "s"})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {codeFilter !== "all" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setCodeFilter("all"); setCurrentPage(1); }}
                  className="h-10 px-3 text-sm text-muted-foreground hover:text-foreground sm:h-8 sm:px-2 sm:text-xs"
                  title="Clear code filter"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Sort selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground hidden sm:inline">Sort:</span>
            <Select
              value={sortBy}
              onValueChange={(val) => setSortBy(val as TechnicianSortOption)}
            >
              <SelectTrigger className="h-10 w-full text-sm sm:h-8 sm:w-[170px] sm:text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name_asc">Name (A → Z)</SelectItem>
                <SelectItem value="name_desc">Name (Z → A)</SelectItem>
                <SelectItem value="code_asc">Code (A → Z)</SelectItem>
                <SelectItem value="code_desc">Code (Z → A)</SelectItem>
                <SelectItem value="service_asc">Service (A → Z)</SelectItem>
                <SelectItem value="service_desc">Service (Z → A)</SelectItem>
                <SelectItem value="area_asc">Area (A → Z)</SelectItem>
                <SelectItem value="area_desc">Area (Z → A)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {selectedCount > 0 && (
              <div
                className="pointer-events-none fixed bottom-5 left-[var(--sidebar-width,16rem)] right-0 z-40 flex justify-center px-4 max-md:left-0 max-md:bottom-[calc(12px+env(safe-area-inset-bottom))]"
              >
                <motion.div
                  key="tech-selection-bar"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  role="region"
                  aria-label="Technician selection actions"
                  className="pointer-events-auto inline-flex w-fit max-w-full items-center justify-center gap-3 rounded-xl border border-border/60 bg-background px-4 py-3 shadow-xl max-sm:flex-wrap motion-reduce:transition-none"
                >
                  <span
                    className="text-xs font-medium text-foreground whitespace-nowrap"
                    aria-live="polite"
                  >
                    {selectedCount === 1
                      ? "1 technician selected"
                      : `${selectedCount.toLocaleString()} technicians selected`}
                  </span>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleCopySelected}
                    aria-label="Copy selected technicians"
                    title="Copy selected technicians to clipboard"
                  >
                    <Copy className="mr-1.5 h-4 w-4" />
                    Copy Selected Techs ({selectedCount.toLocaleString()})
                  </Button>
                  {canDelete && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setBulkDeleteOpen(true)}
                      aria-label="Delete selected technicians"
                      title="Delete selected technicians"
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Delete Selected ({selectedCount.toLocaleString()})
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearSelection}
                    aria-label="Clear technician selection"
                    title="Clear technician selection"
                  >
                    <X className="mr-1.5 h-4 w-4" />
                    Clear Selection
                  </Button>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}



      <Card className="border-border/60">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="whitespace-nowrap text-xs">
                <TableHead className="w-[36px] pl-4">
                  <Checkbox
                    checked={headerCheckboxState}
                    onCheckedChange={(v) => toggleAllVisible(v === true)}
                    disabled={rows.length === 0}
                    aria-label="Select all technicians on this page"
                  />
                </TableHead>
                <TableHead className="w-[160px]">
                  <span className="inline-flex items-center">
                    Tech
                    <HeaderColumnFilter
                      label="Tech"
                      value={columnFilters.name}
                      onChange={(v) => setColumnFilters((f) => ({ ...f, name: v }))}
                      sortKey="name"
                      sortBy={sortBy}
                      onSort={setSortBy}
                    />
                  </span>
                </TableHead>
                <TableHead className="w-[130px]">Number</TableHead>
                <TableHead className="w-[140px]">
                  <span className="inline-flex items-center">
                    Service
                    <HeaderColumnFilter
                      label="Service"
                      value={columnFilters.service}
                      onChange={(v) => setColumnFilters((f) => ({ ...f, service: v }))}
                      sortKey="service"
                      sortBy={sortBy}
                      onSort={setSortBy}
                    />
                  </span>
                </TableHead>
                <TableHead className="w-[160px]">
                  <span className="inline-flex items-center">
                    Area
                    <HeaderColumnFilter
                      label="Area"
                      value={columnFilters.area}
                      onChange={(v) => setColumnFilters((f) => ({ ...f, area: v }))}
                      sortKey="area"
                      sortBy={sortBy}
                      onSort={setSortBy}
                    />
                  </span>
                </TableHead>
                <TableHead className="w-[100px]">Chat Link</TableHead>
                <TableHead className="w-[100px] text-center">Good Tech</TableHead>
                <TableHead className="min-w-[150px]">Notes</TableHead>
                <TableHead className="w-[110px]">OPR Code</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[100px]">Added Date</TableHead>
                <TableHead className="w-[120px] text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedQuery.isPending && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-sm text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {paginatedQuery.isError && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-sm py-10">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-destructive">
                        {(paginatedQuery.error as Error)?.message ?? "Failed to load technicians."}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => paginatedQuery.refetch()}>
                        Retry
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!paginatedQuery.isPending && !paginatedQuery.isError && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-sm text-muted-foreground py-10">
                    {isSearching || codeFilter !== "all" || hasColumnFilters
                      ? "No technicians match your filters."
                      : "No technicians yet. Add one manually or import from CSV/XLSX."}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((t) => {
                const tel = toTelHref(t.phone_number);
                const isSelected = selected.has(t.id);
                return (
                  <TableRow
                    key={t.id}
                    data-state={isSelected ? "selected" : undefined}
                    className={cn(
                      "group whitespace-nowrap text-sm",
                      isSelected && "bg-primary/5 border-l-2 border-l-primary",
                      t.is_active === false && "opacity-60"
                    )}
                  >
                    <TableCell className="align-middle pl-4 w-[36px]">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(v) => toggleRow(t, v === true)}
                        aria-label={isSelected ? `Deselect ${t.name}` : `Select ${t.name}`}
                      />
                    </TableCell>
                    
                    {/* Tech (Name) */}
                    <TableCell className="font-medium max-w-[160px]" title={t.name || "Unnamed technician"}>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{t.name?.trim() || <span className="italic text-muted-foreground">Unnamed</span>}</span>
                        <TechnicianNameBadges tech={t} nameCounts={nameCounts} />
                      </span>
                    </TableCell>
                    
                    {/* Number */}
                    <TableCell className="w-[130px]">
                      {t.phone_number ? (
                        <span className="text-foreground font-mono text-xs">{t.phone_number}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    
                    {/* Service */}
                    <TableCell className="max-w-[140px] truncate" title={t.service ?? ""}>
                      {t.service || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    
                    {/* Area */}
                    <TableCell className="max-w-[160px] truncate" title={t.area}>
                      {t.area || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    
                    {/* Chat Link */}
                    <TableCell className="w-[100px]">
                      {t.chat_link ? (
                        <a
                          href={t.chat_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline text-xs inline-flex items-center"
                          title={t.chat_link}
                        >
                          Open chat
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {/* Good Tech - admin writes it, processor requests it */}
                    <TableCell className="w-[100px] text-center">
                      <GoodTechFlagCell tech={t} />
                    </TableCell>

                    {/* Notes */}
                    <TableCell className="max-w-[150px] sm:max-w-[200px] truncate text-muted-foreground" title={t.notes ?? ""}>
                      {t.notes || <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* OPR Code */}
                    <TableCell className="w-[110px]">
                      {t.opr_code ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20 tracking-wider">
                          {t.opr_code}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>

                    {/* Status - admin writes it, processor requests it */}
                    <TableCell className="w-[100px]">
                      <div className="flex items-center gap-2">
                        <ActiveFlagCell tech={t} />
                        <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{t.is_active === false ? "Inactive" : "Active"}</span>
                      </div>
                    </TableCell>

                    {/* Added Date */}
                    <TableCell className="w-[100px] text-xs text-muted-foreground font-mono">
                      {formatAddedDate(t.created_at) || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    
                    {/* Actions */}
                    <TableCell className="text-right pr-4 w-[120px]">
                      <div className="inline-flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopyOne(t)}
                          title="Copy technician details"
                          aria-label={`Copy ${t.name} details`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => setEditTech(t)} 
                          title="Edit" 
                          aria-label={`Edit ${t.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {canDelete && (
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTech(t)} 
                            title="Delete" 
                            aria-label={`Delete ${t.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Pagination footer */}
        <div className="flex flex-col gap-3 border-t border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">
              {isSearching
                ? `Showing ${startRecord.toLocaleString()}–${endRecord.toLocaleString()} of ${filteredTotal.toLocaleString()} matching technicians`
                : `Showing ${startRecord.toLocaleString()}–${endRecord.toLocaleString()} of ${filteredTotal.toLocaleString()} technicians`}
            </span>
            {paginatedQuery.isFetching && !paginatedQuery.isPending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Loading" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="tech-page-size" className="text-xs text-muted-foreground whitespace-nowrap">
                Technicians per page
              </label>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  const n = Number(v);
                  if (PAGE_SIZE_OPTIONS.includes(n as PageSizeOption)) setPageSize(n as PageSizeOption);
                }}
              >
                <SelectTrigger id="tech-page-size" className="h-8 w-[92px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)} className="text-xs">
                      {n.toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <nav className="flex items-center gap-1" aria-label="Technicians pagination">
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => setCurrentPage(1)}
                disabled={disablePrev}
                aria-label="Go to first page"
                title="Go to first page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={disablePrev}
                aria-label="Go to previous page"
                title="Go to previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {pageWindow.map((item, idx) => {
                if (item === "ellipsis-left" || item === "ellipsis-right") {
                  return (
                    <span
                      key={`${item}-${idx}`}
                      className="px-1.5 text-xs text-muted-foreground select-none"
                      aria-hidden="true"
                    >
                      …
                    </span>
                  );
                }
                const active = item === currentPage;
                return (
                  <Button
                    key={item}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-8 min-w-[2rem] px-2 text-xs"
                    onClick={() => setCurrentPage(item)}
                    aria-current={active ? "page" : undefined}
                    aria-label={`Go to page ${item}`}
                    disabled={!hasResults}
                  >
                    {item}
                  </Button>
                );
              })}

              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={disableNext}
                aria-label="Go to next page"
                title="Go to next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => setCurrentPage(totalPages)}
                disabled={disableNext}
                aria-label="Go to last page"
                title="Go to last page"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </nav>
          </div>
        </div>
      </Card>
      </div>

      <TechnicianDialog
        open={addOpen || editTech !== null}
        onOpenChange={(o) => { if (!o) { setAddOpen(false); setEditTech(null); } }}
        technician={editTech}
        onSaved={handleSaved}
      />
      <ImportTechniciansDialog open={importOpen} onOpenChange={setImportOpen} onImported={invalidateAll} />

      <AlertDialog open={!!deleteTech} onOpenChange={(o) => !o && setDeleteTech(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this technician?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTech?.name} will be permanently removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => {
          if (bulkDeleting) return;
          setBulkDeleteOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected technicians?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCount === 1
                ? "Are you sure you want to permanently delete this technician? This action cannot be undone."
                : `Are you sure you want to permanently delete these ${selectedCount.toLocaleString()} technicians? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selectedCount > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
              <ul className="space-y-1.5">
                {sortTechnicians(Array.from(selected.values()))
                  .slice(0, 10)
                  .map((t) => {
                    const meta = [t.service, t.area].filter((v) => v && String(v).trim() !== "").join(" · ");
                    const phone = t.phone_number && String(t.phone_number).trim() !== "" ? t.phone_number : "No phone number";
                    return (
                      <li key={t.id} className="flex flex-col">
                        <span className="font-medium text-foreground">{t.name || "Unnamed technician"}</span>
                        <span className="text-muted-foreground">
                          {phone}
                          {meta ? ` · ${meta}` : ""}
                        </span>
                      </li>
                    );
                  })}
              </ul>
              {selectedCount > 10 && (
                <p className="mt-2 text-muted-foreground">
                  And {(selectedCount - 10).toLocaleString()} more technician{selectedCount - 10 === 1 ? "" : "s"}
                </p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleBulkDelete();
              }}
              disabled={bulkDeleting || selectedCount === 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : selectedCount === 1 ? (
                "Delete Technician"
              ) : (
                `Delete ${selectedCount.toLocaleString()} Technicians`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
