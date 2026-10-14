import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/types";

/**
 * Single place where lead notifications are dispatched.
 *
 * Two rules hold for every notification sent from here:
 *
 * 1. A recipient must be able to open the lead. Role alone is not enough — a plain
 *    customer_service user can only SELECT leads they created, are assigned to, or had shared
 *    with them, so alerting every CS user produced popups that dead-ended in "Lead not found".
 * 2. The person who caused the notification never receives it.
 *
 * Delivery goes through the `dispatch_lead_status_notification` RPC, which keeps at most one
 * unread alert per (user, lead, title) — re-flagging the same lead refreshes the existing row
 * instead of stacking another popup. If that migration has not been applied yet the helper
 * falls back to the previous direct insert so alerts still go out.
 */

/** Roles whose lead SELECT policy is not scoped to individual leads. */
const FULL_VISIBILITY_ROLES: AppRole[] = ["admin", "processor", "cs_admin"];
const REMINDER_ROLES: AppRole[] = ["admin", "processor"];

export type LeadNotificationStatus = "urgent_job" | "need_tech" | "job_in_progress" | "quote_updated";

interface DispatchParams {
  leadId: string;
  leadName: string;
  status: string;
  /** Included in the Job in Progress reminder text when present. */
  expectedCompletionDate?: string | null;
  /** Quote Updated also notifies whoever requested the quote. */
  quoteRequestedBy?: string | null;
  /** New leads get "requires attention" wording rather than "changed to". */
  isNewLead?: boolean;
}

export function primaryCsNotificationRecipient(lead: { created_by: string | null; assigned_cs: string | null }): string | null {
  return lead.assigned_cs ?? lead.created_by;
}

function isNotificationStatus(status: string): status is LeadNotificationStatus {
  return (
    status === "urgent_job" ||
    status === "need_tech" ||
    status === "job_in_progress" ||
    status === "quote_updated"
  );
}

/** Titles are matched by the popups with `ilike`, so these strings are load-bearing. */
function buildContent(params: DispatchParams, status: LeadNotificationStatus) {
  const { leadName, expectedCompletionDate, isNewLead } = params;

  if (status === "quote_updated") {
    return {
      title: "[Alert] Quote Updated",
      message: `Quote for lead "${leadName}" has been updated`,
    };
  }

  if (status === "job_in_progress") {
    return {
      title: "[Reminder] Job in Progress",
      message: expectedCompletionDate
        ? `Lead "${leadName}" is In Progress. Expected completion: ${expectedCompletionDate}`
        : `Lead "${leadName}" changed to Job in Progress`,
    };
  }

  const statusLabel = status === "urgent_job" ? "Urgent Job" : "Need Tech";
  return {
    title: `[Alert] ${statusLabel}`,
    message: isNewLead
      ? `New lead "${leadName}" requires attention - marked as ${statusLabel}`
      : `Lead "${leadName}" changed to ${statusLabel}`,
  };
}

async function usersWithRoles(roles: AppRole[]): Promise<string[]> {
  const { data } = await supabase.from("user_roles").select("user_id").in("role", roles);
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

/**
 * Everyone individually attached to this lead: the CS who created it, the assigned CS, anyone
 * it was shared with, and the operators it was assigned to. These are exactly the links the
 * leads SELECT policy and the operator notification filter care about.
 */
async function usersAttachedToLead(leadId: string): Promise<string[]> {
  const attached: string[] = [];

  const [leadRes, sharesRes, assignmentsRes] = await Promise.all([
    supabase.from("leads").select("created_by, assigned_cs").eq("id", leadId).maybeSingle(),
    supabase.from("lead_shares").select("shared_with_user_id").eq("lead_id", leadId),
    supabase.from("lead_operator_assignments").select("operator_user_id").eq("lead_id", leadId),
  ]);

  const lead = leadRes.data as { created_by: string | null; assigned_cs: string | null } | null;
  // For Customer Service ownership, assignment wins. The creator is the
  // fallback only while the lead is unassigned, so reassignment cannot keep
  // alerting the previous CS user about somebody else's urgent lead.
  const primaryCs = lead ? primaryCsNotificationRecipient(lead) : null;
  if (primaryCs) attached.push(primaryCs);

  ((sharesRes.data ?? []) as { shared_with_user_id: string }[]).forEach((s) => {
    if (s.shared_with_user_id) attached.push(s.shared_with_user_id);
  });

  ((assignmentsRes.data ?? []) as { operator_user_id: string }[]).forEach((a) => {
    if (a.operator_user_id) attached.push(a.operator_user_id);
  });

  return attached;
}

async function resolveRecipients(
  status: LeadNotificationStatus,
  leadId: string,
  quoteRequestedBy?: string | null,
): Promise<string[]> {
  const recipients = new Set<string>();

  if (status === "quote_updated") {
    if (quoteRequestedBy) recipients.add(quoteRequestedBy);
    (await usersWithRoles(["cs_admin"])).forEach((id) => recipients.add(id));
    return [...recipients];
  }

  if (status === "job_in_progress") {
    (await usersWithRoles(REMINDER_ROLES)).forEach((id) => recipients.add(id));
    return [...recipients];
  }

  // Urgent Job / Need Tech: roles that can see every lead, plus the people tied to this one.
  const [broad, attached] = await Promise.all([
    usersWithRoles(FULL_VISIBILITY_ROLES),
    usersAttachedToLead(leadId),
  ]);

  broad.forEach((id) => recipients.add(id));
  attached.forEach((id) => recipients.add(id));

  return [...recipients];
}

/** Postgres/PostgREST codes meaning the RPC is not deployed on this project yet. */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  return Boolean(error.message && /Could not find the function|does not exist/i.test(error.message));
}

/** The signed-in user, read from the cached session rather than a round trip to the auth server. */
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/**
 * Sends one lead notification to a set of users, deduped per (user, lead, title) and never to
 * the person who triggered it. Exported so every dispatch path shares the same rules.
 */
export async function deliverLeadNotification(params: {
  leadId: string;
  title: string;
  message: string;
  userIds: string[];
}): Promise<void> {
  const actorId = await currentUserId();
  const userIds = [...new Set(params.userIds)].filter((id) => Boolean(id) && id !== actorId);

  if (userIds.length === 0) return;

  const { error } = await supabase.rpc("dispatch_lead_status_notification" as never, {
    p_lead_id: params.leadId,
    p_title: params.title,
    p_message: params.message,
    p_user_ids: userIds,
  } as never);

  if (!error) return;

  if (!isMissingFunction(error)) throw error;

  // Migration not applied yet — deliver the old way rather than dropping the alert.
  await supabase.from("notifications").insert(
    userIds.map((userId) => ({
      user_id: userId,
      title: params.title,
      message: params.message,
      lead_id: params.leadId,
      read: false,
    })),
  );
}

/**
 * Sends the alert for a lead status change. Safe to call for any status — anything without an
 * alert attached is ignored. Never throws: notification delivery must not fail a lead save.
 */
export async function dispatchLeadStatusNotification(params: DispatchParams): Promise<void> {
  try {
    if (!isNotificationStatus(params.status)) return;

    const recipients = await resolveRecipients(params.status, params.leadId, params.quoteRequestedBy);
    if (recipients.length === 0) return;

    const { title, message } = buildContent(params, params.status);
    await deliverLeadNotification({
      leadId: params.leadId,
      title,
      message,
      userIds: recipients,
    });
  } catch (err) {
    console.warn("Failed to dispatch lead status notification:", err);
  }
}

export const INCOMPLETE_DETAILS_TITLE = "[Alert] Incomplete Details";

/**
 * Fired when a Processor / Admin / Quotation Master tags a lead as Incomplete details.
 * Goes to the CS who created the lead (whose card it also pins) and to every CS Admin.
 */
export async function dispatchIncompleteDetailsNotification(params: {
  leadId: string;
  leadName: string;
  createdBy?: string | null;
}): Promise<boolean> {
  try {
    const recipients = new Set<string>();
    if (params.createdBy) recipients.add(params.createdBy);
    (await usersWithRoles(["cs_admin"])).forEach((id) => recipients.add(id));

    await deliverLeadNotification({
      leadId: params.leadId,
      title: INCOMPLETE_DETAILS_TITLE,
      message: `Lead "${params.leadName}" is missing details - please complete the lead information`,
      userIds: [...recipients],
    });
    return true;
  } catch (err) {
    // Reported to the caller so the tag does not appear to have alerted anyone when it did not.
    console.warn("Failed to dispatch incomplete details notification:", err);
    return false;
  }
}
