-- WRITE-BASED, disposable fixture only; never run on shared production.
-- Behavioral checks for 20261125000000_processor_board_job_timeline.sql.
BEGIN;
CREATE TEMP TABLE timeline_checks(name text,result text);
GRANT ALL ON timeline_checks TO authenticated;
CREATE FUNCTION pg_temp.check_timeline(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO timeline_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
DELETE FROM public.leads; DELETE FROM public.user_roles; DELETE FROM public.quo_conversations; DELETE FROM marshmallow_private.processor_check_attempts;
INSERT INTO public.user_roles VALUES('20000000-0000-4000-8000-000000000001','processor');
INSERT INTO public.leads(id,job_id,customer_name,customer_phone,status,tech_name,tech_number,scheduled_date,scheduled_time_start)
SELECT ('20000000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,j,'Customer '||j,'(404) 555-01'||lpad(n::text,2,'0'),s,'Tech','4155550199',current_date+d,'10:00'
FROM (VALUES
  (1,'SHARE-SENT-10-DAYS','scheduled',-10),
  (2,'SHARE-RECEIVED-10-DAYS','scheduled',-10),
  (3,'SHARE-REQUESTED-4-DAYS','scheduled',-4),
  (4,'SHARE-PROMISED-4-DAYS','scheduled',-4),
  (5,'SHARE-REQUESTED-2-DAYS','scheduled',-2),
  (6,'OLD-POLICY-COMPLETED-4-DAYS','scheduled',-4),
  (7,'SAVED-PAYMENT-SHARE-SENT','payment_pending',-10),
  (8,'CURRENT-NOT-DONE','scheduled',3)
) v(n,j,s,d);
INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
SELECT l.id,l.updated_at,'h',jsonb_build_object('policy',v.policy,'tech_phone','4155550199','enough_context',true,'tech_took_job',true,'job_update',v.upd,'share_state',v.share,
  'timeline',jsonb_build_object('share_sent',CASE WHEN v.share='sent' THEN jsonb_build_object('at','2026-10-10T10:00:00Z') END),
  'payment',CASE WHEN l.job_id='CURRENT-NOT-DONE' THEN '{"state":"waiting_on_customer"}'::jsonb END,'customer_last_message_at','2026-10-01T00:00:00Z'),now()
FROM public.leads l JOIN (VALUES
  ('SHARE-SENT-10-DAYS',11,'none','sent'),('SHARE-RECEIVED-10-DAYS',11,'none','received'),('SHARE-REQUESTED-4-DAYS',11,'none','requested'),
  ('SHARE-PROMISED-4-DAYS',11,'none','promised'),('SHARE-REQUESTED-2-DAYS',11,'none','requested'),('OLD-POLICY-COMPLETED-4-DAYS',10,'completed','none'),
  ('SAVED-PAYMENT-SHARE-SENT',11,'none','sent'),('CURRENT-NOT-DONE',11,'none','none')
) v(j,policy,upd,share) ON v.j=l.job_id;
-- A customer conversation with newer activity must no longer re-check anything.
INSERT INTO public.quo_conversations(id,last_message_time,customer_number) VALUES('20000000-0000-4000-8000-0000000000c1','2026-10-20T00:00:00Z','+14045550108');
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
CREATE TEMP VIEW t_rows AS SELECT r->>'job_id' AS job_id, r->>'board_status' AS status, r AS raw FROM jsonb_array_elements(public.list_processor_board_jobs()->'rows') r;
SELECT pg_temp.check_timeline('share sent by the tech is never send dose',(SELECT status FROM t_rows WHERE job_id='SHARE-SENT-10-DAYS')='payment_pending');
SELECT pg_temp.check_timeline('share received is never send dose',(SELECT status FROM t_rows WHERE job_id='SHARE-RECEIVED-10-DAYS')='payment_pending');
SELECT pg_temp.check_timeline('share requested, not sent, 3+ days -> send dose',(SELECT status FROM t_rows WHERE job_id='SHARE-REQUESTED-4-DAYS')='send_dose');
SELECT pg_temp.check_timeline('share promised, not sent, 3+ days -> send dose',(SELECT status FROM t_rows WHERE job_id='SHARE-PROMISED-4-DAYS')='send_dose');
SELECT pg_temp.check_timeline('share request means done: under 3 days -> payment pending',(SELECT status FROM t_rows WHERE job_id='SHARE-REQUESTED-2-DAYS')='payment_pending');
SELECT pg_temp.check_timeline('previous-version result still shown until re-checked',(SELECT status FROM t_rows WHERE job_id='OLD-POLICY-COMPLETED-4-DAYS')='send_dose');
SELECT pg_temp.check_timeline('saved payment pending with share sent -> payment pending',(SELECT status FROM t_rows WHERE job_id='SAVED-PAYMENT-SHARE-SENT')='payment_pending');
SELECT pg_temp.check_timeline('summary carries share state and time, no customer payment',
  (SELECT raw->'ai_summary'->>'share_state' FROM t_rows WHERE job_id='SHARE-SENT-10-DAYS')='sent'
  AND (SELECT raw->'ai_summary'->>'share_at' FROM t_rows WHERE job_id='SHARE-SENT-10-DAYS')='2026-10-10T10:00:00Z'
  AND NOT EXISTS (SELECT 1 FROM t_rows WHERE raw->'ai_summary' ? 'payment_state'));
SELECT pg_temp.check_timeline('customer chat activity no longer marks a job stale',(SELECT (raw->>'ai_stale')::boolean FROM t_rows WHERE job_id='CURRENT-NOT-DONE') IS FALSE);
RESET ROLE;
CREATE TEMP TABLE due AS SELECT l.job_id, n FROM public.processor_board_due_jobs(10) WITH ORDINALITY d(id,n) JOIN public.leads l ON l.id=d.id;
SELECT pg_temp.check_timeline('previous-version results are queued for one re-check',(SELECT array_agg(job_id) FROM due)=ARRAY['OLD-POLICY-COMPLETED-4-DAYS']);
UPDATE public.processor_job_assessments SET checked_at=now()-interval '2 days';
CREATE TEMP TABLE due_daily AS SELECT l.job_id FROM public.processor_board_due_jobs(10) d JOIN public.leads l ON l.id=d;
SELECT pg_temp.check_timeline('daily re-check covers done jobs until the share is received',
  (SELECT array_agg(job_id ORDER BY job_id) FROM due_daily WHERE job_id<>'OLD-POLICY-COMPLETED-4-DAYS')
  = ARRAY['SAVED-PAYMENT-SHARE-SENT','SHARE-PROMISED-4-DAYS','SHARE-REQUESTED-2-DAYS','SHARE-REQUESTED-4-DAYS','SHARE-SENT-10-DAYS']);
SELECT * FROM timeline_checks ORDER BY name;
ROLLBACK;
