import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { cxNotificationHref } from "@/lib/cx-update-requests";

export const notificationSchema = z.object({
  id: z.string().uuid(), title: z.string(), message: z.string(), lead_id: z.string().uuid().nullable(),
  read: z.boolean(), created_at: z.string(), event_type: z.enum(["update_requested", "update_answered", "update_resolved", "schedule_ready"]).nullable(),
  request_kind: z.enum(["cx", "tech"]).nullable(), request_id: z.string().uuid().nullable(), revision: z.number().nullable(),
  job_id: z.string().nullable(), action_required: z.boolean(),
});
export type InboxNotification = z.infer<typeof notificationSchema>;
export type InboxFilters = { view: "all" | "unread" | "action"; category: "all" | "cx" | "tech" | "schedule" | "other"; search: string; since?: string; until?: string };
export const inboxSchema = z.object({ rows: z.array(notificationSchema), total: z.number().int().nonnegative(), unread_count: z.number().int().nonnegative() });

export async function workflowCall(area: "notifications" | "schedule", input: object): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("workflow-inbox", { body: { area, ...input } });
  if (error) {
    const context: unknown = "context" in error ? error.context : null;
    if (context instanceof Response) {
      const body: unknown = await context.clone().json().catch(() => null);
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") throw new Error(body.error);
    }
    throw new Error("Inbox unavailable. Ask Admin to check backend installation.");
  }
  return data;
}
export const fetchInbox = async (filters: InboxFilters, offset: number) => inboxSchema.parse(await workflowCall("notifications", { action: "list", ...filters, offset }));
export const fetchWorkflowAlerts = async (after: string, until: string, offset: number) => inboxSchema.parse(await workflowCall("notifications", { action: "alerts", after, until, offset }));
export const markInboxRead = async (ids: string[]) => z.object({ saved: z.literal(true) }).parse(await workflowCall("notifications", { action: "read", ids }));

export function legacyNotificationHref(notification: Pick<InboxNotification, "title" | "lead_id">) {
  return cxNotificationHref(notification.title) ?? (notification.lead_id ? `/leads/${notification.lead_id}` : null);
}
export async function openInboxNotification(notification: Pick<InboxNotification, "id" | "title" | "lead_id">) {
  if (!notification.id) throw new Error("Notification ID unavailable");
  const result = z.object({ saved: z.literal(true), href: z.string().nullable() }).parse(await workflowCall("notifications", { action: "open", notificationId: notification.id }));
  const href = result.href ?? legacyNotificationHref(notification);
  // Even server output is constrained to our internal, known destinations.
  if (href && !/^\/(?:leads\/[\da-f-]+|get-(?:cx|tech)-update(?:\?.*)?)$/i.test(href)) throw new Error("Notification destination unavailable");
  return href;
}
