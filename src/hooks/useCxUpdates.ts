import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessCxUpdates } from "@/lib/access";
import { fetchUpdateCount, fetchUpdateQueue, type UpdateRequestKind, type UpdateRequestView } from "@/lib/cx-update-requests";
import { realtimeBus } from "@/lib/realtime";

export const UPDATE_QUERY_KEY = ["lead-update-requests"] as const;
export const CX_QUERY_KEY = UPDATE_QUERY_KEY;
export function useUpdateCount(kind: UpdateRequestKind, requested = true) {
  const { user, role } = useAuth();
  const client = useQueryClient();
  const enabled = requested && Boolean(user) && canAccessCxUpdates(role);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { void client.invalidateQueries({ queryKey: UPDATE_QUERY_KEY }); };
    realtimeBus.addEventListener("lead_cx_update_requests", refresh);
    return () => realtimeBus.removeEventListener("lead_cx_update_requests", refresh);
  }, [client, enabled]);
  return useQuery({ queryKey: [...UPDATE_QUERY_KEY, kind, "count", user?.id, role], queryFn: () => fetchUpdateCount(kind), enabled, refetchInterval: 15000 });
}
export function useUpdateQueue(kind: UpdateRequestKind, view: UpdateRequestView, offset: number) {
  const { user, role } = useAuth();
  return useQuery({ queryKey: [...UPDATE_QUERY_KEY, kind, "queue", user?.id, role, view, offset],
    queryFn: () => fetchUpdateQueue(kind, view, offset),
    enabled: Boolean(user) && canAccessCxUpdates(role),
    refetchInterval: 15000,
  });
}

export const useCxCount = () => useUpdateCount("cx");
export const useCxQueue = (status: "pending" | "cs_updated", offset: number) => useUpdateQueue("cx", status === "pending" ? "pending" : "updated", offset);
