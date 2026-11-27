import { Check, Loader2, PhoneCall, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useHoverOpen } from "@/hooks/useHoverOpen";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/date-time-format";
import {
  CONTACT_CHIP_TONE,
  CONTACT_LABELS,
  CONTACT_TYPES,
  describeFirstContact,
  splitContactType,
  summarizeContactEvents,
  type ContactType,
} from "@/lib/contact-direction";
import { useLeadContactEvents, useLeadFirstContact, useSetFirstContact } from "@/hooks/useLeadFirstContact";
import { ContactTypeIcon } from "./ContactTypeIcon";

/** Roles that may correct the first contact by hand (the RPC enforces the same rule). */
const EDIT_ROLES = new Set(["admin", "processor", "cs_admin", "customer_service"]);

interface FirstContactControlProps {
  leadId: string;
  /** True when the list already loaded this lead's value (no per-card request). */
  prefetched?: boolean;
  className?: string;
}

/**
 * Small chip on the lead card showing how the customer was first contacted. Opens a menu with the
 * contact history counts and, for staff, a manual override.
 */
export function FirstContactControl({ leadId, prefetched, className }: FirstContactControlProps) {
  const { user, role } = useAuth();
  // Hover shows the history menu (mouse); click / tap / Enter still work.
  const { open, onOpenChange, hoverProps, triggerProps, isHoverOpen } = useHoverOpen();
  const { data: firstContact, isPending } = useLeadFirstContact(leadId, { prefetched });
  const events = useLeadContactEvents(leadId, open);
  const setFirstContact = useSetFirstContact(leadId, user);
  const canEdit = EDIT_ROLES.has(role ?? "");

  const when = firstContact?.occurred_at ? formatDateTime(firstContact.occurred_at) : null;
  const title = describeFirstContact(firstContact, when);
  const direction = firstContact ? splitContactType(firstContact.contact).direction : null;

  const choose = (contact: ContactType | null) => {
    setFirstContact.mutate(contact, {
      onSuccess: () => toast.success(contact ? `First contact set to ${CONTACT_LABELS[contact]}` : "First contact now follows Quo"),
      onError: (error) => toast.error(error instanceof Error && error.message ? error.message : "Could not save the first contact"),
    });
  };

  // Pending = not loaded yet (by the list's batch or this card's own request).
  if (isPending) {
    return <span className={cn("inline-block h-5 w-7 animate-pulse rounded-full bg-muted/60", className)} aria-hidden="true" />;
  }

  const counts = events.data ? summarizeContactEvents(events.data) : null;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={title}
          {...hoverProps}
          onPointerDown={triggerProps.onPointerDown}
          onClick={(event) => {
            event.stopPropagation();
            triggerProps.onClick(event);
          }}
          className={cn(
            "inline-flex h-5 items-center gap-1 rounded-full border px-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            firstContact && direction
              ? CONTACT_CHIP_TONE[direction]
              : "border-dashed border-border/70 text-muted-foreground/70 hover:bg-muted/50",
            className,
          )}
        >
          {setFirstContact.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : firstContact ? (
            <ContactTypeIcon type={firstContact.contact} />
          ) : (
            <PhoneCall className="h-3 w-3" aria-hidden="true" />
          )}
          {firstContact?.source === "manual" && (
            <span className="text-[8px] font-bold uppercase tracking-wide text-muted-foreground" aria-hidden="true">M</span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-60"
        {...hoverProps}
        // Opened by hover: leave keyboard focus where it was.
        onCloseAutoFocus={(event) => { if (isHoverOpen()) event.preventDefault(); }}
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuLabel className="space-y-0.5">
          <span className="block text-xs font-semibold">First contact</span>
          <span className="block text-[11px] font-normal text-muted-foreground">
            {firstContact
              ? `${CONTACT_LABELS[firstContact.contact]} · ${firstContact.source === "manual" ? "set by hand" : "from Quo"}${when ? ` · ${when}` : ""}`
              : "Not recorded yet"}
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />
        <div className="grid grid-cols-2 gap-1 px-2 py-1.5" aria-label="Contact history">
          {CONTACT_TYPES.map((type) => (
            <span key={type} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ContactTypeIcon type={type} />
              <span className="truncate">{CONTACT_LABELS[type].replace("Incoming", "In").replace("Outgoing", "Out")}</span>
              <b className="ml-auto tabular-nums text-foreground">
                {events.isLoading ? "…" : events.isError ? "–" : counts?.[type] ?? 0}
              </b>
            </span>
          ))}
        </div>

        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Set by hand
            </DropdownMenuLabel>
            {CONTACT_TYPES.map((type) => {
              const selected = firstContact?.contact === type && firstContact.source === "manual";
              return (
                <DropdownMenuItem
                  key={type}
                  disabled={setFirstContact.isPending}
                  onSelect={() => choose(type)}
                  className="gap-2 text-xs"
                >
                  <ContactTypeIcon type={type} />
                  {CONTACT_LABELS[type]}
                  {selected && <Check className="ml-auto h-3.5 w-3.5" aria-label="Selected" />}
                </DropdownMenuItem>
              );
            })}
            {firstContact?.source === "manual" && (
              <DropdownMenuItem disabled={setFirstContact.isPending} onSelect={() => choose(null)} className="gap-2 text-xs">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Use Quo automatically
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Read-only cell for tables whose rows were prefetched with usePrefetchFirstContacts. */
export function FirstContactCell({ leadId }: { leadId: string }) {
  const { data: firstContact } = useLeadFirstContact(leadId, { prefetched: true });
  if (!firstContact) return <span className="text-muted-foreground">—</span>;
  const when = firstContact.occurred_at ? formatDateTime(firstContact.occurred_at) : null;
  return (
    <span className="inline-flex items-center gap-1" title={describeFirstContact(firstContact, when)}>
      <ContactTypeIcon type={firstContact.contact} className="h-4 w-4" />
      <span className="sr-only">{CONTACT_LABELS[firstContact.contact]}</span>
      {firstContact.source === "manual" && (
        <span className="text-[8px] font-bold uppercase text-muted-foreground" aria-hidden="true">M</span>
      )}
    </span>
  );
}

/**
 * Every call / text on the lead, as four icon counts plus the most recent one. Shown under the
 * lead on the full lead page; reads lead_contact_events (one small query).
 */
export function ContactHistoryStrip({ leadId, className }: { leadId: string; className?: string }) {
  const events = useLeadContactEvents(leadId, true);
  if (events.isLoading) {
    return <span className={cn("inline-block h-4 w-40 animate-pulse rounded-full bg-muted/60", className)} aria-hidden="true" />;
  }
  if (events.isError) return null;
  const list = events.data ?? [];
  if (list.length === 0) {
    return <span className={cn("text-[11px] text-muted-foreground", className)}>No calls or texts recorded yet</span>;
  }
  const counts = summarizeContactEvents(list);
  const last = list[0];
  const lastType = `${last.kind}_${last.direction}` as ContactType;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)} aria-label="Contact history">
      {CONTACT_TYPES.map((type) => (
        <span key={type} className="inline-flex items-center gap-1" title={`${counts[type]} × ${CONTACT_LABELS[type]}`}>
          <ContactTypeIcon type={type} />
          <b className="tabular-nums text-foreground">{counts[type]}</b>
          <span className="sr-only">{CONTACT_LABELS[type]}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        Last: <ContactTypeIcon type={lastType} /> {CONTACT_LABELS[lastType]} · {formatDateTime(last.occurred_at)}
      </span>
    </span>
  );
}
