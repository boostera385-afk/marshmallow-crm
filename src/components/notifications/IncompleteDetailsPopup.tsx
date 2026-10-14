import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ClipboardList, X, ArrowUpRight } from "lucide-react";
import { useNotificationPopupSlot } from "./popup-slot";
import { subscribeToNotifications } from "@/lib/realtime";
import { useCoalescedRefresh } from "@/hooks/useCoalescedRefresh";

interface IncompleteDetailsNotification {
  id: string;
  title: string;
  message: string;
  lead_id: string | null;
  created_at: string;
}

/** One entry per lead, carrying every unread Incomplete details notification for that lead. */
interface IncompleteDetailsGroup {
  key: string;
  leadId: string | null;
  leadName: string;
  message: string;
  notificationIds: string[];
}

const POLL_MS = 20000;
/** Enough headroom to count a full backlog after the user has been away. */
const FETCH_LIMIT = 100;
/** How many leads the summary lists before collapsing the rest into "+N more". */
const PREVIEW_LIMIT = 5;

/** Messages embed the customer name in quotes: Lead "Jane Doe" is missing details. */
function extractLeadName(message: string): string {
  const match = message.match(/"([^"]+)"/);
  return match ? match[1] : message;
}

export default function IncompleteDetailsPopup() {
  const { user, role, fullyAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<IncompleteDetailsNotification[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  // Ids dismissed locally but whose `read` write may not have landed yet — without this a poll
  // in that window refetches them as unread and the card the user just dismissed comes back.
  const dismissedIds = useRef<Set<string>>(new Set());

  // The CS who owns the lead and the CS Admins overseeing them.
  const isEligible =
    (role === "customer_service" || role === "cs_admin") && Boolean(user) && fullyAuthenticated;

  const loadIncomplete = useCallback(async (isCurrent: () => boolean) => {
    if (!user || !isEligible) return;

    const { data } = await supabase
      .from("notifications")
      .select("id, title, message, lead_id, created_at")
      .eq("user_id", user.id)
      .eq("read", false)
      .ilike("title", "%Incomplete Details%")
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);

    if (!data || !isCurrent()) return;

    const rows = (data as IncompleteDetailsNotification[]).filter(
      (n) => !dismissedIds.current.has(n.id),
    );
    const hasNew = rows.some((n) => !seenIds.current.has(n.id));
    rows.forEach((n) => seenIds.current.add(n.id));

    if (hasNew) {
      void import("@/lib/notification-sound").then(({ playAssignmentSound }) => {
        if (isCurrent()) playAssignmentSound();
      });
    }

    setItems(rows);
  }, [user, isEligible]);
  const fetchIncomplete = useCoalescedRefresh(loadIncomplete);

  useEffect(() => {
    if (!isEligible) return;
    void fetchIncomplete();
    const interval = setInterval(fetchIncomplete, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchIncomplete, isEligible]);

  // Realtime so the popup lands the moment the tag is applied.
  useEffect(() => {
    if (!user || !isEligible) return;

    return subscribeToNotifications(user.id, (payload) => {
      const row = payload.new as { title?: string };
      if (payload.eventType === "INSERT" && row.title?.toLowerCase().includes("incomplete details")) {
        void fetchIncomplete();
      }
    });
  }, [user, isEligible, fetchIncomplete]);

  // Collapse per lead — the same lead flagged twice is still one lead to fix.
  const groups = useMemo<IncompleteDetailsGroup[]>(() => {
    const byLead = new Map<string, IncompleteDetailsGroup>();

    for (const n of items) {
      const key = n.lead_id ?? `notification:${n.id}`;
      const existing = byLead.get(key);

      if (existing) {
        existing.notificationIds.push(n.id);
        continue;
      }

      byLead.set(key, {
        key,
        leadId: n.lead_id,
        leadName: extractLeadName(n.message),
        message: n.message,
        notificationIds: [n.id],
      });
    }

    return [...byLead.values()];
  }, [items]);

  const isVisible = useNotificationPopupSlot("incompleteDetails", isEligible && groups.length > 0);

  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const dismissed = new Set(ids);
    ids.forEach((id) => dismissedIds.current.add(id));
    setItems((prev) => prev.filter((n) => !dismissed.has(n.id)));
    await supabase.from("notifications").update({ read: true }).in("id", ids);
  }, []);

  const dismissAll = useCallback(() => {
    void markRead(groups.flatMap((g) => g.notificationIds));
  }, [groups, markRead]);

  const openLead = useCallback(
    async (group: IncompleteDetailsGroup) => {
      await markRead(group.notificationIds);
      if (group.leadId) navigate(`/leads/${group.leadId}`);
    },
    [markRead, navigate],
  );

  if (!isVisible) return null;

  const single = groups.length === 1 ? groups[0] : null;
  const preview = groups.slice(0, PREVIEW_LIMIT);
  const hiddenCount = groups.length - preview.length;

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[90] bg-foreground/10" />

      <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="pointer-events-auto flex w-full max-w-[520px] flex-col gap-3">
          <AnimatePresence initial={false}>
            <motion.div
              key={single ? single.key : "incomplete-details-summary"}
              layout
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -10, transition: { duration: 0.18 } }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="relative overflow-hidden rounded-3xl border-2 border-rose-400/60 bg-card shadow-[0_40px_80px_-20px_rgba(244,63,94,0.45)]"
            >
              <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-rose-400 via-rose-500 to-rose-300/50 animate-pulse" />

              <div className="flex items-start gap-4 p-6">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-rose-400/15 text-rose-600 ring-2 ring-rose-400/30 dark:text-rose-300">
                  <ClipboardList className="h-7 w-7" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-rose-600 dark:text-rose-300">
                    {single ? "Incomplete details" : `${groups.length} leads are missing details`}
                  </p>

                  {single ? (
                    <p className="mt-1.5 text-[14px] leading-6 text-foreground/90">{single.message}</p>
                  ) : (
                    <>
                      <p className="mt-1.5 text-[14px] leading-6 text-foreground/90">
                        Complete these leads so they can be quoted.
                      </p>
                      <ul className="mt-2 space-y-1">
                        {preview.map((g) => (
                          <li key={g.key}>
                            {g.leadId ? (
                              <button
                                onClick={() => openLead(g)}
                                className="w-full truncate text-left text-[13px] leading-6 text-rose-700 underline-offset-2 transition-colors hover:underline dark:text-rose-200"
                              >
                                • {g.leadName}
                              </button>
                            ) : (
                              <span className="truncate text-[13px] leading-6 text-muted-foreground">
                                • {g.leadName}
                              </span>
                            )}
                          </li>
                        ))}
                        {hiddenCount > 0 && (
                          <li className="text-[13px] leading-6 text-muted-foreground">+ {hiddenCount} more</li>
                        )}
                      </ul>
                    </>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {single && single.leadId && (
                      <button
                        onClick={() => openLead(single)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(244,63,94,0.7)] transition-transform hover:-translate-y-0.5 hover:bg-rose-600"
                      >
                        Open lead <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    )}

                    <button
                      onClick={dismissAll}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                      {single ? "Dismiss" : `Dismiss all (${groups.length})`}
                    </button>
                  </div>
                </div>

                <button
                  onClick={dismissAll}
                  aria-label="Close"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
