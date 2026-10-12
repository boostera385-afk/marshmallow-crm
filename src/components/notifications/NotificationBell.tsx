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
import { isOperatorRole } from '@/lib/access';
import { useHoldInbox } from '@/hooks/useOperatorWorkflow';
import { acknowledgeHoldAlert, acknowledgeHoldInbox, HOLD_REASON_LABELS, type HoldAlert } from '@/lib/operator-workflow';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import HoldJobCard from './HoldJobCard';

const NOTIFICATION_POLL_INTERVAL_MS = 15 * 1000;
const MAX_REMEMBERED_CANCELLATION_POPUPS = 200;
const NOTIFICATION_LIMIT = 20;

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
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Counted separately from the displayed page: the list is capped at NOTIFICATION_LIMIT rows
  // regardless of read state, so counting unread within it hid older unread notifications.
  const [regularUnreadCount, setUnreadCount] = useState(0);
  const holdInbox = useHoldInbox();
  const refetchHoldInbox = holdInbox.refetch;
  const holdAlerts = isOperatorRole(role) ? holdInbox.data?.alerts ?? [] : [];
  const unreadCount = regularUnreadCount + (isOperatorRole(role) ? holdInbox.data?.unread_count ?? 0 : 0);
  const [selectedHoldId, setSelectedHoldId] = useState<string | null>(null);
  const selectedHold = holdAlerts.find((alert) => alert.id === selectedHoldId);
  const [acknowledgingHold, setAcknowledgingHold] = useState(false);
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

  const fetchNotifications = useCallback(async () => {
    if (!user) return;

    const assignedLeadIdList = await operatorLeadScope();

    const listQuery = applyOperatorScope(
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
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
        .eq('read', false),
      assignedLeadIdList,
    );

    const [listResult, countResult] = await Promise.all([listQuery, countQuery]);

    if (listResult.data) setNotifications(listResult.data as Notification[]);
    if (typeof countResult.count === 'number') setUnreadCount(countResult.count);
  }, [operatorLeadScope, user]);

  useEffect(() => {
    shownCancellationPopups.current = user ? loadShownPopupIds('cancellation', user.id) : new Set<string>();
  }, [user]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (open) {
      void fetchNotifications();
      if (isOperatorRole(role)) void refetchHoldInbox();
    }
  }, [fetchNotifications, open, role, refetchHoldInbox]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchNotifications();
    }, NOTIFICATION_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchNotifications]);

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

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          void fetchNotifications();

          // Play sound and show prominent toast for operator assignment notifications
          if (isOperatorRole(role)) {
            const newRow = payload.new as { title?: string; message?: string; lead_id?: string } | undefined;
            if (newRow?.title?.includes('Lead Assigned') && await hasOperatorLeadAssignment(user.id, newRow.lead_id)) {
              playAssignmentSound();
              toast('🔔 New Lead Assigned!', {
                description: newRow.message || 'A new lead has been assigned to you.',
                duration: 8000,
                closeButton: true,
                position: 'top-center',
              });
            }
          }
        },
      )
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}`,
      }, () => { void fetchNotifications(); })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchNotifications, navigate, role, user]);

  const markAllRead = async () => {
    if (!user) return;

    // Scoped to what this user can actually see, so an operator cannot silently clear alerts
    // for leads that were filtered out of their bell. No `read` filter: rows where `read` is
    // NULL also count as unread here and would otherwise be impossible to clear.
    const assignedLeadIdList = await operatorLeadScope();

    const result = await applyOperatorScope(
      supabase.from('notifications').update({ read: true }).eq('user_id', user.id),
      assignedLeadIdList,
    );
    if (result.error) {
      toast.error('Could not mark notifications read');
      return;
    }
    if (isOperatorRole(role) && holdInbox.data) {
      try {
        await acknowledgeHoldInbox(holdInbox.data.alerts.filter((alert) => !alert.read));
        await holdInbox.refetch();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not acknowledge hold alerts');
      }
    }
    await fetchNotifications();
  };

  const acknowledgeSelectedHold = async (alert: HoldAlert) => {
    setAcknowledgingHold(true);
    try {
      if (!await acknowledgeHoldAlert(alert)) toast.info('This job changed again. Review the latest alert.');
      await holdInbox.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not acknowledge hold alert');
    } finally {
      setAcknowledgingHold(false);
    }
  };

  const handleClick = async (n: Notification) => {
    if (!n.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', n.id);
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    setOpen(false);
    if (n.lead_id) navigate(`/leads/${n.lead_id}`);
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
            <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1 text-primary" onClick={markAllRead}>
              <CheckCheck className="h-3 w-3" /> {(holdInbox.data?.unread_count ?? 0) > holdAlerts.filter((alert) => !alert.read).length ? 'Mark shown read' : 'Mark all read'}
            </Button>
          )}
        </div>
        {isOperatorRole(role) && holdInbox.isError && (
          <div role="alert" className="space-y-2 border-b px-4 py-3 text-xs text-destructive">
            <p>Job hold alerts unavailable. {holdInbox.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => { void refetchHoldInbox(); }}>Retry hold alerts</Button>
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
                <button key={alert.id} className="w-full bg-slate-100 px-4 py-3 text-left text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
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
      </PopoverContent>
    </Popover>
    <Dialog open={Boolean(selectedHold)} onOpenChange={(value) => { if (!value) setSelectedHoldId(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hold This Job</DialogTitle>
          <DialogDescription>Read-only job card from the saved transition. Acknowledgement does not change the job.</DialogDescription>
        </DialogHeader>
        {selectedHold && <HoldJobCard key={selectedHold.revision} alert={selectedHold} expanded saving={acknowledgingHold}
          onAcknowledge={(alert) => { void acknowledgeSelectedHold(alert); }} />}
      </DialogContent>
    </Dialog>
    </>
  );
}
