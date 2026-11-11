-- =============================================================================
-- Migration : 20261210070000_rls_initplan_wrap_auth_uid.sql
-- Purpose   : Stop 23 RLS policies from re-evaluating auth.uid() (and, where a
--             policy's role check does not depend on the row, has_role()) for
--             every row. Same authorization, less CPU per query.
--
-- THE DEFECT
--   The Supabase performance advisor (auth_rls_initplan, checked read-only on
--   2026-11-11) flags 23 policies that call auth.uid() bare. PostgreSQL then
--   re-parses the JWT claims for each candidate row; where the call feeds
--   has_role() - a SECURITY DEFINER function that scans public.user_roles -
--   the whole lookup repeats per row. This is the same defect class that
--   caused the 2026-11-07 / 2026-11-09 overloads and was fixed for the leads
--   SELECT path in 20261210000000_leads_rls_single_role_lookup.sql; these are
--   the remaining flagged policies.
--
-- THE FIX
--   Mechanical rewrite only. Each expression is kept verbatim as read from
--   pg_policies on production (2026-11-11), with two wrapping rules:
--     - a role check with no row dependency, e.g. has_role(auth.uid(), 'x'),
--       becomes (SELECT has_role(auth.uid(), 'x')): one InitPlan, evaluated
--       once per statement;
--     - a row-dependent comparison, e.g. requested_by = auth.uid(), becomes
--       requested_by = (SELECT auth.uid()): auth.uid() evaluated once.
--   No role gains or loses any access: every rewritten predicate is
--   value-equivalent for each row (auth.uid() and has_role() are STABLE, so
--   their value cannot change within a statement).
--
-- DELIBERATELY NOT CHANGED
--   The advisor also reports multiple_permissive_policies (leads SELECT,
--   technicians, and others). Those pairs are left alone on purpose:
--   PostgreSQL combines permissive policies by OR-ing their quals into one
--   plan expression, so merging them does not remove per-row work, and the
--   leads split ("Lead visibility by role" vs "Granted paid leads") is a
--   deliberate feature boundary (docs/PAID_LEAD_ACCESS.md). ALTER POLICY
--   below keeps each policy's name, command, and roles; only the flagged
--   expressions change.
--
-- VERIFYING AFTER APPLYING
--   - supabase advisor (performance): auth_rls_initplan count drops to 0.
--   - supabase/tests/40_leads_rls_baseline.sql: role visibility matrix must be
--     identical before and after (this file touches leads INSERT/DELETE only;
--     SELECT policies are untouched).
--   - Harnesses for the touched request tables where present, e.g.
--     supabase/tests for cancellation/urgent review flows: every PASS/FAIL
--     unchanged.
--
-- APPLY
--   Paste into the Supabase SQL Editor and run as postgres. Idempotent: ALTER
--   POLICY sets the same expression on re-run. One transaction, so there is no
--   moment without a policy.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- google_sheets_sync_* (admin-only diagnostics surfaces)
-- ---------------------------------------------------------------------------

ALTER POLICY "Admin reads sheets sync errors" ON public.google_sheets_sync_errors
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "Admin manages sheets sync health" ON public.google_sheets_sync_health
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "Admin reads sheets sync queue" ON public.google_sheets_sync_queue
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "Admin updates sheets sync queue" ON public.google_sheets_sync_queue
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));

-- ---------------------------------------------------------------------------
-- lead_cancellation_requests
-- ---------------------------------------------------------------------------

ALTER POLICY "Admins can delete lead cancellation requests" ON public.lead_cancellation_requests
  USING ((SELECT user_roles.role FROM user_roles WHERE user_roles.user_id = (SELECT auth.uid())) = 'admin'::app_role);

ALTER POLICY "CS and processors can create cancellation requests" ON public.lead_cancellation_requests
  WITH CHECK (
    (requested_by = (SELECT auth.uid()))
    AND (requested_by_role = ANY (ARRAY['customer_service'::text, 'processor'::text, 'cs_admin'::text]))
  );

-- ---------------------------------------------------------------------------
-- lead_notes / lead_updates (admin delete gates)
-- ---------------------------------------------------------------------------

ALTER POLICY "Admins can delete lead notes" ON public.lead_notes
  USING ((SELECT user_roles.role FROM user_roles WHERE user_roles.user_id = (SELECT auth.uid())) = 'admin'::app_role);

ALTER POLICY "Admins can delete lead updates" ON public.lead_updates
  USING ((SELECT user_roles.role FROM user_roles WHERE user_roles.user_id = (SELECT auth.uid())) = 'admin'::app_role);

-- ---------------------------------------------------------------------------
-- lead_urgent_review_requests (urgent-review approval gate; polled every 30 s)
-- ---------------------------------------------------------------------------

ALTER POLICY "Requesters raise urgent reviews" ON public.lead_urgent_review_requests
  WITH CHECK (
    (SELECT has_role(auth.uid(), 'admin'::app_role))
    OR (SELECT has_role(auth.uid(), 'cs_admin'::app_role))
    OR (SELECT has_role(auth.uid(), 'processor'::app_role))
    OR (requested_by = (SELECT auth.uid()))
  );

ALTER POLICY "Reviewers read urgent reviews" ON public.lead_urgent_review_requests
  USING (
    (SELECT has_role(auth.uid(), 'admin'::app_role))
    OR (SELECT has_role(auth.uid(), 'cs_admin'::app_role))
    OR (requested_by = (SELECT auth.uid()))
  );

ALTER POLICY "Reviewers update urgent reviews" ON public.lead_urgent_review_requests
  USING (
    (SELECT has_role(auth.uid(), 'admin'::app_role))
    OR (SELECT has_role(auth.uid(), 'cs_admin'::app_role))
  )
  WITH CHECK (
    (SELECT has_role(auth.uid(), 'admin'::app_role))
    OR (SELECT has_role(auth.uid(), 'cs_admin'::app_role))
  );

-- ---------------------------------------------------------------------------
-- leads (INSERT and DELETE only; both SELECT policies and the UPDATE policy
-- already use once-per-statement forms and are untouched)
-- ---------------------------------------------------------------------------

ALTER POLICY "Admins can delete leads" ON public.leads
  USING ((SELECT user_roles.role FROM user_roles WHERE user_roles.user_id = (SELECT auth.uid())) = 'admin'::app_role);

ALTER POLICY "Lead creators can insert their own leads" ON public.leads
  WITH CHECK (
    (created_by = (SELECT auth.uid()))
    AND ((manual_entry = false) OR can_create_manual_lead())
  );

-- ---------------------------------------------------------------------------
-- optimized_areas (admin-only)
-- ---------------------------------------------------------------------------

ALTER POLICY "Admins can view optimized areas" ON public.optimized_areas
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "Admins can insert optimized areas" ON public.optimized_areas
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "Admins can update optimized areas" ON public.optimized_areas
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "Admins can delete optimized areas" ON public.optimized_areas
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)));

-- ---------------------------------------------------------------------------
-- profiles (admin update gate; the self-update policy already uses the
-- wrapped form and is untouched)
-- ---------------------------------------------------------------------------

ALTER POLICY "Admins can update profiles" ON public.profiles
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)));

-- ---------------------------------------------------------------------------
-- technician_change_requests (technician-change approval gate; polled every 30 s)
-- ---------------------------------------------------------------------------

ALTER POLICY "Reviewers read technician change requests" ON public.technician_change_requests
  USING (
    (SELECT has_role(auth.uid(), 'processor'::app_role))
    OR (SELECT has_role(auth.uid(), 'admin'::app_role))
  );

ALTER POLICY "Admins update technician change requests" ON public.technician_change_requests
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "Processors raise technician change requests" ON public.technician_change_requests
  WITH CHECK (
    (SELECT has_role(auth.uid(), 'processor'::app_role))
    AND (requested_by = (SELECT auth.uid()))
  );

ALTER POLICY "Requester or admin deletes technician change requests" ON public.technician_change_requests
  USING (
    (SELECT has_role(auth.uid(), 'admin'::app_role))
    OR (requested_by = (SELECT auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- user_access_codes (cs_admin visibility over customer_service codes)
-- ---------------------------------------------------------------------------

ALTER POLICY "CS Admins can view access codes" ON public.user_access_codes
  USING (
    (SELECT has_role(auth.uid(), 'admin'::app_role))
    OR (
      (SELECT has_role(auth.uid(), 'cs_admin'::app_role))
      AND (
        (user_id = (SELECT auth.uid()))
        OR (user_id IN (SELECT user_roles.user_id FROM user_roles WHERE user_roles.role = 'customer_service'::app_role))
      )
    )
  );

COMMIT;

-- =============================================================================
-- ROLLBACK - run manually to restore the exact previous expressions
-- (verbatim from pg_policies on production, 2026-11-11, before this migration).
--
-- BEGIN;
-- ALTER POLICY "Admin reads sheets sync errors" ON public.google_sheets_sync_errors
--   USING (has_role(auth.uid(), 'admin'::app_role));
-- ALTER POLICY "Admin manages sheets sync health" ON public.google_sheets_sync_health
--   USING (has_role(auth.uid(), 'admin'::app_role))
--   WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
-- ALTER POLICY "Admin reads sheets sync queue" ON public.google_sheets_sync_queue
--   USING (has_role(auth.uid(), 'admin'::app_role));
-- ALTER POLICY "Admin updates sheets sync queue" ON public.google_sheets_sync_queue
--   USING (has_role(auth.uid(), 'admin'::app_role))
--   WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
-- ALTER POLICY "Admins can delete lead cancellation requests" ON public.lead_cancellation_requests
--   USING ((SELECT user_roles.role FROM user_roles WHERE user_roles.user_id = auth.uid()) = 'admin'::app_role);
-- ALTER POLICY "CS and processors can create cancellation requests" ON public.lead_cancellation_requests
--   WITH CHECK ((requested_by = auth.uid()) AND (requested_by_role = ANY (ARRAY['customer_service'::text, 'processor'::text, 'cs_admin'::text])));
-- ALTER POLICY "Admins can delete lead notes" ON public.lead_notes
--   USING ((SELECT user_roles.role FROM user_roles WHERE user_roles.user_id = auth.uid()) = 'admin'::app_role);
-- ALTER POLICY "Admins can delete lead updates" ON public.lead_updates
--   USING ((SELECT user_roles.role FROM user_roles WHERE user_roles.user_id = auth.uid()) = 'admin'::app_role);
-- ALTER POLICY "Requesters raise urgent reviews" ON public.lead_urgent_review_requests
--   WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'cs_admin'::app_role) OR has_role(auth.uid(), 'processor'::app_role) OR (requested_by = auth.uid()));
-- ALTER POLICY "Reviewers read urgent reviews" ON public.lead_urgent_review_requests
--   USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'cs_admin'::app_role) OR (requested_by = auth.uid()));
-- ALTER POLICY "Reviewers update urgent reviews" ON public.lead_urgent_review_requests
--   USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'cs_admin'::app_role))
--   WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'cs_admin'::app_role));
-- ALTER POLICY "Admins can delete leads" ON public.leads
--   USING ((SELECT user_roles.role FROM user_roles WHERE user_roles.user_id = auth.uid()) = 'admin'::app_role);
-- ALTER POLICY "Lead creators can insert their own leads" ON public.leads
--   WITH CHECK ((created_by = auth.uid()) AND ((manual_entry = false) OR can_create_manual_lead()));
-- ALTER POLICY "Admins can view optimized areas" ON public.optimized_areas
--   USING (has_role(auth.uid(), 'admin'::app_role));
-- ALTER POLICY "Admins can insert optimized areas" ON public.optimized_areas
--   WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
-- ALTER POLICY "Admins can update optimized areas" ON public.optimized_areas
--   USING (has_role(auth.uid(), 'admin'::app_role))
--   WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
-- ALTER POLICY "Admins can delete optimized areas" ON public.optimized_areas
--   USING (has_role(auth.uid(), 'admin'::app_role));
-- ALTER POLICY "Admins can update profiles" ON public.profiles
--   USING (has_role(auth.uid(), 'admin'::app_role));
-- ALTER POLICY "Reviewers read technician change requests" ON public.technician_change_requests
--   USING (has_role(auth.uid(), 'processor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
-- ALTER POLICY "Admins update technician change requests" ON public.technician_change_requests
--   USING (has_role(auth.uid(), 'admin'::app_role))
--   WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
-- ALTER POLICY "Processors raise technician change requests" ON public.technician_change_requests
--   WITH CHECK (has_role(auth.uid(), 'processor'::app_role) AND (requested_by = auth.uid()));
-- ALTER POLICY "Requester or admin deletes technician change requests" ON public.technician_change_requests
--   USING (has_role(auth.uid(), 'admin'::app_role) OR (requested_by = auth.uid()));
-- ALTER POLICY "CS Admins can view access codes" ON public.user_access_codes
--   USING (has_role(auth.uid(), 'admin'::app_role) OR (has_role(auth.uid(), 'cs_admin'::app_role) AND ((user_id = auth.uid()) OR (user_id IN (SELECT user_roles.user_id FROM user_roles WHERE user_roles.role = 'customer_service'::app_role)))));
-- COMMIT;
-- =============================================================================
