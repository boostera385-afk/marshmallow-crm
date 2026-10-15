-- WRITE-BASED ISOLATED harness. Do not run on shared production without approval.
-- Synthetic rows only; tests caller RLS, hidden statuses, leases, stale saves and audit.
BEGIN;
CREATE TEMP TABLE processor_checks(name text,result text);
GRANT ALL ON processor_checks TO authenticated,service_role;
CREATE FUNCTION pg_temp.check_board(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO processor_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
INSERT INTO public.profiles VALUES('15000000-0000-4000-8000-000000000001','Synthetic Processor');
INSERT INTO public.user_roles VALUES('15000000-0000-4000-8000-000000000001','processor');
INSERT INTO public.leads(id,job_id,customer_name,status,scheduled_date,scheduled_time_start)
  SELECT ('15000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'JOB-'||i,'Synthetic Customer '||i,'scheduled','2026-10-15','10:00' FROM generate_series(1,30) i;
INSERT INTO public.leads(id,job_id,customer_name,status,scheduled_date,scheduled_time_start) VALUES
 ('15000000-0000-4000-8000-000000000031','PAID-1','Paid fixture','paid','2026-10-15','10:00'),
 ('15000000-0000-4000-8000-000000000032','QUOTE-1','Hidden fixture','pending_to_send','2026-10-15','10:00');
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_board('active exact total respects existing lead RLS',(public.list_processor_jobs()->>'total')::integer=29);
SELECT pg_temp.check_board('page is bounded at 25',jsonb_array_length(public.list_processor_jobs()->'rows')=25);
SELECT pg_temp.check_board('second page is complete',(public.list_processor_jobs(25)->>'total')::integer=29 AND jsonb_array_length(public.list_processor_jobs(25)->'rows')=4);
SELECT pg_temp.check_board('history includes paid but not hidden quote',(public.list_processor_jobs(0,'',true)->>'total')::integer=30);
SELECT pg_temp.check_board('search is literal not SQL/wildcard',(public.list_processor_jobs(0,'%')->>'total')::integer=0);
SELECT pg_temp.check_board('search finds exact job',(public.list_processor_jobs(0,'JOB-29')->>'total')::integer=1);
SELECT pg_temp.check_board('anonymous cannot execute list',NOT has_function_privilege('anon','public.list_processor_jobs(integer,text,boolean,text)','EXECUTE'));
SELECT pg_temp.check_board('browser cannot claim refresh',NOT has_function_privilege('authenticated','public.claim_processor_job_refresh(uuid,uuid)','EXECUTE'));
SELECT pg_temp.check_board('browser cannot forge assessment',NOT has_table_privilege('authenticated','public.processor_job_assessments','INSERT') AND NOT has_table_privilege('authenticated','public.processor_job_assessments','UPDATE'));
RESET ROLE;
INSERT INTO public.lead_status_visibility(user_id,role,status,is_visible) VALUES('15000000-0000-4000-8000-000000000001',null,'scheduled',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_board('per-user visibility deny is enforced',(public.list_processor_jobs()->>'total')::integer=0);
RESET ROLE;
DELETE FROM public.lead_status_visibility;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['customer_service','cs_admin','opr','opr_admin'] LOOP
    UPDATE public.user_roles SET role=r::public.app_role WHERE user_id='15000000-0000-4000-8000-000000000001';
    BEGIN
      PERFORM public.list_processor_jobs();
      PERFORM pg_temp.check_board(r||' denied',false);
    EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_board(r||' denied',true);
    END;
  END LOOP;
  UPDATE public.user_roles SET role='admin' WHERE user_id='15000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.check_board('admin admitted',(public.list_processor_jobs()->>'total')::integer=30);
  UPDATE public.user_roles SET role='processor' WHERE user_id='15000000-0000-4000-8000-000000000001';
END $$;
SET LOCAL ROLE service_role;
SELECT pg_temp.check_board('first refresh claims lease',public.claim_processor_job_refresh('15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000100'));
SELECT pg_temp.check_board('concurrent refresh excluded',NOT public.claim_processor_job_refresh('15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000101'));
SELECT pg_temp.check_board('foreign lease cannot save',NOT public.save_processor_job_assessment('15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000101',now(),'hash','{}','15000000-0000-4000-8000-000000000001'));
SELECT pg_temp.check_board('changed job snapshot cannot save',NOT public.save_processor_job_assessment('15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000100',now()-interval '1 day','hash','{}','15000000-0000-4000-8000-000000000001'));
SELECT pg_temp.check_board('owner saves advisory result',public.save_processor_job_assessment('15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000100',now(),'hash','{"status":"payment_pending","timezone":"America/New_York","mirror_last_message_at":null}','15000000-0000-4000-8000-000000000001'));
SELECT pg_temp.check_board('saved job remains scheduled',(SELECT status='scheduled' FROM public.leads WHERE job_id='JOB-1'));
SELECT pg_temp.check_board('save writes one audit row',(SELECT count(*)=1 FROM public.activity_logs WHERE action='processor_job_assessed'));
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_board('visible job assessment readable',(SELECT count(*)=1 FROM public.processor_job_assessments));
RESET ROLE;
INSERT INTO public.lead_status_visibility(user_id,role,status,is_visible) VALUES('15000000-0000-4000-8000-000000000001',null,'scheduled',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_board('hidden status also hides direct assessment read',(SELECT count(*)=0 FROM public.processor_job_assessments));
RESET ROLE;
SELECT * FROM processor_checks ORDER BY name;
ROLLBACK;
