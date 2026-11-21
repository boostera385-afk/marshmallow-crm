import { supabase } from "@/integrations/supabase/client";
import type { AppRole, Lead, LeadStatus } from "@/types";
import { z } from "zod";
import { optimizeImageForUpload } from "@/lib/image-upload";
import type { ReviewActionLead } from "@/lib/request-page-leads";

export const PAYMENT_REQUEST_STATUS: LeadStatus = "payment_requested" as LeadStatus;

export type PaymentRequestStatus = "pending" | "approved" | "rejected";

/** Which final status an approved request applies. Defaults to 'paid' for
 * every request row created before this type existed. */
export type PaymentRequestType = "paid" | "partial_paid";

export const PAYMENT_REQUEST_TYPE_LABELS: Record<PaymentRequestType, string> = {
  paid: "Paid",
  partial_paid: "Partial Paid",
};

const PAYMENT_REQUEST_TYPE_TAG_CLASSES: Record<PaymentRequestType, string> = {
  paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partial_paid: "border-yellow-500/40 bg-yellow-400/15 text-yellow-800 dark:text-yellow-300",
};

/** Tag colours for a request's outcome: Paid is green, Partial Paid is yellow.
 * Legacy rows without a request_type were Paid requests. */
export const paymentRequestTypeTagClass = (requestType?: PaymentRequestType | null) =>
  PAYMENT_REQUEST_TYPE_TAG_CLASSES[requestType === "partial_paid" ? "partial_paid" : "paid"];

export interface LeadPaymentRequest {
  id: string;
  lead_id: string;
  previous_status: LeadStatus;
  requested_by: string | null;
  requested_by_name?: string | null;
  requested_by_role: AppRole;
  request_type: PaymentRequestType;
  amount: number;
  screenshot_path: string | null;
  comment: string | null;
  status: PaymentRequestStatus;
  reviewed_by: string | null;
  reviewed_by_name?: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  requester_name?: string | null;
}

type CreateArgs = {
  lead: Lead;
  userId: string;
  userName?: string | null;
  requesterRole: AppRole;
  requestType: PaymentRequestType;
  amount: number;
  comment?: string | null;
  screenshotFile?: File | null;
  operationId: string;
};

type ReviewArgs = {
  request: LeadPaymentRequest;
  // Only the fields the review actually reads, so callers can join leads with
  // a narrow projection (see src/lib/request-page-leads.ts). A full Lead
  // still satisfies this.
  lead: ReviewActionLead;
  reviewerId: string;
  reviewerName?: string | null;
  reviewerRole: AppRole;
  action: "approved" | "rejected";
  reviewNote?: string | null;
  operationId: string;
};

const table = () => supabase.from("lead_payment_requests");

/** Same gate for both a Paid request and a Partial Paid request. */
export const canCreatePaymentRequest = (role?: AppRole | null) => role === "processor";

/** Admins choose either outcome for every non-terminal lead, including a
 * further partial payment on an already Partial Paid lead. */
export const shouldOfferPaymentTypeChoice = (
  role: AppRole | null | undefined,
  targetType: PaymentRequestType,
  previousStatus: LeadStatus | null | undefined,
) => role === "admin" && targetType === "paid" && previousStatus !== "paid";

export const canReviewPaymentRequest = (role: AppRole | null | undefined, request?: LeadPaymentRequest | null) => {
  if (!request || request.status !== "pending") return false;
  return role === "admin";
};

export async function fetchPendingPaymentRequest(leadId: string): Promise<LeadPaymentRequest | null> {
  const { data, error } = await table()
    .select("*")
    .eq("lead_id", leadId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const request = data as unknown as LeadPaymentRequest;
  const snapshotName = (data as { requested_by_name?: string | null }).requested_by_name || null;

  if (request.requested_by) {
    const { data: profile } = await supabase
      .from("profiles_public" as never)
      .select("full_name")
      .eq("id", request.requested_by)
      .maybeSingle();
    request.requester_name = (profile as { full_name?: string } | null)?.full_name || snapshotName;
  } else {
    request.requester_name = snapshotName;
  }

  return request;
}

export async function createPaymentRequest({
  lead,
  userId,
  requesterRole,
  requestType,
  amount,
  comment,
  screenshotFile,
  operationId,
}: CreateArgs) {
  if (!canCreatePaymentRequest(requesterRole)) {
    throw new Error(`Only Processors can request ${PAYMENT_REQUEST_TYPE_LABELS[requestType]} approval`);
  }
  validateAmount(amount);
  const screenshotPath = await uploadPaymentEvidence("payment-requests", lead.id, userId, operationId, screenshotFile);
  return callPaymentWorkflow({
    kind: "payment", action: "create", operationId, leadId: lead.id,
    expectedStatus: lead.status, requestType, amount, screenshotPath, comment: comment?.trim() || null,
  });
}

export async function reviewPaymentRequest({
  request,
  lead,
  reviewerRole,
  action,
  reviewNote,
  operationId,
}: ReviewArgs) {
  if (!canReviewPaymentRequest(reviewerRole, request)) {
    throw new Error(`Only Admins can review ${PAYMENT_REQUEST_TYPE_LABELS[request.request_type]} requests`);
  }

  return callPaymentWorkflow({
    kind: "payment", action: "review", operationId, leadId: lead.id,
    requestId: request.id, decision: action, comment: reviewNote?.trim() || null,
  });
}

const paymentResultSchema = z.object({
  saved: z.literal(true), id: z.string().uuid(), status: z.string().min(1),
});

async function callPaymentWorkflow(input: Record<string, string | number | null>) {
  const { data, error } = await supabase.rpc("workflow_requests", { p_input: input });
  if (error) throw new Error(error.message || "Payment was not confirmed. Keep this dialog open and retry.");
  const parsed = paymentResultSchema.safeParse(data);
  if (!parsed.success) throw new Error("Payment acknowledgement was unavailable. Keep this dialog open and retry.");
  return parsed.data;
}

function validateAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    throw new Error("Enter a positive payment amount with at most two decimal places");
  }
}

// A failed/uncertain RPC retries the same successfully uploaded File without
// uploading it again. Weak keys release drafts when their dialogs are closed.
const evidenceUploads = new WeakMap<File, Map<string, Promise<string>>>();
async function uploadPaymentEvidence(
  prefix: string, leadId: string, userId: string, operationId: string, file?: File | null,
) {
  if (!file) return null;
  let uploads = evidenceUploads.get(file);
  if (!uploads) { uploads = new Map(); evidenceUploads.set(file, uploads); }
  const key = `${prefix}/${leadId}/${userId}/${operationId}`;
  let upload = uploads.get(key);
  if (!upload) {
    upload = (async () => {
      const optimized = await optimizeImageForUpload(file);
      const extension = optimized.name.split(".").pop() || "jpg";
      const path = `${key}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("lead-photos").upload(path, optimized);
      if (error) throw new Error("Payment screenshot upload failed. Your payment was not submitted. Please retry.");
      return path;
    })();
    uploads.set(key, upload);
    void upload.catch(() => uploads?.delete(key));
  }
  return upload;
}

/** The server derives actor, current status and audit data; no browser bypass. */
export async function recordDirectPayment({
  lead, userId, requesterRole, requestType, amount, screenshotFile, operationId,
}: CreateArgs) {
  if (requesterRole !== "admin") throw new Error("Only Admins can record payments directly");
  validateAmount(amount);
  const screenshotPath = await uploadPaymentEvidence("payments", lead.id, userId, operationId, screenshotFile);
  return callPaymentWorkflow({
    kind: "payment", action: "direct", operationId, leadId: lead.id,
    expectedStatus: lead.status, requestType, amount, screenshotPath,
  });
}
