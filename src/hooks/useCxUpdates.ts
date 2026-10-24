import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessCxUpdates } from "@/lib/access";
import { fetchUpdateCounts, fetchUpdateQueue, fetchUpdateRequest, type UpdateRequestKind, type UpdateRequestView } from "@/lib/cx-update-requests";
import { realtimeBus } from "@/lib/realtime";
import { useCoalescedRefresh } from "@/hooks/useCoalescedRefresh";
import { useCallback } from "react";

export const UPDATE_QUERY_KEY = ["lead-update-requests"] as const;
export const CX_QUERY_KEY = UPDATE_QUERY_KEY;
function useUpdateRefresh(enabled: boolean) {
  const client = useQueryClient();
  const refresh = useCoalescedRefresh(useCallback(async () => {
    await client.invalidateQueries({ queryKey: UPDATE_QUERY_KEY }, { cancelRefetch: false });
  }, [client]));
  useEffect(() => {
    if (!enabled) return;
    const listener = () => { void refresh(); };
    realtimeBus.addEventListener("lead_cx_update_requests", listener);
    return () => realtimeBus.removeEventListener("lead_cx_update_requests", listener);
  }, [refresh, enabled]);
}
export function useUpdateCount(kind: UpdateRequestKind, requested = true) {
  const { user, role } = useAuth();
  const enabled = requested && Boolean(user) && canAccessCxUpdates(role);
  useUpdateRefresh(enabled);
  return useQuery({ queryKey: [...UPDATE_QUERY_KEY, "counts", user?.id, role], queryFn: fetchUpdateCounts,
    select: (counts) => counts[kind], enabled, refetchInterval: 15000 });
}
export function useUpdateQueue(kind: UpdateRequestKind, view: UpdateRequestView, offset: number, requestId?: string | null) {
  const { user, role } = useAuth();
  const enabled = Boolean(user) && canAccessCxUpdates(role);
  useUpdateRefresh(enabled);
  return useQuery({ queryKey: [...UPDATE_QUERY_KEY, kind, "queue", user?.id, role, view, offset, requestId],
    queryFn: () => requestId ? fetchUpdateRequest(kind, requestId) : fetchUpdateQueue(kind, view, offset),
    enabled,
    refetchInterval: 15000,
  });
}

export const useCxCount = () => useUpdateCount("cx");
export const useCxQueue = (status: "pending" | "cs_updated", offset: number) => useUpdateQueue("cx", status === "pending" ? "pending" : "updated", offset);
