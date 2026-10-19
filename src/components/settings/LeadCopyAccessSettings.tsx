import { useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { fetchLeadCopySettings, resolveLeadCopyAccess, setLeadCopyPermission } from "@/lib/operator-workflow";
import { useAuth } from "@/contexts/AuthContext";
import FeatureAccessMatrix, { type AccessFeature, type AccessUser } from "./FeatureAccessMatrix";

interface Props<T extends AccessUser> { users: T[]; features: AccessFeature<T>[] }
export default function LeadCopyAccessSettings<T extends AccessUser>({ users, features }: Props<T>) {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const saving = useRef(false);
  const settings = useQuery({
    queryKey: ["lead-copy-settings", user?.id], queryFn: fetchLeadCopySettings,
    enabled: Boolean(user && role === "admin"), retry: false,
  });
  const permissions = useMemo(() => ({
    roles: new Map(settings.data?.roles.map((row) => [row.role, row.allowed])),
    users: new Map(settings.data?.users.map((row) => [row.user_id, row.allowed])),
  }), [settings.data]);
  const save = useMutation({
    mutationFn: ({ userId, allowed }: { userId: string; allowed: boolean }) =>
      setLeadCopyPermission(null, userId, allowed),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lead-copy-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["lead-copy-access"] });
      toast.success("Copy Complete Details access updated");
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => { saving.current = false; },
  });
  if (role !== "admin") return null;
  const verified = Boolean(settings.data && !settings.isError);
  const disabled = !verified || save.isPending;
  const copyFeature: AccessFeature<T> = {
    key: "copy_all_details", label: "Copy Details", searchTerms: ["Copy All Details", "Copy Complete Details"],
    renderControl: (target) => {
      const allowed = resolveLeadCopyAccess(target.role, permissions.roles.get(target.role) ?? true, permissions.users.get(target.id));
      return <Switch aria-label={`Copy Details for ${target.full_name || "Unnamed user"}`}
        title={!verified ? "Copy access not verified" : allowed ? "Copy Details allowed" : "Copy Details denied"}
        checked={verified && allowed} disabled={disabled}
        onCheckedChange={(checked) => {
          if (disabled || saving.current) return;
          saving.current = true;
          save.mutate({ userId: target.id, allowed: checked });
        }} />;
    },
  };
  return <>
    {settings.isLoading && <p role="status" className="text-sm">Loading copy permissions…</p>}
    {settings.error && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 p-4">
      <p role="alert" className="text-sm text-destructive">{settings.error.message}</p>
      <Button variant="outline" size="sm" disabled={settings.isFetching} onClick={() => void settings.refetch()}>Retry permissions</Button>
    </div>}
    <FeatureAccessMatrix users={users} features={[...features, copyFeature]} />
  </>;
}
