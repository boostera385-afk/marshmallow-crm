import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSharedQuery } from "@/hooks/useCrossTab";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessNotifications } from "@/lib/access";
import { fetchInbox, type InboxFilters } from "@/lib/workflow-inbox";
import { subscribeToNotifications, realtimeBus } from "@/lib/realtime";
import { useCoalescedRefresh } from "@/hooks/useCoalescedRefresh";
import { historyNotificationSince, laterOf } from "@/lib/notification-window";

export const INBOX_QUERY_KEY = ["notification-inbox"] as const;
export const notificationUnreadKey = (userId: string | undefined, role: string | null) => ["notification-unread", userId, role] as const;
/** Bell owns the exact count read; sidebar subscribes without another request. */
export function useNotificationUnreadCount() {
  const { user, role } = useAuth();
  return useQuery({ queryKey: notificationUnreadKey(user?.id, role), queryFn: async () => 0, enabled: false });
}
export function useNotificationInbox(filters: InboxFilters, offset: number) {
  const { user, role } = useAuth();
  const client = useQueryClient();
  const enabled = Boolean(user) && canAccessNotifications(role);
  const refresh = useCoalescedRefresh(useCallback(async () => {
    await client.invalidateQueries({ queryKey: INBOX_QUERY_KEY }, { cancelRefetch: false });
  }, [client]));
  useEffect(() => {
    if (!user || !enabled) return;
    const listener = () => { void refresh(); };
    const unsubscribe = subscribeToNotifications(user.id, listener);
    realtimeBus.addEventListener("workflow-inbox-read", listener);
    return () => { unsubscribe(); realtimeBus.removeEventListener("workflow-inbox-read", listener); };
  }, [user, enabled, refresh]);
  return useSharedQuery({ queryKey: [...INBOX_QUERY_KEY, user?.id, role, filters, offset],
    // History covers the last 30 days and never starts before the account existed.
    queryFn: () => fetchInbox({ ...filters, since: laterOf(filters.since, historyNotificationSince(user?.created_at)) }, offset),
    enabled, sharedPoll: { intervalMs: 15000 },
    // workflowCall already retries transient edge-runtime failures once; the 15s interval refetches anyway.
    // One tab per browser polls; other tabs read through it.
    retry: false });
}
