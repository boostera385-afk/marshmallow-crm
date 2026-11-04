import type { AppRole, CsTag } from "@/types";

/** Tags that drive the scheduling flow — the only ones Operators are meant to see. */
export const SCHEDULE_TAGS: CsTag[] = [
  "ready_to_schedule",
  "confirmation_sent",
  "waiting_schedule_confirmation",
  "booked",
];

const TAGS_BY_ROLE: Record<AppRole, CsTag[]> = {
  admin: [...SCHEDULE_TAGS, "incomplete_details"],
  customer_service: [...SCHEDULE_TAGS],
  processor: ["ready_to_schedule", "waiting_schedule_confirmation", "incomplete_details"],
  opr: [],
  cs_admin: [...SCHEDULE_TAGS],
  opr_admin: [],
};

/**
 * Quotation Master is a per-user flag rather than a role; Admins count as one implicitly.
 * CS Admins do not — they are on the receiving end of quote work, not the queue that does it.
 */
export function isQuotationMaster(
  role: AppRole | null | undefined,
  isQuotationMasterFlag?: boolean | null,
): boolean {
  return role === "admin" || isQuotationMasterFlag === true;
}

interface AssignableTagOptions {
  /** `profiles.is_quotation_master` for the current user. */
  isQuotationMaster?: boolean | null;
}

export function getAssignableLeadTags(
  role: AppRole | null | undefined,
  options: AssignableTagOptions = {},
): CsTag[] {
  if (!role) return [];

  // Operators never assign tags, whatever else is flagged on their profile.
  if (role === "opr") return [];

  const tags = [...(TAGS_BY_ROLE[role] ?? [])];

  // Quotation Masters flag incomplete leads back to the CS who created them.
  if (isQuotationMaster(role, options.isQuotationMaster) && !tags.includes("incomplete_details")) {
    tags.push("incomplete_details");
  }

  return tags;
}

export function canAssignLeadTag(
  role: AppRole | null | undefined,
  tag: CsTag,
  options: AssignableTagOptions = {},
): boolean {
  return getAssignableLeadTags(role, options).includes(tag);
}

export function isScheduleTag(tag: string | null | undefined): boolean {
  return Boolean(tag) && SCHEDULE_TAGS.includes(tag as CsTag);
}

/**
 * Whether the lead's current tag was set by the schedule confirmation AI. Only
 * Ready to schedule is ever set by AI, and any later tag change by a person
 * clears the marker in the database.
 */
export function isAiSetTag(lead: { cs_tag?: string | null; cs_tag_source?: string | null }): boolean {
  return lead.cs_tag === "ready_to_schedule" && lead.cs_tag_source === "ai";
}
