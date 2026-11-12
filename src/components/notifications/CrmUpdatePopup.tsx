import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Megaphone, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { useNotificationPopupSlot } from "./popup-slot";
import { isBackgroundPollPaused } from "@/lib/overload-guard";
import { useSharedRefresh } from "@/hooks/useCrossTab";

const SECTION_LABEL: Record<string, string> = {
  general: "General / Entire CRM",
  leads: "All Leads",
  quo_monitor: "Quo AI Assistant",
  cancellation_requests: "Lead Cancellation Requests",
  payment_requests: "Paid Approval Pending",
  schedule: "Schedule",
  analytics: "Analytics",
  areas: "Area Insights",
  activity_logs: "Activity Logs",
  settings: "Settings",
};

interface CrmUpdate {
  id: string;
  title: string;
  description: string;
  affected_section: string;
  target_roles: string[];
  priority: "normal" | "important";
  is_active: boolean;
  published_at: string;
}

/**
 * Shows CRM update popups to the current user one at a time.
 * - Loads unread active updates targeted to the current role.
 * - Refreshes while the CRM is visible, without keeping an expensive
 *   Postgres Changes subscription open for every authenticated session.
 * - Acknowledgement is persisted to `crm_update_receipts`.
 */
export default function CrmUpdatePopup() {
  const { user, role, fullyAuthenticated } = useAuth();
  const [queue, setQueue] = useState<CrmUpdate[]>([]);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const scope = user && role && fullyAuthenticated ? `crm-announcements:${user.id}:${role}:${user.created_at ?? ""}` : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  // A refresh that started before an acknowledgement can still return the old
  // unread list. Keep acknowledged IDs out of this tab's queue so it cannot
  // briefly reappear while the trailing refresh catches up.
  const ackedIdsRef = useRef<Set<string>>(new Set());

  const loadUnreadUpdates = useCallback(async () => {
    if (!user || !role || !fullyAuthenticated) return { scope: "", updates: [] as CrmUpdate[] };
      // New users see nothing published before their account existed.
      let query = supabase
        .from("crm_updates" as never)
        .select("id, title, description, affected_section, target_roles, priority, is_active, published_at")
        .eq("is_active", true)
        .contains("target_roles", [role]);
      if (user.created_at) query = query.gte("published_at", user.created_at);
      const { data: updates, error } = await query.order("published_at", { ascending: true });

      if (error) throw error;

      const { data: receipts, error: receiptsError } = await supabase
        .from("crm_update_receipts" as never)
        .select("notification_id")
        .eq("user_id", user.id);

      if (receiptsError) throw receiptsError;

      const ackIds = new Set(
        ((receipts ?? []) as unknown as { notification_id: string }[]).map((r) => r.notification_id),
      );
      return {
        scope: scope ?? "",
        updates: ((updates ?? []) as unknown as CrmUpdate[]).filter((u) => !ackIds.has(u.id)),
      };
  }, [user, role, fullyAuthenticated, scope]);
  const applyUnread = useCallback((result: { scope: string; updates: CrmUpdate[] }, isCurrent: () => boolean) => {
    // A read for an old user/role must never populate the new scope's queue.
    if (!isCurrent() || result.scope !== scopeRef.current) return;
    const fresh = result.updates.filter((update) => !ackedIdsRef.current.has(update.id));
    setQueue((prev) => {
      const remaining = prev.filter((item) => fresh.some((update) => update.id === item.id));
      const existing = new Set(remaining.map((item) => item.id));
      return [...remaining, ...fresh.filter((item) => !existing.has(item.id))];
    });
  }, []);
  const { refresh, isOwner } = useSharedRefresh(scope, loadUnreadUpdates, applyUnread);
  useEffect(() => {
    ackedIdsRef.current = new Set();
    setQueue([]);
    setAckingId(null);
  }, [scope]);

  // CRM announcements are low-frequency. Visibility-aware polling keeps the
  // same acknowledgement workflow while avoiding the project's hottest query.
  useEffect(() => {
    if (!user || !role || !fullyAuthenticated) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh().catch((error: unknown) => console.warn("CRM announcements could not be refreshed", error));
    };

    refreshWhenVisible();
    // Timer turns skip while the server is overloaded (see overload-guard).
    const intervalId = isOwner ? window.setInterval(() => { if (!isBackgroundPollPaused()) refreshWhenVisible(); }, 60_000) : 0;
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [user, role, fullyAuthenticated, refresh, isOwner]);

  const current = queue[0];
  const visible = useNotificationPopupSlot("crmUpdate", Boolean(current));

  const handleAck = async () => {
    if (!current || !user) return;
    const ackScope = scope;
    setAckingId(current.id);
    const { error } = await supabase.from("crm_update_receipts" as never).insert({
      notification_id: current.id,
      user_id: user.id,
    } as never);
    if (scopeRef.current !== ackScope) return;
    setAckingId(null);
    if (error && !/duplicate|unique/i.test(error.message)) {
      console.error("Failed to acknowledge CRM update", error);
      return;
    }
    ackedIdsRef.current.add(current.id);
    setQueue((prev) => prev.slice(1));
    // Broadcast the acknowledged result so other tabs do not ask for it again.
    void refresh().catch((error: unknown) => console.warn("CRM announcement acknowledgement refresh failed", error));
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  if (!current || !visible) return null;

  const isImportant = current.priority === "important";

  return (
    <Dialog open={true} onOpenChange={() => { /* modal must be acknowledged */ }}>
      <DialogContent
        className={`max-w-lg rounded-3xl border-2 p-0 overflow-hidden ${
          isImportant
            ? "border-primary/70 shadow-[0_30px_60px_-20px_hsl(var(--primary)/0.5)]"
            : "border-border/60"
        }`}
      >
        <div className="bg-gradient-to-br from-primary/95 via-[hsl(230,94%,58%)] to-[hsl(220,90%,45%)] px-6 py-5 text-primary-foreground">
          <DialogHeader className="text-left space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                <Megaphone className="h-4 w-4" />
              </span>
              <span className="text-xs font-bold uppercase tracking-[0.2em] opacity-90">
                CRM Update
              </span>
              {isImportant && (
                <Badge className="ml-auto gap-1 border-white/40 bg-white/20 text-white hover:bg-white/25">
                  <AlertCircle className="h-3 w-3" />
                  Important
                </Badge>
              )}
            </div>
            <DialogTitle className="text-xl font-bold text-white">
              {current.title}
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {current.description}
          </p>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
              {SECTION_LABEL[current.affected_section] ?? current.affected_section}
            </span>
            <span className="text-muted-foreground">
              {format(new Date(current.published_at), "MMM d, yyyy • h:mm a")}
            </span>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Tip:</span> For a true hard refresh, press{" "}
            <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px]">Ctrl + Shift + R</kbd>{" "}
            (Windows) or{" "}
            <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px]">Cmd + Shift + R</kbd>{" "}
            (Mac).
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={handleRefresh}
              className="gap-2 rounded-xl"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh CRM
            </Button>
            <Button
              onClick={handleAck}
              disabled={ackingId === current.id}
              className="gap-2 rounded-xl"
            >
              <CheckCircle2 className="h-4 w-4" />
              Got It
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
