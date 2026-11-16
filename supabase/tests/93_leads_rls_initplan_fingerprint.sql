-- =============================================================================
-- Read-only harness: exact lead / note visibility fingerprint per role
--   (for supabase/migrations/20261227000000_leads_rls_initplan_role_checks.sql;
--    complements 40_leads_rls_baseline.sql, whose counts could hide a swap)
--
-- HOW TO RUN
--   Run as `postgres` BEFORE and AFTER an RLS change; the grids must match cell
--   for cell. Only a temp table is written; the script ends in ROLLBACK.
--   Same fixture users as 40_leads_rls_baseline.sql (opr_admin has no account).
--   visible_ids_md5 / notes_md5 are md5 of every visible id in id order, so any
--   lead or note gained or lost changes the hash.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _fp (ord int, role_name text, leads_visible bigint, visible_ids_md5 text,
                       notes_visible bigint, notes_md5 text, cs_notes bigint) ON COMMIT DROP;
GRANT ALL ON _fp TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.capture(p_ord int, p_role text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _fp
  SELECT p_ord, p_role,
         (SELECT count(*) FROM public.leads),
         (SELECT md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM public.leads),
         (SELECT count(*) FROM public.lead_notes),
         (SELECT md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM public.lead_notes),
         (SELECT count(*) FROM public.lead_notes WHERE note_type = 'cs');
END $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END $$;

SELECT pg_temp.act_as('9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203'); SET LOCAL ROLE authenticated;
SELECT pg_temp.capture(1, 'admin'); RESET ROLE;
SELECT pg_temp.act_as('5c5aa71f-d441-44ce-ba50-2ccb63ac486f'); SET LOCAL ROLE authenticated;
SELECT pg_temp.capture(2, 'cs_admin'); RESET ROLE;
SELECT pg_temp.act_as('e25b3e94-6559-471a-92ea-f209effa5f02'); SET LOCAL ROLE authenticated;
SELECT pg_temp.capture(3, 'customer_service'); RESET ROLE;
SELECT pg_temp.act_as('2f22e9df-1b94-4653-bf50-36a965d5dec4'); SET LOCAL ROLE authenticated;
SELECT pg_temp.capture(4, 'processor'); RESET ROLE;
SELECT pg_temp.act_as('7c3ac25f-7106-4bf1-b367-1277cc5c3872'); SET LOCAL ROLE authenticated;
SELECT pg_temp.capture(5, 'opr'); RESET ROLE;
SELECT pg_temp.act_as('0071cf5f-1eec-4ad6-abf7-82e16fee76b1'); SET LOCAL ROLE authenticated;
SELECT pg_temp.capture(6, 'opr_admin (no account)'); RESET ROLE;
-- Signed-in user with no role at all: must see only leads they own (none here).
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000ff'); SET LOCAL ROLE authenticated;
SELECT pg_temp.capture(7, 'no role'); RESET ROLE;

SELECT * FROM _fp ORDER BY ord;

ROLLBACK;
