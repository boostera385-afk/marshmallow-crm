-- WRITE-BASED: run only in the disposable fixture database, never shared production.
BEGIN;
CREATE TEMP TABLE assigned_checks(name text,result text);
GRANT ALL ON assigned_checks TO authenticated;
CREATE FUNCTION pg_temp.check_assigned(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO assigned_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
ALTER TABLE public.leads ALTER COLUMN tech_number SET DEFAULT '4155550199';
INSERT INTO public.user_roles VALUES('15000000-0000-4000-8000-000000000001','processor');
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,scheduled_date,scheduled_time_start)
  SELECT ('15000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'RADAR-'||i,'Synthetic Customer '||i,'scheduled','Synthetic Tech',
    CASE WHEN i=31 THEN NULL ELSE '2026-10-01'::date+i END,'10:00' FROM generate_series(1,32) i;
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,scheduled_date,scheduled_time_start)
  SELECT gen_random_uuid(),'STATE-'||s,'Synthetic state',s,'Synthetic Tech','2026-10-01','10:00'
  FROM unnest(ARRAY['paid','cancelled','job_done','needs_reschedule','cancellation_requested','payment_requested','scammed']) s;
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,tech_number,scheduled_date,scheduled_time_start) VALUES
  (gen_random_uuid(),'MISSING-NULL','Synthetic','scheduled',NULL,NULL,'2027-01-01','10:00'),
  (gen_random_uuid(),'MISSING-BLANK','Synthetic','scheduled',' ','  ','2027-01-01','10:00'),
  (gen_random_uuid(),'MISSING-NUMBER','Synthetic','scheduled','Synthetic Tech',NULL,'2026-10-01','10:00'),
  (gen_random_uuid(),'MISSING-NAME','Synthetic','scheduled',NULL,'4155550199','2026-10-01','10:00'),
  (gen_random_uuid(),'MISSING-TIME','Synthetic','scheduled','Synthetic Tech','4155550199','2026-10-01',NULL),
  (gen_random_uuid(),'MISSING-SCHEDULE','Synthetic','scheduled','Synthetic Tech','4155550199',NULL,NULL);
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,scheduled_date,scheduled_time_start,created_at) VALUES
  (gen_random_uuid(),'TIE-OLDER','Synthetic','scheduled','Synthetic Tech','2027-01-01','12:00','2026-10-01'),
  (gen_random_uuid(),'TIE-NEWER','Synthetic','scheduled','Synthetic Tech','2027-01-01','12:00','2026-10-02'),
  (gen_random_uuid(),'TIE-EARLIER-TIME','Synthetic','scheduled','Synthetic Tech','2027-01-01','11:00','2026-10-03');
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_assigned('exact assigned scheduled active total',(public.list_processor_jobs()->>'total')::int=37);
SELECT pg_temp.check_assigned('terminal history exact total',(public.list_processor_jobs(0,'',true)->>'total')::int=40);
SELECT pg_temp.check_assigned('missing technician or schedule excluded even in history',(public.list_processor_jobs(0,'MISSING-',true)->>'total')::int=0);
SELECT pg_temp.check_assigned('undated scheduled job excluded',(public.list_processor_jobs(0,'RADAR-31',true)->>'total')::int=0);
SELECT pg_temp.check_assigned('newest schedule then time then newest job',
  (SELECT array_agg(r->>'job_id' ORDER BY n) FROM jsonb_array_elements(public.list_processor_jobs()->'rows') WITH ORDINALITY a(r,n) WHERE n<=4)
  = ARRAY['TIE-NEWER','TIE-OLDER','TIE-EARLIER-TIME','RADAR-32']);
SELECT pg_temp.check_assigned('complete second page',jsonb_array_length(public.list_processor_jobs(25)->'rows')=12);
SELECT pg_temp.check_assigned('no duplicates or dropped assigned jobs',
  (SELECT count(DISTINCT r->>'id') FROM jsonb_array_elements((public.list_processor_jobs()->'rows')||(public.list_processor_jobs(25)->'rows')) a(r))=37);
SELECT pg_temp.check_assigned('old unfinished scheduled jobs remain on radar',(public.list_processor_jobs(0,'RADAR-1')->>'total')::int>0);
SELECT pg_temp.check_assigned('reschedule and approvals retained',(public.list_processor_jobs(0,'STATE-needs_reschedule')->>'total')::int=1 AND (public.list_processor_jobs(0,'STATE-payment_requested')->>'total')::int=1 AND (public.list_processor_jobs(0,'STATE-cancellation_requested')->>'total')::int=1);
SELECT pg_temp.check_assigned('terminal jobs not active',(public.list_processor_jobs(0,'STATE-paid')->>'total')::int=0 AND (public.list_processor_jobs(0,'STATE-job_done')->>'total')::int=0 AND (public.list_processor_jobs(0,'STATE-cancelled')->>'total')::int=0);
SELECT pg_temp.check_assigned('caller RLS retains foreign-record exclusion',(public.list_processor_jobs(0,'RADAR-30',true)->>'total')::int=0);
RESET ROLE;
INSERT INTO public.lead_status_visibility(user_id,status,is_visible) VALUES('15000000-0000-4000-8000-000000000001','needs_reschedule',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_assigned('per-user status deny retained',(public.list_processor_jobs(0,'STATE-needs_reschedule')->>'total')::int=0);
RESET ROLE;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['customer_service','cs_admin','opr','opr_admin'] LOOP
    UPDATE public.user_roles SET role=r::public.app_role;
    BEGIN PERFORM public.list_processor_jobs(); PERFORM pg_temp.check_assigned(r||' denied',false);
    EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_assigned(r||' denied',true); END;
  END LOOP;
  UPDATE public.user_roles SET role='admin';
  PERFORM pg_temp.check_assigned('admin admitted with exact total',(public.list_processor_jobs()->>'total')::int=38);
END $$;
SELECT * FROM assigned_checks ORDER BY name;
ROLLBACK;
