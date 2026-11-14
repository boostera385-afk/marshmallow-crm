import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Clock, Inbox, Star, X } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { TECHNICIANS_ROOT_KEY } from "@/lib/technicians";
import {
  canReviewTechnicianChanges,
  describeChangeType,
  isAlreadyApplied,
  listTechnicianChangeRequests,
  reviewTechnicianChange,
  type TechnicianChangeStatus,
} from "@/lib/tech-change-requests";
import { silkySpring } from "@/lib/motion";
import { backgroundInterval } from "@/lib/overload-guard";

import { formatDateTime } from "@/lib/date-time-format";
const QUERY_KEY = ["tech-change-requests"];

const TABS: { key: TechnicianChangeStatus; label: string }[] = [
  { key: "pending", label: "Awaiting approval" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
];

/**
 * Admin review queue for technician flag changes.
 *
 * Approval runs through a SECURITY DEFINER function rather than a client-side
 * write, so the queue and the technician row cannot disagree: the status
 * change and the flag change commit in the same transaction.
 */
export default function TechnicianChangeApprovals() {
  const { role, profile } = useAuth();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<TechnicianChangeStatus>("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const allowed = canReviewTechnicianChanges(role);

  const requestsQuery = useQuery({
    queryKey: [...QUERY_KEY, tab],
    queryFn: () => listTechnicianChangeRequests(tab),
    enabled: allowed,
    refetchInterval: backgroundInterval(30_000),
    refetchIntervalInBackground: false,
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const message = await reviewTechnicianChange({
        requestId: id,
        approve,
        note: notes[id]?.trim() || null,
        reviewerId: profile?.id ?? "",
      });
      return message;
    },
    onSuccess: (message) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      // Approval writes the technicians row, so the directory list is now
      // stale. Its query holds a 30 second staleTime, so without this an admin
      // who approves and navigates straight to Technicians sees the old flag
      // and it looks like the approval did not take, even though it did.
      void queryClient.invalidateQueries({ queryKey: TECHNICIANS_ROOT_KEY });
      void queryClient.invalidateQueries({ queryKey: ["tech-pending-changes"] });
      setNotes((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => delete next[k]);
        return next;
      });
      toast.success(message);
    },
    onError: (err: Error) =>
      toast.error("Could not review the request", { description: err.message }),
  });

  if (!allowed) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">
        Technician change approvals are available to administrators only.
      </div>
    );
  }

  const requests = requestsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Technician Approvals
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Processors cannot change Good Tech or active status directly. Approving here
            applies the change immediately; declining leaves the technician untouched and
            tells the requester why.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-muted/40 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {requestsQuery.isError ? (
        <p className="text-sm text-destructive">
          Could not load the queue. If the technician approvals migration has not been
          applied, <code>list_technician_change_requests</code> does not exist.
        </p>
      ) : requestsQuery.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Inbox className="h-6 w-6 opacity-60" />
            {tab === "pending"
              ? "No pending technician change requests."
              : `No ${tab} technician change requests.`}
          </CardContent>
        </Card>
      ) : (
        <motion.ul
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: reduceMotion ? 0 : 0.05 } } }}
          className="space-y-3"
        >
          {requests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              note={notes[request.id] ?? ""}
              onNoteChange={(value) =>
                setNotes((prev) => ({ ...prev, [request.id]: value }))
              }
              busy={reviewMutation.isPending}
              onApprove={() => reviewMutation.mutate({ id: request.id, approve: true })}
              onDecline={() => reviewMutation.mutate({ id: request.id, approve: false })}
            />
          ))}
        </motion.ul>
      )}
    </div>
  );
}

function RequestRow({
  request,
  note,
  onNoteChange,
  busy,
  onApprove,
  onDecline,
}: {
  request: import("@/lib/tech-change-requests").TechnicianChangeRequest;
  note: string;
  onNoteChange: (value: string) => void;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { label, column } = describeChangeType(request.change_type);
  const isPending = request.status === "pending";

  // The flag may have moved on its own while the request waited. Approving then
  // would be meaningless, so it is surfaced rather than silently applied.
  const alreadyApplied = isAlreadyApplied(
    request,
    request.current_is_good_tech,
    request.current_is_active,
  );

  return (
    <motion.li
      variants={{
        hidden: reduceMotion ? {} : { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: { ...silkySpring } },
      }}
      className="rounded-2xl border border-border/60 bg-card/70 p-4"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">{request.technician_name}</span>
            <Badge variant="outline" className="gap-1 border-border/50 text-[11px]">
              {request.change_type === "set_good_tech" ? (
                <Star className="h-3 w-3" />
              ) : (
                <Clock className="h-3 w-3" />
              )}
              {label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {String(request.previous_value ? "Yes" : "No")} →{" "}
              <span
                className={
                  request.requested_value
                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                    : "font-semibold text-amber-600 dark:text-amber-400"
                }
              >
                {request.requested_value ? "Yes" : "No"}
              </span>
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Requested by {request.requested_by_name ?? "Unknown"} ·{" "}
            {formatDateTime(request.created_at)}
          </p>

          {request.reason ? (
            <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-foreground/90">
              {request.reason}
            </p>
          ) : null}

          {isPending && alreadyApplied ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {column} already holds this value, so approving would change nothing. The
              technician was probably updated directly in the meantime.
            </p>
          ) : null}

          {!isPending ? (
            <p className="text-xs text-muted-foreground">
              {request.status === "approved" ? "Approved" : "Declined"} by{" "}
              {request.reviewed_by_name ?? "Unknown"}
              {request.reviewed_at
                ? ` · ${formatDateTime(request.reviewed_at)}`
                : ""}
              {request.review_note ? ` · “${request.review_note}”` : ""}
            </p>
          ) : null}
        </div>

        {isPending ? (
          <div className="flex w-full shrink-0 flex-col gap-2 lg:w-72">
            <Textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Optional note. A decline reads better with a reason."
              rows={2}
              className="text-xs"
              aria-label={`Note for the ${label} request on ${request.technician_name}`}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-8 flex-1 gap-1.5 text-xs"
                disabled={busy}
                onClick={onApprove}
              >
                <Check className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 flex-1 gap-1.5 text-xs"
                disabled={busy}
                onClick={onDecline}
              >
                <X className="h-3.5 w-3.5" />
                Decline
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </motion.li>
  );
}

