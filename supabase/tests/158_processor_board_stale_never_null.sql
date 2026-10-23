-- WRITE-BASED, disposable fixture only; never run on shared production.
-- Regression: ai_stale must be true/false for every row, including unchecked jobs
-- whose customer has a saved CRM conversation.
BEGIN;
CREATE TEMP TABLE stale_checks(name text,result text);
GRANT ALL ON stale_checks TO authenticated;
CREATE FUNCTION pg_temp.check_stale(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO stale_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
DELETE FROM public.leads; DELETE FROM public.user_roles; DELETE FROM public.quo_conversations;
INSERT INTO public.user_roles VALUES('18000000-0000-4000-8000-000000000001','processor');
INSERT INTO public.leads(id,job_id,customer_name,customer_phone,status,tech_name,tech_number,scheduled_date,scheduled_time_start) VALUES
 ('18000000-0000-4000-8000-000000000002','UNCHECKED-WITH-CHAT','A','(404) 555-0101','scheduled','Tech','4155550199',current_date+2,'10:00'),
 ('18000000-0000-4000-8000-000000000003','UNCHECKED-NO-CHAT','B','(404) 555-0102','scheduled','Tech','4155550199',current_date+2,'10:00'),
 ('18000000-0000-4000-8000-000000000004','PAYMENT-CHECKED','C','(404) 555-0103','payment_pending','Tech','4155550199',current_date-2,'10:00'),
 ('18000000-0000-4000-8000-000000000005','TECH-ONLY-CHECKED','D','(404) 555-0104','scheduled','Tech','4155550199',current_date+2,'10:00');
INSERT INTO public.quo_conversations(id,last_message_time,customer_number,linked_lead_id) VALUES
 ('18000000-0000-4000-8000-0000000000c1','2026-10-20T10:00:00Z','+14045550101',NULL),
 ('18000000-0000-4000-8000-0000000000c3','2026-10-20T10:00:00Z',NULL,'18000000-0000-4000-8000-000000000004'),
 ('18000000-0000-4000-8000-0000000000c4','2026-10-20T10:00:00Z','+14045550104',NULL);
INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
SELECT id,updated_at,'h',CASE WHEN job_id='PAYMENT-CHECKED'
  THEN '{"policy":10,"tech_phone":"4155550199","job_update":"completed","payment":{"state":"unclear"},"customer_last_message_at":"2026-10-20T10:00:00Z"}'::jsonb
  ELSE '{"policy":10,"tech_phone":"4155550199","job_update":"none"}'::jsonb END,now()
FROM public.leads WHERE job_id IN ('PAYMENT-CHECKED','TECH-ONLY-CHECKED');
SELECT set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
CREATE TEMP VIEW stale_rows AS SELECT r->>'job_id' AS job_id, r->'ai_stale' AS stale FROM jsonb_array_elements(public.list_processor_board_jobs()->'rows') r;
SELECT pg_temp.check_stale('every row has a true/false ai_stale',(SELECT bool_and(jsonb_typeof(stale)='boolean') FROM stale_rows) AND (SELECT count(*) FROM stale_rows)=4);
SELECT pg_temp.check_stale('unchecked job with a customer conversation is not stale',(SELECT stale FROM stale_rows WHERE job_id='UNCHECKED-WITH-CHAT')='false'::jsonb);
SELECT pg_temp.check_stale('tech-only check ignores customer messages',(SELECT stale FROM stale_rows WHERE job_id='TECH-ONLY-CHECKED')='false'::jsonb);
SELECT pg_temp.check_stale('payment check unchanged is not stale',(SELECT stale FROM stale_rows WHERE job_id='PAYMENT-CHECKED')='false'::jsonb);
RESET ROLE;
UPDATE public.quo_conversations SET last_message_time='2026-10-21T10:00:00Z';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_stale('new customer message still marks a payment check stale',(SELECT stale FROM stale_rows WHERE job_id='PAYMENT-CHECKED')='true'::jsonb
  AND (SELECT stale FROM stale_rows WHERE job_id='UNCHECKED-WITH-CHAT')='false'::jsonb);
RESET ROLE;
SELECT * FROM stale_checks ORDER BY name;
ROLLBACK;
