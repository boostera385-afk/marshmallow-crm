-- WRITE-BASED: isolated fixtures/copilot.sql ONLY; never run on shared production.
-- Run after the pause migration. All attempted writes roll back.
BEGIN;
CREATE TEMP TABLE _pause_checks(name text,result text) ON COMMIT DROP;
GRANT ALL ON _pause_checks TO authenticated,service_role;
INSERT INTO _pause_checks SELECT 'Global and AI switches off',
  CASE WHEN NOT enabled AND NOT ai_enabled THEN 'PASS' ELSE 'FAIL' END
FROM public.copilot_config WHERE id;
SET LOCAL ROLE authenticated;
DO $$
DECLARE u record; a jsonb;
BEGIN
  FOR u IN SELECT user_id,role::text AS role FROM public.user_roles ORDER BY role LOOP
    PERFORM set_config('request.jwt.claim.sub',u.user_id::text,true);
    a:=public.copilot_get_access();
    INSERT INTO _pause_checks VALUES (u.role||' disabled despite saved grants',
      CASE WHEN NOT (a->>'allowed')::boolean AND NOT (a->>'aiEnabled')::boolean
        AND a->'sections'='[]'::jsonb THEN 'PASS' ELSE 'FAIL' END);
    BEGIN
      PERFORM public.copilot_search('leads','MM-101');
      INSERT INTO _pause_checks VALUES(u.role||' direct search denied','FAIL');
    EXCEPTION WHEN insufficient_privilege THEN
      INSERT INTO _pause_checks VALUES(u.role||' direct search denied','PASS');
    END;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',true);
  BEGIN
    PERFORM public.copilot_configure(true,false,1000,20,'America/New_York');
    INSERT INTO _pause_checks VALUES('Stale Admin configure cannot enable Copilot','FAIL');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _pause_checks VALUES('Stale Admin configure cannot enable Copilot','PASS');
  END;
  BEGIN
    UPDATE public.copilot_config SET ai_enabled=true WHERE id;
    INSERT INTO _pause_checks VALUES('Direct Admin update cannot enable AI','FAIL');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _pause_checks VALUES('Direct Admin update cannot enable AI','PASS');
  END;
END; $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM public.copilot_reserve_ai('9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',gen_random_uuid());
    INSERT INTO _pause_checks VALUES('Service budget reservation denied','FAIL');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _pause_checks VALUES('Service budget reservation denied','PASS');
  END;
END; $$;
RESET ROLE;
SELECT * FROM _pause_checks ORDER BY name;
ROLLBACK;
