import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { subscribeToNotifications } from "@/lib/realtime";
import { useSharedRefresh } from "@/hooks/useCrossTab";
import { isAlertOfKind, readActiveAlerts, type ActiveAlert } from "@/lib/active-alerts";
import { useRealtimeAwareInterval, useRealtimeReconnect } from "@/lib/realtime-health";
import { cn } from "@/lib/utils";
import { healthSeverity, type HealthSeverity } from "@/lib/system-health-alert";

/** Realtime delivers these; the poll is only a safety net. */
const POLL_MS = 60_000;
const MAX_CARDS = 3;

/**
 * Overload warnings and critical alerts are red, unlike every other pop-up, so
 * they stand out. Critical adds a solid red header strip and a pulsing ring.
 */
const STYLE: Record<HealthSeverity, { box: string; icon: string; badge?: string; strip?: string; Icon: typeof AlertTriangle }> = {
  critical: {
    box: "border-red-600 bg-red-50 ring-4 ring-red-500/40 shadow-[0_20px_50px_-15px_rgba(220,38,38,0.8)] dark:bg-red-950/80",
    icon: "bg-red-600 text-white", badge: "bg-red-600 text-white", strip: "bg-red-600 motion-safe:animate-pulse", Icon: ShieldAlert,
  },
  warning: {
    box: "border-red-500 bg-red-50 ring-2 ring-red-500/30 shadow-[0_20px_50px_-20px_rgba(239,68,68,0.6)] dark:bg-red-950/60",
    icon: "bg-red-500/15 text-red-600 dark:text-red-400", badge: "bg-red-500/15 text-red-700 dark:text-red-300", strip: "bg-red-500/70", Icon: AlertTriangle,
  },
  ok: { box: "border-emerald-500/50 bg-card", icon: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", Icon: CheckCircle2 },
  info: { box: "border-border bg-card", icon: "bg-muted text-muted-foreground", Icon: Info },
};
const BADGE: Partial<Record<HealthSeverity, string>> = { critical: "CRITICAL", warning: "WARNING" };

/**
 * Overload early warning for Admins: a card in the corner (not a blocking
 * modal), so the Admin can act while it stays visible. Dismissing marks it read.
 */
export default function SystemHealthPopup() {
  const { user, role, fullyAuthenticated } = useAuth();
  const [items, setItems] = useState<ActiveAlert[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const dismissedIds = useRef<Set<string>>(new Set());
  const isEligible = role === "admin" && Boolean(user) && fullyAuthenticated;

  const userId = user?.id;
  const sharedKey = userId && isEligible ? `notifications:system-health:${userId}` : null;
  const read = useCallback(async () => {
    if (!user) return [];
    return readActiveAlerts(user.id, user.created_at, "system_health");
  }, [user]);

  const apply = useCallback((data: ActiveAlert[], isCurrent: () => boolean) => {
    const rows = data.filter((n) => !dismissedIds.current.has(n.id));
    const fresh = rows.filter((n) => !seenIds.current.has(n.id));
    rows.forEach((n) => seenIds.current.add(n.id));
    // Its own siren (not the lead chimes); the most severe new alert decides how long.
    const levels = fresh.map((n) => healthSeverity(n.title));
    const alarm = levels.includes("critical") ? "critical" : levels.includes("warning") ? "warning" : null;
    if (alarm) {
      void import("@/lib/notification-sound").then(({ playSystemAlarmSound }) => {
        if (isCurrent()) playSystemAlarmSound(alarm);
      });
    }
    setItems(rows);
  }, []);

  const { refresh, isOwner } = useSharedRefresh(sharedKey, read, apply);
  const pollMs = useRealtimeAwareInterval(POLL_MS);
  useRealtimeReconnect(() => { void refresh(); }, isEligible && isOwner);

  useEffect(() => {
    if (!isEligible) return;
    void refresh();
  }, [refresh, isEligible]);

  useEffect(() => {
    if (!isEligible || !isOwner) return;
    const interval = setInterval(refresh, pollMs);
    return () => clearInterval(interval);
  }, [refresh, isEligible, isOwner, pollMs]);

  useEffect(() => {
    if (!user || !isEligible) return;
    return subscribeToNotifications(user.id, (payload) => {
      if (payload.eventType === "INSERT" && isAlertOfKind(payload.new as { kind?: string; title?: string }, "system_health")) {
        void refresh();
      }
    });
  }, [user, isEligible, refresh]);

  const dismiss = useCallback(async (id: string) => {
    dismissedIds.current.add(id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }, []);

  const cards = useMemo(() => items.slice(0, MAX_CARDS), [items]);
  if (!isEligible || cards.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[95] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
      {cards.map((n) => {
        const severity = healthSeverity(n.title);
        const style = STYLE[severity];
        return (
          <section
            key={n.id}
            role={severity === "critical" ? "alert" : "status"}
            aria-label={n.title}
            className={cn("pointer-events-auto relative overflow-hidden rounded-2xl border-2 p-4", style.box)}
          >
            {style.strip && <div className={cn("absolute inset-x-0 top-0 h-1.5", style.strip)} aria-hidden="true" />}
            <div className="flex items-start gap-3">
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", style.icon)}>
                <style.Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                {BADGE[severity] && (
                  <span className={cn("mb-1 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider", style.badge)}>
                    {BADGE[severity]}
                  </span>
                )}
                <p className={cn("text-[13px] font-bold leading-5", BADGE[severity] ? "text-red-700 dark:text-red-300" : "text-foreground")}>{n.title}</p>
                <p className="mt-1 whitespace-pre-line text-[12px] leading-5 text-foreground/85">{n.message}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{new Date(n.created_at).toLocaleTimeString()}</p>
              </div>
              <button
                type="button"
                onClick={() => void dismiss(n.id)}
                aria-label={`Dismiss: ${n.title}`}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
