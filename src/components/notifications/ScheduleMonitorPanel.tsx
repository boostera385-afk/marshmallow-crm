import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { fetchScheduleMonitor, changeScheduleMonitor, type ScheduleMonitorRow, type ScheduleMonitorMode } from "@/lib/schedule-monitor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const MODE_LABELS: Record<ScheduleMonitorMode, string> = {
  off: "Off",
  shadow: "Shadow — AI records its answer, tags never change",
  automatic: "On — AI moves confirmed jobs to Ready to schedule, and jobs where the customer asked for another time to Customer Require New Schedule",
};

function resultSummary(job: ScheduleMonitorRow): string {
  const result = job.result;
  if (!result) return job.evidence ? "New message or call. AI check is queued." : "Waiting for a new message or call.";
  if (result.decision === "confirmed") return result.applied ? "AI: customer confirmed. Tag changed to Ready to schedule." : "AI: customer confirmed (Shadow, tag not changed).";
  if (result.decision === "new_schedule_needed") return result.applied ? "AI: customer asked for a different day/time. Tag changed to Customer Require New Schedule." : "AI: customer asked for a different day/time (Shadow, tag not changed).";
  if (result.decision === "unavailable") return "AI check unavailable. It will retry.";
  return "AI: not confirmed yet.";
}

function MonitorJob({ job, refresh }: { job: ScheduleMonitorRow; refresh: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const retry = async () => {
    if (saving) return;
    setSaving(true); setError("");
    try {
      await changeScheduleMonitor({ action: "retry", leadId: job.lead_id, reason });
      setReason(""); refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not queue the check"); }
    finally { setSaving(false); }
  };
  return <article className="space-y-2 rounded-lg border p-4">
    <div className="flex flex-wrap justify-between gap-2">
      <h3 className="text-sm font-semibold">{job.job_id}{job.customer_name ? ` · ${job.customer_name}` : ""}</h3>
      <span className="text-xs text-muted-foreground">{job.status.replace(/_/g, " ")}{job.service_type ? ` · ${job.service_type}` : ""}</span>
    </div>
    <p className="text-sm">{resultSummary(job)}</p>
    {job.result?.reason && <p className="text-xs text-muted-foreground">{job.result.reason}</p>}
    {job.result?.quote && <blockquote className="border-l-2 pl-2 text-sm italic">“{job.result.quote}”</blockquote>}
    {!job.eligible && <p className="text-xs text-destructive">Not eligible: the job is scheduled or closed, or has a pending approval.</p>}
    <details><summary className="cursor-pointer text-sm font-medium text-primary">Details</summary>
      <div className="mt-2 space-y-2">
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">Schedule: {job.schedule_requirements || "not saved"}</p>
        {job.waiting_since && <p className="text-xs text-muted-foreground">Waiting since {new Date(job.waiting_since).toLocaleString()}. Only messages and calls after this count.</p>}
        {job.evidence && <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs font-medium">Latest message or call · {job.evidence.message_time ? new Date(job.evidence.message_time).toLocaleString() : "time unavailable"}</p><blockquote className="mt-1 whitespace-pre-wrap break-words text-sm">{job.evidence.text || "No text (call event)"}</blockquote></div>}
        {job.checked_at && <p className="text-xs text-muted-foreground">Last AI check: {new Date(job.checked_at).toLocaleString()}</p>}
        {job.evidence && <>
          <Label htmlFor={`reason-${job.lead_id}`}>Reason to check again</Label>
          <Textarea id={`reason-${job.lead_id}`} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button size="sm" variant="outline" disabled={saving || reason.trim().length < 10} onClick={() => { void retry(); }}>Check again</Button>
        </>}
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
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const refresh = () => { void client.invalidateQueries({ queryKey: ["schedule-monitor"] }); };
  if (role !== "admin") return null;
  const save = async () => {
    if (!query.data || saving || !mode) return;
    setSaving(true);
    try {
      await changeScheduleMonitor({ action: "configure", mode, reason, expectedChangedAt: draftRevision ?? query.data.changed_at });
      setMode(null); setDraftRevision(null); setReason(""); refresh(); toast.success("AI schedule confirmation setting saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save the setting"); }
    finally { setSaving(false); }
  };
  return <details className="rounded-xl border bg-card p-4" onToggle={(event) => setOpen(event.currentTarget.open)}><summary className="cursor-pointer font-semibold">AI schedule confirmation · Admin controls</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">For leads tagged <strong>Waiting for CX for schedule confirmation</strong>. When a new text (ours or the customer's), call, call transcript or summary arrives in Quo, AI reads the chat and calls. If the customer confirmed (in a text or on a call), the tag changes to <strong>Ready to schedule</strong> with an AI marker, and the lead's CS, CS Admins, Admins and Processors are notified. Status and the agreed schedule never change.</p>
      {query.isError ? <p role="alert" className="text-sm text-destructive">AI schedule confirmation backend unavailable. {query.error.message} <Button variant="outline" onClick={refresh}>Retry</Button></p>
        : !query.data ? <p role="status">Loading…</p> : <>
          <p className="text-sm">Saved setting: <strong>{MODE_LABELS[query.data.mode]}</strong> · {query.data.daily_checks}/{query.data.daily_limit} AI checks today</p>
          {query.data.ingestion_paused && <p role="status" className="text-sm text-destructive">Quo ingestion is paused. No checks or tag changes run; the customer must text again after it resumes.</p>}
          {query.data.cooldown_until && Date.parse(query.data.cooldown_until) > Date.now() && <p role="status" className="text-sm">AI provider cooldown until {new Date(query.data.cooldown_until).toLocaleString()}. No tag changes during cooldown.</p>}
          {draftRevision && draftRevision !== query.data.changed_at && <p role="alert" className="text-sm text-destructive">Another Admin changed this setting. Your draft is kept; discard it to see the latest setting before turning the AI on. Off always works.</p>}
          <div><Label htmlFor="monitor-mode">Mode</Label><select id="monitor-mode" className={selectClass} value={mode ?? query.data.mode} onChange={(event) => { setDraftRevision((previous) => previous ?? query.data.changed_at); setMode(event.target.value as ScheduleMonitorMode); }}>
            {(Object.keys(MODE_LABELS) as ScheduleMonitorMode[]).map((key) => <option key={key} value={key}>{MODE_LABELS[key]}</option>)}</select></div>
          <Label htmlFor="monitor-reason">Reason for the change</Label><Textarea id="monitor-reason" value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} />
          <Button disabled={saving || reason.trim().length < 10 || !mode} onClick={() => { void save(); }}>{saving ? "Saving…" : "Save setting"}</Button>
          {draftRevision && <Button variant="ghost" disabled={saving} onClick={() => { setMode(null); setDraftRevision(null); setReason(""); }}>Discard draft</Button>}
          <p className="text-xs text-muted-foreground">The worker deployment, its secret and the one-minute schedule are separate approved setup steps. Saving this setting alone does not install them.</p>
          <div className="grid gap-3 lg:grid-cols-2">{query.data.rows.map((job) => <MonitorJob key={job.lead_id} job={job} refresh={refresh} />)}</div>
          {!query.data.rows.length && <p role="status" className="text-sm text-muted-foreground">No leads carry the Waiting for CX for schedule confirmation tag.</p>}
          <nav aria-label="Waiting job pages" className="flex items-center justify-center gap-3"><Button variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button><span className="text-xs">{query.data.total} waiting jobs · Page {Math.floor(offset / 20) + 1}</span><Button variant="outline" disabled={offset + 20 >= query.data.total} onClick={() => setOffset(offset + 20)}>Next</Button></nav>
        </>}
    </div>
  </details>;
}
