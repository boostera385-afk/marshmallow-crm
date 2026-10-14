-- Production-safe, READ-ONLY smoke harness for the installed pilot RPCs.
-- Uses the same six-role baseline identities; outputs checks, not customer fields.
-- Only session settings and temporary checks change, and all roll back.
-- The checked-save call deliberately uses impossible expected '{}' so it must
-- reject BEFORE configuration/audit writes. Never call the positive save here.
BEGIN;
SELECT set_config('request.jwt.claims',json_build_object('sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203','role','authenticated')::text,true);
SELECT set_config('request.jwt.claim.sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE _pilot_smoke(name text,result text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.pilot_smoke_check(p_name text,p_ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO _pilot_smoke VALUES(p_name,CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END);
$$;
DO $$
DECLARE settings jsonb; diagnostics jsonb; lead public.leads; brief jsonb;
BEGIN
 settings:=public.copilot_get_settings()->'config';
 diagnostics:=public.copilot_diagnostics();
 PERFORM pg_temp.pilot_smoke_check('Admin diagnostics return safe usage fields',
  diagnostics ?& ARRAY['configChangedAt','lastSuccessAt','remainingCents','remainingToday','completedThisMonth']
  AND (diagnostics->>'remainingCents')::bigint>=0 AND (diagnostics->>'remainingToday')::bigint>=0);
 SELECT * INTO lead FROM public.leads ORDER BY id LIMIT 1;
 brief:=public.copilot_lead_brief(lead.id);
 PERFORM pg_temp.pilot_smoke_check('Admin exact brief matches saved source',lead.id IS NOT NULL AND brief->>'id'=lead.id::text
  AND brief->>'address' IS NOT DISTINCT FROM lead.address
  AND brief->>'customer_schedule_requirements' IS NOT DISTINCT FROM lead.customer_schedule_requirements);
 PERFORM pg_temp.pilot_smoke_check('Missing saved ID is unavailable',public.copilot_lead_brief('00000000-0000-0000-0000-000000000000') IS NULL);
 BEGIN
  PERFORM public.copilot_configure_checked('{}'::jsonb,true,false,1000,20,'America/New_York');
  PERFORM pg_temp.pilot_smoke_check('Stale expected config is rejected before writes',false);
 EXCEPTION WHEN serialization_failure THEN
  PERFORM pg_temp.pilot_smoke_check('Stale expected config is rejected before writes',true);
 END;
 PERFORM pg_temp.pilot_smoke_check('Saved configuration remains unchanged',(public.copilot_get_settings()->'config')=settings);
END; $$;
SELECT pg_temp.pilot_smoke_check('Anonymous pilot execution revoked',
 NOT has_function_privilege('anon','public.copilot_diagnostics()','EXECUTE')
 AND NOT has_function_privilege('anon','public.copilot_lead_brief(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.copilot_configure_checked(jsonb,boolean,boolean,integer,integer,text)','EXECUTE'));
SELECT pg_temp.pilot_smoke_check('Pilot customer read stays SECURITY INVOKER',
 EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.copilot_lead_brief(uuid)'::regprocedure AND NOT prosecdef));
SELECT pg_temp.pilot_smoke_check('Pilot fixed search paths',
 (SELECT count(*) FROM pg_proc WHERE oid IN ('public.copilot_diagnostics()'::regprocedure,'public.copilot_lead_brief(uuid)'::regprocedure,
 'public.copilot_configure_checked(jsonb,boolean,boolean,integer,integer,text)'::regprocedure) AND proconfig @> ARRAY['search_path=""'])=3);
SELECT set_config('request.jwt.claims',json_build_object('sub','e25b3e94-6559-471a-92ea-f209effa5f02','role','authenticated')::text,true);
SELECT set_config('request.jwt.claim.sub','e25b3e94-6559-471a-92ea-f209effa5f02',true);
DO $$ BEGIN
 BEGIN PERFORM public.copilot_diagnostics(); PERFORM pg_temp.pilot_smoke_check('Non-Admin diagnostics denied',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.pilot_smoke_check('Non-Admin diagnostics denied',true); END;
 BEGIN PERFORM public.copilot_configure_checked('{}'::jsonb,true,false,1000,20,'America/New_York');
  PERFORM pg_temp.pilot_smoke_check('Non-Admin checked config denied before writes',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.pilot_smoke_check('Non-Admin checked config denied before writes',true); END;
 IF NOT COALESCE((public.copilot_get_access()->>'allowed')::boolean,false) THEN
  BEGIN PERFORM public.copilot_lead_brief('00000000-0000-0000-0000-000000000000');
   PERFORM pg_temp.pilot_smoke_check('Excluded caller cannot request a saved brief',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.pilot_smoke_check('Excluded caller cannot request a saved brief',true); END;
 END IF;
END; $$;
RESET ROLE;
SELECT * FROM _pilot_smoke ORDER BY name;
ROLLBACK;
