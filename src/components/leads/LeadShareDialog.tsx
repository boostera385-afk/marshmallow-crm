import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Share2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  leadId: string;
  customerName: string;
  className?: string;
}

interface CSRUser {
  user_id: string;
  display_name: string;
  email: string | null;
  isShared: boolean;
}

interface CustomerServiceRoleRow {
  user_id: string;
}

interface LeadShareRow {
  shared_with_user_id: string;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

export default function LeadShareDialog({ leadId, customerName, className }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [csrUsers, setCsrUsers] = useState<CSRUser[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchCSRUsers = useCallback(async () => {
    const [rolesRes, sharesRes] = await Promise.all([
      supabase.from("user_roles").select("user_id, role").eq("role", "customer_service"),
      supabase.from("lead_shares").select("shared_with_user_id").eq("lead_id", leadId),
    ]);

    if (!rolesRes.data) return;

    const csUserIds = (rolesRes.data as CustomerServiceRoleRow[]).map((roleRow) => roleRow.user_id);
    const { data: profiles } = await supabase.from("profiles_public" as never).select("id, full_name").in("id", csUserIds) as { data: { id: string; full_name: string | null }[] | null };
    const sharedIds = new Set(
      ((sharesRes.data as LeadShareRow[] | null | undefined) ?? []).map((share) => share.shared_with_user_id),
    );

    setCsrUsers(
      ((profiles ?? []) as { id: string; full_name: string | null }[])
        .filter((profile) => profile.id !== user?.id)
        .map((profile) => ({
          user_id: profile.id,
          display_name: profile.full_name || "Unnamed User",
          email: null,
          isShared: sharedIds.has(profile.id),
        })),
    );
  }, [leadId, user?.id]);

  useEffect(() => {
    if (open) {
      void fetchCSRUsers();
    }
  }, [fetchCSRUsers, open]);

  const toggleShare = async (userId: string, share: boolean) => {
    setSaving(true);

    if (share) {
      await supabase.from("lead_shares").insert({
        lead_id: leadId,
        shared_with_user_id: userId,
        shared_by: user!.id,
      });

      // The shared user is notified by the database (lead_shares_notify).
    } else {
      await supabase.from("lead_shares").delete().eq("lead_id", leadId).eq("shared_with_user_id", userId);
    }

    await fetchCSRUsers();
    toast.success(share ? "Lead shared & notification sent" : "Share removed");
    setSaving(false);
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((chunk) => chunk[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className={cn("h-9 w-9", className)} onClick={(e) => e.stopPropagation()} aria-label="Share lead">
          <Share2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="text-base">Share "{customerName}"</DialogTitle>
        </DialogHeader>

        <p className="text-[12px] text-muted-foreground">
          Select CS users who should see this lead. They'll receive a notification.
        </p>

        <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
          {csrUsers.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No CS users found.</p>}

          {csrUsers.map((csr, i) => (
            <motion.div
              key={csr.user_id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, type: "spring", stiffness: 350, damping: 28 }}
              className="crm-lead-card-inner flex items-center justify-between rounded-[18px] p-3 transition-all duration-200 hover:border-primary/24 hover:bg-primary/[0.04] dark:hover:bg-primary/[0.08]"
            >
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={csr.isShared}
                  onCheckedChange={(checked) => toggleShare(csr.user_id, !!checked)}
                  disabled={saving}
                />

                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-primary/8 text-[9px] font-bold text-primary">
                    {getInitials(csr.display_name)}
                  </AvatarFallback>
                </Avatar>

                <div>
                  <p className="text-[13px] font-medium">{csr.display_name}</p>
                  <p className="text-[11px] text-muted-foreground/60">{csr.email}</p>
                </div>
              </div>

              {csr.isShared && (
                <Badge
                  variant="outline"
                  className="border-primary/14 bg-primary/6 text-[10px] font-semibold text-primary dark:border-primary/22 dark:bg-primary/[0.14]"
                >
                  Shared
                </Badge>
              )}
            </motion.div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
