import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DollarSign, CheckCircle2, XCircle, User, MapPin } from "lucide-react";
import { InlineSuggestions } from "@/components/payments/InlineSuggestions";
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
import {
  canReviewPaymentRequest,
  reviewPaymentRequest,
  type LeadPaymentRequest,
} from "@/lib/payment-requests";
import type { Lead } from "@/types";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { getSignedUrl } from "@/lib/storage";

type Row = LeadPaymentRequest & { lead?: Lead | null; requester_name?: string | null };

const roleLabel: Record<string, string> = {
  customer_service: "CS",
  processor: "Processor",
  admin: "Admin",
};

interface ApprovedSuggestion {
  id: string;
  leadId: string;
  techName: string | null;
  techNumber: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  address: string | null;
  customerName: string;
}

function ScreenshotPreview({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSignedUrl(path).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-block">
      <img src={url} alt="Payment screenshot" className="max-h-40 rounded-lg border border-border/50" />
    </a>
  );
}

export default function LeadPaymentRequests() {
  const { role, user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [approvedSuggestions, setApprovedSuggestions] = useState<ApprovedSuggestion[]>([]);

  const { data: requests = [], isLoading } = useQuery<Row[]>({
    queryKey: ["lead-payment-requests-page"],
    queryFn: async () => {
      const { data: rows, error } = await supabase.from("lead_payment_requests")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const reqs = (rows ?? []) as unknown as LeadPaymentRequest[];
      const leadIds = reqs.map((r) => r.lead_id);
      const requesterIds = reqs.map((r) => r.requested_by).filter(Boolean) as string[];

      const [{ data: leads }, { data: profiles }] = await Promise.all([
        leadIds.length ? supabase.from("leads").select("*").in("id", leadIds) : Promise.resolve({ data: [] }),
        requesterIds.length
          ? supabase.from("profiles_public" as never).select("id, full_name").in("id", requesterIds)
          : Promise.resolve({ data: [] }),
      ]);
      const leadMap = new Map(((leads ?? []) as Lead[]).map((l) => [l.id, l]));
      const profMap = new Map(((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

      return reqs.map((r) => ({
        ...r,
        lead: leadMap.get(r.lead_id) ?? null,
        requester_name: (r.requested_by ? profMap.get(r.requested_by) : null) ?? r.requested_by_name ?? null,
      }));
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("lead-payment-requests-page-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_payment_requests" },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old;
            queryClient.setQueryData<Row[]>(["lead-payment-requests-page"], (old) => {
              if (!old) return old;
              return old.filter((r) => r.id !== oldRow.id);
            });
            return;
          }

          if (payload.eventType === "UPDATE") {
            const newRow = payload.new as LeadPaymentRequest;
            queryClient.setQueryData<Row[]>(["lead-payment-requests-page"], (old) => {
              if (!old) return old;
              if (newRow.status !== "pending") return old.filter((r) => r.id !== newRow.id);
              return old.map((r) => (r.id === newRow.id ? { ...r, ...newRow } : r));
            });
            return;
          }

          if (payload.eventType === "INSERT") {
            const newRow = payload.new as LeadPaymentRequest;
            if (newRow.status !== "pending") return;

            const { data: leadData } = await supabase.from("leads").select("*").eq("id", newRow.lead_id).single();
            let requesterName = newRow.requested_by_name || null;
            if (newRow.requested_by) {
              const { data: profile } = await supabase.from("profiles_public").select("full_name").eq("id", newRow.requested_by).maybeSingle();
              if (profile) requesterName = profile.full_name;
            }

            const enrichedRequest: Row = {
              ...newRow,
              lead: leadData as Lead,
              requester_name: requesterName,
            };

            queryClient.setQueryData<Row[]>(["lead-payment-requests-page"], (old) => {
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

  const handleReview = async (row: Row, action: "approved" | "rejected") => {
    if (!user || !row.lead) return;
    try {
      await reviewPaymentRequest({
        request: row,
        lead: row.lead,
        reviewerId: user.id,
        reviewerName: profile?.full_name || user.email || "Unknown user",
        reviewerRole: role,
        action,
      });
      toast.success(action === "approved" ? "Lead marked Paid" : "Paid request rejected");
      queryClient.invalidateQueries({ queryKey: ["lead-payment-requests-page"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pending-payment-requests-count"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to review request");
    }
  };

  const handleApprove = async (row: Row) => {
    if (!user || !row.lead) return;
    const lead = row.lead;

    setApprovedSuggestions((prev) => [
      ...prev,
      {
        id: row.id,
        leadId: lead.id,
        techName: lead.tech_name ?? null,
        techNumber: lead.tech_number ?? null,
        city: lead.city ?? null,
        state: lead.state ?? null,
        zip_code: lead.zip_code ?? null,
        address: lead.address ?? null,
        customerName: lead.customer_name || "this lead",
      },
    ]);

    await handleReview(row, "approved");
  };

  const dismissSuggestion = (id: string) => {
    setApprovedSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <section className="glass-panel-strong rounded-[28px] px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
            <DollarSign className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.035em]">Paid Approval Pending</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {requests.length} pending request{requests.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </section>

      {approvedSuggestions.length > 0 && (
        <div className="space-y-3">
          {approvedSuggestions.map((s) => (
            <Card key={s.id} className="overflow-hidden border-emerald-500/30">
              <CardContent className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <p className="text-sm font-medium text-emerald-600">
                    {s.customerName} approved
                  </p>
                  {s.techName && (
                    <span className="text-xs text-muted-foreground">
                      &middot; {s.techName}
                    </span>
                  )}
                </div>
                <InlineSuggestions
                  leadId={s.leadId}
                  techName={s.techName}
                  city={s.city}
                  state={s.state}
                  zip_code={s.zip_code}
                  address={s.address}
                  onDismissAll={() => dismissSuggestion(s.id)}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="h-40 rounded-2xl border border-border/40 skeleton-shimmer" />
      ) : requests.length === 0 && approvedSuggestions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
            No pending Paid requests.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {requests.map((row) => {
            const lead = row.lead;
            const canReview = canReviewPaymentRequest(role, row);
            return (
              <Card key={row.id} className="overflow-hidden border-border/60">
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold">{lead?.customer_name || "Missing lead"}</h2>
                        {lead && <StatusBadge status={lead.status} size="sm" />}
                        <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {lead?.job_id || row.lead_id}
                        </span>
                      </div>

                      {(lead?.tech_name || lead?.city || lead?.state) && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                          {lead?.tech_name && (
                            <span className="flex items-center gap-1.5 text-foreground">
                              <User className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="font-medium">{lead.tech_name}</span>
                              {lead.tech_number && (
                                <span className="text-muted-foreground">#{lead.tech_number}</span>
                              )}
                            </span>
                          )}
                          {(lead?.city || lead?.state) && (
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <MapPin className="h-3.5 w-3.5" />
                              {[lead.city, lead.state].filter(Boolean).join(", ")}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                        <p>Requested by {row.requester_name || roleLabel[row.requested_by_role] || row.requested_by_role}</p>
                        <p>Previous status: {row.previous_status.replace(/_/g, " ")}</p>
                      </div>

                      <div className="rounded-2xl border border-border/50 bg-muted/[0.16] p-3 text-sm">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Amount</p>
                        <p className="mt-1 text-lg font-semibold text-emerald-600">${Number(row.amount).toFixed(2)}</p>
                        {row.comment && (
                          <>
                            <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Comment</p>
                            <p className="mt-1 whitespace-pre-wrap">{row.comment}</p>
                          </>
                        )}
                        {row.screenshot_path && <ScreenshotPreview path={row.screenshot_path} />}
                      </div>
                    </div>

                    <div className="flex min-w-[220px] flex-col gap-2">
                      {canReview ? (
                        <>
                          <Button
                            className="gap-1.5"
                            onClick={() => handleApprove(row)}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Approve & mark paid
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="outline" className="gap-1.5">
                                <XCircle className="h-4 w-4" />
                                Decline request
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Decline payment request?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  The request will be declined and the lead will return to its previous status.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Go back</AlertDialogCancel>
                                <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleReview(row, "rejected")}>Decline request</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      ) : (
                        <p className="rounded-xl border border-border/60 px-3 py-2 text-center text-xs text-muted-foreground">
                          Waiting for Admin approval
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
