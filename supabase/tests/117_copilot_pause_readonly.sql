-- Production-safe permission/configuration reads only; no customer queries,
-- durable writes, configuration RPCs or AI requests. Temp/session state rolls back.
BEGIN;
CREATE TEMP TABLE _pause_users ON COMMIT DROP AS
SELECT DISTINCT ON (role) user_id,role FROM (
  SELECT DISTINCT ON (user_id) user_id,role FROM public.user_roles
  ORDER BY user_id,(role::text='admin') DESC,role::text
) callers ORDER BY role,user_id;
CREATE TEMP TABLE _pause_smoke(name text,result text) ON COMMIT DROP;
GRANT SELECT ON _pause_users TO authenticated;
GRANT ALL ON _pause_smoke TO authenticated;
INSERT INTO _pause_smoke SELECT 'All six roles represented',CASE WHEN count(*)=6 THEN 'PASS' ELSE 'FAIL' END FROM _pause_users;
INSERT INTO _pause_smoke SELECT 'Global and AI disabled',CASE WHEN count(*)=1 AND bool_and(NOT enabled AND NOT ai_enabled) THEN 'PASS' ELSE 'FAIL' END FROM public.copilot_config;
INSERT INTO _pause_smoke SELECT 'Release constraint installed and validated',CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END
FROM pg_catalog.pg_constraint WHERE conrelid='public.copilot_config'::regclass AND conname='copilot_release_paused' AND convalidated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE u record; a jsonb;
BEGIN
  FOR u IN SELECT user_id,role FROM _pause_users LOOP
    PERFORM set_config('request.jwt.claim.sub',u.user_id::text,true);
    PERFORM set_config('request.jwt.claims',json_build_object('sub',u.user_id,'role','authenticated')::text,true);
    a:=public.copilot_get_access();
    INSERT INTO _pause_smoke VALUES(u.role::text||' has no Copilot or AI access',
      CASE WHEN a->>'role'=u.role::text AND NOT (a->>'allowed')::boolean
        AND NOT (a->>'aiEnabled')::boolean AND a->'sections'='[]'::jsonb THEN 'PASS' ELSE 'FAIL' END);
  END LOOP;
END; $$;
RESET ROLE;
SELECT * FROM _pause_smoke ORDER BY name;
ROLLBACK;
