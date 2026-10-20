-- WRITE-BASED HARNESS. ISOLATED POSTGRES ONLY. Executes real actions then rolls
-- back. Never run on production: external lead/auth triggers may still fire.
BEGIN;
CREATE TEMP TABLE checks(name text,result text);
GRANT ALL ON checks TO authenticated;
CREATE FUNCTION pg_temp.check_result(label text,ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO checks VALUES(label,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.check_error(label text,statement text,code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; PERFORM pg_temp.check_result(label,false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check_result(label,sqlstate=code); END $$;
INSERT INTO auth.users(id,email) SELECT ('15000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'workflow-'||n||'@example.invalid' FROM generate_series(1,6) n;
INSERT INTO public.profiles(id,full_name) SELECT id,'Synthetic '||right(id::text,1) FROM auth.users WHERE id::text LIKE '15000000-%';
INSERT INTO public.user_roles(user_id,role) VALUES
 ('15000000-0000-4000-8000-000000000001','admin'),('15000000-0000-4000-8000-000000000002','processor'),
 ('15000000-0000-4000-8000-000000000003','customer_service'),('15000000-0000-4000-8000-000000000004','customer_service'),
 ('15000000-0000-4000-8000-000000000005','cs_admin'),('15000000-0000-4000-8000-000000000006','opr');
INSERT INTO public.leads(id,job_id,customer_name,status,assigned_cs,created_by,tech_name,customer_schedule_requirements)
 VALUES('15000000-0000-4000-8000-000000000010','WF-TEST','Synthetic customer','urgent_job','15000000-0000-4000-8000-000000000003','15000000-0000-4000-8000-000000000004','PRIVATE TECH','Friday afternoon');
CREATE TEMP TABLE original AS SELECT to_jsonb(l) value FROM public.leads l WHERE job_id='WF-TEST';
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT public.workflow_requests('{"kind":"cx","action":"create","leadId":"15000000-0000-4000-8000-000000000010","requestId":"15000000-0000-4000-8000-000000000020","text":"Confirm Friday"}');
SELECT public.workflow_requests('{"kind":"cx","action":"create","leadId":"15000000-0000-4000-8000-000000000010","requestId":"15000000-0000-4000-8000-000000000020","text":"Confirm Friday"}');
SELECT pg_temp.check_result('Create retry is idempotent',(public.workflow_requests('{"kind":"cx","action":"counts"}')->>'cx')::int=1);
SELECT pg_temp.check_error('Unanswered request cannot resolve',$q$SELECT public.workflow_requests('{"kind":"cx","action":"resolve","requestId":"15000000-0000-4000-8000-000000000020","revision":1}')$q$,'22023');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Assigned CS wins over creator',(public.workflow_requests('{"kind":"cx","action":"list_pending"}')->>'total')::int=0);
SELECT pg_temp.check_error('Other CS cannot answer',$q$SELECT public.workflow_requests('{"kind":"cx","action":"complete","requestId":"15000000-0000-4000-8000-000000000020","text":"Spoofed","revision":1}')$q$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Customer projection never includes technician',position('PRIVATE TECH' IN public.workflow_requests('{"kind":"cx","action":"list_pending"}')::text)=0);
SELECT public.workflow_requests('{"kind":"cx","action":"complete","requestId":"15000000-0000-4000-8000-000000000020","text":"Friday confirmed","revision":1}');
SELECT public.workflow_requests('{"kind":"cx","action":"complete","requestId":"15000000-0000-4000-8000-000000000020","text":"Friday confirmed","revision":1}');
SELECT pg_temp.check_result('Responder sees response awaiting requester resolution',(public.workflow_requests('{"kind":"cx","action":"list_updated"}')->>'total')::int=1);
SELECT pg_temp.check_error('Responder cannot resolve',$q$SELECT public.workflow_requests('{"kind":"cx","action":"resolve","requestId":"15000000-0000-4000-8000-000000000020","revision":2}')$q$,'42501');
SELECT pg_temp.check_error('Browser cannot forge server event',$q$INSERT INTO public.workflow_notification_events(notification_id,event_type,revision,job_id,event_key) VALUES(gen_random_uuid(),'schedule_ready',1,'fake','fake')$q$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_error('Admin cannot silently resolve another requester',$q$SELECT public.workflow_requests('{"kind":"cx","action":"resolve","requestId":"15000000-0000-4000-8000-000000000020","revision":2}')$q$,'42501');
SELECT pg_temp.check_error('Legacy private function cannot bypass resolution ownership',$q$SELECT marshmallow_private.cx_update_requests('acknowledge',null,'15000000-0000-4000-8000-000000000020',null,0)$q$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Answer remains in requester unresolved count',(public.workflow_requests('{"kind":"cx","action":"counts"}')->>'cx')::int=1);
SELECT pg_temp.check_result('Needs my action includes returned answer',(public.workflow_requests('{"kind":"cx","action":"list_action"}')->>'total')::int=1);
SELECT public.workflow_notifications(jsonb_build_object('action','open','notificationId',(SELECT id FROM public.notifications WHERE title='CS Updated' LIMIT 1)));
SELECT pg_temp.check_result('Opening notification does not resolve request',(public.workflow_requests('{"kind":"cx","action":"counts"}')->>'cx')::int=1);
SELECT public.workflow_requests('{"kind":"cx","action":"question_more","requestId":"15000000-0000-4000-8000-000000000020","text":"Exact time?","revision":2}');
SELECT pg_temp.check_result('Follow-up reopens same request and preserves history',jsonb_array_length(public.workflow_requests('{"kind":"cx","action":"list_pending"}')->'rows'->0->'thread')=3);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_error('Stale reply cannot answer reopened revision',$q$SELECT public.workflow_requests('{"kind":"cx","action":"complete","requestId":"15000000-0000-4000-8000-000000000020","text":"Old reply","revision":1}')$q$,'40001');
SELECT public.workflow_requests('{"kind":"cx","action":"complete","requestId":"15000000-0000-4000-8000-000000000020","text":"2 PM","revision":3}');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT public.workflow_requests('{"kind":"cx","action":"resolve","requestId":"15000000-0000-4000-8000-000000000020","revision":4}');
SELECT public.workflow_requests('{"kind":"cx","action":"resolve","requestId":"15000000-0000-4000-8000-000000000020","revision":4}');
SELECT pg_temp.check_result('Resolution clears active count',(public.workflow_requests('{"kind":"cx","action":"counts"}')->>'cx')::int=0);
SELECT pg_temp.check_result('Resolved history retains actor',public.workflow_requests('{"kind":"cx","action":"list_resolved"}')->'rows'->0->>'resolved_by_name'='Synthetic 2');
RESET ROLE;
-- Reverse Tech direction follows exactly the same requester rule.
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT public.workflow_requests('{"kind":"tech","action":"create","leadId":"15000000-0000-4000-8000-000000000010","requestId":"15000000-0000-4000-8000-000000000021","text":"Part update?"}');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT public.workflow_requests('{"kind":"tech","action":"complete","requestId":"15000000-0000-4000-8000-000000000021","text":"Part collected","revision":1}');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_error('CS Admin cannot silently resolve another Tech requester',$q$SELECT public.workflow_requests('{"kind":"tech","action":"resolve","requestId":"15000000-0000-4000-8000-000000000021","revision":2}')$q$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT public.workflow_requests('{"kind":"tech","action":"resolve","requestId":"15000000-0000-4000-8000-000000000021","revision":2}');
SELECT pg_temp.check_result('Tech requester resolves own answer',(public.workflow_requests('{"kind":"tech","action":"counts"}')->>'tech')::int=0);
RESET ROLE;
SELECT pg_temp.check_result('No request action changed lead or schedule',(SELECT to_jsonb(l)=o.value FROM public.leads l CROSS JOIN original o WHERE job_id='WF-TEST'));
SELECT pg_temp.check_result('Safe retries did not duplicate resolution audit',(SELECT count(*)=2 FROM public.activity_logs WHERE action IN ('cx_update_resolve','tech_update_resolve')));
-- Explicit audited reassignment, never a silent supervisor resolution.
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT public.workflow_requests('{"kind":"cx","action":"create","leadId":"15000000-0000-4000-8000-000000000010","requestId":"15000000-0000-4000-8000-000000000022","text":"New question"}');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.workflow_requests('{"kind":"cx","action":"reassign","requestId":"15000000-0000-4000-8000-000000000022","revision":1,"ownerId":"15000000-0000-4000-8000-000000000001","text":"Requester unavailable; Admin will review"}');
SELECT pg_temp.check_result('Reassignment preserves original requester',public.workflow_requests('{"kind":"cx","action":"get","requestId":"15000000-0000-4000-8000-000000000022"}')->'rows'->0->>'requested_by'='15000000-0000-4000-8000-000000000002');
SELECT pg_temp.check_result('Reassignment does not resolve unanswered work',public.workflow_requests('{"kind":"cx","action":"get","requestId":"15000000-0000-4000-8000-000000000022"}')->'rows'->0->>'acknowledged_at' IS NULL);
RESET ROLE;
SELECT pg_temp.check_result('Reassignment reason is audited',EXISTS(SELECT 1 FROM public.activity_logs WHERE action='cx_update_reassign' AND details LIKE '%Requester unavailable%'));
INSERT INTO public.notifications(user_id,title,message) SELECT '15000000-0000-4000-8000-000000000003','History '||n,'Synthetic' FROM generate_series(1,25) n;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('History exposes later pages beyond bell limit',jsonb_array_length(public.workflow_notifications('{"action":"list","offset":20}')->'rows')>0);
SELECT pg_temp.check_result('Exact total is independent of page limit',(public.workflow_notifications('{"action":"list"}')->>'total')::int>20);
SELECT pg_temp.check_error('Missing mark-read IDs cannot clear unseen work',$q$SELECT public.workflow_notifications('{"action":"read","ids":["invalid"]}')$q$,'22P02');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000006',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_error('Operator denied notification center',$q$SELECT public.workflow_notifications('{"action":"list"}')$q$,'42501');
SELECT pg_temp.check_error('Operator denied request RPC',$q$SELECT public.workflow_requests('{"kind":"cx","action":"counts"}')$q$,'42501');
RESET ROLE;
DELETE FROM public.profiles WHERE id='15000000-0000-4000-8000-000000000001';
SELECT pg_temp.check_result('Deleted reassigned owner never silently falls back to original requester',
  (SELECT marshmallow_private.workflow_resolution_owner(r) IS NULL FROM public.lead_cx_update_requests r WHERE id='15000000-0000-4000-8000-000000000022'));
UPDATE public.lead_cx_update_requests SET recipient_cs=NULL WHERE id='15000000-0000-4000-8000-000000000022';
SELECT set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('NULL participant fields never grant CS queue visibility',
  (public.workflow_requests('{"kind":"cx","action":"get","requestId":"15000000-0000-4000-8000-000000000022"}')->>'total')::int=0);
SELECT pg_temp.check_error('CS cannot answer unassigned request with NULL participant fields',$q$SELECT public.workflow_requests('{"kind":"cx","action":"complete","requestId":"15000000-0000-4000-8000-000000000022","text":"Unauthorized answer","revision":2}')$q$,'42501');
RESET ROLE;
SELECT * FROM checks ORDER BY name;
ROLLBACK;
