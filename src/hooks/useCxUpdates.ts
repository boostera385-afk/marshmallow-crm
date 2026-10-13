import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessCxUpdates, canRequestCxUpdate } from "@/lib/access";
import { fetchCxCount, fetchCxQueue } from "@/lib/cx-update-requests";
import { realtimeBus } from "@/lib/realtime";

export const CX_QUERY_KEY = ["cx-updates"] as const;
export function useCxCount() {
  const { user, role } = useAuth();
  const client = useQueryClient();
  const enabled = Boolean(user) && canAccessCxUpdates(role);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { void client.invalidateQueries({ queryKey: CX_QUERY_KEY }); };
    realtimeBus.addEventListener("lead_cx_update_requests", refresh);
    return () => realtimeBus.removeEventListener("lead_cx_update_requests", refresh);
  }, [client, enabled]);
  return useQuery({ queryKey: [...CX_QUERY_KEY, "count", user?.id, role], queryFn: fetchCxCount, enabled, refetchInterval: 15000 });
}
export function useCxQueue(status: "pending" | "cs_updated", offset: number) {
  const { user, role } = useAuth();
  return useQuery({ queryKey: [...CX_QUERY_KEY, "queue", user?.id, role, status, offset],
    queryFn: () => fetchCxQueue(status, offset),
    enabled: Boolean(user) && canAccessCxUpdates(role) && (status === "pending" || canRequestCxUpdate(role)),
    refetchInterval: 15000,
  });
}
