import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessProcessorBoard } from "@/lib/access";
import { fetchProcessorJobs, type ProcessorFilters } from "@/lib/processor-board";
import { subscribeToProcessorBoard } from "@/lib/realtime";
import { createCoalescedRefresh } from "@/lib/coalesced-refresh";

export const PROCESSOR_QUERY_KEY = ["processor-board"] as const;
export function useProcessorBoard(filters: ProcessorFilters) {
  const { user, role } = useAuth();
  const client = useQueryClient();
  const enabled = Boolean(user) && canAccessProcessorBoard(role);
  useEffect(() => {
    if (!enabled) return;
    const refresh = createCoalescedRefresh(async () => {
      await client.invalidateQueries({ queryKey: [...PROCESSOR_QUERY_KEY, user?.id, role] }, { cancelRefetch: false });
    }, () => { /* Query error remains visible; polling provides recovery. */ });
    const listener = () => { void refresh.request(); };
    const unsubscribe = subscribeToProcessorBoard(listener);
    return () => { refresh.dispose(); unsubscribe(); };
  }, [client, enabled, user?.id, role]);
  return useQuery({ queryKey: [...PROCESSOR_QUERY_KEY, user?.id, role, filters], queryFn: ({ signal }) => fetchProcessorJobs(filters, signal), enabled,
    refetchInterval: 30000, refetchOnReconnect: true, staleTime: 15000 });
}
