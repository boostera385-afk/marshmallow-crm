import type { LeadStatus, AppRole, Lead, Profile, ActivityLog, NavigationPermission } from "@/types";

export type { LeadStatus, AppRole, Lead, Profile, ActivityLog, NavigationPermission };

export const STATUS_LABELS: Record<LeadStatus, string> = {
  waiting_complete_details: "Waiting Complete Details",
  urgent_job: "Urgent Job",
  quote_sent_waiting: "Quote Sent - Waiting",
  post_visit_quote_sent_waiting: "Post Visit-Quote Sent-Waiting",
  post_visit_confirmation: "Post Visit Confirmation",
  activate_customer: "Activate Customer",
  quote_sent_need_follow_up: "Quote Sent - Need Follow Up",
  needs_quote: "Needs Quote",
  tech_making_quote: "Tech Making Quote",
  quote_change: "Quote Change",
  waiting_customer_response: "Waiting Customer Response",
  need_tech: "Need Tech",
  scheduled: "Scheduled",
  job_in_progress: "Job in Progress",
  needs_reschedule: "Needs Reschedule",
  job_done: "Job Done",
  payment_pending: "Payment Pending",
  cancellation_requested: "Cancellation Pending",
  cancelled: "Cancelled",
  paid: "Paid",
  partial_paid: "Partial Paid",
  payment_requested: "Paid Approval Pending",
  scammed: "Scammed",
  pending_to_send: "Quote Pending to Send",
  quote_updated: "Quote Updated",
};

export const STATUS_COLORS: Record<LeadStatus, string> = {
  waiting_complete_details: "bg-amber-100 text-amber-800 border-amber-200",
  urgent_job: "bg-red-100 text-red-800 border-red-200",
  quote_sent_waiting: "bg-blue-100 text-blue-800 border-blue-200",
  post_visit_quote_sent_waiting: "bg-slate-100 text-slate-800 border-slate-200",
  post_visit_confirmation: "bg-teal-100 text-teal-800 border-teal-200",
  activate_customer: "bg-emerald-100 text-emerald-800 border-emerald-200",
  quote_sent_need_follow_up: "bg-orange-100 text-orange-800 border-orange-200",
  needs_quote: "bg-purple-100 text-purple-800 border-purple-200",
  tech_making_quote: "bg-violet-100 text-violet-800 border-violet-200",
  quote_change: "bg-violet-100 text-violet-800 border-violet-200",
  waiting_customer_response: "bg-yellow-100 text-yellow-800 border-yellow-200",
  need_tech: "bg-indigo-100 text-indigo-800 border-indigo-200",
  scheduled: "bg-cyan-100 text-cyan-800 border-cyan-200",
  job_in_progress: "bg-sky-100 text-sky-800 border-sky-200",
  needs_reschedule: "bg-rose-100 text-rose-800 border-rose-200",
  job_done: "bg-emerald-100 text-emerald-800 border-emerald-200",
  payment_pending: "bg-lime-100 text-lime-800 border-lime-200",
  cancellation_requested: "bg-amber-100 text-amber-800 border-amber-200",
  cancelled: "bg-gray-100 text-gray-800 border-gray-200",
  paid: "bg-green-100 text-green-800 border-green-200",
  partial_paid: "bg-emerald-100 text-emerald-800 border-emerald-200",
  payment_requested: "bg-emerald-100 text-emerald-800 border-emerald-200",
  scammed: "bg-red-100 text-red-800 border-red-200",
  pending_to_send: "bg-amber-100 text-amber-800 border-amber-200",
  quote_updated: "bg-blue-100 text-blue-800 border-blue-200",
};

export const STATUS_DOT_COLORS: Record<LeadStatus, string> = {
  waiting_complete_details: "bg-amber-400",
  urgent_job: "bg-red-500",
  quote_sent_waiting: "bg-blue-400",
  post_visit_quote_sent_waiting: "bg-slate-400",
  post_visit_confirmation: "bg-teal-400",
  activate_customer: "bg-emerald-500",
  quote_sent_need_follow_up: "bg-orange-400",
  needs_quote: "bg-purple-400",
  tech_making_quote: "bg-violet-400",
  quote_change: "bg-violet-400",
  waiting_customer_response: "bg-yellow-400",
  need_tech: "bg-indigo-400",
  scheduled: "bg-cyan-400",
  job_in_progress: "bg-sky-400",
  needs_reschedule: "bg-rose-400",
  job_done: "bg-emerald-400",
  payment_pending: "bg-lime-400",
  cancellation_requested: "bg-amber-500",
  cancelled: "bg-gray-400",
  paid: "bg-green-500",
  partial_paid: "bg-emerald-500",
  payment_requested: "bg-emerald-500",
  scammed: "bg-red-500",
  pending_to_send: "bg-amber-400",
  quote_updated: "bg-blue-400",
};

export const ALL_LEAD_STATUSES: LeadStatus[] = [
  "waiting_complete_details",
  "urgent_job",
  "quote_sent_waiting",
  "post_visit_quote_sent_waiting",
  "post_visit_confirmation",
  "activate_customer",
  "quote_sent_need_follow_up",
  "needs_quote",
  "tech_making_quote",
  "quote_change",
  "waiting_customer_response",
  "need_tech",
  "scheduled",
  "job_in_progress",
  "needs_reschedule",
  "job_done",
  "payment_pending",
  "cancellation_requested",
  "cancelled",
  "paid",
  "partial_paid",
  "payment_requested",
  "scammed",
  "pending_to_send",
  "quote_updated",
];

export const ALL_NAV_ITEMS = ["leads", "processor_board", "quo_monitor", "ai_assistance", "cancellation_requests", "payment_requests", "quote_approval_requests", "quote_pending_requests", "technician_change_requests", "urgent_review_requests", "cx_updates", "analytics", "settings", "activity_logs", "schedule", "areas", "map_view", "technicians", "optimization", "quick_chat", "tech_quick_chat"] as const;
export type NavItem = (typeof ALL_NAV_ITEMS)[number];

const LEAD_PRIORITY_RANK: Partial<Record<LeadStatus, number>> = {
  urgent_job: 1,
  need_tech: 2,
  cancelled: 99,
};

export function isLeadPinnedForUser(
  lead: { status: string; cs_tag?: string | null; created_by?: string | null; quote_requested_by?: string | null },
  userId?: string | null,
  userRole?: string | null,
): boolean {
  if (lead.status === "quote_updated") {
    return userRole === "cs_admin" || (Boolean(userId) && lead.quote_requested_by === userId);
  }
  if (lead.status !== "activate_customer") return false;
  return userRole === "cs_admin" || (Boolean(userId) && lead.created_by === userId);
}

function getLeadCreatedAtTime(lead: Pick<Lead, "created_at">) {
  const timestamp = new Date(lead.created_at).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

// When a lead became urgent. Falls back to created_at for leads that predate the
// urgent_at column (or were never urgent), so ordering stays well-defined.
function getLeadUrgentTime(lead: Pick<Lead, "created_at"> & { urgent_at?: string | null }) {
  const raw = lead.urgent_at ?? lead.created_at;
  const timestamp = new Date(raw).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

const TAG_ELIGIBLE_STATUSES: Partial<Record<LeadStatus, true>> = {
  waiting_complete_details: true,
  urgent_job: true,
  quote_sent_waiting: true,
  post_visit_quote_sent_waiting: true,
  post_visit_confirmation: true,
  activate_customer: true,
  quote_sent_need_follow_up: true,
  needs_quote: true,
  tech_making_quote: true,
  quote_change: true,
  waiting_customer_response: true,
  need_tech: true,
  needs_reschedule: true,
};

const TAG_PRIORITY_RANK: Record<string, number> = {
  ready_to_schedule: -4,
  confirmation_sent: -3,
  waiting_schedule_confirmation: -2,
  booked: -1,
};

function hasTagRank(tag: string | null | undefined): tag is string {
  return Boolean(tag) && TAG_PRIORITY_RANK[tag as string] !== undefined;
}

export function compareLeadDisplayPriority(
  a: Pick<Lead, "status" | "created_at"> & { cs_tag?: string | null; created_by?: string | null; quote_requested_by?: string | null; urgent_at?: string | null },
  b: Pick<Lead, "status" | "created_at"> & { cs_tag?: string | null; created_by?: string | null; quote_requested_by?: string | null; urgent_at?: string | null },
  userId?: string | null,
  userRole?: string | null,
) {
  const aPinned = isLeadPinnedForUser(a, userId, userRole);
  const bPinned = isLeadPinnedForUser(b, userId, userRole);

  // Only the scheduling tags carry an ordering rank. A tag without one (Incomplete details)
  // leaves the lead sorted by its status, rather than falling into the `?? 0` bucket - which
  // would have floated it above even Urgent Job.
  const aTagged = hasTagRank(a.cs_tag) && TAG_ELIGIBLE_STATUSES[a.status] === true;
  const bTagged = hasTagRank(b.cs_tag) && TAG_ELIGIBLE_STATUSES[b.status] === true;

  const rankA = aPinned
    ? -10
    : aTagged
      ? TAG_PRIORITY_RANK[a.cs_tag as string]
      : (LEAD_PRIORITY_RANK[a.status] ?? 10);

  const rankB = bPinned
    ? -10
    : bTagged
      ? TAG_PRIORITY_RANK[b.cs_tag as string]
      : (LEAD_PRIORITY_RANK[b.status] ?? 10);

  if (rankA !== rankB) return rankA - rankB;

  // Within the Urgent Job bucket, order by when each lead BECAME urgent (most
  // recent first), so a lead just flipped to urgent — even a long-existing one —
  // rises to the top like a brand-new urgent lead. Pinned/tag-ranked leads are in
  // other buckets, so their ordering is unaffected. All other buckets keep the
  // newest-created-first ordering.
  if (a.status === "urgent_job" && b.status === "urgent_job" && !aPinned && !bPinned) {
    const aUrgent = getLeadUrgentTime(a);
    const bUrgent = getLeadUrgentTime(b);
    if (aUrgent !== bUrgent) return bUrgent - aUrgent;
  }

  return getLeadCreatedAtTime(b) - getLeadCreatedAtTime(a);
}

const STATUS_CHANGE_ACCESS: Record<AppRole, LeadStatus[]> = {
  admin: [...ALL_LEAD_STATUSES.filter((s) => s !== "payment_requested" && s !== "cancellation_requested")],
  customer_service: [
    "need_tech",
    "urgent_job",
    "waiting_customer_response",
    "waiting_complete_details",
    "quote_sent_waiting",
    "quote_sent_need_follow_up",
    "needs_quote",
    "quote_change",
    "needs_reschedule",
    "cancelled",
    "partial_paid",
    "pending_to_send",
    "post_visit_confirmation",
  ],
  processor: [
    "post_visit_quote_sent_waiting",
    "post_visit_confirmation",
    "activate_customer",
    "tech_making_quote",
    "quote_change",
    "waiting_customer_response",
    "scheduled",
    "urgent_job",
    "job_in_progress",
    "paid",
    "payment_pending",
    "job_done",
    "needs_reschedule",
    "cancelled",
    "partial_paid",
    "scammed",
    "quote_updated",
  ],
  opr: [],
  cs_admin: [
    "need_tech",
    "urgent_job",
    "waiting_customer_response",
    "waiting_complete_details",
    "quote_sent_waiting",
    "post_visit_quote_sent_waiting",
    "post_visit_confirmation",
    "activate_customer",
    "quote_sent_need_follow_up",
    "needs_quote",
    "tech_making_quote",
    "quote_change",
    "scheduled",
    "job_in_progress",
    "needs_reschedule",
    "payment_pending",
    "cancelled",
    "pending_to_send",
  ],
  // opr_admin has the same (read-only) lead access as opr.
  opr_admin: [],
};

export function getChangeableStatuses(role?: string | null): LeadStatus[] {
  if (!role) return [];
  return STATUS_CHANGE_ACCESS[role as AppRole] ?? [];
}

export function canChangeStatus(role: string | null | undefined, status: LeadStatus): boolean {
  return getChangeableStatuses(role).includes(status);
}
