import { useRef } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { isOperatorRole } from "@/lib/access";
import { acknowledgeAllHoldAlerts, acknowledgeHoldAlert, type HoldAlert, type HoldInbox } from "@/lib/operator-workflow";
import type { AppRole } from "@/types";

type Action = { userId: string; role: AppRole } & (
  { kind: "one"; alert: Pick<HoldAlert, "id" | "revision"> } | { kind: "all"; inbox: HoldInbox }
);

/** Popup and bell share the same mutation gate and recipient-scoped refresh. */
export function useHoldAlertActions() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const key = ["operator-hold-acknowledgement", user?.id, role];
  const scope = `${user?.id}:${role}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const pending = useIsMutating({ mutationKey: key }) > 0;
  const mutation = useMutation({
    mutationKey: key,
    mutationFn: async (action: Action) => action.kind === "all"
      ? acknowledgeAllHoldAlerts(action.userId, action.inbox)
      : { requested: 1, applied: await acknowledgeHoldAlert(action.alert) ? 1 : 0 },
    onSuccess: (result, action) => {
      if (currentScope.current !== `${action.userId}:${action.role}`) return;
      if (result.applied < result.requested) toast.info("Some jobs changed again. Review the latest alerts before acknowledging.");
    },
    onError: (error: Error, action) => {
      if (currentScope.current === `${action.userId}:${action.role}`) toast.error(`Could not acknowledge: ${error.message}`);
    },
    onSettled: (_result, _error, action) => queryClient.invalidateQueries({ queryKey: ["operator-hold-alerts", action.userId, action.role] }),
  });
  const canRun = () => Boolean(user && isOperatorRole(role) && !queryClient.isMutating({ mutationKey: key }));
  return {
    isPending: pending,
    acknowledgeOne: (alert: Pick<HoldAlert, "id" | "revision">) => {
      if (canRun() && user && role) mutation.mutate({ kind: "one", userId: user.id, role, alert });
    },
    acknowledgeAll: async (inbox: HoldInbox | undefined) => {
      if (!inbox || !canRun() || !user || !role) return;
      try { await mutation.mutateAsync({ kind: "all", userId: user.id, role, inbox }); }
      catch { /* onError reports the failure; onSettled refreshes the saved state. */ }
    },
  };
}
