import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Clock, Inbox, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import {
  canReviewUrgentRequests,
  listUrgentReviewRequests,
  reviewUrgentRequest,
  type UrgentReviewStatus,
  type UrgentReviewRequest,
} from "@/lib/urgent-verification";
import { silkySpring } from "@/lib/motion";
import { backgroundInterval } from "@/lib/overload-guard";

const QUERY_KEY = ["urgent-review-requests"];

const TABS: { key: UrgentReviewStatus; label: string }[] = [
  { key: "pending", label: "Awaiting review" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
];

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-muted text-muted-foreground",
};

/**
 * CS Admin queue for leads the AI check disagreed with.
 *
 * A row only exists when the check found a genuine contradiction. A clean lead
 * goes straight to urgent, and a lead with no conversation to check needs an
 * acknowledgement rather than a reviewer, so neither lands here. That keeps this
 * list short enough to actually be read.
 *
 * Approval runs through review_urgent_request(), a SECURITY DEFINER function, so
 * the decision and the status change commit together and cannot disagree. It
 * sets urgent only. The agreed schedule is left exactly as the customer left it,
 * which is usually the thing that was wrong in the first place.
 */
export default function UrgentReviewRequests() {
  const { role, user } = useAuth();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<UrgentReviewStatus>("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const allowed = canReviewUrgentRequests(role);

  const requestsQuery = useQuery({
    queryKey: [...QUERY_KEY, tab],
    queryFn: () => listUrgentReviewRequests(tab),
    enabled: allowed,
    refetchInterval: backgroundInterval(30_000),
    refetchIntervalInBackground: false,
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
      reviewUrgentRequest({ requestId: id, approve, note: notes[id]?.trim() || null }),
    onSuccess: (message) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      setNotes((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => delete next[key]);
        return next;
      });
      toast.success(message);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!allowed) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            This queue is for CS Admins.
          </CardContent>
        </Card>
      </div>
    );
  }

  const requests = requestsQuery.data ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">Urgent review</h1>
          <p className="text-sm text-muted-foreground">
            Leads a customer service member wanted urgent, and the conversation did not agree.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              onClick={() => setTab(entry.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === entry.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {requestsQuery.isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      )}

      {!requestsQuery.isLoading && requests.length === 0 && (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <Inbox className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p>Nothing {tab === "pending" ? "waiting for review" : `marked ${tab}`}.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {requests.map((request, index) => (
          <ReviewCard
            key={request.id}
            request={request}
            index={index}
            reduceMotion={!!reduceMotion}
            note={notes[request.id] ?? ""}
            onNoteChange={(value) => setNotes((prev) => ({ ...prev, [request.id]: value }))}
            busy={reviewMutation.isPending}
            viewerId={user?.id ?? null}
            viewerIsAdmin={role === "admin"}
            onApprove={() => reviewMutation.mutate({ id: request.id, approve: true })}
            onDecline={() => reviewMutation.mutate({ id: request.id, approve: false })}
          />
        ))}
      </div>
    </div>
  );
}

function ReviewCard({
  request, index, reduceMotion, note, onNoteChange, busy, viewerId, viewerIsAdmin, onApprove, onDecline,
}: {
  request: UrgentReviewRequest;
  index: number;
  reduceMotion: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  busy: boolean;
  viewerId: string | null;
  viewerIsAdmin: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const issues = request.ai_issues ?? [];
  const settled = request.status !== "pending";
  // review_urgent_request() refuses this in the database, so the buttons are
  // disabled here too rather than letting someone press one and eat the error.
  // An admin is exempt, because they can already set urgent directly and are the
  // escalation path when no second CS Admin is around.
  const isOwnRequest = !!viewerId && request.requested_by === viewerId;
  const blockedBySelfReview = isOwnRequest && !viewerIsAdmin;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { ...silkySpring, delay: Math.min(index * 0.04, 0.2) }}
    >
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{request.lead_job_id || "Unnumbered lead"}</span>
                {request.lead_customer_name && (
                  <span className="text-sm text-muted-foreground">{request.lead_customer_name}</span>
                )}
                <Badge variant="outline" className="text-xs">
                  {request.current_status || request.previous_status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Raised by {request.requested_by_name || "Unknown"}
                {request.ai_model ? ` · ${request.ai_model}` : ""}
              </p>
            </div>
            <Badge variant="outline" className="flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" />
              {issues.length} finding{issues.length === 1 ? "" : "s"}
            </Badge>
          </div>

          {request.ai_summary && (
            <p className="text-sm bg-muted/60 rounded-md p-3">{request.ai_summary}</p>
          )}

          <div className="space-y-2">
            {issues.map((issue, i) => (
              <div key={`${issue.check}-${i}`} className="rounded-md border p-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {issue.check?.replace(/_/g, " ")}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_STYLE[issue.severity] ?? SEVERITY_STYLE.low}`}>
                    {issue.severity}
                  </span>
                  {issue.field && <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{issue.field}</code>}
                </div>
                <p className="text-sm">{issue.problem}</p>
                {issue.evidence && (
                  <blockquote className="text-sm text-muted-foreground border-l-2 pl-3 italic">
                    “{issue.evidence}”
                  </blockquote>
                )}
              </div>
            ))}
          </div>

          {request.current_customer_schedule_requirements && (
            <p className="text-xs text-muted-foreground">
              Schedule on record: <span className="text-foreground">{request.current_customer_schedule_requirements}</span>
            </p>
          )}

          {settled ? (
            <p className="text-sm text-muted-foreground">
              {request.status === "approved" ? "Approved" : "Declined"}
              {request.reviewed_by_name ? ` by ${request.reviewed_by_name}` : ""}
              {request.review_note ? ` — ${request.review_note}` : ""}
            </p>
          ) : (
            <>
              <Textarea
                placeholder="Note for the requester (optional)"
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
                rows={2}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={onDecline} disabled={busy || blockedBySelfReview}>
                  <X className="h-4 w-4" /> Decline
                </Button>
                <Button onClick={onApprove} disabled={busy || blockedBySelfReview}>
                  <Check className="h-4 w-4" /> Approve as urgent
                </Button>
              </div>
              {blockedBySelfReview && (
                <p className="text-xs text-muted-foreground text-right">
                  You raised this one. Another CS Admin or an Admin needs to approve it.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}