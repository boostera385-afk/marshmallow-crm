import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { isOperatorRole } from "@/lib/access";
import { fetchHoldInbox, fetchLeadCopyAccess } from "@/lib/operator-workflow";

export function useLeadCopyAccess() {
  const { user, role } = useAuth();
  const query = useQuery({
    queryKey: ["lead-copy-access", user?.id, role], queryFn: fetchLeadCopyAccess,
    enabled: Boolean(user && role && role !== "admin"),
    staleTime: 5000, retry: false, refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
  return {
    allowed: role === "admin" || Boolean(role && user && query.data === true && !query.isError),
    loading: Boolean(role && role !== "admin" && query.isLoading),
    error: role === "admin" ? null : query.error,
  };
}

export function useHoldInbox() {
  const { user, role } = useAuth();
  return useQuery({
    queryKey: ["operator-hold-alerts", user?.id, role], queryFn: fetchHoldInbox,
    enabled: Boolean(user && isOperatorRole(role)), staleTime: 5000, retry: false,
    refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
}
