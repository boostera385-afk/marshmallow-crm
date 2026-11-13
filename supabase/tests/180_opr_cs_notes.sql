-- ISOLATED ONLY: synthetic fixtures are created by test-opr-cs-notes-db.mjs.
BEGIN;
CREATE TEMP TABLE checks(name text, result text);
GRANT SELECT, INSERT ON checks TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE caller record; n integer;
BEGIN
  FOR caller IN SELECT * FROM public.user_roles LOOP
    PERFORM set_config('request.jwt.claim.sub', caller.user_id::text, true);
    SELECT count(*) INTO n FROM public.lead_notes WHERE note_type='cs';
    INSERT INTO checks VALUES (caller.role || ' CS thread visibility', CASE WHEN n=CASE WHEN caller.role='opr' THEN 0 ELSE 1 END THEN 'PASS' ELSE 'FAIL' END);
    SELECT count(*) INTO n FROM public.lead_notes WHERE note_type IN ('opr','general');
    INSERT INTO checks VALUES (caller.role || ' other threads unchanged', CASE WHEN n=2 THEN 'PASS' ELSE 'FAIL' END);
    SELECT count(*) INTO n FROM public.lead_notes WHERE id=4;
    INSERT INTO checks VALUES (caller.role || ' out-of-scope notes stay hidden', CASE WHEN n=0 THEN 'PASS' ELSE 'FAIL' END);
  END LOOP;
END $$;
RESET ROLE;
SELECT name,result FROM checks ORDER BY name;
ROLLBACK;
