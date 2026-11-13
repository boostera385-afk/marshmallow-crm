import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isOperatorRole } from "@/lib/access";
import { useHoldInbox } from "@/hooks/useOperatorWorkflow";
import { useHoldAlertActions } from "@/hooks/useHoldAlertActions";
import { Button } from "@/components/ui/button";
import { CheckCheck } from "lucide-react";
import { useNotificationPopupSlot } from "./popup-slot";
import HoldJobCard from "./HoldJobCard";

export default function HoldJobPopup() {
  const { user, role } = useAuth();
  const inbox = useHoldInbox();
  const acknowledge = useHoldAlertActions();
  const [hidden, setHidden] = useState<string[]>([]);
  const pending = inbox.data?.alerts.filter((alert) => !alert.read) ?? [];
  const visiblePending = pending.filter((alert) => !hidden.includes(`${user?.id}:${alert.id}:${alert.revision}`));
  const displayed = visiblePending.slice(0, 3);
  const visible = useNotificationPopupSlot("holdJob", isOperatorRole(role) && displayed.length > 0);
  if (!visible || displayed.length === 0) return null;
  return (
    <aside className="fixed right-3 top-16 z-[100] max-h-[calc(100vh-5rem)] w-[min(420px,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain p-1 sm:right-4 sm:top-20" aria-label="Operator job hold notifications" aria-live="polite">
      <div className="flex flex-col gap-3">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/95 px-3 py-2 shadow-md backdrop-blur">
          <span className="text-xs font-semibold">Hold This Job</span>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={acknowledge.isPending || !inbox.data || inbox.isError}
            onClick={() => { void acknowledge.acknowledgeAll(inbox.data); }}>
            <CheckCheck className="h-3.5 w-3.5" />{acknowledge.isPending ? "Acknowledging…" : "Acknowledge All"}
          </Button>
        </div>
        {displayed.map((alert) => <HoldJobCard
          key={`${alert.id}:${alert.revision}`}
          alert={alert}
          role={role}
          onAcknowledge={acknowledge.acknowledgeOne}
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
