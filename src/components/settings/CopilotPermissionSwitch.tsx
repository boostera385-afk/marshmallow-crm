import { Switch } from "@/components/ui/switch";
import { useCopilotSettings } from "@/hooks/useCopilotSettings";
import { resolveCopilotAccess } from "@/lib/copilot-api";
import type { AppRole } from "@/types";
export default function CopilotPermissionSwitch({ user }: { user: { id: string; role: AppRole; full_name: string | null } }) {
  const { query, save, disabled } = useCopilotSettings();
  const data = query.data;
  if (!data || query.isError) return <span className="text-xs text-muted-foreground">{query.isError ? "Unavailable" : "Loading…"}</span>;
  const override = data.users.find((u) => u.user_id === user.id)?.allowed;
  const allowed = resolveCopilotAccess(user.role, data.config.enabled, data.roles.find((r) => r.role === user.role)?.allowed, override);
  return <div><Switch aria-label={`Marshmallow Copilot for ${user.full_name || "Unnamed user"}`} checked={allowed} disabled={disabled || !data.config.enabled}
    onCheckedChange={(value) => save.mutate({ kind: "permission", role: null, userId: user.id, allowed: value })}/><p className="mt-1 text-[10px] text-muted-foreground">{!data.config.enabled ? "Globally disabled" : override === undefined ? "Role default" : "User override"}</p></div>;
}
