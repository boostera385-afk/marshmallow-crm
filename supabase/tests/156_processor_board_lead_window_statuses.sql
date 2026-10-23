-- WRITE-BASED, disposable fixture only; never run on shared production.
-- Behavioral checks for list_processor_board_jobs / processor_board_status.
BEGIN;
CREATE TEMP TABLE board_checks(name text,result text);
GRANT ALL ON board_checks TO authenticated;
CREATE FUNCTION pg_temp.check_board(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO board_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
DELETE FROM public.leads; DELETE FROM public.user_roles; DELETE FROM public.lead_status_visibility;
INSERT INTO public.user_roles VALUES('16000000-0000-4000-8000-000000000001','processor');
INSERT INTO public.quo_conversations VALUES('16000000-0000-4000-8000-0000000000c1','2026-10-20T10:00:00Z');
-- created_at increases with n, so the expected order is the reverse of n.
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,tech_number,scheduled_date,scheduled_time_start,created_at,updated_at)
SELECT ('16000000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,j,'Customer '||j,s,t,p,d,'10:00',timestamptz '2026-10-01T00:00:00Z'+n*interval '1 hour',timestamptz '2026-10-15T00:00:00Z'
FROM (VALUES
  (1,'UPCOMING','scheduled','Tech','4155550199',current_date+3),
  (2,'PASSED','scheduled','Tech','4155550199',current_date-2),
  (3,'SAVED-PROGRESS','job_in_progress','Tech','4155550199',current_date-2),
  (4,'SAVED-PAYMENT','payment_pending','Tech','4155550199',current_date-2),
  (5,'JOB-DONE','job_done','Tech','4155550199',current_date-2),
  (6,'AI-COMPLETED','scheduled','Tech','4155550199',current_date-2),
  (7,'AI-PROGRESS','scheduled','Tech','4155550199',current_date-2),
  (8,'AI-DOSE','scheduled','Tech','4155550199',current_date+3),
  (9,'AI-WAITING-SHORT','scheduled','Tech','4155550199',current_date-2),
  (10,'AI-NO-CONTEXT','scheduled','Tech','4155550199',current_date-2),
  (11,'AI-REASSIGNED','scheduled','Tech','4155550100',current_date-2),
  (12,'AI-OLD-POLICY','scheduled','Tech','4155550199',current_date+3),
  (13,'AI-STALE','scheduled','Tech','4155550199',current_date+3),
  (14,'NAME-ONLY','scheduled','Tech',NULL,current_date+3),
  (15,'NO-TECH','scheduled',NULL,'  ',current_date+3),
  (16,'PAID','paid','Tech','4155550199',current_date-2),
  (17,'PARTIAL','partial_paid','Tech','4155550199',current_date-2),
  (18,'CANCELLED','cancelled','Tech','4155550199',current_date-2),
  (19,'SCAMMED','scammed','Tech','4155550199',current_date-2),
  (20,'UNSCHEDULED-QUOTE','needs_quote','Tech','4155550199',NULL),
  (30,'FOREIGN','scheduled','Tech','4155550199',current_date-2),
  (-1,'PAY-RECENT','scheduled','Tech','4155550199',current_date-2),
  (-2,'PAY-PROMISED','scheduled','Tech','4155550199',current_date-5),
  (-3,'PAY-PROMISE-PASSED','scheduled','Tech','4155550199',current_date-9),
  (-4,'PAY-REQUESTED','payment_requested','Tech','4155550199',current_date-9),
  (-5,'PAY-DOSE','payment_pending','Tech','4155550199',current_date-9)
) v(n,j,s,t,p,d);
UPDATE public.leads SET id='15000000-0000-4000-8000-000000000030' WHERE job_id='FOREIGN';
INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
SELECT l.id,l.updated_at,'h',r::jsonb,now() FROM public.leads l JOIN (VALUES
  ('AI-COMPLETED','{"policy":10,"tech_phone":"4155550199","enough_context":true,"tech_took_job":true,"job_update":"completed","waiting_since":null,"payment":{"state":"waiting_on_customer"},"customer_last_message_at":"2026-10-20T09:00:00Z"}'),
  ('AI-PROGRESS','{"policy":10,"tech_phone":"4155550199","enough_context":true,"tech_took_job":true,"job_update":"in_progress","waiting_since":null}'),
  ('AI-NO-CONTEXT','{"policy":10,"tech_phone":"4155550199","enough_context":false,"tech_took_job":false,"job_update":"none","waiting_since":null}'),
  ('AI-REASSIGNED','{"policy":10,"tech_phone":"4155550199","enough_context":false,"tech_took_job":false,"job_update":"none","waiting_since":null}'),
  ('AI-OLD-POLICY','{"status":"send_dose","tech_phone":"4155550199"}'),
  ('AI-STALE','{"policy":10,"tech_phone":"4155550199","enough_context":true,"tech_took_job":true,"job_update":"in_progress","waiting_since":null,"mirror_conversation_id":"16000000-0000-4000-8000-0000000000c1","mirror_last_message_at":"2026-10-20T10:00:00Z"}')
) v(j,r) ON v.j=l.job_id;
INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
SELECT id,updated_at,'h',jsonb_build_object('policy',10,'tech_phone','4155550199','enough_context',true,'tech_took_job',true,'job_update','none',
  'waiting_since',to_jsonb(now()-CASE WHEN job_id='AI-DOSE' THEN interval '2 hours' ELSE interval '20 minutes' END)),now()
FROM public.leads WHERE job_id IN ('AI-DOSE','AI-WAITING-SHORT');
INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
SELECT id,updated_at,'h',jsonb_build_object('policy',10,'tech_phone','4155550199','enough_context',true,'tech_took_job',true,
  'job_update',CASE WHEN job_id='PAY-DOSE' THEN 'none' ELSE 'completed' END,
  'waiting_since',CASE WHEN job_id='PAY-DOSE' THEN to_jsonb(now()-interval '2 hours') ELSE 'null'::jsonb END,
  'completed_at',to_jsonb(now()-CASE WHEN job_id='PAY-RECENT' THEN interval '2 hours' ELSE interval '3 days' END),
  'payment',jsonb_build_object('state','promised','promised_date',CASE WHEN job_id='PAY-PROMISED' THEN to_char(current_date+5,'YYYY-MM-DD') ELSE to_char(current_date-5,'YYYY-MM-DD') END)),now()
FROM public.leads WHERE job_id LIKE 'PAY-%';
INSERT INTO public.quo_conversations(id,last_message_time,linked_lead_id) SELECT '16000000-0000-4000-8000-0000000000c2','2026-10-20T09:00:00Z',id FROM public.leads WHERE job_id='AI-COMPLETED';
SELECT set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
CREATE TEMP VIEW board_rows AS SELECT r->>'job_id' AS job_id, r->>'board_status' AS status, (r->>'ai_stale')::boolean AS stale, n
  FROM jsonb_array_elements(public.list_processor_board_jobs()->'rows') WITH ORDINALITY a(r,n);
CREATE TEMP VIEW board_rows_2 AS SELECT r->>'job_id' AS job_id, r->>'board_status' AS status, (r->>'ai_stale')::boolean AS stale
  FROM jsonb_array_elements(public.list_processor_board_jobs(25)->'rows') r;
CREATE TEMP VIEW all_rows AS SELECT job_id,status,stale FROM board_rows UNION ALL SELECT * FROM board_rows_2;
SELECT pg_temp.check_board('assigned, unfinished jobs only (RLS-excluded record hidden)',
  (SELECT array_agg(job_id ORDER BY job_id) FROM all_rows) = ARRAY['AI-COMPLETED','AI-DOSE','AI-NO-CONTEXT','AI-OLD-POLICY','AI-PROGRESS','AI-REASSIGNED','AI-STALE','AI-WAITING-SHORT','JOB-DONE','NAME-ONLY','PASSED','PAY-DOSE','PAY-PROMISE-PASSED','PAY-PROMISED','PAY-RECENT','PAY-REQUESTED','SAVED-PAYMENT','SAVED-PROGRESS','UPCOMING']);
SELECT pg_temp.check_board('newest lead first',(SELECT array_agg(job_id ORDER BY n) FROM board_rows WHERE n<=3)=ARRAY['NAME-ONLY','AI-STALE','AI-OLD-POLICY']);
SELECT pg_temp.check_board('paid, partial paid, cancelled and scammed excluded',(public.list_processor_board_jobs(0,'PA')->>'total')::int=7
  AND (public.list_processor_board_jobs(0,'CANCELLED')->>'total')::int=0 AND (public.list_processor_board_jobs(0,'SCAMMED')->>'total')::int=0);
SELECT pg_temp.check_board('upcoming before appointment',(SELECT status FROM all_rows WHERE job_id='UPCOMING')='upcoming');
SELECT pg_temp.check_board('take job update after appointment without facts',(SELECT status FROM all_rows WHERE job_id='PASSED')='take_job_update');
SELECT pg_temp.check_board('saved in progress kept',(SELECT status FROM all_rows WHERE job_id='SAVED-PROGRESS')='job_in_progress');
SELECT pg_temp.check_board('saved payment pending / job done 24h after the appointment -> payment overdue',(SELECT array_agg(status) FROM all_rows WHERE job_id IN ('SAVED-PAYMENT','JOB-DONE'))=ARRAY['payment_overdue','payment_overdue']);
SELECT pg_temp.check_board('tech completed, no completion time, appointment days ago -> payment overdue',(SELECT status FROM all_rows WHERE job_id='AI-COMPLETED')='payment_overdue');
SELECT pg_temp.check_board('completed under 24h ago -> payment pending',(SELECT status FROM all_rows WHERE job_id='PAY-RECENT')='payment_pending');
SELECT pg_temp.check_board('customer promised a later date -> still payment pending',(SELECT status FROM all_rows WHERE job_id='PAY-PROMISED')='payment_pending');
SELECT pg_temp.check_board('promised date passed -> payment overdue',(SELECT status FROM all_rows WHERE job_id='PAY-PROMISE-PASSED')='payment_overdue');
SELECT pg_temp.check_board('payment approval with the office never overdue',(SELECT status FROM all_rows WHERE job_id='PAY-REQUESTED')='payment_pending');
SELECT pg_temp.check_board('tech ignoring us after completion -> send dose',(SELECT status FROM all_rows WHERE job_id='PAY-DOSE')='send_dose');
SELECT pg_temp.check_board('payment check not stale while customer chat unchanged',(SELECT stale FROM all_rows WHERE job_id='AI-COMPLETED') IS FALSE);
SELECT pg_temp.check_board('tech update -> job in progress',(SELECT status FROM all_rows WHERE job_id='AI-PROGRESS')='job_in_progress');
SELECT pg_temp.check_board('took job then silent 60+ min -> send dose',(SELECT status FROM all_rows WHERE job_id='AI-DOSE')='send_dose');
SELECT pg_temp.check_board('silent under 60 min stays take job update',(SELECT status FROM all_rows WHERE job_id='AI-WAITING-SHORT')='take_job_update');
SELECT pg_temp.check_board('no chat context -> not enough details',(SELECT status FROM all_rows WHERE job_id='AI-NO-CONTEXT')='not_enough_details');
SELECT pg_temp.check_board('facts for another technician ignored',(SELECT status FROM all_rows WHERE job_id='AI-REASSIGNED')='take_job_update');
SELECT pg_temp.check_board('old-policy result ignored',(SELECT status FROM all_rows WHERE job_id='AI-OLD-POLICY')='upcoming');
SELECT pg_temp.check_board('fresh result not stale',(SELECT stale FROM all_rows WHERE job_id='AI-STALE') IS FALSE);
RESET ROLE;
UPDATE public.quo_conversations SET last_message_time='2026-10-21T10:00:00Z';
UPDATE public.leads SET updated_at='2026-10-16T00:00:00Z' WHERE job_id='AI-PROGRESS';
UPDATE public.quo_conversations SET last_message_time='2026-10-21T09:00:00Z' WHERE id='16000000-0000-4000-8000-0000000000c2';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_board('new chat activity marks stale but keeps status',(SELECT stale FROM all_rows WHERE job_id='AI-STALE') AND (SELECT status FROM all_rows WHERE job_id='AI-STALE')='job_in_progress');
SELECT pg_temp.check_board('lead edit marks stale',(SELECT stale FROM all_rows WHERE job_id='AI-PROGRESS'));
SELECT pg_temp.check_board('new customer message re-checks a payment job',(SELECT stale FROM all_rows WHERE job_id='AI-COMPLETED'));
SELECT pg_temp.check_board('customer messages do not re-check non-payment jobs',(SELECT stale FROM all_rows WHERE job_id='AI-DOSE') IS FALSE);
SELECT pg_temp.check_board('unchecked job not stale',(SELECT stale FROM all_rows WHERE job_id='PASSED') IS FALSE);
SELECT pg_temp.check_board('counts cover all matching jobs',public.list_processor_board_jobs()->'counts'=
  '{"upcoming":3,"take_job_update":3,"job_in_progress":3,"payment_pending":3,"payment_overdue":4,"send_dose":2,"not_enough_details":1}'::jsonb
  AND (public.list_processor_board_jobs()->>'all_total')::int=19);
SELECT pg_temp.check_board('status filter narrows rows and total',(public.list_processor_board_jobs(0,'','America/New_York','payment_overdue')->>'total')::int=4
  AND (SELECT bool_and(r->>'board_status'='payment_overdue') FROM jsonb_array_elements(public.list_processor_board_jobs(0,'','America/New_York','payment_overdue')->'rows') r)
  AND (public.list_processor_board_jobs(0,'','America/New_York','payment_overdue')->>'all_total')::int=19);
SELECT pg_temp.check_board('search combines with status filter',(public.list_processor_board_jobs(0,'AI-','America/New_York','job_in_progress')->>'total')::int=2);
RESET ROLE;
DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.list_processor_board_jobs(0,'','America/New_York','needs_review'); PERFORM pg_temp.check_board('unknown status filter rejected',false);
  EXCEPTION WHEN invalid_parameter_value THEN PERFORM pg_temp.check_board('unknown status filter rejected',true); END;
  RESET ROLE;
END $$;
INSERT INTO public.lead_status_visibility(user_id,status,is_visible) VALUES('16000000-0000-4000-8000-000000000001','job_done',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_board('per-user status visibility deny retained',(public.list_processor_board_jobs(0,'JOB-DONE')->>'total')::int=0);
RESET ROLE;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['customer_service','cs_admin','opr','opr_admin'] LOOP
  UPDATE public.user_roles SET role=r::public.app_role;
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.list_processor_board_jobs(); PERFORM pg_temp.check_board(r||' denied',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_board(r||' denied',true); END;
  RESET ROLE;
 END LOOP;
 UPDATE public.user_roles SET role='admin';
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.check_board('admin sees the same scoped board',(public.list_processor_board_jobs()->>'all_total')::int=19);
 RESET ROLE;
END $$;
SELECT * FROM board_checks ORDER BY name;
ROLLBACK;
