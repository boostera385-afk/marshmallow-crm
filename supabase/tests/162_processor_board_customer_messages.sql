-- WRITE-BASED, disposable fixture only; never run on shared production.
-- Behavioral checks for 20261127000000_processor_board_customer_messages.sql.
BEGIN;
CREATE TEMP TABLE customer_checks(name text,result text);
GRANT ALL ON customer_checks TO authenticated;
CREATE FUNCTION pg_temp.check_customer(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO customer_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
DELETE FROM public.processor_job_assessments; DELETE FROM public.quo_conversations; DELETE FROM public.leads; DELETE FROM public.user_roles;
DELETE FROM marshmallow_private.processor_check_attempts;
INSERT INTO public.user_roles VALUES('22000000-0000-4000-8000-000000000001','processor');
INSERT INTO public.leads(id,job_id,customer_name,customer_phone,status,tech_name,tech_number,scheduled_date,scheduled_time_start,created_at,updated_at) VALUES
 ('22000000-0000-4000-8000-000000000101','READ','A','(404) 555-0101','scheduled','Tech','4155550199',current_date+1,'10:00',now()-interval '2 days','2026-10-01T00:00:00Z'),
 ('22000000-0000-4000-8000-000000000102','OLD-RESULT','B','(404) 555-0102','scheduled','Tech','4155550199',current_date+1,'10:00',now()-interval '2 days','2026-10-01T00:00:00Z'),
 ('22000000-0000-4000-8000-000000000103','UNAVAILABLE','C','(404) 555-0103','scheduled','Tech','4155550199',current_date+1,'10:00',now()-interval '2 days','2026-10-01T00:00:00Z'),
 ('22000000-0000-4000-8000-000000000104','LINKED','D',NULL,'scheduled','Tech','4155550199',current_date+1,'10:00',now()-interval '2 days','2026-10-01T00:00:00Z');
INSERT INTO public.quo_conversations(id,customer_number,linked_lead_id,last_message_time) VALUES
 ('22000000-0000-4000-8000-0000000000c1','+14045550101',NULL,'2026-10-20T10:00:00Z'),
 ('22000000-0000-4000-8000-0000000000c2','+14045550102',NULL,'2026-10-20T10:00:00Z'),
 ('22000000-0000-4000-8000-0000000000c3','+14045550103',NULL,'2026-10-20T10:00:00Z'),
 ('22000000-0000-4000-8000-0000000000c4','+19995550000','22000000-0000-4000-8000-000000000104','2026-10-20T10:00:00Z');
-- Every job freshly checked with the current policy; only customer_chat differs.
INSERT INTO public.processor_job_assessments(lead_id,input_hash,result,checked_at,lead_updated_at)
SELECT l.id,'h',jsonb_build_object('policy',11,'tech_phone','4155550199','job_update','none','enough_context',true,'tech_took_job',true,'share_state','none',
  'mirror_conversation_id',NULL,'mirror_last_message_at',NULL) || CASE l.job_id
    WHEN 'READ' THEN jsonb_build_object('customer_chat',jsonb_build_object('state','read','messages',2,'omitted',0,'last_message_at','2026-10-20T10:00:00Z'))
    WHEN 'LINKED' THEN jsonb_build_object('customer_chat',jsonb_build_object('state','read','messages',1,'omitted',0,'last_message_at','2026-10-20T10:00:00Z'))
    WHEN 'UNAVAILABLE' THEN jsonb_build_object('customer_chat',jsonb_build_object('state','unavailable','messages',0,'omitted',0,'last_message_at',NULL))
    ELSE '{}'::jsonb END,
  now(),l.updated_at
FROM public.leads l;
SELECT pg_temp.check_customer('1 nothing is due while the customer chat is unchanged',NOT EXISTS(SELECT 1 FROM public.processor_board_due_jobs(10)));
UPDATE public.quo_conversations SET last_message_time='2026-10-21T09:00:00Z';
SELECT pg_temp.check_customer('2 a new customer message re-checks the job (by number or linked conversation)',
  (SELECT array_agg(l.job_id ORDER BY l.job_id) FROM public.processor_board_due_jobs(10) d JOIN public.leads l ON l.id=d)=ARRAY['LINKED','READ']);
SELECT pg_temp.check_customer('3 results from before this change and unreadable customer chats are never re-queued by it',
  NOT EXISTS(SELECT 1 FROM public.processor_board_due_jobs(10) d JOIN public.leads l ON l.id=d WHERE l.job_id IN ('OLD-RESULT','UNAVAILABLE')));
SELECT set_config('request.jwt.claim.sub','22000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_customer('4 the board marks the same jobs as having new activity',
  (SELECT array_agg(r->>'job_id' ORDER BY r->>'job_id') FROM jsonb_array_elements(public.list_processor_board_jobs()->'rows') r WHERE (r->>'ai_stale')::boolean)=ARRAY['LINKED','READ']);
RESET ROLE;
UPDATE public.processor_job_assessments SET result=jsonb_set(result,'{customer_chat,last_message_at}','"2026-10-21T09:00:00Z"') WHERE result ? 'customer_chat' AND result->'customer_chat'->>'state'='read';
SELECT pg_temp.check_customer('5 a check that read the new message clears it',NOT EXISTS(SELECT 1 FROM public.processor_board_due_jobs(10)));
SELECT * FROM customer_checks ORDER BY name;
ROLLBACK;
