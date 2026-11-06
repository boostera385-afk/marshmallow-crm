-- WRITE-BASED, ISOLATED ONLY. Real triggers/service RPCs, synthetic fixtures,
-- rollback. Never run this harness against the shared production project.
-- Covers 20261020070343 as superseded by 20261130000000_ai_schedule_confirmation
-- and 20261201000000_ai_schedule_confirmation_calls, 20261202000000_ai_schedule_new_schedule_tag and 20261202010000_schedule_new_alert_compat.
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
-- Created with the tag already set: the insert trigger must queue it.
INSERT INTO public.leads(id,job_id,customer_name,customer_phone,status,cs_tag,assigned_cs,created_by,service_type,city,state,customer_schedule_requirements)
 VALUES('16000000-0000-4000-8000-000000000010','SCHED-TEST','Synthetic customer','(555) 010-0000','urgent_job','waiting_schedule_confirmation',
 '16000000-0000-4000-8000-000000000003','16000000-0000-4000-8000-000000000004','AC Repair','Miami','FL','Tomorrow 10 AM');
INSERT INTO public.quo_conversations(id,customer_number,number_id) VALUES
 ('16000000-0000-4000-8000-000000000030','+15550100000','16000000-0000-4000-8000-000000000031'),
 ('16000000-0000-4000-8000-000000000032','+15550109999','16000000-0000-4000-8000-000000000031');
CREATE TEMP TABLE original AS SELECT to_jsonb(l) value FROM public.leads l WHERE job_id='SCHED-TEST';
CREATE TEMP TABLE batch(value jsonb);
GRANT ALL ON batch TO service_role,authenticated;
CREATE FUNCTION pg_temp.finish_input(decision text,quote text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT value->'rows'->0||jsonb_build_object('mode',value->>'mode','config_changed_at',value->>'config_changed_at',
   'result',jsonb_build_object('decision',decision,'reason','Synthetic','quote',quote)) FROM batch;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.finish_input(text,text) TO service_role;

SELECT pg_temp.check_result('Monitor installs OFF',(SELECT mode='off' FROM marshmallow_private.schedule_monitor_config));
SELECT pg_temp.check_result('Lead created with the waiting tag is queued',EXISTS(SELECT 1 FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
SELECT pg_temp.check_result('New lead tag has no AI marker',(SELECT cs_tag_source IS NULL FROM public.leads WHERE job_id='SCHED-TEST'));
SET LOCAL ROLE service_role;
SELECT pg_temp.check_result('OFF worker claims no work',jsonb_array_length(public.claim_schedule_checks()->'rows')=0);
RESET ROLE;

-- Authorization
SELECT set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_error('CS cannot configure monitor',$q$SELECT public.schedule_monitor_admin('{"action":"configure","mode":"automatic","reason":"Synthetic test configuration"}')$q$,'42501');
SELECT pg_temp.check_error('Browser cannot claim privileged worker',$q$SELECT public.claim_schedule_checks()$q$,'42501');
SELECT pg_temp.check_error('Browser cannot forge finish',$q$SELECT public.finish_schedule_check('{}')$q$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_error('Removed binding action is rejected',$q$SELECT public.schedule_monitor_admin('{"action":"link","leadId":"16000000-0000-4000-8000-000000000010","reason":"Old binding workflow"}')$q$,'22023');
SELECT pg_temp.check_error('Configuration needs a reason',$q$SELECT public.schedule_monitor_admin('{"action":"configure","mode":"shadow","reason":"short"}')$q$,'22023');
SELECT pg_temp.check_error('Stale Admin view cannot turn the monitor on',$q$SELECT public.schedule_monitor_admin('{"action":"configure","mode":"automatic","expectedChangedAt":"2000-01-01T00:00:00Z","reason":"Stale attempted enablement"}')$q$,'40001');
SELECT pg_temp.check_error('Retry needs a customer reply first',$q$SELECT public.schedule_monitor_admin('{"action":"retry","leadId":"16000000-0000-4000-8000-000000000010","reason":"Retry without any reply"}')$q$,'22023');
SELECT public.schedule_monitor_admin('{"action":"configure","mode":"shadow","reason":"Synthetic shadow rollout"}'::jsonb||jsonb_build_object('expectedChangedAt',public.schedule_monitor_admin('{"action":"status"}')->>'changed_at'));
SELECT pg_temp.check_result('Admin status lists the waiting job',(SELECT (s->>'total')::int=1 AND s->'rows'->0->>'customer_name'='Synthetic customer' FROM (SELECT public.schedule_monitor_admin('{"action":"status"}') s) x));
-- A browser-inserted message must never become trusted evidence.
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000040','16000000-0000-4000-8000-000000000030','browser-spoof','customer','inbound','Yes 10 AM works',now()+interval '1 second');
RESET ROLE;
SELECT pg_temp.check_result('Browser chat insertion cannot forge provenance',(SELECT evidence IS NULL FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
SELECT pg_temp.check_result('Configuration change is audited',EXISTS(SELECT 1 FROM public.activity_logs WHERE action='schedule_monitor_configure' AND details LIKE 'Mode shadow:%'));

-- Trusted ingestion: any event on the matching chat after the tag starts a check.
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time) VALUES
 ('16000000-0000-4000-8000-000000000050','16000000-0000-4000-8000-000000000030','trusted-before','customer','inbound','Yes that works',now()-interval '1 hour'),
 ('16000000-0000-4000-8000-000000000053','16000000-0000-4000-8000-000000000032','other-customer','customer','inbound','Yes please',now()+interval '1 second');
RESET ROLE;
SELECT pg_temp.check_result('Other customers and pre-tag messages are ignored',(SELECT evidence IS NULL FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000051','16000000-0000-4000-8000-000000000030','trusted-agent','agent','outbound','Can we come tomorrow at 10 AM?',now()+interval '1 second');
RESET ROLE;
SELECT pg_temp.check_result('Our own text starts a check',(SELECT evidence->>'quo_message_id'='trusted-agent' AND evidence->>'kind'='text' FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000052','16000000-0000-4000-8000-000000000030','call-1:call.completed','customer','inbound','Call completed. Duration: 60',now()+interval '1 second');
RESET ROLE;
SELECT pg_temp.check_result('A call starts a check and waits for its transcript',(SELECT evidence->>'kind'='call' AND available_at>=now()+interval '45 seconds' FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000041','16000000-0000-4000-8000-000000000030','trusted-text','customer','inbound','Yes 10 AM tomorrow works for me',now()+interval '2 seconds');
RESET ROLE;
SELECT pg_temp.check_result('Customer reply on the phone-matched chat is captured',(SELECT evidence->>'quo_message_id'='trusted-text' FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
CREATE TEMP TABLE generation_before AS SELECT generation FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010';
SET LOCAL ROLE service_role;
UPDATE public.quo_messages SET text=text WHERE id='16000000-0000-4000-8000-000000000041';
RESET ROLE;
SELECT pg_temp.check_result('Unchanged webhook re-upsert does not restart the check',(SELECT q.generation=g.generation FROM marshmallow_private.schedule_monitor_queue q,generation_before g WHERE q.lead_id='16000000-0000-4000-8000-000000000010'));

-- Shadow mode records the AI answer but never changes the job.
UPDATE marshmallow_private.schedule_monitor_queue SET available_at=now()-interval '1 second';
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT pg_temp.check_result('Worker claims the job with its details',(SELECT jsonb_array_length(value->'rows')=1 AND value->'rows'->0->>'service_type'='AC Repair'
  AND value->'rows'->0->>'schedule_requirements'='Tomorrow 10 AM' AND (value->'rows'->0->>'ambiguous')::boolean=false FROM batch));
SELECT pg_temp.check_result('Claim carries texts and calls, newest first',(SELECT value->'rows'->0->'messages'->0->>'text'='Yes 10 AM tomorrow works for me'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(value->'rows'->0->'messages') m WHERE m->>'kind'='call')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(value->'rows'->0->'messages') m WHERE m->>'sender'='agent' AND m->>'kind'='text') FROM batch));
SELECT pg_temp.check_result('Concurrent claim cannot duplicate lease',jsonb_array_length(public.claim_schedule_checks()->'rows')=0);
SELECT pg_temp.check_result('Shadow saves assessment',public.finish_schedule_check(pg_temp.finish_input('confirmed','10 AM tomorrow works')));
RESET ROLE;
SELECT pg_temp.check_result('Shadow never changes the tag',(SELECT cs_tag='waiting_schedule_confirmation' AND cs_tag_source IS NULL FROM public.leads WHERE job_id='SCHED-TEST'));
SELECT pg_temp.check_result('Shadow never creates ready notification',(SELECT count(*)=0 FROM public.workflow_notification_events WHERE event_type='schedule_ready'));
SELECT pg_temp.check_result('Shadow result keeps the customer quote',(SELECT result->>'decision'='confirmed' AND result->>'quote'='10 AM tomorrow works' AND NOT (result->>'applied')::boolean FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));

-- Automatic mode, directly from Shadow without a review quota.
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.schedule_monitor_admin('{"action":"configure","mode":"automatic","reason":"Business approved AI tagging"}'::jsonb||jsonb_build_object('expectedChangedAt',public.schedule_monitor_admin('{"action":"status"}')->>'changed_at'));
SELECT public.schedule_monitor_admin('{"action":"retry","leadId":"16000000-0000-4000-8000-000000000010","reason":"Re-check after enabling"}');
RESET ROLE;
SELECT pg_temp.check_result('Admin can turn Automatic on with an audited reason',(SELECT mode='automatic' FROM marshmallow_private.schedule_monitor_config));
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT public.finish_schedule_check(pg_temp.finish_input('confirmed','I will be home all week'));
RESET ROLE;
SELECT pg_temp.check_result('Invented customer quote is refused',(SELECT l.cs_tag='waiting_schedule_confirmation' AND q.result->>'decision'='needs_review'
  FROM public.leads l JOIN marshmallow_private.schedule_monitor_queue q ON q.lead_id=l.id WHERE l.job_id='SCHED-TEST'));

-- New incoming evidence invalidates an in-flight analysis, even if AI says yes.
UPDATE marshmallow_private.schedule_monitor_queue SET state='pending',available_at=now()-interval '1 second';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000042','16000000-0000-4000-8000-000000000030','trusted-cancel','customer','inbound','Actually please cancel',now()+interval '3 seconds');
SELECT pg_temp.check_result('New message rejects stale worker completion',NOT public.finish_schedule_check(pg_temp.finish_input('confirmed','10 AM tomorrow works')));
RESET ROLE;
SELECT pg_temp.check_result('Stale analysis leaves tag untouched',(SELECT cs_tag='waiting_schedule_confirmation' FROM public.leads WHERE job_id='SCHED-TEST'));

-- A real confirmation applies the tag, marks it AI and notifies the right people.
INSERT INTO public.lead_status_visibility(user_id,status,is_visible) VALUES('16000000-0000-4000-8000-000000000004','urgent_job',false);
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000043','16000000-0000-4000-8000-000000000030','trusted-confirm','customer','inbound','Sorry ignore that, 10 AM tomorrow is confirmed',now()+interval '4 seconds');
RESET ROLE;
UPDATE marshmallow_private.schedule_monitor_queue SET available_at=now()-interval '1 second';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT pg_temp.check_result('Confirmed customer reply commits',public.finish_schedule_check(pg_temp.finish_input('confirmed','10 AM tomorrow is confirmed')));
SELECT pg_temp.check_result('Duplicate finish cannot apply twice',NOT public.finish_schedule_check(pg_temp.finish_input('confirmed','10 AM tomorrow is confirmed')));
RESET ROLE;
SELECT pg_temp.check_result('Tag moves to Ready to schedule and is marked AI',(SELECT cs_tag='ready_to_schedule' AND cs_tag_source='ai' FROM public.leads WHERE job_id='SCHED-TEST'));
SELECT pg_temp.check_result('Only the tag and its AI marker changed',(SELECT (to_jsonb(l)-'cs_tag'-'cs_tag_source')=(o.value-'cs_tag'-'cs_tag_source') FROM public.leads l CROSS JOIN original o WHERE job_id='SCHED-TEST'));
SELECT pg_temp.check_result('One audited AI transition',(SELECT count(*)=1 FROM public.activity_logs WHERE action='schedule_confirmation_tag_applied' AND user_name='AI schedule confirmation'));
SELECT pg_temp.check_result('Notifies lead CS, CS Admin, Admin and Processor only',(SELECT array_agg(n.user_id ORDER BY n.user_id)=ARRAY['16000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000003','16000000-0000-4000-8000-000000000005']::uuid[]
  FROM public.notifications n JOIN public.workflow_notification_events e ON e.notification_id=n.id WHERE e.event_type='schedule_ready'));
SELECT pg_temp.check_result('Notification shows job ID, customer, service, schedule and customer words',(SELECT bool_and(n.title LIKE 'AI:%' AND n.message LIKE 'Job ID: SCHED-TEST%' AND n.message LIKE '%Customer: Synthetic customer%'
  AND n.message LIKE '%Service: AC Repair%' AND n.message LIKE '%Location: Miami, FL%' AND n.message LIKE '%Schedule: Tomorrow 10 AM%' AND n.message LIKE '%Customer said: "10 AM tomorrow is confirmed"%')
  FROM public.notifications n JOIN public.workflow_notification_events e ON e.notification_id=n.id WHERE e.event_type='schedule_ready'));

-- The AI marker belongs to the trigger, not to clients.
SELECT set_config('request.jwt.claim.role','authenticated',true);
UPDATE public.leads SET cs_tag_source=NULL WHERE job_id='SCHED-TEST';
SELECT pg_temp.check_result('Marker cannot be edited without a tag change',(SELECT cs_tag_source='ai' FROM public.leads WHERE job_id='SCHED-TEST'));
UPDATE public.leads SET cs_tag='booked',cs_tag_source='ai' WHERE job_id='SCHED-TEST';
SELECT pg_temp.check_result('A person changing the tag clears the AI marker',(SELECT cs_tag='booked' AND cs_tag_source IS NULL FROM public.leads WHERE job_id='SCHED-TEST'));

-- Confirmation on a phone call: only the customer's lines of the transcript count.
UPDATE public.leads SET cs_tag='waiting_schedule_confirmation' WHERE job_id='SCHED-TEST';
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time,raw_payload) VALUES
 ('16000000-0000-4000-8000-000000000060','16000000-0000-4000-8000-000000000030','call-9:call.transcript.completed','customer','inbound',
  'Call transcript: Agent: Can we do tomorrow at 10? Customer: Yes tomorrow at 10 is perfect',now()+interval '5 seconds',
  '{"type":"call.transcript.completed","data":{"object":{"callId":"call-9","status":"completed","dialogue":[
    {"userId":"US123","identifier":"+15550001111","content":"Can we do tomorrow at 10?"},
    {"userId":null,"identifier":"+15550100000","content":"Yes tomorrow at 10 is perfect"},
    {"userId":null,"identifier":"+15559998888","content":"Sounds good to me as well"}]}}}'),
 ('16000000-0000-4000-8000-000000000061','16000000-0000-4000-8000-000000000030','call-9:call.summary.completed','customer','inbound',
  'Call summary: The customer confirmed the 10 AM appointment',now()+interval '5 seconds',NULL);
RESET ROLE;
SELECT pg_temp.check_result('Call transcript and summary start a check',(SELECT evidence->>'kind' IN ('call_transcript','call_summary') FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
UPDATE marshmallow_private.schedule_monitor_queue SET available_at=now()-interval '1 second' WHERE lead_id='16000000-0000-4000-8000-000000000010';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT pg_temp.check_result('Claim carries transcript lines with speakers',(SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'rows'->0->'messages') m, jsonb_array_elements(CASE WHEN jsonb_typeof(m->'dialogue')='array' THEN m->'dialogue' ELSE '[]'::jsonb END) d
    WHERE m->>'kind'='call_transcript' AND d->>'speaker'='customer' AND d->>'content'='Yes tomorrow at 10 is perfect')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(value->'rows'->0->'messages') m, jsonb_array_elements(CASE WHEN jsonb_typeof(m->'dialogue')='array' THEN m->'dialogue' ELSE '[]'::jsonb END) d
    WHERE m->>'kind'='call_transcript' AND d->>'speaker'='our_team')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'rows'->0->'messages') m, jsonb_array_elements(CASE WHEN jsonb_typeof(m->'dialogue')='array' THEN m->'dialogue' ELSE '[]'::jsonb END) d
    WHERE d->>'content'='Sounds good to me as well') FROM batch));
SELECT public.finish_schedule_check(pg_temp.finish_input('confirmed','Can we do tomorrow at 10'));
RESET ROLE;
SELECT pg_temp.check_result('Our team''s words on the call are not proof',(SELECT cs_tag='waiting_schedule_confirmation' FROM public.leads WHERE job_id='SCHED-TEST'));
UPDATE marshmallow_private.schedule_monitor_queue SET state='pending',available_at=now()-interval '1 second' WHERE lead_id='16000000-0000-4000-8000-000000000010';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT public.finish_schedule_check(pg_temp.finish_input('confirmed','The customer confirmed the 10 AM appointment'));
RESET ROLE;
SELECT pg_temp.check_result('A call summary is not proof',(SELECT cs_tag='waiting_schedule_confirmation' FROM public.leads WHERE job_id='SCHED-TEST'));
UPDATE marshmallow_private.schedule_monitor_queue SET state='pending',available_at=now()-interval '1 second' WHERE lead_id='16000000-0000-4000-8000-000000000010';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT public.finish_schedule_check(pg_temp.finish_input('confirmed','Sounds good to me as well'));
RESET ROLE;
SELECT pg_temp.check_result('An unknown caller on the line is not the customer',(SELECT cs_tag='waiting_schedule_confirmation' FROM public.leads WHERE job_id='SCHED-TEST'));
UPDATE marshmallow_private.schedule_monitor_queue SET state='pending',available_at=now()-interval '1 second' WHERE lead_id='16000000-0000-4000-8000-000000000010';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT pg_temp.check_result('Customer confirmation on a call commits',public.finish_schedule_check(pg_temp.finish_input('confirmed','Yes tomorrow at 10 is perfect')));
RESET ROLE;
SELECT pg_temp.check_result('Call confirmation moves the tag and marks it AI',(SELECT cs_tag='ready_to_schedule' AND cs_tag_source='ai' FROM public.leads WHERE job_id='SCHED-TEST'));

-- 20261202000000: a customer who asks for a different time needs a new schedule.
UPDATE public.leads SET cs_tag='waiting_schedule_confirmation' WHERE job_id='SCHED-TEST';
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000070','16000000-0000-4000-8000-000000000030','trusted-change','customer','inbound','How about the 14th instead?',now()+interval '5 seconds');
RESET ROLE;
UPDATE marshmallow_private.schedule_monitor_queue SET available_at=now()-interval '1 second' WHERE lead_id='16000000-0000-4000-8000-000000000010';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT pg_temp.check_error('Unknown AI decision is rejected',$q$SELECT public.finish_schedule_check(pg_temp.finish_input('reschedule','How about the 14th instead?'))$q$,'22023');
SELECT public.finish_schedule_check(pg_temp.finish_input('new_schedule_needed','Can we move it to Friday'));
RESET ROLE;
SELECT pg_temp.check_result('New-schedule decision with invented words changes nothing',(SELECT l.cs_tag='waiting_schedule_confirmation' AND q.result->>'decision'='needs_review'
  FROM public.leads l JOIN marshmallow_private.schedule_monitor_queue q ON q.lead_id=l.id WHERE l.job_id='SCHED-TEST'));
UPDATE marshmallow_private.schedule_monitor_queue SET state='pending',available_at=now()-interval '1 second' WHERE lead_id='16000000-0000-4000-8000-000000000010';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT pg_temp.check_result('Customer asking for another time commits',public.finish_schedule_check(pg_temp.finish_input('new_schedule_needed','How about the 14th instead?')));
RESET ROLE;
SELECT pg_temp.check_result('Tag moves to Customer Require New Schedule and is marked AI',(SELECT cs_tag='confirmation_sent' AND cs_tag_source='ai' FROM public.leads WHERE job_id='SCHED-TEST'));
SELECT pg_temp.check_result('New-schedule decision changes only the tag and its AI marker',(SELECT (to_jsonb(l)-'cs_tag'-'cs_tag_source')=(o.value-'cs_tag'-'cs_tag_source') FROM public.leads l CROSS JOIN original o WHERE job_id='SCHED-TEST'));
SELECT pg_temp.check_result('One audited AI new-schedule transition',(SELECT count(*)=1 FROM public.activity_logs WHERE action='schedule_new_schedule_tag_applied' AND user_name='AI schedule confirmation'
  AND details LIKE '%-> Customer Require New Schedule. Customer said: "How about the 14th instead?"%'));
SELECT pg_temp.check_result('New-schedule alert goes to lead CS, CS Admin, Admin and Processor only',(SELECT array_agg(n.user_id ORDER BY n.user_id)=ARRAY['16000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000003','16000000-0000-4000-8000-000000000005']::uuid[]
  AND bool_and(n.title='AI: Customer requires new schedule' AND n.message LIKE 'Job ID: SCHED-TEST%' AND n.message LIKE '%Customer said: "How about the 14th instead?"%')
  FROM public.notifications n JOIN public.workflow_notification_events e ON e.notification_id=n.id WHERE e.event_type='schedule_new_needed'));
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('New-schedule alert is a Schedule notification and a pop-up',(SELECT
  EXISTS(SELECT 1 FROM jsonb_array_elements(public.workflow_notifications('{"action":"list","category":"schedule"}')->'rows') r WHERE r->>'event_kind'='schedule_new_needed')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(public.workflow_notifications('{"action":"alerts","after":"2000-01-01T00:00:00Z"}')->'rows') r WHERE r->>'event_kind'='schedule_new_needed')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.workflow_notifications('{"action":"list","category":"other"}')->'rows') r WHERE r->>'event_kind'='schedule_new_needed')));
-- 20261202010000: older CRM builds only accept known event types.
SELECT pg_temp.check_result('Older CRM builds receive only event types they know',(SELECT bool_and(r->>'event_type' IN ('update_requested','update_answered','update_resolved','schedule_ready') OR r->>'event_type' IS NULL)
  AND bool_or(r->>'event_kind'='schedule_new_needed' AND r->>'event_type'='schedule_ready')
  FROM jsonb_array_elements(public.workflow_notifications('{"action":"list"}')->'rows') r));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);

-- Two waiting jobs for the same customer: the AI cannot know which one.
UPDATE public.leads SET cs_tag='waiting_schedule_confirmation' WHERE job_id='SCHED-TEST';
INSERT INTO public.leads(id,job_id,customer_name,customer_phone,status,cs_tag,created_by)
 VALUES('16000000-0000-4000-8000-000000000011','SCHED-TWIN','Synthetic customer','5550100000','need_tech','waiting_schedule_confirmation','16000000-0000-4000-8000-000000000004');
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000044','16000000-0000-4000-8000-000000000030','trusted-twin','customer','inbound','Yes confirmed',now()+interval '5 seconds');
RESET ROLE;
UPDATE marshmallow_private.schedule_monitor_queue SET available_at=now()-interval '1 second' WHERE lead_id='16000000-0000-4000-8000-000000000010';
UPDATE marshmallow_private.schedule_monitor_queue SET available_at=now()+interval '1 hour' WHERE lead_id='16000000-0000-4000-8000-000000000011';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT pg_temp.check_result('Worker is told the match is ambiguous',(SELECT (value->'rows'->0->>'ambiguous')::boolean FROM batch));
SELECT public.finish_schedule_check(pg_temp.finish_input('confirmed','Yes confirmed'));
RESET ROLE;
SELECT pg_temp.check_result('Ambiguous customer leaves both jobs waiting',(SELECT bool_and(cs_tag='waiting_schedule_confirmation') FROM public.leads WHERE job_id IN ('SCHED-TEST','SCHED-TWIN')));
DELETE FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000011';
DELETE FROM public.leads WHERE job_id='SCHED-TWIN';

-- A conversation linked to another lead is not this job's chat.
UPDATE public.quo_conversations SET linked_lead_id='16000000-0000-4000-8000-000000000099' WHERE id='16000000-0000-4000-8000-000000000030';
UPDATE marshmallow_private.schedule_monitor_queue SET evidence=NULL WHERE lead_id='16000000-0000-4000-8000-000000000010';
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000045','16000000-0000-4000-8000-000000000030','trusted-linked-elsewhere','customer','inbound','Yes',now()+interval '6 seconds');
RESET ROLE;
SELECT pg_temp.check_result('Chat linked to a different lead is ignored',(SELECT evidence IS NULL FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
UPDATE public.quo_conversations SET linked_lead_id='16000000-0000-4000-8000-000000000010' WHERE id='16000000-0000-4000-8000-000000000030';
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000046','16000000-0000-4000-8000-000000000030','trusted-linked-here','customer','inbound','Yes see you then',now()+interval '7 seconds');
RESET ROLE;
SELECT pg_temp.check_result('Chat linked to this lead is used',(SELECT evidence->>'quo_message_id'='trusted-linked-here' FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));

-- Terminal status and pending approvals remain independently guarded.
UPDATE public.leads SET status='cancelled' WHERE job_id='SCHED-TEST';
SELECT pg_temp.check_result('Cancelled job never eligible',(SELECT NOT marshmallow_private.schedule_eligible(l) FROM public.leads l WHERE job_id='SCHED-TEST'));
UPDATE public.leads SET status='scheduled' WHERE job_id='SCHED-TEST';
SELECT pg_temp.check_result('Scheduled job never eligible',(SELECT NOT marshmallow_private.schedule_eligible(l) FROM public.leads l WHERE job_id='SCHED-TEST'));
UPDATE public.leads SET status='needs_quote' WHERE job_id='SCHED-TEST';
SELECT pg_temp.check_result('Open pre-schedule status is eligible',(SELECT marshmallow_private.schedule_eligible(l) FROM public.leads l WHERE job_id='SCHED-TEST'));
INSERT INTO public.lead_quote_approval_requests(lead_id,status) VALUES('16000000-0000-4000-8000-000000000010','pending');
SELECT pg_temp.check_result('Pending approval prevents eligibility',(SELECT NOT marshmallow_private.schedule_eligible(l) FROM public.leads l WHERE job_id='SCHED-TEST'));
SET LOCAL ROLE service_role;
INSERT INTO public.quo_messages(id,conversation_id,quo_message_id,sender,direction,text,message_time)
 VALUES('16000000-0000-4000-8000-000000000047','16000000-0000-4000-8000-000000000030','trusted-blocked','customer','inbound','Yes 10 AM is confirmed',now()+interval '8 seconds');
RESET ROLE;
UPDATE marshmallow_private.schedule_monitor_queue SET available_at=now()-interval '1 second';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT public.finish_schedule_check(pg_temp.finish_input('confirmed','10 AM is confirmed'));
RESET ROLE;
SELECT pg_temp.check_result('Blocked job is not tagged even when AI confirms',(SELECT cs_tag='waiting_schedule_confirmation' FROM public.leads WHERE job_id='SCHED-TEST'));
DELETE FROM public.lead_quote_approval_requests;

-- Provider failures and pause.
UPDATE marshmallow_private.schedule_monitor_queue SET state='pending',available_at=now()-interval '1 second';
TRUNCATE batch;
SET LOCAL ROLE service_role;
INSERT INTO batch SELECT public.claim_schedule_checks();
SELECT public.finish_schedule_check(pg_temp.finish_input('unavailable','')||jsonb_build_object('provider_status',429));
SELECT pg_temp.check_result('429 cooldown prevents further claims',jsonb_array_length(public.claim_schedule_checks()->'rows')=0);
RESET ROLE;
SELECT pg_temp.check_result('Unavailable is recorded separately and retried',(SELECT result->>'decision'='unavailable' AND state='pending' FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
INSERT INTO public.quo_ai_settings(key,value) VALUES('quo_webhook_ingestion_paused','true');
SELECT pg_temp.check_result('Pause invalidates previously trusted evidence',(SELECT evidence IS NULL AND lease IS NULL FROM marshmallow_private.schedule_monitor_queue WHERE lead_id='16000000-0000-4000-8000-000000000010'));
UPDATE marshmallow_private.schedule_monitor_config SET cooldown_until=NULL;
SET LOCAL ROLE service_role;
SELECT pg_temp.check_result('Paused ingestion prevents worker claims',jsonb_array_length(public.claim_schedule_checks()->'rows')=0);
RESET ROLE;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.schedule_monitor_admin('{"action":"configure","mode":"off","reason":"Kill switch without a fresh view"}');
RESET ROLE;
SELECT pg_temp.check_result('Off works as a kill switch without the latest view',(SELECT mode='off' FROM marshmallow_private.schedule_monitor_config));
SELECT * FROM checks ORDER BY name;
ROLLBACK;
