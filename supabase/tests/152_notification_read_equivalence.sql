-- ISOLATED WRITE-BASED HARNESS ONLY. Use scripts/test-workflow-inbox-db.mjs,
-- which preserves the previous RPC as workflow_notifications_before in its
-- disposable database. Never run against production; fixtures perform writes.
BEGIN;
CREATE TEMP TABLE checks(name text,result text);
GRANT ALL ON checks TO authenticated;
CREATE FUNCTION pg_temp.check_result(label text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO checks VALUES(label,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.check_error(label text,statement text,code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; PERFORM pg_temp.check_result(label,false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check_result(label,sqlstate=code); END $$;
INSERT INTO auth.users(id,email) SELECT ('15200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'read-test-'||n||'@example.invalid' FROM generate_series(1,7) n;
INSERT INTO public.profiles(id,full_name) SELECT id,'Synthetic '||right(id::text,1) FROM auth.users WHERE id::text LIKE '15200000-%';
INSERT INTO public.user_roles(user_id,role) VALUES
  ('15200000-0000-4000-8000-000000000001','admin'),('15200000-0000-4000-8000-000000000002','processor'),
  ('15200000-0000-4000-8000-000000000003','customer_service'),('15200000-0000-4000-8000-000000000004','cs_admin'),
  ('15200000-0000-4000-8000-000000000005','opr'),('15200000-0000-4000-8000-000000000006','opr_admin'),
  ('15200000-0000-4000-8000-000000000007','customer_service');
INSERT INTO public.leads(id,job_id,customer_name,status,created_by) VALUES
  ('15200000-0000-4000-8000-000000000010','READ-1','Synthetic owned job','urgent_job','15200000-0000-4000-8000-000000000003'),
  ('15200000-0000-4000-8000-000000000011','READ-2','Synthetic other job','urgent_job','15200000-0000-4000-8000-000000000007');
INSERT INTO public.lead_cx_update_requests(id,lead_id,requested_by,recipient_cs,request_text,request_kind,status,revision,response_text,completed_at,completed_by) VALUES
  ('15200000-0000-4000-8000-000000000020','15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000002','15200000-0000-4000-8000-000000000003','Synthetic CX question','cx','pending',2,NULL,NULL,NULL),
  ('15200000-0000-4000-8000-000000000021','15200000-0000-4000-8000-000000000010','15200000-0000-4000-8000-000000000003',NULL,'Synthetic Tech question','tech','tech_updated',2,'Synthetic answer',now(),'15200000-0000-4000-8000-000000000002');
-- Tied timestamps exercise deterministic ID ordering and offset pagination.
INSERT INTO public.notifications(user_id,title,message,read,created_at)
  SELECT u.id,'History '||n,'Synthetic legacy message',n%5<>0,now()-interval '2 days'
  FROM public.profiles u CROSS JOIN generate_series(1,120) n WHERE u.id::text LIKE '15200000-%';
SELECT marshmallow_private.workflow_notify(array_agg(id),'update_requested','Synthetic CX','Synthetic question',
  '15200000-0000-4000-8000-000000000010','READ-1','15200000-0000-4000-8000-000000000020','cx',2) FROM public.profiles WHERE id::text LIKE '15200000-%';
SELECT marshmallow_private.workflow_notify(array_agg(id),'update_answered','Synthetic Tech','Synthetic answer',
  '15200000-0000-4000-8000-000000000010','READ-1','15200000-0000-4000-8000-000000000021','tech',2) FROM public.profiles WHERE id::text LIKE '15200000-%';
SELECT marshmallow_private.workflow_notify(array_agg(id),'schedule_ready','Synthetic Schedule','Synthetic confirmation',
  '15200000-0000-4000-8000-000000000010','READ-1',NULL,NULL,2) FROM public.profiles WHERE id::text LIKE '15200000-%';
SELECT marshmallow_private.workflow_notify(array_agg(id),'schedule_ready','Outside scope','Must stay hidden from CS 3',
  '15200000-0000-4000-8000-000000000011','READ-2',NULL,NULL,2) FROM public.profiles WHERE id::text LIKE '15200000-%';
-- Old revision remains history, not an action; resolved events never alert.
SELECT marshmallow_private.workflow_notify(array_agg(id),'update_requested','Stale revision','Synthetic old question',
  '15200000-0000-4000-8000-000000000010','READ-1','15200000-0000-4000-8000-000000000020','cx',1) FROM public.profiles WHERE id::text LIKE '15200000-%';
SELECT marshmallow_private.workflow_notify(array_agg(id),'update_resolved','Resolved','Synthetic history',
  '15200000-0000-4000-8000-000000000010','READ-1','15200000-0000-4000-8000-000000000021','tech',3) FROM public.profiles WHERE id::text LIKE '15200000-%';
SELECT marshmallow_private.workflow_notify(ARRAY['15200000-0000-4000-8000-000000000003'::uuid],
  'schedule_ready','Synthetic burst','Synthetic confirmation','15200000-0000-4000-8000-000000000010','READ-1',NULL,NULL,n)
  FROM generate_series(10,114) n;
SET LOCAL ROLE authenticated;
DO $$ DECLARE u integer; c text; v text; o integer; p jsonb; before_result jsonb; after_result jsonb;
BEGIN
  FOR u IN 1..4 LOOP
    PERFORM set_config('request.jwt.claim.sub','15200000-0000-4000-8000-'||lpad(u::text,12,'0'),true);
    FOREACH c IN ARRAY ARRAY['all','cx','tech','schedule','other'] LOOP
      FOREACH v IN ARRAY ARRAY['all','unread','action'] LOOP
        FOREACH o IN ARRAY ARRAY[0,20,1000] LOOP
          p:=jsonb_build_object('action','list','category',c,'view',v,'offset',o);
          before_result:=public.workflow_notifications_before(p); after_result:=public.workflow_notifications(p);
          PERFORM pg_temp.check_result(format('Role %s category %s view %s offset %s identical',u,c,v,o),before_result=after_result);
        END LOOP;
      END LOOP;
    END LOOP;
    FOREACH p IN ARRAY ARRAY[
      jsonb_build_object('action','list','search','History 11'),
      jsonb_build_object('action','list','since',now()-interval '1 day','until',now()+interval '1 second'),
      jsonb_build_object('action','alerts','after',now()-interval '15 seconds','until',now()+interval '1 second'),
      jsonb_build_object('action','alerts','after',now()+interval '1 second'),
      jsonb_build_object('action','alerts','after',now()-interval '15 seconds','offset',100)
    ] LOOP
      PERFORM pg_temp.check_result(format('Role %s query %s identical',u,p),public.workflow_notifications_before(p)=public.workflow_notifications(p));
    END LOOP;
  END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','15200000-0000-4000-8000-000000000003',true);
SELECT pg_temp.check_result('CS cannot see other job schedule event',position('Outside scope' IN public.workflow_notifications('{"action":"list","category":"schedule"}')::text)=0);
SELECT pg_temp.check_result('Empty alert window retains exact global unread count',
  (public.workflow_notifications(jsonb_build_object('action','alerts','after',now()+interval '1 second'))->>'unread_count')::int=
  (SELECT count(*) FROM public.notifications WHERE NOT read));
SELECT pg_temp.check_result('Page counts and total are independent',
  jsonb_array_length(public.workflow_notifications('{"action":"list"}')->'rows')=20 AND
  (public.workflow_notifications('{"action":"list"}')->>'total')::int>120);
SELECT pg_temp.check_result('Alert burst preserves exact total beyond 100-row limit',
  jsonb_array_length(public.workflow_notifications(jsonb_build_object('action','alerts','after',now()-interval '15 seconds'))->'rows')=100 AND
  (public.workflow_notifications(jsonb_build_object('action','alerts','after',now()-interval '15 seconds'))->>'total')::int>100 AND
  jsonb_array_length(public.workflow_notifications(jsonb_build_object('action','alerts','after',now()-interval '15 seconds','offset',100))->'rows')>0);
SELECT public.workflow_notifications(jsonb_build_object('action','read','ids',jsonb_build_array((SELECT id FROM public.notifications WHERE title='History 5' LIMIT 1))));
SELECT pg_temp.check_result('Mark read only changes requested snapshot',(SELECT count(*) FROM public.notifications WHERE read AND title IN ('History 5','History 10'))=1);
RESET ROLE;
UPDATE public.lead_cx_update_requests SET recipient_cs=NULL WHERE request_kind='cx';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Revoked participant access hides old CX events',
  (public.workflow_notifications('{"action":"list","category":"cx"}')->>'total')::int=0);
SELECT pg_temp.check_result('Revoked scope still matches previous RPC',
  public.workflow_notifications('{"action":"list"}')=public.workflow_notifications_before('{"action":"list"}'));
RESET ROLE;
INSERT INTO public.lead_status_visibility(user_id,status,is_visible) VALUES('15200000-0000-4000-8000-000000000003','urgent_job',false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Status override removes schedule previews and counts',
  (public.workflow_notifications('{"action":"list","category":"schedule"}')->>'total')::int=0 AND
  public.workflow_notifications('{"action":"list"}')=public.workflow_notifications_before('{"action":"list"}'));
SELECT set_config('request.jwt.claim.sub','15200000-0000-4000-8000-000000000005',true);
SELECT pg_temp.check_error('OPR excluded',$q$SELECT public.workflow_notifications('{"action":"list"}')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','15200000-0000-4000-8000-000000000006',true);
SELECT pg_temp.check_error('OPR Admin excluded',$q$SELECT public.workflow_notifications('{"action":"list"}')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.check_error('Missing identity excluded',$q$SELECT public.workflow_notifications('{"action":"list"}')$q$,'42501');
RESET ROLE;
SELECT * FROM checks ORDER BY name;
ROLLBACK;
