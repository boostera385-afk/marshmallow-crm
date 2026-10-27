-- Purpose: Admin can grant "CS Team Performance" in Feature Access on its own. A
-- user with that grant opens Analytics with only the CS Team Performance section,
-- even when the Analytics tab itself is off. The section is a team report, so it
-- cannot be built from the caller's own RLS-scoped leads (a CS user would see only
-- their own row). This function returns the team-wide AGGREGATE counts only — no
-- lead rows, customer names, phones or addresses — and only to Admin or to a user
-- whose navigation_permissions row for 'cs_team_performance' is allowed.
-- Counting matches the existing Analytics client logic:
--   total = leads created in the range by a customer_service / cs_admin user;
--   engaged = status not in (needs_quote, waiting_complete_details);
--   scheduled = status in (scheduled, job_in_progress, job_done, paid, partial_paid);
--   completed = status in (job_done, paid, partial_paid).
-- Uses existing indexes on leads(created_at) and leads(created_by). No table, RLS,
-- policy or data change. Apply manually; idempotent.
BEGIN;
CREATE OR REPLACE FUNCTION public.cs_team_performance(p_start timestamptz, p_end timestamptz)
RETURNS TABLE(member_id uuid, member_name text, member_role text, total_added bigint, engaged bigint, scheduled bigint, completed bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.navigation_permissions np
      WHERE np.user_id = auth.uid() AND np.nav_section = 'cs_team_performance' AND np.allowed IS TRUE)
  ) THEN
    RAISE EXCEPTION 'CS Team Performance is not enabled for this user' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION 'Invalid date range' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH creators AS (
    SELECT r.user_id AS id, CASE WHEN bool_or(r.role = 'cs_admin'::public.app_role) THEN 'cs_admin' ELSE 'customer_service' END AS kind
    FROM public.user_roles r
    WHERE r.role IN ('customer_service'::public.app_role, 'cs_admin'::public.app_role)
    GROUP BY r.user_id
  )
  SELECT c.id, p.full_name, c.kind,
    count(*)::bigint,
    count(*) FILTER (WHERE l.status NOT IN ('needs_quote', 'waiting_complete_details'))::bigint,
    count(*) FILTER (WHERE l.status IN ('scheduled', 'job_in_progress', 'job_done', 'paid', 'partial_paid'))::bigint,
    count(*) FILTER (WHERE l.status IN ('job_done', 'paid', 'partial_paid'))::bigint
  FROM public.leads l
  JOIN creators c ON c.id = l.created_by
  LEFT JOIN public.profiles p ON p.id = c.id
  WHERE l.created_at >= p_start AND l.created_at <= p_end
  GROUP BY c.id, p.full_name, c.kind;
END;
$$;
REVOKE ALL ON FUNCTION public.cs_team_performance(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_team_performance(timestamptz, timestamptz) TO authenticated;
COMMIT;

-- Rollback (the frontend then shows an error in the section for granted users):
--   DROP FUNCTION IF EXISTS public.cs_team_performance(timestamptz, timestamptz);
-- Feature Access rows with nav_section = 'cs_team_performance' are harmless if left.
