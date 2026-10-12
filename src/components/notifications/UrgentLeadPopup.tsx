import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X, ArrowUpRight } from "lucide-react";
import { useNotificationPopupSlot } from "./popup-slot";

interface UrgentNotification {
  id: string;
  title: string;
  message: string;
  lead_id: string | null;
  created_at: string;
  read: boolean;
}

/** One entry per lead, carrying every unread urgent notification for that lead. */
interface UrgentLeadGroup {
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

/** Messages embed the customer name in quotes: Lead "Jane Doe" changed to Urgent Job. */
function extractLeadName(message: string): string {
  const match = message.match(/"([^"]+)"/);
  return match ? match[1] : message;
}

export default function UrgentLeadPopup() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<UrgentNotification[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  // Ids dismissed locally but whose `read` write may not have landed yet — without this a poll
  // in that window refetches them as unread and the card the user just dismissed comes back.
  const dismissedIds = useRef<Set<string>>(new Set());

  // Every role gets urgent popups
  const eligible = Boolean(role);

  const fetchUrgent = useCallback(async () => {
    if (!user || !eligible) return;

    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .eq("read", false)
      .ilike("title", "%Urgent Job%")
      .order("created_at", { ascending: false })
      .limit(FETCH_LIMIT);

    if (!data) return;

    const rows = (data as UrgentNotification[]).filter((n) => !dismissedIds.current.has(n.id));
    const hasNew = rows.some((n) => !seenIds.current.has(n.id));
    rows.forEach((n) => seenIds.current.add(n.id));

    if (hasNew) {
      void import("@/lib/notification-sound").then(({ playUrgentAlertSound }) => {
        playUrgentAlertSound();
      });
    }

    setItems(rows);
  }, [user, eligible]);

  useEffect(() => {
    if (!eligible) return;
    void fetchUrgent();
    const interval = setInterval(fetchUrgent, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchUrgent, eligible]);

  // Realtime - surface the alert as it lands instead of up to POLL_MS later. Scoped to this
  // user's own notification rows, matching the Job in Progress and Quote Updated popups.
  useEffect(() => {
    if (!user || !eligible) return;

    const channel = supabase
      .channel(`urgent-lead-popup:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { title?: string } | undefined;
          if (row?.title?.toLowerCase().includes("urgent job")) {
            void fetchUrgent();
          }
        },
      )
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}`,
      }, () => { void fetchUrgent(); })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, eligible, fetchUrgent]);

  // Collapse per lead — the same lead flipped to Urgent twice is still one lead.
  const groups = useMemo<UrgentLeadGroup[]>(() => {
    const byLead = new Map<string, UrgentLeadGroup>();

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

  const isVisible = useNotificationPopupSlot("urgent", eligible && groups.length > 0);

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
    async (group: UrgentLeadGroup) => {
      await markRead(group.notificationIds);
      if (group.leadId) navigate(`/leads/${group.leadId}`);
    },
    [markRead, navigate],
  );

  const viewAllUrgent = useCallback(() => {
    dismissAll();
    navigate("/leads?status=urgent_job");
  }, [dismissAll, navigate]);

  // Only one full-screen popup renders at a time; Urgent Job outranks the others.
  if (!isVisible) return null;

  const single = groups.length === 1 ? groups[0] : null;
  const preview = groups.slice(0, PREVIEW_LIMIT);
  const hiddenCount = groups.length - preview.length;

  return (
    <>
      {/* Backdrop blocker - but we don't block clicks on rest of app, just dim slightly */}
      <div className="pointer-events-none fixed inset-0 z-[90] bg-foreground/10" />

      <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="pointer-events-auto flex w-full max-w-[520px] flex-col gap-3">
          <AnimatePresence initial={false}>
            <motion.div
              key={single ? single.key : "urgent-summary"}
              layout
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -10, transition: { duration: 0.18 } }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="relative overflow-hidden rounded-3xl border-2 border-amber-400/60 bg-card shadow-[0_40px_80px_-20px_rgba(234,179,8,0.55)]"
            >
              <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-300/50 animate-pulse" />

              <div className="flex items-start gap-4 p-6">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-600 ring-2 ring-amber-400/30 dark:text-amber-300">
                  <AlertTriangle className="h-7 w-7" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-amber-600 dark:text-amber-300">
                    {single ? single.title : `${groups.length} leads marked Urgent Job`}
                  </p>

                  {single ? (
                    <p className="mt-1.5 text-[14px] leading-6 text-foreground/90">{single.message}</p>
                  ) : (
                    <>
                      <p className="mt-1.5 text-[14px] leading-6 text-foreground/90">
                        {groups.length} leads need attention right now.
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
                          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(234,179,8,0.7)] transition-transform hover:-translate-y-0.5 hover:bg-amber-600"
                        >
                          Open lead <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      )
                    ) : (
                      <button
                        onClick={viewAllUrgent}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(234,179,8,0.7)] transition-transform hover:-translate-y-0.5 hover:bg-amber-600"
                      >
                        View urgent leads <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    )}

                    <button
                      onClick={dismissAll}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                      {single ? "Dismiss" : "Dismiss all"}
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
