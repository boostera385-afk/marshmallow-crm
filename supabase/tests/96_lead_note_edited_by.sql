-- =============================================================================
-- Manual harness: who edited a lead note
--   (supabase/migrations/20261223000000_lead_note_edited_by.sql,
--    needs 20261220000000_processor_notes_edit_grant.sql too)
--
-- HOW TO RUN
--   After applying the migration, paste the whole file into the SQL Editor and
--   run it as `postgres`. It writes only synthetic rows inside one transaction.
--   Prefer a local/branch database; on the shared project run it only with
--   explicit approval (it inserts, then rolls back).
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

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

-- Synthetic identities: e1 author processor, e2 granted processor
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'ne-author@example.invalid'),
  ('00000000-0000-4000-8000-0000000000e2', 'ne-editor@example.invalid');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'processor'),
  ('00000000-0000-4000-8000-0000000000e2', 'processor');
UPDATE public.profiles SET full_name = 'Harness Author' WHERE id = '00000000-0000-4000-8000-0000000000e1';
UPDATE public.profiles SET full_name = 'Harness Editor', can_edit_processor_notes = true
 WHERE id = '00000000-0000-4000-8000-0000000000e2';

INSERT INTO public.leads (id, job_id, status, customer_name, customer_phone, service_type, created_by)
VALUES ('00000000-0000-4000-8000-0000000000f1', 'NE-HARNESS-1', 'waiting_complete_details', 'Synthetic', '5550100000', 'Plumbing',
        '00000000-0000-4000-8000-0000000000e1');

-- 1. Schema --------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) = 3 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lead_notes'
      AND column_name IN ('edited_by', 'edited_by_name', 'edited_at')),
  'lead_notes has edited_by, edited_by_name, edited_at');

-- 2. Behaviour -----------------------------------------------------------------
SET LOCAL ROLE authenticated;

-- The author inserts a note and tries to pre-fill the edited fields.
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000e1');
INSERT INTO public.lead_notes (id, lead_id, user_id, note_type, content, edited_by, edited_by_name, edited_at)
VALUES ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1',
        '00000000-0000-4000-8000-0000000000e1', 'processor', 'Tech 1: original',
        '00000000-0000-4000-8000-0000000000e2', 'Forged', now());
SELECT pg_temp.assert(
  (SELECT edited_by IS NULL AND edited_by_name IS NULL AND edited_at IS NULL
     FROM public.lead_notes WHERE id = '00000000-0000-4000-8000-0000000000d1'),
  'a new note cannot be created as already edited');

-- The granted processor edits the text: stamped with the editor, not the author.
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000e2');
UPDATE public.lead_notes SET content = 'Tech 1: corrected', edited_by_name = 'Someone else'
 WHERE id = '00000000-0000-4000-8000-0000000000d1';
SELECT pg_temp.assert(
  (SELECT edited_by = '00000000-0000-4000-8000-0000000000e2'
          AND edited_by_name = 'Harness Editor'
          AND edited_at IS NOT NULL
          AND user_id = '00000000-0000-4000-8000-0000000000e1'
     FROM public.lead_notes WHERE id = '00000000-0000-4000-8000-0000000000d1'),
  'editing another processor''s note records the editor''s name; the author stays');

-- The author tries to rewrite only the stamp (no text change): kept as it was.
SELECT pg_temp.act_as('00000000-0000-4000-8000-0000000000e1');
UPDATE public.lead_notes SET edited_by = NULL, edited_by_name = NULL, edited_at = NULL
 WHERE id = '00000000-0000-4000-8000-0000000000d1';
SELECT pg_temp.assert(
  (SELECT edited_by = '00000000-0000-4000-8000-0000000000e2' AND edited_by_name = 'Harness Editor'
     FROM public.lead_notes WHERE id = '00000000-0000-4000-8000-0000000000d1'),
  'the edited stamp cannot be cleared or forged without editing the text');

-- The author edits the text again: the stamp now names the author.
UPDATE public.lead_notes SET content = 'Tech 1: author again'
 WHERE id = '00000000-0000-4000-8000-0000000000d1';
SELECT pg_temp.assert(
  (SELECT edited_by = '00000000-0000-4000-8000-0000000000e1' AND edited_by_name = 'Harness Author'
     FROM public.lead_notes WHERE id = '00000000-0000-4000-8000-0000000000d1'),
  'the latest editor is shown after each text edit');

RESET ROLE;

DO $$
DECLARE v_report text;
BEGIN
  SELECT string_agg(CASE WHEN ok THEN 'PASS: ' ELSE 'FAIL: ' END || label, E'\n' ORDER BY ok, label)
    INTO v_report FROM _checks;
  RAISE EXCEPTION E'HARNESS REPORT (rolled back)\n%', v_report;
END;
$$;

ROLLBACK;
