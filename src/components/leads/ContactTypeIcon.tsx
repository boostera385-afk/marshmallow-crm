import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import type { SVGProps } from "react";
import { cn } from "@/lib/utils";
import { CONTACT_LABELS, CONTACT_TONE, splitContactType, type ContactType } from "@/lib/contact-direction";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

/** Envelope with an arrow leaving it (up), drawn on lucide's 24px grid and stroke. */
function MailOutgoing({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <rect x="2" y="8" width="15" height="12" rx="2" />
      <path d="m2 10 7.5 5 7.5-5" />
      <path d="M20.5 12V2.5" />
      <path d="m17.5 5.5 3-3 3 3" />
    </svg>
  );
}

/** Envelope with an arrow coming into it (down). */
function MailIncoming({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <rect x="2" y="8" width="15" height="12" rx="2" />
      <path d="m2 10 7.5 5 7.5-5" />
      <path d="M20.5 2.5V12" />
      <path d="m17.5 9 3 3 3-3" />
    </svg>
  );
}

export function ContactTypeIcon({ type, className }: { type: ContactType; className?: string }) {
  const { kind, direction } = splitContactType(type);
  const Icon = kind === "call"
    ? direction === "out" ? PhoneOutgoing : PhoneIncoming
    : direction === "out" ? MailOutgoing : MailIncoming;
  return <Icon aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0", CONTACT_TONE[direction], className)} />;
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
