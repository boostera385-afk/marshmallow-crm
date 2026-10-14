import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { isOperatorRole } from "@/lib/access";
import { acknowledgeHoldAlert } from "@/lib/operator-workflow";
import { useHoldInbox } from "@/hooks/useOperatorWorkflow";
import { useNotificationPopupSlot } from "./popup-slot";
import HoldJobCard from "./HoldJobCard";

export default function HoldJobPopup() {
  const { user, role } = useAuth();
  const inbox = useHoldInbox();
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState<string[]>([]);
  const pending = inbox.data?.alerts.filter((alert) => !alert.read) ?? [];
  const visiblePending = pending.filter((alert) => !hidden.includes(`${user?.id}:${alert.id}:${alert.revision}`));
  const displayed = visiblePending.slice(0, 3);
  const visible = useNotificationPopupSlot("holdJob", isOperatorRole(role) && displayed.length > 0);
  const acknowledge = useMutation({
    mutationFn: acknowledgeHoldAlert,
    onSuccess: async (applied) => {
      if (!applied) toast.info("This job changed again. Review the latest alert before acknowledging.");
      await queryClient.invalidateQueries({ queryKey: ["operator-hold-alerts"] });
    },
    onError: (error: Error) => toast.error(`Could not acknowledge: ${error.message}`),
  });
  if (!visible || displayed.length === 0) return null;
  return (
    <aside className="fixed right-3 top-16 z-[100] max-h-[calc(100vh-5rem)] w-[min(420px,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain p-1 sm:right-4 sm:top-20" aria-label="Operator job hold notifications" aria-live="polite">
      <div className="flex flex-col gap-3">
        {displayed.map((alert) => <HoldJobCard
          key={`${alert.id}:${alert.revision}`}
          alert={alert}
          onAcknowledge={(item) => acknowledge.mutate(item)}
          onDismiss={(item) => setHidden((current) => [...current, `${user?.id}:${item.id}:${item.revision}`])}
          saving={acknowledge.isPending}
        />)}
        <div className="rounded-xl border border-border/70 bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow-md backdrop-blur">
          <span className="font-medium text-foreground">{inbox.data?.unread_count ?? pending.length} hold alert(s)</span>
          {visiblePending.length > displayed.length && ` · ${visiblePending.length - displayed.length} more in Notifications`}
          {visiblePending.length <= displayed.length && " · also saved in Notifications"}
        </div>
      </div>
    </aside>
  );
}
