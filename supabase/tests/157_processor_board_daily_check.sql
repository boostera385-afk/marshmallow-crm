-- WRITE-BASED, disposable fixture only; never run on shared production.
-- Behavioral checks for the daily Processor Board payment check.
BEGIN;
CREATE TEMP TABLE daily_checks(name text,result text);
GRANT ALL ON daily_checks TO authenticated;
CREATE FUNCTION pg_temp.check_daily(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO daily_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
DELETE FROM public.leads; DELETE FROM public.activity_logs; DELETE FROM net.fixture_requests; DELETE FROM vault.decrypted_secrets;
INSERT INTO public.leads(id,job_id,status,tech_number,scheduled_date,scheduled_time_start)
SELECT ('17000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,j,s,p,current_date-3,'10:00' FROM (VALUES
  (1,'SAVED-PAYMENT','payment_pending','4155550199'),
  (2,'JOB-DONE','job_done','(415) 555-0199'),
  (3,'AI-COMPLETED','scheduled','4155550199'),
  (4,'RECENTLY-CHECKED','payment_pending','4155550199'),
  (5,'APPROVAL','payment_requested','4155550199'),
  (6,'PAID','paid','4155550199'),
  (7,'NOT-DONE','scheduled','4155550199'),
  (8,'BAD-NUMBER','payment_pending','555-0199'),
  (9,'OTHER-TECH-FACTS','scheduled','4155550100')
) v(n,j,s,p);
INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
SELECT l.id,l.updated_at,'h',jsonb_build_object('policy',10,'tech_phone','4155550199','job_update',CASE WHEN l.job_id='NOT-DONE' THEN 'none' ELSE 'completed' END),
  now()-CASE WHEN l.job_id='RECENTLY-CHECKED' THEN interval '2 hours' ELSE interval '2 days' END
FROM public.leads l WHERE l.job_id IN ('AI-COMPLETED','RECENTLY-CHECKED','NOT-DONE','OTHER-TECH-FACTS','SAVED-PAYMENT');
SELECT pg_temp.check_daily('only completed, unpaid jobs not checked in 20h',
  (SELECT array_agg(l.job_id ORDER BY l.job_id) FROM public.processor_board_daily_candidates(10) c JOIN public.leads l ON l.id=c)
  = ARRAY['AI-COMPLETED','JOB-DONE','SAVED-PAYMENT']);
SELECT pg_temp.check_daily('never-checked jobs go first and the batch is bounded',
  (SELECT array_agg(l.job_id) FROM public.processor_board_daily_candidates(1) c JOIN public.leads l ON l.id=c) = ARRAY['JOB-DONE']
  AND (SELECT count(*) FROM public.processor_board_daily_candidates(500)) = 3);
CREATE TEMP TABLE unconfigured AS SELECT marshmallow_private.dispatch_processor_board_daily() AS ok;
SELECT pg_temp.check_daily('no dispatch until both Vault secrets exist', (SELECT ok FROM unconfigured) IS FALSE
  AND NOT EXISTS (SELECT 1 FROM net.fixture_requests));
INSERT INTO vault.decrypted_secrets VALUES('processor_board_daily_project_url','https://example.invalid/'),('processor_board_daily_cron_secret','synthetic-secret');
CREATE TEMP TABLE dispatched AS SELECT marshmallow_private.dispatch_processor_board_daily() AS ok;
SELECT pg_temp.check_daily('dispatches one bounded call with the cron secret', (SELECT ok FROM dispatched)
  AND (SELECT count(*) FROM net.fixture_requests)=1
  AND (SELECT url FROM net.fixture_requests)='https://example.invalid/functions/v1/processor-board-daily'
  AND (SELECT headers->>'x-cron-secret' FROM net.fixture_requests)='synthetic-secret'
  AND (SELECT (body->>'limit')::int FROM net.fixture_requests)=3);
UPDATE public.processor_job_assessments SET checked_at=now();
INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
SELECT id,updated_at,'h','{}'::jsonb,now() FROM public.leads WHERE job_id='JOB-DONE';
DELETE FROM net.fixture_requests;
CREATE TEMP TABLE idle AS SELECT marshmallow_private.dispatch_processor_board_daily() AS ok;
SELECT pg_temp.check_daily('idle run makes no call when every job was checked today', (SELECT ok FROM idle) IS FALSE
  AND NOT EXISTS (SELECT 1 FROM net.fixture_requests));
-- Saves: the daily check (NULL actor) is audited by name; a user still needs a profile.
INSERT INTO public.processor_job_refresh_locks VALUES('17000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-0000000000aa',now()+interval '1 minute');
CREATE TEMP TABLE saved AS SELECT public.save_processor_job_assessment('17000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-0000000000aa',(SELECT updated_at FROM public.leads WHERE job_id='SAVED-PAYMENT'),'h2','{"status":"payment_overdue"}',NULL) AS ok;
SELECT pg_temp.check_daily('daily-check save is audited as the daily check', (SELECT ok FROM saved)
  AND (SELECT user_name||'|'||coalesce(user_id::text,'null')||'|'||details FROM public.activity_logs) = 'Processor Board daily check|null|Job-specific advisory assessment: payment_overdue'
  AND (SELECT input_hash FROM public.processor_job_assessments WHERE lead_id='17000000-0000-4000-8000-000000000001')='h2');
DO $$ BEGIN
  PERFORM public.save_processor_job_assessment('17000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-0000000000aa',(SELECT updated_at FROM public.leads WHERE job_id='SAVED-PAYMENT'),'h3','{}','17000000-0000-4000-8000-0000000000ff');
  PERFORM pg_temp.check_daily('unknown user actor still rejected',false);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.check_daily('unknown user actor still rejected',true); END $$;
SELECT pg_temp.check_daily('stale save after a lead edit is refused',
  NOT public.save_processor_job_assessment('17000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-0000000000aa','2000-01-01','h4','{}',NULL));
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.processor_board_daily_candidates(3); PERFORM pg_temp.check_daily('browsers cannot list daily candidates',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_daily('browsers cannot list daily candidates',true); END;
  BEGIN PERFORM marshmallow_private.dispatch_processor_board_daily(); PERFORM pg_temp.check_daily('browsers cannot dispatch the worker',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_daily('browsers cannot dispatch the worker',true); END;
  BEGIN PERFORM public.save_processor_job_assessment('17000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-0000000000aa',now(),'x','{}',NULL); PERFORM pg_temp.check_daily('browsers cannot save as the daily check',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_daily('browsers cannot save as the daily check',true); END;
END $$;
RESET ROLE;
SELECT * FROM daily_checks ORDER BY name;
ROLLBACK;
