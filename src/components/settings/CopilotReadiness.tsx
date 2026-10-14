import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchCopilotDiagnostics, testCopilotAi, type CopilotConfig } from "@/lib/copilot-api";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function CopilotReadiness({ config }: { config: CopilotConfig }) {
  const { user, role } = useAuth();
  const client = useQueryClient();
  const [checking, setChecking] = useState(false);
  const flight = useRef(false);
  const query = useQuery({ queryKey: ["copilot-diagnostics", user?.id], queryFn: fetchCopilotDiagnostics,
    enabled: role === "admin" && checking, retry: false, refetchOnWindowFocus: true });
  const test = useMutation({ mutationFn: testCopilotAi, retry: false,
    onSettled: () => { flight.current = false; void client.invalidateQueries({ queryKey: ["copilot-diagnostics"] }); void client.invalidateQueries({ queryKey: ["copilot-settings"] }); } });
  const data = query.data;
  const ready = config.enabled && config.ai_enabled && data?.keyConfigured && data.remainingCents >= 2 && data.remainingToday > 0;
  if (role !== "admin") return null;
  return <section aria-label="AI readiness" className="space-y-3 rounded-xl border bg-background p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4 text-primary"/>AI readiness</h4><Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => { setChecking(true); if (checking) void query.refetch(); }}>Check AI readiness</Button></div>
    <p className="text-xs text-muted-foreground">Checks saved configuration and usage, not provider availability. No AI call is made by this check.</p>
    {query.isFetching && <p role="status" className="flex items-center gap-2 text-xs"><Loader2 className="h-3 w-3 animate-spin"/>Checking backend…</p>}
    {query.error && <p className="text-xs text-destructive">Readiness unavailable: {query.error.message}</p>}
    {data && !query.isError && <><dl className="grid gap-3 text-xs sm:grid-cols-3">{[
      ["Saved Copilot", config.enabled ? "Enabled" : "Disabled"], ["Saved AI", config.ai_enabled ? "Enabled" : "Disabled"],
      ["Server credential", data.keyConfigured ? "Present · not validated" : "Missing"], ["Allowance remaining", `$${(data.remainingCents / 100).toFixed(2)}`],
      ["Your requests remaining today", String(data.remainingToday)], ["Last successful AI request", data.lastSuccessAt ? new Date(data.lastSuccessAt).toLocaleString() : "No success recorded"],
      ["Last configuration change", data.configChangedAt ? new Date(data.configChangedAt).toLocaleString() : "No change recorded"], ["Backend / prompt", `${data.backendVersion} / ${data.promptVersion}`], ["Model", data.model],
    ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl>
    <p className="flex items-center gap-2 text-xs"><ShieldCheck className="h-4 w-4"/>{ready ? "Ready for a confirmed provider test. Users still need AI-assisted consent in chat." : "Resolve disabled AI, missing credentials or exhausted limits before testing."}</p></>}
    <AlertDialog><AlertDialogTrigger asChild><Button type="button" size="sm" disabled={!ready || test.isPending}>Test AI connection</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Test the AI provider?</AlertDialogTitle><AlertDialogDescription>This sends one nonsensitive question to OpenAI. It reserves $0.02 of the shared allowance and counts toward your daily limit, even if the outcome is uncertain. It does not change CRM records or enable AI. No automatic retry.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={test.isPending} onClick={() => { if (flight.current || !ready) return; flight.current = true; test.mutate(); }}>Confirm AI test</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {test.isPending && <p role="status" className="text-xs">Testing provider…</p>}
    {test.error && <p role="alert" className="text-xs text-destructive">{test.error.message}</p>}
    {test.data && <p role="status" className="flex items-center gap-2 text-xs">{test.data.aiUsed && <CheckCircle2 className="h-4 w-4 text-primary"/>}{test.data.aiUsed ? "Provider test completed successfully." : test.data.text}</p>}
  </section>;
}
