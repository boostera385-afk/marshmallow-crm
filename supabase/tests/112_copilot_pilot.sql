-- WRITE-BASED isolated synthetic fixture ONLY. Never execute on shared production.
-- Exact pilot RPC input/action/outcome coverage. All writes roll back.
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE _pilot_checks(name text,result text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.pilot_check(p_name text,p_ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO _pilot_checks VALUES(p_name,CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END);
$$;
SELECT set_config('request.jwt.claim.sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',true);
SELECT pg_temp.pilot_check('Admin diagnostics report unused allowance',(public.copilot_diagnostics()->>'remainingCents')::int=1000 AND public.copilot_diagnostics()->>'lastSuccessAt' IS NULL);
SELECT public.copilot_configure_checked(public.copilot_get_settings()->'config',true,true,500,5,'America/New_York');
SELECT pg_temp.pilot_check('Checked save persists exact config',(public.copilot_get_settings()->'config'->>'monthly_budget_cents')::int=500);
SELECT pg_temp.pilot_check('Checked save has audit timestamp',public.copilot_diagnostics()->>'configChangedAt' IS NOT NULL);
DO $$ BEGIN
 BEGIN PERFORM public.copilot_configure_checked('{"enabled":true,"ai_enabled":false,"monthly_budget_cents":1000,"daily_ai_limit":20,"timezone":"America/New_York"}'::jsonb,true,false,1000,20,'UTC');
  PERFORM pg_temp.pilot_check('Stale save cannot overwrite AI',false);
 EXCEPTION WHEN serialization_failure THEN PERFORM pg_temp.pilot_check('Stale save cannot overwrite AI',(public.copilot_get_settings()->'config'->>'ai_enabled')::boolean); END;
END; $$;
SELECT public.copilot_set_permission('customer_service',NULL,true);
SELECT public.copilot_set_permission('opr',NULL,true);
SELECT public.copilot_set_permission('cs_admin',NULL,true);
SELECT pg_temp.pilot_check('Admin exact brief keeps saved unit',public.copilot_lead_brief('00000000-0000-4000-8000-000000000001')->>'address'='10 Test St Apt 2');
SELECT set_config('request.jwt.claim.sub','e25b3e94-6559-471a-92ea-f209effa5f02',true);
SELECT pg_temp.pilot_check('CS exact brief returns own record',public.copilot_lead_brief('00000000-0000-4000-8000-000000000001')->>'job_id'='MM-101');
SELECT pg_temp.pilot_check('CS out-of-scope and nonexistent IDs are indistinguishable',public.copilot_lead_brief('00000000-0000-4000-8000-000000000002') IS NULL AND public.copilot_lead_brief('00000000-0000-4000-8000-000000000098') IS NULL);
DO $$ BEGIN
 BEGIN PERFORM public.copilot_diagnostics(); PERFORM pg_temp.pilot_check('CS diagnostics denied',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.pilot_check('CS diagnostics denied',true); END;
 BEGIN PERFORM public.copilot_configure_checked('{}',true,true,500,5,'UTC'); PERFORM pg_temp.pilot_check('CS checked save denied',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.pilot_check('CS checked save denied',true); END;
END; $$;
SELECT set_config('request.jwt.claim.sub','7c3ac25f-7106-4bf1-b367-1277cc5c3872',true);
SELECT pg_temp.pilot_check('OPR brief hides quote',public.copilot_lead_brief('00000000-0000-4000-8000-000000000001')->'quote'='null'::jsonb);
SELECT pg_temp.pilot_check('OPR brief hides status outside visibility',public.copilot_lead_brief('00000000-0000-4000-8000-000000000003') IS NULL);
SELECT pg_temp.pilot_check('OPR brief hides explicit schedule without navigation',public.copilot_lead_brief('00000000-0000-4000-8000-000000000001')->'scheduled_date'='null'::jsonb);
SELECT set_config('request.jwt.claim.sub','5c5aa71f-d441-44ce-ba50-2ccb63ac486f',true);
SELECT pg_temp.pilot_check('CS Admin brief hides technician fields',public.copilot_lead_brief('00000000-0000-4000-8000-000000000001')->'tech_name'='null'::jsonb AND public.copilot_lead_brief('00000000-0000-4000-8000-000000000001')->'tech_number'='null'::jsonb);
SELECT set_config('request.jwt.claim.sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',true);
SELECT public.copilot_set_permission(NULL,'e25b3e94-6559-471a-92ea-f209effa5f02',false);
SELECT set_config('request.jwt.claim.sub','e25b3e94-6559-471a-92ea-f209effa5f02',true);
DO $$ BEGIN
 BEGIN PERFORM public.copilot_lead_brief('00000000-0000-4000-8000-000000000001'); PERFORM pg_temp.pilot_check('Denied caller cannot fetch exact brief',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.pilot_check('Denied caller cannot fetch exact brief',true); END;
END; $$;
SELECT pg_temp.pilot_check('Anonymous pilot RPC execute revoked',NOT has_function_privilege('anon','public.copilot_diagnostics()','EXECUTE') AND NOT has_function_privilege('anon','public.copilot_lead_brief(uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.copilot_configure_checked(jsonb,boolean,boolean,integer,integer,text)','EXECUTE'));
SELECT * FROM _pilot_checks ORDER BY name;
ROLLBACK;
