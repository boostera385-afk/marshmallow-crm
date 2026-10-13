-- =============================================================================
-- Manual harness: leads RLS visibility baseline
--
-- PURPOSE
--   public.leads currently has THREE permissive SELECT policies, OR-ed together:
--     - "Scoped lead access"          (CASE on role; restricts cs_admin)
--     - "Users can view accessible leads"
--     - "OPR admins can view leads"
--   Two of them grant a processor identical unrestricted access, so every row is
--   evaluated against both, and has_role() is SECURITY DEFINER so PostgreSQL
--   cannot inline it.
--
--   This harness changes nothing. It captures, for one real user of every role,
--   exactly which leads that user can see. Run it now to record the baseline,
--   and again after any consolidation. The two "matrix" grids must match cell
--   for cell - that is the proof an access-control change was safe.
--
-- HOW TO RUN
--   Paste into the Supabase SQL Editor and run as `postgres`.
--   Nothing persists: the file opens a transaction and ROLLBACKs at the end.
--
--   Read the LAST result grid, "matrix". Save it before any change, then diff.
--
-- One real user per role:
--   admin             ibraheem@gmail.com
--   cs_admin          csadminleadcrm@accboosters.com
--   customer_service  HassanCS@gmail.com
--   processor         IrfanSC@gmail.com
--   opr               RehanOPR112@gmail.com
--   opr_admin         FaiqOperator@gmail.com
--
-- Note: SET LOCAL ROLE cannot be issued inside a plpgsql block, so each role is
-- a separate top-level section. The results table is created while already
-- switched to `authenticated` so it owns it - GRANT ... ON SCHEMA pg_temp
-- fails with 3F000.
-- =============================================================================

BEGIN;


-- ===========================================================================
-- 1. admin - expect to see everything
-- ===========================================================================
SELECT set_config('request.jwt.claims', json_build_object(
  'sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203','role','authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub',  '9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE _matrix (
  ord int, role_name text, email text,
  visible bigint, mine bigint, assigned bigint, shared bigint,
  s_paid bigint, s_partial bigint, s_jobdone bigint, s_cancelled bigint,
  s_scammed bigint, s_urgent bigint
) ON COMMIT DROP;

DO $$
DECLARE u uuid := '9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203';
BEGIN
  INSERT INTO _matrix SELECT 1, 'admin', 'ibraheem@gmail.com',
    (SELECT count(*) FROM public.leads),
    (SELECT count(*) FROM public.leads WHERE created_by = u),
    (SELECT count(*) FROM public.leads WHERE assigned_cs = u),
    (SELECT count(*) FROM public.leads WHERE id IN
       (SELECT lead_id FROM public.lead_shares WHERE shared_with_user_id = u)),
    (SELECT count(*) FROM public.leads WHERE status='paid'),
    (SELECT count(*) FROM public.leads WHERE status='partial_paid'),
    (SELECT count(*) FROM public.leads WHERE status='job_done'),
    (SELECT count(*) FROM public.leads WHERE status='cancelled'),
    (SELECT count(*) FROM public.leads WHERE status='scammed'),
    (SELECT count(*) FROM public.leads WHERE status='urgent_job');
END $$;

RESET ROLE;


-- ===========================================================================
-- 2. cs_admin - expect everything EXCEPT paid/partial_paid/cancelled/
--    job_done/scammed (the CS_ADMIN_HIDDEN_STATUSES clause)
-- ===========================================================================
SELECT set_config('request.jwt.claims', json_build_object(
  'sub','5c5aa71f-d441-44ce-ba50-2ccb63ac486f','role','authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub',  '5c5aa71f-d441-44ce-ba50-2ccb63ac486f', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE u uuid := '5c5aa71f-d441-44ce-ba50-2ccb63ac486f';
BEGIN
  INSERT INTO _matrix SELECT 2, 'cs_admin', 'csadminleadcrm@accboosters.com',
    (SELECT count(*) FROM public.leads),
    (SELECT count(*) FROM public.leads WHERE created_by = u),
    (SELECT count(*) FROM public.leads WHERE assigned_cs = u),
    (SELECT count(*) FROM public.leads WHERE id IN
       (SELECT lead_id FROM public.lead_shares WHERE shared_with_user_id = u)),
    (SELECT count(*) FROM public.leads WHERE status='paid'),
    (SELECT count(*) FROM public.leads WHERE status='partial_paid'),
    (SELECT count(*) FROM public.leads WHERE status='job_done'),
    (SELECT count(*) FROM public.leads WHERE status='cancelled'),
    (SELECT count(*) FROM public.leads WHERE status='scammed'),
    (SELECT count(*) FROM public.leads WHERE status='urgent_job');
END $$;

RESET ROLE;


-- ===========================================================================
-- 3. customer_service - expect only own + assigned + shared, never scammed
-- ===========================================================================
SELECT set_config('request.jwt.claims', json_build_object(
  'sub','e25b3e94-6559-471a-92ea-f209effa5f02','role','authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub',  'e25b3e94-6559-471a-92ea-f209effa5f02', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE u uuid := 'e25b3e94-6559-471a-92ea-f209effa5f02';
BEGIN
  INSERT INTO _matrix SELECT 3, 'customer_service', 'HassanCS@gmail.com',
    (SELECT count(*) FROM public.leads),
    (SELECT count(*) FROM public.leads WHERE created_by = u),
    (SELECT count(*) FROM public.leads WHERE assigned_cs = u),
    (SELECT count(*) FROM public.leads WHERE id IN
       (SELECT lead_id FROM public.lead_shares WHERE shared_with_user_id = u)),
    (SELECT count(*) FROM public.leads WHERE status='paid'),
    (SELECT count(*) FROM public.leads WHERE status='partial_paid'),
    (SELECT count(*) FROM public.leads WHERE status='job_done'),
    (SELECT count(*) FROM public.leads WHERE status='cancelled'),
    (SELECT count(*) FROM public.leads WHERE status='scammed'),
    (SELECT count(*) FROM public.leads WHERE status='urgent_job');
END $$;

RESET ROLE;


-- ===========================================================================
-- 4. processor - expect to see everything
-- ===========================================================================
SELECT set_config('request.jwt.claims', json_build_object(
  'sub','eb18f72a-92f5-405b-83ac-a9192cca1d78','role','authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub',  'eb18f72a-92f5-405b-83ac-a9192cca1d78', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE u uuid := 'eb18f72a-92f5-405b-83ac-a9192cca1d78';
BEGIN
  INSERT INTO _matrix SELECT 4, 'processor', 'IrfanSC@gmail.com',
    (SELECT count(*) FROM public.leads),
    (SELECT count(*) FROM public.leads WHERE created_by = u),
    (SELECT count(*) FROM public.leads WHERE assigned_cs = u),
    (SELECT count(*) FROM public.leads WHERE id IN
       (SELECT lead_id FROM public.lead_shares WHERE shared_with_user_id = u)),
    (SELECT count(*) FROM public.leads WHERE status='paid'),
    (SELECT count(*) FROM public.leads WHERE status='partial_paid'),
    (SELECT count(*) FROM public.leads WHERE status='job_done'),
    (SELECT count(*) FROM public.leads WHERE status='cancelled'),
    (SELECT count(*) FROM public.leads WHERE status='scammed'),
    (SELECT count(*) FROM public.leads WHERE status='urgent_job');
END $$;

RESET ROLE;


-- ===========================================================================
-- 5. opr - expect urgent_job only
-- ===========================================================================
SELECT set_config('request.jwt.claims', json_build_object(
  'sub','7c3ac25f-7106-4bf1-b367-1277cc5c3872','role','authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub',  '7c3ac25f-7106-4bf1-b367-1277cc5c3872', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE u uuid := '7c3ac25f-7106-4bf1-b367-1277cc5c3872';
BEGIN
  INSERT INTO _matrix SELECT 5, 'opr', 'RehanOPR112@gmail.com',
    (SELECT count(*) FROM public.leads),
    (SELECT count(*) FROM public.leads WHERE created_by = u),
    (SELECT count(*) FROM public.leads WHERE assigned_cs = u),
    (SELECT count(*) FROM public.leads WHERE id IN
       (SELECT lead_id FROM public.lead_shares WHERE shared_with_user_id = u)),
    (SELECT count(*) FROM public.leads WHERE status='paid'),
    (SELECT count(*) FROM public.leads WHERE status='partial_paid'),
    (SELECT count(*) FROM public.leads WHERE status='job_done'),
    (SELECT count(*) FROM public.leads WHERE status='cancelled'),
    (SELECT count(*) FROM public.leads WHERE status='scammed'),
    (SELECT count(*) FROM public.leads WHERE status='urgent_job');
END $$;

RESET ROLE;


-- ===========================================================================
-- 6. opr_admin - expect urgent_job only
-- ===========================================================================
SELECT set_config('request.jwt.claims', json_build_object(
  'sub','0071cf5f-1eec-4ad6-abf7-82e16fee76b1','role','authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub',  '0071cf5f-1eec-4ad6-abf7-82e16fee76b1', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE u uuid := '0071cf5f-1eec-4ad6-abf7-82e16fee76b1';
BEGIN
  INSERT INTO _matrix SELECT 6, 'opr_admin', 'FaiqOperator@gmail.com',
    (SELECT count(*) FROM public.leads),
    (SELECT count(*) FROM public.leads WHERE created_by = u),
    (SELECT count(*) FROM public.leads WHERE assigned_cs = u),
    (SELECT count(*) FROM public.leads WHERE id IN
       (SELECT lead_id FROM public.lead_shares WHERE shared_with_user_id = u)),
    (SELECT count(*) FROM public.leads WHERE status='paid'),
    (SELECT count(*) FROM public.leads WHERE status='partial_paid'),
    (SELECT count(*) FROM public.leads WHERE status='job_done'),
    (SELECT count(*) FROM public.leads WHERE status='cancelled'),
    (SELECT count(*) FROM public.leads WHERE status='scammed'),
    (SELECT count(*) FROM public.leads WHERE status='urgent_job');
END $$;

RESET ROLE;


-- ===========================================================================
-- matrix - this grid is the baseline. Save it.
-- ===========================================================================
-- Sanity: the three SELECT policies that are the subject of this baseline.
SELECT policyname, cmd, array_to_string(roles, ',') AS roles
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'leads' AND cmd = 'SELECT'
  ORDER BY policyname;

-- Keep the matrix last: MCP exposes only the final result grid. This changes
-- output ordering only; all existing role/count checks remain identical.
SELECT * FROM _matrix ORDER BY ord;

ROLLBACK;
