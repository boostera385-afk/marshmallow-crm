import { supabase } from "@/integrations/supabase/client";
import type { AppRole, Lead, LeadCancellationRequest, LeadStatus } from "@/types";
import { logActivity } from "@/lib/activity";
import { optimizeImageForUpload } from "@/lib/image-upload";
import { updateLeadById } from "@/lib/lead-updates";

export const CANCELLATION_REQUEST_STATUS: LeadStatus = "cancellation_requested";

type CreateCancellationRequestArgs = {
  lead: Lead;
  userId: string;
  userName?: string | null;
  requesterRole: AppRole;
  comment: string;
  proof?: string | null;
  proofImage?: File | null;
  aiReasonCode?: string;
  aiReasonApplied?: boolean;
  aiSuggestedReason?: string;
};

type ReviewCancellationRequestArgs = {
  request: LeadCancellationRequest;
  lead: Lead;
  reviewerId: string;
  reviewerName?: string | null;
  reviewerRole: AppRole;
  action: "approved" | "rejected";
  reviewNote?: string | null;
};

const cancellationRequestsTable = () => supabase.from("lead_cancellation_requests");

export const canCreateCancellationRequest = (role?: AppRole | null) =>
  role === "customer_service" || role === "processor" || role === "cs_admin";

export const canReviewCancellationRequest = (role: AppRole | null | undefined, request?: LeadCancellationRequest | null) => {
  if (!request || request.status !== "pending") return false;
  if (role === "admin") return true;
  return role === "processor" && (request.requested_by_role === "customer_service" || request.requested_by_role === "cs_admin");
};

export const getCancellationApproverRoles = (requesterRole: AppRole): AppRole[] => {
  if (requesterRole === "processor") return ["admin"];
  return ["admin", "processor"];
};

export async function fetchPendingCancellationRequest(leadId: string): Promise<LeadCancellationRequest | null> {
  const { data, error } = await cancellationRequestsTable()
    .select("*")
    .eq("lead_id", leadId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const request = data as unknown as LeadCancellationRequest;
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

/**
 * The most recent cancellation request for a lead, whatever its outcome.
 *
 * The reason a lead was cancelled only ever lived on the request row, so a cancelled lead had
 * nothing to show for it. Reading the newest row back surfaces that reason for leads cancelled
 * before this existed as well as new ones.
 */
export async function fetchLatestCancellationRequest(leadId: string): Promise<LeadCancellationRequest | null> {
  const { data, error } = await cancellationRequestsTable()
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const request = data as unknown as LeadCancellationRequest;
  const snapshotName = (data as { requested_by_name?: string | null }).requested_by_name || null;

  const ids = [request.requested_by, request.reviewed_by].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles_public" as never)
      .select("id, full_name")
      .in("id", ids);

    const names = new Map(
      ((profiles ?? []) as { id: string; full_name?: string | null }[]).map((p) => [p.id, p.full_name]),
    );

    request.requester_name = (request.requested_by ? names.get(request.requested_by) : null) || snapshotName;
    request.reviewer_name = (request.reviewed_by ? names.get(request.reviewed_by) : null) || null;
  } else {
    request.requester_name = snapshotName;
  }

  return request;
}

export async function createCancellationRequest({
  lead,
  userId,
  userName,
  requesterRole,
  comment,
  proof,
  proofImage,
  aiReasonCode,
  aiReasonApplied,
  aiSuggestedReason,
}: CreateCancellationRequestArgs): Promise<LeadCancellationRequest> {
  const cleanComment = comment.trim();
  const cleanProof = proof?.trim() || null;
  let proofImagePath: string | null = null;

  if (!cleanComment) throw new Error("Cancellation comment is required");
  if (!canCreateCancellationRequest(requesterRole)) {
    throw new Error("Only CS, CS Admin, and Processor can create cancellation requests");
  }

  const { data: existing } = await cancellationRequestsTable()
    .select("*")
    .eq("lead_id", lead.id)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) {
    throw new Error("This lead already has a pending cancellation request");
  }

  if (proofImage) {
    const optimized = await optimizeImageForUpload(proofImage);
    const ext = optimized.name.split(".").pop() || "jpg";
    proofImagePath = `cancellation-requests/${lead.id}_${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("lead-photos").upload(proofImagePath, optimized);
    if (uploadError) throw uploadError;
  }

  const { data, error } = await cancellationRequestsTable()
    .insert({
      lead_id: lead.id,
      previous_status: lead.status,
      requested_by: userId,
      requested_by_name: userName || null,
      requested_by_role: requesterRole,
      comment: cleanComment,
      proof: cleanProof,
      proof_image_path: proofImagePath,
      status: "pending",
      ai_reason_code: aiReasonCode || null,
      ai_reason_applied: aiReasonApplied || false,
      ai_suggested_reason: aiSuggestedReason || null,
      ai_suggested_at: aiReasonCode ? new Date().toISOString() : null,
    } as never)
    .select("*")
    .single();

  if (error) throw error;

  await updateLeadById(lead.id, {
      status: CANCELLATION_REQUEST_STATUS,
      cs_tag: null,
      last_edited_by: userId,
      last_edited_by_name: userName || null,
      updated_at: new Date().toISOString(),
      last_edited_at: new Date().toISOString(),
    });

  // Approvers are notified by the database (lead_cancellation_requests_notify),
  // using the same rule as getCancellationApproverRoles.
  await logActivity(userId, "cancellation_requested", "lead", lead.id, {
    target_name: lead.job_id,
    customer_name: lead.customer_name,
    job_id: lead.job_id,
    requested_by_role: requesterRole,
    comment: cleanComment,
    proof: cleanProof,
    proof_image_path: proofImagePath,
    status_from: lead.status,
    status_to: CANCELLATION_REQUEST_STATUS,
  });

  return data as unknown as LeadCancellationRequest;
}

export async function reviewCancellationRequest({
  request,
  lead,
  reviewerId,
  reviewerName,
  reviewerRole,
  action,
  reviewNote,
}: ReviewCancellationRequestArgs) {
  if (!canReviewCancellationRequest(reviewerRole, request)) {
    throw new Error("You do not have permission to review this cancellation request");
  }

  const now = new Date().toISOString();
  const { error: requestError } = await cancellationRequestsTable()
    .update({
      status: action,
      reviewed_by: reviewerId,
      reviewed_by_name: reviewerName || null,
      reviewed_at: now,
      review_note: reviewNote?.trim() || null,
    } as never)
    .eq("id", request.id);

  if (requestError) throw requestError;

  if (action === "approved") {
    const reason = [
      request.comment ? `Comment: ${request.comment}` : "",
      request.proof ? `Proof: ${request.proof}` : "",
      request.proof_image_path ? `Proof image: ${request.proof_image_path}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await updateLeadById(lead.id, {
        status: "cancelled" as LeadStatus,
        cancellation_reason: reason || null,
        cs_tag: null,
        last_edited_by: reviewerId,
        last_edited_by_name: reviewerName || null,
        updated_at: now,
        last_edited_at: now,
      });
  } else {
    const fallbackStatus = request.previous_status === "cancelled" ? "waiting_complete_details" : request.previous_status;
    const { data, error: leadError } = await supabase
      .from("leads")
      .update({
        status: fallbackStatus as LeadStatus,
        last_edited_by: reviewerId,
        last_edited_by_name: reviewerName || null,
        updated_at: now,
        last_edited_at: now,
      } as never)
      .eq("id", lead.id)
      .eq("status", CANCELLATION_REQUEST_STATUS)
      .select("id")
      .single();

    if (leadError) throw leadError;
    if (!data) throw new Error("Lead update was not applied. Refresh the page and try again.");
  }

  await logActivity(reviewerId, action === "approved" ? "cancellation_approved" : "cancellation_rejected", "lead", lead.id, {
    target_name: lead.job_id,
    customer_name: lead.customer_name,
    job_id: lead.job_id,
    requested_by_role: request.requested_by_role,
    comment: request.comment,
    proof: request.proof,
    review_note: reviewNote || null,
    status_to: action === "approved" ? "cancelled" : request.previous_status,
  });
}
