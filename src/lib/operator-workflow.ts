import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/types";

export const COPY_ROLES: { role: AppRole; label: string }[] = [
  { role: "customer_service", label: "Customer Service" },
  { role: "processor", label: "Processor" },
  { role: "cs_admin", label: "CS Admin" },
  { role: "opr", label: "Operator" },
  { role: "opr_admin", label: "Operator Admin" },
];
const roleSchema = z.enum(["admin", "processor", "customer_service", "cs_admin", "opr", "opr_admin"]);
export const copySettingsSchema = z.object({
  roles: z.array(z.object({ role: roleSchema, allowed: z.boolean() })),
  users: z.array(z.object({ user_id: z.string().uuid(), allowed: z.boolean() })),
});
export type CopySettings = z.infer<typeof copySettingsSchema>;
export function resolveLeadCopyAccess(role: AppRole | null, roleAllowed = true, userOverride?: boolean | null) {
  if (!role) return false;
  return role === "admin" || (userOverride ?? roleAllowed);
}

const text = z.string().nullable();
export const holdSnapshotSchema = z.object({
  job_id: z.string(), customer_name: z.string(), customer_phone: text, customer_landline: text,
  service_type: text, service_details: text, address: text, city: text, state: text, zip_code: text,
  customer_schedule_requirements: text, scheduled_date: text, scheduled_time_start: text,
  scheduled_time_end: text, tech_name: text, tech_number: text, status: z.string(), cs_tag: text, quote: text,
});
export const holdAlertSchema = z.object({
  id: z.string().uuid(), lead_id: z.string().uuid(), revision: z.string().uuid(),
  reason: z.enum(["ready_to_schedule", "scheduled", "cancelled"]),
  snapshot: holdSnapshotSchema, read: z.boolean(), created_at: z.string().datetime({ offset: true }),
});
export const holdInboxSchema = z.object({
  observed_at: z.string().datetime({ offset: true }), unread_count: z.number().int().nonnegative(),
  alerts: z.array(holdAlertSchema),
});
export type HoldAlert = z.infer<typeof holdAlertSchema>;
export type HoldSnapshot = z.infer<typeof holdSnapshotSchema>;
export const HOLD_REASON_LABELS: Record<HoldAlert["reason"], string> = {
  ready_to_schedule: "Ready to Schedule", scheduled: "Scheduled", cancelled: "Cancelled",
};

// Narrow, runtime-validated RPC boundary while the manual migration awaits application.
// Do not modify generated Database types by hand. Regenerate after applying the SQL.
type WorkflowArgs = {
  get_lead_copy_access: undefined;
  get_lead_copy_settings: undefined;
  set_lead_copy_permission: { p_role: AppRole | null; p_user_id: string | null; p_allowed: boolean | null };
  get_operator_hold_alerts: undefined;
  acknowledge_operator_hold_alert: { p_id: string | null; p_revision: string | null; p_alerts: Pick<HoldAlert, "id" | "revision">[] | null };
};
interface WorkflowRpcClient {
  rpc<K extends keyof WorkflowArgs>(name: K, args?: WorkflowArgs[K]): PromiseLike<{
    data: unknown; error: { message: string; code?: string } | null;
  }>;
}
const workflowDb = supabase as unknown as WorkflowRpcClient;
async function call<K extends keyof WorkflowArgs>(name: K, args?: WorkflowArgs[K]) {
  const { data, error } = await workflowDb.rpc(name, args);
  if (error) throw new Error(error.code === "PGRST202" || error.code === "42883"
    ? "Apply the Copy Details / Hold This Job migration before using these controls."
    : error.message);
  return data;
}
export const fetchLeadCopyAccess = async () => z.boolean().parse(await call("get_lead_copy_access"));
export const fetchLeadCopySettings = async () => copySettingsSchema.parse(await call("get_lead_copy_settings"));
export async function setLeadCopyPermission(role: AppRole | null, userId: string | null, allowed: boolean | null) {
  await call("set_lead_copy_permission", { p_role: role, p_user_id: userId, p_allowed: allowed });
}
export const fetchHoldInbox = async () => holdInboxSchema.parse(await call("get_operator_hold_alerts"));
export async function acknowledgeHoldAlert(alert: Pick<HoldAlert, "id" | "revision">) {
  return z.number().int().parse(await call("acknowledge_operator_hold_alert", {
    p_id: alert.id, p_revision: alert.revision, p_alerts: null,
  })) > 0;
}
export async function acknowledgeHoldInbox(alerts: Pick<HoldAlert, "id" | "revision">[]) {
  await call("acknowledge_operator_hold_alert", {
    p_id: null, p_revision: null, p_alerts: alerts.map(({ id, revision }) => ({ id, revision })),
  });
}
