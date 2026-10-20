import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { fetchScheduleMonitor, changeScheduleMonitor, type ScheduleMonitorRow, type ScheduleMonitorMode } from "@/lib/schedule-monitor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const timezones = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu", "America/Anchorage"];
const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
function MonitorJob({ job, refresh, mode }: { job: ScheduleMonitorRow; refresh: () => void; mode: ScheduleMonitorMode }) {
  const [conversationId, setConversationId] = useState(job.conversation_id ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: "link" | "unlink" | "retry" | "review", decision?: "accept" | "reject") => {
    if (saving) return;
    setSaving(true); setError("");
    try {
      await changeScheduleMonitor({ action, leadId: job.lead_id, conversationId: conversationId || undefined, reason, decision, generation: job.generation });
      setReason(""); refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save monitor action"); }
    finally { setSaving(false); }
  };
  return <article className="space-y-3 rounded-lg border p-4">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">{job.job_id}</h3><span className="text-xs text-muted-foreground">{job.status.replace(/_/g, " ")} · {job.state}</span></div>
    <p className="text-sm">{job.result?.reason || (job.conversation_id ? "Waiting for trusted new evidence." : "Admin verification required before this job can be checked.")}</p>
    {!job.eligible && <p className="text-xs text-destructive">Not eligible for automatic tagging. Existing status and approvals remain unchanged.</p>}
    {job.checked_at && <p className="text-xs text-muted-foreground">Last check: {new Date(job.checked_at).toLocaleString()}{job.result?.evidence_id ? ` · Evidence ${job.result.evidence_id}` : ""}</p>}
    <details><summary className="cursor-pointer text-sm font-medium text-primary">Verify conversation / Review shadow evidence</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm">Saved appointment: {job.scheduled_date || "date missing"} · {job.scheduled_time_start || "start time missing"} · {job.timezone || "timezone not verified"}</p>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{job.schedule_requirements || "No saved schedule requirements."}</p>
        {job.evidence && <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs font-medium">Latest trusted {job.evidence.sender} evidence · {job.evidence.message_time ? new Date(job.evidence.message_time).toLocaleString() : "time unavailable"}</p><blockquote className="mt-2 whitespace-pre-wrap break-words text-sm">{job.evidence.text || "No usable text"}</blockquote></div>}
        <p className="text-xs text-muted-foreground">Verify the exact job and customer line in Quo first. A phone match is only a candidate, never verification. Only new trusted ingestion after verification is used.</p>
        <Label htmlFor={`conversation-${job.lead_id}`}>Customer conversation</Label>
        <select id={`conversation-${job.lead_id}`} className={selectClass} value={conversationId} onChange={(event) => setConversationId(event.target.value)}>
          <option value="">Choose a verified conversation</option>{job.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.id} · line {candidate.number_id || "unknown"}</option>)}
        </select>
        <Label htmlFor={`reason-${job.lead_id}`}>Verification / review reason</Label><Textarea id={`reason-${job.lead_id}`} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={saving || !conversationId || reason.trim().length < 10 || !job.eligible} onClick={() => { void run("link"); }}>Verify binding</Button>
          <Button size="sm" variant="outline" disabled={saving || reason.trim().length < 10 || !job.conversation_id} onClick={() => { void run("unlink"); }}>Remove binding</Button>
          <Button size="sm" variant="outline" disabled={saving || reason.trim().length < 10} onClick={() => { void run("retry"); }}>Retry check</Button>
          {mode === "shadow" && job.result?.decision === "confirmed" && <><Button size="sm" disabled={saving || reason.trim().length < 10} onClick={() => { void run("review", "accept"); }}>Accept shadow finding</Button><Button size="sm" variant="outline" disabled={saving || reason.trim().length < 10} onClick={() => { void run("review", "reject"); }}>Reject finding</Button></>}
        </div>
        {job.review_decision && <p className="text-xs">Reviewed: {job.review_decision}</p>}
      </div>
    </details>
  </article>;
}
export default function ScheduleMonitorPanel() {
  const { user, role } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ["schedule-monitor", user?.id, role, offset], queryFn: () => fetchScheduleMonitor(offset), enabled: role === "admin" && open, refetchInterval: open ? 30000 : false });
  const [mode, setMode] = useState<ScheduleMonitorMode | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const refresh = () => { void client.invalidateQueries({ queryKey: ["schedule-monitor"] }); };
  if (role !== "admin") return null;
  const save = async () => {
    if (!query.data || saving) return;
    setSaving(true);
    try {
      await changeScheduleMonitor({ action: "configure", mode: mode ?? query.data.mode, timezone: timezone ?? query.data.timezone, reason, expectedChangedAt: draftRevision ?? query.data.changed_at });
      setMode(null); setTimezone(null); setDraftRevision(null); setReason(""); refresh(); toast.success("Monitor configuration saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save monitor configuration"); }
    finally { setSaving(false); }
  };
  return <details className="rounded-xl border bg-card p-4" onToggle={(event) => setOpen(event.currentTarget.open)}><summary className="cursor-pointer font-semibold">Schedule confirmation monitor · Admin controls</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">Off by default. Shadow mode records advisory findings without changing jobs. Automatic mode requires five accepted jobs, no rejected or unreviewed confirmations, and an explicit audited activation. Only exact job/date/24-hour-time confirmations qualify.</p>
      {query.isError ? <p role="alert" className="text-sm text-destructive">Monitor backend unavailable. {query.error.message} <Button variant="outline" onClick={refresh}>Retry</Button></p>
        : !query.data ? <p role="status">Loading monitor…</p> : <>
          <p className="text-sm">Saved mode: <strong>{query.data.mode}</strong> · {query.data.accepted} accepted jobs · {query.data.rejected} rejected · {query.data.daily_checks}/100 daily checks</p>
          {query.data.ingestion_paused && <p role="status" className="text-sm text-destructive">Quo ingestion is paused. No schedule checks or automatic changes run; fresh trusted evidence is required after resume.</p>}
          {query.data.cooldown_until && Date.parse(query.data.cooldown_until) > Date.now() && <p role="status" className="text-sm">Provider cooldown until {new Date(query.data.cooldown_until).toLocaleString()}. No automatic action during cooldown.</p>}
          {draftRevision && draftRevision !== query.data.changed_at && <p role="alert" className="text-sm text-destructive">Another Admin changed the configuration. Your draft is retained; discard it to review the latest saved settings before enabling monitoring. Off remains available as a kill switch.</p>}
          <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="monitor-mode">Mode</Label><select id="monitor-mode" className={selectClass} value={mode ?? query.data.mode} onChange={(event) => { setDraftRevision((previous) => previous ?? query.data.changed_at); setMode(event.target.value as ScheduleMonitorMode); }}><option value="off">Off</option><option value="shadow">Shadow — no job changes</option><option value="automatic">Automatic — guarded tag changes</option></select></div>
            <div><Label htmlFor="monitor-timezone">Agreed schedule timezone</Label><select id="monitor-timezone" className={selectClass} value={timezone ?? query.data.timezone} onChange={(event) => { setDraftRevision((previous) => previous ?? query.data.changed_at); setTimezone(event.target.value); }}>{timezones.map((zone) => <option key={zone}>{zone}</option>)}</select></div></div>
          <Label htmlFor="monitor-reason">Configuration reason / shadow review summary</Label><Textarea id="monitor-reason" value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} />
          <Button disabled={saving || reason.trim().length < 10 || (!mode && !timezone)} onClick={() => { void save(); }}>{saving ? "Saving…" : "Save monitor configuration"}</Button>
          {draftRevision && <Button variant="ghost" disabled={saving} onClick={() => { setMode(null); setTimezone(null); setDraftRevision(null); setReason(""); }}>Discard configuration draft</Button>}
          <p className="text-xs text-muted-foreground">Worker deployment, secret setup and a scheduled invocation are separate approved release steps. Saving this control alone does not install a worker.</p>
          <div className="grid gap-3 lg:grid-cols-2">{query.data.rows.map((job) => <MonitorJob key={`${job.lead_id}:${job.generation}`} job={job} refresh={refresh} mode={query.data.mode} />)}</div>
          {!query.data.rows.length && <p role="status" className="text-sm text-muted-foreground">No jobs carry the waiting-confirmation tag.</p>}
          <nav aria-label="Monitor job pages" className="flex items-center justify-center gap-3"><Button variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button><span className="text-xs">{query.data.total} waiting jobs · Page {Math.floor(offset / 20) + 1}</span><Button variant="outline" disabled={offset + 20 >= query.data.total} onClick={() => setOffset(offset + 20)}>Next</Button></nav>
        </>}
    </div>
  </details>;
}
