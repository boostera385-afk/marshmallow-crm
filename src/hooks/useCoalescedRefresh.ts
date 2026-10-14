import { useCallback, useEffect, useRef } from "react";
import { createCoalescedRefresh } from "@/lib/coalesced-refresh";

/** Keep existing triggers/timing while preventing parallel reads and stale commits. */
export function useCoalescedRefresh(refresh: (isCurrent: () => boolean) => Promise<void>) {
  const current = useRef<{
    refresh: typeof refresh;
    queue: ReturnType<typeof createCoalescedRefresh>;
  } | null>(null);

  useEffect(() => {
    const queue = createCoalescedRefresh(refresh, () => console.warn("Notification refresh failed"));
    current.current = { refresh, queue };
    return () => {
      queue.dispose();
      current.current = null;
    };
  }, [refresh]);

  return useCallback(() => {
    const entry = current.current;
    return entry?.refresh === refresh ? entry.queue.request() : Promise.resolve();
  }, [refresh]);
}
