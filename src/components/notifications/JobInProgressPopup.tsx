import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, X, ArrowUpRight, Wrench, MapPin, AlertCircle, Calendar } from "lucide-react";
import { useNotificationPopupSlot } from "./popup-slot";
import { subscribeToNotifications } from "@/lib/realtime";
import { useCoalescedRefresh } from "@/hooks/useCoalescedRefresh";

interface JobInProgressItem {
  notificationIds: string[];
  leadId: string | null;
  title: string;
  message: string;
  createdAt: string;
  customerName?: string;
  expectedCompletionDate?: string | null;
  techName?: string | null;
  serviceType?: string | null;
  city?: string | null;
  state?: string | null;
}

const POLL_MS = 25000;
/** Enough headroom to count a full backlog after the user has been away. */
const FETCH_LIMIT = 100;
/** How many jobs the summary lists before collapsing the rest into "+N more". */
const PREVIEW_LIMIT = 4;

export default function JobInProgressPopup() {
  const { user, role, fullyAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<JobInProgressItem[]>([]);
  // Ids dismissed locally but whose `read` write may not have landed yet — without this a poll
  // in that window refetches them as unread and the card the user just dismissed comes back.
  const dismissedIds = useRef<Set<string>>(new Set());

  // Only Admins and Processors receive Job in Progress popups
  const isEligible = (role === "admin" || role === "processor") && Boolean(user) && fullyAuthenticated;

  const loadReminders = useCallback(async (isCurrent: () => boolean) => {
    if (!user || !isEligible) return;

    try {
      // 1. Fetch unread Job in Progress notifications for this user
      const { data: notifications, error } = await supabase
        .from("notifications")
        .select("id, title, message, lead_id, created_at, read")
        .eq("user_id", user.id)
        .eq("read", false)
        .ilike("title", "%Job in Progress%")
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT);
      if (!isCurrent()) return;

      if (error || !notifications) {
        setItems([]);
        return;
      }

      const visible = notifications.filter((n) => !dismissedIds.current.has(n.id));
      if (visible.length === 0) {
        setItems([]);
        return;
      }

      // 2. Extract lead IDs to get up-to-date expected details
      const leadIds = visible
        .map((n) => n.lead_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      const leadDetailsMap = new Map<string, {
        customer_name: string;
        expected_completion_date: string | null;
        tech_name: string | null;
        service_type: string | null;
        city: string | null;
        state: string | null;
      }>();

      if (leadIds.length > 0) {
        const { data: leads } = await supabase
          .from("leads")
          .select("id, customer_name, expected_completion_date, tech_name, service_type, city, state")
          .in("id", [...new Set(leadIds)]);
        if (!isCurrent()) return;

        if (leads) {
          leads.forEach((l) => leadDetailsMap.set(l.id, l));
        }
      }

      // 3. One entry per lead — the same job reminded twice is still one job.
      const byLead = new Map<string, JobInProgressItem>();

      for (const n of visible) {
        const key = n.lead_id ?? `notification:${n.id}`;
        const existing = byLead.get(key);

        if (existing) {
          existing.notificationIds.push(n.id);
          continue;
        }

        const details = n.lead_id ? leadDetailsMap.get(n.lead_id) : undefined;
        byLead.set(key, {
          notificationIds: [n.id],
          leadId: n.lead_id,
          title: n.title,
          message: n.message,
          createdAt: n.created_at,
          customerName: details?.customer_name || "Lead",
          expectedCompletionDate: details?.expected_completion_date || null,
          techName: details?.tech_name || null,
          serviceType: details?.service_type || null,
          city: details?.city || null,
          state: details?.state || null,
        });
      }

      setItems([...byLead.values()]);
    } catch (err) {
      console.warn("Failed to fetch Job in Progress reminders", err);
    }
  }, [user, isEligible]);
  const fetchReminders = useCoalescedRefresh(loadReminders);

  useEffect(() => {
    if (!isEligible) return;
    void fetchReminders();
    const interval = setInterval(fetchReminders, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchReminders, isEligible]);

  // Realtime subscription for instant pop-up when notification is inserted
  useEffect(() => {
    if (!user || !isEligible) return;

    return subscribeToNotifications(user.id, (payload) => {
      const row = payload.new as { title?: string };
      if (payload.eventType === "INSERT" && row.title?.toLowerCase().includes("job in progress")) {
        void fetchReminders();
      }
    });
  }, [user, isEligible, fetchReminders]);

  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const dismissed = new Set(ids);
    ids.forEach((id) => dismissedIds.current.add(id));
    setItems((prev) => prev.filter((i) => !i.notificationIds.some((id) => dismissed.has(id))));
    await supabase.from("notifications").update({ read: true }).in("id", ids);
  }, []);

  const dismissAll = useCallback(() => {
    void markRead(items.flatMap((i) => i.notificationIds));
  }, [items, markRead]);

  const openLead = useCallback(
    async (item: JobInProgressItem) => {
      await markRead(item.notificationIds);
      if (item.leadId) {
        navigate(`/leads/${item.leadId}`);
      }
    },
    [markRead, navigate],
  );

  const viewAllInProgress = useCallback(() => {
    dismissAll();
    navigate("/leads?status=job_in_progress");
  }, [dismissAll, navigate]);

  const isVisible = useNotificationPopupSlot("jobInProgress", isEligible && items.length > 0);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const overdueCount = useMemo(
    () => items.filter((i) => (i.expectedCompletionDate ? i.expectedCompletionDate < today : false)).length,
    [items, today],
  );

  // Only one full-screen popup renders at a time; Urgent Job outranks this one.
  if (!isVisible) return null;

  const single = items.length === 1 ? items[0] : null;
  const preview = items.slice(0, PREVIEW_LIMIT);
  const hiddenCount = items.length - preview.length;

  const isOverdue = single?.expectedCompletionDate ? single.expectedCompletionDate < today : false;
  const isDueToday = single?.expectedCompletionDate ? single.expectedCompletionDate === today : false;

  return (
    <>
      {/* Dimmed backdrop in the middle of the screen */}
      <div className="pointer-events-none fixed inset-0 z-[95] bg-background/60 backdrop-blur-sm" />

      <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="pointer-events-auto flex w-full max-w-[540px] flex-col gap-3">
          <AnimatePresence initial={false}>
            <motion.div
              key={single ? single.notificationIds[0] : "job-in-progress-summary"}
              layout
              initial={{ opacity: 0, scale: 0.9, y: 25 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -15, transition: { duration: 0.18 } }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="relative overflow-hidden rounded-3xl border-2 border-sky-400/60 bg-card p-0 shadow-[0_30px_70px_-15px_rgba(14,165,233,0.35)] dark:shadow-[0_30px_70px_-15px_rgba(2,132,199,0.25)]"
            >
              {/* Top gradient highlight bar */}
              <div className="h-1.5 w-full bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-400 animate-pulse" />

              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600 ring-2 ring-sky-400/30 dark:bg-sky-500/20 dark:text-sky-300">
                    <Clock className="h-6 w-6" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold uppercase tracking-wide text-sky-600 dark:text-sky-400">
                        Job in Progress
                      </span>

                      {single ? (
                        <>
                          {isOverdue && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                              <AlertCircle className="h-3 w-3" />
                              Overdue
                            </span>
                          )}
                          {isDueToday && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                              <Clock className="h-3 w-3" />
                              Due Today
                            </span>
                          )}
                        </>
                      ) : (
                        overdueCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                            <AlertCircle className="h-3 w-3" />
                            {overdueCount} overdue
                          </span>
                        )
                      )}
                    </div>

                    {single ? (
                      <>
                        <h3 className="mt-1 truncate text-[17px] font-bold text-foreground">{single.customerName}</h3>

                        {/* Expected Job Details Card */}
                        <div className="mt-3 grid grid-cols-1 gap-2 rounded-2xl border border-border/60 bg-muted/30 p-3 text-[12px] sm:grid-cols-2">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                            <span>Expected:</span>
                            <span className="font-semibold text-foreground">
                              {single.expectedCompletionDate || "Not specified"}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Wrench className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                            <span>Technician:</span>
                            <span className="truncate font-semibold text-foreground">
                              {single.techName || "Unassigned"}
                            </span>
                          </div>

                          {single.serviceType && (
                            <div className="col-span-1 flex items-center gap-2 text-muted-foreground sm:col-span-2">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                              <span>Service:</span>
                              <span className="truncate font-medium text-foreground">{single.serviceType}</span>
                            </div>
                          )}

                          {(single.city || single.state) && (
                            <div className="col-span-1 flex items-center gap-2 text-muted-foreground sm:col-span-2">
                              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate">
                                {[single.city, single.state].filter(Boolean).join(", ")}
                              </span>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <h3 className="mt-1 text-[17px] font-bold text-foreground">
                          {items.length} jobs in progress need a check
                        </h3>

                        <ul className="mt-3 space-y-1.5 rounded-2xl border border-border/60 bg-muted/30 p-3 text-[12px]">
                          {preview.map((item) => (
                            <li
                              key={item.notificationIds[0]}
                              className="flex items-center justify-between gap-3 text-muted-foreground"
                            >
                              <span className="truncate font-medium text-foreground">{item.customerName}</span>
                              <span className="shrink-0 tabular-nums">
                                {item.expectedCompletionDate || "No date"}
                              </span>
                            </li>
                          ))}
                          {hiddenCount > 0 && (
                            <li className="text-muted-foreground">+ {hiddenCount} more</li>
                          )}
                        </ul>
                      </>
                    )}

                    {/* Action Buttons */}
                    <div className="mt-4 flex flex-wrap items-center gap-2.5">
                      {single ? (
                        single.leadId && (
                          <button
                            type="button"
                            onClick={() => openLead(single)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-sky-700 hover:shadow"
                          >
                            Open Lead <ArrowUpRight className="h-3.5 w-3.5" />
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={viewAllInProgress}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-sky-700 hover:shadow"
                        >
                          View jobs in progress <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={dismissAll}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
                      >
                        {single ? "Dismiss" : `Dismiss all (${items.length})`}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={dismissAll}
                    aria-label="Dismiss notification"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
