import { useState } from "react";
import { CircleDashed, Loader2, MessageSquare, MessagesSquare, Phone, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date-time-format";
import { TechChatDialog } from "./TechChatDialog";
import {
  summarizeTechs,
  TECH_CONTACT_STATES,
  TECH_STATE_LABELS,
  TECH_SUMMARY_TONE_CLASS,
  TECH_VERDICT_LABELS,
  TECH_VERDICT_TONE_CLASS,
  type LeadTechContact,
  type TechContactState,
  type TechSummary,
} from "@/lib/tech-status";
import {
  canEditTechTracking,
  canSeeTechStatus,
  useCheckTechStatus,
  useLeadTechContacts,
  useSetTechContactState,
} from "@/hooks/useLeadTechContacts";

const STATE_ICONS: Record<TechContactState, typeof Phone> = {
  not_texted: CircleDashed,
  texted: MessageSquare,
  called: Phone,
};

export function TechSummaryBadge({ summary, className }: { summary: TechSummary; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        TECH_SUMMARY_TONE_CLASS[summary.tone],
        className,
      )}
    >
      <span className="truncate">{summary.label}</span>
    </span>
  );
}

function TechVerdictBadge({ tech }: { tech: LeadTechContact }) {
  if (tech.state === "not_texted" || !tech.verdict) return null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", TECH_VERDICT_TONE_CLASS[tech.verdict])}
      title={tech.verdict_reason ?? undefined}
    >
      {TECH_VERDICT_LABELS[tech.verdict]}
    </span>
  );
}

/** One tech: name, Not Texted / Texted / Called, and what the AI read from their chat. */
function TechRow({ tech, leadId, canEdit, onOpenChat }: {
  tech: LeadTechContact;
  leadId: string;
  canEdit: boolean;
  onOpenChat: (tech: LeadTechContact) => void;
}) {
  const { user } = useAuth();
  const setState = useSetTechContactState(leadId, user);
  const check = useCheckTechStatus();

  const change = (value: string) => {
    // Clicking the Texted / Called the tech already has opens their chat.
    if (!value || value === tech.state) {
      if (tech.state !== "not_texted") onOpenChat(tech);
      return;
    }
    const state = value as TechContactState;
    setState.mutate(
      { techNumber: tech.tech_number, state },
      {
        onSuccess: () => {
          toast.success(`Tech ${tech.tech_number} marked ${TECH_STATE_LABELS[state]}`);
          if (state === "not_texted") return;
          // The save already succeeded; an AI failure is reported on its own.
          check.mutate(
            { leadIds: [leadId] },
            { onError: (error) => toast.error(`Saved, but the AI check did not run: ${error.message}`) },
          );
        },
        onError: (error) => toast.error(error instanceof Error && error.message ? error.message : "Could not update the tech"),
      },
    );
  };

  return (
    <li className="space-y-1 rounded-lg border border-border/50 bg-background/40 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-full border border-sky-400/40 bg-sky-500/10 px-1.5 text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">
          Tech {tech.tech_number}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground" title={tech.phone ?? undefined}>
          {tech.name || "Unnamed"}
        </span>
        {(setState.isPending || check.isPending) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Saving" />}
        <TechVerdictBadge tech={tech} />
        {tech.phone && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onOpenChat(tech)}
            className="h-6 shrink-0 gap-1 px-1.5 text-[10px]"
            aria-label={`Open chat with Tech ${tech.tech_number}${tech.name ? `, ${tech.name}` : ""}`}
            title="See what we sent and what the tech replied"
          >
            <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Chat
          </Button>
        )}
      </div>

      <ToggleGroup
        type="single"
        size="sm"
        value={tech.state}
        onValueChange={change}
        disabled={!canEdit || setState.isPending}
        aria-label={`Tech ${tech.tech_number} contact`}
        className="justify-start gap-1"
      >
        {TECH_CONTACT_STATES.map((state) => {
          const Icon = STATE_ICONS[state];
          return (
            <ToggleGroupItem
              key={state}
              value={state}
              className="h-6 gap-1 rounded-md border border-border/60 px-2 text-[10px] data-[state=on]:border-primary/50 data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
              {TECH_STATE_LABELS[state]}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      {tech.processor_note && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          <span className="font-semibold text-foreground/80">Note:</span> {tech.processor_note}
        </p>
      )}
      {tech.state !== "not_texted" && (tech.verdict_reason || tech.evidence_quote) && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {tech.verdict_reason}
          {tech.evidence_quote && (
            <span className="mt-0.5 block italic text-foreground/80">
              “{tech.evidence_quote}”
              {tech.evidence_source && (
                <span className="ml-1 not-italic text-[10px] text-muted-foreground">
                  ({tech.evidence_source === "processor_note" ? "processor note" : "tech's text"})
                </span>
              )}
            </span>
          )}
        </p>
      )}
      {tech.state !== "not_texted" && (
        <p className="text-[10px] text-muted-foreground/70">
          {tech.state_source === "note" ? "From the note" : tech.state_source === "manual" ? "Set here" : null}
          {tech.state_source && tech.verdict_checked_at ? " · " : null}
          {tech.verdict_checked_at ? `AI checked ${formatDateTime(tech.verdict_checked_at)}` : tech.state_source ? " · AI check pending" : null}
        </p>
      )}
    </li>
  );
}

function RecheckButton({ leadId, hasContacted }: { leadId: string; hasContacted: boolean }) {
  const check = useCheckTechStatus();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={!hasContacted || check.isPending}
      title={hasContacted ? "Re-read the techs' Quo chats now" : "Mark a tech Texted or Called first"}
      onClick={() =>
        check.mutate(
          { leadIds: [leadId], force: true },
          {
            onSuccess: (result) => toast.success(result?.warning ?? "Tech chats checked"),
            onError: (error) => toast.error(error.message),
          },
        )
      }
      className="h-6 gap-1 px-2 text-[10px]"
    >
      <RefreshCw className={cn("h-3 w-3", check.isPending && "animate-spin")} aria-hidden="true" />
      Re-check
    </Button>
  );
}

function TechList({ leadId, techs, onOpenChat }: {
  leadId: string;
  techs: LeadTechContact[];
  onOpenChat: (tech: LeadTechContact) => void;
}) {
  const { role } = useAuth();
  const canEdit = canEditTechTracking(role);
  if (techs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/60 px-2 py-2 text-[11px] text-muted-foreground">
        No tech added yet. Add techs in the Processor notes, then mark each one Texted or Called to start AI tracking.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {techs.map((tech) => (
        <TechRow key={tech.id} tech={tech} leadId={leadId} canEdit={canEdit} onOpenChat={onOpenChat} />
      ))}
    </ul>
  );
}

/** Top of the Processor notes thread: the job's tech status and every tech's contact state. */
export function TechTrackingPanel({ leadId }: { leadId: string }) {
  const { role, canAccess } = useAuth();
  const visible = canSeeTechStatus(role, canAccess);
  const { data: techs, isLoading, isError } = useLeadTechContacts(leadId, visible);
  const [chatTechNumber, setChatTechNumber] = useState<number | null>(null);
  if (!visible) return null;

  const list = techs ?? [];
  const summary = summarizeTechs(list);
  const chatTech = list.find((tech) => tech.tech_number === chatTechNumber) ?? null;

  return (
    <section aria-label="Tech tracking" className="space-y-1.5 border-b border-border/35 p-2">
      <div className="flex items-center gap-2">
        <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-foreground">Tech status</span>
        {isLoading ? (
          <span className="h-4 w-24 animate-pulse rounded-full bg-muted/60" aria-hidden="true" />
        ) : (
          <TechSummaryBadge summary={summary} className="min-w-0" />
        )}
        <span className="ml-auto" />
        <RecheckButton leadId={leadId} hasContacted={summary.contacted > 0} />
      </div>
      {isError ? (
        <p className="text-[11px] text-destructive">Could not load tech tracking. It will retry automatically.</p>
      ) : (
        !isLoading && <TechList leadId={leadId} techs={list} onOpenChat={(tech) => setChatTechNumber(tech.tech_number)} />
      )}
      <TechChatDialog leadId={leadId} tech={chatTech} onOpenChange={(open) => { if (!open) setChatTechNumber(null); }} />
    </section>
  );
}

/** Urgent table cell: summary badge, opening every tech's detail. */
export function TechStatusCell({ leadId, techs }: { leadId: string; techs: LeadTechContact[] | undefined }) {
  const [open, setOpen] = useState(false);
  const [chatTechNumber, setChatTechNumber] = useState<number | null>(null);
  if (!techs) return <span className="text-muted-foreground">—</span>;
  const summary = summarizeTechs(techs);
  const chatTech = techs.find((tech) => tech.tech_number === chatTechNumber) ?? null;
  // The chat opens as its own dialog; the popover closes so the two never overlap.
  const openChat = (tech: LeadTechContact) => {
    setOpen(false);
    setChatTechNumber(tech.tech_number);
  };
  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="max-w-full rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Tech status: ${summary.label}. Show techs`}
          title={summary.label}
        >
          <TechSummaryBadge summary={summary} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-3" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">Techs for this job</span>
          <span className="ml-auto" />
          <RecheckButton leadId={leadId} hasContacted={summary.contacted > 0} />
        </div>
        <div className="max-h-80 overflow-y-auto pr-1">
          <TechList leadId={leadId} techs={techs} onOpenChat={openChat} />
        </div>
      </PopoverContent>
    </Popover>
    <TechChatDialog leadId={leadId} tech={chatTech} onOpenChange={(next) => { if (!next) setChatTechNumber(null); }} />
    </>
  );
}
