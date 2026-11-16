-- =============================================================================
-- Migration : 20261227000000_leads_rls_initplan_role_checks.sql
-- Applied   : production (kxiqholnmhkwhdkhtopp) 2026-11-16, at the user's request.
-- Purpose   : Evaluate the caller's role once per query, not once per row, in
--             the lead and lead-note SELECT policies. Same rules, same results.
--
-- DEFECT (measured read-only 2026-11-16)
--   "Lead visibility by role" called has_role(auth.uid(), ...) - a SECURITY
--   DEFINER function PostgreSQL cannot inline - for EVERY row, up to 11 times
--   per row for a Customer Service user. The Leads page read ran ~17,800 times
--   at 88 ms and ~3,400 times at 113 ms (CS) over 2026-11-09..16. Supabase's
--   performance advisor (auth_rls_initplan) flagged it together with the two
--   RESTRICTIVE "Regular OPR cannot read ..." policies, whose has_role() was
--   already in a sub-select but still called auth.uid() unwrapped.
--
-- WHAT THIS DOES
--   ALTER POLICY ... USING only (name, command, roles, PERMISSIVE/RESTRICTIVE
--   unchanged). Every has_role(auth.uid(), R) becomes
--   (SELECT public.has_role((SELECT auth.uid()), R)), the documented pattern
--   (https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).
--   Row-dependent parts (status, cs_tag, leads_owned_by_caller(leads.*)) are
--   untouched. No new access, no table, grant, function or data change.
--
-- VERIFY
--   supabase/tests/40_leads_rls_baseline.sql (role visibility counts) and
--   supabase/tests/93_leads_rls_initplan_fingerprint.sql (exact md5 of visible
--   lead and note ids per role) must match before/after cell for cell.
--
-- ROLLBACK - restores the exact live expressions captured 2026-11-16:
/*
ALTER POLICY "Lead visibility by role" ON public.leads USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'processor'::app_role)
  OR (has_role(auth.uid(), 'opr'::app_role) AND (status = 'urgent_job'::text) AND (cs_tag IS NULL))
  OR (has_role(auth.uid(), 'opr_admin'::app_role) AND ((status = 'urgent_job'::text) OR ((status <> 'scammed'::text) AND leads_owned_by_caller(leads.*))))
  OR (has_role(auth.uid(), 'cs_admin'::app_role) AND (status <> ALL (ARRAY['paid'::text, 'partial_paid'::text, 'cancelled'::text, 'job_done'::text, 'scammed'::text])))
  OR ((NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'processor'::app_role) OR has_role(auth.uid(), 'opr'::app_role) OR has_role(auth.uid(), 'opr_admin'::app_role) OR has_role(auth.uid(), 'cs_admin'::app_role))) AND leads_owned_by_caller(leads.*))
);
ALTER POLICY "Regular OPR cannot read leads directly" ON public.leads USING (
  (NOT ( SELECT has_role(auth.uid(), 'opr'::app_role) AS has_role)) OR ( SELECT has_role(auth.uid(), 'opr_admin'::app_role) AS has_role)
  OR ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role) OR ( SELECT has_role(auth.uid(), 'processor'::app_role) AS has_role)
  OR ( SELECT has_role(auth.uid(), 'cs_admin'::app_role) AS has_role) OR ( SELECT has_role(auth.uid(), 'customer_service'::app_role) AS has_role)
);
ALTER POLICY "Regular OPR cannot read CS notes" ON public.lead_notes USING (
  (note_type IS DISTINCT FROM 'cs'::text) OR (NOT ( SELECT has_role(auth.uid(), 'opr'::app_role) AS has_role))
  OR ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role) OR ( SELECT has_role(auth.uid(), 'opr_admin'::app_role) AS has_role)
  OR ( SELECT has_role(auth.uid(), 'processor'::app_role) AS has_role) OR ( SELECT has_role(auth.uid(), 'cs_admin'::app_role) AS has_role)
  OR ( SELECT has_role(auth.uid(), 'customer_service'::app_role) AS has_role)
);
*/
-- =============================================================================

ALTER POLICY "Lead visibility by role" ON public.leads USING (
  (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  OR (SELECT public.has_role((SELECT auth.uid()), 'processor'::public.app_role))
  OR ((SELECT public.has_role((SELECT auth.uid()), 'opr'::public.app_role))
      AND (status = 'urgent_job'::text) AND (cs_tag IS NULL))
  OR ((SELECT public.has_role((SELECT auth.uid()), 'opr_admin'::public.app_role))
      AND ((status = 'urgent_job'::text)
           OR ((status <> 'scammed'::text) AND public.leads_owned_by_caller(leads.*))))
  OR ((SELECT public.has_role((SELECT auth.uid()), 'cs_admin'::public.app_role))
      AND (status <> ALL (ARRAY['paid'::text, 'partial_paid'::text, 'cancelled'::text, 'job_done'::text, 'scammed'::text])))
  OR ((NOT ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
            OR (SELECT public.has_role((SELECT auth.uid()), 'processor'::public.app_role))
            OR (SELECT public.has_role((SELECT auth.uid()), 'opr'::public.app_role))
            OR (SELECT public.has_role((SELECT auth.uid()), 'opr_admin'::public.app_role))
            OR (SELECT public.has_role((SELECT auth.uid()), 'cs_admin'::public.app_role))))
      AND public.leads_owned_by_caller(leads.*))
);

ALTER POLICY "Regular OPR cannot read leads directly" ON public.leads USING (
  (NOT (SELECT public.has_role((SELECT auth.uid()), 'opr'::public.app_role)))
  OR (SELECT public.has_role((SELECT auth.uid()), 'opr_admin'::public.app_role))
  OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  OR (SELECT public.has_role((SELECT auth.uid()), 'processor'::public.app_role))
  OR (SELECT public.has_role((SELECT auth.uid()), 'cs_admin'::public.app_role))
  OR (SELECT public.has_role((SELECT auth.uid()), 'customer_service'::public.app_role))
);

ALTER POLICY "Regular OPR cannot read CS notes" ON public.lead_notes USING (
  (note_type IS DISTINCT FROM 'cs'::text)
  OR (NOT (SELECT public.has_role((SELECT auth.uid()), 'opr'::public.app_role)))
  OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  OR (SELECT public.has_role((SELECT auth.uid()), 'opr_admin'::public.app_role))
  OR (SELECT public.has_role((SELECT auth.uid()), 'processor'::public.app_role))
  OR (SELECT public.has_role((SELECT auth.uid()), 'cs_admin'::public.app_role))
  OR (SELECT public.has_role((SELECT auth.uid()), 'customer_service'::public.app_role))
);
