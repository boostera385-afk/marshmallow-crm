-- WRITE-BASED, ISOLATED ONLY. Real triggers/service RPCs, synthetic fixtures,
-- rollback. Never run this harness against the shared production project.
BEGIN;
CREATE TEMP TABLE checks(name text,result text);
GRANT ALL ON checks TO authenticated,service_role;
CREATE FUNCTION pg_temp.check_result(label text,ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO checks VALUES(label,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.check_error(label text,statement text,code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; PERFORM pg_temp.check_result(label,false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check_result(label,sqlstate=code); END $$;
INSERT INTO auth.users(id,email) SELECT ('16000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'schedule-'||n||'@example.invalid' FROM generate_series(1,6) n;
INSERT INTO public.profiles(id,full_name) SELECT id,'Synthetic '||right(id::text,1) FROM auth.users WHERE id::text LIKE '16000000-%';
INSERT INTO public.user_roles(user_id,role) VALUES
 ('16000000-0000-4000-8000-000000000001','admin'),('16000000-0000-4000-8000-000000000002','processor'),
 ('16000000-0000-4000-8000-000000000003','customer_service'),('16000000-0000-4000-8000-000000000004','customer_service'),
 ('16000000-0000-4000-8000-000000000005','cs_admin'),('16000000-0000-4000-8000-000000000006','opr');
INSERT INTO public.leads(id,job_id,customer_name,customer_phone,status,cs_tag,assigned_cs,created_by,scheduled_date,scheduled_time_start,customer_schedule_requirements)
 VALUES('16000000-0000-4000-8000-000000000010','SCHED-TEST','Synthetic customer','5550100000','urgent_job','waiting_schedule_confirmation',
 '16000000-0000-4000-8000-000000000003','16000000-0000-4000-8000-000000000004',current_date+5,'14:00','Customer agreed afternoon');
INSERT INTO public.quo_conversations(id,customer_number,number_id) VALUES('16000000-0000-4000-8000-000000000030','+15550100000','16000000-0000-4000-8000-000000000031');
CREATE TEMP TABLE original AS SELECT to_jsonb(l) value FROM public.leads l WHERE job_id='SCHED-TEST';
CREATE TEMP TABLE batch(value jsonb);
GRANT ALL ON batch TO service_role,authenticated;
SELECT pg_temp.check_result('Monitor installs OFF',(SELECT mode='off' FROM marshmallow_private.schedule_monitor_config));
SET LOCAL ROLE service_role;
SELECT pg_temp.check_result('OFF worker claims no work',jsonb_array_length(public.claim_schedule_checks()->'rows')=0);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_error('CS cannot configure monitor',$q$SELECT public.schedule_monitor_admin('{"action":"configure","mode":"shadow","timezone":"America/New_York","reason":"Synthetic test configuration"}')$q$,'42501');
SELECT pg_temp.check_error('Browser cannot claim privileged worker',$q$SELECT public.claim_schedule_checks()$q$,'42501');
SELECT pg_temp.check_error('Browser cannot forge finish',$q$SELECT public.finish_schedule_check('{}')$q$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_error('Automatic cannot bypass shadow review',$q$SELECT public.schedule_monitor_admin('{"action":"configure","mode":"automatic","timezone":"America/New_York","reason":"Synthetic attempt to skip shadow"}'::jsonb||jsonb_build_object('expectedChangedAt',public.schedule_monitor_admin('{"action":"status"}')->>'changed_at'))$q$,'22023');
SELECT public.schedule_monitor_admin('{"action":"configure","mode":"shadow","timezone":"America/New_York","reason":"Synthetic shadow rollout review"}'::jsonb||jsonb_build_object('expectedChangedAt',public.schedule_monitor_admin('{"action":"status"}')->>'changed_at'));
SELECT pg_temp.check_error('Stale Admin configuration cannot enable automatic mode',$q$SELECT public.schedule_monitor_admin('{"action":"configure","mode":"automatic","timezone":"America/New_York","expectedChangedAt":"2000-01-01T00:00:00Z","reason":"Stale attempted enablement"}')$q$,'40001');
SELECT public.schedule_monitor_admin('{"action":"link","leadId":"16000000-0000-4000-8000-000000000010","conversationId":"16000000-0000-4000-8000-000000000030","reason":"Verified exact customer and job in Quo"}');
-- A browser-inserted message must never become trusted evidence.
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000040','16000000-0000-4000-8000-000000000030','browser-spoof','customer','inbound','I confirm SCHED-TEST '||(current_date+5)||' 14:00',now()+interval '1 second');
RESET ROLE;
SELECT pg_temp.check_result('Browser chat insertion cannot forge provenance',(SELECT evidence IS NULL FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000041','16000000-0000-4000-8000-000000000030','trusted-text','customer','inbound','I confirm SCHED-TEST '||(current_date+5)||' 14:00',now()+interval '2 seconds');
RESET ROLE;
SELECT pg_temp.check_result('Trusted ingestion captures a server-only snapshot',(SELECT evidence->>'quo_message_id'='trusted-text' FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
UPDATE marshmallow_private.schedule_monitor_queue SET available_at=now()-interval '1 second';
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT pg_temp.check_result('Eligible worker claims bounded work',jsonb_array_length((SELECT value FROM batch)->'rows')=1);
SELECT pg_temp.check_result('Concurrent claim cannot duplicate lease',jsonb_array_length(public.claim_schedule_checks()->'rows')=0);
SELECT pg_temp.check_result('Shadow saves assessment',public.finish_schedule_check((SELECT value->'rows'->0||jsonb_build_object('mode',value->>'mode','timezone',value->>'timezone','config_changed_at',value->>'config_changed_at','result',jsonb_build_object('decision','confirmed','reason','Synthetic exact agreement')) FROM batch)));
RESET ROLE;
SELECT pg_temp.check_result('Shadow never changes the tag',(SELECT cs_tag='waiting_schedule_confirmation' FROM public.leads WHERE job_id='SCHED-TEST'));
SELECT pg_temp.check_result('Shadow never creates ready notification',(SELECT count(*)=0 FROM public.workflow_notification_events WHERE event_type='schedule_ready'));
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.schedule_monitor_admin(jsonb_build_object('action','review','leadId','16000000-0000-4000-8000-000000000010','generation',(SELECT (value->'rows'->0->>'generation')::int FROM batch),'decision','accept','reason','Human reviewed the exact saved agreement'));
RESET ROLE;
SELECT pg_temp.check_result('Shadow review is recorded',(SELECT count(*)=1 FROM marshmallow_private.schedule_monitor_reviews WHERE decision='accept'));
-- Direct mode changes below are TEST SETUP ONLY, not a rollout bypass. Activation
-- guard was asserted above; exercise service transition independently here.
UPDATE marshmallow_private.schedule_monitor_config SET mode='automatic';
UPDATE marshmallow_private.schedule_monitor_queue SET state='pending',available_at=now()-interval '1 second';
TRUNCATE batch;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
-- New incoming evidence invalidates an in-flight analysis, even if AI says yes.
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000042','16000000-0000-4000-8000-000000000030','trusted-cancel','customer','inbound','Please cancel this appointment',now()+interval '3 seconds');
SELECT pg_temp.check_result('New message rejects stale worker completion',NOT public.finish_schedule_check((SELECT value->'rows'->0||jsonb_build_object('mode',value->>'mode','timezone',value->>'timezone','config_changed_at',value->>'config_changed_at','result',jsonb_build_object('decision','confirmed','reason','Stale finding')) FROM batch)));
RESET ROLE;
SELECT pg_temp.check_result('Stale analysis leaves tag untouched',(SELECT cs_tag='waiting_schedule_confirmation' FROM public.leads WHERE job_id='SCHED-TEST'));
UPDATE marshmallow_private.schedule_monitor_queue SET available_at=now()-interval '1 second';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT public.finish_schedule_check((SELECT value->'rows'->0||jsonb_build_object('mode',value->>'mode','timezone',value->>'timezone','config_changed_at',value->>'config_changed_at','result',jsonb_build_object('decision','confirmed','reason','Malicious model says confirmed')) FROM batch));
RESET ROLE;
SELECT pg_temp.check_result('SQL gate rejects model confirmation of cancellation',(SELECT cs_tag='waiting_schedule_confirmation' FROM public.leads WHERE job_id='SCHED-TEST'));
-- Fresh explicit agreement can pass; a status override excludes a former owner.
INSERT INTO public.lead_status_visibility(user_id,status,is_visible) VALUES('16000000-0000-4000-8000-000000000004','urgent_job',false);
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000043','16000000-0000-4000-8000-000000000030','trusted-confirm','customer','inbound','I confirm SCHED-TEST '||(current_date+5)||' 14:00',now()+interval '4 seconds');
RESET ROLE;
UPDATE marshmallow_private.schedule_monitor_queue SET available_at=now()-interval '1 second';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT pg_temp.check_result('Guarded automatic confirmation commits',public.finish_schedule_check((SELECT value->'rows'->0||jsonb_build_object('mode',value->>'mode','timezone',value->>'timezone','config_changed_at',value->>'config_changed_at','result',jsonb_build_object('decision','confirmed','reason','Exact customer agreement')) FROM batch)));
SELECT pg_temp.check_result('Duplicate finish cannot apply twice',NOT public.finish_schedule_check((SELECT value->'rows'->0||jsonb_build_object('mode',value->>'mode','timezone',value->>'timezone','config_changed_at',value->>'config_changed_at','result',jsonb_build_object('decision','confirmed','reason','Retry')) FROM batch)));
RESET ROLE;
SELECT pg_temp.check_result('Only ready tag changed',(SELECT (to_jsonb(l)-'cs_tag')=(o.value-'cs_tag') AND l.cs_tag='ready_to_schedule' FROM public.leads l CROSS JOIN original o WHERE job_id='SCHED-TEST'));
SELECT pg_temp.check_result('One audited transition',(SELECT count(*)=1 FROM public.activity_logs WHERE action='schedule_confirmation_tag_applied'));
SELECT pg_temp.check_result('Ready notifications reach only authorized recipients',(SELECT count(*)=4 FROM public.workflow_notification_events WHERE event_type='schedule_ready'));
SELECT pg_temp.check_result('Status-hidden CS does not receive ready notification',NOT EXISTS(SELECT 1 FROM public.notifications n JOIN public.workflow_notification_events e ON e.notification_id=n.id WHERE e.event_type='schedule_ready' AND n.user_id='16000000-0000-4000-8000-000000000004'));
-- Terminal status and paid schedule invariants remain independently guarded.
UPDATE public.leads SET status='cancelled',cs_tag='waiting_schedule_confirmation' WHERE job_id='SCHED-TEST';
SELECT pg_temp.check_result('Cancelled job never eligible',(SELECT NOT marshmallow_private.schedule_eligible(l) FROM public.leads l WHERE job_id='SCHED-TEST'));
UPDATE public.leads SET status='scheduled' WHERE job_id='SCHED-TEST';
SELECT pg_temp.check_result('Scheduled job never eligible',(SELECT NOT marshmallow_private.schedule_eligible(l) FROM public.leads l WHERE job_id='SCHED-TEST'));
UPDATE public.leads SET status='urgent_job' WHERE job_id='SCHED-TEST';
INSERT INTO public.lead_quote_approval_requests(lead_id,status) VALUES('16000000-0000-4000-8000-000000000010','pending');
SELECT pg_temp.check_result('Pending approval prevents eligibility',(SELECT NOT marshmallow_private.schedule_eligible(l) FROM public.leads l WHERE job_id='SCHED-TEST'));
DELETE FROM public.lead_quote_approval_requests;
UPDATE marshmallow_private.schedule_monitor_queue SET available_at=now()-interval '1 second';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT public.finish_schedule_check((SELECT value->'rows'->0||jsonb_build_object('mode',value->>'mode','timezone',value->>'timezone','config_changed_at',value->>'config_changed_at','result',jsonb_build_object('decision','unavailable','reason','Provider unavailable'),'provider_status',429) FROM batch));
SELECT pg_temp.check_result('429 cooldown prevents further claims',jsonb_array_length(public.claim_schedule_checks()->'rows')=0);
RESET ROLE;
SELECT pg_temp.check_result('Unavailable is recorded separately',(SELECT result->>'decision'='unavailable' AND state='pending' FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
INSERT INTO public.quo_ai_settings(key,value) VALUES('quo_webhook_ingestion_paused','true');
SELECT pg_temp.check_result('Pause invalidates previously trusted evidence',(SELECT evidence IS NULL AND lease IS NULL FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
UPDATE marshmallow_private.schedule_monitor_config SET cooldown_until=NULL;
SET LOCAL ROLE service_role;
SELECT pg_temp.check_result('Paused ingestion prevents worker claims',jsonb_array_length(public.claim_schedule_checks()->'rows')=0);
RESET ROLE;
SELECT * FROM checks ORDER BY name;
ROLLBACK;
