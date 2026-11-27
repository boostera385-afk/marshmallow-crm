-- ISOLATED ONLY: synthetic fixtures are created by test-lead-tech-contacts-db.mjs.
BEGIN;
CREATE TEMP TABLE checks(name text, result text);
GRANT SELECT, INSERT ON checks TO authenticated;
CREATE FUNCTION pg_temp.check(n text, ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO checks VALUES (n, CASE WHEN coalesce(ok, false) THEN 'PASS' ELSE 'FAIL' END);
$$;

-- Backfill and parsing
SELECT pg_temp.check('backfill: two techs from processor notes only',
  (SELECT count(*) FROM public.lead_tech_contacts WHERE lead_id='a1000000-0000-4000-8000-000000000001') = 2);
SELECT pg_temp.check('parse: name and 10-digit phone key',
  (SELECT name='Michael' AND phone='(305) 555-0123' AND phone_key='3055550123' FROM public.lead_tech_contacts WHERE tech_number=1));
SELECT pg_temp.check('parse: +1 number becomes 10-digit key',
  (SELECT name='David' AND phone_key='4075550199' FROM public.lead_tech_contacts WHERE tech_number=2));
SELECT pg_temp.check('new techs start not texted with no verdict',
  (SELECT bool_and(state='not_texted' AND verdict IS NULL) FROM public.lead_tech_contacts));

-- Live: add Tech 3 on lead B, then edit and delete notes
INSERT INTO public.lead_notes (lead_id, note_type, content) VALUES
  ('b1000000-0000-4000-8000-000000000002', 'processor', 'tech 3 - Sam - 2145550100');
SELECT pg_temp.check('insert trigger adds a tech (lowercase, dash form)',
  (SELECT name='Sam' AND phone_key='2145550100' FROM public.lead_tech_contacts WHERE lead_id='b1000000-0000-4000-8000-000000000002' AND tech_number=3));

-- Permissions on the state RPC
SET LOCAL ROLE authenticated;
DO $$
DECLARE caller record; ok boolean; n integer;
BEGIN
  FOR caller IN SELECT * FROM public.user_roles LOOP
    PERFORM set_config('request.jwt.claim.sub', caller.user_id::text, true);
    BEGIN
      PERFORM public.set_lead_tech_contact_state('b1000000-0000-4000-8000-000000000002', 3, 'texted');
      ok := true;
    EXCEPTION WHEN insufficient_privilege THEN ok := false;
    END;
    INSERT INTO checks VALUES (caller.role || ' can set tech state',
      CASE WHEN ok = (caller.role::text IN ('admin','processor')) THEN 'PASS' ELSE 'FAIL' END);
    SELECT count(*) INTO n FROM public.lead_tech_contacts;
    INSERT INTO checks VALUES (caller.role || ' tech rows visibility',
      CASE WHEN (n > 0) = (caller.role::text IN ('admin','processor')) THEN 'PASS' ELSE 'FAIL' END);
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
  BEGIN
    UPDATE public.lead_tech_contacts SET verdict='agreed';
    INSERT INTO checks VALUES ('processor cannot write verdict directly', 'FAIL');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO checks VALUES ('processor cannot write verdict directly', 'PASS');
  END;
  BEGIN
    PERFORM public.set_lead_tech_contact_state('b1000000-0000-4000-8000-000000000002', 99, 'texted');
    INSERT INTO checks VALUES ('unknown tech number rejected', 'FAIL');
  EXCEPTION WHEN no_data_found THEN
    INSERT INTO checks VALUES ('unknown tech number rejected', 'PASS');
  END;
  BEGIN
    PERFORM public.set_lead_tech_contact_state('b1000000-0000-4000-8000-000000000002', 3, 'emailed');
    INSERT INTO checks VALUES ('unknown state rejected', 'FAIL');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO checks VALUES ('unknown state rejected', 'PASS');
  END;
END $$;
RESET ROLE;

SELECT pg_temp.check('texted: contacted_at set and verdict pending',
  (SELECT state='texted' AND contacted_at IS NOT NULL AND verdict='pending' FROM public.lead_tech_contacts WHERE tech_number=3));

-- AI writes a verdict (service role), then texted->called keeps the first contact time and verdict
UPDATE public.lead_tech_contacts SET verdict='agreed', verdict_reason='Confirmed the job', contacted_at='2026-11-02 09:00+00' WHERE tech_number=3;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
SELECT public.set_lead_tech_contact_state('b1000000-0000-4000-8000-000000000002', 3, 'called');
RESET ROLE;
SELECT pg_temp.check('called keeps the first contacted_at and the verdict',
  (SELECT state='called' AND contacted_at='2026-11-02 09:00+00' AND verdict='agreed' FROM public.lead_tech_contacts WHERE tech_number=3));

-- Editing the note's name keeps state; changing the phone resets the verdict
UPDATE public.lead_notes SET content='tech 3 - Samuel - 2145550100' WHERE lead_id='b1000000-0000-4000-8000-000000000002';
SELECT pg_temp.check('rename keeps state and verdict',
  (SELECT name='Samuel' AND state='called' AND verdict='agreed' FROM public.lead_tech_contacts WHERE tech_number=3));
UPDATE public.lead_notes SET content='tech 3 - Samuel - 2145550111' WHERE lead_id='b1000000-0000-4000-8000-000000000002';
SELECT pg_temp.check('new phone resets verdict to pending',
  (SELECT verdict='pending' AND verdict_reason IS NULL AND state='called' FROM public.lead_tech_contacts WHERE tech_number=3));

-- Back to not texted clears tracking
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
SELECT public.set_lead_tech_contact_state('b1000000-0000-4000-8000-000000000002', 3, 'not_texted');
RESET ROLE;
SELECT pg_temp.check('not texted clears contacted_at and verdict',
  (SELECT state='not_texted' AND contacted_at IS NULL AND verdict IS NULL FROM public.lead_tech_contacts WHERE tech_number=3));

DELETE FROM public.lead_notes WHERE lead_id='b1000000-0000-4000-8000-000000000002';
SELECT pg_temp.check('deleting the note removes the tech',
  NOT EXISTS (SELECT 1 FROM public.lead_tech_contacts WHERE lead_id='b1000000-0000-4000-8000-000000000002'));

-- A repeated tech number: the newest line wins
INSERT INTO public.lead_notes (lead_id, note_type, content, created_at) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'processor', 'Tech 1: Mike R - (305) 555-0123', '2026-11-03 10:00+00');
SELECT pg_temp.check('repeated number: newest line wins, still two techs',
  (SELECT name FROM public.lead_tech_contacts WHERE lead_id='a1000000-0000-4000-8000-000000000001' AND tech_number=1) = 'Mike R'
  AND (SELECT count(*) FROM public.lead_tech_contacts WHERE lead_id='a1000000-0000-4000-8000-000000000001') = 2);

-- Note words set the state (20261127065829)
INSERT INTO public.lead_notes (lead_id, note_type, content, created_at) VALUES
  ('b1000000-0000-4000-8000-000000000002', 'processor', 'Tech 4: Ana - 3055550144 - texted', '2026-11-04 10:00+00'),
  ('b1000000-0000-4000-8000-000000000002', 'processor', 'Tech 5: Bo - 3055550155 - not-texted', '2026-11-04 10:01+00'),
  ('b1000000-0000-4000-8000-000000000002', 'processor', 'Tech 6: Cy - 3055550166 - called, no answer', '2026-11-04 10:02+00'),
  ('b1000000-0000-4000-8000-000000000002', 'processor', 'Tech 7: Di - 3055550177 - ooa', '2026-11-04 10:03+00');
SELECT pg_temp.check('note "texted" starts tracking at the note time',
  (SELECT state='texted' AND state_source='note' AND contacted_at='2026-11-04 10:00+00' AND verdict='pending'
     FROM public.lead_tech_contacts WHERE lead_id='b1000000-0000-4000-8000-000000000002' AND tech_number=4));
SELECT pg_temp.check('note "not-texted" stays not texted',
  (SELECT state='not_texted' AND contacted_at IS NULL FROM public.lead_tech_contacts WHERE lead_id='b1000000-0000-4000-8000-000000000002' AND tech_number=5));
SELECT pg_temp.check('note "called, no answer" is called',
  (SELECT state='called' FROM public.lead_tech_contacts WHERE lead_id='b1000000-0000-4000-8000-000000000002' AND tech_number=6));
SELECT pg_temp.check('remark is stored for the AI ("ooa"), no state from it',
  (SELECT processor_note='ooa' AND state='not_texted' FROM public.lead_tech_contacts WHERE lead_id='b1000000-0000-4000-8000-000000000002' AND tech_number=7));
SELECT pg_temp.check('remark excludes name and phone',
  (SELECT processor_note='called, no answer' FROM public.lead_tech_contacts WHERE lead_id='b1000000-0000-4000-8000-000000000002' AND tech_number=6));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
SELECT public.set_lead_tech_contact_state('b1000000-0000-4000-8000-000000000002', 4, 'not_texted');
RESET ROLE;
INSERT INTO public.lead_notes (lead_id, note_type, content, created_at) VALUES
  ('b1000000-0000-4000-8000-000000000002', 'processor', 'Tech 8: Ed - 3055550188', '2026-11-04 11:00+00');
SELECT pg_temp.check('a manual change newer than the note survives a re-sync',
  (SELECT state='not_texted' AND state_source='manual' FROM public.lead_tech_contacts WHERE lead_id='b1000000-0000-4000-8000-000000000002' AND tech_number=4));
UPDATE public.lead_notes SET content='Tech 4: Ana - 3055550144 - texted again', edited_at=now() + interval '1 minute'
 WHERE content='Tech 4: Ana - 3055550144 - texted';
SELECT pg_temp.check('editing the line later makes the note win again',
  (SELECT state='texted' AND state_source='note' FROM public.lead_tech_contacts WHERE lead_id='b1000000-0000-4000-8000-000000000002' AND tech_number=4));

UPDATE public.lead_tech_contacts SET verdict='declined', verdict_checked_at=now() WHERE tech_number=6 AND lead_id='b1000000-0000-4000-8000-000000000002';
UPDATE public.lead_notes SET content='Tech 6: Cy - 3055550166 - called, he can do 2pm $300', edited_at=now() + interval '2 minutes'
 WHERE content='Tech 6: Cy - 3055550166 - called, no answer';
SELECT pg_temp.check('a changed remark sends the tech back to the AI, keeping the verdict meanwhile',
  (SELECT verdict='declined' AND verdict_checked_at IS NULL AND processor_note='called, he can do 2pm $300'
     FROM public.lead_tech_contacts WHERE lead_id='b1000000-0000-4000-8000-000000000002' AND tech_number=6));

SELECT name, result FROM checks ORDER BY name;
ROLLBACK;
