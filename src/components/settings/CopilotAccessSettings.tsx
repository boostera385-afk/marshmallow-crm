import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
import { useCopilotSettings } from "@/hooks/useCopilotSettings";
import { resolveCopilotAccess, type CopilotConfig } from "@/lib/copilot-api";
import { COPY_ROLES } from "@/lib/operator-workflow";
import CopilotLogo from "@/components/copilot/CopilotLogo";
import type { AppRole } from "@/types";
import CopilotReadiness from "./CopilotReadiness";

export default function CopilotAccessSettings({ users }: { users: { id: string; full_name: string | null; role: AppRole }[] }) {
  const { role, user } = useAuth();
  const { query, save, disabled } = useCopilotSettings();
  const [draft, setDraft] = useState<CopilotConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const savedConfig = query.data?.config;
  const baseline = useRef<CopilotConfig | null>(null);
  // Permission/usage refreshes must not discard unsaved global AI/budget edits.
  // Query structural sharing preserves this nested object when config is unchanged.
  useEffect(() => { baseline.current = null; setDraft(null); }, [user?.id, role]);
  useEffect(() => { setDraft((previous) => {
    if (!previous || JSON.stringify(previous) === JSON.stringify(baseline.current) || JSON.stringify(previous) === JSON.stringify(savedConfig)) {
      baseline.current = savedConfig ?? null; return savedConfig ?? null;
    }
    return previous;
  }); }, [savedConfig, user?.id, role]);
  if (role !== "admin") return null;
  const data = query.data;
  const filtered = users.filter((u) => u.role !== "admin" && (filterRole === "all" || filterRole === u.role) && (u.full_name || "Unnamed user").toLowerCase().includes(search.toLowerCase()));
  const valid = draft && Number.isInteger(draft.monthly_budget_cents) && draft.monthly_budget_cents >= 0 && draft.monthly_budget_cents <= 100000 && Number.isInteger(draft.daily_ai_limit) && draft.daily_ai_limit >= 0 && draft.daily_ai_limit <= 100 && Boolean(draft.timezone.trim());
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedConfig);
  const conflict = baseline.current && JSON.stringify(baseline.current) !== JSON.stringify(savedConfig) && dirty;
  return <Card className="border-border/60"><CardContent className="space-y-4 p-4 sm:p-5">
    <div className="flex items-start gap-3"><CopilotLogo className="h-10 w-10"/><div><h3 className="font-semibold">Marshmallow Copilot</h3><p className="text-sm text-muted-foreground">Control who sees the read-only assistant. Copilot never grants additional record or feature access.</p></div></div>
    {query.isLoading && <p role="status">Loading Copilot settings…</p>}
    {query.error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{query.error.message}</p><Button variant="outline" onClick={() => void query.refetch()}>Retry Copilot settings</Button></div>}
    {savedConfig && <p role="status" className="rounded-lg border px-3 py-2 text-xs">Saved: Copilot {savedConfig.enabled ? "enabled" : "disabled"} · AI {savedConfig.ai_enabled ? "enabled" : "disabled"}{query.isError ? " · Last loaded; refresh unavailable" : dirty ? " · Unsaved changes" : " · Verified saved configuration"}</p>}
    {conflict && <div role="alert" className="space-y-2 text-sm text-destructive">Saved configuration changed in another session. Your edits were kept, not applied.<Button variant="outline" size="sm" onClick={() => { baseline.current = savedConfig ?? null; setDraft(savedConfig ?? null); }}>Reload saved configuration</Button></div>}
    {draft && <form className="space-y-3 rounded-xl border bg-muted/20 p-3" onSubmit={(event) => { event.preventDefault(); if (valid && !disabled && !conflict) save.mutate({ kind: "config", config: draft, expected: baseline.current ?? undefined }); }}>
      <div className="flex flex-wrap gap-5"><label className="flex items-center gap-3 text-sm">Enable Copilot<Switch aria-label="Enable Marshmallow Copilot globally" checked={draft.enabled} disabled={disabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}/></label><label className="flex items-center gap-3 text-sm">Enable optional AI<Switch aria-label="Enable Copilot AI" checked={draft.ai_enabled} disabled={disabled} onCheckedChange={(ai_enabled) => setDraft({ ...draft, ai_enabled })}/></label></div>
      <div className="grid gap-3 sm:grid-cols-3"><label className="space-y-1 text-xs">Monthly AI allowance (USD)<Input type="number" min="0" max="1000" step=".01" value={Number.isFinite(draft.monthly_budget_cents) ? draft.monthly_budget_cents / 100 : ""} disabled={disabled} onChange={(e) => setDraft({ ...draft, monthly_budget_cents: e.target.value === "" ? NaN : Math.round(Number(e.target.value) * 100) })}/></label><label className="space-y-1 text-xs">AI requests per user / day<Input type="number" min="0" max="100" value={Number.isFinite(draft.daily_ai_limit) ? draft.daily_ai_limit : ""} disabled={disabled} onChange={(e) => setDraft({ ...draft, daily_ai_limit: e.target.value === "" ? NaN : Number(e.target.value) })}/></label><label className="space-y-1 text-xs">Business timezone<Input value={draft.timezone} disabled={disabled} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}/></label></div>
      <p className="text-xs text-muted-foreground">Changes take effect after Save. Default: Admin only, AI off, Eastern Time. Search and standard reports use no AI tokens. Each attempted AI request reserves a conservative $0.02, including uncertain failures; this allowance is not an OpenAI invoice.</p>
      <p className="text-xs text-muted-foreground">Optional AI is available to every user allowed to use Copilot when globally enabled. There is no separate per-user AI permission. The monthly allowance is shared; the daily request limit is per user. Set either limit to 0 to stop new AI requests without disabling CRM lookups.</p>
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={disabled || !valid || Boolean(conflict)}>Save Copilot configuration</Button>{dirty && <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { baseline.current = savedConfig ?? null; setDraft(savedConfig ?? null); }}>Discard draft edits</Button>}</div>
    </form>}
    {savedConfig && !query.isError && <CopilotReadiness config={savedConfig}/>}
    {data && !query.isError && <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>This month: {data.usage.requests} AI requests</span><span>Allowance reserved: ${(data.usage.reservedCents / 100).toFixed(2)}</span><span>{data.usage.inputTokens.toLocaleString()} input / {data.usage.outputTokens.toLocaleString()} output tokens</span><span>{data.usage.unavailable} pending or unavailable</span></div>}
    <p className="text-xs font-semibold text-muted-foreground">Role defaults · Admin retains access while globally enabled</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{COPY_ROLES.map(({ role: targetRole, label }) => <label key={targetRole} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm"><span>{label}<span className="block text-xs text-muted-foreground">{!data || query.isError ? "Not verified" : data.roles.find((r) => r.role === targetRole)?.allowed ? "Allowed" : "Denied"}</span></span><Switch aria-label={`Allow Copilot for ${label}`} checked={Boolean(data && !query.isError && data.roles.find((r) => r.role === targetRole)?.allowed)} disabled={disabled} onCheckedChange={(allowed) => save.mutate({ kind: "permission", role: targetRole, userId: null, allowed })}/></label>)}</div>
    <Collapsible open={open} onOpenChange={setOpen}><CollapsibleTrigger asChild><Button variant="outline" className="w-full justify-between">Copilot user overrides<span>{open ? "−" : "+"}</span></Button></CollapsibleTrigger><CollapsibleContent className="space-y-3 pt-3">
      <div className="grid gap-3 sm:grid-cols-2"><Input aria-label="Find Copilot user" placeholder="Search user name…" value={search} onChange={(e) => setSearch(e.target.value)}/><Select value={filterRole} onValueChange={setFilterRole}><SelectTrigger aria-label="Filter Copilot users by role"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All roles</SelectItem>{COPY_ROLES.map((r) => <SelectItem key={r.role} value={r.role}>{r.label}</SelectItem>)}</SelectContent></Select></div>
      <div className="max-h-80 space-y-2 overflow-y-auto">{filtered.map((target) => {
        const override = data?.users.find((u) => u.user_id === target.id)?.allowed;
        const effective = data && !query.isError ? resolveCopilotAccess(target.role, data.config.enabled, data.roles.find((r) => r.role === target.role)?.allowed, override) : null;
        return <div key={target.id} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-words text-sm font-medium">{target.full_name || "Unnamed user"}</p><p className="text-xs text-muted-foreground">Effective access: {effective === null ? "Not verified" : effective ? "Allowed" : "Denied"}</p></div><Select value={override === undefined ? "inherit" : override ? "allow" : "deny"} disabled={disabled} onValueChange={(value) => save.mutate({ kind: "permission", role: null, userId: target.id, allowed: value === "inherit" ? null : value === "allow" })}><SelectTrigger className="w-full sm:w-48" aria-label={`Copilot override for ${target.full_name || "Unnamed user"}`}><SelectValue/></SelectTrigger><SelectContent><SelectItem value="inherit">Inherit role default</SelectItem><SelectItem value="allow">Allow</SelectItem><SelectItem value="deny">Deny</SelectItem></SelectContent></Select></div>;
      })}{!filtered.length && <p className="text-sm text-muted-foreground">No matching users.</p>}</div>
    </CollapsibleContent></Collapsible>
  </CardContent></Card>;
}
