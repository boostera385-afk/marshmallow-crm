-- Production-safe: reads permission metadata only. No customer queries, grants,
-- durable writes or AI/provider requests. Temp result rows/session settings roll back.
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE _feature_smoke(name text,result text) ON COMMIT DROP;
DO $$
DECLARE u record; a jsonb; board boolean; updates boolean; granted boolean;
BEGIN
 FOR u IN SELECT user_id,role FROM (VALUES
  ('9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203','admin'),
  ('eb18f72a-92f5-405b-83ac-a9192cca1d78','processor'),
  ('e25b3e94-6559-471a-92ea-f209effa5f02','customer_service'),
  ('5c5aa71f-d441-44ce-ba50-2ccb63ac486f','cs_admin'),
  ('7c3ac25f-7106-4bf1-b367-1277cc5c3872','opr'),
  ('0071cf5f-1eec-4ad6-abf7-82e16fee76b1','opr_admin')) v(user_id,role) LOOP
  PERFORM set_config('request.jwt.claim.sub',u.user_id,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',u.user_id,'role','authenticated')::text,true);
  a:=public.copilot_get_access();
  board:=u.role IN ('admin','processor');
  updates:=u.role IN ('admin','processor','customer_service','cs_admin');
  granted:=COALESCE((a->>'allowed')::boolean,false);
  INSERT INTO _feature_smoke VALUES
   (u.role||' existing role identity',CASE WHEN a->>'role'=u.role THEN 'PASS' ELSE 'FAIL' END),
   (u.role||' board gate and opt-in',CASE WHEN public.copilot_nav_allowed('processor_board')=board AND (a->'sections' ? 'processor_board')=(granted AND board) THEN 'PASS' ELSE 'FAIL' END),
   (u.role||' update gate and opt-in',CASE WHEN public.copilot_nav_allowed('cx_updates')=updates AND (a->'sections' ? 'cx_updates')=(granted AND updates) THEN 'PASS' ELSE 'FAIL' END),
   (u.role||' Quickchat follows independent grant',CASE WHEN (a->'sections' ? 'quick_chat')=(granted AND public.copilot_nav_allowed('quick_chat')) AND (a->'sections' ? 'tech_quick_chat')=(granted AND public.copilot_nav_allowed('tech_quick_chat')) THEN 'PASS' ELSE 'FAIL' END);
 END LOOP;
END; $$;
INSERT INTO _feature_smoke SELECT 'Caller RLS and fixed search paths',CASE WHEN count(*)=2 THEN 'PASS' ELSE 'FAIL' END
FROM pg_proc WHERE oid IN ('public.copilot_get_access()'::regprocedure,'public.copilot_nav_allowed(text)'::regprocedure)
AND NOT prosecdef AND proconfig @> ARRAY['search_path=""'];
INSERT INTO _feature_smoke SELECT 'No anonymous execution',CASE WHEN NOT has_function_privilege('anon','public.copilot_get_access()','EXECUTE') AND NOT has_function_privilege('anon','public.copilot_nav_allowed(text)','EXECUTE') THEN 'PASS' ELSE 'FAIL' END;
RESET ROLE;
SELECT * FROM _feature_smoke ORDER BY name;
ROLLBACK;
