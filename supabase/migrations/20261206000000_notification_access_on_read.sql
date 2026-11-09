-- =============================================================================
-- Notifications: check lead access every time a notification is read
-- =============================================================================
-- Defect (production, read-only, 2026-11-09): notification recipients are chosen
-- by role when the alert is sent and never re-checked. Only the 133 workflow
-- notifications (workflow_notification_events) were re-checked on read; the
-- other ~17,400 were shown even when the recipient cannot open the lead. Counted
-- with the CRM's own job-visibility rule: Customer Service 1,970 such rows (mostly
-- "Urgent Job"), CS Admin 948 (mostly "Quote Updated"), Processor 101.
--
-- Fix: the notifications SELECT policy uses marshmallow_private.notification_visible
-- (id, lead_id). For a notification that names a lead, Processor, CS Admin and
-- Customer Service see it only while marshmallow_private.workflow_job_visible_to
-- (the rule the CRM uses for workflow alerts: CS own/assigned/shared leads, CS Admin
-- hidden statuses, per-user and role status visibility) allows that lead. Workflow
-- notifications keep their existing check. Unchanged on purpose:
--   - Admin: sees every lead, so every notification.
--   - Operator / OPR Admin and users with no single role: unchanged (the bell
--     already scopes Operators to assigned leads; Operator recipients are handled
--     with the recipient catalogue in phase 2 of the notification redesign).
--   - Notifications without a lead, or whose lead no longer exists.
-- Nothing is deleted or rewritten: a hidden notification reappears if access is
-- granted again. INSERT/UPDATE/DELETE policies are unchanged.
--
-- Cost: one indexed lead lookup plus the existing visibility function per row
-- read. The CRM now reads only the last 3 days (bell, pop-ups) or 30 days
-- (history), so rows checked per request are small (e.g. 30 unread for the
-- busiest Processor instead of 787).
--
-- Apply manually. Isolated harness: supabase/tests/152_notification_access.sql via
-- scripts/test-workflow-inbox-db.mjs. Read-only after install: 151 (new checks).
-- Rollback at the end.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION marshmallow_private.notification_visible(n_id uuid, n_lead uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r text;
  l public.leads%rowtype;
BEGIN
  -- Workflow notifications keep their own request/job check.
  IF EXISTS (SELECT 1 FROM public.workflow_notification_events WHERE notification_id = n_id) THEN
    RETURN marshmallow_private.workflow_notification_visible(n_id);
  END IF;
  IF n_lead IS NULL THEN
    RETURN true;
  END IF;
  r := marshmallow_private.workflow_role();
  IF r IS NULL OR r NOT IN ('processor', 'cs_admin', 'customer_service') THEN
    RETURN true; -- Admin (sees every lead) and Operator roles: unchanged.
  END IF;
  SELECT * INTO l FROM public.leads WHERE id = n_lead;
  IF NOT found THEN
    RETURN true;
  END IF;
  RETURN marshmallow_private.workflow_job_visible_to(auth.uid(), l);
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.notification_visible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.notification_visible(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
CREATE POLICY "Users can select own notifications" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND marshmallow_private.notification_visible(id, lead_id));

COMMIT;

-- =============================================================================
-- Rollback (manual, reviewed): restores the 20261020065810 policy.
--   BEGIN;
--   DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
--   CREATE POLICY "Users can select own notifications" ON public.notifications FOR SELECT TO authenticated
--     USING (user_id = (SELECT auth.uid()) AND marshmallow_private.workflow_notification_visible(id));
--   DROP FUNCTION IF EXISTS marshmallow_private.notification_visible(uuid, uuid);
--   COMMIT;
-- No data is changed by this migration or its rollback.
-- =============================================================================
