import { useEffect, useMemo, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Search,
  Sparkles,
  MessageSquareText,
  UserX,
  Star,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
  ClipboardCheck,
  Clock3,
  MapPin,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import QuoPhoneTrigger from "@/components/leads/QuoPhoneTrigger";
import type { TechnicianRecord } from "@/components/technicians/TechnicianDialog";
import { TechnicianNameBadges } from "@/components/technicians/TechnicianNameCell";
import { buildTechnicianNameCounts } from "@/lib/technician-names";
import { buildPickerPages } from "@/lib/picker-pages";
import { requestTechnicianChange } from "@/lib/tech-change-requests";
import { logActivity } from "@/lib/activity";
import { TECHNICIANS_ROOT_KEY } from "@/lib/technicians";
import { REVIEW_STATES, technicianLabelClass, technicianReviewState } from "@/lib/technician-review";
import { isBackgroundPollPaused } from "@/lib/overload-guard";

import { formatDateTime } from "@/lib/date-time-format";
const LABELS = [
  ["tech_dont_respond", "Tech don't respond"],
  ["tech_is_scammer", "Tech is scammer"],
  ["late_payment", "Late payment"],
  ["never_responded", "Never responded to us"],
  ["high_rates", "High rates"],
  ["dont_cooperate", "Doesn't cooperate with us"],
  ["rude", "Rude"],
  ["paid_us_before", "Paid us before"],
  ["good_tech", "Good Tech"],
] as const;
type Label = (typeof LABELS)[number][0];
type Evidence = { label?: string; quote?: string; source?: string; message_id?: string; message_time?: string; conversation_id?: string };
type Assessment = {
  technician_id: string;
  labels: Label[];
  ai_summary: string | null;
  ai_evidence: Evidence[];
  ai_recommendations: string[];
  conversations_reviewed: number;
  messages_reviewed: number;
  last_assessed_at: string | null;
};
type Report = { technicianId: string; jobsCompleted: number | null; jobsPaid: number | null; countBasis: string; error?: string | null };
type AiResult = {
  technicianId: string;
  labels: Label[];
  recommendations: string[];
  summary: string;
  evidence: Evidence[];
  conversationsReviewed: number;
  messagesReviewed: number;
  chatSource?: string;
  incomingMessages?: number;
  outgoingMessages?: number;
  historyLimited?: boolean;
  historyNotice?: string | null;
  reviewedFrom?: string | null;
  reviewedTo?: string | null;
  jobCounts: { completed: number | null; paid: number | null; error: string | null };
  error: string | null;
};

const MESSAGE_TEMPLATE = "Hi {name}, just checking in—do you have availability for any upcoming jobs? Please let us know what types of work you can take and your current rates. Thanks!";
const COUNT_BASIS = "Matched by technician phone number on completed leads (job_done + paid); paid is a subset. Older leads without a technician phone number cannot be attributed, and shared phone numbers may be ambiguous.";

// The picker is paginated rather than capped: an earlier cap meant only the
// first 100 names in the alphabet were ever reachable.
const PICKER_PAGE_SIZES = [25, 50, 100, 200] as const;
const PICKER_PAGE_SIZE_KEY = "marshmallow.technicians.workflowPageSize";

function loadPickerPageSize(): number {
  try {
    const raw = localStorage.getItem(PICKER_PAGE_SIZE_KEY);
    const parsed = Number(raw);
    if (PICKER_PAGE_SIZES.includes(parsed as (typeof PICKER_PAGE_SIZES)[number])) return parsed;
  } catch {
    // ignore storage errors
  }
  return 50;
}

export function TechnicianProcessingWorkflow({
  technicians,
  initialTechnicianIds = [],
}: {
  technicians: TechnicianRecord[];
  initialTechnicianIds?: string[];
}) {
  const { role, user, canAccess } = useAuth();
  const queryClient = useQueryClient();
  const canComposeTechMessage = role === "admin" || canAccess("tech_quick_chat");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>(initialTechnicianIds.slice(0, 8));
  const [assessments, setAssessments] = useState<Record<string, Assessment>>({});
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [aiResults, setAiResults] = useState<Record<string, AiResult>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ aiConfigured: boolean; directQuoConfigured: boolean } | null>(null);
  const [reviewProgress, setReviewProgress] = useState({ completed: 0, total: 0 });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void supabase.functions.invoke("technician-chat-assessment", { body: { action: "health" } })
        .then(({ data, error }) => { if (active && !error && typeof data?.aiConfigured === "boolean") setHealth(data); }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(() => { if (!isBackgroundPollPaused()) refresh(); }, 60000);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [proposedLabels, setProposedLabels] = useState<Record<string, Label[]>>({});
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [flagActions, setFlagActions] = useState<Record<string, "applied" | "requested">>({});
  const [pickerPage, setPickerPage] = useState(1);
  const [pickerPageSize, setPickerPageSizeState] = useState(loadPickerPageSize);
  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const setPickerPageSize = (next: number) => {
    setPickerPageSizeState(next);
    try {
      localStorage.setItem(PICKER_PAGE_SIZE_KEY, String(next));
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    if (initialTechnicianIds.length) setSelectedIds(initialTechnicianIds.slice(0, 8));
  }, [initialTechnicianIds]); // route-driven selection from Map View

  const selectedTechnicians = useMemo(
    () => selectedIds.map((id) => technicians.find((tech) => tech.id === id)).filter((tech): tech is TechnicianRecord => Boolean(tech)),
    [selectedIds, technicians],
  );
  // Counts cover the full directory even when only one page is visible.
  const nameCounts = useMemo(() => buildTechnicianNameCounts(technicians), [technicians]);

  const filteredTechnicians = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return technicians;
    return technicians.filter((tech) =>
      [tech.name, tech.phone_number, tech.area, tech.service].some((value) => value?.toLowerCase().includes(query)),
    );
  }, [search, technicians]);

  // Unnamed import rows have no name and often no area, which renders as a bare
  // separator. They sort last so they never crowd out named technicians.
  const sortedTechnicians = useMemo(
    () =>
      [...filteredTechnicians].sort((left, right) => {
        const leftNamed = left.name?.trim() ? 0 : 1;
        const rightNamed = right.name?.trim() ? 0 : 1;
        return leftNamed - rightNamed || (left.name ?? "").localeCompare(right.name ?? "");
      }),
    [filteredTechnicians],
  );

  const totalPages = Math.max(1, Math.ceil(sortedTechnicians.length / pickerPageSize));
  const currentPage = Math.min(pickerPage, totalPages);
  const pageStart = (currentPage - 1) * pickerPageSize;
  const visibleTechnicians = useMemo(
    () => sortedTechnicians.slice(pageStart, pageStart + pickerPageSize),
    [sortedTechnicians, pageStart, pickerPageSize],
  );

  // A new search or page size can leave the reader past the last page.
  useEffect(() => {
    setPickerPage(1);
  }, [search, pickerPageSize]);

  useEffect(() => {
    setLoadError(null);
    if (!selectedIds.length) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    void supabase.functions.invoke("technician-chat-assessment", { body: { action: "load", technicianIds: selectedIds } })
      .then(({ data, error }) => {
        if (error) throw error;
        if (!active) return;
        const nextAssessments: Record<string, Assessment> = {};
        for (const row of (data?.assessments ?? []) as Assessment[]) nextAssessments[row.technician_id] = row;
        const nextReports: Record<string, Report> = {};
        for (const report of (data?.reports ?? []) as Report[]) nextReports[report.technicianId] = report;
        setAssessments((current) => ({ ...current, ...nextAssessments }));
        setReports((current) => ({ ...current, ...nextReports }));
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : "Couldn't load saved technician reports. Run a fresh review or retry selection.");
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedIds]);

  const toggleTech = (id: string) => {
    if (busy) return;
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((selectedId) => selectedId !== id);
      if (current.length >= 8) {
        toast.error("Assess up to 8 technicians at a time.");
        return current;
      }
      return [...current, id];
    });
  };

  const runAssessment = async (ids = selectedIds) => {
    if (!ids.length || busy || loading) return;
    setBusy(true);
    setStartedAt(Date.now());
    setElapsedSeconds(0);
    setReviewProgress({ completed: 0, total: ids.length });
    const toastId = toast.loading(`Reviewing Quo conversations for ${ids.length} technician${ids.length === 1 ? "" : "s"}… This may take up to 3 minutes.`);
    try {
      const results: AiResult[] = [];
      let next = 0;
      // Independent bounded requests publish each report immediately. One failed
      // technician cannot discard seven completed reports or manual label choices.
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (next < ids.length && mounted.current) {
          const id = ids[next++];
          let result: AiResult;
          try {
            const { data, error } = await supabase.functions.invoke("technician-chat-assessment", {
              body: { action: "assess", technicianIds: [id] }, signal: AbortSignal.timeout(125000),
            });
            if (error) {
              const detail = await error.context?.clone?.().json?.().catch(() => null);
              throw new Error(detail?.error || error.message);
            }
            if (data?.error || data?.results?.length !== 1 || data.results[0].technicianId !== id) throw new Error(data?.error || "The technician report was incomplete. Retry this technician.");
            result = data.results[0];
          } catch (error) {
            result = { technicianId: id, labels: [], recommendations: [], summary: "This review could not be completed. Previous saved labels are preserved.", evidence: [],
              conversationsReviewed: 0, messagesReviewed: 0, jobCounts: { completed: reports[id]?.jobsCompleted ?? null, paid: reports[id]?.jobsPaid ?? null, error: reports[id]?.error ?? null },
              error: error instanceof Error ? error.message : "Review timed out or the connection failed. Retry this technician." };
          }
          results.push(result);
          if (!mounted.current) return;
          setAiResults((current) => ({ ...current, [id]: result }));
          setReports((current) => ({ ...current, [id]: { technicianId: id, jobsCompleted: result.jobCounts.completed,
            jobsPaid: result.jobCounts.paid, error: result.jobCounts.error, countBasis: COUNT_BASIS } }));
          if (!result.error) setProposedLabels((current) => ({ [id]: assessments[id]?.labels ?? result.labels, ...current }));
          setReviewProgress({ completed: results.length, total: ids.length });
        }
      }));
      if (!mounted.current) return;
      const indexed = Object.fromEntries(results.map((result) => [result.technicianId, result]));
      setAiResults((current) => ({ ...current, ...indexed }));
      // A retry refreshes AI advice without overwriting a user's manual choices.
      setProposedLabels((current) => ({
        ...Object.fromEntries(results.filter((result) => !result.error).map((result) => [result.technicianId, assessments[result.technicianId]?.labels ?? result.labels])),
        ...current,
      }));
      setReports((current) => ({
        ...current,
        ...Object.fromEntries(results.map((result) => [result.technicianId, {
          technicianId: result.technicianId,
          jobsCompleted: result.jobCounts.completed,
          jobsPaid: result.jobCounts.paid,
          error: result.jobCounts.error,
          countBasis: COUNT_BASIS,
        }])),
      }));
      if (user?.id) {
        await Promise.all(results.filter((result) => !result.error).map((result) =>
          logActivity(user.id, "technician_chat_assessed", "technician", result.technicianId, {
            conversations_reviewed: result.conversationsReviewed,
            messages_reviewed: result.messagesReviewed,
            suggested_labels: result.labels,
          }).catch((auditError) => console.warn("Technician assessment succeeded, but audit logging failed", auditError)),
        ));
      }
      const failures = results.filter((result) => result.error || result.messagesReviewed === 0);
      toast[failures.length ? "warning" : "success"](
        failures.length ? `${results.length - failures.length} reviews completed; ${failures.length} need chat access or retry.` : "Technician conversation review complete.",
        { id: toastId },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Technician assessment failed.", { id: toastId });
    } finally {
      setBusy(false);
      setStartedAt(null);
    }
  };

  const saveLabels = async (techId: string) => {
    setSavingId(techId);
    try {
      const { data, error } = await supabase.functions.invoke("technician-chat-assessment", {
        body: { action: "save_labels", technicianId: techId, labels: proposedLabels[techId] ?? [] },
      });
      if (error || data?.error || data?.success !== true) throw error || new Error(data?.error || "The backend did not confirm label saving.");
      const labels = proposedLabels[techId] ?? [];
      setAssessments((current) => ({ ...current, [techId]: { ...current[techId], technician_id: techId, labels } as Assessment }));
      if (user?.id) {
        await logActivity(user.id, "technician_workflow_labels_updated", "technician", techId, { labels })
          .catch((auditError) => console.warn("Technician labels saved, but audit logging failed", auditError));
      }
      toast.success("Technician labels saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save labels.");
    } finally {
      setSavingId(null);
    }
  };

  const requestFlag = async (tech: TechnicianRecord, changeType: "set_active" | "set_good_tech", value: boolean) => {
    setActionBusyId(tech.id);
    try {
      if (role === "admin") {
        const column = changeType === "set_active" ? "is_active" : "is_good_tech";
        const { error } = await supabase.from("technicians").update({ [column]: value } as never).eq("id", tech.id);
        if (error) throw error;
        if (user?.id) {
          await logActivity(user.id, "updated", "technician", tech.id, { [column]: value, source: "processing_workflow" })
            .catch((auditError) => console.warn("Technician updated, but audit logging failed", auditError));
        }
      } else {
        if (!user?.id) throw new Error("Sign in again to request this change.");
        await requestTechnicianChange({
          technicianId: tech.id,
          technicianName: tech.name,
          changeType,
          requestedValue: value,
          reason: "Suggested by Technician Processing Workflow; please review the conversation assessment.",
          requesterId: user.id,
        });
      }
      setFlagActions((current) => ({ ...current, [`${tech.id}:${changeType}`]: role === "admin" ? "applied" : "requested" }));
      if (role === "admin") void queryClient.invalidateQueries({ queryKey: TECHNICIANS_ROOT_KEY });
      toast.success(role === "admin" ? "Technician record updated." : "Change sent to Admin for approval.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit technician change.");
    } finally {
      setActionBusyId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary"><Sparkles className="h-4 w-4" />Technician intelligence</div>
            <h2 className="text-xl font-semibold">Processing Workflow</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Select nearby technicians, review their relationship history, then choose your next action. Up to 8 technicians per batch · target review time 2–3 minutes.</p>
          </div>
          <Button onClick={() => void runAssessment()} disabled={!selectedIds.length || busy || loading || health?.aiConfigured === false} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? "Reviewing conversations…" : `Quick Report (${selectedIds.length})`}
          </Button>
        </div>
        {health && (!health.aiConfigured || !health.directQuoConfigured) && <div role="status" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          {!health.aiConfigured && <p>AI reviews require the OPENAI_API_KEY secret. Ask an Admin to configure it in Supabase.</p>}
          {!health.directQuoConfigured && <p>Direct Quo history is not configured (QUO_API_KEY). Mirrored chats still work; missing chats need the key or history sync before review.</p>}
        </div>}
        {loadError && <p role="alert" className="mt-3 text-sm text-destructive">Saved-report loading failed: {loadError}</p>}
        {loading && <p role="status" className="mt-3 text-sm text-muted-foreground">Loading saved reviews and job history…</p>}
        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-lg border bg-background/50 p-3"><span className="font-medium">1. Select</span><p className="mt-1 text-muted-foreground">{selectedIds.length}/8 selected · <Link to="/map-view" className="inline-flex items-center gap-1 text-primary underline"><MapPin className="h-3 w-3" />Choose on map</Link></p></div>
          <div className="rounded-lg border bg-background/50 p-3"><span className="font-medium">2. Review evidence</span><p className="mt-1 text-muted-foreground">Latest 250 messages per technician. Missing history is flagged, never treated as misconduct.</p></div>
          <div className="rounded-lg border bg-background/50 p-3"><span className="font-medium">3. Take action</span><p className="mt-1 text-muted-foreground">Save reviewed labels, request inactivity, or compose a message.</p></div>
        </div>
         {busy && <div role="status" aria-live="polite" className="mt-4 flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"><Loader2 className="h-4 w-4 animate-spin text-primary" /><div><p className="font-medium">Reading chats and checking evidence · {reviewProgress.completed}/{reviewProgress.total} reports ready</p><p className="text-xs text-muted-foreground"><Clock3 className="mr-1 inline h-3 w-3" />{Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")} elapsed · {elapsedSeconds >= 150 ? "Taking longer than expected. Keep this page open; your saved labels are preserved." : "Each report appears as it completes. Failed reviews can be retried individually."}</p></div></div>}
        <div className="mt-4 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find technician by name, phone, area, or service" className="h-9" />
          <Button variant="outline" size="sm" onClick={() => setSelectedIds([])} disabled={!selectedIds.length || busy}>Clear</Button>
        </div>
        <div className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTechnicians.map((tech) => (
            <label key={tech.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-2 text-xs hover:bg-muted/60 ${selectedIds.includes(tech.id) ? "border-primary/30 bg-primary/10" : "border-transparent"}`}>
              <Checkbox checked={selectedIds.includes(tech.id)} disabled={busy} onCheckedChange={() => toggleTech(tech.id)} />
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate">
                  {tech.name?.trim() || <span className="italic text-muted-foreground">Unnamed technician</span>}
                  <span className="text-muted-foreground">{tech.area ? ` · ${tech.area}` : ""}</span>
                </span>
                <TechnicianNameBadges tech={tech} nameCounts={nameCounts} />
              </span>
              {tech.is_active === false && <Badge variant="secondary">Inactive</Badge>}
            </label>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
          <span>
            {sortedTechnicians.length === 0
              ? "No technicians match this search."
              : `Showing ${pageStart + 1}–${Math.min(pageStart + pickerPageSize, sortedTechnicians.length)} of ${sortedTechnicians.length}${search.trim() ? " matching" : " technicians"}`}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              Per page
              <Select value={String(pickerPageSize)} onValueChange={(value) => setPickerPageSize(Number(value))}>
                <SelectTrigger className="h-7 w-[76px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PICKER_PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-7 px-2" disabled={currentPage === 1} onClick={() => setPickerPage(1)} title="First page" aria-label="First page">
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="sm" className="h-7 px-2" disabled={currentPage === 1} onClick={() => setPickerPage((page) => Math.max(1, page - 1))} title="Previous page" aria-label="Previous page">
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              {buildPickerPages(currentPage, totalPages).map((page, index) =>
                page === "ellipsis-left" || page === "ellipsis-right" ? (
                  <span key={`${page}-${index}`} className="px-1 text-muted-foreground">…</span>
                ) : (
                  <Button
                    key={page}
                    variant={page === currentPage ? "default" : "outline"}
                    size="sm"
                    className="h-7 min-w-7 px-2"
                    onClick={() => setPickerPage(page)}
                    aria-current={page === currentPage ? "page" : undefined}
                  >
                    {page}
                  </Button>
                ),
              )}
              <Button variant="outline" size="sm" className="h-7 px-2" disabled={currentPage === totalPages} onClick={() => setPickerPage((page) => Math.min(totalPages, page + 1))} title="Next page" aria-label="Next page">
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="sm" className="h-7 px-2" disabled={currentPage === totalPages} onClick={() => setPickerPage(totalPages)} title="Last page" aria-label="Last page">
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {selectedTechnicians.length > 0 && <details className="rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">How to read this report · job counts and review limits</summary><p className="mt-2">{COUNT_BASIS} Counts of paid jobs do not establish that a technician paid our business. AI suggestions are advisory; manually saved labels are shown separately. A neutral chat can require manual review without indicating a bad technician.</p></details>}

      {selectedTechnicians.map((tech) => {
        const assessment = assessments[tech.id];
        const result = aiResults[tech.id];
        const report = reports[tech.id];
        const labels = proposedLabels[tech.id] ?? assessment?.labels ?? [];
        const recommendations = result?.recommendations ?? assessment?.ai_recommendations ?? [];
        const recommendsInactive = recommendations.includes("suggest_inactive");
        const recommendsMessage = recommendations.includes("suggest_check_job_message");
        const suggestedLabels = result?.labels ?? [...new Set((assessment?.ai_evidence ?? []).map((item) => item.label).filter((label): label is Label => LABELS.some(([key]) => key === label)))];
        const messagesReviewed = result?.messagesReviewed ?? assessment?.messages_reviewed ?? 0;
        const reviewState = technicianReviewState({ reviewed: Boolean(result || assessment?.last_assessed_at), error: result?.error, messages: messagesReviewed, suggestedLabels });
        const stateStyle = REVIEW_STATES[reviewState];
        const draft = messageDrafts[tech.id] ?? MESSAGE_TEMPLATE.replace("{name}", tech.name?.trim().split(/\s+/)[0] || "there");
        return (
          <article key={tech.id} className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex flex-wrap gap-2"><Badge variant="outline" className={stateStyle.className}>{stateStyle.title}</Badge>{tech.is_active === false && <Badge variant="secondary">Inactive</Badge>}</div>
                <h3 className="flex flex-wrap items-center gap-1.5 text-lg font-semibold">
                  <span>{tech.name?.trim() || "Unnamed technician"}</span>
                  <TechnicianNameBadges tech={tech} nameCounts={nameCounts} />
                </h3>
                <p className="text-xs text-muted-foreground">{tech.service || "Service not set"} · {tech.area || "Area not set"} · {tech.phone_number || "No phone"}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{report?.jobsCompleted ?? "—"} jobs completed</Badge>
                <Badge variant="outline">{report?.jobsPaid ?? "—"} jobs paid</Badge>
                 {assessment?.last_assessed_at && <span className="text-muted-foreground">Saved snapshot {formatDateTime(assessment.last_assessed_at)}</span>}
              </div>
            </div>
            {report?.error && <p className="text-xs text-destructive">{report.error}</p>}
            <div className="space-y-2"><h4 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" />AI-supported labels</h4><div className="flex flex-wrap gap-2">{suggestedLabels.length && !result?.error ? suggestedLabels.map((label) => <Badge key={label} variant="outline" className={technicianLabelClass(label)}>{LABELS.find(([key]) => key === label)?.[1] ?? label}</Badge>) : <p className="text-xs text-muted-foreground">{reviewState === "not_reviewed" ? "Run Quick Report to review this technician." : reviewState === "unavailable" ? "Restore chat access and retry. No conclusion about this technician can be drawn." : "No predefined label is established. Review the chat and add labels manually if appropriate."}</p>}</div></div>

            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <h4 className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="h-4 w-4" />Your reviewed labels</h4>
            <p className="text-xs text-muted-foreground">Select or adjust labels manually, including when AI cannot assign a status. Save to confirm your choices.</p>
            <div className="flex flex-wrap gap-2">
              {LABELS.map(([key, label]) => {
                const checked = labels.includes(key);
                return (
                  <button key={key} type="button" aria-pressed={checked} disabled={busy || savingId === tech.id} onClick={() => setProposedLabels((current) => ({ ...current, [tech.id]: checked ? labels.filter((item) => item !== key) : [...labels, key] }))} className={`rounded-full border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${checked ? technicianLabelClass(key) : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                    {label}
                  </button>
                );
              })}
              <Button variant="outline" size="sm" className="h-8" disabled={busy || savingId === tech.id} onClick={() => void saveLabels(tech.id)}>
                {savingId === tech.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Save labels
              </Button>
            </div>
            </div>

            {(result || assessment) && (
              <div className="space-y-2 rounded-lg bg-muted/30 p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relationship summary</h4>
                <p className="text-sm leading-relaxed">{result?.summary ?? assessment?.ai_summary}</p>
                <p className="text-[11px] text-muted-foreground">Reviewed {result?.conversationsReviewed ?? assessment?.conversations_reviewed ?? 0} conversations · {result?.messagesReviewed ?? assessment?.messages_reviewed ?? 0} messages{result?.chatSource ? ` · ${result.chatSource}` : ""}{result?.error ? ` · Error: ${result.error}` : ""}</p>
                {result?.incomingMessages !== undefined && <p className="text-xs text-muted-foreground">{result.incomingMessages} incoming · {result.outgoingMessages ?? 0} outgoing{result.reviewedFrom && result.reviewedTo ? ` · ${new Date(result.reviewedFrom).toLocaleDateString()} – ${new Date(result.reviewedTo).toLocaleDateString()}` : ""}</p>}
                 {result?.historyLimited && <p className="text-xs text-amber-700 dark:text-amber-300">Recent-history sample: older messages may change this assessment. Review the full chat before making a relationship decision.</p>}
                 {result?.historyNotice && <p className="text-xs text-amber-700 dark:text-amber-300">{result.historyNotice}</p>}
                {(result?.conversationsReviewed ?? assessment?.conversations_reviewed) === 0 && tech.chat_link && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {result?.error ? "A Quo chat link is saved, but it was not reviewed. Configure the QUO_API_KEY Edge Function secret or sync the conversation to the CRM mirror." : "A Quo chat link is saved, but no messages were found in the CRM mirror or linked conversation."} {tech.chat_link.startsWith("https://my.quo.com/") && <a href={tech.chat_link} target="_blank" rel="noopener noreferrer" className="underline">Open Quo chat</a>}
                  </p>
                )}
               {(result?.evidence ?? assessment?.ai_evidence ?? []).map((item, index) => item.quote ? <blockquote key={index} className="border-l-2 border-primary/50 pl-2 text-xs italic text-muted-foreground">{item.source ? `${item.source}: ` : ""}{item.quote}{item.message_time && <span className="mt-1 block not-italic">{formatDateTime(item.message_time)}</span>}</blockquote> : null)}
              </div>
            )}

            {(result || assessment?.last_assessed_at) && (
              <div className={`space-y-2 rounded-lg border p-3 text-xs ${stateStyle.className}`}>
                <p className="font-semibold">Suggested next step</p>
                {reviewState === "unavailable" && <p>Check the saved Quo link, restore or sync message history, then retry this technician. Missing chat is not evidence of a bad relationship.</p>}
                {reviewState === "manual_review" && <p>Review the full conversation and follow up if needed. If the situation falls outside the nine labels, leave labels unchanged rather than force a match.</p>}
                {reviewState === "supported" && <p>Confirm the quoted evidence, adjust your reviewed labels, then save. Relationship changes are separate actions below.</p>}
                <div className="flex flex-wrap gap-1.5">
                {recommendations.includes("suggest_inactive") && <Badge variant="outline">Review for inactivity</Badge>}
                {recommendations.includes("review_payment") && <Badge variant="outline">Review payment history</Badge>}
                {recommendations.includes("review_rates") && <Badge variant="outline">Review rates</Badge>}
                {recommendations.includes("suggest_check_job_message") && <Badge variant="outline">Compose job check-in</Badge>}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t pt-3">
               <Button variant="outline" size="sm" disabled={busy || loading || health?.aiConfigured === false} onClick={() => void runAssessment([tech.id])}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />{result || assessment?.last_assessed_at ? "Retry review" : "Review technician"}</Button>
              {(recommendsInactive || labels.some((label) => ["tech_dont_respond", "tech_is_scammer", "never_responded"].includes(label))) && tech.is_active !== false && !flagActions[`${tech.id}:set_active`] && (
                <Button variant="outline" size="sm" disabled={busy || actionBusyId === tech.id} onClick={() => void requestFlag(tech, "set_active", false)}><UserX className="mr-1.5 h-3.5 w-3.5" />{role === "admin" ? "Mark inactive" : "Request inactive"}</Button>
              )}
              {labels.includes("good_tech") && !tech.is_good_tech && !flagActions[`${tech.id}:set_good_tech`] && (
                <Button variant="outline" size="sm" disabled={busy || actionBusyId === tech.id} onClick={() => void requestFlag(tech, "set_good_tech", true)}><Star className="mr-1.5 h-3.5 w-3.5" />{role === "admin" ? "Mark Good Tech" : "Request Good Tech"}</Button>
              )}
              {flagActions[`${tech.id}:set_active`] && <Badge variant="secondary">Inactive {flagActions[`${tech.id}:set_active`]}</Badge>}
              {flagActions[`${tech.id}:set_good_tech`] && <Badge variant="secondary">Good Tech {flagActions[`${tech.id}:set_good_tech`]}</Badge>}
            </div>
            {canComposeTechMessage && tech.phone_number && <details className="rounded-lg border border-primary/20 bg-primary/5 p-3" open={recommendsMessage || labels.includes("good_tech") || undefined}><summary className="cursor-pointer text-sm font-medium">{recommendsMessage || labels.includes("good_tech") ? "Recommended: compose job check-in" : "Manual follow-up: compose a message"}</summary><div className="mt-3 space-y-2"><label htmlFor={`draft-${tech.id}`} className="text-xs text-muted-foreground">Edit your draft before opening Tech Quick Chat</label><Textarea id={`draft-${tech.id}`} value={draft} onChange={(event) => setMessageDrafts((current) => ({ ...current, [tech.id]: event.target.value }))} className="min-h-[90px] bg-background" /><QuoPhoneTrigger contactName={tech.name} phone={tech.phone_number} chatType="tech" initialMessage={draft}><Button variant="outline" size="sm" disabled={busy || !draft.trim()}><MessageSquareText className="mr-1.5 h-3.5 w-3.5" />Open draft in Tech Quick Chat</Button></QuoPhoneTrigger><p className="text-xs text-muted-foreground">Opening the chat does not send this message. Review the recipient and send from the chat.</p></div></details>}
          </article>
        );
      })}
    </section>
  );
}
