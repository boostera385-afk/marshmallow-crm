-- Purpose: tell every OPR / OPR Admin to stop working an urgent job when CX
-- moves it to "Waiting for CX for schedule confirmation", matching the existing
-- Ready to Schedule, Scheduled and Cancelled hold behavior.
--
-- This changes only the server-owned hold-alert projection and trigger. It does
-- not update leads, schedules, assignments or customer data.

BEGIN;

ALTER TABLE public.lead_hold_alerts
  DROP CONSTRAINT IF EXISTS lead_hold_alerts_reason_check;

ALTER TABLE public.lead_hold_alerts
  ADD CONSTRAINT lead_hold_alerts_reason_check CHECK (reason IN (
    'ready_to_schedule',
    'waiting_schedule_confirmation',
    'scheduled',
    'cancelled'
  ));

CREATE OR REPLACE FUNCTION marshmallow_private.capture_operator_hold_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reason text;
  v_snapshot jsonb;
BEGIN
  -- This trigger is not an exposed RPC and cannot be called by a browser.
  IF OLD.status = 'urgent_job' AND NEW.status = 'cancellation_requested' THEN
    INSERT INTO marshmallow_private.urgent_cancellation_origins(lead_id) VALUES(NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;

  IF OLD.status = 'urgent_job' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('scheduled','cancelled') THEN
    v_reason := NEW.status;
  ELSIF OLD.status = 'cancellation_requested' AND NEW.status = 'cancelled'
     AND EXISTS (
       SELECT 1 FROM marshmallow_private.urgent_cancellation_origins WHERE lead_id = NEW.id
     ) THEN
    v_reason := 'cancelled';
  ELSIF OLD.status = 'urgent_job' AND NEW.status = 'urgent_job'
     AND NEW.cs_tag IN ('ready_to_schedule','waiting_schedule_confirmation')
     AND NEW.cs_tag IS DISTINCT FROM OLD.cs_tag THEN
    v_reason := NEW.cs_tag;
  END IF;

  IF OLD.status = 'cancellation_requested' AND NEW.status <> 'cancellation_requested' THEN
    DELETE FROM marshmallow_private.urgent_cancellation_origins WHERE lead_id = NEW.id;
  END IF;
  IF v_reason IS NULL THEN RETURN NEW; END IF;

  -- An old "work this urgent job" alert is obsolete once the hold instruction
  -- arrives. Only clear operator recipients' urgent alerts, not other roles.
  UPDATE public.notifications n SET read = true
  WHERE n.lead_id = NEW.id AND n.title = '[Alert] Urgent Job' AND n.read = false
    AND EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = n.user_id
        AND r.role IN ('opr'::public.app_role, 'opr_admin'::public.app_role)
    );

  v_snapshot := jsonb_build_object(
    'job_id', NEW.job_id, 'customer_name', NEW.customer_name,
    'customer_phone', NEW.customer_phone, 'customer_landline', NEW.customer_landline,
    'service_type', NEW.service_type, 'service_details', NEW.service_details,
    'address', NEW.address, 'city', NEW.city, 'state', NEW.state, 'zip_code', NEW.zip_code,
    'customer_schedule_requirements', NEW.customer_schedule_requirements,
    'scheduled_date', NEW.scheduled_date, 'scheduled_time_start', NEW.scheduled_time_start,
    'scheduled_time_end', NEW.scheduled_time_end, 'tech_name', NEW.tech_name,
    'tech_number', NEW.tech_number, 'status', NEW.status, 'cs_tag', NEW.cs_tag,
    'quote', CASE WHEN NEW.show_quote_to_opr IS FALSE THEN NULL ELSE NEW.quote END
  );

  -- One unread card per user/job is refreshed atomically with a new revision.
  INSERT INTO public.lead_hold_alerts(user_id, lead_id, reason, snapshot)
  SELECT DISTINCT user_id, NEW.id, v_reason, v_snapshot
  FROM public.user_roles
  WHERE role IN ('opr'::public.app_role, 'opr_admin'::public.app_role)
  ON CONFLICT(user_id, lead_id) WHERE read = false DO UPDATE
  SET reason = EXCLUDED.reason,
      snapshot = EXCLUDED.snapshot,
      revision = gen_random_uuid(),
      created_at = clock_timestamp();

  RETURN NEW;
END;
$$;

COMMIT;

-- Rollback:
-- 1. Redeploy the previous capture_operator_hold_alert() body from
--    20261012041715_lead_copy_permissions_and_operator_hold_alerts.sql.
-- 2. Remap any derived waiting_schedule_confirmation alert reasons to
--    ready_to_schedule after review, then restore the former three-value CHECK.
-- Do not update leads or customer schedules as part of rollback.
