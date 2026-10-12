import { useState, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Plus, Shield, Eye, EyeOff, Trash2, ShieldCheck, ShieldOff, QrCode, Copy, RefreshCw, KeyRound, Lock, FileText, BookOpen, Megaphone, FileSpreadsheet, Hash } from "lucide-react";
import { DocumentationTab } from "@/components/settings/DocumentationTab";
import { GoogleSheetsTab } from "@/components/settings/GoogleSheetsTab";
import LeadCopyAccessSettings from "@/components/settings/LeadCopyAccessSettings";
const CrmUpdates = lazy(() => import("@/pages/CrmUpdates"));
import { cn } from "@/lib/utils";
import { ALL_LEAD_STATUSES, STATUS_LABELS, ALL_NAV_ITEMS } from "@/lib/constants";
import { adminApi } from "@/lib/admin-api";
import { logActivity } from "@/lib/activity";
import { canAccessCancellationRequests, getDefaultNavAccess, getDefaultVisibleStatuses } from "@/lib/access";
import type { AppRole, LeadStatus } from "@/types";
import MFAEnroll from "@/components/auth/MFAEnroll";
import { motion } from "framer-motion";
import { heroTitle } from "@/lib/motion";
import { DEFAULT_MESSAGE_TEMPLATES, MESSAGE_TEMPLATE_LABELS, type MessageTemplateKey } from "@/lib/message-templates";

const generateCode = () => {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
};

const NAV_SECTION_LABELS: Record<string, string> = {
  leads: "All Leads",
  quo_monitor: "QUO Dashboard",
  ai_assistance: "AI Assistance",
  calls: "Calls Log",
  analytics: "Analytics",
  settings: "Settings",
  activity_logs: "Activity Logs",
  schedule: "Schedule",
  areas: "Area Insights",
  cancellation_requests: "Lead Cancellation Requests",
  payment_requests: "Payment Approvals",
  quote_approval_requests: "Quote Approval",
  quote_pending_requests: "Quotes to Send",
  map_view: "Map View",
  technicians: "Technicians",
      optimization: "Optimization",
  quick_chat: "CX Quickchat",
  tech_quick_chat: "Tech Quickchat",
};

const roleColors: Record<AppRole, string> = {
  admin: "bg-primary/8 text-primary border-primary/10",
  processor: "bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.1)]",
  customer_service: "bg-[hsl(var(--warning)/0.08)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.1)]",
  opr: "bg-[hsl(var(--destructive)/0.08)] text-[hsl(var(--destructive))] border-[hsl(var(--destructive)/0.12)]",
  cs_admin: "bg-primary/10 text-primary border-primary/20",
  opr_admin: "bg-[hsl(var(--destructive)/0.12)] text-[hsl(var(--destructive))] border-[hsl(var(--destructive)/0.2)]",
};

const DEFAULT_ROLE_COLOR = "bg-muted/70 text-muted-foreground border-border/60";

const VALID_ROLES: AppRole[] = ["admin", "processor", "customer_service", "opr", "cs_admin", "opr_admin"];

const formatRoleLabel = (role?: string | null) => {
  if (!role) return "";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

interface SettingsUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
  is_quotation_master: boolean | null;
  can_manage_users: boolean | null;
  opr_code: string | null;
  can_view_tech_report: boolean | null;
  can_add_manual_leads: boolean | null;
}

interface AccessCodeRow {
  user_id: string;
  code: string | null;
}

interface NavPermissionRow {
  id: string;
  user_id: string;
  nav_section: string;
  allowed: boolean;
}

interface StatusVisibilityRow {
  id: string;
  user_id: string | null;
  role: string | null;
  status: string;
  is_visible: boolean;
}

type MessageTemplateRow = {
  key: MessageTemplateKey;
  template: string;
};

type MessageTemplateUpsert = MessageTemplateRow & {
  updated_by: string | null;
};

type MessageTemplateClient = {
  from: (table: "message_templates") => {
    select: (columns: string) => Promise<{ data: MessageTemplateRow[] | null; error: Error | null }>;
    upsert: (row: MessageTemplateUpsert) => Promise<{ error: Error | null }>;
  };
};

const messageTemplateDb = supabase as unknown as MessageTemplateClient;

function TemplateEditor({
  initialValue,
  saving,
  onSave,
}: {
  templateKey: MessageTemplateKey;
  initialValue: string;
  saving: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return (
    <div className="space-y-3">
      <Textarea value={value} onChange={(event) => setValue(event.target.value)} rows={12} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          Available placeholders include {"{tech_name}"}, {"{schedule_time}"}, {"{customer_name}"}, {"{customer_phone}"}, {"{customer_address}"}, {"{service_details}"}, and {"{quote}"}.
        </p>
        <Button onClick={() => onSave(value)} disabled={saving || !value.trim()}>
          {saving ? "Saving..." : "Save template"}
        </Button>
      </div>
    </div>
  );
}

// OPR Admin always inherits the OPR role defaults, so it intentionally has no
// separate role row that could drift out of sync.
const MANAGED_ROLES: AppRole[] = ["customer_service", "processor", "opr", "cs_admin"];

const Settings = () => {
  const { user, role: currentRole, profileLoaded } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("customer_service");
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<"users" | "nav_permissions" | "status_permissions" | "templates" | "security" | "documentation" | "crm_updates" | "google_sheets">("users");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordUserId, setPasswordUserId] = useState("");
  const [passwordUserName, setPasswordUserName] = useState("");
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);

  const isAdmin = currentRole === "admin";

  // Single source of truth for this query's cache key. setQueryData requires an
  // EXACT key match, while invalidateQueries prefix-matches, so the flag toggles
  // below must use this same key or their optimistic update silently no-ops.
  const settingsUsersQueryKey = ["settings-users", isAdmin] as const;

  const { data: users = [], isPending: usersPending } = useQuery<SettingsUser[]>({
    queryKey: settingsUsersQueryKey,
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      const roleByUserId = new Map((roles ?? []).map((row) => [row.user_id, row.role as AppRole]));

      if (isAdmin) {
        // Admins can read all profiles via RLS
        const { data: profiles } = (await supabase.from("profiles").select("id, email, full_name, is_quotation_master, can_manage_users, opr_code, can_view_tech_report, can_add_manual_leads" as never)) as unknown as {
          data:
            | {
                id: string;
                email: string | null;
                full_name: string | null;
                is_quotation_master: boolean | null;
                can_manage_users: boolean | null;
                opr_code: string | null;
                can_view_tech_report: boolean | null;
                can_add_manual_leads: boolean | null;
              }[]
            | null;
        };

        return (profiles ?? [])
          .map((profile) => {
            const assignedRole = roleByUserId.get(profile.id);
            if (!assignedRole || !VALID_ROLES.includes(assignedRole)) return null;
            return {
              id: profile.id,
              email: profile.email,
              full_name: profile.full_name,
              role: assignedRole,
              is_quotation_master: profile.is_quotation_master,
              can_manage_users: profile.can_manage_users,
              opr_code: profile.opr_code,
              can_view_tech_report: profile.can_view_tech_report,
              can_add_manual_leads: profile.can_add_manual_leads,
            } as SettingsUser;
          })
          .filter((entry): entry is SettingsUser => entry !== null);
      }

      // Non-admin (cs_admin with can_manage_users): use profiles_public which
      // bypasses RLS, then enrich with own profile data for the current user.
      const { data: publicProfiles } = await supabase.from("profiles_public" as never).select("id, full_name") as { data: { id: string; full_name: string | null }[] | null };

      // profiles_public only exposes id + full_name, so the Manual Lead grant
      // has to come from the narrow SECURITY DEFINER RPC instead.
      const { data: manualAccess } = await supabase.rpc("manual_lead_access" as never) as {
        data: { user_id: string; can_add_manual_leads: boolean }[] | null;
      };
      const manualLeadByUserId = new Map(
        (manualAccess ?? []).map((row) => [row.user_id, row.can_add_manual_leads]),
      );

      return (publicProfiles ?? [])
        .map((profile) => {
          const assignedRole = roleByUserId.get(profile.id);
          if (!assignedRole || !VALID_ROLES.includes(assignedRole)) return null;
          return {
            id: profile.id,
            email: null,
            full_name: profile.full_name,
            role: assignedRole,
            is_quotation_master: null,
            can_manage_users: null,
            opr_code: null,
            can_view_tech_report: false,
            can_add_manual_leads: manualLeadByUserId.get(profile.id) ?? false,
          } as SettingsUser;
        })
        .filter((entry): entry is SettingsUser => entry !== null);
    },
  });

  const displayedUsers = isAdmin ? users : users.filter(u => u.role === "customer_service" || u.id === user?.id);

  const { data: accessCodes = [] } = useQuery<AccessCodeRow[]>({
    queryKey: ["user-access-codes"],
    enabled: isAdmin || currentRole === "cs_admin",
    queryFn: async () => {
      const { data } = await supabase.from("user_access_codes").select("user_id, code");
      return data ?? [];
    },
  });

  const { data: totpStatusData = [] } = useQuery<{ user_id: string; has_totp: boolean }[]>({
    queryKey: ["users-totp-status"],
    enabled: isAdmin || currentRole === "cs_admin",
    queryFn: async () => {
      try {
        const { data, error } = await supabase.rpc("get_users_totp_status" as any);
        if (error || !data) return [];
        return data as { user_id: string; has_totp: boolean }[];
      } catch {
        return [];
      }
    },
    refetchInterval: 15000,
  });

  const userTotpMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    totpStatusData.forEach((row) => {
      map[row.user_id] = row.has_totp;
    });
    return map;
  }, [totpStatusData]);

  const [totpDialogOpen, setTotpDialogOpen] = useState(false);
  const [totpData, setTotpData] = useState<{ userId: string; userName: string; qrCode: string; secret: string } | null>(null);
  const [totpLoadingUser, setTotpLoadingUser] = useState<string | null>(null);
  const [deletingTotpUserId, setDeletingTotpUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const handleEnrollTotp = async (userId: string, userName: string) => {
    setTotpLoadingUser(userId);
    try {
      const res = await adminApi.enrollTotpUser(userId);
      if (res?.qr_code && res?.secret) {
        setTotpData({
          userId,
          userName,
          qrCode: res.qr_code,
          secret: res.secret,
        });
        setTotpDialogOpen(true);
        queryClient.invalidateQueries({ queryKey: ["users-totp-status"] });
        toast.success(`TOTP credentials generated for ${userName}`);
      } else {
        toast.error("Failed to generate TOTP credentials");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to setup TOTP");
    } finally {
      setTotpLoadingUser(null);
    }
  };

  const handleDeleteTotp = async (userId: string, userName: string) => {
    setTotpLoadingUser(userId);
    try {
      await adminApi.deleteTotpUser(userId);
      queryClient.invalidateQueries({ queryKey: ["users-totp-status"] });
      toast.success(`TOTP deleted for ${userName}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete TOTP");
    } finally {
      setTotpLoadingUser(null);
    }
  };

  const { data: navPermissions = [] } = useQuery<NavPermissionRow[]>({
    queryKey: ["settings-nav-permissions"],
    queryFn: async () => {
      const { data } = await supabase.from("navigation_permissions").select("id, user_id, nav_section, allowed");
      return data ?? [];
    },
  });

  const { data: statusVisibility = [] } = useQuery<StatusVisibilityRow[]>({
    queryKey: ["settings-status-visibility"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_status_visibility")
        .select("id, user_id, role, status, is_visible");

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  });

  const { data: messageTemplates = [] } = useQuery<Array<{ key: MessageTemplateKey; template: string }>>({
    queryKey: ["settings-message-templates"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await messageTemplateDb.from("message_templates").select("key, template");
      if (error) throw error;

      const rows = (data ?? []) as Array<{ key: MessageTemplateKey; template: string }>;
      const byKey = new Map(rows.map((row) => [row.key, row.template]));
      return (Object.keys(DEFAULT_MESSAGE_TEMPLATES) as MessageTemplateKey[]).map((key) => ({
        key,
        template: byKey.get(key) ?? DEFAULT_MESSAGE_TEMPLATES[key],
      }));
    },
  });

  const updateTemplate = useMutation({
    mutationFn: async ({ key, template }: { key: MessageTemplateKey; template: string }) => {
      const { error } = await messageTemplateDb.from("message_templates").upsert({
        key,
        template,
        updated_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["settings-message-templates"] });
      queryClient.invalidateQueries({ queryKey: ["message-template", variables.key] });
      toast.success("Template saved");
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed to save template"),
  });

  const userById = useMemo(() => new Map(users.map((targetUser) => [targetUser.id, targetUser])), [users]);
  const accessCodeByUserId = useMemo(() => new Map(accessCodes.map((row) => [row.user_id, row.code])), [accessCodes]);
  const navPermissionByUserAndSection = useMemo(
    () => new Map(navPermissions.map((row) => [`${row.user_id}:${row.nav_section}`, row.allowed])),
    [navPermissions],
  );
  const statusVisibilityByUserAndStatus = useMemo(
    () => new Map(statusVisibility.map((row) => [`${row.user_id}:${row.status}`, row.is_visible])),
    [statusVisibility],
  );
  const statusVisibilityByRoleAndStatus = useMemo(
    () =>
      new Map(
        statusVisibility
          .filter((row) => !row.user_id && row.role)
          .map((row) => [`${row.role}:${row.status}`, row.is_visible]),
      ),
    [statusVisibility],
  );

  const getUserById = (userId: string) => userById.get(userId);

  const getAccessCode = (userId: string) => accessCodeByUserId.get(userId) ?? null;

  const handleGenerateCode = async (userId: string) => {
    const code = generateCode();
    const existing = accessCodes.find((row) => row.user_id === userId);
    const targetUser = getUserById(userId);

    if (existing) {
      await supabase.from("user_access_codes").update({ code }).eq("user_id", userId);

      if (user) {
        await logActivity(user.id, "updated", "user", userId, {
          target_name: targetUser?.full_name || targetUser?.email || userId,
          email: targetUser?.email || null,
          changes: {
            access_code: {
              before: existing.code ?? null,
              after: code,
            },
          },
          message: `Admin regenerated access code for "${targetUser?.full_name || targetUser?.email || "user"}".`,
        });
      }
    } else {
      await supabase.from("user_access_codes").insert({ user_id: userId, code });

      if (user) {
        await logActivity(user.id, "updated", "user", userId, {
          target_name: targetUser?.full_name || targetUser?.email || userId,
          email: targetUser?.email || null,
          changes: {
            access_code: {
              before: null,
              after: code,
            },
          },
          message: `Admin generated access code for "${targetUser?.full_name || targetUser?.email || "user"}".`,
        });
      }
    }

    toast.success("Access code generated");
    queryClient.invalidateQueries({ queryKey: ["user-access-codes"] });
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Code copied to clipboard");
  };

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const existingUser = getUserById(userId);
      const previousRole = existingUser?.role ?? null;

      const { data: existing } = await supabase.from("user_roles").select("id").eq("user_id", userId).single();

      if (existing) {
        await supabase.from("user_roles").update({ role }).eq("user_id", userId);
      } else {
        await supabase.from("user_roles").insert({ user_id: userId, role });
      }

      // Operators and OPR admins each get a permanent, unique OPR code. The RPC
      // is a no-op if they already have one.
      if (role === "opr" || role === "opr_admin") {
        await supabase.rpc("assign_next_opr_code" as never, { _user_id: userId } as never);
      }

      if (user) {
        await logActivity(user.id, "updated", "user", userId, {
          target_name: existingUser?.full_name || existingUser?.email || userId,
          email: existingUser?.email || null,
          changes: {
            role: {
              before: previousRole,
              after: role,
            },
          },
          message: `Admin changed role for "${existingUser?.full_name || existingUser?.email || "user"}" from "${formatRoleLabel(previousRole)}" to "${formatRoleLabel(role)}".`,
        });
      }
    },
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["settings-users"] });
    },
  });

  const toggleNavPermission = useMutation({
    mutationFn: async ({ userId, section, allowed }: { userId: string; section: string; allowed: boolean }) => {
      const existing = navPermissions.find((permission) => permission.user_id === userId && permission.nav_section === section);
      const targetUser = getUserById(userId);
      const beforeAllowed = existing?.allowed ?? false;

      if (existing) {
        await supabase
          .from("navigation_permissions")
          .update({ allowed })
          .eq("id", existing.id);
      } else {
        await supabase.from("navigation_permissions").insert({ user_id: userId, nav_section: section, allowed });
      }

      if (user) {
        await logActivity(user.id, "updated", "user", userId, {
          target_name: targetUser?.full_name || targetUser?.email || userId,
          email: targetUser?.email || null,
          changes: { [`nav_${section}`]: {
              before: beforeAllowed,
              after: allowed,
            },
          },
          message: `Admin ${allowed ? "enabled" : "disabled"} "${NAV_SECTION_LABELS[section] || section}" tab for "${targetUser?.full_name || targetUser?.email || "user"}".`,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-nav-permissions"] });
      toast.success("Navigation permission updated");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update navigation permission");
    },
  });

  const toggleStatusVisibility = useMutation({
    mutationFn: async ({
      userId,
      role,
      status,
      isVisible,
    }: {
      userId?: string;
      role?: AppRole;
      status: string;
      isVisible: boolean;
    }) => {
      const targetUser = userId ? getUserById(userId) : undefined;
      const existing = statusVisibility.find((row) =>
        userId ? row.user_id === userId && row.status === status : !row.user_id && row.role === role && row.status === status,
      );
      const beforeVisible = existing?.is_visible ?? true;

      if (existing) {
        const { error } = await supabase
          .from("lead_status_visibility")
          .update({ is_visible: isVisible })
          .eq("id", existing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("lead_status_visibility").insert({
          user_id: userId ?? null,
          role: role ?? targetUser?.role ?? null,
          status,
          is_visible: isVisible,
        });

        if (error) throw error;
      }

      if (user) {
        await logActivity(user.id, "updated", userId ? "user" : "role", userId ?? role ?? status, {
          target_name: userId
            ? targetUser?.full_name || targetUser?.email || userId
            : `${formatRoleLabel(role)} role`,
          email: targetUser?.email || null,
          changes: {
            [status]: {
              before: beforeVisible,
              after: isVisible,
            },
          },
          message: userId
            ? `Admin ${isVisible ? "showed" : "hid"} "${STATUS_LABELS[status] || status}" status for "${targetUser?.full_name || targetUser?.email || "user"}".`
            : `Admin ${isVisible ? "showed" : "hid"} "${STATUS_LABELS[status] || status}" status for the "${formatRoleLabel(role)}" role.`,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-status-visibility"] });
      queryClient.invalidateQueries({ queryKey: ["lead-status-visibility"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Status visibility updated");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to update status visibility");
    },
  });

  const handleCreateUser = async () => {
    setCreating(true);

    try {
      const code = newRole !== "admin" ? generateCode() : undefined;
      const result = await adminApi.createUser(newEmail, newPassword, newName, newRole, code);
      const createdId = result?.user?.id || result?.id || null;

      // Auto-assign an OPR code to a newly created operator / OPR admin.
      if (createdId && (newRole === "opr" || newRole === "opr_admin")) {
        try {
          await supabase.rpc("assign_next_opr_code" as never, { _user_id: createdId } as never);
        } catch (err) {
          console.warn("Failed to assign OPR code to new user", err);
        }
      }

      if (user) {
        const createdUserId = result?.user?.id || result?.id || newEmail;

        await logActivity(user.id, "created", "user", createdUserId, {
          target_name: newName,
          email: newEmail,
          role: newRole,
          message: `Admin created user "${newName}" with role "${formatRoleLabel(newRole)}".`,
          changes: {
            full_name: {
              before: null,
              after: newName,
            },
            email: {
              before: null,
              after: newEmail,
            },
            role: {
              before: null,
              after: newRole,
            },
            access_code: {
              before: null,
              after: code ?? null,
            },
          },
        });
      }

      toast.success("User created");
      setCreateOpen(false);
      setNewEmail("");
      setNewPassword("");
      setNewName("");
      setNewRole("customer_service");

      queryClient.invalidateQueries({ queryKey: ["settings-users"] });
      queryClient.invalidateQueries({ queryKey: ["user-access-codes"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    }

    setCreating(false);
  };

  const handleSetPassword = async () => {
    if (!newPasswordValue || newPasswordValue.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setSettingPassword(true);

    try {
      await adminApi.setPassword(passwordUserId, newPasswordValue);

      const targetUser = getUserById(passwordUserId);

      if (user) {
        await logActivity(user.id, "password_changed", "user", passwordUserId, {
          target_name: targetUser?.full_name || passwordUserName || targetUser?.email || passwordUserId,
          email: targetUser?.email || null,
          message: `Admin changed password for "${targetUser?.full_name || passwordUserName || targetUser?.email || "user"}".`,
        });
      }

      toast.success(`Password updated for ${passwordUserName}`);
      setPasswordDialogOpen(false);
      setNewPasswordValue("");
      setShowSetPassword(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to set password");
    }

    setSettingPassword(false);
  };

  const toggleQuotationMaster = useMutation({
    mutationFn: async ({ userId, isMaster }: { userId: string; isMaster: boolean }) => {
      const { error } = await supabase.from("profiles").update({ is_quotation_master: isMaster }).eq("id", userId);
      if (error) throw error;
      return { userId, isMaster };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(settingsUsersQueryKey, (old: SettingsUser[] | undefined) =>
        old ? old.map((u) => (u.id === data.userId ? { ...u, is_quotation_master: data.isMaster } : u)) : [],
      );
      toast.success(`Quotation Master ${data.isMaster ? "granted" : "revoked"}`);
    },
    onError: (error) => toast.error(`Failed to update Quotation Master: ${error.message}`),
  });

  const toggleCanManageUsers = useMutation({
    mutationFn: async ({ userId, canManage }: { userId: string; canManage: boolean }) => {
      const { error } = await supabase.from("profiles").update({ can_manage_users: canManage } as never).eq("id", userId);
      if (error) throw error;
      return { userId, canManage };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(settingsUsersQueryKey, (old: SettingsUser[] | undefined) =>
        old ? old.map((u) => (u.id === data.userId ? { ...u, can_manage_users: data.canManage } : u)) : [],
      );
      toast.success(`CS Admin settings access `);
    },
    onError: (error) => toast.error(`Failed to update CS Admin access: ${error.message}`),
  });

  const toggleCanViewTechReport = useMutation({
    mutationFn: async ({ userId, canView }: { userId: string; canView: boolean }) => {
      const { error } = await supabase.from("profiles").update({ can_view_tech_report: canView } as never).eq("id", userId);
      if (error) throw error;
      return { userId, canView };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(settingsUsersQueryKey, (old: SettingsUser[] | undefined) =>
        old ? old.map((u) => (u.id === data.userId ? { ...u, can_view_tech_report: data.canView } : u)) : [],
      );
      toast.success(`Technician report access ${data.canView ? "granted" : "revoked"}`);
    },
    onError: (error) => toast.error(`Failed to update report access: ${error.message}`),
  });

  // profiles UPDATE RLS is admin-only, so this goes through the SECURITY
  // DEFINER RPC that lets a CS Admin (with can_manage_users) grant the flag
  // to Customer Service users only.
  const toggleCanAddManualLead = useMutation({
    mutationFn: async ({ userId, allowed }: { userId: string; allowed: boolean }) => {
      const { error } = await supabase.rpc("set_can_add_manual_leads" as never, {
        target_user_id: userId,
        allowed,
      } as never);
      if (error) throw error;
      return { userId, allowed };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(settingsUsersQueryKey, (old: SettingsUser[] | undefined) =>
        old ? old.map((u) => (u.id === data.userId ? { ...u, can_add_manual_leads: data.allowed } : u)) : [],
      );
      toast.success(`Manual Lead Addition ${data.allowed ? "granted" : "revoked"}`);
    },
    onError: (error) => toast.error(`Failed to update Manual Lead Addition: ${error.message}`),
  });

  const handleDeleteUser = async (userId: string) => {
    const targetUser = getUserById(userId);

    try {
      await adminApi.deleteUser(userId);

      if (user) {
        await logActivity(user.id, "deleted", "user", userId, {
          target_name: targetUser?.full_name || targetUser?.email || userId,
          email: targetUser?.email || null,
          message: `Admin deleted user "${targetUser?.full_name || targetUser?.email || "user"}".`,
        });
      }

      toast.success("User deleted");
      queryClient.invalidateQueries({ queryKey: ["settings-users"] });
      queryClient.invalidateQueries({ queryKey: ["user-access-codes"] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  const getNavPermission = (userId: string, section: string) => {
    const targetUser = getUserById(userId);
    const override = navPermissionByUserAndSection.get(`${userId}:${section}`);

    if (targetUser && section === "cancellation_requests" && canAccessCancellationRequests(targetUser.role)) {
      return true;
    }

    if (typeof override === "boolean") {
      return override;
    }

    if (!targetUser) {
      return false;
    }

    return getDefaultNavAccess(targetUser.role).has(section as (typeof ALL_NAV_ITEMS)[number]);
  };

  const getRoleStatusVisibility = (managedRole: AppRole, status: string) => {
    const override = statusVisibilityByRoleAndStatus.get(`${managedRole}:${status}`);
    if (typeof override === "boolean") {
      return override;
    }
    return getDefaultVisibleStatuses(managedRole).has(status as LeadStatus);
  };
  const getStatusVisibility = (userId: string, status: string) => {
    const targetUser = getUserById(userId);
    const userOverride = statusVisibilityByUserAndStatus.get(`${userId}:${status}`);

    if (typeof userOverride === "boolean") {
      return userOverride;
    }

    if (!targetUser || targetUser.role === "admin") {
      return true;
    }

    return getRoleStatusVisibility(targetUser.role, status);
  };

  const getInitials = (name?: string | null) =>
    name
      ?.split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U";

  const nonAdminUsers = useMemo(() => users.filter((targetUser) => targetUser.role !== "admin"), [users]);
  const enabledNavPermissions = useMemo(
    () =>
      nonAdminUsers.reduce((count, targetUser) => {
        const defaultAccess = getDefaultNavAccess(targetUser.role);
        return (
          count +
          ALL_NAV_ITEMS.filter((section) => {
            const override = navPermissionByUserAndSection.get(`${targetUser.id}:${section}`);
            return typeof override === "boolean" ? override : defaultAccess.has(section);
          }).length
        );
      }, 0),
    [nonAdminUsers, navPermissionByUserAndSection],
  );
  const hiddenStatusCount = useMemo(
    () =>
      nonAdminUsers.reduce((count, targetUser) => {
        const hiddenForUser = ALL_LEAD_STATUSES.filter((status) => {
          const userOverride = statusVisibilityByUserAndStatus.get(`${targetUser.id}:${status}`);
          if (typeof userOverride === "boolean") {
            return !userOverride;
          }

          return !getRoleStatusVisibility(targetUser.role, status);
        }).length;
        return count + hiddenForUser;
      }, 0),
    [nonAdminUsers, statusVisibilityByRoleAndStatus, statusVisibilityByUserAndStatus],
  );

  // Everything below is gated on isAdmin / currentRole. Those are null until the
  // profile and role queries resolve, so rendering early makes the tab bar grow,
  // the user list re-filter, and the per-row permission controls appear - which
  // reflows the whole page on every refresh. Wait for the profile first so the
  // layout is painted once, in its final state.
  if (!profileLoaded || usersPending) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-6" aria-busy="true">
        <div className="h-24 animate-pulse rounded-2xl border border-border/50 bg-card/60" />
        <div className="h-12 animate-pulse rounded-2xl border border-border/50 bg-muted/25" />
        <div className="grid gap-3">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="h-[86px] animate-pulse rounded-2xl border border-border/50 bg-card/50" />
          ))}
        </div>
        <span className="sr-only">Loading settings…</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <motion.div
        variants={heroTitle}
        initial="initial"
        animate="animate"
        className="overflow-hidden rounded-[28px] border border-border/60 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_34%),linear-gradient(180deg,hsl(var(--card)),hsl(var(--card)/0.96))] shadow-[0_32px_80px_-44px_rgba(15,23,42,0.45)]"
      >
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-end lg:justify-between lg:px-7">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/[0.07] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              Workspace Controls
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-3xl">
              Structured control over people, access, and security
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Keep user management clean, tab access predictable, and status visibility easy to audit across the
              whole CRM.
            </p>
          </div>

          {(isAdmin || currentRole === "cs_admin") && (
              <Button onClick={() => setCreateOpen(true)} className="gap-2 self-start lg:self-auto">
              <Plus className="h-4 w-4" />
              Create User
            </Button>
          )}
        </div>

        <div className="grid gap-3 border-t border-border/50 bg-background/45 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-7">
          <div className="rounded-2xl border border-border/60 bg-card/80 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Users</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">{users.length}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">People currently configured in the workspace.</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/80 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Non-admin seats
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">{nonAdminUsers.length}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Users governed by navigation and visibility rules.</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/80 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Enabled tabs
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">{enabledNavPermissions}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Total visible navigation slots across non-admin users.</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/80 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Hidden statuses
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">{hiddenStatusCount}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Status rules currently hiding workflow states.</p>
          </div>
        </div>
      </motion.div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-border/50 bg-muted/35 p-2" role="tablist" aria-label="Settings sections">
        {(
          [
            { key: "users", label: "Users", icon: Shield },
            ...(isAdmin ? [{ key: "nav_permissions" as const, label: "Feature Access", icon: Shield }] : []),
              ...(isAdmin ? [{ key: "status_permissions" as const, label: "Status Visibility", icon: Eye }] : []),
              ...(isAdmin ? [{ key: "templates" as const, label: "Templates", icon: FileText }] : []),
            
            
            { key: "security", label: "Security", icon: ShieldCheck },
            ...(isAdmin ? [{ key: "crm_updates" as const, label: "CRM Updates", icon: Megaphone }] : []),
            ...(isAdmin ? [{ key: "google_sheets" as const, label: "Google Sheets", icon: FileSpreadsheet }] : []),
            ...(isAdmin ? [{ key: "documentation" as const, label: "Documentation", icon: BookOpen }] : []),
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold tracking-[-0.01em] transition-all duration-300",
              activeTab === tab.key
                ? "bg-card text-foreground shadow-premium-sm ring-1 ring-border/50"
                : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "documentation" && isAdmin && <DocumentationTab />}

      {activeTab === "crm_updates" && isAdmin && (
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
          <CrmUpdates />
        </Suspense>
      )}

      {activeTab === "google_sheets" && isAdmin && <GoogleSheetsTab />}

      {activeTab === "users" && (
        <div className="grid gap-3">
          {displayedUsers.map((u) => (
            <Card key={u.id} className="overflow-hidden border-border/60 bg-card/95 hover:shadow-premium-md">
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-3 lg:gap-y-2 xl:gap-x-4">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="bg-primary/8 text-primary text-[11px] font-bold">
                    {getInitials(u.full_name)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 lg:min-w-[12rem] lg:flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <p title={u.full_name || "Unnamed User"} className="truncate text-[13px] font-semibold text-foreground">{u.full_name || "Unnamed User"}</p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold capitalize",
                        roleColors[u.role] || DEFAULT_ROLE_COLOR,
                      )}
                    >
                      {u.role.replace("_", " ")}
                    </span>
                  </div>
                  <p title={u.email || "No email"} className="truncate text-[11px] text-muted-foreground">{u.email || "No email"}</p>
                </div>

                {(isAdmin || currentRole === "cs_admin") && (
                  <div className="flex w-full flex-col gap-2 lg:w-auto lg:shrink-0 lg:flex-row lg:flex-nowrap lg:items-center lg:gap-1.5">
                    {isAdmin && <Select
                      value={u.role}
                      onValueChange={(v) => updateRole.mutate({ userId: u.id, role: v as AppRole })}
                    >
                      <SelectTrigger className="h-10 w-full text-[12px] lg:w-[150px] lg:shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="processor">Processor</SelectItem>
                        <SelectItem value="customer_service">Customer Service</SelectItem>
                        <SelectItem value="cs_admin">CS Admin</SelectItem>
                        <SelectItem value="opr">OPR (Operator)</SelectItem>
                        <SelectItem value="opr_admin">OPR Admin</SelectItem>
                      </SelectContent>
                    </Select>}

                    {(u.role === "opr" || u.role === "opr_admin") && u.opr_code && (
                      <span
                        title="OPR Code"
                        className="inline-flex h-10 shrink-0 items-center gap-1 rounded-2xl border border-border/60 bg-background/70 px-2.5"
                      >
                        <Hash className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <code className="font-mono tracking-wider text-foreground">{u.opr_code}</code>
                      </span>
                    )}

                    {isAdmin && u.role === "cs_admin" && (
                      <div
                        title="Allows this CS Admin to create, edit and delete Customer Service users"
                        className="flex h-10 shrink-0 items-center gap-1.5 rounded-2xl border border-border/60 bg-background/70 px-2.5"
                      >
                        <Switch
                          checked={u.can_manage_users || false}
                          onCheckedChange={(checked) => toggleCanManageUsers.mutate({ userId: u.id, canManage: checked })}
                        />
                        <span className="text-[11px] font-medium leading-none">Manage CS</span>
                      </div>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-[11px] shrink-0"
                      onClick={() => {
                        setPasswordUserId(u.id);
                        setPasswordUserName(u.full_name || u.email || "User");
                        setNewPasswordValue("");
                        setShowSetPassword(false);
                        setPasswordDialogOpen(true);
                      }}
                    >
                      <Lock className="h-3 w-3" />
                      Password
                    </Button>

                    {u.role !== "admin" && (
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-1.5">
                        <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-border/60 bg-background/70 px-2.5 py-1.5">
                          {getAccessCode(u.id) ? (
                            <>
                              <code className="rounded-md border border-border/40 bg-muted/60 px-2 py-0.5 font-mono text-[13px] font-bold tracking-[0.15em] text-foreground">
                                {getAccessCode(u.id)}
                              </code>

                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => handleCopyCode(getAccessCode(u.id)!)}
                                title="Copy code"
                              >
                                <Copy className="h-3 w-3" />
                              </Button>

                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => handleGenerateCode(u.id)}
                                title="Regenerate code"
                              >
                                <RefreshCw className="h-3 w-3" />
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-[11px]"
                              onClick={() => handleGenerateCode(u.id)}
                            >
                              <KeyRound className="h-3 w-3" />
                              Generate Code
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    {(isAdmin || (currentRole === "cs_admin" && u.role === "customer_service")) && (
                      userTotpMap[u.id] ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            title="Two-factor authentication is active for this user"
                            className="inline-flex h-8 items-center gap-1 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-2 text-[11px] font-semibold text-emerald-500"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            2FA
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => handleEnrollTotp(u.id, u.full_name || u.email || "user")}
                            disabled={totpLoadingUser === u.id}
                            title="Recreate / Reset 2FA"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${totpLoadingUser === u.id ? "animate-spin" : ""}`} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive/60 hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setDeletingTotpUserId(u.id)}
                            disabled={totpLoadingUser === u.id}
                            title="Remove 2FA"
                          >
                            <ShieldOff className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-10 shrink-0 gap-1.5 px-2.5 text-[11px]"
                          onClick={() => handleEnrollTotp(u.id, u.full_name || u.email || "user")}
                          disabled={totpLoadingUser === u.id}
                          title="Set up two-factor authentication"
                        >
                          <Shield className="h-3.5 w-3.5" />
                          2FA
                        </Button>
                      )
                    )}

                    {u.role !== "admin" && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 shrink-0 text-destructive/50 hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
                        onClick={() => setDeletingUserId(u.id)}
                        title={`Delete ${u.full_name || u.email || "user"}`}
                        aria-label={`Delete ${u.full_name || u.email || "user"}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}

                    <AlertDialog
                      open={deletingTotpUserId === u.id}
                      onOpenChange={(o) => { if (!o) setDeletingTotpUserId(null); }}
                    >
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete TOTP for {u.full_name || u.email}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove the user's authenticator configuration. They will no longer be prompted for TOTP codes when logging in.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={async () => {
                              await handleDeleteTotp(u.id, u.full_name || u.email || "user");
                              setDeletingTotpUserId(null);
                            }}
                            className="bg-destructive text-destructive-foreground"
                          >
                            Delete TOTP
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>

                    <AlertDialog
                      open={deletingUserId === u.id}
                      onOpenChange={(o) => { if (!o) setDeletingUserId(null); }}
                    >
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete user "{u.full_name || u.email || "user"}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove the user's profile, roles, and permissions. The authentication
                            account will be deactivated.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={async () => {
                              await handleDeleteUser(u.id);
                              setDeletingUserId(null);
                            }}
                            className="bg-destructive text-destructive-foreground"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "nav_permissions" && (
        <div className="space-y-4">
        <LeadCopyAccessSettings users={users} />
        <Card className="overflow-hidden border-border/60 bg-card/95">
          <CardContent className="p-0">
            <div className="flex flex-col gap-2 border-b border-border/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary/8 bg-primary/6">
                  <Shield className="h-3.5 w-3.5 text-primary/70" />
                </div>
                <div>
                  <span className="text-sm font-semibold text-foreground">Feature & Navigation Access</span>
                  <p className="text-[12px] text-muted-foreground">Show only the tabs and features each teammate actually needs.</p>
                </div>
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">{ALL_NAV_ITEMS.length} controllable items</span>
            </div>

            <div className="max-h-[calc(100vh-14rem)] overflow-auto overscroll-contain">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b border-border/30 bg-muted/20">
                    <th className="sticky left-0 top-0 z-30 min-w-[220px] border-b border-r border-border/40 bg-card px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 shadow-[8px_0_14px_-12px_hsl(var(--foreground)/0.45)]">
                      User
                    </th>
                    {ALL_NAV_ITEMS.map((section) => (
                      <th
                        key={section}
                        className="sticky top-0 z-20 border-b border-border/40 bg-card px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60"
                      >
                        {NAV_SECTION_LABELS[section] || section}
                      </th>
                    ))}
                    <th className="sticky top-0 z-20 border-b border-border/40 bg-card px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Tech Report
                    </th>
                    <th className="sticky top-0 z-20 border-b border-border/40 bg-card px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Quotation Master
                    </th>
                    <th className="sticky top-0 z-20 border-b border-border/40 bg-card px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Manual Lead
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {nonAdminUsers.map((u) => (
                    <tr
                      key={u.id}
                      className="group border-b border-border/20 transition-colors last:border-b-0 hover:bg-muted/10"
                    >
                      <td className="sticky left-0 z-10 min-w-[220px] border-r border-border/30 bg-card px-4 py-3 shadow-[8px_0_14px_-12px_hsl(var(--foreground)/0.45)]">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="bg-muted text-muted-foreground text-[9px] font-bold">
                              {getInitials(u.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-[12px] font-medium">{u.full_name}</p>
                            <p className="text-[10px] text-muted-foreground/50 capitalize">
                              {u.role.replace("_", " ")}
                            </p>
                          </div>
                        </div>
                      </td>

                      {ALL_NAV_ITEMS.map((section) => {
                        return (
                          <td key={section} className="px-3 py-3 text-center">
                            <Switch
                              checked={getNavPermission(u.id, section)}
                              disabled={section === "cancellation_requests" && canAccessCancellationRequests(u.role)}
                              onCheckedChange={(checked) =>
                                toggleNavPermission.mutate({ userId: u.id, section, allowed: checked })
                              }
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-center">
                        <Switch
                          checked={u.can_view_tech_report || false}
                          onCheckedChange={(checked) =>
                            toggleCanViewTechReport.mutate({ userId: u.id, canView: checked })
                          }
                        />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Switch
                          checked={u.is_quotation_master || false}
                          onCheckedChange={(checked) =>
                            toggleQuotationMaster.mutate({ userId: u.id, isMaster: checked })
                          }
                        />
                      </td>
                      <td className="px-3 py-3 text-center">
                        {u.role === "customer_service" ? (
                          <Switch
                            checked={u.can_add_manual_leads || false}
                            onCheckedChange={(checked) =>
                              toggleCanAddManualLead.mutate({ userId: u.id, allowed: checked })
                            }
                          />
                        ) : (
                          <span className="text-[11px] text-muted-foreground/50">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        </div>
      )}

      {activeTab === "status_permissions" && (
        <Card className="overflow-hidden border-border/60 bg-card/95">
          <CardContent className="p-0">
            <div className="flex flex-col gap-2 border-b border-border/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary/8 bg-primary/6">
                  <Eye className="h-3.5 w-3.5 text-primary/70" />
                </div>
                <div>
                  <span className="text-sm font-semibold text-foreground">Status Visibility per User</span>
                  <p className="text-[12px] text-muted-foreground">
                    Hidden statuses disappear from All Leads, counters, and filters for that user.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">{ALL_LEAD_STATUSES.length} workflow states</span>
            </div>

            <div>
              <div className="border-b border-border/30 bg-muted/10 px-5 py-4">
                <div className="mb-3">
                  <span className="text-sm font-semibold text-foreground">Role Defaults</span>
                  <p className="text-[12px] text-muted-foreground">
                    Turn a status off for a role to hide leads in that workflow state for that whole role by default.
                  </p>
                </div>

                <div className="max-h-[min(46vh,28rem)] overflow-auto overscroll-contain rounded-xl border border-border/30">
                  <table className="w-full min-w-max text-sm">
                    <thead>
                      <tr className="border-b border-border/30 bg-muted/20">
                        <th className="sticky left-0 top-0 z-30 min-w-[220px] border-b border-r border-border/40 bg-card px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 shadow-[8px_0_14px_-12px_hsl(var(--foreground)/0.45)]">
                          Role
                        </th>
                        {ALL_LEAD_STATUSES.map((status) => (
                          <th
                            key={`role-${status}`}
                            className="sticky top-0 z-20 min-w-[80px] border-b border-border/40 bg-card px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60"
                          >
                            {STATUS_LABELS[status]}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {MANAGED_ROLES.map((managedRole) => (
                        <tr
                          key={managedRole}
                          className="group border-b border-border/20 transition-colors last:border-b-0 hover:bg-muted/10"
                        >
                          <td className="sticky left-0 z-10 min-w-[220px] border-r border-border/30 bg-card px-4 py-3 shadow-[8px_0_14px_-12px_hsl(var(--foreground)/0.45)]">
                            <div>
                              <p className="text-[12px] font-medium">{formatRoleLabel(managedRole)}</p>
                              <p className="text-[10px] text-muted-foreground/50">Role-wide default visibility</p>
                            </div>
                          </td>

                          {ALL_LEAD_STATUSES.map((status) => (
                            <td key={`${managedRole}-${status}`} className="px-2 py-3 text-center">
                              <Switch
                                checked={getRoleStatusVisibility(managedRole, status)}
                                onCheckedChange={(checked) =>
                                  toggleStatusVisibility.mutate({
                                    role: managedRole,
                                    status,
                                    isVisible: checked,
                                  })
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="max-h-[calc(100vh-14rem)] overflow-auto overscroll-contain">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="border-b border-border/30 bg-muted/20">
                      <th className="sticky left-0 top-0 z-30 min-w-[220px] border-b border-r border-border/40 bg-card px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 shadow-[8px_0_14px_-12px_hsl(var(--foreground)/0.45)]">
                        User
                      </th>
                      {ALL_LEAD_STATUSES.map((status) => (
                        <th
                          key={status}
                          className="sticky top-0 z-20 min-w-[80px] border-b border-border/40 bg-card px-2 py-3 text-center text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60"
                        >
                          {STATUS_LABELS[status]}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {nonAdminUsers.map((targetUser) => (
                      <tr
                        key={targetUser.id}
                        className="group border-b border-border/20 transition-colors last:border-b-0 hover:bg-muted/10"
                      >
                        <td className="sticky left-0 z-10 min-w-[220px] border-r border-border/30 bg-card px-4 py-3 shadow-[8px_0_14px_-12px_hsl(var(--foreground)/0.45)]">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="h-7 w-7">
                              <AvatarFallback className="bg-muted text-muted-foreground text-[9px] font-bold">
                                {getInitials(targetUser.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-[12px] font-medium">{targetUser.full_name}</p>
                              <p className="text-[10px] text-muted-foreground/50 capitalize">
                                {targetUser.role.replace("_", " ")}
                              </p>
                            </div>
                          </div>
                        </td>

                        {ALL_LEAD_STATUSES.map((status) => (
                          <td key={status} className="px-2 py-3 text-center">
                            <Switch
                              checked={getStatusVisibility(targetUser.id, status)}
                              onCheckedChange={(checked) =>
                                toggleStatusVisibility.mutate({
                                  userId: targetUser.id,
                                  status,
                                  isVisible: checked,
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "templates" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {messageTemplates.map((templateRow) => (
            <Card key={templateRow.key} className="border-border/60 bg-card/95">
              <CardContent className="space-y-4 p-5">
                <div>
                  <p className="text-sm font-semibold text-foreground">{MESSAGE_TEMPLATE_LABELS[templateRow.key]}</p>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    Admin changes here sync to every role. Popup edits made while copying stay private to that popup.
                  </p>
                </div>

                <TemplateEditor
                  templateKey={templateRow.key}
                  initialValue={templateRow.template}
                  saving={updateTemplate.isPending}
                  onSave={(value) => updateTemplate.mutate({ key: templateRow.key, template: value })}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "security" && (
        <div className="space-y-6">
          <MFAEnroll />
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground/60 font-medium">Full Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="John Doe" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground/60 font-medium">Email</Label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="john@company.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground/60 font-medium">Password</Label>
              <div className="relative">
                <Input
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="********"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  aria-label={showNewPassword ? "Hide password" : "Show password"}
                  title={showNewPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground/60 font-medium">Role</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)} disabled={!isAdmin}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="processor">Processor</SelectItem>
                  <SelectItem value="customer_service">Customer Service</SelectItem>
                  <SelectItem value="cs_admin">CS Admin</SelectItem>
                  <SelectItem value="opr">OPR (Operator)</SelectItem>
                  <SelectItem value="opr_admin">OPR Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={creating || !newEmail || !newPassword || !newName}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Password - {passwordUserName}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground/60 font-medium">New Password</Label>
              <div className="relative">
                <Input
                  type={showSetPassword ? "text" : "password"}
                  value={newPasswordValue}
                  onChange={(e) => setNewPasswordValue(e.target.value)}
                  placeholder="********"
                  className="pr-10"
                  onKeyDown={(e) => e.key === "Enter" && handleSetPassword()}
                />
                <button
                  type="button"
                  onClick={() => setShowSetPassword((v) => !v)}
                  aria-label={showSetPassword ? "Hide password" : "Show password"}
                  title={showSetPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showSetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSetPassword} disabled={settingPassword || !newPasswordValue}>
              {settingPassword ? "Saving..." : "Set Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={totpDialogOpen} onOpenChange={setTotpDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl border border-border/60 bg-card/95 shadow-brand backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              TOTP Setup for {totpData?.userName}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Scan this QR code with Google Authenticator or enter the secret key manually.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {totpData?.qrCode && (
              <div className="flex justify-center p-3 rounded-2xl bg-white border border-border/40 w-48 h-48 mx-auto">
                <img src={totpData.qrCode} alt="TOTP QR Code" className="w-full h-full object-contain" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Secret Key</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-xl border border-border/50 bg-muted/60 p-2.5 font-mono text-xs font-bold text-foreground break-all select-all">
                  {totpData?.secret}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy setup key"
                  className="shrink-0 h-10 w-10"
                  onClick={() => {
                    if (totpData?.secret) {
                      navigator.clipboard.writeText(totpData.secret);
                      toast.success("Secret copied to clipboard");
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button onClick={() => setTotpDialogOpen(false)} className="w-full">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Settings;





















