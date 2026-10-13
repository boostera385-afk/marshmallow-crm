-- Defects: Copy Complete Details has no admin-managed role/user permission;
-- operators lose urgent jobs without a durable "Hold This Job" card, and the
-- notifications table is not consistently present in the realtime publication.
-- Apply MANUALLY to the existing Marshmallow schema. No historical leads are
-- rewritten and no historical alerts are backfilled. Run the accompanying harness.
BEGIN;

CREATE SCHEMA IF NOT EXISTS marshmallow_private;
REVOKE ALL ON SCHEMA marshmallow_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.lead_copy_role_permissions (
  role public.app_role PRIMARY KEY,
  allowed boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.lead_copy_user_permissions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  allowed boolean NOT NULL
);
INSERT INTO public.lead_copy_role_permissions(role, allowed)
SELECT role::public.app_role, true
FROM unnest(ARRAY['admin','processor','customer_service','cs_admin','opr','opr_admin']) AS role
ON CONFLICT (role) DO NOTHING;

ALTER TABLE public.lead_copy_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_copy_user_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_copy_role_permissions, public.lead_copy_user_permissions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_copy_role_permissions, public.lead_copy_user_permissions TO authenticated;

DROP POLICY IF EXISTS "Read copy role defaults" ON public.lead_copy_role_permissions;
CREATE POLICY "Read copy role defaults" ON public.lead_copy_role_permissions
FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Admin manages copy role defaults" ON public.lead_copy_role_permissions;
CREATE POLICY "Admin manages copy role defaults" ON public.lead_copy_role_permissions
FOR ALL TO authenticated
USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Read own copy override" ON public.lead_copy_user_permissions;
CREATE POLICY "Read own copy override" ON public.lead_copy_user_permissions
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Admin manages copy overrides" ON public.lead_copy_user_permissions;
CREATE POLICY "Admin manages copy overrides" ON public.lead_copy_user_permissions
FOR ALL TO authenticated
USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.get_lead_copy_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.has_role(auth.uid(), 'admin'::public.app_role) THEN true
    WHEN NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN false
    ELSE COALESCE(
      (SELECT allowed FROM public.lead_copy_user_permissions WHERE user_id = auth.uid()),
      (SELECT p.allowed FROM public.lead_copy_role_permissions p
       JOIN public.user_roles r ON r.role = p.role WHERE r.user_id = auth.uid()
       ORDER BY p.role::text LIMIT 1), true)
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_lead_copy_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only Admin may manage Copy Complete Details' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'roles', (SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM public.lead_copy_role_permissions p),
    'users', (SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM public.lead_copy_user_permissions p));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_lead_copy_permission(p_role public.app_role, p_user_id uuid, p_allowed boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only Admin may manage Copy Complete Details' USING ERRCODE = '42501';
  END IF;
  IF (p_role IS NULL) = (p_user_id IS NULL) THEN
    RAISE EXCEPTION 'Choose exactly one role or user';
  END IF;
  IF p_role = 'admin'::public.app_role OR
     (p_user_id IS NOT NULL AND public.has_role(p_user_id, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Admin always retains copy access';
  END IF;
  IF p_role IS NOT NULL THEN
    INSERT INTO public.lead_copy_role_permissions(role, allowed) VALUES(p_role, COALESCE(p_allowed, true))
    ON CONFLICT(role) DO UPDATE SET allowed = EXCLUDED.allowed;
  ELSIF p_allowed IS NULL THEN
    DELETE FROM public.lead_copy_user_permissions WHERE user_id = p_user_id;
  ELSE
    INSERT INTO public.lead_copy_user_permissions(user_id, allowed) VALUES(p_user_id, p_allowed)
    ON CONFLICT(user_id) DO UPDATE SET allowed = EXCLUDED.allowed;
  END IF;
  INSERT INTO public.activity_logs(user_id, user_name, action, target_type, target_id, details)
  VALUES(auth.uid(), COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Admin'),
    'lead_copy_permission_changed', 'permission', COALESCE(p_user_id::text, p_role::text),
    jsonb_build_object('role', p_role, 'user_id', p_user_id, 'allowed', p_allowed)::text);
END;
$$;

-- Server-owned projections, not a client-side copy of the complete leads row.
-- A separate recipient inbox avoids the generic notification dispatcher's ability
-- to accept caller-provided recipients/content. Only read acknowledgement is writable.
CREATE TABLE IF NOT EXISTS public.lead_hold_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  reason text NOT NULL CHECK(reason IN ('ready_to_schedule','scheduled','cancelled')),
  snapshot jsonb NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS lead_hold_alerts_one_unread
ON public.lead_hold_alerts(user_id, lead_id) WHERE read = false;
CREATE INDEX IF NOT EXISTS lead_hold_alerts_user_created ON public.lead_hold_alerts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_hold_alerts_lead ON public.lead_hold_alerts(lead_id);
ALTER TABLE public.lead_hold_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_hold_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE(read) ON public.lead_hold_alerts TO authenticated;
DROP POLICY IF EXISTS "Operators read own hold alerts" ON public.lead_hold_alerts;
CREATE POLICY "Operators read own hold alerts" ON public.lead_hold_alerts
FOR SELECT TO authenticated USING (
  user_id = (SELECT auth.uid()) AND
  (public.has_role((SELECT auth.uid()), 'opr'::public.app_role) OR
   public.has_role((SELECT auth.uid()), 'opr_admin'::public.app_role)));
DROP POLICY IF EXISTS "Operators acknowledge own hold alerts" ON public.lead_hold_alerts;
CREATE POLICY "Operators acknowledge own hold alerts" ON public.lead_hold_alerts
FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()) AND
  (public.has_role((SELECT auth.uid()), 'opr'::public.app_role) OR
   public.has_role((SELECT auth.uid()), 'opr_admin'::public.app_role)))
WITH CHECK (user_id = (SELECT auth.uid()) AND read = true);

-- Remember the actual database origin of a pending cancellation, not a browser's
-- previous_status value. Requests from urgent jobs are alerted on final cancellation,
-- never when merely requested; rejected/abandoned requests remove the marker.
CREATE TABLE IF NOT EXISTS marshmallow_private.urgent_cancellation_origins (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE
);
ALTER TABLE marshmallow_private.urgent_cancellation_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marshmallow_private.urgent_cancellation_origins FROM PUBLIC, anon, authenticated;

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
     AND EXISTS (SELECT 1 FROM marshmallow_private.urgent_cancellation_origins WHERE lead_id = NEW.id) THEN
    v_reason := 'cancelled';
  ELSIF OLD.status = 'urgent_job' AND NEW.status = 'urgent_job'
     AND NEW.cs_tag = 'ready_to_schedule' AND NEW.cs_tag IS DISTINCT FROM OLD.cs_tag THEN
    v_reason := 'ready_to_schedule';
  END IF;

  IF OLD.status = 'cancellation_requested' AND NEW.status <> 'cancellation_requested' THEN
    DELETE FROM marshmallow_private.urgent_cancellation_origins WHERE lead_id = NEW.id;
  END IF;
  IF v_reason IS NULL THEN RETURN NEW; END IF;

  -- An old "work this urgent job" alert is obsolete once the hold instruction
  -- arrives. Only clear operator recipients' urgent alerts, not other roles' inboxes.
  UPDATE public.notifications n SET read = true
  WHERE n.lead_id = NEW.id AND n.title = '[Alert] Urgent Job' AND n.read = false
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = n.user_id
      AND r.role IN ('opr'::public.app_role, 'opr_admin'::public.app_role));

  v_snapshot := jsonb_build_object(
    'job_id', NEW.job_id, 'customer_name', NEW.customer_name,
    'customer_phone', NEW.customer_phone, 'customer_landline', NEW.customer_landline,
    'service_type', NEW.service_type, 'service_details', NEW.service_details,
    'address', NEW.address, 'city', NEW.city, 'state', NEW.state, 'zip_code', NEW.zip_code,
    'customer_schedule_requirements', NEW.customer_schedule_requirements,
    'scheduled_date', NEW.scheduled_date, 'scheduled_time_start', NEW.scheduled_time_start,
    'scheduled_time_end', NEW.scheduled_time_end, 'tech_name', NEW.tech_name, 'tech_number', NEW.tech_number,
    'status', NEW.status, 'cs_tag', NEW.cs_tag,
    'quote', CASE WHEN NEW.show_quote_to_opr IS FALSE THEN NULL ELSE NEW.quote END);

  -- The urgent board is shared by both Operator roles. Notify ALL of them, not
  -- only users in lead_operator_assignments. One row per user even with two roles.
  -- Row locking of the lead plus the partial unique index makes coalescing atomic.
  INSERT INTO public.lead_hold_alerts(user_id, lead_id, reason, snapshot)
  SELECT DISTINCT user_id, NEW.id, v_reason, v_snapshot FROM public.user_roles
  WHERE role IN ('opr'::public.app_role, 'opr_admin'::public.app_role)
  ON CONFLICT(user_id, lead_id) WHERE read = false DO UPDATE
  SET reason = EXCLUDED.reason, snapshot = EXCLUDED.snapshot,
      revision = gen_random_uuid(), created_at = clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION marshmallow_private.capture_operator_hold_alert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS leads_capture_operator_hold_alert ON public.leads;
CREATE TRIGGER leads_capture_operator_hold_alert AFTER UPDATE OF status, cs_tag ON public.leads
FOR EACH ROW EXECUTE FUNCTION marshmallow_private.capture_operator_hold_alert();

CREATE OR REPLACE FUNCTION public.get_operator_hold_alerts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'observed_at', clock_timestamp(),
    'unread_count', (SELECT count(*) FROM public.lead_hold_alerts WHERE read = false),
    'alerts', (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.read, a.created_at DESC), '[]'::jsonb)
      FROM (SELECT id, lead_id, revision, reason, snapshot, read, created_at
        FROM public.lead_hold_alerts ORDER BY read, created_at DESC LIMIT 100) a));
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_operator_hold_alert(p_id uuid, p_revision uuid, p_alerts jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_id IS NOT NULL AND p_revision IS NOT NULL AND p_alerts IS NULL THEN
    UPDATE public.lead_hold_alerts SET read = true
    WHERE id = p_id AND revision = p_revision AND read = false;
  ELSIF p_id IS NULL AND p_revision IS NULL AND jsonb_typeof(p_alerts) = 'array' THEN
    -- Match only the revisions actually displayed, not a timestamp. A transaction
    -- may begin before a fetch but commit afterwards; timestamps alone lose alerts.
    UPDATE public.lead_hold_alerts a SET read = true
    FROM jsonb_to_recordset(p_alerts) AS seen(id uuid, revision uuid)
    WHERE a.id = seen.id AND a.revision = seen.revision AND a.read = false;
  ELSE
    RAISE EXCEPTION 'Supply an alert revision or displayed inbox revisions';
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_lead_copy_access(), public.get_lead_copy_settings(),
  public.set_lead_copy_permission(public.app_role, uuid, boolean), public.get_operator_hold_alerts(),
  public.acknowledge_operator_hold_alert(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lead_copy_access(), public.get_lead_copy_settings(),
  public.set_lead_copy_permission(public.app_role, uuid, boolean), public.get_operator_hold_alerts(),
  public.acknowledge_operator_hold_alert(uuid, uuid, jsonb) TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'lead_hold_alerts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_hold_alerts;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'lead_copy_role_permissions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_copy_role_permissions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'lead_copy_user_permissions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_copy_user_permissions;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- ROLLBACK (manual; export any alerts/settings you want to retain first):
-- BEGIN;
-- DROP TRIGGER IF EXISTS leads_capture_operator_hold_alert ON public.leads;
-- DROP FUNCTION IF EXISTS marshmallow_private.capture_operator_hold_alert();
-- DROP FUNCTION IF EXISTS public.acknowledge_operator_hold_alert(uuid,uuid,jsonb);
-- DROP FUNCTION IF EXISTS public.get_operator_hold_alerts();
-- DROP FUNCTION IF EXISTS public.set_lead_copy_permission(public.app_role,uuid,boolean);
-- DROP FUNCTION IF EXISTS public.get_lead_copy_settings();
-- DROP FUNCTION IF EXISTS public.get_lead_copy_access();
-- DROP TABLE IF EXISTS public.lead_hold_alerts;
-- DROP TABLE IF EXISTS marshmallow_private.urgent_cancellation_origins;
-- DROP TABLE IF EXISTS public.lead_copy_user_permissions;
-- DROP TABLE IF EXISTS public.lead_copy_role_permissions;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
-- Leave notifications in supabase_realtime: other existing alerts depend on it.
-- Do not drop the private schema (it may acquire unrelated objects).
