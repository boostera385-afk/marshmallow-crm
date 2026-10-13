import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail?: string | null;
};

type VisibilityState = {
  current: boolean;
  next: boolean;
  confirm: boolean;
};

const initialVisibility: VisibilityState = {
  current: false,
  next: false,
  confirm: false,
};

const SUPABASE_URL = "https://kxiqholnmhkwhdkhtopp.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4aXFob2xubWhrd2hka2h0b3BwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNjU0OTcsImV4cCI6MjA4ODc0MTQ5N30.yDiNd6Sl2jWbkNN0Wf5cjClVJKoQXAd8q8kkBUWep7o";

export default function ChangePasswordDialog({ open, onOpenChange, userEmail }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState<VisibilityState>(initialVisibility);

  const verifyClient = useMemo(
    () =>
      createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }),
    [],
  );

  function clearForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShow(initialVisibility);
  }

  useEffect(() => {
    if (!open) {
      clearForm();
      setSaving(false);
    }
  }, [open]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!userEmail) {
      toast.error("Could not verify your account. Please sign in again.");
      return;
    }
    if (!currentPassword) {
      toast.error("Current password is required.");
      return;
    }
    if (!newPassword) {
      toast.error("New password is required.");
      return;
    }
    if (!confirmPassword) {
      toast.error("Please confirm your new password.");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      toast.error("New password must be different from your current password.");
      return;
    }

    setSaving(true);
    try {
      const { error: verifyError } = await verifyClient.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      });

      if (verifyError) {
        const invalidCredentials =
          verifyError.message.toLowerCase().includes("invalid login credentials") ||
          verifyError.message.toLowerCase().includes("invalid credentials");
        toast.error(
          invalidCredentials
            ? "Current password is incorrect."
            : "Could not verify your current password. Please try again.",
        );
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        toast.error(updateError.message || "Could not update password. Please try again.");
        return;
      }

      toast.success("Password updated successfully.");
      clearForm();
      onOpenChange(false);
    } catch (err) {
      toast.error((err as { message?: string } | null)?.message || "Could not update password. Please try again.");
    } finally {
      setSaving(false);
      void verifyClient.auth.signOut();
    }
  }

  function toggleVisibility(key: keyof VisibilityState) {
    setShow((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleOpenChange(nextOpen: boolean) {
    if (saving) return;
    if (!nextOpen) clearForm();
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border-border bg-card p-0 shadow-xl">
        <form onSubmit={handleSubmit} className="overflow-hidden rounded-2xl">
          <div className="border-b border-border bg-muted/40 px-6 py-5">
            <DialogHeader className="space-y-1 text-left">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <KeyRound className="h-4 w-4" />
              </div>
              <DialogTitle className="pt-2 text-[18px] font-bold tracking-tight text-foreground">
                Change Password
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-5 text-muted-foreground">
                Verify your current password, then set a new password for your account.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="current-password" className="text-[13px] font-semibold text-foreground">
                Current Password
              </Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={show.current ? "text" : "password"}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  className="h-10 rounded-xl pr-10 text-[13px]"
                  placeholder="Enter current password"
                />
                <button
                  type="button"
                  onClick={() => toggleVisibility("current")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  aria-label={show.current ? "Hide current password" : "Show current password"}
                >
                  {show.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="new-password" className="text-[13px] font-semibold text-foreground">
                  New Password
                </Label>
                <span className="text-[11px] font-medium text-muted-foreground">At least 6 characters</span>
              </div>
              <div className="relative">
                <Input
                  id="new-password"
                  type={show.next ? "text" : "password"}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  className="h-10 rounded-xl pr-10 text-[13px]"
                  placeholder="Enter new password"
                />
                <button
                  type="button"
                  onClick={() => toggleVisibility("next")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  aria-label={show.next ? "Hide new password" : "Show new password"}
                >
                  {show.next ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-[13px] font-semibold text-foreground">
                Confirm New Password
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={show.confirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  className="h-10 rounded-xl pr-10 text-[13px]"
                  placeholder="Confirm new password"
                />
                <button
                  type="button"
                  onClick={() => toggleVisibility("confirm")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  aria-label={show.confirm ? "Hide confirmed password" : "Show confirmed password"}
                >
                  {show.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-border bg-muted/20 px-6 py-4 sm:justify-between sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="rounded-xl gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              <span>Update Password</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
