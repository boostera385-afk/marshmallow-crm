-- =============================================================================
-- Migration : 20261213000000_opr_tag_hold_rls.sql
-- Purpose   : Hold a tagged lead from a plain Operator (`opr`) at the database
--             layer, not just on one screen.
--
-- THE DEFECT
--   The consolidated leads SELECT policy (20261030160000) gives `opr` an
--   unconditional row: `has_role(auth.uid(), 'opr')` alone, no status or tag
--   clause. The "urgent jobs only" restriction Operators actually see is a
--   frontend default (getDefaultVisibleStatuses in access.ts); an Operator's own
--   Supabase session can already read every lead of any status and any cs_tag
--   directly. LeadsPage.tsx additionally *widened* its on-screen filter to show a
--   lead's new status once it carries a cs_tag, which is the opposite of the
--   intended business rule (2026-11-13): once a lead is tagged (handed to CS/
--   scheduling), it is held from the Operator and hidden, not surfaced.
--
-- THE FIX
--   `opr` keeps exactly the shape `opr_admin` already has for its own urgent-job
--   clause, plus the new "not tagged" condition: a plain Operator may SELECT a
--   lead only when it is `urgent_job` AND `cs_tag IS NULL`. `opr_admin` is
--   unchanged — this project already treats opr_admin as the more-trusted
--   Operator role everywhere this kind of restriction exists
--   (operator-privacy.ts's isLocationOnlyOperator is `opr`-only, for example).
--
-- VERIFYING THIS IS SAFE
--   Run supabase/tests/40_leads_rls_baseline.sql BEFORE applying this and keep
--   its grid. Run it again afterwards and diff: only the `opr` row should
--   shrink (to urgent/untagged leads); every other role's row, including
--   opr_admin, must be unchanged. If any other row moves, stop and roll back.
--
-- ROLLBACK
--   Re-run the CREATE POLICY block below with the opr clause restored to
--   `has_role(auth.uid(), 'opr'::app_role)` (no AND clause), matching
--   20261030160000 exactly. No data is altered by this migration.
-- =============================================================================

DROP POLICY IF EXISTS "Lead visibility by role" ON public.leads;

CREATE POLICY "Lead visibility by role"
  ON public.leads
  FOR SELECT
  TO authenticated
USING (
    -- Admin and Processor still see every lead.
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'processor'::app_role)

    -- Operator (opr): urgent jobs that have not been tagged. A tagged lead is
    -- held from the Operator entirely (business rule 2026-11-13) until the tag
    -- clears, not just hidden on one screen.
    OR (
      has_role(auth.uid(), 'opr'::app_role)
      AND status = 'urgent_job'::text
      AND cs_tag IS NULL
    )

    -- OPR Admin: urgent jobs, plus their own leads that are not scammed. Unchanged.
    OR (
      has_role(auth.uid(), 'opr_admin'::app_role)
      AND (
        status = 'urgent_job'::text
        OR (status <> 'scammed'::text AND public.leads_owned_by_caller(leads.*))
      )
    )

    -- CS Admin: every status except the settled or blocked five. Ownership is
    -- deliberately NOT allowed in here (see 20261030160000).
    OR (
      has_role(auth.uid(), 'cs_admin'::app_role)
      AND status <> ALL (ARRAY[
        'paid'::text, 'partial_paid'::text, 'cancelled'::text,
        'job_done'::text, 'scammed'::text
      ])
    )

    -- Everyone else, and any role with no rule above: their own leads only.
    OR (
      NOT (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'processor'::app_role)
        OR has_role(auth.uid(), 'opr'::app_role)
        OR has_role(auth.uid(), 'opr_admin'::app_role)
        OR has_role(auth.uid(), 'cs_admin'::app_role)
      )
      AND public.leads_owned_by_caller(leads.*)
    )
);

-- =============================================================================
-- ROLLBACK - run manually to undo this migration.
--
--   DROP POLICY IF EXISTS "Lead visibility by role" ON public.leads;
--
--   CREATE POLICY "Lead visibility by role"
--     ON public.leads FOR SELECT TO authenticated
--   USING (
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
--       AND status <> ALL (ARRAY['paid'::text,'partial_paid'::text,'cancelled'::text,'job_done'::text,'scammed'::text])
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
--   );
--
-- This migration alters no lead row, so the rollback above is complete.
-- =============================================================================
