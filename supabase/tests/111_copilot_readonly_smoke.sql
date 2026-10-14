-- Deployment smoke test: no persistent writes, no customer contents in output,
-- no AI requests, no permission changes. Run as postgres on the approved target.
-- Unlike 110_copilot.sql, this file does not require/load the synthetic fixture.
BEGIN;
CREATE TEMP TABLE _copilot_smoke(name text PRIMARY KEY,result text NOT NULL) ON COMMIT DROP;
GRANT SELECT,INSERT ON _copilot_smoke TO authenticated,anon;
CREATE TEMP TABLE _copilot_principals AS
SELECT DISTINCT ON (role) role::text AS role,user_id FROM public.user_roles ORDER BY role,user_id;
GRANT SELECT ON _copilot_principals TO authenticated;
-- Creating temporary result tables needs a read-write transaction setting;
-- after setup, prohibit every persistent write throughout all actual checks.
SET TRANSACTION READ ONLY;

INSERT INTO _copilot_smoke
SELECT 'Public Copilot tables have RLS',CASE WHEN count(*)=3 AND bool_and(relrowsecurity) THEN 'PASS' ELSE 'FAIL' END
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('copilot_config','copilot_role_permissions','copilot_user_permissions');
INSERT INTO _copilot_smoke
SELECT 'Anonymous cannot execute Copilot RPCs',CASE WHEN NOT bool_or(has_function_privilege('anon',p.oid,'EXECUTE')) THEN 'PASS' ELSE 'FAIL' END
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'copilot\_%' ESCAPE '\';
INSERT INTO _copilot_smoke
SELECT 'AI accounting is service-role only',CASE WHEN bool_and(
 NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE')) AND count(*)=2 THEN 'PASS' ELSE 'FAIL' END
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('copilot_reserve_ai','copilot_finish_ai');
INSERT INTO _copilot_smoke
SELECT 'Customer reads are SECURITY INVOKER',CASE WHEN count(*)=3 AND NOT bool_or(prosecdef) THEN 'PASS' ELSE 'FAIL' END
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('copilot_search','copilot_report','copilot_health');
INSERT INTO _copilot_smoke
SELECT 'All Copilot functions fix search_path',CASE WHEN bool_and(proconfig @> ARRAY['search_path=""']) THEN 'PASS' ELSE 'FAIL' END
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'copilot\_%' ESCAPE '\';
INSERT INTO _copilot_smoke VALUES ('Private AI ledger is inaccessible to browser roles',
 -- Schema USAGE is intentionally shared with the authenticated CX-update RPC.
 -- It is not table authorization. Test the ledger itself, including write grants,
 -- and actual denied SELECT actions below rather than revoking shared schema access.
 CASE WHEN NOT has_table_privilege('anon','marshmallow_private.copilot_usage','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 AND NOT has_table_privilege('authenticated','marshmallow_private.copilot_usage','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN 'PASS' ELSE 'FAIL' END);
INSERT INTO _copilot_smoke VALUES ('Installed defaults are Admin-only and AI off',CASE WHEN
 (SELECT enabled AND NOT ai_enabled AND timezone='America/New_York' AND monthly_budget_cents=1000 AND daily_ai_limit=20 FROM public.copilot_config WHERE id)
 AND (SELECT count(*)=6 AND bool_and(allowed=(role::text='admin')) FROM public.copilot_role_permissions)
 AND NOT EXISTS(SELECT 1 FROM public.copilot_user_permissions) THEN 'PASS' ELSE 'FAIL' END);

SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN PERFORM count(*) FROM marshmallow_private.copilot_usage;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 INSERT INTO _copilot_smoke VALUES('Authenticated ledger read action is denied',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
END; $$;
DO $$ DECLARE principal record; access_value jsonb; denied boolean; d date; report jsonb; BEGIN
 FOR principal IN SELECT * FROM _copilot_principals LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',principal.user_id,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',principal.user_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  access_value:=public.copilot_get_access();
  INSERT INTO _copilot_smoke VALUES(principal.role||': access matches default',CASE WHEN (access_value->>'allowed')::boolean=(principal.role='admin') AND NOT (access_value->>'aiEnabled')::boolean THEN 'PASS' ELSE 'FAIL' END);
  IF principal.role='admin' THEN
   INSERT INTO _copilot_smoke VALUES('Admin: settings RPC works',CASE WHEN public.copilot_get_settings()->'config' IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);
   INSERT INTO _copilot_smoke VALUES('Admin: lead search is bounded',CASE WHEN jsonb_array_length(public.copilot_search('leads',''))<=11 THEN 'PASS' ELSE 'FAIL' END);
   INSERT INTO _copilot_smoke VALUES('Admin: technician search is bounded',CASE WHEN jsonb_array_length(public.copilot_search('technicians',''))<=11 THEN 'PASS' ELSE 'FAIL' END);
   -- No digits: four or more digits intentionally also perform phone matching.
   INSERT INTO _copilot_smoke VALUES('Admin: literal unmatched query gives no invented records',CASE WHEN public.copilot_search('leads','__copilot_smoke_no_record_zxqvplk__')='[]'::jsonb THEN 'PASS' ELSE 'FAIL' END);
   INSERT INTO _copilot_smoke VALUES('Admin: health is a measured database response',CASE WHEN public.copilot_health()->>'database'='reachable' THEN 'PASS' ELSE 'FAIL' END);
   d:=(CURRENT_TIMESTAMP AT TIME ZONE (access_value->>'timezone'))::date;
   report:=public.copilot_report(d,d,'mine');
   INSERT INTO _copilot_smoke VALUES('Admin: report returns scoped aggregate metrics',CASE WHEN report->'metrics'->'created' IS NOT NULL AND report->>'scope'='mine' THEN 'PASS' ELSE 'FAIL' END);
  ELSE
   denied:=false;
   BEGIN PERFORM public.copilot_search('leads',''); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   INSERT INTO _copilot_smoke VALUES(principal.role||': direct search is denied',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
   denied:=false;
   BEGIN PERFORM public.copilot_get_settings(); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   INSERT INTO _copilot_smoke VALUES(principal.role||': Admin settings are denied',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
  END IF;
 END LOOP;
END; $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN PERFORM count(*) FROM marshmallow_private.copilot_usage;
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 INSERT INTO _copilot_smoke VALUES('Anonymous ledger read action is denied',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
END; $$;
RESET ROLE;
SELECT * FROM _copilot_smoke ORDER BY name;
ROLLBACK;
