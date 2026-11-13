import type { AppRole } from "@/types";

/**
 * Operators (`opr`, NOT `opr_admin`) see a job's location as "City, ST ZIP" only:
 * never the street address or map position, the customer's name, phone/landline, or
 * the technician's name/number (business rule 2026-11-06, extended 2026-11-13 to
 * also hide the customer's name).
 *
 * The location comes from the server-computed `location_label` field
 * (migration 20261203000000_opr_location_only), which never contains street text.
 * Hold-alert snapshots are redacted on the server. Lead rows are still readable by
 * Operators in the database, so every Operator screen must pass leads through
 * redactLeadForOperator before rendering.
 */
export function isLocationOnlyOperator(role: AppRole | null | undefined): boolean {
  return role === "opr";
}

/** Server-computed "City, ST ZIP" (PostgREST computed field on leads). */
export const LOCATION_LABEL_COLUMN = "location_label";

/** Adds the location label to a select list for Operators only. */
export function withOperatorLocation(columns: string, role: AppRole | null | undefined): string {
  return isLocationOnlyOperator(role) ? `${columns}, ${LOCATION_LABEL_COLUMN}` : columns;
}

export interface LocationParts { city: string | null; state: string | null; zip: string | null }

/** Splits "City, ST 12345" / "ST 12345" / "12345" back into parts. */
export function parseLocationLabel(label: string | null | undefined): LocationParts {
  const text = (label ?? "").trim();
  if (!text) return { city: null, state: null, zip: null };
  const comma = text.lastIndexOf(", ");
  const city = comma >= 0 ? text.slice(0, comma).trim() || null : null;
  const rest = comma >= 0 ? text.slice(comma + 2) : text;
  const match = rest.match(/^([A-Z]{2})?\s*(\d{5})?$/);
  if (!match) return { city, state: null, zip: null };
  return { city, state: match[1] ?? null, zip: match[2] ?? null };
}

/** Fields an Operator must never see, beyond the location (rewritten below). */
const HIDDEN_FIELDS = ["half_address", "latitude", "longitude", "customer_name", "customer_phone", "customer_landline", "tech_name", "tech_number"] as const;

type LeadLike = {
  address?: string | null; city?: string | null; state?: string | null; zip_code?: string | null;
  location_label?: string | null;
} & Partial<Record<(typeof HIDDEN_FIELDS)[number], unknown>>;

/**
 * For an Operator: removes address, map position, the customer's name and numbers,
 * and technician details, and replaces address/city/state/zip with the server's
 * location label. Without a label the location is left empty: the raw address is
 * never shown. Every other role gets the lead unchanged (same object).
 */
export function redactLeadForOperator<T extends LeadLike>(lead: T, role: AppRole | null | undefined): T {
  if (!isLocationOnlyOperator(role)) return lead;
  const label = typeof lead.location_label === "string" && lead.location_label.trim() ? lead.location_label.trim() : null;
  const { city, state, zip } = parseLocationLabel(label);
  const safe: Record<string, unknown> = { ...lead, address: label, city, state, zip_code: zip };
  for (const field of HIDDEN_FIELDS) if (field in safe) safe[field] = null;
  return safe as T;
}
