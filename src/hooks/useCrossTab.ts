import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  hashKey,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryFunction,
  type QueryKey,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { crossTab, type CrossTabCoordinator } from "@/lib/cross-tab";
import { useCoalescedRefresh } from "@/hooks/useCoalescedRefresh";
import { realtimeAwareInterval, useRealtimeHealthy, useRealtimeReconnect } from "@/lib/realtime-health";
import { useBackgroundPollPaused } from "@/lib/overload-guard";

const CrossTabContext = createContext<CrossTabCoordinator | null>(null);

/** Tests render two "tabs" side by side, each with its own coordinator. */
export function CrossTabProvider({ coordinator, children }: { coordinator: CrossTabCoordinator; children: ReactNode }) {
  return createElement(CrossTabContext.Provider, { value: coordinator }, children);
}

export function useCrossTab() {
  return useContext(CrossTabContext) ?? crossTab();
}

/**
 * True while this tab owns polling for `key` (pass null when the data is not
 * needed). Without Web Locks every tab owns its keys, as before.
 */
export function useCrossTabOwner(key: string | null, onRemoteRequest?: () => void) {
  const coordinator = useCrossTab();
  const [owner, setOwner] = useState(() => (key ? coordinator.isOwner(key) : false));
  // A new callback must not release and re-queue the lock (ownership would move).
  const requestRef = useRef(onRemoteRequest);
  useEffect(() => { requestRef.current = onRemoteRequest; }, [onRemoteRequest]);
  useEffect(() => {
    if (!key) {
      setOwner(false);
      return;
    }
    const handle = coordinator.claim(key, () => requestRef.current?.());
    setOwner(handle.isOwner());
    const stop = handle.onChange(setOwner);
    return () => {
      stop();
      handle.release();
    };
  }, [coordinator, key]);
  return key ? owner : false;
}

export interface SharedPoll {
  intervalMs: number;
  /** Keep polling while the owner tab is hidden (alerts); default: visible only. */
  inBackground?: boolean;
  /**
   * The same data also arrives by realtime, so this poll is only a safety net:
   * it runs every REALTIME_SAFETY_POLL_MS while realtime is healthy, at
   * `intervalMs` while it is not, and once immediately when realtime recovers.
   */
  realtimeBacked?: boolean;
}

type SharedQueryOptions<TQueryFnData, TError, TData, TQueryKey extends QueryKey> = Omit<
  UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  "queryFn" | "refetchInterval" | "refetchIntervalInBackground" | "enabled"
> & {
  queryFn: QueryFunction<TQueryFnData, TQueryKey>;
  enabled?: boolean;
  /** Omit to share reads across tabs without a polling timer. */
  sharedPoll?: SharedPoll;
};

export const sharedQueryKey = (queryKey: QueryKey) => `q:${hashKey(queryKey)}`;

/**
 * useQuery whose polling runs in one tab per browser. Other tabs with the same
 * query read through the owner and receive its results; the query key must be
 * scoped like any other cache key (user/role/filters).
 */
export function useSharedQuery<TQueryFnData = unknown, TError = Error, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey>(
  options: SharedQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
) {
  const { sharedPoll, queryFn, ...rest } = options;
  const client = useQueryClient();
  const coordinator = useCrossTab();
  const enabled = rest.enabled !== false;
  const key = sharedQueryKey(rest.queryKey);
  const queryKeyRef = useRef(rest.queryKey);
  queryKeyRef.current = rest.queryKey;
  // Another tab asked: refresh our own cache entry, which shares the result.
  const onRemoteRequest = useCallback(() => {
    void client.refetchQueries({ queryKey: queryKeyRef.current, exact: true }, { cancelRefetch: false });
  }, [client]);
  const owner = useCrossTabOwner(enabled ? key : null, onRemoteRequest);
  const realtimeHealthy = useRealtimeHealthy();
  const overloadPaused = useBackgroundPollPaused();
  const realtimeBacked = Boolean(sharedPoll?.realtimeBacked);
  // Events may have been missed while realtime was down: the owner reads once.
  useRealtimeReconnect(onRemoteRequest, owner && enabled && realtimeBacked);
  const intervalMs = sharedPoll
    ? (realtimeBacked ? realtimeAwareInterval(sharedPoll.intervalMs, realtimeHealthy) : sharedPoll.intervalMs)
    : 0;
  return useQuery({
    ...rest,
    queryFn: (context) => coordinator.fetch(key, () => Promise.resolve(queryFn(context))),
    // No polling while the server is overloaded; the interval restarts when the pause ends.
    refetchInterval: owner && sharedPoll && !overloadPaused ? intervalMs : false,
    refetchIntervalInBackground: sharedPoll?.inBackground ?? false,
  });
}

/** Apply results shared by owner tabs to this tab's cache (install once per app). */
export function installCrossTabQuerySync(client: QueryClient, coordinator: CrossTabCoordinator = crossTab()) {
  return coordinator.subscribeAll((key, data, at) => {
    if (!key.startsWith("q:")) return;
    const query = client.getQueryCache().get(key.slice(2));
    if (!query) return;
    client.setQueryData(query.queryKey, data, { updatedAt: at });
  });
}

export function useCrossTabQuerySync() {
  const client = useQueryClient();
  const coordinator = useCrossTab();
  useEffect(() => installCrossTabQuerySync(client, coordinator), [client, coordinator]);
}

/**
 * A hand-written poller (bell, pop-ups) shared across tabs. `read` must return
 * plain data and throw on failure; `apply` updates this tab's state and may run
 * for results another tab read. Only the owner should run the polling timer.
 */
export function useSharedRefresh<T>(
  key: string | null,
  read: () => Promise<T>,
  apply: (data: T, isCurrent: () => boolean) => void,
) {
  const coordinator = useCrossTab();
  const refresh = useCoalescedRefresh(useCallback(async (isCurrent: () => boolean) => {
    if (!key) return;
    const data = await coordinator.fetch(key, read);
    if (isCurrent()) apply(data, isCurrent);
  }, [coordinator, key, read, apply]));
  const onRemoteRequest = useCallback(() => { void refresh(); }, [refresh]);
  const isOwner = useCrossTabOwner(key, onRemoteRequest);
  useEffect(() => {
    if (!key) return;
    let active = true;
    const stop = coordinator.subscribe(key, (data) => { if (active) apply(data as T, () => active); });
    return () => {
      active = false;
      stop();
    };
  }, [coordinator, key, apply]);
  return { refresh, isOwner };
}
