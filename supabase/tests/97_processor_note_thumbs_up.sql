-- =============================================================================
-- Manual harness: Processor note thumbs-up
--   (supabase/migrations/20261228000000_processor_note_thumbs_up.sql)
--
-- HOW TO RUN
--   After applying the migration, paste the whole file into the SQL Editor and
--   run it as `postgres`. It writes only synthetic rows inside one transaction
--   and ROLLBACKs at the end. Prefer a local/branch database; on the shared
--   project run it only with explicit approval (it inserts, then rolls back).
--
-- OUTPUT
--   The script ends by raising "HARNESS REPORT (rolled back)" listing every
--   check as PASS/FAIL; that error is expected and guarantees the rollback.
--   Any FAIL line is a defect.
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

INSERT INTO public.leads (id, job_id, status, customer_name, customer_phone, service_type, created_by)
VALUES
  ('00000000-0000-4000-8000-0000000000b1', 'PN-HARNESS-1', 'waiting_complete_details', 'Synthetic', '5550100000', 'Plumbing',
   '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2', 'PN-HARNESS-2', 'waiting_complete_details', 'Synthetic', '5550100000', 'Plumbing',
   '00000000-0000-4000-8000-0000000000a1');

INSERT INTO public.lead_notes (id, lead_id, user_id, note_type, content) VALUES
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000a1', 'processor', 'Tech 1: original'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000a1', 'cs', 'CS original');

-- 1. Schema --------------------------------------------------------------------
SELECT pg_temp.assert(EXISTS (SELECT 1 FROM pg_class WHERE relname='lead_note_reactions' AND relrowsecurity),
  'lead_note_reactions exists with RLS on');
SELECT pg_temp.assert(NOT has_table_privilege('anon', 'public.lead_note_reactions', 'SELECT'),
  'anon has no access');

-- 2. Behaviour -----------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000a2');
SELECT pg_temp.try_update($q$INSERT INTO public.lead_note_reactions (note_id, user_id)
  VALUES ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a2')$q$, true,
  'processor CAN thumbs-up a colleague''s processor note');
SELECT pg_temp.try_update($q$INSERT INTO public.lead_note_reactions (note_id, user_id)
  VALUES ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a2')$q$, false,
  'a second thumbs-up from the same user is rejected (one per user)');
SELECT pg_temp.try_update($q$INSERT INTO public.lead_note_reactions (note_id, user_id)
  VALUES ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a3')$q$, false,
  'processor CANNOT react on behalf of someone else');
SELECT pg_temp.try_update($q$INSERT INTO public.lead_note_reactions (note_id, user_id)
  VALUES ('00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000a2')$q$, false,
  'processor CANNOT react to a CS-thread note');

-- another processor sees it and cannot remove it
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000a3');
SELECT pg_temp.assert((SELECT count(*) = 1 FROM public.lead_note_reactions
  WHERE note_id='00000000-0000-4000-8000-0000000000c1'), 'other processors can see the thumbs-up');
SELECT pg_temp.try_update($q$DELETE FROM public.lead_note_reactions
  WHERE user_id='00000000-0000-4000-8000-0000000000a2'$q$, false,
  'processor CANNOT remove someone else''s thumbs-up');

-- author cannot react to their own note
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000a1');
SELECT pg_temp.try_update($q$INSERT INTO public.lead_note_reactions (note_id, user_id)
  VALUES ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a1')$q$, false,
  'author CANNOT thumbs-up their own note');

-- customer_service sees and writes nothing
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000a4');
SELECT pg_temp.assert((SELECT count(*) = 0 FROM public.lead_note_reactions), 'customer_service sees no reactions');
SELECT pg_temp.try_update($q$INSERT INTO public.lead_note_reactions (note_id, user_id)
  VALUES ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000a4')$q$, false,
  'customer_service CANNOT react');

-- owner can remove their own
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000a2');
SELECT pg_temp.try_update($q$DELETE FROM public.lead_note_reactions
  WHERE user_id='00000000-0000-4000-8000-0000000000a2'$q$, true,
  'processor CAN remove their own thumbs-up');

RESET ROLE;
SELECT pg_temp.assert((SELECT content = 'Tech 1: original' AND edited_at IS NULL
  FROM public.lead_notes WHERE id='00000000-0000-4000-8000-0000000000c1'),
  'reacting does not modify the note or stamp "Edited by"');

DO $$
DECLARE v_report text;
BEGIN
  SELECT string_agg(CASE WHEN ok THEN 'PASS: ' ELSE 'FAIL: ' END || label, E'
' ORDER BY ok, label)
    INTO v_report FROM _checks;
  RAISE EXCEPTION E'HARNESS REPORT (rolled back)
%', v_report;
END;
$$;

ROLLBACK;
