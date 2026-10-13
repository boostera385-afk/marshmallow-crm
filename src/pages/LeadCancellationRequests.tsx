import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, XCircle, User, History, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import StatusBadge from "@/components/leads/StatusBadge";
import { canReviewCancellationRequest, reviewCancellationRequest } from "@/lib/cancellation-requests";
import type { Lead, LeadCancellationRequest } from "@/types";
import { toast } from "sonner";

type RequestWithLead = LeadCancellationRequest & {
  lead?: Lead | null;
  requester_name?: string | null;
};

const roleLabel: Record<string, string> = {
  customer_service: "CS",
  processor: "Processor",
  admin: "Admin",
};

export default function LeadCancellationRequests() {
  const { role, user, profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: requests = [], isLoading } = useQuery<RequestWithLead[]>({
    queryKey: ["lead-cancellation-requests-page"],
    queryFn: async () => {
      const { data: requestRows, error } = await supabase
        .from("lead_cancellation_requests")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;
      const rows = (requestRows ?? []) as unknown as LeadCancellationRequest[];
      const leadIds = rows.map((row) => row.lead_id);
      const requesterIds = rows.map((row) => row.requested_by).filter(Boolean) as string[];

      const [{ data: leads }, { data: profiles }] = await Promise.all([
        leadIds.length ? supabase.from("leads").select("*").in("id", leadIds) : Promise.resolve({ data: [] }),
        requesterIds.length ? supabase.from("profiles_public" as never).select("id, full_name").in("id", requesterIds) : Promise.resolve({ data: [] }),
      ]);

      const leadById = new Map(((leads ?? []) as Lead[]).map((lead) => [lead.id, lead]));
      const requesterById = new Map(((profiles ?? []) as { id: string; full_name: string }[]).map((profile) => [profile.id, profile.full_name]));

      return rows.map((request) => ({
        ...request,
        lead: leadById.get(request.lead_id) ?? null,
        requester_name: (request.requested_by ? requesterById.get(request.requested_by) : null) ?? request.requested_by_name ?? null,
      }));
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("cancellation-page-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_cancellation_requests" },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old;
            queryClient.setQueryData<RequestWithLead[]>(["lead-cancellation-requests-page"], (old) => {
              if (!old) return old;
              return old.filter((r) => r.id !== oldRow.id);
            });
            return;
          }
          
          if (payload.eventType === "UPDATE") {
            const newRow = payload.new as LeadCancellationRequest;
            queryClient.setQueryData<RequestWithLead[]>(["lead-cancellation-requests-page"], (old) => {
              if (!old) return old;
              if (newRow.status !== "pending") return old.filter((r) => r.id !== newRow.id);
              return old.map((r) => (r.id === newRow.id ? { ...r, ...newRow } : r));
            });
            return;
          }

          if (payload.eventType === "INSERT") {
            const newRow = payload.new as LeadCancellationRequest;
            if (newRow.status !== "pending") return;
            
            const { data: leadData } = await supabase.from("leads").select("*").eq("id", newRow.lead_id).single();
            let requesterName = newRow.requested_by_name || null;
            if (newRow.requested_by) {
              const { data: profile } = await supabase.from("profiles_public").select("full_name").eq("id", newRow.requested_by).maybeSingle();
              if (profile) requesterName = profile.full_name;
            }
            
            const enrichedRequest: RequestWithLead = {
              ...newRow,
              lead: leadData as Lead,
              requester_name: requesterName,
            };
            
            queryClient.setQueryData<RequestWithLead[]>(["lead-cancellation-requests-page"], (old) => {
              if (!old) return old;
              return [enrichedRequest, ...old];
            });
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const handleReview = async (request: RequestWithLead, action: "approved" | "rejected") => {
    if (!user || !request.lead) return;
    try {
      await reviewCancellationRequest({
        request,
        lead: request.lead,
        reviewerId: user.id,
        reviewerName: profile?.full_name || user.email || "Unknown user",
        reviewerRole: role,
        action,
      });
      toast.success(action === "approved" ? "Lead cancelled" : "Cancellation request rejected");
      queryClient.invalidateQueries({ queryKey: ["lead-cancellation-requests-page"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to review request");
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <section className="glass-panel-strong rounded-[28px] px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-destructive/15 bg-destructive/[0.08]">
            <AlertCircle className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.035em]">Lead Cancellation Requests</h1>
            <p className="mt-1 text-sm text-muted-foreground">{requests.length} pending request{requests.length === 1 ? "" : "s"}</p>
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="h-40 rounded-2xl border border-border/40 skeleton-shimmer" />
      ) : requests.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
            No pending cancellation requests.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {requests.map((request) => {
            const lead = request.lead;
            const canReview = canReviewCancellationRequest(role, request);
            return (
              <Card key={request.id} className="overflow-hidden border-border/60">
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold">{lead?.customer_name || "Missing lead"}</h2>
                        {lead && <StatusBadge status={lead.status} size="sm" />}
                        <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {lead?.job_id || request.lead_id}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <User className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                          <span>Requested by</span>
                          <span className="font-medium text-foreground">
                            {request.requester_name || roleLabel[request.requested_by_role] || request.requested_by_role}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <History className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                          <span>Previous status:</span>
                          <StatusBadge status={request.previous_status} size="sm" />
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/50 bg-muted/[0.16] p-3 text-sm">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Reason</p>
                        <p className="mt-1 whitespace-pre-wrap">{request.comment}</p>
                        {request.proof && <p className="mt-2 break-words text-muted-foreground">Proof: {request.proof}</p>}
                        {request.proof_image_path && (
                          <p className="mt-2 break-words text-muted-foreground">Image: {request.proof_image_path}</p>
                        )}
                      </div>

                      {request.ai_reason_code && (
                        <div className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.06] p-3 text-sm">
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-500" />
                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-600 dark:text-purple-300">
                              AI suggestion
                            </p>
                            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${request.ai_reason_applied ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                              {request.ai_reason_applied ? "Applied by staff" : "Not applied"}
                            </span>
                          </div>
                          <p className="mt-1.5 font-medium">{request.ai_reason_code}</p>
                          {request.ai_suggested_reason && (
                            <p className="mt-0.5 text-muted-foreground">{request.ai_suggested_reason}</p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex min-w-[220px] flex-col gap-2">
                      {canReview ? (
                        <>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button className="gap-1.5">
                                <CheckCircle2 className="h-4 w-4" />
                                Approve cancellation
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Confirm cancellation</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will cancel the job for {lead?.customer_name || "this customer"} and close the request.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Go back</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleReview(request, "approved")}>Approve cancellation</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="outline" className="gap-1.5">
                                <XCircle className="h-4 w-4" />
                                Decline request
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Decline cancellation request?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  The lead will remain in its prior status and the requester will see that this request was declined.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Go back</AlertDialogCancel>
                                <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleReview(request, "rejected")}>Decline request</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      ) : (
                        <p className="rounded-xl border border-border/60 px-3 py-2 text-center text-xs text-muted-foreground">
                          {request.requested_by_role === "processor" ? "Waiting for Admin approval" : "Waiting for Admin or Processor approval"}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
