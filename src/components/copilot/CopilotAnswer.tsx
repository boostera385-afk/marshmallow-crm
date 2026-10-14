import { useState } from "react";
import { Check, Copy, ExternalLink, FileText, MessageSquare, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CopilotResult } from "@/lib/copilot-api";
import CopilotLogo from "./CopilotLogo";

export default function CopilotAnswer({ result, expanded, pending, onOpen, onBrief, onDraft }: {
  result: CopilotResult; expanded: boolean; pending: boolean; onOpen: (href: string) => void;
  onBrief: (id: string) => void; onDraft: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [feedback, setFeedback] = useState<"helpful" | "not_helpful" | null>(null);
  const canCopy = result.source === "ai" || result.resolvedIntent === "report";
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-xs"><CopilotLogo className="h-6 w-6"/><span className="font-semibold">{result.title}</span><span className="ml-auto rounded-full border bg-muted/30 px-2 py-0.5 text-muted-foreground">{result.source === "ai" ? "AI answer" : result.aiUsed ? "CRM result · AI routing" : "CRM result · No AI"}</span></div>
    {!!result.filters?.length && <div aria-label="Interpreted filters" className="flex flex-wrap gap-1.5">{result.filters.map((filter) => <span key={filter.label} className="rounded-md border bg-primary/5 px-2 py-1 text-[11px]"><span className="text-muted-foreground">{filter.label}: </span>{filter.value}</span>)}</div>}
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">{result.text}</p>
    {!!result.metrics.length && <div className={`grid gap-2 ${expanded ? "grid-cols-3 max-sm:grid-cols-2" : "grid-cols-2"}`}>{result.metrics.map((metric) => <div key={metric.label} className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{metric.label}</p><p className="my-1 text-xl font-semibold tabular-nums">{metric.value === null ? "Unavailable" : metric.value.toLocaleString()}</p><p className="text-[11px] text-muted-foreground">{metric.description}</p></div>)}</div>}
    {result.cards.map((card) => {
      const lead = ["leads", "attention", "brief", "daily_brief"].includes(result.resolvedIntent);
      return <article key={card.id} className="min-w-0 space-y-3 rounded-xl border bg-background p-3 shadow-sm">
        <div><h3 className="break-words text-sm font-semibold">{card.title}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{card.subtitle}</p></div>
        {!!card.fields.length && <details open><summary className="cursor-pointer text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Saved details</summary><dl className="mt-2 space-y-2">{card.fields.filter((field) => field.value).map((field) => <div key={field.label} className="text-xs"><dt className="font-medium text-muted-foreground">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{field.value}</dd></div>)}</dl></details>}
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" className="gap-2" onClick={() => onOpen(card.href)}>Open {result.resolvedIntent === "technicians" ? "technician" : lead ? "lead" : "feature"}<ExternalLink className="h-3 w-3"/></Button>
        {lead && <><Button size="sm" variant="ghost" disabled={pending} onClick={() => onBrief(card.id)}><FileText className="mr-1 h-3.5 w-3.5"/>Lead brief</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => onDraft(card.id)}><MessageSquare className="mr-1 h-3.5 w-3.5"/>Draft follow-up</Button></>}</div>
      </article>;
    })}
    {!!result.links.length && <div aria-label="Verified workflow sources" className="flex flex-wrap gap-2">{result.links.map((link) => <Button key={link.href} size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal text-left" onClick={() => onOpen(link.href)}>{link.label}</Button>)}</div>}
    <div className="flex flex-wrap items-center gap-1 border-t pt-2">
      {canCopy && <Button size="sm" variant="ghost" aria-label="Copy answer" onClick={async () => { try { await navigator.clipboard.writeText(result.text); setCopied(true); setCopyError(""); } catch { setCopied(false); setCopyError("Clipboard unavailable. Select the answer and copy manually."); } }}>{copied ? <Check className="h-3.5 w-3.5"/> : <Copy className="h-3.5 w-3.5"/>}<span className="ml-1 text-xs">{copied ? "Copied" : "Copy answer"}</span></Button>}
      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Answer was helpful" aria-pressed={feedback === "helpful"} onClick={() => setFeedback(feedback === "helpful" ? null : "helpful")}><ThumbsUp className="h-3.5 w-3.5"/></Button>
      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Answer was not helpful" aria-pressed={feedback === "not_helpful"} onClick={() => setFeedback(feedback === "not_helpful" ? null : "not_helpful")}><ThumbsDown className="h-3.5 w-3.5"/></Button>
      <p className="ml-auto text-[10px] text-muted-foreground">Checked {new Date(result.refreshedAt).toLocaleTimeString()} · Review source for current details.</p>
    </div>
    {feedback && <p role="status" className="text-[11px] text-muted-foreground">Feedback marked for this session only; nothing was sent or saved.</p>}
    {copyError && <p role="status" className="text-xs text-destructive">{copyError}</p>}
  </div>;
}
