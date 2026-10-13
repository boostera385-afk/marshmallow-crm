import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COPY_ROLES, fetchLeadCopySettings, resolveLeadCopyAccess, setLeadCopyPermission } from "@/lib/operator-workflow";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/types";
import FeatureAccessMatrix, { type AccessFeature, type AccessUser } from "./FeatureAccessMatrix";

interface Props<T extends AccessUser> { users: T[]; features?: AccessFeature<T>[] }
export default function LeadCopyAccessSettings<T extends AccessUser>({ users, features }: Props<T>) {
  const { user, role } = useAuth();
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
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
  const nonAdminUsers = users.filter((target) => target.role !== "admin");
  const filteredUsers = nonAdminUsers.filter((target) =>
    (roleFilter === "all" || target.role === roleFilter) &&
    (target.full_name || "Unnamed user").toLowerCase().includes(search.trim().toLowerCase()),
  );
  const renderOverride = (target: T, label: string, compact = false) => {
    const override = settings.data?.users.find((row) => row.user_id === target.id)?.allowed;
    return (
      <Select value={override === undefined ? "inherit" : override ? "allow" : "deny"} disabled={disabled}
        onValueChange={(value) => save.mutate({ targetRole: null, userId: target.id, allowed: value === "inherit" ? null : value === "allow" })}>
        <SelectTrigger className={compact ? "w-full min-w-0 text-xs" : "w-full shrink-0 sm:w-48"} aria-label={`${label} for ${target.full_name || "Unnamed user"}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">Inherit role default</SelectItem>
          <SelectItem value="allow">Allow</SelectItem>
          <SelectItem value="deny">Deny</SelectItem>
        </SelectContent>
      </Select>
    );
  };
  const copyFeature: AccessFeature<T> = {
    key: "copy_all_details", label: "Copy All Details", searchTerms: ["Copy Complete Details", "Copy Details"],
    renderControl: (target) => {
      const override = settings.data?.users.find((row) => row.user_id === target.id)?.allowed;
      const roleAllowed = settings.data?.roles.find((row) => row.role === target.role)?.allowed ?? true;
      const allowed = resolveLeadCopyAccess(target.role, roleAllowed, override);
      return <div className="mx-auto w-full max-w-48 space-y-2">
        <p className="text-xs font-medium">Effective access: {!settings.data || settings.isError ? "Not verified" : allowed ? "Allowed" : "Denied"}</p>
        {renderOverride(target, "Copy All Details override", true)}
      </div>;
    },
  };
  return (
    <>
    <Card className="border-border/60">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Copy className="mt-1 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h3 className="font-semibold">Copy Complete Details</h3>
            <p className="text-sm text-muted-foreground">Choose which roles see the copy button. Enabled by default, including both Operator roles. Admin always retains access.</p>
            <p className="mt-1 text-xs text-muted-foreground">This controls the copy button, not lead visibility. Hidden Operator quotes stay hidden.</p>
          </div>
        </div>
        {settings.isLoading && <p role="status" className="text-sm">Loading copy permissions…</p>}
        {settings.error && <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{settings.error.message}</p><Button variant="outline" size="sm" disabled={settings.isFetching} onClick={() => void settings.refetch()}>Retry permissions</Button></div>}
        <p className="text-xs font-semibold text-muted-foreground">Role defaults</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {COPY_ROLES.map(({ role: targetRole, label }) => (
            <label key={targetRole} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
              <span className="min-w-0">{label}<span className="mt-1 block text-xs text-muted-foreground">{!settings.data || settings.isError ? "Not verified" : (settings.data.roles.find((row) => row.role === targetRole)?.allowed ?? true) ? "Allowed" : "Denied"}</span></span>
              <Switch aria-label={`Allow Copy Complete Details for ${label}`} disabled={disabled}
                 checked={Boolean(settings.data && !settings.isError && (settings.data.roles.find((row) => row.role === targetRole)?.allowed ?? true))}
                onCheckedChange={(allowed) => save.mutate({ targetRole, userId: null, allowed })} />
            </label>
          ))}
        </div>
        <Collapsible open={overridesOpen} onOpenChange={setOverridesOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="h-auto min-h-11 w-full justify-between gap-3 whitespace-normal py-3 text-left">
              <span>User overrides · {nonAdminUsers.length} users<span className="mt-1 block text-xs font-normal text-muted-foreground">Allow or deny a specific user, or inherit their role default.</span></span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${overridesOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input aria-label="Find user for Copy Details" placeholder="Search user name…" value={search} onChange={(event) => setSearch(event.target.value)} />
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger aria-label="Filter Copy Details users by role"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All roles</SelectItem>{COPY_ROLES.map((item) => <SelectItem key={item.role} value={item.role}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">{filteredUsers.length} users · A user override takes priority over the role default.</p>
            <div className="max-h-80 space-y-2 overflow-y-auto overscroll-contain">
          {filteredUsers.map((target) => {
            const override = settings.data?.users.find((row) => row.user_id === target.id)?.allowed;
            const roleAllowed = settings.data?.roles.find((row) => row.role === target.role)?.allowed ?? true;
            const allowed = resolveLeadCopyAccess(target.role, roleAllowed, override);
            const label = COPY_ROLES.find((item) => item.role === target.role)?.label;
            return (
              <div key={target.id} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                   <p className="break-words font-medium">{target.full_name || "Unnamed user"}</p>
                   <p className="text-xs text-muted-foreground">{label} · Effective access: {!settings.data || settings.isError ? "Not verified" : allowed ? "Allowed" : "Denied"}</p>
                </div>
                 {renderOverride(target, "Copy override")}
              </div>
            );
          })}
              {!filteredUsers.length && <p className="p-3 text-sm text-muted-foreground">No matching users. Try another name or role.</p>}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
    {features && <FeatureAccessMatrix users={users} features={[copyFeature, ...features]} />}
    </>
  );
}
