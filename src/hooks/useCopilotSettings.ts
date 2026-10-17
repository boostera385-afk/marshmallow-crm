import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { configureCopilot, fetchCopilotSettings, setCopilotPermission, type CopilotConfig } from "@/lib/copilot-api";
import { toast } from "sonner";
import { announceCopilotAccessChange } from "@/lib/copilot-access-events";

export function useCopilotSettings() {
  const { user, role } = useAuth();
  const client = useQueryClient();
  const key = ["copilot-settings", user?.id, role];
  const query = useQuery({ queryKey: key, queryFn: fetchCopilotSettings, enabled: role === "admin", retry: false,
    refetchOnWindowFocus: "always", refetchInterval: 15000 });
  const save = useMutation({
    retry: false,
    mutationFn: (change: { kind: "permission"; role: string | null; userId: string | null; allowed: boolean | null } | { kind: "config"; config: CopilotConfig; expected?: CopilotConfig }) =>
      change.kind === "permission" ? setCopilotPermission(change.role, change.userId, change.allowed) : configureCopilot(change.config, change.expected ?? query.data?.config),
    onSuccess: async () => {
      // A failed refresh is not a failed save. The settings query displays its
      // own refresh error, separately from this persisted mutation outcome.
      toast.success("Marshmallow Copilot settings saved");
      announceCopilotAccessChange();
      await client.invalidateQueries({ queryKey: ["copilot-settings"] });
      await client.invalidateQueries({ queryKey: ["copilot-access"] });
      await client.invalidateQueries({ queryKey: ["copilot-diagnostics"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return { query, save, disabled: role !== "admin" || !query.data || query.isError || save.isPending };
}
