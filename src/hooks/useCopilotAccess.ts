import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchCopilotAccess } from "@/lib/copilot-api";
import { realtimeBus } from "@/lib/realtime";
import { COPILOT_ACCESS_STORAGE_KEY } from "@/lib/copilot-access-events";

export function useCopilotAccess(open = false) {
  const { user, role, fullyAuthenticated, profileLoaded } = useAuth();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["copilot-access", user?.id, role], queryFn: ({ signal }) => fetchCopilotAccess(signal),
    enabled: Boolean(user && role && fullyAuthenticated && profileLoaded), staleTime: 15000, retry: false,
    refetchOnWindowFocus: "always", refetchOnReconnect: "always",
    // No new database subscriptions: an unapplied Copilot migration must never
    // break the existing global realtime channel. Server checks remain authoritative.
    refetchInterval: (state) => state.state.status === "success" ? open ? 5000 : 10000 : false,
  });
  useEffect(() => {
    const invalidate = () => { void client.invalidateQueries({ queryKey: ["copilot-access"] }); void client.invalidateQueries({ queryKey: ["copilot-settings"] }); };
    const onStorage = (event: StorageEvent) => { if (event.key === COPILOT_ACCESS_STORAGE_KEY) invalidate(); };
    realtimeBus.addEventListener("copilot_access_changed", invalidate);
    window.addEventListener("storage", onStorage);
    return () => { realtimeBus.removeEventListener("copilot_access_changed", invalidate); window.removeEventListener("storage", onStorage); };
  }, [client]);
  return { ...query, access: user && role && fullyAuthenticated && profileLoaded && !query.isError && query.data?.allowed ? query.data : null };
}
