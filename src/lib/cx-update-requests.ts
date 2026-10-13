import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

const text = z.string().nullable();
// Explicit customer-only transport contract, not a fabricated database type.
// Unknown fields are stripped before they can reach the UI.
export const cxCustomerSchema = z.object({
  job_id: z.string(), customer_name: z.string(), customer_phone: text, customer_landline: text, customer_email: text,
  service_type: text, service_details: text, address: text, city: text, state: text, zip_code: text,
  customer_schedule_requirements: text, scheduled_date: text, scheduled_time_start: text, scheduled_time_end: text,
});
export const cxRequestSchema = z.object({
  id: z.string().uuid(), lead_id: z.string().uuid(), requested_by: text, requester_name: text,
  recipient_cs: text, recipient_name: text, request_text: z.string(), status: z.enum(["pending", "cs_updated"]),
  response_text: text, completed_at: text, completed_by_name: text, created_at: z.string(), customer: cxCustomerSchema,
});
export type CxUpdateRequest = z.infer<typeof cxRequestSchema>;
const queueSchema = z.object({ rows: z.array(cxRequestSchema), total: z.number().int().nonnegative() });
const savedSchema = z.object({ saved: z.literal(true), id: z.string().uuid() });
async function call(body: object): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("cx-update-requests", { body });
  if (error) {
    const context: unknown = "context" in error ? error.context : null;
    if (context instanceof Response) {
      const payload: unknown = await context.clone().json().catch(() => null);
      if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") throw new Error(payload.error);
    }
    throw new Error("CX updates are unavailable. Ask Admin to check the migration and function deployment.");
  }
  return data;
}
export const fetchCxQueue = async (status: "pending" | "cs_updated", offset = 0) =>
  queueSchema.parse(await call({ action: status === "pending" ? "list_pending" : "list_updated", offset }));
export const fetchCxCount = async () => z.object({ count: z.number().int().nonnegative() }).parse(await call({ action: "count" })).count;
export const createCxRequest = async (leadId: string, requestId: string, text: string) =>
  savedSchema.parse(await call({ action: "create", leadId, requestId, text: text.trim() }));
export const completeCxRequest = async (requestId: string, text: string) =>
  savedSchema.parse(await call({ action: "complete", requestId, text: text.trim() }));
export const acknowledgeCxRequest = async (requestId: string) =>
  savedSchema.parse(await call({ action: "acknowledge", requestId }));
export function cxNotificationHref(title: string) {
  if (title === "Get CX Update") return "/get-cx-update";
  if (title === "CS Updated") return "/get-cx-update?tab=cs_updated";
  return null;
}
