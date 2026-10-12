import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COPY_ROLES, fetchLeadCopySettings, resolveLeadCopyAccess, setLeadCopyPermission } from "@/lib/operator-workflow";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/types";

interface Props { users: { id: string; full_name: string | null; role: AppRole }[] }
export default function LeadCopyAccessSettings({ users }: Props) {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["lead-copy-settings", user?.id], queryFn: fetchLeadCopySettings,
    enabled: role === "admin", retry: false,
  });
  const save = useMutation({
    mutationFn: ({ targetRole, userId, allowed }: { targetRole: AppRole | null; userId: string | null; allowed: boolean | null }) =>
      setLeadCopyPermission(targetRole, userId, allowed),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lead-copy-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["lead-copy-access"] });
      toast.success("Copy Complete Details access updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (role !== "admin") return null;
  const disabled = !settings.data || save.isPending || settings.isError;
  return (
    <Card className="border-border/60">
      <CardContent className="space-y-5 p-5">
        <div className="flex items-start gap-3">
          <Copy className="mt-1 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h3 className="font-semibold">Copy Complete Details</h3>
            <p className="text-sm text-muted-foreground">Enabled by default, including both Operator roles. A user override wins over their role default. Admin always retains access.</p>
            <p className="mt-1 text-xs text-muted-foreground">This controls the copy button, not lead visibility. Hidden Operator quotes stay hidden.</p>
          </div>
        </div>
        {settings.isLoading && <p role="status" className="text-sm">Loading copy permissions…</p>}
        {settings.error && <p role="alert" className="text-sm text-destructive">{settings.error.message}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COPY_ROLES.map(({ role: targetRole, label }) => (
            <label key={targetRole} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
              {label}
              <Switch aria-label={`Allow Copy Complete Details for ${label}`} disabled={disabled}
                checked={settings.data?.roles.find((row) => row.role === targetRole)?.allowed ?? true}
                onCheckedChange={(allowed) => save.mutate({ targetRole, userId: null, allowed })} />
            </label>
          ))}
        </div>
        <div className="max-h-96 space-y-2 overflow-auto">
          {users.filter((target) => target.role !== "admin").map((target) => {
            const override = settings.data?.users.find((row) => row.user_id === target.id)?.allowed;
            const roleAllowed = settings.data?.roles.find((row) => row.role === target.role)?.allowed ?? true;
            const allowed = resolveLeadCopyAccess(target.role, roleAllowed, override);
            const label = COPY_ROLES.find((item) => item.role === target.role)?.label;
            return (
              <div key={target.id} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{target.full_name || "Unnamed user"}</p>
                  <p className="text-xs text-muted-foreground">{label} · Effective access: {allowed ? "Allowed" : "Denied"}</p>
                </div>
                <Select value={override === undefined ? "inherit" : override ? "allow" : "deny"} disabled={disabled}
                  onValueChange={(value) => save.mutate({ targetRole: null, userId: target.id, allowed: value === "inherit" ? null : value === "allow" })}>
                  <SelectTrigger className="w-full shrink-0 sm:w-48" aria-label={`Copy override for ${target.full_name || "Unnamed user"}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Inherit role default</SelectItem>
                    <SelectItem value="allow">Allow</SelectItem>
                    <SelectItem value="deny">Deny</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
