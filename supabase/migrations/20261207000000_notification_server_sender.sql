-- =============================================================================
-- Notification redesign phase 2: the server sends every lead notification
-- =============================================================================
-- Defect (production, 2026-11-09): lead notifications were sent from the browser
-- (src/lib/lead-notifications.ts). The browser chose the recipients and wrote the
-- rows, through dispatch_lead_status_notification (recipients passed in by the
-- caller) or a direct insert, and the INSERT policy "Self or admin can create
-- notifications" let any Admin, Processor or CS user create a notification for any
-- user with any title and message. Alerts were also missed when a lead changed
-- outside those screens.
--
-- What this changes:
--   1. notifications.kind (alert type key), entity_id and resolved_at. A BEFORE
--      INSERT trigger fills kind from the title for every producer, so the CRM can
--      select alerts by type instead of matching title text. Rows from the last 3
--      days (all the CRM's pop-ups read) are labelled now; older rows keep NULL
--      and age out under the 30-day retention.
--   2. Database triggers send the alerts the browser sent, with the same titles,
--      messages and recipients:
--        leads status -> Urgent Job / Need Tech (Admin, Processor, CS Admin, the
--          lead's CS, shared users, assigned Operators; CS only for their own
--          lead), Job in Progress (Admin, Processor; again when the expected
--          completion date changes), Quote Updated (quote requester, CS Admin);
--        leads cs_tag -> Incomplete Details (lead creator, CS Admin);
--        lead_cancellation_requests insert -> approvers (Admin, plus Processor
--          unless a Processor asked);
--        lead_payment_requests insert -> Admin;
--        lead_shares insert -> the user it was shared with;
--        lead_operator_assignments insert -> the assigned Operator.
--      The person who made the change is never notified. One unread alert per
--      (user, lead, type): a repeat refreshes it instead of adding a copy.
--   3. dispatch_lead_status_notification keeps its signature and returns 0, so
--      CRM builds published before this change cannot send duplicates or choose
--      recipients.
--   4. Browsers can no longer insert notifications (INSERT policy removed) and can
--      only change the read flag of their own notifications (column grant).
--
-- Not changed: titles and messages (older CRM builds still match them), server
-- producers already in the database (workflow, urgent review, technician change,
-- Sheets health), read rules, existing rows except the 3-day kind backfill.
--
-- Apply manually after 20261206000000. Isolated harness:
-- supabase/tests/153_notification_server_sender.sql via
-- scripts/test-notifications-db.mjs. Rollback at the end.
-- =============================================================================
BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
COMMENT ON COLUMN public.notifications.kind IS 'Alert type key (urgent_job, need_tech, job_in_progress, quote_updated, incomplete_details, cancellation_request, paid_approval_request, lead_shared, lead_assigned, system_sheets, other). Set by the server.';
COMMENT ON COLUMN public.notifications.resolved_at IS 'When the fact the alert announced stopped being true (request decided, lead moved on).';
CREATE INDEX IF NOT EXISTS notifications_user_kind_unread_idx ON public.notifications (user_id, kind, created_at DESC) WHERE read = false;

CREATE OR REPLACE FUNCTION marshmallow_private.notification_kind(p_title text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_title ILIKE '%Urgent Job%' THEN 'urgent_job'
    WHEN p_title ILIKE '%Need Tech%' THEN 'need_tech'
    WHEN p_title ILIKE '%Job in Progress%' THEN 'job_in_progress'
    WHEN p_title ILIKE '%Quote Updated%' THEN 'quote_updated'
    WHEN p_title ILIKE '%Incomplete Details%' THEN 'incomplete_details'
    WHEN p_title ILIKE '%cancellation request%' THEN 'cancellation_request'
    WHEN p_title ILIKE 'Paid approval request%' THEN 'paid_approval_request'
    WHEN p_title ILIKE 'Lead Shared with You%' THEN 'lead_shared'
    WHEN p_title ILIKE 'Lead Assigned%' THEN 'lead_assigned'
    WHEN p_title ILIKE '%Google Sheets%' THEN 'system_sheets'
    ELSE 'other'
  END;
$$;

CREATE OR REPLACE FUNCTION marshmallow_private.notifications_set_kind() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.kind := coalesce(NEW.kind, marshmallow_private.notification_kind(NEW.title));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notifications_set_kind ON public.notifications;
CREATE TRIGGER notifications_set_kind BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.notifications_set_kind();

UPDATE public.notifications SET kind = marshmallow_private.notification_kind(title)
WHERE kind IS NULL AND created_at >= now() - interval '3 days';

-- One unread alert per (user, lead, kind); never to the actor; CS only for their own
-- urgent leads (the rule dispatch_lead_status_notification applied).
CREATE OR REPLACE FUNCTION marshmallow_private.notify_lead(
  p_recipients uuid[], p_lead uuid, p_kind text, p_title text, p_message text, p_actor uuid, p_entity uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v uuid[];
  inserted integer := 0;
BEGIN
  SELECT coalesce(array_agg(DISTINCT c), '{}'::uuid[]) INTO v
  FROM unnest(p_recipients) c
  WHERE c IS NOT NULL AND c IS DISTINCT FROM p_actor
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = c)
    AND (p_kind <> 'urgent_job'
      OR NOT public.has_role(c, 'customer_service'::public.app_role)
      OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = p_lead AND (
        l.assigned_cs = c OR (l.assigned_cs IS NULL AND l.created_by = c)
        OR EXISTS (SELECT 1 FROM public.lead_shares s WHERE s.lead_id = l.id AND s.shared_with_user_id = c))));
  IF cardinality(v) = 0 THEN
    RETURN 0;
  END IF;
  UPDATE public.notifications n SET message = p_message, created_at = now(), kind = p_kind, entity_id = coalesce(p_entity, n.entity_id)
  WHERE n.lead_id = p_lead AND n.read = false AND n.user_id = ANY (v)
    AND (n.kind = p_kind OR (n.kind IS NULL AND n.title = p_title));
  INSERT INTO public.notifications (user_id, title, message, lead_id, read, kind, entity_id)
  SELECT r, p_title, p_message, p_lead, false, p_kind, p_entity FROM unnest(v) r
  WHERE NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = r AND n.lead_id = p_lead AND n.read = false
    AND (n.kind = p_kind OR (n.kind IS NULL AND n.title = p_title)));
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.notify_lead(uuid[], uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.users_with_roles(p_roles text[]) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(array_agg(DISTINCT user_id), '{}'::uuid[]) FROM public.user_roles WHERE role::text = ANY (p_roles);
$$;
REVOKE ALL ON FUNCTION marshmallow_private.users_with_roles(text[]) FROM PUBLIC, anon, authenticated;

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
REVOKE ALL ON FUNCTION marshmallow_private.notify_lead_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS leads_notify_change ON public.leads;
CREATE TRIGGER leads_notify_change AFTER INSERT OR UPDATE OF status, expected_completion_date, cs_tag ON public.leads
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.notify_lead_change();

CREATE OR REPLACE FUNCTION marshmallow_private.notify_request_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  lead_name text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT customer_name INTO lead_name FROM public.leads WHERE id = NEW.lead_id;
  IF TG_TABLE_NAME = 'lead_cancellation_requests' THEN
    PERFORM marshmallow_private.notify_lead(
      marshmallow_private.users_with_roles(CASE WHEN NEW.requested_by_role = 'processor' THEN ARRAY['admin'] ELSE ARRAY['admin', 'processor'] END),
      NEW.lead_id, 'cancellation_request', 'Lead cancellation request', format('%s needs cancellation approval', lead_name),
      NEW.requested_by, NEW.id);
  ELSE
    PERFORM marshmallow_private.notify_lead(marshmallow_private.users_with_roles(ARRAY['admin']),
      NEW.lead_id, 'paid_approval_request', 'Paid approval request', format('%s needs Paid approval', lead_name),
      NEW.requested_by, NEW.id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.notify_request_created() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS lead_cancellation_requests_notify ON public.lead_cancellation_requests;
CREATE TRIGGER lead_cancellation_requests_notify AFTER INSERT ON public.lead_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.notify_request_created();
DROP TRIGGER IF EXISTS lead_payment_requests_notify ON public.lead_payment_requests;
CREATE TRIGGER lead_payment_requests_notify AFTER INSERT ON public.lead_payment_requests
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.notify_request_created();

CREATE OR REPLACE FUNCTION marshmallow_private.notify_lead_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l public.leads%rowtype;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = NEW.lead_id;
  IF NOT found THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'lead_shares' THEN
    PERFORM marshmallow_private.notify_lead(ARRAY[NEW.shared_with_user_id], NEW.lead_id, 'lead_shared', 'Lead Shared with You',
      format('"%s" has been shared with you by admin', l.customer_name), coalesce(NEW.shared_by, auth.uid()));
  ELSE
    PERFORM marshmallow_private.notify_lead(ARRAY[NEW.operator_user_id], NEW.lead_id, 'lead_assigned', 'Lead Assigned',
      format('Lead "%s" has been assigned to you by %s.', coalesce(nullif(l.customer_name, ''), l.job_id),
        coalesce(nullif(NEW.assigned_by_name, ''), 'Admin/Processor')),
      coalesce(NEW.assigned_by, auth.uid()));
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.notify_lead_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS lead_shares_notify ON public.lead_shares;
CREATE TRIGGER lead_shares_notify AFTER INSERT ON public.lead_shares
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.notify_lead_link();
DROP TRIGGER IF EXISTS lead_operator_assignments_notify ON public.lead_operator_assignments;
CREATE TRIGGER lead_operator_assignments_notify AFTER INSERT ON public.lead_operator_assignments
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.notify_lead_link();

-- Older CRM builds still call this after saving; the triggers above already sent the alert.
CREATE OR REPLACE FUNCTION public.dispatch_lead_status_notification(p_lead_id uuid, p_title text, p_message text, p_user_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN 0;
END $$;

DROP POLICY IF EXISTS "Self or admin can create notifications" ON public.notifications;
REVOKE INSERT ON public.notifications FROM authenticated, anon;
REVOKE UPDATE ON public.notifications FROM authenticated, anon;
GRANT UPDATE (read) ON public.notifications TO authenticated;

COMMIT;

-- =============================================================================
-- Rollback (manual, reviewed):
--   BEGIN;
--   DROP TRIGGER IF EXISTS leads_notify_change ON public.leads;
--   DROP TRIGGER IF EXISTS lead_cancellation_requests_notify ON public.lead_cancellation_requests;
--   DROP TRIGGER IF EXISTS lead_payment_requests_notify ON public.lead_payment_requests;
--   DROP TRIGGER IF EXISTS lead_shares_notify ON public.lead_shares;
--   DROP TRIGGER IF EXISTS lead_operator_assignments_notify ON public.lead_operator_assignments;
--   GRANT INSERT, UPDATE ON public.notifications TO authenticated;
--   CREATE POLICY "Self or admin can create notifications" ON public.notifications FOR INSERT TO authenticated
--     WITH CHECK ((user_id = (SELECT auth.uid())) OR has_role((SELECT auth.uid()), 'admin'::app_role_old)
--       OR has_role((SELECT auth.uid()), 'processor'::app_role_old) OR has_role((SELECT auth.uid()), 'customer_service'::app_role_old));
--   -- Re-create the previous dispatch_lead_status_notification body (saved in
--   -- docs/NOTIFICATIONS.md) and republish the previous CRM build.
--   COMMIT;
-- The kind/entity_id/resolved_at columns and the kind trigger can stay.
-- =============================================================================
