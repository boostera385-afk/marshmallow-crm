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

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
/** The Supabase edge runtime answers with these while its isolate pool restarts.
 * One short retry lets a momentary degraded window self-heal without user action;
 * anything else (validation, permissions) is surfaced immediately. */
const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);
const TRANSIENT_CODES = new Set(["SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED", "SUPABASE_EDGE_RUNTIME_OVERLOAD"]);
export const INBOX_RETRY_DELAY_MS = 1500;

interface InvokeOutcome { data: unknown; status: number; code: string; message: string | null; }
async function invokeOnce(area: "notifications" | "schedule", input: object): Promise<InvokeOutcome> {
  const { data, error } = await supabase.functions.invoke("workflow-inbox", { body: { area, ...input } });
  if (!error) return { data, status: 200, code: "", message: null };
  const context: unknown = "context" in error ? error.context : null;
  let status = 0;
  let code = "";
  let message: string | null = null;
  if (context instanceof Response) {
    status = context.status;
    const body: unknown = await context.clone().json().catch(() => null);
    if (body && typeof body === "object") {
      if ("code" in body && typeof body.code === "string") code = body.code;
      if ("error" in body && typeof body.error === "string") message = body.error;
      else if ("message" in body && typeof body.message === "string") message = body.message;
    }
  }
  return { data: null, status, code, message };
}

function inboxError(outcome: InvokeOutcome) {
  if (TRANSIENT_CODES.has(outcome.code)) return new Error("Notification service briefly restarted. It was retried automatically — please try again if it persists.");
  if (outcome.message) return new Error(outcome.message);
  return new Error("Inbox unavailable. Ask Admin to check backend installation.");
}

export async function workflowCall(area: "notifications" | "schedule", input: object): Promise<unknown> {
  const isTransient = (outcome: InvokeOutcome) => TRANSIENT_STATUS.has(outcome.status) || TRANSIENT_CODES.has(outcome.code);
  const first = await invokeOnce(area, input);
  if (!isTransient(first)) {
    if (first.status === 200) return first.data;
    throw inboxError(first);
  }
  await sleep(INBOX_RETRY_DELAY_MS);
  const second = await invokeOnce(area, input);
  if (second.status === 200) return second.data;
  throw inboxError(second);
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
