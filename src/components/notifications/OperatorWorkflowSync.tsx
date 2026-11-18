import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { realtimeBus, relayTableToBus } from "@/lib/realtime";
import { useCrossTabOwner } from "@/hooks/useCrossTab";
import { isBackgroundPollPaused } from "@/lib/overload-guard";
import { useRealtimeAwareInterval, useRealtimeReconnect } from "@/lib/realtime-health";

/**
 * Copy-permission settings change only when an Admin edits them, so they are
 * not subscribed in every tab: they are re-read when a tab becomes visible and
 * every COPY_ACCESS_POLL_MS by one tab per browser (shared with the others).
 */
export const COPY_ACCESS_POLL_MS = 30000;

/** One listener/poll per session, not one subscription or timer per lead card. */
export default function OperatorWorkflowSync() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  // One tab per browser runs the safety-net timer; the refreshed queries are
  // shared, so other tabs receive the results without their own timer.
  const pollsHere = useCrossTabOwner(user ? `operator-workflow-sync:${user.id}:${role}` : null);
  const pollMs = useRealtimeAwareInterval(20000);
  const catchUp = useCallback(() => {
    if (!user) return;
    void queryClient.invalidateQueries({ queryKey: ["lead-copy-access", user.id, role] }, { cancelRefetch: false });
    void queryClient.invalidateQueries({ queryKey: ["lead-copy-settings"] }, { cancelRefetch: false });
    void queryClient.invalidateQueries({ queryKey: ["operator-hold-alerts", user.id, role] }, { cancelRefetch: false });
  }, [queryClient, user, role]);
  useRealtimeReconnect(catchUp, pollsHere);
  useEffect(() => {
    if (!user) return;
    const refreshCopy = () => {
      void queryClient.invalidateQueries({ queryKey: ["lead-copy-access", user.id, role] }, { cancelRefetch: false });
      void queryClient.invalidateQueries({ queryKey: ["lead-copy-settings"] }, { cancelRefetch: false });
    };
    const refreshHold = () => {
      void queryClient.invalidateQueries({ queryKey: ["operator-hold-alerts", user.id, role] }, { cancelRefetch: false });
    };
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      refreshCopy();
      refreshHold();
    };
    realtimeBus.addEventListener("lead_hold_alerts", refreshHold);
    const releaseHoldAlerts = relayTableToBus("lead_hold_alerts");
    document.addEventListener("visibilitychange", refresh);
    // Timer turns skip while the server is overloaded (see overload-guard).
    const timer = pollsHere ? window.setInterval(() => { if (!isBackgroundPollPaused()) refresh(); }, pollMs) : 0;
    const copyTimer = pollsHere
      ? window.setInterval(() => {
        if (!isBackgroundPollPaused() && document.visibilityState === "visible") refreshCopy();
      }, COPY_ACCESS_POLL_MS)
      : 0;
    return () => {
      realtimeBus.removeEventListener("lead_hold_alerts", refreshHold);
      releaseHoldAlerts();
      document.removeEventListener("visibilitychange", refresh);
      if (timer) window.clearInterval(timer);
      if (copyTimer) window.clearInterval(copyTimer);
    };
  }, [queryClient, user, role, pollsHere, pollMs]);
  return null;
}
