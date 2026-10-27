import {
  Users,
  BarChart3,
  Settings,
  ScrollText,
  Calendar,
  LogOut,
  Contact,
  MapPin,
  Map as MapIcon,
  Sparkles,
  ChevronRight,
  ClipboardX,
  DollarSign,
  MessageSquare,
  Megaphone,
  KeyRound,
  FileWarning,
  ClipboardCheck,
Shield,
ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  TrendingUp,
  Wrench,
  Bell,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { STATUS_LABELS, STATUS_DOT_COLORS, ALL_LEAD_STATUSES } from "@/lib/constants";
import { scheduleRequirementDueOrOverdue } from "@/lib/schedule-date-filter";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { useAllowedStatuses } from "@/hooks/useAllowedStatuses";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import { isQuotationMaster } from "@/lib/lead-tags";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import marshmallowLogo from "@/assets/marshmallow-logo.png.asset.json";
import ChangePasswordDialog from "@/components/auth/ChangePasswordDialog";
import { useUpdateCount } from "@/hooks/useCxUpdates";
import { useNotificationUnreadCount } from "@/hooks/useNotificationInbox";

const getNavItems = (role: string) => [
  { title: "All Leads", url: "/leads", icon: Users, navKey: "leads", group: "Work" },
  { title: "QUO Inbox", url: "/quo-monitor", icon: MessageSquare, navKey: "quo_monitor", group: "Work" },
  { title: "AI Assistance", url: "/ai-assistance", icon: Sparkles, navKey: "ai_assistance", group: "Work" },
  { title: "Schedule", url: "/schedule", icon: Calendar, navKey: "schedule", group: "Work" },
  { title: "Notifications", url: "/notifications", icon: Bell, navKey: "notifications", group: "Work" },
  { title: "Processor Board", url: "/processor-board", icon: ClipboardCheck, navKey: "processor_board", group: "Work" },
  { title: "Map View", url: "/map-view", icon: MapIcon, navKey: "map_view", group: "Work" },
  { title: "Cancellation requests", url: "/lead-cancellation-requests", icon: ClipboardX, navKey: "cancellation_requests", group: "Review" },
  { title: "Payment approvals", url: "/lead-payment-requests", icon: DollarSign, navKey: "payment_requests", group: "Review" },
  { title: "Quote Approval", url: "/quote-approval", icon: ClipboardCheck, navKey: "quote_approval_requests", group: "Review" },
  { title: "Quotes to send", url: "/quote-pending", icon: FileWarning, navKey: "quote_pending_requests", group: "Review" },
    { title: "Tech Approvals", url: "/tech-approvals", icon: ShieldCheck, navKey: "technician_change_requests", group: "Review" },
    { title: "Urgent review", url: "/urgent-review-requests", icon: ShieldAlert, navKey: "urgent_review_requests", group: "Review" },
{ title: "Technicians", url: "/technicians", icon: Contact, navKey: "technicians", group: "Manage" },
    { title: "Area Insights", url: "/areas", icon: MapPin, navKey: "areas", group: "Manage" },
  { title: "Optimization", url: "/optimization", icon: TrendingUp, navKey: "optimization", group: "Manage" },
  { title: "Analytics", url: "/analytics", icon: BarChart3, navKey: "analytics", anyOf: ["analytics", "cs_team_performance"], group: "Insights" },
  { title: "Activity Logs", url: "/activity-logs", icon: ScrollText, navKey: "activity_logs", group: "Insights" },
  ...(role === "cs_admin" ? [{ title: "Users", url: "/settings", icon: Shield, navKey: "settings", group: "Manage" }] : [{ title: "Settings", url: "/settings", icon: Settings, navKey: "settings", group: "Admin" }]),
];

// localStorage key used to broadcast a New Quote Request dismissal to other tabs.
const QUOTE_DISMISS_KEY = "quote-request-dismissed";
const quoteToastId = (id: string) => `quote-request-${id}`;

export default function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, role, signOut, canAccess } = useAuth();
  const { allowedStatuses } = useAllowedStatuses();
  const queryClient = useQueryClient();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const cxCount = useUpdateCount("cx");
  const techCount = useUpdateCount("tech");
  const notificationCount = useNotificationUnreadCount();
  // Leads already announced as Pending to Send, so one status change alerts exactly once.
  const announcedQuotePendingIds = useRef<Set<string>>(new Set());

  // Dismissing the New Quote Request notification in one tab clears it in every other
  // open tab (broadcast via localStorage), so it only has to be dismissed once.
  const dismissQuoteRequest = (id: string) => {
    toast.dismiss(quoteToastId(id));
    announcedQuotePendingIds.current.add(id);
    try {
      localStorage.setItem(QUOTE_DISMISS_KEY, JSON.stringify({ id, ts: Date.now() }));
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== QUOTE_DISMISS_KEY || !event.newValue) return;
      try {
        const { id } = JSON.parse(event.newValue) as { id?: string };
        if (!id) return;
        announcedQuotePendingIds.current.add(id);
        toast.dismiss(quoteToastId(id));
      } catch {
        // ignore malformed payloads
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Fetch pending cancellation requests count for the sidebar badge
  const canSeeCancellations = canAccess("cancellation_requests");
  const { data: pendingCancellationCount = 0 } = useQuery({
    queryKey: ["pending-cancellations-count"],
    enabled: canSeeCancellations,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("lead_cancellation_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");

      if (error) {
        console.error("Error fetching pending cancellations count:", error.message);
        return 0;
      }
      return count || 0;
    },
    refetchInterval: 15000,
  });

  // Hidden badges do not need a query or a polling timer.
  const { data: pendingPaymentCount = 0 } = useQuery({
    queryKey: ["pending-payment-requests-count"],
    enabled: canAccess("payment_requests"),
    queryFn: async () => {
      const { count, error } = await supabase.from("lead_payment_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) {
        console.error("Error fetching pending payment requests count:", error.message);
        return 0;
      }
      return count || 0;
    },
    refetchInterval: 30000,
  });

  const canSeeQuoteApproval = canAccess("quote_approval_requests");
  const { data: pendingQuoteApprovalCount = 0 } = useQuery({
    queryKey: ["pending-quote-approval-count"],
    enabled: canSeeQuoteApproval,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("lead_quote_approval_requests" as never)
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) {
        console.error("Error fetching pending quote approval count:", error.message);
        return 0;
      }
      return count || 0;
    },
    refetchInterval: 30000,
  });

  const { data: pendingQuoteCount = 0 } = useQuery({
    queryKey: ["pending-quote-requests-count"],
    enabled: canAccess("quote_pending_requests"),
    queryFn: async () => {
      const { count, error } = await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_to_send");
      if (error) {
        console.error("Error fetching pending quote requests count:", error.message);
        return 0;
      }
      return count || 0;
    },
    refetchInterval: 30000,
  });

  // Pending urgent review requests. CS Admin and Admin only, matching the queue
  // page. Counted through the same SECURITY DEFINER list function the page uses
  // rather than counting the table directly, so the badge cannot disagree with
  // what is actually reviewable.
  const canSeeUrgentReview = role === "admin" || role === "cs_admin";
  const { data: pendingUrgentReviewCount = 0 } = useQuery({
    queryKey: ["pending-urgent-review-count"],
    enabled: canSeeUrgentReview,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_urgent_review_requests" as never, {
        p_status: "pending",
      } as never);
      if (error) {
        console.error("Error fetching pending urgent review count:", error.message);
        return 0;
      }
      return (data as unknown[] | null)?.length ?? 0;
    },
    refetchInterval: 30000,
  });

  // AI Assistance missed-lead count (Admin + CS Admin only). Uses the same
  // SECURITY DEFINER function the page counts through, with the default 24h
  // window, so the badge matches the list a CS Admin opens at shift start.
  const canSeeAiAssistance = role === "admin" || role === "cs_admin" || role === "customer_service";
  const { data: missedFollowupCount = 0 } = useQuery({
    queryKey: ["cs-missed-followup-count"],
    enabled: canSeeAiAssistance,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_cs_missed_followup_count" as never, {
        p_since: null,
        p_until: null,
        p_number_ids: null,
      } as never);
      if (error) {
        console.error("Error fetching missed follow-up count:", error.message);
        return 0;
      }
      return typeof data === "number" ? data : 0;
    },
    refetchInterval: 30000,
  });

  // "Need Attention" leads: urgent jobs whose schedule is due today or overdue.
  // The date logic lives in text, so we pull the urgent leads and evaluate it
  // client-side (same helper the lead card uses, so the count matches the tab).
  // Only Admin / CS / CS Admin see this tab; CS is scoped to its own leads.
  const canSeeNeedAttention = role === "admin" || role === "customer_service" || role === "cs_admin";
  const { data: needAttentionCount = 0 } = useQuery({
    queryKey: ["need-attention-count", role, profile?.id],
    enabled: canSeeNeedAttention,
    queryFn: async () => {
      try {
        // Page through every urgent lead (PostgREST caps one response at 1000),
        // so the badge can never undercount even with a large urgent backlog.
        const rows = await fetchAllRows<{ id: string; customer_schedule_requirements: string | null }>((from, to) => {
          let q = supabase
            .from("leads")
            .select("id, customer_schedule_requirements")
            .eq("status", "urgent_job")
            .order("id", { ascending: true })
            .range(from, to);
          if (role === "customer_service" && profile?.id) q = q.eq("created_by", profile.id);
          return q;
        });
        return rows.filter((l) => scheduleRequirementDueOrOverdue(l.customer_schedule_requirements)).length;
      } catch (error) {
        console.error("Error fetching need-attention count:", error instanceof Error ? error.message : error);
        return 0;
      }
    },
    refetchInterval: 30000,
  });

  // Realtime subscription for instant sidebar updates when a cancellation is requested/resolved
  useEffect(() => {
    if (!canSeeCancellations) return;
    const channel = supabase
      .channel("lead-cancellations-sidebar-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_cancellation_requests" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["pending-cancellations-count"] });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [canSeeCancellations, queryClient]);

  // Realtime subscription for payment request badge
  useEffect(() => {
    if (role !== "admin") return;
    const channel = supabase
      .channel("lead-payment-requests-sidebar-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_payment_requests" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["pending-payment-requests-count"] });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, role]);

  useEffect(() => {
    if (!canSeeQuoteApproval) return;
    const channel = supabase
      .channel("quote-approval-sidebar-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_quote_approval_requests" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["pending-quote-approval-count"] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [canSeeQuoteApproval, queryClient]);

  // Realtime subscription for quote pending requests badge and notification
  useEffect(() => {
    // CS Admins do not work the Quote to Send queue, so they are not alerted for it.
    if (!isQuotationMaster(role, profile?.is_quotation_master)) return;

    const announceQuotePending = (newRow: { id?: string; status?: string; customer_name?: string | null } | undefined) => {
      if (!newRow || newRow.status !== "pending_to_send" || !newRow.id) return;

      queryClient.invalidateQueries({ queryKey: ["pending-quote-requests-count"] });

      // Announce a lead once per session. The previous guard compared payload.old.status, but
      // Postgres only ships the old row's other columns under REPLICA IDENTITY FULL — with the
      // default identity `old` carries just the primary key, so `old.status` was undefined and
      // every later edit to a lead already Pending to Send re-fired the alarm. Re-subscribing
      // (role/profile arriving) could double-fire it too.
      if (announcedQuotePendingIds.current.has(newRow.id)) return;
      announcedQuotePendingIds.current.add(newRow.id);

      // A modal alert here used to steal pointer/focus from an already-open
      // photo lightbox, leaving its higher-z-index image impossible to close.
      // A persistent Sonner notification preserves the alert without blocking work.
      toast("New quote request", {
        id: quoteToastId(newRow.id),
        description: `${newRow.customer_name || "A customer"} is waiting for a quote.`,
        duration: Infinity,
        action: { label: "View requests", onClick: () => { dismissQuoteRequest(newRow.id!); navigate("/quote-pending"); } },
        cancel: { label: "Dismiss", onClick: () => dismissQuoteRequest(newRow.id!) },
      });
      void import("@/lib/notification-sound").then(({ playUrgentAlertSound }) => playUrgentAlertSound());
    };

    const channel = supabase
      .channel("quote-pending-sidebar-realtime")
      // Server-side filter: only rows entering "pending_to_send" are delivered,
      // instead of every lead change. Cuts realtime message volume drastically.
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads", filter: "status=eq.pending_to_send" },
        (payload) => announceQuotePending(payload.new as { id?: string; status?: string } | undefined),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "leads", filter: "status=eq.pending_to_send" },
        (payload) => announceQuotePending(payload.new as { id?: string; status?: string } | undefined),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, role, profile?.is_quotation_master, navigate]);

    // Global Leads Notifications (e.g. Activate Customer)
  useEffect(() => {
    if (!profile) return;

    const channel = supabase
      .channel("global-leads-notifications")
      // Only "activate_customer" rows are delivered — the handler ignores every
      // other status anyway, so this is a pure realtime-cost reduction.
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads", filter: "status=eq.activate_customer" },
        (payload) => {
          const newRow = payload.new as { id?: string; status?: string; customer_name?: string | null; created_by?: string } | undefined;
          const oldRow = payload.old as { status?: string } | undefined;

          if (newRow && newRow.status === "activate_customer" && oldRow?.status !== "activate_customer") {
            const isRelevantUser =
              role === "cs_admin" ||
              role === "admin" ||
              (role === "customer_service" && newRow.created_by === profile.id);

            if (isRelevantUser) {
              void import("@/lib/notification-sound").then(({ playAssignmentSound }) => playAssignmentSound());
              toast("Customer needs activation", {
                id: `activate-customer-${newRow.id}`,
                description: `${newRow.customer_name || "A customer"} needs attention.`,
                action: { label: "Open lead", onClick: () => navigate(`/leads/${newRow.id}`) },
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [role, profile?.id, navigate]);

  const visibleItems = getNavItems(role || "").filter((item) => ("anyOf" in item && item.anyOf ? item.anyOf : [item.navKey]).some(canAccess));
  // "Need Attention" is a virtual Review item (Admin/CS/CS Admin), rendered with
  // its own blinking dot + count under the Review header rather than a real route.
  const needAttentionItem =
    canSeeNeedAttention && canAccess("leads")
      ? { title: "Need Attention", url: "/leads?attention=1", icon: AlertTriangle, navKey: "need_attention", group: "Review" }
      : null;
  const visibleGroups = ["Work", "Review", "Manage", "Insights", "Admin"].map((label) => ({
    label,
    items: [
      ...visibleItems.filter((item) => item.group === label),
      ...(label === "Review" && needAttentionItem ? [needAttentionItem] : []),
      ...(label === "Review" && canAccess("cx_updates") ? [{ title: "Get CX Update", url: "/get-cx-update", icon: MessageSquare, navKey: "cx_updates", group: "Review" }] : []),
      ...(label === "Review" && canAccess("cx_updates") ? [{ title: "Get Tech Update", url: "/get-tech-update", icon: Wrench, navKey: "tech_updates", group: "Review" }] : []),
    ],
  })).filter((group) => group.items.length > 0);
  const visibleStatuses = ALL_LEAD_STATUSES.filter((status) => allowedStatuses.has(status));

  const initials = profile?.full_name
    ? profile.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  const searchParamsForLocation = new URLSearchParams(location.search);
  const rawCurrentStatus = searchParamsForLocation.get("status");
  const currentStatus = rawCurrentStatus && allowedStatuses.has(rawCurrentStatus) ? rawCurrentStatus : null;
  const attentionActive = location.pathname.startsWith("/leads") && searchParamsForLocation.get("attention") === "1";

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/45 bg-[hsl(var(--sidebar-background)/0.8)]">
      <SidebarHeader className="p-4 pb-3">
        {collapsed ? (
          <div className="flex items-center justify-center">
            <motion.div
              whileHover={{ scale: 1.06, rotate: -3 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 280, damping: 18 }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl overflow-hidden shadow-[0_14px_32px_-12px_hsl(var(--primary)/0.65)] ring-1 ring-white/18"
            >
              <img src={marshmallowLogo.url} alt="Marshmallow" className="h-full w-full object-cover" />
            </motion.div>
          </div>
        ) : (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="relative overflow-hidden rounded-[26px] border border-white/40 bg-[radial-gradient(circle_at_top_left,hsl(193_100%_87%/0.34),transparent_38%),radial-gradient(circle_at_bottom_right,hsl(210_100%_88%/0.18),transparent_34%),linear-gradient(180deg,hsl(var(--sidebar-accent)/0.96),hsl(var(--sidebar-accent)/0.66))] p-3 shadow-[0_24px_44px_-28px_rgba(59,130,246,0.2)]"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(148,197,255,0.28),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.28),transparent_54%)]" />

          <div className="relative flex items-center gap-3">
              <motion.div
                whileHover={{ scale: 1.06, rotate: -3 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 280, damping: 18 }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl overflow-hidden shadow-[0_14px_32px_-12px_hsl(var(--primary)/0.65)] ring-1 ring-white/18"
              >
              <img src={marshmallowLogo.url} alt="Marshmallow" className="h-full w-full object-cover" />
            </motion.div>

              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.24, delay: 0.04 }}
                className="min-w-0 flex-1"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold tracking-tight text-sidebar-accent-foreground">
                    Marshmallow
                  </span>
                </div>

                <span className="mt-0.5 block text-[10px] font-medium capitalize tracking-[0.16em] text-sidebar-foreground/38">
                  {role?.replace("_", " ")}
                </span>
                {(role === "opr" || role === "opr_admin") && profile?.opr_code && (
                  <span className="mt-1 block font-mono text-[10px] font-semibold tracking-[0.14em] text-sidebar-foreground/65">
                    {profile.opr_code}
                  </span>
                )}
              </motion.div>
          </div>
        </motion.div>
        )}
      </SidebarHeader>

      <SidebarContent className="overflow-y-auto px-2 pb-2">
        <ScrollArea className="flex-1">
          {visibleGroups.map(({ label, items }, groupIndex) => (
          <SidebarGroup key={label} className={groupIndex === 0 ? undefined : "mt-3"}>
            {!collapsed && (
              <SidebarGroupLabel className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/55">
                {label}
              </SidebarGroupLabel>
            )}

            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {items.map((item, index) => {
                  const isNeedAttention = item.navKey === "need_attention";
                  const isActive = isNeedAttention
                    ? attentionActive
                    : location.pathname.startsWith(item.url) && !currentStatus && !(item.navKey === "leads" && attentionActive);

                  return (
                    <motion.div
                      key={item.title}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.18, delay: (groupIndex * 0.04) + (index * 0.02) }}
                    >
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                          <NavLink
                            to={item.url}
                            className={`group/nav relative flex items-center rounded-[18px] border border-transparent px-3 py-2.5 transition-all duration-300 ${
                              isActive
                                ? "border-white/34 bg-[radial-gradient(circle_at_left,hsl(194_100%_88%/0.18),transparent_28%),linear-gradient(180deg,hsl(var(--sidebar-accent)/0.98),hsl(var(--sidebar-accent)/0.82))] text-sidebar-accent-foreground shadow-[0_18px_28px_-20px_rgba(59,130,246,0.18)] ring-1 ring-white/12"
                                : "hover:border-white/18 hover:bg-[linear-gradient(180deg,hsl(var(--sidebar-accent)/0.76),hsl(var(--sidebar-accent)/0.56))] hover:shadow-[0_12px_22px_-20px_rgba(59,130,246,0.12)]"
                            }`}
                            activeClassName="text-sidebar-accent-foreground"
                          >
                            {isActive && (
                              <motion.div
                                layoutId="sidebar-active-pill"
                                className="absolute inset-0 rounded-[18px] bg-gradient-to-r from-white/[0.10] via-white/[0.04] to-transparent"
                                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                              />
                            )}

                            <div className="relative shrink-0">
                              <item.icon
                                className={`relative z-10 h-4 w-4 transition-all duration-200 ${
                                  isActive
                                    ? "text-primary"
                                    : "text-sidebar-foreground/42 group-hover/nav:text-sidebar-foreground/78 group-hover/nav:scale-105"
                                }`}
                              />
                              {item.navKey === "cx_updates" && collapsed && (cxCount.data ?? 0) > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" />}
                              {item.navKey === "tech_updates" && collapsed && (techCount.data ?? 0) > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500" />}
                              {item.navKey === "notifications" && (notificationCount.data ?? 0) > 0 && <span aria-label={`${notificationCount.data} unread notifications`} className="absolute -right-2 -top-2 rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{notificationCount.data}</span>}
                              {item.navKey === "cancellation_requests" && pendingCancellationCount > 0 && collapsed && (
                                <span className="absolute -top-1.5 -right-1.5 flex h-2 w-2 z-20">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 shadow-[0_0_6px_#ef4444]"></span>
                                </span>
                              )}
                              {item.navKey === "payment_requests" && pendingPaymentCount > 0 && collapsed && (
                                <span className="absolute -top-1.5 -right-1.5 flex h-2 w-2 z-20">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_6px_#10b981]"></span>
                                </span>
                              )}
                              {item.navKey === "quote_approval_requests" && pendingQuoteApprovalCount > 0 && collapsed && (
                                <span className="absolute -top-1.5 -right-1.5 flex h-2 w-2 z-20">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500 shadow-[0_0_6px_#8b5cf6]"></span>
                                </span>
                              )}
{item.navKey === "quote_pending_requests" && pendingQuoteCount > 0 && collapsed && (
                                  <span className="absolute -top-1.5 -right-1.5 flex h-2 w-2 z-20">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500 shadow-[0_0_6px_#f59e0b]"></span>
                                  </span>
                                )}
                                {item.navKey === "urgent_review_requests" && pendingUrgentReviewCount > 0 && collapsed && (
                                  <span className="absolute -top-1.5 -right-1.5 flex h-2 w-2 z-20">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 shadow-[0_0_6px_#f43f5e]"></span>
                                  </span>
                                )}
                                {item.navKey === "ai_assistance" && missedFollowupCount > 0 && collapsed && (
                                  <span className="absolute -top-1.5 -right-1.5 flex h-2 w-2 z-20">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary shadow-[0_0_6px_hsl(var(--primary))]"></span>
                                  </span>
                                )}
                                {isNeedAttention && needAttentionCount > 0 && collapsed && (
                                <span className="absolute -top-1.5 -right-1.5 flex h-2 w-2 z-20">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 shadow-[0_0_6px_#f43f5e]"></span>
                                </span>
                              )}
                            </div>

                            {!collapsed && (
                              <>
                                <span className="relative z-10 ml-3 flex-1 min-w-0 text-[13px] font-medium tracking-[-0.01em] flex items-center gap-2">
                                  {item.navKey === "cancellation_requests" && pendingCancellationCount > 0 && (
                                    <span className="relative flex h-2 w-2 shrink-0">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 shadow-[0_0_8px_#ef4444]"></span>
                                    </span>
                                  )}
                                  {item.navKey === "payment_requests" && pendingPaymentCount > 0 && (
                                    <span className="relative flex h-2 w-2 shrink-0">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
                                    </span>
                                  )}
                                  {item.navKey === "quote_approval_requests" && pendingQuoteApprovalCount > 0 && (
                                    <span className="relative flex h-2 w-2 shrink-0">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500 shadow-[0_0_8px_#8b5cf6]"></span>
                                    </span>
                                  )}
{item.navKey === "quote_pending_requests" && pendingQuoteCount > 0 && (
                                      <span className="relative flex h-2 w-2 shrink-0">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500 shadow-[0_0_8px_#f59e0b]"></span>
                                      </span>
                                    )}
                                    {item.navKey === "urgent_review_requests" && pendingUrgentReviewCount > 0 && (
                                      <span className="relative flex h-2 w-2 shrink-0">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 shadow-[0_0_8px_#f43f5e]"></span>
                                      </span>
                                    )}
                                    {item.navKey === "ai_assistance" && missedFollowupCount > 0 && (
                                      <span className="relative flex h-2 w-2 shrink-0">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary shadow-[0_0_8px_hsl(var(--primary))]"></span>
                                      </span>
                                    )}
                                  {isNeedAttention && needAttentionCount > 0 && (
                                    <span className="relative flex h-2 w-2 shrink-0">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 shadow-[0_0_8px_#f43f5e]"></span>
                                    </span>
                                  )}
                                  <span className="truncate">{item.title}</span>
                                  {item.navKey === "cx_updates" && <span title={cxCount.isError ? "CX update count unavailable" : "Unresolved CX requests"} className="ml-auto shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">{cxCount.isError ? "!" : cxCount.data ?? 0}</span>}
                                  {item.navKey === "tech_updates" && <span title={techCount.isError ? "Tech update count unavailable" : "Unresolved Tech requests"} className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">{techCount.isError ? "!" : techCount.data ?? 0}</span>}
                                  {isNeedAttention && needAttentionCount > 0 && (
                                    <span className="ml-auto shrink-0 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold leading-none text-rose-600 dark:text-rose-300">
                                      {needAttentionCount}
                                    </span>
                                  )}
                                  {item.navKey === "ai_assistance" && missedFollowupCount > 0 && (
                                    <span className="ml-auto shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary">
                                      {missedFollowupCount}
                                    </span>
                                  )}
                                </span>

                                {!isNeedAttention && (
                                  <ChevronRight
                                    className={`relative z-10 h-3.5 w-3.5 transition-all duration-200 ${
                                      isActive
                                        ? "translate-x-0 text-sidebar-foreground/38"
                                        : "-translate-x-1 opacity-0 text-sidebar-foreground/25 group-hover/nav:translate-x-0 group-hover/nav:opacity-100"
                                    }`}
                                  />
                                )}
                              </>
                            )}

                            {isActive && !collapsed && !isNeedAttention && (
                              <motion.div
                                layoutId="nav-active-indicator-dot"
                                className="absolute right-3 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_14px_hsl(var(--primary)/0.9)]"
                                transition={{ type: "spring", stiffness: 350, damping: 30 }}
                              />
                            )}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </motion.div>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          ))}

          {canAccess("leads") && !collapsed && visibleStatuses.length > 0 && (
            <>
              <div className="my-3 px-2">
                <SidebarSeparator className="opacity-25" />
              </div>

              <SidebarGroup>
                <SidebarGroupLabel className="mb-2 rounded-[18px] border border-white/36 bg-[radial-gradient(circle_at_top_left,hsl(193_100%_86%/0.2),transparent_34%),linear-gradient(180deg,hsl(var(--sidebar-accent)/0.9),hsl(var(--sidebar-accent)/0.62))] px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.22em] text-sidebar-foreground/74 shadow-[0_16px_24px_-20px_rgba(59,130,246,0.16)]">
                  By Status
                </SidebarGroupLabel>

                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {visibleStatuses.map((status, index) => (
                      <motion.div
                        key={status}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2, delay: 0.1 + index * 0.015 }}
                      >
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            asChild
                            isActive={currentStatus === status}
                            tooltip={STATUS_LABELS[status]}
                          >
                            <NavLink
                              to={`/leads?status=${status}`}
                              className={`group/status relative flex items-center gap-2.5 rounded-[18px] border border-transparent px-3 py-2 transition-all duration-300 ${
                                currentStatus === status
                                  ? "border-white/34 bg-[radial-gradient(circle_at_left,hsl(194_100%_88%/0.14),transparent_28%),linear-gradient(180deg,hsl(var(--sidebar-accent)/0.96),hsl(var(--sidebar-accent)/0.76))] text-sidebar-accent-foreground shadow-[0_14px_24px_-20px_rgba(59,130,246,0.16)] ring-1 ring-white/10"
                                  : "hover:border-white/18 hover:bg-[linear-gradient(180deg,hsl(var(--sidebar-accent)/0.68),hsl(var(--sidebar-accent)/0.5))]"
                              }`}
                              activeClassName="text-sidebar-accent-foreground font-semibold"
                            >
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_COLORS[status]} transition-all duration-200 group-hover/status:scale-125`}
                              />
                              <span className="truncate text-[12px] font-medium tracking-[-0.005em]">
                                {STATUS_LABELS[status]}
                              </span>

                              {currentStatus === status && (
                                <motion.div
                                  layoutId="status-active-pill"
                                  className="absolute right-3 h-1.5 w-1.5 rounded-full bg-white/80"
                                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                                />
                              )}
                            </NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </motion.div>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          )}
        </ScrollArea>
      </SidebarContent>

      <SidebarFooter className="p-3 pt-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <Avatar
              className="h-9 w-9 shrink-0 ring-1 ring-white/10 shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => setChangePasswordOpen(true)}
              title="Change Password"
            >
              <AvatarFallback className="bg-gradient-to-br from-primary via-[hsl(258,88%,64%)] to-[hsl(278,82%,62%)] text-primary-foreground text-[10px] font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-xl text-sidebar-foreground/28 transition-all duration-200 hover:bg-red-500/10 hover:text-red-400"
              onClick={signOut}
              title="Sign Out"
              aria-label="Sign Out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
        <div className="rounded-[24px] border border-white/36 bg-[radial-gradient(circle_at_top_left,hsl(194_100%_88%/0.2),transparent_34%),radial-gradient(circle_at_bottom_right,hsl(210_100%_88%/0.14),transparent_32%),linear-gradient(180deg,hsl(var(--sidebar-accent)/0.9),hsl(var(--sidebar-accent)/0.58))] p-3 shadow-[0_18px_28px_-22px_rgba(59,130,246,0.16)]">
          <div className="flex items-center gap-3">
            <Avatar
              className="h-9 w-9 shrink-0 ring-1 ring-white/10 shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => setChangePasswordOpen(true)}
              title="Change Password"
            >
              <AvatarFallback className="bg-gradient-to-br from-primary via-[hsl(258,88%,64%)] to-[hsl(278,82%,62%)] text-primary-foreground text-[10px] font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>

              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold tracking-[-0.01em] text-sidebar-accent-foreground">
                  {profile?.full_name}
                </span>
                <span className="block truncate text-[10px] text-sidebar-foreground/38">{profile?.email}</span>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-xl text-sidebar-foreground/50 transition-all duration-200 hover:bg-white/10 hover:text-sidebar-accent-foreground"
                onClick={() => setChangePasswordOpen(true)}
                title="Change Password"
                aria-label="Change Password"
              >
                <KeyRound className="h-3.5 w-3.5" />
              </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-xl text-sidebar-foreground/28 transition-all duration-200 hover:bg-red-500/10 hover:text-red-400"
              onClick={signOut}
              title="Sign Out"
              aria-label="Sign Out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        )}
      </SidebarFooter>
            <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
        userEmail={user?.email || profile?.email || null}
      />
      
    </Sidebar>
  );
}








