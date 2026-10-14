import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FileCheck, X, ArrowUpRight } from "lucide-react";
import { useNotificationPopupSlot } from "./popup-slot";
import { subscribeToNotifications } from "@/lib/realtime";
import { useCoalescedRefresh } from "@/hooks/useCoalescedRefresh";

interface QuoteUpdatedNotification {
  id: string;
  title: string;
  message: string;
  lead_id: string | null;
  created_at: string;
}

/** One entry per lead, carrying every unread quote notification for that lead. */
interface QuoteUpdatedGroup {
  key: string;
  leadId: string | null;
  leadName: string;
  title: string;
  message: string;
  notificationIds: string[];
}

const POLL_MS = 20000;
/** Enough headroom to count a full backlog after the user has been away. */
const FETCH_LIMIT = 100;
/** How many lead names the summary lists before collapsing the rest into "+N more". */
const PREVIEW_LIMIT = 4;
/** Per user: a second account signing in on the same tab must not inherit the first one's cutoff. */
const baselineKey = (userId: string) => `quote_updated_popup_baseline_at:${userId}`;

function getOrInitBaseline(userId: string): string {
  try {
    const key = baselineKey(userId);
    let v = window.sessionStorage.getItem(key);
    if (!v) {
      v = new Date().toISOString();
      window.sessionStorage.setItem(key, v);
    }
    return v;
  } catch {
    return new Date().toISOString();
  }
}

/** Messages embed the customer name in quotes: Quote for lead "Jane Doe" has been updated. */
function extractLeadName(message: string): string {
  const match = message.match(/"([^"]+)"/);
  return match ? match[1] : message;
}

export default function QuoteUpdatedPopup() {
  const { user, role, fullyAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<QuoteUpdatedNotification[]>([]);
  const baselineRef = useRef<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  // Ids dismissed locally but whose `read` write may not have landed yet — without this a poll
  // in that window refetches them as unread and the card the user just dismissed comes back.
  const dismissedIds = useRef<Set<string>>(new Set());

  // Only CS and CS Admin receive these popups
  const isEligible =
    (role === "customer_service" || role === "cs_admin") &&
    Boolean(user) &&
    fullyAuthenticated;

  const loadUpdated = useCallback(async (isCurrent: () => boolean) => {
    if (!user || !isEligible) return;

    if (!baselineRef.current) baselineRef.current = getOrInitBaseline(user.id);

    const { data } = await supabase
      .from("notifications")
      .select("id, title, message, lead_id, created_at")
      .eq("user_id", user.id)
      .eq("read", false)
      .ilike("title", "%Quote Updated%")
      .gt("created_at", baselineRef.current)
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);

    if (!data || !isCurrent()) return;

    const rows = (data as QuoteUpdatedNotification[]).filter((n) => !dismissedIds.current.has(n.id));
    const hasNew = rows.some((n) => !seenIds.current.has(n.id));
    rows.forEach((n) => seenIds.current.add(n.id));

    if (hasNew) {
      void import("@/lib/notification-sound").then(({ playAssignmentSound }) => {
        if (isCurrent()) playAssignmentSound();
      });
    }

    setItems(rows);
  }, [user, isEligible]);
  const fetchUpdated = useCoalescedRefresh(loadUpdated);

  // Polling
  useEffect(() => {
    if (!isEligible) return;
    void fetchUpdated();
    const interval = setInterval(fetchUpdated, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchUpdated, isEligible]);

  // Realtime — fire immediately when notification is inserted
  useEffect(() => {
    if (!user || !isEligible) return;

    return subscribeToNotifications(user.id, (payload) => {
      const row = payload.new as { title?: string };
      if (payload.eventType === "INSERT" && row.title?.toLowerCase().includes("quote updated")) {
        void fetchUpdated();
      }
    });
  }, [user, isEligible, fetchUpdated]);

  // Collapse per lead — the same quote updated twice is still one lead.
  const groups = useMemo<QuoteUpdatedGroup[]>(() => {
    const byLead = new Map<string, QuoteUpdatedGroup>();

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
        title: n.title,
        message: n.message,
        notificationIds: [n.id],
      });
    }

    return [...byLead.values()];
  }, [items]);

  const isVisible = useNotificationPopupSlot("quoteUpdated", isEligible && groups.length > 0);

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
    async (group: QuoteUpdatedGroup) => {
      await markRead(group.notificationIds);
      if (group.leadId) navigate(`/leads/${group.leadId}`);
    },
    [markRead, navigate],
  );

  const viewAllUpdated = useCallback(() => {
    dismissAll();
    navigate("/leads?status=quote_updated");
  }, [dismissAll, navigate]);

  // Only one full-screen popup renders at a time; this one has the lowest priority.
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
              key={single ? single.key : "quote-updated-summary"}
              layout
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -10, transition: { duration: 0.18 } }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="relative overflow-hidden rounded-3xl border-2 border-blue-400/60 bg-card shadow-[0_40px_80px_-20px_rgba(59,130,246,0.40)]"
            >
              <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-blue-400 via-indigo-400 to-blue-300/50 animate-pulse" />

              <div className="flex items-start gap-4 p-6">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-400/15 text-blue-600 ring-2 ring-blue-400/30 dark:text-blue-300">
                  <FileCheck className="h-7 w-7" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-blue-600 dark:text-blue-300">
                    {single ? single.title : `${groups.length} quotes updated`}
                  </p>

                  {single ? (
                    <p className="mt-1.5 text-[14px] leading-6 text-foreground/90">{single.message}</p>
                  ) : (
                    <>
                      <p className="mt-1.5 text-[14px] leading-6 text-foreground/90">
                        {groups.length} leads have an updated quote.
                      </p>
                      <ul className="mt-2 space-y-1">
                        {preview.map((g) => (
                          <li key={g.key} className="truncate text-[13px] leading-5 text-muted-foreground">
                            • {g.leadName}
                          </li>
                        ))}
                        {hiddenCount > 0 && (
                          <li className="text-[13px] leading-5 text-muted-foreground">+ {hiddenCount} more</li>
                        )}
                      </ul>
                    </>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {single ? (
                      single.leadId && (
                        <button
                          onClick={() => openLead(single)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(59,130,246,0.7)] transition-transform hover:-translate-y-0.5 hover:bg-blue-700"
                        >
                          Open lead <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      )
                    ) : (
                      <button
                        onClick={viewAllUpdated}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(59,130,246,0.7)] transition-transform hover:-translate-y-0.5 hover:bg-blue-700"
                      >
                        View updated quotes <ArrowUpRight className="h-3.5 w-3.5" />
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
