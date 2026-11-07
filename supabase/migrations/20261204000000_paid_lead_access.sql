-- =============================================================================
-- Paid leads for users granted the Paid status (all time or a date range)
-- =============================================================================
-- Purpose (business request 2026-11-07): when an Admin switches on the Paid
-- status for a user in Settings -> Status visibility, that user must actually see
-- paid leads, and the Admin chooses how much: all time, or leads created within a
-- custom date range. Before this, the switch only changed the screen: lead RLS
-- hides paid leads from CS Admin entirely and limits CS to their own leads, so the
-- switch could not show them.
--
-- What this changes:
--   1. public.paid_lead_access: one row per user = the grant's window
--      (start_date/end_date both NULL = all time; both set = inclusive range of
--      the lead's created date, in America/New_York). Read: own row or Admin.
--      Written only through set_paid_lead_access.
--   2. One extra permissive SELECT policy on public.leads: a paid lead is visible
--      when the caller has a USER-SPECIFIC Paid visibility switch on AND a grant
--      whose window covers the lead's created_at. The window is computed once per
--      query (InitPlan), not per row. Role-wide Paid switches do not grant data.
--      SELECT only: no update/delete rights; paid stays terminal.
--   3. public.set_paid_lead_access(user, enabled, start, end): Admin only. Sets the
--      user's Paid visibility switch and grant together, audited in activity_logs.
--      Turning it off removes the grant.
--
-- Not changed: every existing lead policy, Admin/Processor/OPR/OPR Admin access,
-- other statuses, lead_status_visibility policies. No lead rows are changed. On
-- 2026-11-07 no user had Paid switched on, so nobody gains access until an Admin
-- grants it.
--
-- Apply manually. Harnesses: isolated supabase/tests/170_paid_lead_access.sql via
-- scripts/test-paid-lead-access-db.mjs; read-only before/after on production:
-- supabase/tests/40_leads_rls_baseline.sql (matrix must be identical while no
-- grant exists). Rollback at the end of this file.
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.paid_lead_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date date,
  end_date date,
  granted_by uuid,
  granted_by_name text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paid_lead_access_window CHECK (
    (start_date IS NULL AND end_date IS NULL)
    OR (start_date IS NOT NULL AND end_date IS NOT NULL AND start_date <= end_date))
);
COMMENT ON TABLE public.paid_lead_access IS
  'Paid-lead grant per user: both dates NULL = all time, else leads created start..end (inclusive, America/New_York). Written by set_paid_lead_access only.';
ALTER TABLE public.paid_lead_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paid_lead_access FROM anon, authenticated;
GRANT SELECT ON public.paid_lead_access TO authenticated;
DROP POLICY IF EXISTS "Users read own paid access; Admin reads all" ON public.paid_lead_access;
CREATE POLICY "Users read own paid access; Admin reads all" ON public.paid_lead_access FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- The caller's paid-lead window, or NULL (no access). Requires the user-specific
-- Paid visibility switch, so switching Paid off for the user also ends access.
CREATE OR REPLACE FUNCTION marshmallow_private.my_paid_lead_window() RETURNS tstzrange
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT tstzrange(
    CASE WHEN a.start_date IS NULL THEN '-infinity'::timestamptz ELSE (a.start_date::timestamp AT TIME ZONE 'America/New_York') END,
    CASE WHEN a.end_date IS NULL THEN 'infinity'::timestamptz ELSE ((a.end_date + 1)::timestamp AT TIME ZONE 'America/New_York') END,
    '[)')
  FROM public.paid_lead_access a
  WHERE a.user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.lead_status_visibility v
                WHERE v.user_id = a.user_id AND v.status = 'paid' AND v.is_visible IS TRUE);
$$;
REVOKE ALL ON FUNCTION marshmallow_private.my_paid_lead_window() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.my_paid_lead_window() TO authenticated;

DROP POLICY IF EXISTS "Granted paid leads" ON public.leads;
CREATE POLICY "Granted paid leads" ON public.leads FOR SELECT TO authenticated
  USING (status = 'paid' AND created_at <@ (SELECT marshmallow_private.my_paid_lead_window()));

CREATE OR REPLACE FUNCTION public.set_paid_lead_access(p_user_id uuid, p_enabled boolean, p_start date, p_end date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  caller uuid := auth.uid();
  caller_name text;
  target_role text;
  target_name text;
  v_existing uuid;
  window_text text;
BEGIN
  IF caller IS NULL OR NOT public.has_role(caller, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin can change paid lead access' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Choose a user and on or off' USING errcode = '22023';
  END IF;
  SELECT role::text INTO target_role FROM public.user_roles WHERE user_id = p_user_id ORDER BY role::text LIMIT 1;
  IF target_role IS NULL THEN RAISE EXCEPTION 'User not found' USING errcode = '22023'; END IF;
  IF p_enabled AND ((p_start IS NULL) <> (p_end IS NULL) OR p_start > p_end) THEN
    RAISE EXCEPTION 'Choose All time, or a start date on or before the end date' USING errcode = '22023';
  END IF;
  SELECT coalesce(full_name, 'Admin') INTO caller_name FROM public.profiles WHERE id = caller;
  SELECT coalesce(full_name, p_user_id::text) INTO target_name FROM public.profiles WHERE id = p_user_id;

  -- The user's own Paid visibility switch (what the Settings grid and the lead list read).
  SELECT id INTO v_existing FROM public.lead_status_visibility WHERE user_id = p_user_id AND status = 'paid' LIMIT 1;
  IF v_existing IS NULL THEN
    INSERT INTO public.lead_status_visibility(user_id, role, status, is_visible) VALUES (p_user_id, target_role, 'paid', p_enabled);
  ELSE
    UPDATE public.lead_status_visibility SET is_visible = p_enabled, updated_at = now() WHERE id = v_existing;
  END IF;

  IF p_enabled THEN
    INSERT INTO public.paid_lead_access(user_id, start_date, end_date, granted_by, granted_by_name, updated_at)
    VALUES (p_user_id, p_start, p_end, caller, caller_name, now())
    ON CONFLICT (user_id) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
      granted_by = EXCLUDED.granted_by, granted_by_name = EXCLUDED.granted_by_name, updated_at = now();
    window_text := CASE WHEN p_start IS NULL THEN 'all time' ELSE 'leads created ' || p_start || ' to ' || p_end END;
  ELSE
    DELETE FROM public.paid_lead_access WHERE user_id = p_user_id;
  END IF;

  INSERT INTO public.activity_logs(user_id, user_name, action, target_type, target_id, details)
  VALUES (caller, caller_name, 'paid_lead_access_' || CASE WHEN p_enabled THEN 'granted' ELSE 'removed' END, 'user', p_user_id::text,
    CASE WHEN p_enabled THEN 'Admin granted paid leads to "' || target_name || '": ' || window_text || '.'
         ELSE 'Admin removed paid leads from "' || target_name || '".' END);

  RETURN jsonb_build_object('saved', true, 'enabled', p_enabled, 'start_date', CASE WHEN p_enabled THEN p_start END, 'end_date', CASE WHEN p_enabled THEN p_end END);
END $$;
REVOKE ALL ON FUNCTION public.set_paid_lead_access(uuid, boolean, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_paid_lead_access(uuid, boolean, date, date) TO authenticated;

COMMIT;

-- =============================================================================
-- Rollback (manual, reviewed):
--   DROP POLICY IF EXISTS "Granted paid leads" ON public.leads;
--   DROP FUNCTION IF EXISTS public.set_paid_lead_access(uuid, boolean, date, date);
--   DROP FUNCTION IF EXISTS marshmallow_private.my_paid_lead_window();
--   DROP TABLE IF EXISTS public.paid_lead_access;  -- after confirming grants are not needed
-- Users' Paid visibility switches remain as set (screen-only again). No lead rows
-- are changed by this migration or its rollback. Unpublish the CRM build that
-- calls set_paid_lead_access first.
-- =============================================================================
