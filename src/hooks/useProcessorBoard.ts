import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessProcessorBoard } from "@/lib/access";
import { fetchProcessorDetail, fetchProcessorJobs, type ProcessorFilters, type ProcessorJob } from "@/lib/processor-board";
import { subscribeToProcessorActivity, subscribeToProcessorBoard } from "@/lib/realtime";
import { createCoalescedRefresh } from "@/lib/coalesced-refresh";

export const PROCESSOR_QUERY_KEY = ["processor-board"] as const;
export function useProcessorBoard(filters: ProcessorFilters) {
  const { user, role } = useAuth();
  const client = useQueryClient();
  const enabled = Boolean(user) && canAccessProcessorBoard(role);
  const refreshRef = useRef<ReturnType<typeof createCoalescedRefresh> | null>(null);
  const query = useQuery({ queryKey: [...PROCESSOR_QUERY_KEY, user?.id, role, filters], queryFn: ({ signal }) => fetchProcessorJobs(filters, signal), enabled,
    // Checks run on the server; this read only refreshes statuses and time-based changes.
    refetchInterval: 60000, refetchOnReconnect: true, staleTime: 30000 });
  const activityScope = [...new Set(query.data?.rows.flatMap((row) => row.chat_setup?.conversation_id ? [row.chat_setup.conversation_id] : []) ?? [])].sort().join(",");
  useEffect(() => {
    if (!enabled) return;
    const refresh = createCoalescedRefresh(async () => {
      await client.invalidateQueries({ queryKey: [...PROCESSOR_QUERY_KEY, user?.id, role] }, { cancelRefetch: false });
    }, () => { /* Query error remains visible; polling provides recovery. */ });
    const listener = () => { void refresh.request(); };
    refreshRef.current = refresh;
    const unsubscribe = subscribeToProcessorBoard(listener);
    return () => { if (refreshRef.current === refresh) refreshRef.current = null; refresh.dispose(); unsubscribe(); };
  }, [client, enabled, user?.id, role]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const refresh = refreshRef.current;
    const unsubscribe = subscribeToProcessorActivity(activityScope ? activityScope.split(",") : [], () => { if (active && refreshRef.current === refresh) void refresh?.request(); });
    return () => { active = false; unsubscribe(); };
  }, [enabled, user?.id, role, activityScope]);
  return query;
}

/** One job's full saved review, loaded only while its Review is open. */
export function useProcessorDetail(job: ProcessorJob | null) {
  const { user, role } = useAuth();
  return useQuery({
    queryKey: [...PROCESSOR_QUERY_KEY, user?.id, role, "detail", job?.id, job?.checked_at],
    queryFn: ({ signal }) => fetchProcessorDetail(job!.id, signal),
    enabled: Boolean(user && job?.checked_at) && canAccessProcessorBoard(role),
    staleTime: Infinity,
  });
}
