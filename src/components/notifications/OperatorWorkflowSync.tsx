import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { realtimeBus } from "@/lib/realtime";

/** One listener/poll per session, not one subscription or timer per lead card. */
export default function OperatorWorkflowSync() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
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
    const timer = window.setInterval(refresh, 20000);
    return () => {
      realtimeBus.removeEventListener("lead_copy_role_permissions", refreshCopy);
      realtimeBus.removeEventListener("lead_copy_user_permissions", refreshCopy);
      realtimeBus.removeEventListener("lead_hold_alerts", refreshHold);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [queryClient, user, role]);
  return null;
}
