export const PREFERRED_URGENT_STATUSES = [
  "Awaiting Response",
  "Awaiting Schedule",
  "Schedule Confirmed",
  "Schedule Confirmation Pending",
  "New Schedule",
  "Quote Rejected",
  "Need to Cancel",
  "Need Requote",
] as const;

const STATUS_WORDS = /^[A-Za-z][A-Za-z/-]*(?: [A-Za-z][A-Za-z/-]*){1,2}$/;

/**
 * AI labels are deliberately tiny: the preferred operational vocabulary above,
 * or a specific two/three-word fallback for a genuinely different topic.
 */
export function normalizeUrgentStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > 48 || !STATUS_WORDS.test(normalized)) return null;
  return normalized;
}
