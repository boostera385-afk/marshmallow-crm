-- WRITE-BASED harness: disposable local database only. Exact file is run by the script.
BEGIN;
CREATE TEMP TABLE radar_checks(name text,result text);
GRANT ALL ON radar_checks TO authenticated;
CREATE FUNCTION pg_temp.check_radar(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO radar_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
INSERT INTO public.user_roles VALUES('15000000-0000-4000-8000-000000000001','processor');
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,scheduled_date,scheduled_time_start)
  SELECT ('15000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'RADAR-'||i,'Synthetic Customer '||i,'scheduled','Synthetic Tech',
    CASE WHEN i=31 THEN NULL ELSE '2026-10-01'::date+i END,'10:00' FROM generate_series(1,32) i;
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,scheduled_date,scheduled_time_start)
  SELECT gen_random_uuid(),'STATE-'||s,'Synthetic state',s,'Synthetic Tech','2026-10-01','10:00'
  FROM unnest(ARRAY['paid','cancelled','job_done','needs_reschedule','cancellation_requested','payment_requested','scammed']) s;
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,tech_number,scheduled_date,scheduled_time_start) VALUES
  (gen_random_uuid(),'UNASSIGNED-NULL','Synthetic','scheduled',NULL,NULL,'2027-01-01','10:00'),
  (gen_random_uuid(),'UNASSIGNED-BLANK','Synthetic','scheduled',' ','  ','2027-01-01','10:00'),
  (gen_random_uuid(),'NAME-ONLY','Synthetic','scheduled','Synthetic Tech',NULL,'2026-10-01','10:00'),
  (gen_random_uuid(),'NUMBER-ONLY','Synthetic','scheduled',NULL,'4155550199','2026-10-01','10:00'),
  (gen_random_uuid(),'NEVER-SCHEDULED','Synthetic','need_tech','Synthetic Tech',NULL,NULL,NULL);
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,scheduled_date,scheduled_time_start,created_at) VALUES
  (gen_random_uuid(),'TIE-OLDER','Synthetic','scheduled','Synthetic Tech','2027-01-01','12:00','2026-10-01'),
  (gen_random_uuid(),'TIE-NEWER','Synthetic','scheduled','Synthetic Tech','2027-01-01','12:00','2026-10-02'),
  (gen_random_uuid(),'TIE-EARLIER-TIME','Synthetic','scheduled','Synthetic Tech','2027-01-01','11:00','2026-10-03');
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_radar('active exact total includes all unfinished workflows',(public.list_processor_jobs()->>'total')::int=40);
SELECT pg_temp.check_radar('history exact total includes the three terminal jobs',(public.list_processor_jobs(0,'',true)->>'total')::int=43);
SELECT pg_temp.check_radar('newest schedule then time then new job first',
  (SELECT array_agg(r->>'job_id' ORDER BY n) FROM jsonb_array_elements(public.list_processor_jobs()->'rows') WITH ORDINALITY a(r,n) WHERE n<=4)
  = ARRAY['TIE-NEWER','TIE-OLDER','TIE-EARLIER-TIME','RADAR-32']);
SELECT pg_temp.check_radar('undated scheduled jobs sort last',public.list_processor_jobs(25)->'rows'->-1->>'job_id'='RADAR-31');
SELECT pg_temp.check_radar('second page retains all remaining jobs',jsonb_array_length(public.list_processor_jobs(25)->'rows')=15);
SELECT pg_temp.check_radar('no duplicates across pages',
  (SELECT count(DISTINCT r->>'id') FROM jsonb_array_elements((public.list_processor_jobs()->'rows')||(public.list_processor_jobs(25)->'rows')) a(r))=40);
SELECT pg_temp.check_radar('unassigned absent even in history',(public.list_processor_jobs(0,'UNASSIGNED',true)->>'total')::int=0);
SELECT pg_temp.check_radar('saved name without number stays visible for repair',(public.list_processor_jobs(0,'NAME-ONLY')->>'total')::int=1);
SELECT pg_temp.check_radar('saved number without name is assigned',(public.list_processor_jobs(0,'NUMBER-ONLY')->>'total')::int=1);
SELECT pg_temp.check_radar('never scheduled job excluded',(public.list_processor_jobs(0,'NEVER-SCHEDULED')->>'total')::int=0);
SELECT pg_temp.check_radar('reschedule remains on radar',(public.list_processor_jobs(0,'STATE-needs_reschedule')->>'total')::int=1);
SELECT pg_temp.check_radar('approval pending remains visible',(public.list_processor_jobs(0,'STATE-cancellation_requested')->>'total')::int=1 AND (public.list_processor_jobs(0,'STATE-payment_requested')->>'total')::int=1);
SELECT pg_temp.check_radar('terminal jobs history only',(public.list_processor_jobs(0,'STATE-paid')->>'total')::int=0 AND (public.list_processor_jobs(0,'STATE-job_done')->>'total')::int=0 AND (public.list_processor_jobs(0,'STATE-cancelled')->>'total')::int=0);
SELECT pg_temp.check_radar('existing caller RLS still excludes the foreign record',(public.list_processor_jobs(0,'RADAR-30',true)->>'total')::int=0);
RESET ROLE;
INSERT INTO public.lead_status_visibility(user_id,status,is_visible) VALUES('15000000-0000-4000-8000-000000000001','needs_reschedule',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_radar('per-user status deny still enforced',(public.list_processor_jobs(0,'STATE-needs_reschedule')->>'total')::int=0);
RESET ROLE;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['customer_service','cs_admin','opr','opr_admin'] LOOP
    UPDATE public.user_roles SET role=r::public.app_role;
    BEGIN
      PERFORM public.list_processor_jobs();
      PERFORM pg_temp.check_radar(r||' denied',false);
    EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_radar(r||' denied',true);
    END;
  END LOOP;
  UPDATE public.user_roles SET role='admin';
  PERFORM pg_temp.check_radar('admin admitted',(public.list_processor_jobs()->>'total')::int=41);
END $$;
SELECT pg_temp.check_radar('API signature remains invoker, not definer',NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.list_processor_jobs(integer,text,boolean,text)'::regprocedure));
SELECT * FROM radar_checks ORDER BY name;
ROLLBACK;
