import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export type UpdateRequestKind = "cx" | "tech";
export type UpdateRequestView = "pending" | "updated" | "action" | "resolved";

const text = z.string().nullable();
// Explicit transport contracts: unknown database fields are stripped before UI use.
export const cxCustomerSchema = z.object({
  job_id: z.string(), customer_name: z.string(), customer_phone: text, customer_landline: text, customer_email: text,
  service_type: text, service_details: text, address: text, city: text, state: text, zip_code: text,
  customer_schedule_requirements: text, scheduled_date: text, scheduled_time_start: text, scheduled_time_end: text,
});
const technicianSchema = z.object({ status: text, tech_name: text, tech_number: text, terms: text }).nullable().optional();
const threadEntrySchema = z.object({
  type: z.enum(["question", "response"]), text: z.string(), at: z.string(), by_name: text.optional(),
});
export const cxRequestSchema = z.object({
  id: z.string().uuid(), lead_id: z.string().uuid(), request_kind: z.enum(["cx", "tech"]).default("cx"),
  requested_by: text, requester_name: text, recipient_cs: text, recipient_name: text,
  request_text: z.string(), status: z.enum(["pending", "cs_updated", "tech_updated"]),
  response_text: text, completed_at: text, completed_by_name: text, created_at: z.string(),
  revision: z.number().int().positive(), resolution_owner: text,
  owner_name: text, acknowledged_at: text, resolved_by_name: text,
  thread: z.array(threadEntrySchema).default([]), customer: cxCustomerSchema, technician: technicianSchema,
});
export type CxUpdateRequest = z.infer<typeof cxRequestSchema>;
const queueSchema = z.object({ rows: z.array(cxRequestSchema), total: z.number().int().nonnegative() });
const savedSchema = z.object({ saved: z.literal(true), id: z.string().uuid() });

type UpdateRequestCall = {
  kind: UpdateRequestKind; action: string; leadId?: string; requestId?: string; text?: string;
  offset?: number; revision?: number; ownerId?: string;
};
const ACTIONS = new Set(["list_pending", "list_updated", "list_action", "list_resolved", "get", "count", "counts", "owners", "create", "complete", "resolve", "acknowledge", "question_more", "reassign"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The exact input the cx-update-requests Edge Function used to forward, with the
 * same field checks, so a malformed call fails here at once. The database
 * function (public.workflow_requests -> marshmallow_private.workflow_requests)
 * enforces the caller, role, scope, lengths and revisions itself; these checks
 * are not the security boundary.
 */
export function toWorkflowRequestInput(call: UpdateRequestCall) {
  const input = {
    kind: call.kind, action: call.action, leadId: call.leadId ?? null, requestId: call.requestId ?? null,
    text: call.text ?? null, offset: call.offset ?? 0, revision: call.revision ?? null, ownerId: call.ownerId ?? null,
  };
  const { action, leadId, requestId, text, offset, revision, ownerId } = input;
  if ((input.kind !== "cx" && input.kind !== "tech") || !ACTIONS.has(action)) throw new Error("Invalid update request action");
  if ((leadId !== null && !UUID.test(leadId)) || (requestId !== null && !UUID.test(requestId)) ||
    (text !== null && text.length > 4000) || !Number.isInteger(offset) || offset < 0 ||
    (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) || (ownerId !== null && !UUID.test(ownerId))) {
    throw new Error("Invalid request fields");
  }
  if ((action === "create" && (!leadId || !requestId || !text?.trim() || text.trim().length > 2000)) ||
    (["complete", "question_more", "reassign"].includes(action) && (!requestId || !text?.trim())) ||
    (["resolve", "acknowledge", "get"].includes(action) && !requestId) ||
    (action === "reassign" && !ownerId) ||
    (["complete", "question_more", "resolve", "acknowledge", "reassign"].includes(action) && revision === null)) {
    throw new Error("Request ID, current revision and update details are required. Refresh the page.");
  }
  return input;
}

/** Messages the database function writes for the user (permission, validation, conflicts). */
const APP_ERROR_CODES = new Set(["42501", "22023", "23505", "40001"]);
/** The API answers with these while it is briefly unavailable; one retry lets it self-heal. */
const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);
export const UPDATE_RETRY_DELAY_MS = 1500;
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * Calls the database function directly (no Edge Function hop or second login
 * check per call), as notifications already do. Same input, same messages.
 */
async function call(body: UpdateRequestCall): Promise<unknown> {
  const p_input = toWorkflowRequestInput(body);
  for (let attempt = 0; ; attempt++) {
    const { data, error, status } = await supabase.rpc("workflow_requests", { p_input });
    if (!error) return data;
    if (error.code && APP_ERROR_CODES.has(error.code)) throw new Error(error.message);
    if (attempt === 0 && TRANSIENT_STATUS.has(status)) {
      await sleep(UPDATE_RETRY_DELAY_MS);
      continue;
    }
    throw new Error(`Update requests are unavailable (code ${error.code || "unknown"}). Try again shortly.`);
  }
}

export const fetchUpdateQueue = async (kind: UpdateRequestKind, view: UpdateRequestView, offset = 0) =>
  queueSchema.parse(await call({ kind, action: `list_${view}`, offset }));
export const fetchUpdateRequest = async (kind: UpdateRequestKind, requestId: string) =>
  queueSchema.parse(await call({ kind, action: "get", requestId }));
export const fetchUpdateCounts = async () =>
  z.object({ cx: z.number().int().nonnegative(), tech: z.number().int().nonnegative() }).parse(await call({ kind: "cx", action: "counts" }));
export const fetchResolutionOwners = async (kind: UpdateRequestKind) =>
  z.object({ owners: z.array(z.object({ id: z.string().uuid(), name: text, role: z.string() })) }).parse(await call({ kind, action: "owners" })).owners;
export const fetchUpdateCount = async (kind: UpdateRequestKind) =>
  z.object({ count: z.number().int().nonnegative() }).parse(await call({ kind, action: "count" })).count;
export const createUpdateRequest = async (kind: UpdateRequestKind, leadId: string, requestId: string, requestText: string) =>
  savedSchema.parse(await call({ kind, action: "create", leadId, requestId, text: requestText.trim() }));
export const completeUpdateRequest = async (kind: UpdateRequestKind, requestId: string, responseText: string, revision: number) =>
  savedSchema.parse(await call({ kind, action: "complete", requestId, text: responseText.trim(), revision }));
export const acknowledgeUpdateRequest = async (kind: UpdateRequestKind, requestId: string, revision: number) =>
  savedSchema.parse(await call({ kind, action: "resolve", requestId, revision }));
export const questionMoreUpdateRequest = async (kind: UpdateRequestKind, requestId: string, question: string, revision: number) =>
  savedSchema.parse(await call({ kind, action: "question_more", requestId, text: question.trim(), revision }));
export const reassignUpdateRequest = async (kind: UpdateRequestKind, requestId: string, ownerId: string, reason: string, revision: number) =>
  savedSchema.parse(await call({ kind, action: "reassign", requestId, ownerId, text: reason.trim(), revision }));

/** Identity includes the revision: reopening the same request is new work. */
export const updateRequestVersion = (request: Pick<CxUpdateRequest, "id" | "revision">) => `${request.id}:${request.revision}`;

// CX wrappers keep existing callers and integrations readable.
export const fetchCxQueue = (status: "pending" | "cs_updated", offset = 0) => fetchUpdateQueue("cx", status === "pending" ? "pending" : "updated", offset);
export const fetchCxCount = () => fetchUpdateCount("cx");
export const createCxRequest = (leadId: string, requestId: string, requestText: string) => createUpdateRequest("cx", leadId, requestId, requestText);
export const completeCxRequest = (requestId: string, responseText: string, revision: number) => completeUpdateRequest("cx", requestId, responseText, revision);
export const acknowledgeCxRequest = (requestId: string, revision: number) => acknowledgeUpdateRequest("cx", requestId, revision);

export function cxNotificationHref(title: string) {
  if (title === "Get CX Update") return "/get-cx-update";
  if (title === "CS Updated") return "/get-cx-update?tab=updated";
  if (title === "Get Tech Update") return "/get-tech-update";
  if (title === "Tech Updated") return "/get-tech-update?tab=updated";
  return null;
}
