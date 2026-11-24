import { AlertOctagon, AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";

/**
 * How urgent a notification looks in the bell and on the Notifications page.
 *
 * Notifications carry no stored severity, so it is derived from the fields they do carry
 * (event type, action-required flag) and their title/message wording. Display only: it
 * never changes what is stored, who can see it, or what counts as unread.
 *
 *   critical - something is wrong now (urgent job, failure, database load alert)
 *   warning  - someone needs to act (approval, update request, new schedule, sync behind)
 *   success  - a problem cleared or work finished (resolved, back to normal, confirmed)
 *   info     - everything else (assigned, shared, answered)
 */
export type NotificationSeverity = "critical" | "warning" | "success" | "info";

export interface SeverityInput {
  title?: string | null;
  message?: string | null;
  event_type?: string | null;
  event_kind?: string | null;
  action_required?: boolean | null;
}

// Checked in this order: "Database load back to normal" is success, not critical.
const SUCCESS = /\b(back to normal|resolved|approved|confirmed|is current again|recovered|completed)\b/;
const CRITICAL = /\b(urgent|failed|failure|database load|need to cancel|outage)\b/;
const WARNING = /\b(cancellation request|approval request|update request|requires?|new schedule|is behind|not current|incomplete|requote|quote updated|hold|needs? (review|attention|approval)|overdue|warning|delayed)\b/;

const SUCCESS_EVENTS = new Set(["update_resolved", "schedule_ready"]);
const WARNING_EVENTS = new Set(["update_requested", "schedule_new_needed"]);
const INFO_EVENTS = new Set(["update_answered"]);

export function notificationSeverity(n: SeverityInput): NotificationSeverity {
  const kind = n.event_kind ?? n.event_type ?? "";
  // The stored kind wins over the older schedule_ready label the server reports.
  if (WARNING_EVENTS.has(kind)) return "warning";
  if (SUCCESS_EVENTS.has(kind)) return "success";
  if (INFO_EVENTS.has(kind)) return "info";

  const text = `${n.title ?? ""} ${n.message ?? ""}`.toLowerCase();
  if (SUCCESS.test(text)) return "success";
  if (CRITICAL.test(text)) return "critical";
  if (n.action_required || WARNING.test(text)) return "warning";
  return "info";
}

export interface SeverityStyle {
  /** Short text so colour is never the only signal. */
  label: string;
  icon: LucideIcon;
  iconClass: string;
  /** Left edge colour of the row. */
  edgeClass: string;
  /** Row tint while unread. */
  unreadClass: string;
  chipClass: string;
}

export const NOTIFICATION_SEVERITY_STYLES: Record<NotificationSeverity, SeverityStyle> = {
  critical: {
    label: "Critical",
    icon: AlertOctagon,
    iconClass: "text-red-600 dark:text-red-400",
    edgeClass: "border-l-red-500",
    unreadClass: "bg-red-500/[0.06]",
    chipClass: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  warning: {
    label: "Needs action",
    icon: AlertTriangle,
    iconClass: "text-amber-600 dark:text-amber-400",
    edgeClass: "border-l-amber-500",
    unreadClass: "bg-amber-500/[0.06]",
    chipClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  success: {
    label: "Resolved",
    icon: CheckCircle2,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    edgeClass: "border-l-emerald-500",
    unreadClass: "bg-emerald-500/[0.05]",
    chipClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  info: {
    label: "Info",
    icon: Info,
    iconClass: "text-sky-600 dark:text-sky-400",
    edgeClass: "border-l-sky-500",
    unreadClass: "bg-sky-500/[0.05]",
    chipClass: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
};

export const notificationSeverityStyle = (n: SeverityInput) => NOTIFICATION_SEVERITY_STYLES[notificationSeverity(n)];
