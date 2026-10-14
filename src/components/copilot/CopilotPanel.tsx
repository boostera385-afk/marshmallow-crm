import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUp, CalendarDays, ChevronDown, Loader2, Maximize2, Minimize2, Minus, RotateCcw, Search, ShieldCheck, Sparkles, Square, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { accessibleFeatures, askCopilot, businessDate, CopilotApiError, type CopilotAccess, type CopilotAsk, type CopilotResult } from "@/lib/copilot-api";
import { premiumEase } from "@/lib/motion";
import { LEAD_STATUS_CONFIG } from "@/types";
import { useAllowedStatuses } from "@/hooks/useAllowedStatuses";
import CopilotLogo from "./CopilotLogo";
import CopilotAnswer from "./CopilotAnswer";

type Mode = "ask" | "leads" | "technicians" | "report";
type Turn = { id: string; question: string; ask: CopilotAsk; result: CopilotResult };
const selectClass = "h-10 min-w-0 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function CopilotPanel({ access, minimized, onMinimizedChange, onClose }: {
  access: CopilotAccess; minimized: boolean; onMinimizedChange: (value: boolean) => void; onClose: () => void;
}) {
  const { profile } = useAuth();
  const { allowedStatuses } = useAllowedStatuses();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<Mode>("ask");
  const [message, setMessage] = useState("");
  const [allowAi, setAllowAi] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [failedAsk, setFailedAsk] = useState<CopilotAsk | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | undefined>();
  const [consentNotice, setConsentNotice] = useState("");
  const [errorRequestId, setErrorRequestId] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [service, setService] = useState("");
  const [area, setArea] = useState("");
  const [active, setActive] = useState("");
  const [date, setDate] = useState("");
  const today = businessDate(new Date(), access.timezone);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<HTMLDivElement>(null);
  const flight = useRef<AbortController | null>(null);
  const currentAsk = useRef<CopilotAsk | null>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const features = accessibleFeatures(access);
  const routeLeadId = location.pathname.match(/^\/leads\/([0-9a-f-]{36})$/i)?.[1];
  const selectedLeadLabel = turns.flatMap((turn) => turn.result.cards).find((card) => card.id === selectedLeadId)?.title ?? selectedLeadId;
  const canLeads = access.sections.includes("leads");
  const canTechs = access.role !== "cs_admin" && access.sections.includes("technicians");
  const modes: Mode[] = ["ask", ...(canLeads ? ["leads", "report"] as const : []), ...(canTechs ? ["technicians"] as const : [])];

  useEffect(() => () => { flight.current?.abort(); }, []);
  useEffect(() => {
    latest.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [turns, pending, reducedMotion, minimized]);
  useEffect(() => { if (!access.aiEnabled) setAllowAi(false); }, [access.aiEnabled]);
  const securityScope = `${access.role}:${[...access.sections].sort().join(",")}`;
  useEffect(() => { setTurns([]); setSelectedLeadId(undefined); setMessage(""); setMode("ask"); setError(""); setFailedAsk(null); setConsentNotice(""); flight.current?.abort(); flight.current = null; setPending(false); }, [securityScope]);

  const submit = async (question: string, overrides: Partial<CopilotAsk> = {}) => {
    if (flight.current || !question.trim()) return;
    const controller = new AbortController();
    flight.current = controller;
    // Follow-up filters must not overwrite the new explicit question or reuse
    // a paid request ID (especially when explaining an earlier CRM-only report).
    const previous = turns.at(-1)?.result.followup;
    const conversation = allowAi ? turns.filter((t) => t.result.source === "ai" && t.result.resolvedIntent !== "explain_report").slice(-3).map((t) => ({ question: t.question.slice(0, 500), answer: t.result.text.slice(0, 1000) })) : undefined;
    const ask: CopilotAsk = { previous, selectedLeadId, conversation, ...overrides, action: "ask", message: question.trim(), requestId: crypto.randomUUID(), allowAi: (overrides.allowAi ?? allowAi) && access.aiEnabled };
    currentAsk.current = ask;
    setError(""); setErrorRequestId(""); setFailedAsk(null); setPending(true); setMessage("");
    try {
      const result = await askCopilot(ask, controller.signal);
      if (!controller.signal.aborted) setTurns((previous) => [...previous.slice(-7), { id: ask.requestId, question, ask, result }]);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof CopilotApiError && failure.status === 403) {
        setTurns([]); void client.invalidateQueries({ queryKey: ["copilot-access"] }); onClose();
      } else { setError(failure instanceof Error ? failure.message : "Copilot is unavailable. Try a CRM lookup instead."); setMessage(question); setFailedAsk(ask); setErrorRequestId(failure instanceof CopilotApiError ? failure.requestId ?? ask.requestId : ask.requestId); }
    } finally {
      if (!controller.signal.aborted) { setPending(false); flight.current = null; }
    }
  };
  const openLink = (href: string) => { navigate(href); };
  const selectSearch = (next: Mode) => { setMode(next); input.current?.focus(); };
  const reset = () => { setTurns([]); setError(""); setMessage(""); setFailedAsk(null); setSelectedLeadId(undefined); setConsentNotice(""); input.current?.focus(); };
  const stopWaiting = () => { flight.current?.abort(); flight.current = null; setPending(false); setMessage(currentAsk.current?.message ?? ""); setError("Stopped waiting. A started AI request may still complete and consume allowance. No automatic retry was made."); };
  const draftForLead = (id: string) => { setSelectedLeadId(id); setMessage("Draft a professional follow-up message asking the customer to confirm the agreed next step. Use placeholders for unknown details."); setMode("ask"); setConsentNotice("Drafting sends only the selected lead’s service/status, your question and recent AI turns to OpenAI after you enable AI-assisted mode. No message is sent to the customer."); input.current?.focus(); };

  return <>
    {minimized && <div aria-label="Minimized Copilot" className="fixed bottom-3 right-3 z-40 flex max-w-[calc(100vw-24px)] items-center gap-1 rounded-xl border bg-card p-1 shadow-lg">
      <Button variant="ghost" className="min-h-10 gap-2" aria-label="Restore Marshmallow Copilot" aria-expanded={false} onClick={() => onMinimizedChange(false)}>
        <CopilotLogo className="h-7 w-7"/><span>Copilot</span>{pending ? <Loader2 aria-label="Preparing answer" className="h-4 w-4 animate-spin motion-reduce:animate-none"/> : <Maximize2 className="h-4 w-4"/>}
      </Button>
      <Button variant="ghost" size="icon" aria-label="Close minimized Copilot" onClick={onClose}><X className="h-4 w-4"/></Button>
    </div>}
    <Dialog.Root open={!minimized} modal={false} onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Content onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocus.current?.isConnected ? returnFocus.current : document.querySelector<HTMLButtonElement>("[data-copilot-launcher]");
          target?.focus();
        }}
        onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}
        className={`fixed bottom-3 right-3 top-[76px] z-40 flex max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl outline-none ${expanded ? "w-[1100px]" : "w-[480px]"} max-sm:inset-0 max-sm:w-auto max-sm:max-w-none max-sm:rounded-none`}>
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <CopilotLogo className="h-10 w-10"/>
          <div className="min-w-0 flex-1"><Dialog.Title className="truncate text-sm font-semibold">Marshmallow Copilot</Dialog.Title><Dialog.Description className="text-xs text-muted-foreground">{expanded ? "Operational workspace · Saved sources, clear next steps" : "Your operational assistant"}</Dialog.Description></div>
           <Button size="icon" variant="ghost" aria-label="Start new Copilot conversation" disabled={pending} onClick={reset}><RotateCcw className="h-4 w-4"/></Button>
           <Button size="icon" variant="ghost" aria-label="Minimize Copilot" title="Minimize and keep this session" onClick={() => onMinimizedChange(true)}><Minus className="h-4 w-4"/></Button>
          <Button size="icon" variant="ghost" className="max-sm:hidden" aria-label={expanded ? "Collapse Copilot" : "Expand Copilot"} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 className="h-4 w-4"/> : <Maximize2 className="h-4 w-4"/>}</Button>
          <Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Close Copilot"><X className="h-4 w-4"/></Button></Dialog.Close>
        </div>
        <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary"/>Read-only · Your existing permissions apply<span className="ml-auto">{access.timezone.replace("America/", "")}</span></div>
        <div className="flex min-h-0 flex-1">
        {expanded && <aside aria-label="Copilot workspace tools" className="hidden w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-muted/20 p-3 md:flex">
          <div><p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your workspace</p><div className="space-y-1">
            {canLeads && <><Button className="w-full justify-start" size="sm" variant="ghost" disabled={pending} onClick={() => void submit("My daily work brief", { intent: "daily_brief", allowAi: false })}>Daily work brief</Button><Button className="w-full justify-start" size="sm" variant="ghost" disabled={pending} onClick={() => selectSearch("leads")}>Find leads</Button><Button className="w-full justify-start" size="sm" variant="ghost" disabled={pending} onClick={() => { setMode("report"); setFiltersOpen(true); }}>Work report</Button></>}
            {canTechs && <Button className="w-full justify-start" size="sm" variant="ghost" disabled={pending} onClick={() => selectSearch("technicians")}>Find technicians</Button>}
          </div></div>
          <div><p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Workflow sources</p><div className="space-y-1">{features.map((feature) => <Button key={feature.id} size="sm" variant="ghost" className="h-auto min-h-8 w-full justify-start whitespace-normal text-left text-xs" onClick={() => openLink(feature.href)}>{feature.label}</Button>)}</div></div>
          <p className="mt-auto rounded-lg border p-2 text-[11px] leading-relaxed text-muted-foreground">Only your permitted workflows are shown. Approval and sending happen in the source workflow, never in Copilot.</p>
        </aside>}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {!turns.length && <motion.div initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22, ease: premiumEase }} className="space-y-5 py-4">
            <div className="text-center"><CopilotLogo className="mx-auto mb-3 h-20 w-20"/><p className="text-sm text-muted-foreground">Hello{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}.</p><h2 className="mt-1 text-xl font-semibold tracking-tight">How may I help you today?</h2><p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">Find saved records, open features, or review your daily work.</p></div>
            <div className="grid grid-cols-2 gap-2">
              {canLeads && <><Button variant="outline" className="h-auto min-h-12 justify-start gap-2 whitespace-normal text-left" onClick={() => selectSearch("leads")}><Search className="h-4 w-4 shrink-0"/>Find a lead</Button><Button variant="outline" className="h-auto min-h-12 justify-start gap-2 whitespace-normal text-left" onClick={() => void submit("My daily report", { intent: "report" })}><CalendarDays className="h-4 w-4 shrink-0"/>My daily report</Button></>}
              {canTechs && <Button variant="outline" className="h-auto min-h-12 justify-start whitespace-normal text-left" onClick={() => selectSearch("technicians")}>Find a technician</Button>}
              {canLeads && <><Button variant="outline" className="h-auto min-h-12 justify-start whitespace-normal text-left" onClick={() => void submit("What needs attention?", { intent: "attention" })}>Needs attention</Button><Button variant="outline" className="h-auto min-h-12 justify-start whitespace-normal text-left" onClick={() => void submit("My daily work brief", { intent: "daily_brief" })}>Daily work brief</Button></>}
              <Button variant="outline" className="h-auto min-h-12 justify-start whitespace-normal text-left" onClick={() => void submit("Which features can I access?", { intent: "features" })}>Explore features</Button>
              {access.role === "admin" && <Button variant="outline" className="h-auto min-h-12 justify-start whitespace-normal text-left" onClick={() => void submit("Check system health", { intent: "health" })}>System health</Button>}
            </div>
            {features.some((f) => f.id === "followups") && <Button variant="link" className="h-auto whitespace-normal" onClick={() => openLink("/ai-assistance")}>Open my missed-call and unanswered-text worklist</Button>}
          </motion.div>}
          <div className="space-y-5">
            {turns.map((turn) => <section key={turn.id} aria-label={`Answer: ${turn.result.title}`} className="space-y-3">
              <p className="ml-8 break-words rounded-xl bg-primary/10 p-3 text-sm">{turn.question}</p>
               <CopilotAnswer result={turn.result} expanded={expanded} pending={pending} onOpen={openLink} onBrief={(id) => { setSelectedLeadId(id); void submit("Show selected lead brief", { selectedLeadId: id, intent: "brief", allowAi: false }); }} onDraft={draftForLead}/>
               {turn.result.followup && <Button size="sm" variant="ghost" disabled={pending} onClick={() => { const f = turn.result.followup!; setMode(f.intent); setService(f.service ?? ""); setArea(f.area ?? ""); setStatus(f.status ?? ""); setActive(f.active === true ? "true" : f.active === false ? "false" : ""); setDate(f.date ?? ""); setStart(f.start ?? today); setEnd(f.end ?? today); setScope(f.scope ?? "mine"); setMessage(f.query ?? ""); setFiltersOpen(true); input.current?.focus(); }}>Edit interpreted filters</Button>}
               {turn.result.hasMore && <Button variant="outline" disabled={pending} onClick={() => void submit(turn.ask.message, { ...turn.ask, ...turn.result.followup, requestId: crypto.randomUUID(), query: turn.result.searchQuery, intent: turn.result.resolvedIntent, offset: turn.result.nextOffset, allowAi: false })}>Show more results</Button>}
               {turn.result.resolvedIntent === "report" && access.aiEnabled && <Button size="sm" variant="ghost" className="gap-2" disabled={pending} onClick={() => void submit("Explain my work report", { ...turn.ask, ...turn.result.followup, requestId: crypto.randomUUID(), conversation: undefined, intent: "explain_report", allowAi: true })}><Sparkles className="h-3.5 w-3.5"/>Explain with AI (uses allowance)</Button>}
            </section>)}
             {pending && <div className="flex items-center justify-between gap-2"><p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none"/>{allowAi ? "Preparing an answer · checking permissions and AI allowance…" : "Checking permissions and preparing CRM results…"}</p><Button size="sm" variant="ghost" onClick={stopWaiting}><Square className="mr-1 h-3 w-3"/>Stop waiting</Button></div>}
             {error && <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">{error}<p className="text-xs">No automatic AI retry. Your question is kept below for editing.</p>{errorRequestId && <p className="break-all text-[10px] text-muted-foreground">Request: {errorRequestId}</p>}{failedAsk && <Button size="sm" variant="outline" disabled={pending} onClick={() => void submit(failedAsk.message, { ...failedAsk, conversation: allowAi ? failedAsk.conversation : undefined, allowAi })}>Retry manually{failedAsk.allowAi ? " (may use allowance)" : ""}</Button>}</div>}
            <div ref={latest}/>
         </div>
        </div>
        </div>
        <form className="shrink-0 space-y-3 border-t bg-background/80 p-4" onSubmit={(event) => {
          event.preventDefault();
           const question = message.trim() || (mode === "report" ? "My daily report" : mode === "leads" ? "Find leads" : mode === "technicians" ? "Find technicians" : "");
           const refinement = /^(only|just|instead|make that|what about|and|explain that|explain it)\b/i.test(question);
           void submit(question, refinement ? {} : { ...(mode !== "ask" ? { intent: mode } : {}),
             ...(mode === "leads" || mode === "technicians" ? { query: message, service, area, ...(mode === "leads" ? { status: status || undefined, date: date || undefined } : { active: active === "" ? null : active === "true" }) } : {}),
             ...(mode === "report" ? { start, end, scope } : {}) });
        }}>
          <div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="copilot-mode">Copilot mode</label><select id="copilot-mode" value={mode} onChange={(event) => setMode(event.target.value as Mode)} className={selectClass}>{modes.map((value) => <option key={value} value={value}>{({ ask: "Ask Copilot", leads: "Find leads", technicians: "Find technicians", report: "Work report" })[value]}</option>)}</select>{mode !== "ask" && <Button type="button" variant="ghost" size="sm" aria-expanded={filtersOpen} aria-controls="copilot-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Filters<ChevronDown className="ml-1 h-3.5 w-3.5"/></Button>}</div>
          {canLeads && routeLeadId && !selectedLeadId && <Button type="button" size="sm" variant="outline" onClick={() => { setSelectedLeadId(routeLeadId); void submit("Show current lead brief", { selectedLeadId: routeLeadId, intent: "brief", allowAi: false }); }}>Use current lead</Button>}
           {selectedLeadId && <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-2 py-1 text-xs"><span className="min-w-0 break-words">Selected saved lead · {selectedLeadLabel} · permissions rechecked</span><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setSelectedLeadId(undefined); setConsentNotice(""); setFailedAsk(null); }}>Clear context</Button></div>}
          {filtersOpen && mode !== "ask" && <div id="copilot-filters" className="grid grid-cols-2 gap-2">
            {mode === "report" ? <><label className="space-y-1 text-xs">Start date<Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)}/></label><label className="space-y-1 text-xs">End date<Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)}/></label>{access.role === "admin" && <select aria-label="Report scope" value={scope} onChange={(e) => setScope(e.target.value as "mine" | "team")} className={selectClass}><option value="mine">My work</option><option value="team">Team (Admin)</option></select>}</> : <><Input aria-label="Filter service" placeholder="Service" value={service} onChange={(e) => setService(e.target.value)} maxLength={200}/><Input aria-label="Filter area" placeholder="City / state / area" value={area} onChange={(e) => setArea(e.target.value)} maxLength={200}/>{mode === "leads" ? <><select aria-label="Filter lead status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All accessible statuses</option>{Object.entries(LEAD_STATUS_CONFIG).filter(([key]) => allowedStatuses.has(key)).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select>{access.sections.includes("schedule") && <Input type="date" aria-label="Scheduled date" value={date} onChange={(e) => setDate(e.target.value)}/>}</> : <select aria-label="Filter technician active status" value={active} onChange={(e) => setActive(e.target.value)} className={selectClass}><option value="">Any active status</option><option value="true">Active</option><option value="false">Inactive</option></select>}</>}
          </div>}
          {consentNotice && <p className="text-xs text-muted-foreground">{consentNotice}</p>}
          <div className="flex items-end gap-2"><Textarea ref={input} className="max-h-32 min-h-[68px] resize-none rounded-xl" aria-label="Ask Marshmallow Copilot" placeholder={mode === "leads" ? "Job ID, customer name, phone…" : mode === "technicians" ? "Name, phone, service or area…" : "Ask or refine: only tomorrow, only in Miami…"} value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} maxLength={1200} disabled={pending}/><Button type="submit" size="icon" className="mb-1 shrink-0 rounded-xl" aria-label="Send Copilot question" disabled={pending || (mode === "ask" && !message.trim())}><ArrowUp className="h-4 w-4"/></Button></div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>{allowAi ? "AI-assisted · allowance may apply" : "CRM tools · no AI tokens"}</span>{access.aiEnabled && <label className="flex items-center gap-2">AI-assisted mode<Switch aria-label="Allow AI-assisted mode" checked={allowAi} onCheckedChange={setAllowAi} disabled={pending}/></label>}</div>
          <p className="text-[10px] text-muted-foreground">{access.aiEnabled ? "AI-assisted consent sends your question and up to 3 recent AI turns to OpenAI. Report explanations send scoped counts; drafting sends selected service/status only. No automatic retry. " : "AI is disabled in saved Admin settings. CRM tools remain available. "}Do not enter sensitive personal information. Session clears on close. Enter to send · Shift+Enter for a new line.</p>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root></>;
}
