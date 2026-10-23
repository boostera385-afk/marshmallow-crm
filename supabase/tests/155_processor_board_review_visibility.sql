-- WRITE-BASED, disposable fixture only; never run on shared production.
BEGIN;
CREATE TEMP TABLE review_checks(name text,result text);
GRANT ALL ON review_checks TO authenticated;
CREATE FUNCTION pg_temp.check_review(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO review_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
INSERT INTO public.user_roles VALUES('15000000-0000-4000-8000-000000000001','processor');
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,tech_number,scheduled_date,scheduled_time_start)
SELECT ('15000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'ORDER-'||i,'Synthetic','scheduled','Synthetic Tech','4155550199','2026-10-01'::date+i,'10:00'
FROM generate_series(1,32) i;
INSERT INTO public.leads(id,job_id,status,tech_name,tech_number,scheduled_date,scheduled_time_start,half_address) VALUES
 (gen_random_uuid(),'MISSING-NAME','scheduled',NULL,'4155550199','2026-09-01','10:00',NULL),
 (gen_random_uuid(),'MISSING-NUMBER','scheduled','Synthetic Tech',NULL,'2026-09-01','10:00',NULL),
 (gen_random_uuid(),'MISSING-BOTH','scheduled',NULL,NULL,'2026-09-01','10:00',NULL),
 (gen_random_uuid(),'MISSING-DATE','scheduled','Synthetic Tech','4155550199',NULL,'10:00',NULL),
 (gen_random_uuid(),'MISSING-TIME','scheduled','Synthetic Tech','4155550199','2026-09-01',NULL,NULL),
 (gen_random_uuid(),'MISSING-SCHEDULE','scheduled',NULL,NULL,NULL,NULL,'House 12, Sample Street');
INSERT INTO public.leads(id,job_id,status,scheduled_date,scheduled_time_start,created_at) VALUES
 (gen_random_uuid(),'TIE-NEW','scheduled','2027-01-01','12:00','2026-10-02'),
 (gen_random_uuid(),'TIE-OLD','scheduled','2027-01-01','12:00','2026-10-01'),
 (gen_random_uuid(),'TIE-EARLY','scheduled','2027-01-01','11:00','2026-10-03');
INSERT INTO public.leads(id,job_id,status,scheduled_date,scheduled_time_start)
SELECT gen_random_uuid(),'STATE-'||s,s,'2026-09-01','10:00' FROM unnest(ARRAY['paid','cancelled','job_done','needs_reschedule','cancellation_requested','payment_requested']) s;
INSERT INTO public.leads(id,job_id,status) VALUES (gen_random_uuid(),'UNSCHEDULED','need_tech');
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_review('exact visible radar count including repairs',(public.list_processor_jobs()->>'total')::int=43);
SELECT pg_temp.check_review('exact closed history count',(public.list_processor_jobs(0,'',true)->>'total')::int=46);
SELECT pg_temp.check_review('all six incomplete scheduled jobs visible',(public.list_processor_jobs(0,'MISSING-')->>'total')::int=6);
SELECT pg_temp.check_review('no unscheduled intake leakage',(public.list_processor_jobs(0,'UNSCHEDULED',true)->>'total')::int=0);
SELECT pg_temp.check_review('partial address projected unchanged',public.list_processor_jobs(0,'MISSING-SCHEDULE')->'rows'->0->>'half_address'='House 12, Sample Street');
SELECT pg_temp.check_review('partial address searchable',(public.list_processor_jobs(0,'House 12')->>'total')::int=1);
SELECT pg_temp.check_review('newest schedules then time then creation',
 (SELECT array_agg(r->>'job_id' ORDER BY n) FROM jsonb_array_elements(public.list_processor_jobs()->'rows') WITH ORDINALITY a(r,n) WHERE n<=4)
 = ARRAY['TIE-NEW','TIE-OLD','TIE-EARLY','ORDER-32']);
SELECT pg_temp.check_review('undated repairs after dated appointments',
 public.list_processor_jobs(25)->'rows'->17->>'scheduled_date' IS NULL
 AND public.list_processor_jobs(25)->'rows'->16->>'scheduled_date' IS NULL);
SELECT pg_temp.check_review('complete pagination without duplicate jobs',
 (SELECT count(DISTINCT r->>'id') FROM jsonb_array_elements((public.list_processor_jobs()->'rows')||(public.list_processor_jobs(25)->'rows')) a(r))=43);
SELECT pg_temp.check_review('old unfinished job remains on radar',(public.list_processor_jobs(0,'ORDER-1')->>'total')::int>0);
SELECT pg_temp.check_review('approvals and reschedules remain visible',(public.list_processor_jobs(0,'STATE-')->>'total')::int=3);
SELECT pg_temp.check_review('paid cancelled done removed from active',(public.list_processor_jobs(0,'STATE-paid')->>'total')::int=0 AND (public.list_processor_jobs(0,'STATE-job_done')->>'total')::int=0 AND (public.list_processor_jobs(0,'STATE-cancelled')->>'total')::int=0);
SELECT pg_temp.check_review('foreign record remains RLS excluded',(public.list_processor_jobs(0,'ORDER-30',true)->>'total')::int=0);
RESET ROLE;
INSERT INTO public.lead_status_visibility(user_id,status,is_visible) VALUES('15000000-0000-4000-8000-000000000001','needs_reschedule',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_review('per-user visibility deny retained',(public.list_processor_jobs(0,'STATE-needs_reschedule')->>'total')::int=0);
RESET ROLE;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['customer_service','cs_admin','opr','opr_admin'] LOOP
  UPDATE public.user_roles SET role=r::public.app_role;
  BEGIN PERFORM public.list_processor_jobs(); PERFORM pg_temp.check_review(r||' denied',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_review(r||' denied',true); END;
 END LOOP;
 UPDATE public.user_roles SET role='admin';
 PERFORM pg_temp.check_review('admin sees authorized repair records',(public.list_processor_jobs()->>'total')::int=44);
END $$;
SELECT * FROM review_checks ORDER BY name;
ROLLBACK;
