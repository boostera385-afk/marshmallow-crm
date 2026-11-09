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
-- Fix: the notifications SELECT policy also requires that the recipient can load
-- the notification's lead under the lead table's own row-level security, exactly
-- the check the CRM makes when it opens the lead (EXISTS on public.leads, run as
-- the caller). Workflow notifications keep their existing request/job check.
-- Notifications without a lead are unchanged. Nothing is deleted or rewritten: a
-- hidden notification reappears when access is granted again.
--
-- First attempt (2026-11-09, applied and rolled back within ~3 minutes): used
-- workflow_job_visible_to, which is stricter than lead RLS (it ignores broader
-- lead grants), so it hid alerts for leads a user can open. Lead RLS is the rule
-- the CRM itself uses, so this version cannot hide anything the user can open.
-- Per-user status visibility (a screen setting, not RLS) is not applied here.
--
-- Measured read-only on production for all 14 users with notifications (the
-- policy unchanged, the new check evaluated as each user): Admin, Processor and
-- Operator unchanged; CS Admin 3,146 -> 2,234 readable (no unread lost); CS users
-- lose only alerts for leads they cannot load (e.g. a user moved from Processor to
-- CS today: 936 -> 3). Cost per request: bell query <= 14 ms, 30-day history
-- <= 144 ms.
--
-- Apply manually. Isolated harness: supabase/tests/152_notification_access.sql via
-- scripts/test-workflow-inbox-db.mjs. Read-only after install: 151 (new checks).
-- Rollback at the end.
-- =============================================================================
BEGIN;

DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
CREATE POLICY "Users can select own notifications" ON public.notifications FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND marshmallow_private.workflow_notification_visible(id)
    AND (lead_id IS NULL OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = notifications.lead_id))
  );

COMMIT;

-- =============================================================================
-- Rollback (manual, reviewed): restores the 20261020065810 policy.
--   BEGIN;
--   DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
--   CREATE POLICY "Users can select own notifications" ON public.notifications FOR SELECT TO authenticated
--     USING (user_id = (SELECT auth.uid()) AND marshmallow_private.workflow_notification_visible(id));
--   COMMIT;
-- No data is changed by this migration or its rollback.
-- =============================================================================
