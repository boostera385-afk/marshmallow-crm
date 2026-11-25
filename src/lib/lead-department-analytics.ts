import { STATUS_LABELS } from "@/lib/constants";
import type { LeadStatus } from "@/types";

/** One row from get_lead_department_breakdown(): leads created in range, by department and current status. */
export type DepartmentBreakdownRow = { department: string; status: string | null; lead_count: number | string };

export const DEPARTMENT_KEYS = ["ND", "FB", "SEO", "Other", "not_in_jellybean", "pending"] as const;
export type DepartmentKey = (typeof DEPARTMENT_KEYS)[number];
/** The three JellyBean departments plus "Other JellyBean"; together they are the leads found in JellyBean. */
export const JELLYBEAN_DEPARTMENTS: readonly DepartmentKey[] = ["ND", "FB", "SEO", "Other"];

export const DEPARTMENT_LABELS: Record<DepartmentKey, string> = {
  ND: "Nextdoor (ND)",
  FB: "Facebook (FB)",
  SEO: "SEO",
  Other: "Other JellyBean",
  not_in_jellybean: "Not in JellyBean",
  pending: "Still checking",
};
export const DEPARTMENT_SHORT_LABELS: Record<DepartmentKey, string> = {
  ND: "ND", FB: "FB", SEO: "SEO", Other: "Other", not_in_jellybean: "Not in JB", pending: "Checking",
};
export const DEPARTMENT_DESCRIPTIONS: Record<DepartmentKey, string> = {
  ND: "JellyBean Nextdoor team (maturing / sub-admin)",
  FB: "JellyBean Facebook team",
  SEO: "JellyBean SEO team (sites, mail, Crisp)",
  Other: "In JellyBean, submitted by another role",
  not_in_jellybean: "No JellyBean lead with this phone before it was added",
  pending: "Added recently; checked within a minute or two",
};
export const DEPARTMENT_COLORS: Record<DepartmentKey, string> = {
  ND: "#10b981", FB: "#3b82f6", SEO: "#f59e0b", Other: "#8b5cf6", not_in_jellybean: "#94a3b8", pending: "#cbd5e1",
};

export type DepartmentCounts = Record<DepartmentKey, number>;
export type DepartmentStatusRow = { status: string; label: string; counts: DepartmentCounts; total: number };
export type DepartmentReport = {
  totals: DepartmentCounts;
  total: number;
  /** Leads found in JellyBean (ND + FB + SEO + Other). */
  inJellybean: number;
  /** Status rows, busiest first; every department column is present (0 when empty). */
  statuses: DepartmentStatusRow[];
};

const zero = (): DepartmentCounts => ({ ND: 0, FB: 0, SEO: 0, Other: 0, not_in_jellybean: 0, pending: 0 });
const isDepartment = (value: string): value is DepartmentKey => (DEPARTMENT_KEYS as readonly string[]).includes(value);

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as LeadStatus] ?? (status === "unknown" ? "No status" : status.replace(/_/g, " "));
}

/**
 * Turns the server's department x status counts into the report. Unknown
 * department values are counted under "Other" so totals always match the
 * number of leads in range; counts are never estimated.
 */
export function buildDepartmentReport(rows: DepartmentBreakdownRow[]): DepartmentReport {
  const totals = zero();
  const byStatus = new Map<string, DepartmentCounts>();
  for (const row of rows) {
    const count = Number(row.lead_count) || 0;
    if (count <= 0) continue;
    const department: DepartmentKey = isDepartment(row.department) ? row.department : "Other";
    const status = row.status || "unknown";
    const counts = byStatus.get(status) ?? zero();
    counts[department] += count;
    byStatus.set(status, counts);
    totals[department] += count;
  }
  const sum = (counts: DepartmentCounts) => DEPARTMENT_KEYS.reduce((acc, key) => acc + counts[key], 0);
  const statuses = [...byStatus.entries()]
    .map(([status, counts]) => ({ status, label: statusLabel(status), counts, total: sum(counts) }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  return {
    totals,
    total: sum(totals),
    inJellybean: JELLYBEAN_DEPARTMENTS.reduce((acc, key) => acc + totals[key], 0),
    statuses,
  };
}
