import { STATUS_LABELS } from "@/lib/constants";
import type { LeadStatus } from "@/types";

/** One row from get_lead_department_breakdown(): leads created in range, by department and current status. */
export type DepartmentBreakdownRow = { department: string; status: string | null; lead_count: number | string };

/** Where a lead came from. "pending" = added in the last minute or two and not checked yet. */
export const DEPARTMENT_KEYS = ["ND", "FB", "SEO", "Other", "not_in_jellybean", "pending"] as const;
export type DepartmentKey = (typeof DEPARTMENT_KEYS)[number];
/** Departments shown in the report (pending is only a short note). */
export const REPORT_DEPARTMENTS = ["ND", "FB", "SEO", "Other", "not_in_jellybean"] as const;
export type ReportDepartment = (typeof REPORT_DEPARTMENTS)[number];
export const JELLYBEAN_DEPARTMENTS: readonly DepartmentKey[] = ["ND", "FB", "SEO", "Other"];

export const DEPARTMENT_LABELS: Record<DepartmentKey, string> = {
  ND: "Nextdoor (ND)",
  FB: "Facebook (FB)",
  SEO: "SEO",
  Other: "Other JellyBean",
  not_in_jellybean: "Not from JellyBean",
  pending: "Still checking",
};
export const DEPARTMENT_DESCRIPTIONS: Record<DepartmentKey, string> = {
  ND: "Found in JellyBean, sent by the Nextdoor team",
  FB: "Found in JellyBean, sent by the Facebook team",
  SEO: "Found in JellyBean, sent by the SEO team",
  Other: "Found in JellyBean, sent by another role",
  not_in_jellybean: "Phone number was never a JellyBean lead",
  pending: "Added in the last minute or two",
};
export const DEPARTMENT_COLORS: Record<DepartmentKey, string> = {
  ND: "#10b981", FB: "#3b82f6", SEO: "#f59e0b", Other: "#8b5cf6", not_in_jellybean: "#94a3b8", pending: "#cbd5e1",
};

/** The CRM's ~25 statuses, grouped into the stages a lead moves through. */
export const STAGES = ["waiting", "quoting", "booked", "job_done", "paid", "lost", "other"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  waiting: "Waiting on customer",
  quoting: "Quoting",
  booked: "Booked / in progress",
  job_done: "Job done, not paid yet",
  paid: "Paid",
  lost: "Cancelled",
  other: "Other",
};
export const STAGE_SHORT_LABELS: Record<Stage, string> = {
  waiting: "Waiting", quoting: "Quoting", booked: "Booked", job_done: "Job done", paid: "Paid", lost: "Cancelled", other: "Other",
};
export const STAGE_COLORS: Record<Stage, string> = {
  waiting: "#fbbf24", quoting: "#a78bfa", booked: "#60a5fa", job_done: "#2dd4bf", paid: "#10b981", lost: "#f87171", other: "#cbd5e1",
};
const STATUS_STAGE: Record<string, Stage> = {
  waiting_complete_details: "waiting", waiting_customer_response: "waiting", activate_customer: "waiting",
  needs_quote: "quoting", need_quote: "quoting", tech_making_quote: "quoting", quote_change: "quoting",
  quote_sent_waiting: "quoting", quote_sent_need_follow_up: "quoting", post_visit_quote_sent_waiting: "quoting",
  pending_to_send: "quoting", quote_pending_to_send: "quoting", quote_updated: "quoting",
  scheduled: "booked", urgent_job: "booked", job_in_progress: "booked", needs_reschedule: "booked",
  need_tech: "booked", post_visit_confirmation: "booked",
  job_done: "job_done", payment_pending: "job_done", payment_requested: "job_done",
  paid: "paid", partial_paid: "paid",
  cancelled: "lost", cancellation_requested: "lost", scammed: "lost",
};
export function statusStage(status: string): Stage {
  return STATUS_STAGE[status] ?? "other";
}

/** Older status values still saved on some leads, which the CRM no longer lists. */
const LEGACY_STATUS_LABELS: Record<string, string> = {
  need_quote: "Need Quote (old status)",
  quote_pending_to_send: "Quote Pending to Send (old status)",
  unknown: "No status",
};

export function statusLabel(status: string): string {
  const label = STATUS_LABELS[status as LeadStatus] ?? LEGACY_STATUS_LABELS[status];
  if (label) return label;
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type StageCounts = Record<Stage, number>;
export type StatusCount = { status: string; label: string; stage: Stage; count: number };
export type DepartmentSummary = {
  key: ReportDepartment;
  total: number;
  /** Share of all leads in range (0-100). */
  share: number;
  stages: StageCounts;
  /** Paid leads as a share of this department's leads (0-100). */
  paidRate: number;
  /** Every status with at least one lead, in stage order then busiest first. */
  statuses: StatusCount[];
};
export type DepartmentReport = {
  /** All leads in range, including ones still being checked. */
  total: number;
  /** Leads found in JellyBean (ND + FB + SEO + Other). */
  inJellybean: number;
  pending: number;
  departments: DepartmentSummary[];
  /** Department with the highest paid rate among those with at least 10 leads. */
  bestPaidRate: ReportDepartment | null;
};

const zeroStages = (): StageCounts => ({ waiting: 0, quoting: 0, booked: 0, job_done: 0, paid: 0, lost: 0, other: 0 });
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const isDepartment = (value: string): value is DepartmentKey => (DEPARTMENT_KEYS as readonly string[]).includes(value);

/**
 * Turns the server's department x status counts into the report. Unknown
 * department values count as "Other JellyBean" so totals always equal the
 * number of leads in range; counts are never estimated.
 */
export function buildDepartmentReport(rows: DepartmentBreakdownRow[]): DepartmentReport {
  const byDepartment = new Map<DepartmentKey, Map<string, number>>();
  for (const row of rows) {
    const count = Number(row.lead_count) || 0;
    if (count <= 0) continue;
    const department: DepartmentKey = isDepartment(row.department) ? row.department : "Other";
    const status = row.status || "unknown";
    const statuses = byDepartment.get(department) ?? new Map<string, number>();
    statuses.set(status, (statuses.get(status) ?? 0) + count);
    byDepartment.set(department, statuses);
  }
  const sumOf = (key: DepartmentKey) => [...(byDepartment.get(key)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const pending = sumOf("pending");
  const total = DEPARTMENT_KEYS.reduce((acc, key) => acc + sumOf(key), 0);

  const departments = REPORT_DEPARTMENTS.map((key): DepartmentSummary => {
    const stages = zeroStages();
    const statuses: StatusCount[] = [];
    for (const [status, count] of byDepartment.get(key) ?? []) {
      const stage = statusStage(status);
      stages[stage] += count;
      statuses.push({ status, label: statusLabel(status), stage, count });
    }
    statuses.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || b.count - a.count || a.label.localeCompare(b.label));
    const departmentTotal = sumOf(key);
    return { key, total: departmentTotal, share: pct(departmentTotal, total), stages, paidRate: pct(stages.paid, departmentTotal), statuses };
  });

  const ranked = departments.filter((d) => d.total >= 10).sort((a, b) => b.paidRate - a.paidRate);
  return {
    total,
    pending,
    inJellybean: JELLYBEAN_DEPARTMENTS.reduce((acc, key) => acc + sumOf(key), 0),
    departments,
    bestPaidRate: ranked.length > 1 && ranked[0].paidRate > 0 ? ranked[0].key : null,
  };
}
