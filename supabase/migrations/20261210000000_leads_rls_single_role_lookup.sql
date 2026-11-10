-- =============================================================================
-- Migration : 20261210000000_leads_rls_single_role_lookup.sql
-- Purpose   : Stop the leads SELECT policy from looking up the caller's role
--             for every row. Same visibility, a fraction of the CPU.
--
-- THE DEFECT
--   "Lead visibility by role" (20261030160000) calls
--   has_role(auth.uid(), <role>) up to ten times PER ROW. has_role is
--   SECURITY DEFINER, so PostgreSQL cannot inline it: every call is a separate
--   scan of public.user_roles, and auth.uid() re-parses the JWT claims each time.
--
--   Measured on production (read-only), 2026-11-10:
--     - public.user_roles was scanned 12.9 million times (169M rows read, its
--       index never used) in ~10 mostly quiet hours after the 21:46 restart.
--     - One Leads read for a customer_service user: 950 ms of database time and
--       65,164 buffer hits to return 670 of 5,450 leads, on an idle database.
--       The same filter with the role read once per query: ~81 ms.
--   The policy also runs inside the notifications, lead_notes and
--   lead_ai_statuses policies (each has EXISTS (SELECT ... FROM leads)), on the
--   15-second urgent-table poll, and once per subscribed tab for every realtime
--   change on leads. This was the main CPU cost behind the 2026-11-07 and
--   2026-11-09 outages on burstable compute. Supabase advisor: auth_rls_initplan.
--
-- THE FIX
--   marshmallow_private.caller_role() reads the caller's role once.
--   Wrapped as (SELECT marshmallow_private.caller_role()), PostgreSQL evaluates
--   it once per statement (an InitPlan), not once per row. The ownership test
--   is the body of public.leads_owned_by_caller with auth.uid() also read once
--   per statement. Every user has exactly one role in public.user_roles
--   (17 users, max 1 role each, checked 2026-11-10); has_role compared
--   role::text, and so does this.
--
-- VISIBILITY IS UNCHANGED - verified before writing this file (read-only):
--   - For all 17 real users plus a user with no role, old predicate vs new
--     predicate over all 5,450 leads: 0 mismatches (98,100 pairs).
--   - Each of those users assigned in turn every role (admin, processor, opr,
--     opr_admin, cs_admin, customer_service, an unknown role, no role):
--     0 mismatches (741,200 pairs). Includes opr_admin, which no user holds
--     today.
--   - "Granted paid leads" (the other SELECT policy) is not touched.
--   - INSERT / UPDATE / DELETE policies, grants, statuses, the paid gate and
--     public.leads_owned_by_caller are not touched.
--
-- VERIFYING AFTER APPLYING
--   Run supabase/tests/40_leads_rls_baseline.sql again. Its matrix must match
--   the one recorded before this migration cell for cell:
--     admin            5450 visible / cs_admin 3534 / customer_service 670 /
--     processor 0 / opr 5450 / opr_admin 0
--   (the harness's sample processor and opr_admin accounts currently see 0;
--   that is unrelated to this change and is covered by the all-user check).
--   If any cell moves, run the ROLLBACK below.
--
-- APPLY
--   Paste into the Supabase SQL Editor and run as postgres. Idempotent: it can
--   be run again safely. Policy swap happens in one transaction, so there is no
--   moment without the policy.
-- =============================================================================

BEGIN;

-- The caller's role, read once. NULL when the caller has no role.
CREATE OR REPLACE FUNCTION marshmallow_private.caller_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ur.role::text
    FROM public.user_roles ur
   WHERE ur.user_id = auth.uid()
   LIMIT 1
$$;

COMMENT ON FUNCTION marshmallow_private.caller_role() IS
  'The signed-in caller''s role from public.user_roles (one row per user), or NULL. '
  'Use as (SELECT marshmallow_private.caller_role()) in policies so it runs once per statement.';

REVOKE ALL ON FUNCTION marshmallow_private.caller_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.caller_role() TO authenticated, service_role;

DROP POLICY IF EXISTS "Lead visibility by role" ON public.leads;

CREATE POLICY "Lead visibility by role"
  ON public.leads
  FOR SELECT
  TO authenticated
USING (
    -- Admin, Processor and OPR have always seen every lead.
    (SELECT marshmallow_private.caller_role()) IN ('admin', 'processor', 'opr')

    -- OPR Admin: urgent jobs, plus their own leads that are not scammed.
    OR (
      (SELECT marshmallow_private.caller_role()) = 'opr_admin'
      AND (
        status = 'urgent_job'::text
        OR (
          status <> 'scammed'::text
          AND (
            created_by = (SELECT auth.uid())
            OR assigned_cs = (SELECT auth.uid())
            OR EXISTS (
              SELECT 1 FROM public.lead_shares s
               WHERE s.lead_id = leads.id
                 AND s.shared_with_user_id = (SELECT auth.uid())
            )
          )
        )
      )
    )

    -- CS Admin: every status except the settled or blocked five. Ownership is
    -- deliberately NOT allowed here (see 20261030160000).
    OR (
      (SELECT marshmallow_private.caller_role()) = 'cs_admin'
      AND status <> ALL (ARRAY[
        'paid'::text, 'partial_paid'::text, 'cancelled'::text,
        'job_done'::text, 'scammed'::text
      ])
    )

    -- Everyone else, and any role with no rule above (or no role at all):
    -- their own leads only. coalesce() makes "no role" count as unlisted,
    -- exactly like the previous NOT (has_role(...) OR ...).
    OR (
      coalesce((SELECT marshmallow_private.caller_role()), '') <> ALL (ARRAY[
        'admin', 'processor', 'opr', 'opr_admin', 'cs_admin'
      ])
      AND (
        created_by = (SELECT auth.uid())
        OR assigned_cs = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.lead_shares s
           WHERE s.lead_id = leads.id
             AND s.shared_with_user_id = (SELECT auth.uid())
        )
      )
    )
);

COMMIT;

-- =============================================================================
-- ROLLBACK - run manually to restore the previous policy exactly
-- (from 20261030160000_consolidate_leads_select_policies.sql).
--
-- BEGIN;
-- DROP POLICY IF EXISTS "Lead visibility by role" ON public.leads;
-- CREATE POLICY "Lead visibility by role"
--   ON public.leads FOR SELECT TO authenticated
-- USING (
--     has_role(auth.uid(), 'admin'::app_role)
--     OR has_role(auth.uid(), 'processor'::app_role)
--     OR has_role(auth.uid(), 'opr'::app_role)
--     OR (
--       has_role(auth.uid(), 'opr_admin'::app_role)
--       AND (
--         status = 'urgent_job'::text
--         OR (status <> 'scammed'::text AND public.leads_owned_by_caller(leads.*))
--       )
--     )
--     OR (
--       has_role(auth.uid(), 'cs_admin'::app_role)
--       AND status <> ALL (ARRAY[
--         'paid'::text, 'partial_paid'::text, 'cancelled'::text,
--         'job_done'::text, 'scammed'::text
--       ])
--     )
--     OR (
--       NOT (
--         has_role(auth.uid(), 'admin'::app_role)
--         OR has_role(auth.uid(), 'processor'::app_role)
--         OR has_role(auth.uid(), 'opr'::app_role)
--         OR has_role(auth.uid(), 'opr_admin'::app_role)
--         OR has_role(auth.uid(), 'cs_admin'::app_role)
--       )
--       AND public.leads_owned_by_caller(leads.*)
--     )
-- );
-- DROP FUNCTION IF EXISTS marshmallow_private.caller_role();
-- COMMIT;
-- =============================================================================
