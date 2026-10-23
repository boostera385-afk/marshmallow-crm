import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessNotifications } from "@/lib/access";
import { fetchWorkflowAlerts, openInboxNotification } from "@/lib/workflow-inbox";
import { claimWorkflowAlert, claimWorkflowChime, loadAlertCursor, pollAlertDelay, saveAlertCursor } from "@/lib/workflow-alerts";
import { playAssignmentSound } from "@/lib/notification-sound";
import { subscribeToNotifications, realtimeBus } from "@/lib/realtime";
import { useCoalescedRefresh } from "@/hooks/useCoalescedRefresh";
import WorkflowToast from "./WorkflowToast";

export default function WorkflowAlerts() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const baseline = useRef(new Date().toISOString());
  const displayed = useRef(new Set<string>());
  const refresh = useCoalescedRefresh(useCallback(async (isCurrent: () => boolean) => {
    if (!user || !canAccessNotifications(role)) return;
    const after = loadAlertCursor(user.id, baseline.current);
    const until = new Date().toISOString();
    let offset = 0;
    let more = true;
    while (more && isCurrent()) {
      const result = await fetchWorkflowAlerts(after, until, offset);
      if (!isCurrent()) return;
      // Oldest first within a page, and each event has its own persistent claim.
      for (const notification of [...result.rows].reverse()) {
        if (!isCurrent()) return;
        await claimWorkflowAlert(user.id, notification, () => {
          const toastId = `workflow:${notification.id}`;
          displayed.current.add(toastId);
          const dismiss = () => { toast.dismiss(toastId); displayed.current.delete(toastId); };
          if (claimWorkflowChime(user.id)) playAssignmentSound();
          toast.custom(() => <WorkflowToast notification={notification} onDismiss={dismiss} onOpen={() => {
            void openInboxNotification(notification).then((href) => {
              if (!isCurrent()) return;
              if (href) navigate(href);
              dismiss();
              realtimeBus.dispatchEvent(new Event("workflow-inbox-read"));
            }).catch((error: unknown) => { if (isCurrent()) toast.error(error instanceof Error ? error.message : "Could not open notification"); });
          }} />, { id: toastId, duration: Infinity, position: "bottom-right" });
        }, isCurrent);
      }
      offset += result.rows.length;
      more = result.rows.length > 0 && offset < result.total;
    }
    if (isCurrent()) saveAlertCursor(user.id, until);
  }, [user, role, navigate]));
  useEffect(() => {
    if (!user || !canAccessNotifications(role)) return;
    void refresh();
    const unsubscribe = subscribeToNotifications(user.id, () => { void refresh(); });
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    const activeToasts = displayed.current;
    return () => { unsubscribe(); window.clearInterval(timer); activeToasts.forEach((id) => toast.dismiss(id)); activeToasts.clear(); };
  }, [user, role, refresh]);
  return null;
}
