import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
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
  const [hidden, setHidden] = useState<string | null>(null);
  const pending = inbox.data?.alerts.filter((alert) => !alert.read) ?? [];
  const current = pending[0];
  const key = current ? `${user?.id}:${current.id}:${current.revision}` : null;
  const visible = useNotificationPopupSlot("holdJob", isOperatorRole(role) && Boolean(current && hidden !== key));
  const acknowledge = useMutation({
    mutationFn: acknowledgeHoldAlert,
    onSuccess: async (applied) => {
      if (!applied) toast.info("This job changed again. Review the latest alert before acknowledging.");
      await queryClient.invalidateQueries({ queryKey: ["operator-hold-alerts"] });
    },
    onError: (error: Error) => toast.error(`Could not acknowledge: ${error.message}`),
  });
  if (!visible || !current) return null;
  return (
    <aside className="fixed bottom-4 right-4 z-[100] max-h-[70vh] w-[min(400px,calc(100vw-2rem))] overflow-y-auto overscroll-contain" aria-label="Operator job hold notification" aria-live="polite">
      <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2 text-xs">
        <span>{inbox.data?.unread_count ?? pending.length} job hold alert(s) · also saved in Notifications</span>
        <button className="rounded p-1 hover:bg-muted" aria-label="Hide hold notification" onClick={() => setHidden(key)}><X className="h-4 w-4" /></button>
      </div>
      <HoldJobCard key={current.revision} alert={current} onAcknowledge={(alert) => acknowledge.mutate(alert)} saving={acknowledge.isPending} />
    </aside>
  );
}
