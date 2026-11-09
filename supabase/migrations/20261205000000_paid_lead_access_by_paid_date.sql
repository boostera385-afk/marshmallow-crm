-- =============================================================================
-- Paid lead access: filter a custom range by the date the lead BECAME PAID
-- =============================================================================
-- Defect / request (2026-11-09): Settings -> Status visibility -> Paid with a
-- custom date range filtered paid leads by their CREATED date
-- (20261204000000_paid_lead_access). The business needs the leads that reached
-- Paid within the range, whenever they were created. Read-only check on
-- production 2026-11-09: 18 leads became paid in November but only 2 were
-- created in November, so the existing Nov 1-30 grant showed 2 instead of 18.
--
-- What this changes:
--   1. public.lead_paid_dates: one row per lead = when it became paid. Server
--      owned: RLS on, no browser access; written by the trigger below and this
--      migration's backfill only. leads itself is not changed.
--   2. Trigger leads_record_paid_at (AFTER INSERT OR UPDATE OF status, only when
--      the new status is paid): records now() the first time a lead becomes paid.
--      Paid is terminal, so the first record is final (ON CONFLICT DO NOTHING).
--   3. Backfill for leads already paid: the earliest payment event that set the
--      lead to paid - activity_logs payment_recorded / payment_approved with
--      "status_to":"paid", or an approved lead_payment_requests review. On
--      2026-11-09 this dates 396 of 452 paid leads (371 from logs, 25 from
--      approved requests). 56 older paid leads have no such record: they stay
--      visible under "All time" but match no custom range (no date is guessed).
--   4. The "Granted paid leads" SELECT policy now matches paid leads whose paid
--      date is in the user's window (all time = every paid lead, as before). The
--      id list is computed once per query (InitPlan), not per row.
--   5. public.my_paid_lead_ids(): the caller's in-window paid lead ids, so the
--      CRM applies the same window to roles that can already read every paid lead
--      (Processor, Operator) without exposing paid dates to the browser.
--   6. set_paid_lead_access: audit text says "leads paid <start> to <end>".
--
-- Not changed: grants and their stored dates, the user Paid switch requirement,
-- all other lead policies and statuses, paid stays terminal (no write rights).
--
-- Apply manually, after 20261204000000. Harnesses: isolated
-- supabase/tests/170_paid_lead_access.sql via scripts/test-paid-lead-access-db.mjs;
-- read-only before/after on production: supabase/tests/40_leads_rls_baseline.sql
-- (users without a paid grant must keep an identical matrix). Rollback at end.
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.lead_paid_dates (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  paid_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('status_change', 'payment_log', 'payment_request')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lead_paid_dates IS
  'When each lead became paid (first time). Server-owned: trigger leads_record_paid_at and the 20261205000000 backfill. Used by paid-lead grants.';
ALTER TABLE public.lead_paid_dates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_paid_dates FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS lead_paid_dates_paid_at_idx ON public.lead_paid_dates (paid_at);

CREATE OR REPLACE FUNCTION marshmallow_private.record_lead_paid_at() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.lead_paid_dates (lead_id, paid_at, source)
  VALUES (NEW.id, now(), 'status_change')
  ON CONFLICT (lead_id) DO NOTHING;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.record_lead_paid_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS leads_record_paid_at ON public.leads;
CREATE TRIGGER leads_record_paid_at
  AFTER INSERT OR UPDATE OF status ON public.leads
  FOR EACH ROW WHEN (NEW.status = 'paid')
  EXECUTE FUNCTION marshmallow_private.record_lead_paid_at();

-- Backfill (INSERT only; existing rows are kept). Text matching avoids casting
-- free-form activity details; the uuid cast only runs on a verified uuid.
INSERT INTO public.lead_paid_dates (lead_id, paid_at, source)
SELECT DISTINCT ON (e.lead_id) e.lead_id, e.at, e.source
FROM (
  SELECT CASE WHEN a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN a.target_id::uuid END AS lead_id,
         a.created_at AS at, 'payment_log' AS source
  FROM public.activity_logs a
  WHERE a.action IN ('payment_recorded', 'payment_approved')
    AND a.created_at IS NOT NULL
    AND a.details ~ '"status_to"\s*:\s*"paid"'
  UNION ALL
  SELECT r.lead_id, r.reviewed_at, 'payment_request'
  FROM public.lead_payment_requests r
  WHERE r.status = 'approved' AND r.reviewed_at IS NOT NULL
) e
JOIN public.leads l ON l.id = e.lead_id AND l.status = 'paid'
WHERE e.lead_id IS NOT NULL
ORDER BY e.lead_id, e.at
ON CONFLICT (lead_id) DO NOTHING;

-- The caller's in-window paid lead ids ('{}' without a grant). Window and Paid
-- switch rules come from my_paid_lead_window (20261204000000), unchanged.
CREATE OR REPLACE FUNCTION marshmallow_private.my_granted_paid_lead_ids() RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  w tstzrange := marshmallow_private.my_paid_lead_window();
  ids uuid[];
BEGIN
  IF w IS NULL THEN
    RETURN '{}'::uuid[];
  END IF;
  IF lower(w) = '-infinity'::timestamptz AND upper(w) = 'infinity'::timestamptz THEN
    SELECT coalesce(array_agg(l.id), '{}'::uuid[]) INTO ids FROM public.leads l WHERE l.status = 'paid';
  ELSE
    SELECT coalesce(array_agg(l.id), '{}'::uuid[]) INTO ids
    FROM public.leads l JOIN public.lead_paid_dates p ON p.lead_id = l.id
    WHERE l.status = 'paid' AND p.paid_at <@ w;
  END IF;
  RETURN ids;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.my_granted_paid_lead_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.my_granted_paid_lead_ids() TO authenticated;

DROP POLICY IF EXISTS "Granted paid leads" ON public.leads;
CREATE POLICY "Granted paid leads" ON public.leads FOR SELECT TO authenticated
  USING (status = 'paid' AND id = ANY ((SELECT marshmallow_private.my_granted_paid_lead_ids())::uuid[]));

CREATE OR REPLACE FUNCTION public.my_paid_lead_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT marshmallow_private.my_granted_paid_lead_ids();
$$;
COMMENT ON FUNCTION public.my_paid_lead_ids() IS
  'Paid lead ids in the caller''s paid-lead grant window (by the date each lead became paid); empty without a grant.';
REVOKE ALL ON FUNCTION public.my_paid_lead_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_paid_lead_ids() TO authenticated;

COMMENT ON TABLE public.paid_lead_access IS
  'Paid-lead grant per user: both dates NULL = all time, else leads that became paid start..end (inclusive, America/New_York). Written by set_paid_lead_access only.';

-- Same as 20261204000000 except the audit wording ("leads paid", not "created").
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
    window_text := CASE WHEN p_start IS NULL THEN 'all time' ELSE 'leads paid ' || p_start || ' to ' || p_end END;
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
-- Rollback (manual, reviewed) - returns to created-date windows:
--   BEGIN;
--   DROP POLICY IF EXISTS "Granted paid leads" ON public.leads;
--   CREATE POLICY "Granted paid leads" ON public.leads FOR SELECT TO authenticated
--     USING (status = 'paid' AND created_at <@ (SELECT marshmallow_private.my_paid_lead_window()));
--   DROP FUNCTION IF EXISTS public.my_paid_lead_ids();
--   DROP FUNCTION IF EXISTS marshmallow_private.my_granted_paid_lead_ids();
--   DROP TRIGGER IF EXISTS leads_record_paid_at ON public.leads;
--   DROP FUNCTION IF EXISTS marshmallow_private.record_lead_paid_at();
--   -- Re-run the set_paid_lead_access body from 20261204000000 for the old audit text.
--   COMMIT;
-- Keep public.lead_paid_dates unless it is confirmed unused (paid dates recorded
-- after this migration cannot be rebuilt from logs). No lead rows are changed by
-- this migration or its rollback. Unpublish the CRM build calling my_paid_lead_ids
-- first (or it falls back to showing no ranged paid leads to Processor/Operator).
-- =============================================================================
