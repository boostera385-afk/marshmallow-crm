import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { realtimeBus } from "@/lib/realtime";
import { useCrossTabOwner } from "@/hooks/useCrossTab";
import { isBackgroundPollPaused } from "@/lib/overload-guard";
import { useRealtimeAwareInterval, useRealtimeReconnect } from "@/lib/realtime-health";

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
    realtimeBus.addEventListener("lead_copy_role_permissions", refreshCopy);
    realtimeBus.addEventListener("lead_copy_user_permissions", refreshCopy);
    realtimeBus.addEventListener("lead_hold_alerts", refreshHold);
    document.addEventListener("visibilitychange", refresh);
    // Timer turns skip while the server is overloaded (see overload-guard).
    const timer = pollsHere ? window.setInterval(() => { if (!isBackgroundPollPaused()) refresh(); }, pollMs) : 0;
    return () => {
      realtimeBus.removeEventListener("lead_copy_role_permissions", refreshCopy);
      realtimeBus.removeEventListener("lead_copy_user_permissions", refreshCopy);
      realtimeBus.removeEventListener("lead_hold_alerts", refreshHold);
      document.removeEventListener("visibilitychange", refresh);
      if (timer) window.clearInterval(timer);
    };
  }, [queryClient, user, role, pollsHere, pollMs]);
  return null;
}
