import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bell, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { playAssignmentSound } from '@/lib/notification-sound';
import { isOperatorRole, canAccessNotifications } from '@/lib/access';
import { useHoldInbox } from '@/hooks/useOperatorWorkflow';
import { HOLD_REASON_LABELS } from '@/lib/operator-workflow';
import { useHoldAlertActions } from '@/hooks/useHoldAlertActions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import HoldJobCard from './HoldJobCard';
import { subscribeToNotifications, realtimeBus } from '@/lib/realtime';
import { useSharedRefresh } from '@/hooks/useCrossTab';
import { cxNotificationHref } from '@/lib/cx-update-requests';
import { openInboxNotification } from '@/lib/workflow-inbox';
import { useQueryClient } from '@tanstack/react-query';
import { notificationUnreadKey } from '@/hooks/useNotificationInbox';
import { activeNotificationSince } from '@/lib/notification-window';
import { useRealtimeAwareInterval, useRealtimeReconnect } from '@/lib/realtime-health';

const NOTIFICATION_POLL_INTERVAL_MS = 15 * 1000;
const MAX_REMEMBERED_CANCELLATION_POPUPS = 200;
const NOTIFICATION_LIMIT = 20;
const EMPTY_NOTIFICATIONS: Notification[] = [];

const popupStorageKey = (kind: string, userId: string) => `shown-${kind}-popups:${userId}`;

const loadShownPopupIds = (kind: string, userId: string) => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(popupStorageKey(kind, userId)) || '[]');
    return new Set<string>(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set<string>();
  }
};

const saveShownPopupIds = (kind: string, userId: string, ids: Set<string>) => {
  const recentIds = Array.from(ids).slice(-MAX_REMEMBERED_CANCELLATION_POPUPS);
  try {
    window.localStorage.setItem(popupStorageKey(kind, userId), JSON.stringify(recentIds));
  } catch {
    // A full or unavailable localStorage must not break the bell.
  }
};

const isCancellationRequestNotification = (notification: Notification) =>
  notification.title.toLowerCase().includes('cancellation request');

interface BellRead {
  rows: Notification[] | null;
  count: number | null;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  lead_id: string | null;
  read: boolean;
  created_at: string;
}

const getAssignedLeadIdsForOperator = async (userId: string) => {
  const { data, error } = await supabase
    .from('lead_operator_assignments')
    .select('lead_id')
    .eq('operator_user_id', userId);

  if (error || !data) return new Set<string>();
  return new Set(data.map((row: { lead_id: string }) => row.lead_id).filter(Boolean));
};

const hasOperatorLeadAssignment = async (userId: string, leadId: string | null | undefined) => {
  if (!leadId) return false;

  const { data, error } = await supabase
    .from('lead_operator_assignments')
    .select('lead_id')
    .eq('operator_user_id', userId)
    .eq('lead_id', leadId)
    .maybeSingle();

  return !error && Boolean(data);
};

export default function NotificationBell() {
  const { user, role } = useAuth();
  const scope = `${user?.id}:${role}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notificationState, setNotificationState] = useState<{ scope: string; rows: Notification[] }>({ scope, rows: [] });
  const notifications = notificationState.scope === scope ? notificationState.rows : EMPTY_NOTIFICATIONS;
  // Counted separately from the displayed page: the list is capped at NOTIFICATION_LIMIT rows
  // regardless of read state, so counting unread within it hid older unread notifications.
  const [regularUnreadCount, setUnreadCount] = useState(0);
  const [countScope, setCountScope] = useState(scope);
  const holdInbox = useHoldInbox();
  const refetchHoldInbox = holdInbox.refetch;
  const holdAlerts = isOperatorRole(role) ? holdInbox.data?.alerts ?? [] : [];
  const unreadCount = (countScope === scope ? regularUnreadCount : 0) + (isOperatorRole(role) ? holdInbox.data?.unread_count ?? 0 : 0);
  const [selectedHoldId, setSelectedHoldId] = useState<string | null>(null);
  const selectedHold = holdAlerts.find((alert) => alert.id === selectedHoldId);
  const holdActions = useHoldAlertActions();
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const markAllLock = useRef(false);
  const [open, setOpen] = useState(false);
  const shownCancellationPopups = useRef(new Set<string>());

  // Existing regular OPR notifications remain assignment-scoped. Holds are a
  // separate recipient-authorized inbox and deliberately reach all Operators.
  const operatorLeadScope = useCallback(async () => {
    if (role !== 'opr' || !user) return null;
    const assignedLeadIds = await getAssignedLeadIdsForOperator(user.id);
    return Array.from(assignedLeadIds);
  }, [role, user]);

  const applyOperatorScope = <T extends { or: (f: string) => T; is: (c: string, v: null) => T }>(
    query: T,
    assignedLeadIdList: string[] | null,
  ): T => {
    if (assignedLeadIdList === null) return query;
    return assignedLeadIdList.length > 0
      ? query.or(`lead_id.is.null,lead_id.in.(${assignedLeadIdList.join(',')})`)
      : query.is('lead_id', null);
  };

  // One tab per browser reads (and polls); other tabs receive the same page and count.
  const readNotifications = useCallback(async (): Promise<BellRead> => {
    if (!user) return { rows: [], count: null };
    // Bell and badge show the last 3 days (never before the account existed).
    const since = activeNotificationSince(user.created_at);
    const assignedLeadIdList = await operatorLeadScope();

    const listQuery = applyOperatorScope(
      supabase
        .from('notifications')
        .select('id, title, message, lead_id, read, created_at')
        .eq('user_id', user.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(NOTIFICATION_LIMIT),
      assignedLeadIdList,
    );

    // Counted across every unread row, not just the page being displayed.
    const countQuery = applyOperatorScope(
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false)
        .gte('created_at', since),
      assignedLeadIdList,
    );

    const [listResult, countResult] = await Promise.all([listQuery, countQuery]);
    return {
      rows: listResult.data ? (listResult.data as Notification[]) : null,
      count: typeof countResult.count === 'number' ? countResult.count : null,
    };
  }, [operatorLeadScope, user]);

  const applyNotifications = useCallback(({ rows, count }: BellRead) => {
    if (rows) setNotificationState({ scope, rows });
    if (typeof count === 'number' && user) {
      setUnreadCount(count); setCountScope(scope);
      queryClient.setQueryData(notificationUnreadKey(user.id, role), count);
    }
  }, [user, scope, role, queryClient]);
  const { refresh: fetchNotifications, isOwner: pollsHere } = useSharedRefresh(
    user ? `notifications:bell:${scope}` : null,
    readNotifications,
    applyNotifications,
  );

  useEffect(() => {
    shownCancellationPopups.current = user ? loadShownPopupIds('cancellation', user.id) : new Set<string>();
  }, [user]);

  useEffect(() => {
    void fetchNotifications();
    const refresh = () => { void fetchNotifications(); };
    realtimeBus.addEventListener('workflow-inbox-read', refresh);
    return () => realtimeBus.removeEventListener('workflow-inbox-read', refresh);
  }, [fetchNotifications]);

  useEffect(() => {
    if (open) {
      void fetchNotifications();
      if (isOperatorRole(role)) void refetchHoldInbox();
    }
  }, [fetchNotifications, open, role, refetchHoldInbox]);

  // Realtime delivers notifications; this poll is a safety net (rare while realtime
  // is healthy, every NOTIFICATION_POLL_INTERVAL_MS when not) plus one catch-up
  // read when realtime recovers.
  const pollMs = useRealtimeAwareInterval(NOTIFICATION_POLL_INTERVAL_MS);
  useRealtimeReconnect(() => { void fetchNotifications(); }, pollsHere);
  useEffect(() => {
    if (!pollsHere) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchNotifications();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [fetchNotifications, pollsHere, pollMs]);

  useEffect(() => {
    // Processors approve cancellations alongside admins (getCancellationApproverRoles), so they
    // get the same toast rather than a silent bell row.
    if ((role !== 'admin' && role !== 'processor') || !user) return;

    let displayedNewPopup = false;

    notifications
      .filter(
        (notification) =>
          !notification.read &&
          isCancellationRequestNotification(notification) &&
          !shownCancellationPopups.current.has(notification.id),
      )
      .forEach((notification) => {
        shownCancellationPopups.current.add(notification.id);
        displayedNewPopup = true;
        toast('New lead cancellation request', {
          id: `cancellation-request-${notification.id}`,
          description: notification.message,
          duration: 5000,
          closeButton: true,
          dismissible: true,
          position: 'bottom-right',
        });
      });

    if (displayedNewPopup) {
      saveShownPopupIds('cancellation', user.id, shownCancellationPopups.current);
    }
  }, [notifications, role, user]);

  useEffect(() => {
    if (!user) return;

    let active = true;
    const unsubscribe = subscribeToNotifications(user.id, async (payload) => {
      void fetchNotifications();

      // Play sound and show prominent toast for operator assignment notifications
      if (payload.eventType === 'INSERT' && isOperatorRole(role)) {
        const newRow = payload.new as { title?: string; message?: string; lead_id?: string } | undefined;
        if (newRow?.title?.includes('Lead Assigned') && await hasOperatorLeadAssignment(user.id, newRow.lead_id) && active) {
          playAssignmentSound();
          toast('🔔 New Lead Assigned!', {
            description: newRow.message || 'A new lead has been assigned to you.',
            duration: 8000,
            closeButton: true,
            position: 'top-center',
          });
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [fetchNotifications, navigate, role, user]);

  const markAllRead = async () => {
    if (!user || markAllLock.current || holdActions.isPending) return;
    markAllLock.current = true;
    setMarkingAllRead(true);
    try {
      // Acquire the shared hold-mutation gate immediately, so a popup click
      // cannot race ahead while ordinary-notification scope is being read.
      if (isOperatorRole(role) && holdInbox.data) await holdActions.acknowledgeAll(holdInbox.data);
      if (currentScope.current !== scope) return;
      // Ordinary notifications retain their existing recipient/assignment scope.
      const assignedLeadIdList = await operatorLeadScope();
      if (currentScope.current !== scope) return;
      const result = await applyOperatorScope(
        supabase.from('notifications').update({ read: true }).eq('user_id', user.id),
        assignedLeadIdList,
      );
      if (result.error) {
        toast.error('Could not mark notifications read');
        return;
      }
      if (currentScope.current !== scope) return;
      if (currentScope.current === scope) await fetchNotifications();
    } catch {
      if (currentScope.current === scope) toast.error('Could not mark notifications read');
    } finally {
      markAllLock.current = false;
      setMarkingAllRead(false);
    }
  };

  const handleClick = async (n: Notification) => {
    try {
      if (canAccessNotifications(role)) {
        const href = await openInboxNotification(n);
        if (currentScope.current !== scope) return;
        setOpen(false);
        if (href) navigate(href);
        realtimeBus.dispatchEvent(new Event('workflow-inbox-read'));
      } else {
        if (!n.read) {
          const result = await supabase.from('notifications').update({ read: true }).eq('id', n.id);
          if (currentScope.current !== scope) return;
          if (result.error) throw new Error('Could not mark notification read');
          setUnreadCount((prev) => Math.max(0, prev - 1));
        }
        setOpen(false);
        const cxHref = cxNotificationHref(n.title);
        if (cxHref) navigate(cxHref);
        else if (n.lead_id) navigate(`/leads/${n.lead_id}`);
      }
    } catch (error) {
      if (currentScope.current === scope) toast.error(error instanceof Error ? error.message : 'Could not open notification');
    }
    void fetchNotifications();
  };

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-lg" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground shadow-[0_0_10px_hsl(var(--destructive)/0.3)]">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 shadow-premium-xl border-border/40" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <h4 className="text-sm font-semibold">Notifications</h4>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1 text-primary" onClick={markAllRead} disabled={markingAllRead || holdActions.isPending}>
              <CheckCheck className="h-3 w-3" /> {markingAllRead ? 'Marking read…' : 'Mark all read'}
            </Button>
          )}
        </div>
        {isOperatorRole(role) && holdInbox.isError && (
          <div role="alert" className="space-y-2 border-b px-4 py-3 text-xs text-destructive">
            <p>Job hold alerts unavailable. {holdInbox.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => { void refetchHoldInbox(); }}>Retry hold alerts</Button>
          </div>
        )}
        {isOperatorRole(role) && (holdInbox.data?.unread_count ?? 0) > 0 && (
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
            <span className="text-xs font-medium">Hold This Job</span>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" disabled={markingAllRead || holdActions.isPending || holdInbox.isError}
              onClick={() => { void holdActions.acknowledgeAll(holdInbox.data); }}>
              <CheckCheck className="h-3 w-3" /> Acknowledge All
            </Button>
          </div>
        )}
        <div className="max-h-80 overflow-y-auto overscroll-contain">
          {notifications.length === 0 && holdAlerts.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2">
              <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center">
                <Bell className="h-5 w-5 text-muted-foreground/30" />
              </div>
              <p className="text-sm text-muted-foreground">No notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-border/20">
              {holdAlerts.map((alert) => (
                <button key={alert.id} className="w-full bg-primary/[0.04] px-4 py-3 text-left text-foreground transition-colors hover:bg-primary/[0.08]"
                  onClick={() => { setOpen(false); setSelectedHoldId(alert.id); }}>
                  <p className={`text-[13px] ${!alert.read ? 'font-semibold' : 'font-medium'}`}>{!alert.read && '● '}Hold This Job</p>
                  <p className="break-words text-xs">{alert.snapshot.job_id} · {HOLD_REASON_LABELS[alert.reason]}</p>
                  <p className="mt-1 text-[10px]">{formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}{alert.read ? ' · Acknowledged' : ''}</p>
                </button>
              ))}
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors ${!n.read ? 'bg-primary/[0.03]' : ''}`}
                >
                  <div className="flex items-start gap-2.5">
                    {!n.read && <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13px] ${!n.read ? 'font-semibold' : 'font-medium'} text-foreground`}>{n.title}</p>
                      <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-muted-foreground/40 mt-1">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {canAccessNotifications(role) && <div className="border-t p-2"><Button variant="ghost" className="w-full" onClick={() => { setOpen(false); navigate('/notifications'); }}>View all notifications</Button></div>}
      </PopoverContent>
    </Popover>
    <Dialog open={Boolean(selectedHold)} onOpenChange={(value) => { if (!value) setSelectedHoldId(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hold This Job</DialogTitle>
          <DialogDescription>Read-only job card from the saved transition. Acknowledgement does not change the job.</DialogDescription>
        </DialogHeader>
        {selectedHold && <HoldJobCard key={selectedHold.revision} alert={selectedHold} role={role} expanded saving={holdActions.isPending || markingAllRead}
          onAcknowledge={holdActions.acknowledgeOne} />}
      </DialogContent>
    </Dialog>
    </>
  );
}
