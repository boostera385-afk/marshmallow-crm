import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUp, CalendarDays, ChevronDown, ExternalLink, Loader2, Maximize2, Minimize2, RotateCcw, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { accessibleFeatures, askCopilot, businessDate, CopilotApiError, type CopilotAccess, type CopilotAsk, type CopilotResult } from "@/lib/copilot-api";
import { premiumEase } from "@/lib/motion";
import { LEAD_STATUS_CONFIG } from "@/types";
import { useAllowedStatuses } from "@/hooks/useAllowedStatuses";
import CopilotLogo from "./CopilotLogo";

type Mode = "ask" | "leads" | "technicians" | "report";
type Turn = { id: string; question: string; ask: CopilotAsk; result: CopilotResult };
const selectClass = "h-10 min-w-0 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function CopilotPanel({ access, onClose }: { access: CopilotAccess; onClose: () => void }) {
  const { profile } = useAuth();
  const { allowedStatuses } = useAllowedStatuses();
  const navigate = useNavigate();
  const client = useQueryClient();
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<Mode>("ask");
  const [message, setMessage] = useState("");
  const [allowAi, setAllowAi] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
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
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef<HTMLDivElement>(null);
  const flight = useRef<AbortController | null>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const features = accessibleFeatures(access);
  const canLeads = access.sections.includes("leads");
  const canTechs = access.role !== "cs_admin" && access.sections.includes("technicians");
  const modes: Mode[] = ["ask", ...(canLeads ? ["leads", "report"] as const : []), ...(canTechs ? ["technicians"] as const : [])];

  useEffect(() => () => { flight.current?.abort(); }, []);
  useEffect(() => {
    latest.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [turns, pending, reducedMotion]);
  useEffect(() => { if (!access.aiEnabled) setAllowAi(false); }, [access.aiEnabled]);

  const submit = async (question: string, overrides: Partial<CopilotAsk> = {}) => {
    if (flight.current || !question.trim()) return;
    const controller = new AbortController();
    flight.current = controller;
    // Follow-up filters must not overwrite the new explicit question or reuse
    // a paid request ID (especially when explaining an earlier CRM-only report).
    const ask: CopilotAsk = { ...overrides, action: "ask", message: question.trim(), requestId: crypto.randomUUID(), allowAi: (overrides.allowAi ?? allowAi) && access.aiEnabled };
    setError(""); setPending(true); setMessage("");
    try {
      const result = await askCopilot(ask, controller.signal);
      if (!controller.signal.aborted) setTurns((previous) => [...previous.slice(-7), { id: ask.requestId, question, ask, result }]);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof CopilotApiError && failure.status === 403) {
        setTurns([]); void client.invalidateQueries({ queryKey: ["copilot-access"] }); onClose();
      } else setError(failure instanceof Error ? failure.message : "Copilot is unavailable. Try a CRM lookup instead.");
    } finally {
      if (!controller.signal.aborted) { setPending(false); flight.current = null; }
    }
  };
  const openLink = (href: string) => { navigate(href); };
  const selectSearch = (next: Mode) => { setMode(next); input.current?.focus(); };
  const reset = () => { setTurns([]); setError(""); setMessage(""); input.current?.focus(); };

  return <Dialog.Root open modal={false} onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Content onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocus.current?.isConnected ? returnFocus.current : document.querySelector<HTMLButtonElement>("[data-copilot-launcher]");
          target?.focus();
        }}
        onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}
        className={`fixed bottom-3 right-3 top-[76px] z-40 flex max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl outline-none ${expanded ? "w-[880px]" : "w-[480px]"} max-sm:inset-0 max-sm:w-auto max-sm:max-w-none max-sm:rounded-none`}>
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <CopilotLogo className="h-10 w-10"/>
          <div className="min-w-0 flex-1"><Dialog.Title className="truncate text-sm font-semibold">Marshmallow Copilot</Dialog.Title><Dialog.Description className="text-xs text-muted-foreground">Your assistant for Marshmallow CRM</Dialog.Description></div>
          <Button size="icon" variant="ghost" aria-label="Start new Copilot conversation" disabled={pending} onClick={reset}><RotateCcw className="h-4 w-4"/></Button>
          <Button size="icon" variant="ghost" className="max-sm:hidden" aria-label={expanded ? "Collapse Copilot" : "Expand Copilot"} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 className="h-4 w-4"/> : <Maximize2 className="h-4 w-4"/>}</Button>
          <Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Close Copilot"><X className="h-4 w-4"/></Button></Dialog.Close>
        </div>
        <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary"/>Read-only · Your existing permissions apply<span className="ml-auto">{access.timezone.replace("America/", "")}</span></div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {!turns.length && <motion.div initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22, ease: premiumEase }} className="space-y-5 py-4">
            <div className="text-center"><CopilotLogo className="mx-auto mb-3 h-20 w-20"/><p className="text-sm text-muted-foreground">Hello{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}.</p><h2 className="mt-1 text-xl font-semibold tracking-tight">How may I help you today?</h2><p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">Find saved records, open features, or review your daily work.</p></div>
            <div className="grid grid-cols-2 gap-2">
              {canLeads && <><Button variant="outline" className="h-auto min-h-12 justify-start gap-2 whitespace-normal text-left" onClick={() => selectSearch("leads")}><Search className="h-4 w-4 shrink-0"/>Find a lead</Button><Button variant="outline" className="h-auto min-h-12 justify-start gap-2 whitespace-normal text-left" onClick={() => void submit("My daily report", { intent: "report" })}><CalendarDays className="h-4 w-4 shrink-0"/>My daily report</Button></>}
              {canTechs && <Button variant="outline" className="h-auto min-h-12 justify-start whitespace-normal text-left" onClick={() => selectSearch("technicians")}>Find a technician</Button>}
              {canLeads && <Button variant="outline" className="h-auto min-h-12 justify-start whitespace-normal text-left" onClick={() => void submit("What needs attention?", { intent: "attention" })}>Needs attention</Button>}
              <Button variant="outline" className="h-auto min-h-12 justify-start whitespace-normal text-left" onClick={() => void submit("Which features can I access?", { intent: "features" })}>Explore features</Button>
              {access.role === "admin" && <Button variant="outline" className="h-auto min-h-12 justify-start whitespace-normal text-left" onClick={() => void submit("Check system health", { intent: "health" })}>System health</Button>}
            </div>
            {features.some((f) => f.id === "followups") && <Button variant="link" className="h-auto whitespace-normal" onClick={() => openLink("/ai-assistance")}>Open my missed-call and unanswered-text worklist</Button>}
          </motion.div>}
          <div className="space-y-5">
            {turns.map((turn) => <section key={turn.id} aria-label={`Answer: ${turn.result.title}`} className="space-y-3">
              <p className="ml-8 break-words rounded-xl bg-primary/10 p-3 text-sm">{turn.question}</p>
              <div className="flex items-center gap-2 text-xs"><CopilotLogo className="h-6 w-6"/><span className="font-semibold">{turn.result.title}</span><span className="ml-auto rounded-full border px-2 py-0.5 text-muted-foreground">{turn.result.source === "ai" ? "AI answer" : turn.result.aiUsed ? "CRM result · AI routing" : "CRM result · No AI"}</span></div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{turn.result.text}</p>
              {!!turn.result.metrics.length && <div className={`grid gap-2 ${expanded ? "grid-cols-3 max-sm:grid-cols-2" : "grid-cols-2"}`}>{turn.result.metrics.map((metric) => <div key={metric.label} className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{metric.label}</p><p className="my-1 text-xl font-semibold">{metric.value === null ? "Unavailable" : metric.value.toLocaleString()}</p><p className="text-[11px] text-muted-foreground">{metric.description}</p></div>)}</div>}
              {turn.result.cards.map((card) => <article key={card.id} className="min-w-0 space-y-2 rounded-xl border bg-background/60 p-3"><h3 className="break-words text-sm font-semibold">{card.title}</h3><p className="break-words text-xs text-muted-foreground">{card.subtitle}</p>{!!card.fields.length && <dl className="space-y-1.5">{card.fields.filter((f) => f.value).map((field) => <div key={field.label} className="text-xs"><dt className="font-medium text-muted-foreground">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{field.value}</dd></div>)}</dl>}<Button size="sm" variant="outline" className="gap-2" onClick={() => openLink(card.href)}>Open {turn.result.resolvedIntent === "technicians" ? "technician" : turn.result.resolvedIntent === "leads" || turn.result.resolvedIntent === "attention" ? "lead" : "feature"}<ExternalLink className="h-3 w-3"/></Button></article>)}
              {!!turn.result.links.length && <div className="flex flex-wrap gap-2">{turn.result.links.map((link) => <Button key={link.href} size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal text-left" onClick={() => openLink(link.href)}>{link.label}</Button>)}</div>}
              {turn.result.hasMore && <Button variant="outline" disabled={pending} onClick={() => void submit(turn.ask.message, { ...turn.ask, requestId: crypto.randomUUID(), query: turn.result.searchQuery, intent: turn.result.resolvedIntent, offset: turn.result.nextOffset, allowAi: false })}>Show more results</Button>}
              {turn.result.resolvedIntent === "report" && access.aiEnabled && <Button size="sm" variant="ghost" className="gap-2" disabled={pending} onClick={() => void submit("Explain my work report", { ...turn.ask, requestId: crypto.randomUUID(), intent: "explain_report", allowAi: true })}><Sparkles className="h-3.5 w-3.5"/>Explain with AI (uses allowance)</Button>}
              <p className="text-[10px] text-muted-foreground">Checked {new Date(turn.result.refreshedAt).toLocaleTimeString()} · Open the source for current details.</p>
            </section>)}
            {pending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none"/>Preparing your answer…</p>}
            {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">{error}<p className="mt-2 text-xs">No automatic AI retry. You can submit a new CRM lookup below.</p></div>}
            <div ref={latest}/>
          </div>
        </div>
        <form className="shrink-0 space-y-3 border-t bg-background/80 p-4" onSubmit={(event) => {
          event.preventDefault();
          const question = message.trim() || (mode === "report" ? "My daily report" : mode === "leads" ? "Find leads" : mode === "technicians" ? "Find technicians" : "");
          void submit(question, { ...(mode !== "ask" ? { intent: mode } : {}),
            ...(mode === "leads" || mode === "technicians" ? { query: message, service, area, ...(mode === "leads" ? { status: status || undefined, date: date || undefined } : { active: active === "" ? null : active === "true" }) } : {}),
            ...(mode === "report" ? { start, end, scope } : {}) });
        }}>
          <div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="copilot-mode">Copilot mode</label><select id="copilot-mode" value={mode} onChange={(event) => setMode(event.target.value as Mode)} className={selectClass}>{modes.map((value) => <option key={value} value={value}>{({ ask: "Ask Copilot", leads: "Find leads", technicians: "Find technicians", report: "Work report" })[value]}</option>)}</select>{mode !== "ask" && <Button type="button" variant="ghost" size="sm" aria-expanded={filtersOpen} aria-controls="copilot-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Filters<ChevronDown className="ml-1 h-3.5 w-3.5"/></Button>}</div>
          {filtersOpen && mode !== "ask" && <div id="copilot-filters" className="grid grid-cols-2 gap-2">
            {mode === "report" ? <><label className="space-y-1 text-xs">Start date<Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)}/></label><label className="space-y-1 text-xs">End date<Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)}/></label>{access.role === "admin" && <select aria-label="Report scope" value={scope} onChange={(e) => setScope(e.target.value as "mine" | "team")} className={selectClass}><option value="mine">My work</option><option value="team">Team (Admin)</option></select>}</> : <><Input aria-label="Filter service" placeholder="Service" value={service} onChange={(e) => setService(e.target.value)} maxLength={200}/><Input aria-label="Filter area" placeholder="City / state / area" value={area} onChange={(e) => setArea(e.target.value)} maxLength={200}/>{mode === "leads" ? <><select aria-label="Filter lead status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All accessible statuses</option>{Object.entries(LEAD_STATUS_CONFIG).filter(([key]) => allowedStatuses.has(key)).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select>{access.sections.includes("schedule") && <Input type="date" aria-label="Scheduled date" value={date} onChange={(e) => setDate(e.target.value)}/>}</> : <select aria-label="Filter technician active status" value={active} onChange={(e) => setActive(e.target.value)} className={selectClass}><option value="">Any active status</option><option value="true">Active</option><option value="false">Inactive</option></select>}</>}
          </div>}
          <div className="flex gap-2"><Input ref={input} aria-label="Ask Marshmallow Copilot" placeholder={mode === "leads" ? "Job ID, customer name, phone…" : mode === "technicians" ? "Name, phone, service or area…" : "Ask Marshmallow…"} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1200} disabled={pending}/><Button type="submit" size="icon" aria-label="Send Copilot question" disabled={pending || (mode === "ask" && !message.trim())}><ArrowUp className="h-4 w-4"/></Button></div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>CRM lookups use no AI tokens.</span>{access.aiEnabled && <label className="flex items-center gap-2">AI fallback<Switch aria-label="Allow optional AI fallback" checked={allowAi} onCheckedChange={setAllowAi} disabled={pending}/></label>}</div>
          {access.aiEnabled && <p className="text-[10px] text-muted-foreground">AI sends your question to OpenAI; report explanations send only scoped counts. Do not include sensitive personal information. Chats are cleared when closed.</p>}
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
