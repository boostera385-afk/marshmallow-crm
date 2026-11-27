import { useEffect, useMemo, useRef } from "react";
import { Image as ImageIcon, Loader2, Phone, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLeadTechChat } from "@/hooks/useLeadTechContacts";
import { formatDateTime } from "@/lib/date-time-format";
import { isEvidenceMessage, techChatItems, type TechChatItem } from "@/lib/tech-chat";
import { TECH_VERDICT_LABELS, TECH_VERDICT_TONE_CLASS, type LeadTechContact } from "@/lib/tech-status";
import { cn } from "@/lib/utils";

function CallLine({ item }: { item: Extract<TechChatItem, { type: "call" }> }) {
  return (
    <li className="mx-auto w-full max-w-[90%] rounded-lg border border-dashed border-border/60 bg-muted/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="font-medium text-foreground/80">{item.label}</span>
        <span className="ml-auto shrink-0 text-[10px]">{item.at ? formatDateTime(item.at) : ""}</span>
      </div>
      {item.detail && <p className="mt-1 line-clamp-4 whitespace-pre-line" title={item.detail}>{item.detail}</p>}
    </li>
  );
}

function Bubble({ item, techName, evidence }: { item: Extract<TechChatItem, { type: "text" }>; techName: string; evidence: boolean }) {
  return (
    <li className={cn("flex flex-col gap-0.5", item.fromUs ? "items-end" : "items-start")}>
      <span className="px-1 text-[10px] text-muted-foreground">
        {item.fromUs ? "Our team" : techName}
        {item.at ? ` · ${formatDateTime(item.at)}` : ""}
      </span>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[12px] leading-snug",
          item.fromUs ? "rounded-br-sm bg-primary/15 text-foreground" : "rounded-bl-sm bg-muted text-foreground",
          evidence && "ring-2 ring-amber-400/70",
        )}
      >
        {item.text || <span className="italic text-muted-foreground">(no text)</span>}
        {item.hasMedia && (
          <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <ImageIcon className="h-3 w-3" aria-hidden="true" /> Photo or file (open in Quo)
          </span>
        )}
      </div>
      {evidence && (
        <span className="flex items-center gap-1 px-1 text-[10px] font-medium text-amber-600 dark:text-amber-300">
          <Sparkles className="h-3 w-3" aria-hidden="true" /> The AI read this message
        </span>
      )}
    </li>
  );
}

/**
 * Read-only view of one tech's saved Quo chat for this job: what our team sent (usually the
 * Check Template), the tech's replies and calls. Nothing is sent from here.
 */
export function TechChatDialog({ leadId, tech, onOpenChange }: {
  leadId: string;
  tech: LeadTechContact | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError, isFetching, refetch } = useLeadTechChat(leadId, tech?.tech_number ?? null);
  const items = useMemo(() => techChatItems(data ?? []), [data]);
  const endRef = useRef<HTMLLIElement>(null);
  const techName = tech?.name || (tech ? `Tech ${tech.tech_number}` : "Tech");

  // Open at the newest message, like a chat app.
  useEffect(() => {
    if (items.length) endRef.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  return (
    <Dialog open={tech !== null} onOpenChange={onOpenChange}>
      {/* Above the lead card's notes popover (z-100), like ImageLightbox; solid so the thread
          behind never shows through. */}
      <DialogContent
        overlayClassName="z-[110]"
        className="z-[110] flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg flex-col gap-3 bg-background/95 p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <span>Chat with {techName}</span>
            {tech && tech.state !== "not_texted" && tech.verdict && (
              <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", TECH_VERDICT_TONE_CLASS[tech.verdict])}>
                {TECH_VERDICT_LABELS[tech.verdict]}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Tech {tech?.tech_number}{tech?.phone ? ` · ${tech.phone}` : ""} · saved Quo messages for this job. Reply in Quo.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[160px] flex-1 overflow-y-auto rounded-lg border border-border/50 bg-background/40 p-3" aria-live="polite">
          {!tech?.phone ? (
            <p className="py-8 text-center text-xs text-muted-foreground">This tech's line in the notes has no phone number, so there is no chat to show.</p>
          ) : isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading chat…
            </div>
          ) : isError ? (
            <div className="space-y-2 py-8 text-center text-xs">
              <p className="text-destructive">Could not load the chat.</p>
              <Button size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No saved Quo messages with this tech for this job yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {items.map((item) =>
                item.type === "call"
                  ? <CallLine key={item.id} item={item} />
                  : <Bubble key={item.id} item={item} techName={techName} evidence={isEvidenceMessage(item, tech?.evidence_quote)} />,
              )}
              <li ref={endRef} aria-hidden="true" />
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span>Read-only · updates every 30 seconds</span>
          <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px]" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} aria-hidden="true" /> Refresh
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
