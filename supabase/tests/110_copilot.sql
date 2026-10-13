-- WRITE-BASED behavioural harness. Run only with the isolated copilot fixture or
-- an explicitly approved disposable test project with the synthetic fixture IDs.
-- NOT for shared production. All harness changes roll back.
BEGIN;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE _copilot_checks(name text,result text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.check_result(p_name text,p_ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO _copilot_checks VALUES(p_name,CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END);
$$;
SELECT set_config('request.jwt.claim.sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',true);
SELECT pg_temp.check_result('Admin defaults to enabled, AI off',(public.copilot_get_access()->>'allowed')::boolean AND NOT (public.copilot_get_access()->>'aiEnabled')::boolean);
SELECT pg_temp.check_result('Admin can search own and outside records',jsonb_array_length(public.copilot_search('leads',''))=4);
SELECT public.copilot_set_permission('customer_service',NULL,true);
SELECT public.copilot_set_permission('opr',NULL,true);
SELECT public.copilot_set_permission('opr_admin',NULL,true);
SELECT public.copilot_set_permission('cs_admin',NULL,true);
SELECT public.copilot_set_permission('processor',NULL,true);
SELECT set_config('request.jwt.claim.sub','e25b3e94-6559-471a-92ea-f209effa5f02',true);
SELECT pg_temp.check_result('CS enabled through role',(public.copilot_get_access()->>'allowed')::boolean);
SELECT pg_temp.check_result('Search does not expose outside scope',jsonb_array_length(public.copilot_search('leads','MM-102'))=0);
SELECT pg_temp.check_result('Normalised phone matches saved record',jsonb_array_length(public.copilot_search('leads','5550101000'))=1);
SELECT pg_temp.check_result('Wildcard is literal not all records',jsonb_array_length(public.copilot_search('leads','%'))=0);
SELECT pg_temp.check_result('Service and area filters use saved values',jsonb_array_length(public.copilot_search('leads','',NULL,0,'Electrical','Miami'))=0);
SELECT pg_temp.check_result('Area wildcard stays literal',jsonb_array_length(public.copilot_search('leads','',NULL,0,'','%'))=0);
SELECT pg_temp.check_result('Service wildcard stays literal',jsonb_array_length(public.copilot_search('leads','',NULL,0,'%',''))=0);
SELECT pg_temp.check_result('Eastern boundary excludes previous-day creation',(public.copilot_report('2026-03-08','2026-03-08')->'metrics'->>'created')::int=1);
DO $$ BEGIN
 BEGIN PERFORM public.copilot_report('2026-03-08','2026-03-08','team'); PERFORM pg_temp.check_result('CS cannot request team report',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('CS cannot request team report',true); END;
 BEGIN PERFORM public.copilot_set_permission('opr',NULL,true); PERFORM pg_temp.check_result('No self grant',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('No self grant',true); END;
 BEGIN PERFORM public.copilot_health(); PERFORM pg_temp.check_result('No non-admin infrastructure health',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('No non-admin infrastructure health',true); END;
 BEGIN PERFORM public.copilot_search('technicians',''); PERFORM pg_temp.check_result('Technician navigation gate enforced',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('Technician navigation gate enforced',true); END;
 BEGIN PERFORM public.copilot_reserve_ai(auth.uid(),gen_random_uuid()); PERFORM pg_temp.check_result('Browser cannot reserve paid requests',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('Browser cannot reserve paid requests',true); END;
  BEGIN INSERT INTO public.copilot_user_permissions VALUES(auth.uid(),true); PERFORM pg_temp.check_result('RLS prevents direct self grant',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('RLS prevents direct self grant',true); END;
  BEGIN PERFORM public.copilot_configure(true,true,100000,100,'UTC'); PERFORM pg_temp.check_result('Non-admin cannot enable AI or raise limits',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('Non-admin cannot enable AI or raise limits',true); END;
  BEGIN PERFORM public.copilot_usage_summary(); PERFORM pg_temp.check_result('Usage totals are Admin only',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('Usage totals are Admin only',true); END;
END; $$;
WITH changed AS (UPDATE public.copilot_config SET ai_enabled=true RETURNING id)
SELECT pg_temp.check_result('RLS blocks direct non-admin configuration writes',NOT EXISTS(SELECT 1 FROM changed));
WITH changed AS (UPDATE public.copilot_role_permissions SET allowed=true RETURNING role)
SELECT pg_temp.check_result('RLS blocks direct non-admin role writes',NOT EXISTS(SELECT 1 FROM changed));
SELECT set_config('request.jwt.claim.sub','7c3ac25f-7106-4bf1-b367-1277cc5c3872',true);
SELECT pg_temp.check_result('OPR hidden quote is null',public.copilot_search('leads','MM-101')->0->'quote'='null'::jsonb);
SELECT pg_temp.check_result('OPR default status restricts broad RLS',jsonb_array_length(public.copilot_search('leads','MM-103'))=0);
SELECT set_config('request.jwt.claim.sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',true);
RESET ROLE;
INSERT INTO public.lead_status_visibility(user_id,role,status,is_visible) VALUES(NULL,'opr','need_tech',true),('7c3ac25f-7106-4bf1-b367-1277cc5c3872',NULL,'need_tech',false);
INSERT INTO public.navigation_permissions(user_id,nav_section,allowed) VALUES('7c3ac25f-7106-4bf1-b367-1277cc5c3872','technicians',true),('0071cf5f-1eec-4ad6-abf7-82e16fee76b1','technicians',true),('5c5aa71f-d441-44ce-ba50-2ccb63ac486f','technicians',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7c3ac25f-7106-4bf1-b367-1277cc5c3872',true);
SELECT pg_temp.check_result('OPR technician scope is own code',jsonb_array_length(public.copilot_search('technicians',''))=1);
SELECT pg_temp.check_result('User status denial overrides role visibility',jsonb_array_length(public.copilot_search('leads','MM-102'))=0);
DO $$ BEGIN
 BEGIN PERFORM public.copilot_search('leads','',NULL,0,'','',NULL,'2026-03-08'); PERFORM pg_temp.check_result('Schedule search checks underlying navigation',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('Schedule search checks underlying navigation',true); END;
END; $$;
SELECT pg_temp.check_result('OPR cannot search outside technician',jsonb_array_length(public.copilot_search('technicians','5550101002'))=0);
SELECT set_config('request.jwt.claim.sub','0071cf5f-1eec-4ad6-abf7-82e16fee76b1',true);
SELECT pg_temp.check_result('OPR Admin can see coded technicians',jsonb_array_length(public.copilot_search('technicians',''))=2);
SELECT pg_temp.check_result('OPR Admin inherits status but cannot bypass RLS',public.copilot_status_visible('need_tech',NULL) AND jsonb_array_length(public.copilot_search('leads','MM-102'))=0);
-- RLS is stricter than that role visibility for this outside-scope record.
SELECT set_config('request.jwt.claim.sub','5c5aa71f-d441-44ce-ba50-2ccb63ac486f',true);
SELECT pg_temp.check_result('CS Admin technician fields redacted',public.copilot_search('leads','MM-101')->0->'tech_name'='null'::jsonb AND public.copilot_search('leads','MM-101')->0->'tech_number'='null'::jsonb);
DO $$ BEGIN
 BEGIN PERFORM public.copilot_search('technicians',''); PERFORM pg_temp.check_result('CS Admin tech details stay restricted after nav grant',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('CS Admin tech details stay restricted after nav grant',true); END;
END; $$;
SELECT set_config('request.jwt.claim.sub','eb18f72a-92f5-405b-83ac-a9192cca1d78',true);
SELECT pg_temp.check_result('Processor can search outside personal scope',jsonb_array_length(public.copilot_search('leads','MM-101'))=1);
SELECT set_config('request.jwt.claim.sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',true);
SELECT public.copilot_configure(true,true,425,3,'America/New_York');
SELECT pg_temp.check_result('Admin saves exact AI allowance and daily limit',public.copilot_get_settings()->'config' @> '{"enabled":true,"ai_enabled":true,"monthly_budget_cents":425,"daily_ai_limit":3,"timezone":"America/New_York"}'::jsonb);
DO $$ DECLARE u uuid; BEGIN
 FOR u IN SELECT user_id FROM public.user_roles LOOP
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  PERFORM pg_temp.check_result('Global AI covers allowed caller '||public.copilot_caller_role(),(public.copilot_get_access()->>'allowed')::boolean AND (public.copilot_get_access()->>'aiEnabled')::boolean);
 END LOOP;
END; $$;
SELECT set_config('request.jwt.claim.sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',true);
SELECT public.copilot_set_permission('customer_service',NULL,false);
SELECT public.copilot_set_permission(NULL,'e25b3e94-6559-471a-92ea-f209effa5f02',true);
SELECT set_config('request.jwt.claim.sub','e25b3e94-6559-471a-92ea-f209effa5f02',true);
SELECT pg_temp.check_result('Individual Allow grants Copilot and global AI despite role denial',(public.copilot_get_access()->>'allowed')::boolean AND (public.copilot_get_access()->>'aiEnabled')::boolean);
SELECT set_config('request.jwt.claim.sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',true);
SELECT public.copilot_set_permission(NULL,'e25b3e94-6559-471a-92ea-f209effa5f02',NULL);
SELECT set_config('request.jwt.claim.sub','e25b3e94-6559-471a-92ea-f209effa5f02',true);
SELECT pg_temp.check_result('Inherit restores role denial for Copilot and AI',NOT (public.copilot_get_access()->>'allowed')::boolean AND NOT (public.copilot_get_access()->>'aiEnabled')::boolean);
SELECT set_config('request.jwt.claim.sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',true);
SELECT public.copilot_set_permission('customer_service',NULL,true);
SELECT public.copilot_set_permission(NULL,'7c3ac25f-7106-4bf1-b367-1277cc5c3872',false);
SELECT set_config('request.jwt.claim.sub','7c3ac25f-7106-4bf1-b367-1277cc5c3872',true);
SELECT pg_temp.check_result('User denial wins over role grant',NOT (public.copilot_get_access()->>'allowed')::boolean);
SELECT pg_temp.check_result('User denial also blocks globally enabled AI',NOT (public.copilot_get_access()->>'aiEnabled')::boolean);
DO $$ BEGIN
 BEGIN PERFORM public.copilot_search('leads','MM-101'); PERFORM pg_temp.check_result('Denied user cannot call search directly',false);
 EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('Denied user cannot call search directly',true); END;
END; $$;
SELECT set_config('request.jwt.claim.sub','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',true);
SELECT public.copilot_set_permission(NULL,'7c3ac25f-7106-4bf1-b367-1277cc5c3872',NULL);
SELECT public.copilot_configure(false,true,1000,20,'America/New_York');
SELECT pg_temp.check_result('Global off also disables Admin',NOT (public.copilot_get_access()->>'allowed')::boolean);
SELECT pg_temp.check_result('Global Copilot off blocks AI even with AI switch on',NOT (public.copilot_get_access()->>'aiEnabled')::boolean);
SELECT public.copilot_configure(true,false,1000,20,'America/New_York');
SELECT pg_temp.check_result('AI off preserves deterministic tools',(public.copilot_get_access()->>'allowed')::boolean AND NOT (public.copilot_get_access()->>'aiEnabled')::boolean AND jsonb_array_length(public.copilot_search('leads',''))=4);
DO $$ BEGIN
 BEGIN PERFORM public.copilot_configure(true,true,100001,20,'UTC'); PERFORM pg_temp.check_result('Database rejects excessive allowance',false);
 EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check_result('Database rejects excessive allowance',true); END;
 BEGIN PERFORM public.copilot_configure(true,true,1000,101,'UTC'); PERFORM pg_temp.check_result('Database rejects excessive daily cap',false);
 EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check_result('Database rejects excessive daily cap',true); END;
 BEGIN PERFORM public.copilot_configure(true,true,1000,20,'Invalid/Timezone'); PERFORM pg_temp.check_result('Database validates timezone',false);
 EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.check_result('Database validates timezone',true); END;
END; $$;
-- These reservations test the database only; they never call an AI provider.
SELECT public.copilot_configure(true,true,0,20,'America/New_York');
RESET ROLE;
DO $$ BEGIN
 BEGIN PERFORM public.copilot_reserve_ai('9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',gen_random_uuid()); PERFORM pg_temp.check_result('Zero monthly allowance blocks AI',false);
 EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.check_result('Zero monthly allowance blocks AI',SQLERRM LIKE 'Monthly AI budget reached%'); END;
END; $$;
SET LOCAL ROLE authenticated;
SELECT public.copilot_configure(true,true,1000,0,'America/New_York');
RESET ROLE;
DO $$ BEGIN
 BEGIN PERFORM public.copilot_reserve_ai('9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203',gen_random_uuid()); PERFORM pg_temp.check_result('Zero daily limit blocks AI',false);
 EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.check_result('Zero daily limit blocks AI',SQLERRM LIKE 'Daily AI limit reached%'); END;
END; $$;
SET LOCAL ROLE authenticated;
SELECT public.copilot_configure(true,true,2,1,'America/New_York');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.copilot_reserve_ai('9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203','00000000-0000-4000-8000-000000000099');
RESET ROLE;
-- Owner checks service-only failures; regular authenticated users cannot become service_role.
DO $$ DECLARE rejected boolean:=false; BEGIN
 BEGIN PERFORM public.copilot_reserve_ai('9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203','00000000-0000-4000-8000-000000000099'); EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Request already reserved%'; END;
 INSERT INTO _copilot_checks VALUES('Duplicate paid request rejected',CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END);
 rejected:=false;
 BEGIN PERFORM public.copilot_reserve_ai('9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203','00000000-0000-4000-8000-000000000098'); EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Daily AI limit reached%'; END;
 INSERT INTO _copilot_checks VALUES('Daily cap rejects another request',CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END);
 rejected:=false;
 BEGIN PERFORM public.copilot_reserve_ai('e25b3e94-6559-471a-92ea-f209effa5f02','00000000-0000-4000-8000-000000000097'); EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM LIKE 'Monthly AI budget reached%'; END;
 INSERT INTO _copilot_checks VALUES('Global budget shared across users',CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END);
 PERFORM public.copilot_finish_ai('00000000-0000-4000-8000-000000000099',100,50,true);
END; $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Usage counts real tokens',(public.copilot_usage_summary()->>'inputTokens')::int=100 AND (public.copilot_usage_summary()->>'reservedCents')::int=2);
SELECT pg_temp.check_result('CRM search still works after AI budget exhaustion',jsonb_array_length(public.copilot_search('leads','MM-101'))=1);
SELECT pg_temp.check_result('Configuration writes audited',EXISTS(SELECT 1 FROM public.activity_logs WHERE action='copilot_configured'));
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN PERFORM public.copilot_get_access(); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL: anonymous execute grant'; END IF;
END; $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Anonymous API execute is revoked',NOT has_function_privilege('anon','public.copilot_get_access()','EXECUTE'));
SELECT * FROM _copilot_checks ORDER BY name;
ROLLBACK;
