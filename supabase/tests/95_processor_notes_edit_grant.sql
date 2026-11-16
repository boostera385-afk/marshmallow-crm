-- =============================================================================
-- Manual harness: Processor Notes edit grant
--   (supabase/migrations/20261220000000_processor_notes_edit_grant.sql)
--
-- HOW TO RUN
--   After applying the migration, paste the whole file into the SQL Editor and
--   run it as `postgres`. It writes only synthetic rows inside one transaction
--   and ROLLBACKs at the end. Prefer a local/branch database; on the shared
--   project run it only with explicit approval (it inserts, then rolls back).
--
-- OUTPUT
--   The final SELECT lists every check as PASS/FAIL. Any FAIL is a defect.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _checks (ok boolean NOT NULL, label text NOT NULL) ON COMMIT DROP;
GRANT ALL ON _checks TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _checks VALUES (COALESCE(p_ok, false), p_label);
END;
$$;

-- Tries an UPDATE as the current session and records whether it changed a row
-- (or raised). p_expect = true means the update must succeed.
CREATE OR REPLACE FUNCTION pg_temp.try_update(p_sql text, p_expect boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    n := 0;
  END;
  INSERT INTO _checks VALUES ((n > 0) = p_expect, p_label);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

-- Synthetic identities
--   a1 author processor   (writes the note)
--   a2 granted processor
--   a3 processor without the grant
--   a4 customer_service with the flag forced on (role must still deny)
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'pn-author@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'pn-granted@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a3', 'pn-plain@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a4', 'pn-cs@example.invalid');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'processor'),
  ('00000000-0000-4000-8000-0000000000a2', 'processor'),
  ('00000000-0000-4000-8000-0000000000a3', 'processor'),
  ('00000000-0000-4000-8000-0000000000a4', 'customer_service');
-- Running as postgres (auth.uid() NULL), so the privilege trigger allows this.
UPDATE public.profiles SET can_edit_processor_notes = true
 WHERE id IN ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a4');

INSERT INTO public.leads (id, job_id, status, customer_name, customer_phone, created_by)
VALUES
  ('00000000-0000-4000-8000-0000000000b1', 'PN-HARNESS-1', 'waiting_complete_details', 'Synthetic', '5550100000',
   '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2', 'PN-HARNESS-2', 'waiting_complete_details', 'Synthetic', '5550100000',
   '00000000-0000-4000-8000-0000000000a1');

INSERT INTO public.lead_notes (id, lead_id, user_id, note_type, content) VALUES
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000a1', 'processor', 'Tech 1: original'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000a1', 'cs', 'CS original');

-- 1. Schema --------------------------------------------------------------------
SELECT pg_temp.assert(EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='profiles'
    AND column_name='can_edit_processor_notes' AND column_default = 'false'),
  'profiles.can_edit_processor_notes exists, default false');
SELECT pg_temp.assert(EXISTS (SELECT 1 FROM pg_policies
  WHERE tablename='lead_notes' AND policyname='Granted processors can edit processor notes' AND cmd='UPDATE'),
  'grant UPDATE policy exists');
SELECT pg_temp.assert(NOT has_function_privilege('anon', 'public.can_edit_others_processor_notes()', 'EXECUTE'),
  'anon cannot execute can_edit_others_processor_notes()');

-- 2. Behaviour -----------------------------------------------------------------
SET LOCAL ROLE authenticated;

-- granted processor
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000a2');
SELECT pg_temp.try_update($q$UPDATE public.lead_notes SET content='Tech 1: edited by granted'
  WHERE id='00000000-0000-4000-8000-0000000000c1'$q$, true,
  'granted processor CAN edit another user''s processor note');
SELECT pg_temp.try_update($q$UPDATE public.lead_notes SET content='hijack'
  WHERE id='00000000-0000-4000-8000-0000000000c2'$q$, false,
  'granted processor CANNOT edit another user''s CS note');
SELECT pg_temp.try_update($q$UPDATE public.lead_notes SET user_id='00000000-0000-4000-8000-0000000000a2'
  WHERE id='00000000-0000-4000-8000-0000000000c1'$q$, false,
  'granted processor CANNOT reassign the note author');
SELECT pg_temp.try_update($q$UPDATE public.lead_notes SET lead_id='00000000-0000-4000-8000-0000000000b2'
  WHERE id='00000000-0000-4000-8000-0000000000c1'$q$, false,
  'granted processor CANNOT move the note to another lead');
SELECT pg_temp.try_update($q$UPDATE public.lead_notes SET note_type='general'
  WHERE id='00000000-0000-4000-8000-0000000000c1'$q$, false,
  'granted processor CANNOT move the note to another thread');
SELECT pg_temp.try_update($q$DELETE FROM public.lead_notes
  WHERE id='00000000-0000-4000-8000-0000000000c1'$q$, false,
  'granted processor CANNOT delete another user''s processor note');
SELECT pg_temp.try_update($q$UPDATE public.profiles SET can_edit_processor_notes=true
  WHERE id='00000000-0000-4000-8000-0000000000a3'$q$, false,
  'granted processor CANNOT grant the flag to someone else');

-- processor without the grant
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000a3');
SELECT pg_temp.try_update($q$UPDATE public.lead_notes SET content='no grant'
  WHERE id='00000000-0000-4000-8000-0000000000c1'$q$, false,
  'processor without grant CANNOT edit another user''s processor note');
SELECT pg_temp.try_update($q$UPDATE public.profiles SET can_edit_processor_notes=true
  WHERE id='00000000-0000-4000-8000-0000000000a3'$q$, false,
  'processor CANNOT self-grant the flag');

-- customer_service with the flag forced on: role still denies
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000a4');
SELECT pg_temp.try_update($q$UPDATE public.lead_notes SET content='cs edit'
  WHERE id='00000000-0000-4000-8000-0000000000c1'$q$, false,
  'customer_service with flag CANNOT edit processor notes');

-- author keeps their own edit path
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000a1');
SELECT pg_temp.try_update($q$UPDATE public.lead_notes SET content='Tech 1: author edit'
  WHERE id='00000000-0000-4000-8000-0000000000c1'$q$, true,
  'author CAN still edit their own processor note');

RESET ROLE;

SELECT pg_temp.assert(
  (SELECT user_id = '00000000-0000-4000-8000-0000000000a1'
          AND lead_id = '00000000-0000-4000-8000-0000000000b1'
          AND note_type = 'processor'
     FROM public.lead_notes WHERE id = '00000000-0000-4000-8000-0000000000c1'),
  'note authorship, lead and thread unchanged');
SELECT pg_temp.assert(
  (SELECT content = 'CS original' FROM public.lead_notes WHERE id = '00000000-0000-4000-8000-0000000000c2'),
  'CS note unchanged');

SELECT CASE WHEN ok THEN 'PASS: ' ELSE 'FAIL: ' END || label AS result FROM _checks ORDER BY ok, label;

ROLLBACK;
