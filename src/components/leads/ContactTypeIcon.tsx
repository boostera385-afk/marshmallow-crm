import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CONTACT_LABELS, CONTACT_TONE, splitContactType, type ContactType } from "@/lib/contact-direction";

/**
 * Solid icons modelled on the reference: a filled handset or envelope (the channel) with an arrow
 * (out = up / away, in = down / toward). Colour carries the direction too: green = we reached
 * out, blue = the customer reached us. Drawn on a 24px grid; the envelope's flap is cut out in the
 * page background colour so it reads in light and dark themes.
 */
const HANDSET =
  "M21 16.4v2.9a1.9 1.9 0 0 1-2.1 1.9 18.9 18.9 0 0 1-8.2-2.9 18.6 18.6 0 0 1-5.7-5.7A18.9 18.9 0 0 1 2.1 4.3 1.9 1.9 0 0 1 4 2.2h2.9a1.9 1.9 0 0 1 1.9 1.6c.1.9.4 1.8.7 2.7a1.9 1.9 0 0 1-.4 2L7.8 9.7a15.2 15.2 0 0 0 5.7 5.7l1.2-1.2a1.9 1.9 0 0 1 2-.4c.9.3 1.8.6 2.7.7a1.9 1.9 0 0 1 1.6 1.9z";

function Svg({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

function Handset() {
  return <path d={HANDSET} fill="currentColor" strokeWidth={1.2} />;
}

function Envelope() {
  return (
    <>
      <rect x="1.5" y="8" width="15.5" height="12" rx="2" fill="currentColor" stroke="none" />
      <path d="m2.5 9.5 6.75 4.75L16 9.5" stroke="hsl(var(--background))" strokeWidth={1.6} />
    </>
  );
}

const ICONS: Record<ContactType, (className?: string) => ReactNode> = {
  call_out: (className) => (
    <Svg className={className}>
      <Handset />
      <path d="M16 8 22 2" />
      <path d="M17 2h5v5" />
    </Svg>
  ),
  call_in: (className) => (
    <Svg className={className}>
      <Handset />
      <path d="M22 2 16 8" />
      <path d="M16 3v5h5" />
    </Svg>
  ),
  msg_out: (className) => (
    <Svg className={className}>
      <Envelope />
      <path d="M20.5 12.5V2.5" strokeWidth={2.2} />
      <path d="m17.5 5.5 3-3 3 3" strokeWidth={2.2} />
    </Svg>
  ),
  msg_in: (className) => (
    <Svg className={className}>
      <Envelope />
      <path d="M20.5 2.5v10" strokeWidth={2.2} />
      <path d="m17.5 9.5 3 3 3-3" strokeWidth={2.2} />
    </Svg>
  ),
};

export function ContactTypeIcon({ type, className }: { type: ContactType; className?: string }) {
  const { direction } = splitContactType(type);
  return <>{ICONS[type](cn("h-3.5 w-3.5 shrink-0", CONTACT_TONE[direction], className))}</>;
}

/** Icon + optional short label, for tables and menus. */
export function ContactTypeLabel({ type, showLabel = true, className }: { type: ContactType; showLabel?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <ContactTypeIcon type={type} />
      {showLabel ? <span className="truncate">{CONTACT_LABELS[type]}</span> : <span className="sr-only">{CONTACT_LABELS[type]}</span>}
    </span>
  );
}
