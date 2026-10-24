-- WRITE-BASED, disposable fixture only; never run on shared production.
-- Behavioral checks for 20261124000000_processor_board_send_dose_worker.sql.
BEGIN;
CREATE TEMP TABLE worker_checks(name text,result text);
GRANT ALL ON worker_checks TO authenticated;
CREATE FUNCTION pg_temp.check_worker(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO worker_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
DELETE FROM public.leads; DELETE FROM public.user_roles; DELETE FROM public.quo_conversations; DELETE FROM public.activity_logs;
DELETE FROM net.fixture_requests; DELETE FROM vault.decrypted_secrets;
INSERT INTO public.user_roles VALUES('19000000-0000-4000-8000-000000000001','processor');
INSERT INTO public.profiles VALUES('19000000-0000-4000-8000-000000000001','Synthetic Processor') ON CONFLICT DO NOTHING;
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,tech_number,scheduled_date,scheduled_time_start,created_at)
SELECT ('19000000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,j,'Customer '||j,s,'Tech',p,current_date+d,'10:00',timestamptz '2026-10-01T00:00:00Z'+n*interval '1 hour'
FROM (VALUES
  (1,'NUMBER-MISSING','scheduled',NULL,2),
  (2,'NUMBER-9-DIGITS','scheduled','415555019',2),
  (3,'NUMBER-12-DIGITS','scheduled','141555501990',2),
  (4,'NUMBER-11-NOT-1','scheduled','24155550199',2),
  (5,'NUMBER-11-WITH-1','scheduled','+1 (415) 555-0199',2),
  (6,'DONE-4-DAYS','scheduled','4155550199',-4),
  (7,'DONE-2-DAYS','scheduled','4155550199',-2),
  (8,'SAVED-PAYMENT-4-DAYS','payment_pending','4155550199',-4),
  (9,'JOB-DONE-4-DAYS','job_done','4155550199',-4),
  (10,'APPROVAL-10-DAYS','payment_requested','4155550199',-10),
  (11,'CHAT-IN-PROGRESS-10-DAYS','scheduled','4155550199',-10),
  (12,'SAVED-IN-PROGRESS-10-DAYS','job_in_progress','4155550199',-10),
  (13,'TOOK-JOB-4-DAYS','scheduled','4155550199',-4),
  (14,'TOOK-JOB-2-DAYS','scheduled','4155550199',-2),
  (15,'NEVER-CHECKED-10-DAYS','scheduled','4155550199',-10),
  (16,'OLD-60-MIN-RULE','scheduled','4155550199',3)
) v(n,j,s,p,d);
-- 30 more upcoming jobs prove the list is not paginated.
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,tech_number,scheduled_date,scheduled_time_start,created_at)
SELECT ('19000000-0000-4000-8000-'||lpad((n+500)::text,12,'0'))::uuid,'BULK-'||n,'Bulk','scheduled','Tech','4155550199',current_date+5,'10:00',timestamptz '2026-09-01T00:00:00Z'+n*interval '1 hour'
FROM generate_series(1,30) n;
INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
SELECT l.id,l.updated_at,'h',jsonb_build_object('policy',10,'tech_phone','4155550199','enough_context',true,'tech_took_job',v.took,'job_update',v.upd,
  'waiting_since',CASE WHEN l.job_id='OLD-60-MIN-RULE' THEN to_jsonb(now()-interval '2 hours') ELSE 'null'::jsonb END,
  'summary','Long AI summary that must not be sent with the list','evidence','[{"quote":"secret quote"}]'::jsonb),now()
FROM public.leads l JOIN (VALUES
  ('DONE-4-DAYS',true,'completed'),('DONE-2-DAYS',true,'completed'),('CHAT-IN-PROGRESS-10-DAYS',true,'in_progress'),
  ('TOOK-JOB-4-DAYS',true,'none'),('TOOK-JOB-2-DAYS',true,'none'),('OLD-60-MIN-RULE',true,'none'),('NUMBER-11-WITH-1',true,'none')
) v(j,took,upd) ON v.j=l.job_id;
SELECT set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
CREATE TEMP VIEW rows_now AS SELECT r->>'job_id' AS job_id, r->>'board_status' AS status, r AS raw FROM jsonb_array_elements(public.list_processor_board_jobs()->'rows') r;
SELECT pg_temp.check_worker('missing or malformed tech number -> wrong tech number',
  (SELECT array_agg(status ORDER BY job_id) FROM rows_now WHERE job_id LIKE 'NUMBER-%' AND job_id <> 'NUMBER-11-WITH-1') = ARRAY['wrong_tech_number','wrong_tech_number','wrong_tech_number','wrong_tech_number']);
SELECT pg_temp.check_worker('11 digits with a leading 1 is a valid number',(SELECT status FROM rows_now WHERE job_id='NUMBER-11-WITH-1')='upcoming');
SELECT pg_temp.check_worker('completed and unpaid 3+ days after the schedule -> send dose',(SELECT status FROM rows_now WHERE job_id='DONE-4-DAYS')='send_dose');
SELECT pg_temp.check_worker('completed under 3 days after the schedule -> payment pending',(SELECT status FROM rows_now WHERE job_id='DONE-2-DAYS')='payment_pending');
SELECT pg_temp.check_worker('saved payment pending / job done 3+ days -> send dose',(SELECT array_agg(status ORDER BY job_id) FROM rows_now WHERE job_id IN ('SAVED-PAYMENT-4-DAYS','JOB-DONE-4-DAYS'))=ARRAY['send_dose','send_dose']);
SELECT pg_temp.check_worker('payment approval with the office stays payment pending',(SELECT status FROM rows_now WHERE job_id='APPROVAL-10-DAYS')='payment_pending');
SELECT pg_temp.check_worker('chat says still working -> job in progress, never send dose',(SELECT status FROM rows_now WHERE job_id='CHAT-IN-PROGRESS-10-DAYS')='job_in_progress');
SELECT pg_temp.check_worker('saved in progress -> job in progress, never send dose',(SELECT status FROM rows_now WHERE job_id='SAVED-IN-PROGRESS-10-DAYS')='job_in_progress');
SELECT pg_temp.check_worker('took the job, no update, 3+ days -> send dose',(SELECT status FROM rows_now WHERE job_id='TOOK-JOB-4-DAYS')='send_dose');
SELECT pg_temp.check_worker('took the job, schedule passed under 3 days -> take job update',(SELECT status FROM rows_now WHERE job_id='TOOK-JOB-2-DAYS')='take_job_update');
SELECT pg_temp.check_worker('never checked -> take job update, not send dose',(SELECT status FROM rows_now WHERE job_id='NEVER-CHECKED-10-DAYS')='take_job_update');
SELECT pg_temp.check_worker('60-minute unanswered rule removed',(SELECT status FROM rows_now WHERE job_id='OLD-60-MIN-RULE')='upcoming');
SELECT pg_temp.check_worker('every job returned, no pagination',(SELECT count(*) FROM rows_now)=46 AND (public.list_processor_board_jobs()->>'total')::int=46);
SELECT pg_temp.check_worker('list carries a compact summary, not full evidence',
  (SELECT raw ? 'assessment' FROM rows_now WHERE job_id='DONE-4-DAYS') IS FALSE
  AND (SELECT raw->'ai_summary'->>'job_update' FROM rows_now WHERE job_id='DONE-4-DAYS')='completed'
  AND position('secret quote' IN (SELECT string_agg(raw::text,'') FROM rows_now))=0
  AND position('Long AI summary' IN (SELECT string_agg(raw::text,'') FROM rows_now))=0);
SELECT pg_temp.check_worker('ai_stale is true/false on every row',(SELECT bool_and(jsonb_typeof(raw->'ai_stale')='boolean') FROM rows_now));
SELECT pg_temp.check_worker('wrong tech number filter and counts',(public.list_processor_board_jobs(0,'','America/New_York','wrong_tech_number')->>'total')::int=4
  AND (public.list_processor_board_jobs()->'counts'->>'wrong_tech_number')::int=4 AND NOT (public.list_processor_board_jobs()->'counts' ? 'payment_overdue'));
DO $$ BEGIN
  BEGIN PERFORM public.list_processor_board_jobs(0,'','America/New_York','payment_overdue'); PERFORM pg_temp.check_worker('payment overdue filter removed',false);
  EXCEPTION WHEN invalid_parameter_value THEN PERFORM pg_temp.check_worker('payment overdue filter removed',true); END;
  BEGIN PERFORM public.processor_board_due_jobs(5); PERFORM pg_temp.check_worker('browsers cannot read the worker queue',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_worker('browsers cannot read the worker queue',true); END;
  BEGIN PERFORM public.record_processor_check_attempt('19000000-0000-4000-8000-000000000106',false,'x'); PERFORM pg_temp.check_worker('browsers cannot write retry state',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_worker('browsers cannot write retry state',true); END;
END $$;
RESET ROLE;
-- Worker queue. Make every checked job current, then change specific ones.
UPDATE public.processor_job_assessments SET checked_at=now();
CREATE TEMP TABLE queue_all AS SELECT l.job_id FROM public.processor_board_due_jobs(10) d JOIN public.leads l ON l.id=d;
SELECT pg_temp.check_worker('queue: never-checked jobs, never wrong numbers',
  (SELECT bool_and(job_id NOT LIKE 'NUMBER-%' OR job_id='NUMBER-11-WITH-1') FROM queue_all)
  AND (SELECT count(*) FROM queue_all)=10
  AND NOT EXISTS (SELECT 1 FROM queue_all WHERE job_id IN ('DONE-4-DAYS','TOOK-JOB-4-DAYS','CHAT-IN-PROGRESS-10-DAYS')));
UPDATE public.leads SET updated_at=now()+interval '1 minute' WHERE job_id='TOOK-JOB-2-DAYS';
UPDATE public.processor_job_assessments SET checked_at=now()-interval '2 days' WHERE lead_id=(SELECT id FROM public.leads WHERE job_id='DONE-4-DAYS');
CREATE TEMP TABLE queue_order AS SELECT l.job_id, n FROM public.processor_board_due_jobs(10) WITH ORDINALITY d(id,n) JOIN public.leads l ON l.id=d.id;
SELECT pg_temp.check_worker('queue: changed job first, never-checked next, daily check last',
  (SELECT job_id FROM queue_order WHERE n=1)='TOOK-JOB-2-DAYS'
  AND (SELECT max(n) FROM queue_order WHERE job_id NOT IN ('TOOK-JOB-2-DAYS','DONE-4-DAYS')) < coalesce((SELECT n FROM queue_order WHERE job_id='DONE-4-DAYS'),99));
INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
SELECT l.id,l.updated_at,'h',jsonb_build_object('policy',10,'tech_phone','4155550199','job_update','none'),now()
FROM public.leads l WHERE public.processor_tech_phone_key(l.tech_number) IS NOT NULL ON CONFLICT (lead_id) DO NOTHING;
UPDATE public.processor_job_assessments SET lead_updated_at=(SELECT updated_at FROM public.leads WHERE job_id='TOOK-JOB-2-DAYS')
  WHERE lead_id=(SELECT id FROM public.leads WHERE job_id='TOOK-JOB-2-DAYS');
SELECT pg_temp.check_worker('queue: only the completed job not checked in 20h is due once everything else is current',
  (SELECT array_agg(l.job_id) FROM public.processor_board_due_jobs(10) d JOIN public.leads l ON l.id=d)=ARRAY['DONE-4-DAYS']);
UPDATE public.leads SET updated_at=now()+interval '2 minutes' WHERE job_id='TOOK-JOB-2-DAYS';
-- Backoff: a failing job leaves the queue and comes back after its retry time.
SELECT public.record_processor_check_attempt((SELECT id FROM public.leads WHERE job_id='TOOK-JOB-2-DAYS'),false,'chat_setup');
SELECT pg_temp.check_worker('queue: failed job waits out its backoff',
  'TOOK-JOB-2-DAYS' NOT IN (SELECT l.job_id FROM public.processor_board_due_jobs(10) d JOIN public.leads l ON l.id=d));
SELECT public.record_processor_check_attempt((SELECT id FROM public.leads WHERE job_id='TOOK-JOB-2-DAYS'),false,'chat_setup');
SELECT pg_temp.check_worker('backoff doubles and is capped',
  (SELECT failures FROM marshmallow_private.processor_check_attempts)=2
  AND (SELECT retry_at BETWEEN now()+interval '29 minutes' AND now()+interval '31 minutes' FROM marshmallow_private.processor_check_attempts));
UPDATE marshmallow_private.processor_check_attempts SET failures=20;
SELECT public.record_processor_check_attempt((SELECT id FROM public.leads WHERE job_id='TOOK-JOB-2-DAYS'),false,'chat_setup');
SELECT pg_temp.check_worker('backoff never exceeds 24 hours',(SELECT retry_at <= now()+interval '24 hours' FROM marshmallow_private.processor_check_attempts));
INSERT INTO public.processor_job_refresh_locks VALUES((SELECT id FROM public.leads WHERE job_id='TOOK-JOB-2-DAYS'),'19000000-0000-4000-8000-0000000000aa',now()+interval '1 minute');
CREATE TEMP TABLE saved_ok AS SELECT public.save_processor_job_assessment((SELECT id FROM public.leads WHERE job_id='TOOK-JOB-2-DAYS'),'19000000-0000-4000-8000-0000000000aa',
  (SELECT updated_at FROM public.leads WHERE job_id='TOOK-JOB-2-DAYS'),'h2','{"policy":10,"tech_phone":"4155550199","status":"take_job_update"}',NULL) AS ok;
SELECT pg_temp.check_worker('a successful save clears the retry state',(SELECT ok FROM saved_ok) AND NOT EXISTS (SELECT 1 FROM marshmallow_private.processor_check_attempts));
-- Dispatcher.
INSERT INTO vault.decrypted_secrets VALUES('processor_board_daily_project_url','https://example.invalid'),('processor_board_daily_cron_secret','synthetic-secret');
CREATE TEMP TABLE dispatched AS SELECT marshmallow_private.dispatch_processor_board_daily() AS ok;
SELECT pg_temp.check_worker('dispatcher calls the worker for 5 jobs when work is due',(SELECT ok FROM dispatched)
  AND (SELECT (body->>'limit')::int FROM net.fixture_requests)=5 AND (SELECT count(*) FROM net.fixture_requests)=1);
UPDATE public.processor_job_assessments SET checked_at=now();
INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
SELECT l.id,l.updated_at,'h',jsonb_build_object('policy',10,'tech_phone','4155550199','job_update','none'),now()
FROM public.leads l WHERE public.processor_tech_phone_key(l.tech_number) IS NOT NULL ON CONFLICT (lead_id) DO NOTHING;
DELETE FROM net.fixture_requests;
CREATE TEMP TABLE idle AS SELECT marshmallow_private.dispatch_processor_board_daily() AS ok;
SELECT pg_temp.check_worker('dispatcher makes no call when nothing changed',(SELECT ok FROM idle) IS FALSE AND NOT EXISTS (SELECT 1 FROM net.fixture_requests));
SELECT pg_temp.check_worker('retry table has row level security on',(SELECT relrowsecurity FROM pg_class WHERE oid='marshmallow_private.processor_check_attempts'::regclass));
SELECT * FROM worker_checks ORDER BY name;
ROLLBACK;
