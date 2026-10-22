-- Read-only shared-project installation checks. Temporary checks and JWT settings
-- roll back; no customer records, advisory results, leases or audit rows are written.
BEGIN;
CREATE TEMP TABLE processor_readonly_checks(name text, result text) ON COMMIT DROP;
GRANT ALL ON processor_readonly_checks TO authenticated;
INSERT INTO processor_readonly_checks SELECT 'assessment RLS enabled',CASE WHEN relrowsecurity THEN 'PASS' ELSE 'FAIL' END FROM pg_class WHERE oid='public.processor_job_assessments'::regclass;
INSERT INTO processor_readonly_checks SELECT 'lease RLS enabled',CASE WHEN relrowsecurity THEN 'PASS' ELSE 'FAIL' END FROM pg_class WHERE oid='public.processor_job_refresh_locks'::regclass;
INSERT INTO processor_readonly_checks SELECT 'new RPCs use invoker and fixed search path',CASE WHEN count(*)=4 AND bool_and(NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN 'PASS' ELSE 'FAIL' END FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('processor_can_view_status','list_processor_jobs','claim_processor_job_refresh','save_processor_job_assessment');
INSERT INTO processor_readonly_checks VALUES
 ('anonymous cannot list',CASE WHEN NOT has_function_privilege('anon','public.list_processor_jobs(integer,text,boolean,text)','EXECUTE') THEN 'PASS' ELSE 'FAIL' END),
 ('authenticated cannot claim',CASE WHEN NOT has_function_privilege('authenticated','public.claim_processor_job_refresh(uuid,uuid)','EXECUTE') THEN 'PASS' ELSE 'FAIL' END),
 ('authenticated cannot save',CASE WHEN NOT has_function_privilege('authenticated','public.save_processor_job_assessment(uuid,uuid,timestamptz,text,jsonb,uuid)','EXECUTE') THEN 'PASS' ELSE 'FAIL' END),
 ('authenticated cannot forge assessments',CASE WHEN NOT has_table_privilege('authenticated','public.processor_job_assessments','INSERT') AND NOT has_table_privilege('authenticated','public.processor_job_assessments','UPDATE') THEN 'PASS' ELSE 'FAIL' END),
 ('authenticated cannot read leases',CASE WHEN NOT has_table_privilege('authenticated','public.processor_job_refresh_locks','SELECT') THEN 'PASS' ELSE 'FAIL' END);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r record; payload jsonb; history_payload jsonb; expected bigint; expected_ids jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('admin','9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203'),
    ('processor','eb18f72a-92f5-405b-83ac-a9192cca1d78'),
    ('cs_admin','5c5aa71f-d441-44ce-ba50-2ccb63ac486f'),
    ('customer_service','e25b3e94-6559-471a-92ea-f209effa5f02'),
    ('opr','7c3ac25f-7106-4bf1-b367-1277cc5c3872'),
    ('opr_admin','0071cf5f-1eec-4ad6-abf7-82e16fee76b1')
  ) AS roles(role_name,user_id) LOOP
    PERFORM set_config('request.jwt.claim.sub',r.user_id,true);
    PERFORM set_config('request.jwt.claims',json_build_object('sub',r.user_id,'role','authenticated')::text,true);
    IF r.role_name IN ('admin','processor') THEN
      payload:=public.list_processor_jobs();
      SELECT count(*) INTO expected FROM public.leads l
        WHERE (nullif(btrim(l.tech_name),'') IS NOT NULL OR nullif(btrim(l.tech_number),'') IS NOT NULL)
          AND (l.scheduled_date IS NOT NULL OR l.status='scheduled')
          AND l.status NOT IN ('paid','cancelled','job_done','done','completed') AND public.processor_can_view_status(l.status);
      INSERT INTO processor_readonly_checks VALUES(r.role_name||' exact scoped total',CASE WHEN (payload->>'total')::bigint=expected THEN 'PASS' ELSE 'FAIL' END);
      INSERT INTO processor_readonly_checks VALUES(r.role_name||' bounded page',CASE WHEN jsonb_array_length(payload->'rows')=least(expected,25) THEN 'PASS' ELSE 'FAIL' END);
      SELECT coalesce(jsonb_agg(p.id::text ORDER BY p.scheduled_date DESC NULLS LAST,p.scheduled_time_start DESC NULLS LAST,p.created_at DESC,p.id DESC),'[]'::jsonb) INTO expected_ids
        FROM (SELECT l.id,l.scheduled_date,l.scheduled_time_start,l.created_at FROM public.leads l
          WHERE (nullif(btrim(l.tech_name),'') IS NOT NULL OR nullif(btrim(l.tech_number),'') IS NOT NULL)
            AND (l.scheduled_date IS NOT NULL OR l.status='scheduled')
            AND l.status NOT IN ('paid','cancelled','job_done','done','completed') AND public.processor_can_view_status(l.status)
          ORDER BY l.scheduled_date DESC NULLS LAST,l.scheduled_time_start DESC NULLS LAST,l.created_at DESC,l.id DESC LIMIT 25) p;
      INSERT INTO processor_readonly_checks VALUES(r.role_name||' newest-first page matches scoped records',CASE WHEN expected_ids=(SELECT coalesce(jsonb_agg(e->>'id' ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(payload->'rows') WITH ORDINALITY a(e,ord)) THEN 'PASS' ELSE 'FAIL' END);
      INSERT INTO processor_readonly_checks VALUES(r.role_name||' active page excludes unassigned',CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'rows') a(e) WHERE nullif(btrim(e->>'tech_name'),'') IS NULL AND nullif(btrim(e->>'tech_number'),'') IS NULL) THEN 'PASS' ELSE 'FAIL' END);
      INSERT INTO processor_readonly_checks VALUES(r.role_name||' active page excludes terminal jobs',CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'rows') a(e) WHERE e->>'status' IN ('paid','cancelled','job_done','done','completed')) THEN 'PASS' ELSE 'FAIL' END);
      history_payload:=public.list_processor_jobs(0,'',true);
      SELECT count(*) INTO expected FROM public.leads l
        WHERE (nullif(btrim(l.tech_name),'') IS NOT NULL OR nullif(btrim(l.tech_number),'') IS NOT NULL)
          AND (l.scheduled_date IS NOT NULL OR l.status='scheduled') AND public.processor_can_view_status(l.status);
      INSERT INTO processor_readonly_checks VALUES(r.role_name||' history exact scoped total',CASE WHEN (history_payload->>'total')::bigint=expected THEN 'PASS' ELSE 'FAIL' END);
      INSERT INTO processor_readonly_checks VALUES(r.role_name||' history page excludes unassigned',CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(history_payload->'rows') a(e) WHERE nullif(btrim(e->>'tech_name'),'') IS NULL AND nullif(btrim(e->>'tech_number'),'') IS NULL) THEN 'PASS' ELSE 'FAIL' END);
      BEGIN
        PERFORM public.list_processor_jobs(-1);
        INSERT INTO processor_readonly_checks VALUES(r.role_name||' invalid offset denied','FAIL');
      EXCEPTION WHEN invalid_parameter_value THEN INSERT INTO processor_readonly_checks VALUES(r.role_name||' invalid offset denied','PASS'); END;
    ELSE
      BEGIN
        PERFORM public.list_processor_jobs();
        INSERT INTO processor_readonly_checks VALUES(r.role_name||' denied','FAIL');
      EXCEPTION WHEN insufficient_privilege THEN INSERT INTO processor_readonly_checks VALUES(r.role_name||' denied','PASS'); END;
    END IF;
  END LOOP;
END $$;
RESET ROLE;
SELECT * FROM processor_readonly_checks ORDER BY name;
ROLLBACK;
