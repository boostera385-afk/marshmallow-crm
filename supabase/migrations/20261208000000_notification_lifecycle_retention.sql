-- =============================================================================
-- Notification redesign phase 3: alerts close themselves; 30-day retention
-- =============================================================================
-- Defect (production, read-only, 2026-11-09): an alert stayed unread until clicked
-- even after the thing it announced was over. 1,630 cancellation-request alerts
-- and 17 paid-approval alerts were unread although only 14 and 1 requests were
-- pending. The Google Sheets warning was sent 623 times instead of once. Nothing
-- was ever removed: 13,241 of 17,503 rows were older than 30 days.
--
-- Business decisions (2026-11-09): alerts show for 3 days at most (CRM, phase 1),
-- history is kept for 30 days.
--
-- What this changes:
--   1. Alerts resolve (read = true, resolved_at = now()) for everyone when:
--        - a lead leaves Urgent Job / Need Tech / Job in Progress / Quote Updated
--          (that status's alerts for the lead);
--        - a lead's Incomplete Details tag is removed;
--        - a cancellation or paid-approval request is decided and no other
--          request of that kind is pending for the lead.
--      The trigger from 20261207000000 is extended; sending is unchanged.
--   2. raise_sheets_sync_stale_alert keeps one open alert per Admin: a repeat
--      refreshes it, and it resolves when the backup is healthy again.
--   3. marshmallow_private.purge_old_notifications(days) deletes notifications
--      older than the given days (their workflow events go with them by the
--      existing ON DELETE CASCADE) and is scheduled daily at 03:17 UTC with 30.
--   4. Unread alerts whose fact is already over are resolved once.
--
-- Data: (3) and (4) change and delete notification rows. Before applying, back up
-- the rows older than 30 days (see docs/NOTIFICATIONS.md, "Retention backup").
-- No other table's rows are changed.
--
-- Apply manually after 20261207000000. Isolated harness:
-- supabase/tests/154_notification_lifecycle.sql via scripts/test-notifications-db.mjs.
-- Rollback at the end.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION marshmallow_private.resolve_lead_alerts(p_lead uuid, p_kinds text[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.notifications SET read = true, resolved_at = now()
  WHERE lead_id = p_lead AND read = false
    AND (kind = ANY (p_kinds) OR (kind IS NULL AND marshmallow_private.notification_kind(title) = ANY (p_kinds)));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.resolve_lead_alerts(uuid, text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.notify_lead_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  is_new boolean := TG_OP = 'INSERT';
  status_changed boolean;
  label text;
  recipients uuid[];
BEGIN
  status_changed := is_new OR NEW.status IS DISTINCT FROM OLD.status;

  -- The lead left a status: that status's alerts are over for everyone.
  IF NOT is_new AND status_changed AND OLD.status IN ('urgent_job', 'need_tech', 'job_in_progress', 'quote_updated') THEN
    PERFORM marshmallow_private.resolve_lead_alerts(NEW.id, ARRAY[OLD.status]);
  END IF;
  IF NOT is_new AND OLD.cs_tag = 'incomplete_details' AND NEW.cs_tag IS DISTINCT FROM 'incomplete_details' THEN
    PERFORM marshmallow_private.resolve_lead_alerts(NEW.id, ARRAY['incomplete_details']);
  END IF;

  IF NEW.status IN ('urgent_job', 'need_tech') AND status_changed THEN
    label := CASE NEW.status WHEN 'urgent_job' THEN 'Urgent Job' ELSE 'Need Tech' END;
    recipients := marshmallow_private.users_with_roles(ARRAY['admin', 'processor', 'cs_admin'])
      || ARRAY[coalesce(NEW.assigned_cs, NEW.created_by)]
      || ARRAY(SELECT shared_with_user_id FROM public.lead_shares WHERE lead_id = NEW.id)
      || ARRAY(SELECT operator_user_id FROM public.lead_operator_assignments WHERE lead_id = NEW.id);
    PERFORM marshmallow_private.notify_lead(recipients, NEW.id, NEW.status, '[Alert] ' || label,
      CASE WHEN is_new THEN format('New lead "%s" requires attention - marked as %s', NEW.customer_name, label)
           ELSE format('Lead "%s" changed to %s', NEW.customer_name, label) END, actor);
  ELSIF NEW.status = 'job_in_progress' AND (status_changed
      OR (NEW.expected_completion_date IS DISTINCT FROM OLD.expected_completion_date AND NEW.expected_completion_date IS NOT NULL)) THEN
    PERFORM marshmallow_private.notify_lead(marshmallow_private.users_with_roles(ARRAY['admin', 'processor']), NEW.id,
      'job_in_progress', '[Reminder] Job in Progress',
      CASE WHEN NEW.expected_completion_date IS NOT NULL
        THEN format('Lead "%s" is In Progress. Expected completion: %s', NEW.customer_name, NEW.expected_completion_date)
        ELSE format('Lead "%s" changed to Job in Progress', NEW.customer_name) END, actor);
  ELSIF NEW.status = 'quote_updated' AND status_changed THEN
    PERFORM marshmallow_private.notify_lead(
      marshmallow_private.users_with_roles(ARRAY['cs_admin']) || ARRAY[NEW.quote_requested_by], NEW.id,
      'quote_updated', '[Alert] Quote Updated', format('Quote for lead "%s" has been updated', NEW.customer_name), actor);
  END IF;

  IF NOT is_new AND NEW.cs_tag = 'incomplete_details' AND OLD.cs_tag IS DISTINCT FROM 'incomplete_details' THEN
    PERFORM marshmallow_private.notify_lead(
      marshmallow_private.users_with_roles(ARRAY['cs_admin']) || ARRAY[NEW.created_by], NEW.id,
      'incomplete_details', '[Alert] Incomplete Details',
      format('Lead "%s" is missing details - please complete the lead information', NEW.customer_name), actor);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION marshmallow_private.resolve_decided_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status <> 'pending' OR NEW.status = 'pending' THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'lead_cancellation_requests' THEN
    IF NOT EXISTS (SELECT 1 FROM public.lead_cancellation_requests WHERE lead_id = NEW.lead_id AND status = 'pending') THEN
      PERFORM marshmallow_private.resolve_lead_alerts(NEW.lead_id, ARRAY['cancellation_request']);
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.lead_payment_requests WHERE lead_id = NEW.lead_id AND status = 'pending') THEN
    PERFORM marshmallow_private.resolve_lead_alerts(NEW.lead_id, ARRAY['paid_approval_request']);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.resolve_decided_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS lead_cancellation_requests_resolve ON public.lead_cancellation_requests;
CREATE TRIGGER lead_cancellation_requests_resolve AFTER UPDATE OF status ON public.lead_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.resolve_decided_request();
DROP TRIGGER IF EXISTS lead_payment_requests_resolve ON public.lead_payment_requests;
CREATE TRIGGER lead_payment_requests_resolve AFTER UPDATE OF status ON public.lead_payment_requests
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.resolve_decided_request();

-- Same checks and message as before; one open alert per Admin instead of a new row
-- every 15 minutes, resolved once the backup is healthy.
CREATE OR REPLACE FUNCTION public.raise_sheets_sync_stale_alert(p_stale_after_seconds integer DEFAULT 900, p_throttle_minutes integer DEFAULT 15)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_health record;
  v_sent integer := 0;
  v_message text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_health FROM public.get_sheets_sync_health(p_stale_after_seconds);
  IF v_health.status NOT IN ('degraded', 'down') THEN
    UPDATE public.notifications SET read = true, resolved_at = now()
     WHERE title = '[Alert] Google Sheets backup is behind' AND read = false;
    RETURN 0;
  END IF;

  v_message := format(
    'Status %s. %s failed attempt(s) in a row; %s failed job(s) and %s total job(s) are queued. Last error: %s.',
    v_health.status, v_health.consecutive_failures, v_health.failed_jobs, v_health.queue_depth,
    coalesce(left(v_health.last_error_message, 200), 'none recorded'));

  -- Refresh the open alert (no throttle-window copies).
  UPDATE public.notifications SET message = v_message
   WHERE title = '[Alert] Google Sheets backup is behind' AND read = false AND message IS DISTINCT FROM v_message
     AND user_id IN (SELECT user_id FROM public.user_roles WHERE role = 'admin');

  INSERT INTO public.notifications (user_id, title, message, kind)
  SELECT ur.user_id, '[Alert] Google Sheets backup is behind', v_message, 'system_sheets'
    FROM public.user_roles ur
   WHERE ur.role = 'admin'
     AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = ur.user_id
       AND n.title = '[Alert] Google Sheets backup is behind'
       AND (n.read = false OR n.created_at > now() - make_interval(mins => greatest(coalesce(p_throttle_minutes, 15), 1))));
  GET DIAGNOSTICS v_sent = ROW_COUNT;
  RETURN v_sent;
END $$;

CREATE OR REPLACE FUNCTION marshmallow_private.purge_old_notifications(p_days integer DEFAULT 30) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n integer;
BEGIN
  IF p_days IS NULL OR p_days < 30 THEN
    RAISE EXCEPTION 'Notification retention must be at least 30 days' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.notifications WHERE created_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.purge_old_notifications(integer) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notifications-retention';
    PERFORM cron.schedule('notifications-retention', '17 3 * * *', 'SELECT marshmallow_private.purge_old_notifications(30)');
  END IF;
END $$;

-- One-time: alerts whose fact is already over (last 30 days; older rows are
-- removed by the retention job).
UPDATE public.notifications n SET read = true, resolved_at = now()
WHERE n.read = false AND n.lead_id IS NOT NULL AND n.created_at >= now() - interval '30 days' AND (
  (marshmallow_private.notification_kind(n.title) = 'cancellation_request'
    AND NOT EXISTS (SELECT 1 FROM public.lead_cancellation_requests c WHERE c.lead_id = n.lead_id AND c.status = 'pending'))
  OR (marshmallow_private.notification_kind(n.title) = 'paid_approval_request'
    AND NOT EXISTS (SELECT 1 FROM public.lead_payment_requests p WHERE p.lead_id = n.lead_id AND p.status = 'pending'))
  OR (marshmallow_private.notification_kind(n.title) IN ('urgent_job', 'need_tech', 'job_in_progress', 'quote_updated')
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = n.lead_id AND l.status <> marshmallow_private.notification_kind(n.title)))
  OR (marshmallow_private.notification_kind(n.title) = 'incomplete_details'
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = n.lead_id AND l.cs_tag IS DISTINCT FROM 'incomplete_details')));
UPDATE public.notifications SET read = true, resolved_at = now()
WHERE title = '[Alert] Google Sheets backup is behind' AND read = false AND created_at >= now() - interval '30 days'
  AND id NOT IN (SELECT DISTINCT ON (user_id) id FROM public.notifications
                 WHERE title = '[Alert] Google Sheets backup is behind' AND read = false ORDER BY user_id, created_at DESC);

COMMIT;

-- =============================================================================
-- Rollback (manual, reviewed):
--   BEGIN;
--   SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notifications-retention';
--   DROP TRIGGER IF EXISTS lead_cancellation_requests_resolve ON public.lead_cancellation_requests;
--   DROP TRIGGER IF EXISTS lead_payment_requests_resolve ON public.lead_payment_requests;
--   -- Re-run notify_lead_change from 20261207000000 and the previous
--   -- raise_sheets_sync_stale_alert body (saved in docs/NOTIFICATIONS.md).
--   COMMIT;
-- Resolved rows can be found by resolved_at; deleted rows only from the backup
-- table made before applying (marshmallow_private.notifications_backup_20261109).
-- =============================================================================
