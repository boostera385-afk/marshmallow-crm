-- WRITE-BASED, DISPOSABLE DATABASE ONLY. Synthetic records, rollback at end.
-- Run through scripts/test-performance-optimization-db.mjs, never production.
BEGIN;
CREATE TEMP TABLE checks(name text,result text);
CREATE FUNCTION pg_temp.check_result(n text,ok boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO checks VALUES(n,CASE WHEN coalesce(ok,false) THEN 'PASS' ELSE 'FAIL' END);
END $$;
CREATE FUNCTION pg_temp.delivery(ev text,msg text DEFAULT 'message-one',conv text DEFAULT 'chat-one',sent timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('event_id',ev,'event_type','message.received','raw_payload',jsonb_build_object('synthetic',ev),'signature_verified',true,'preview','Synthetic preview',
    'message',jsonb_build_object('id',msg,'sender','customer','direction','inbound','to',jsonb_build_array('+15550100999'),'text','Synthetic message','media','[]'::jsonb,'createdAt',sent),
    'conversation',jsonb_build_object('id',conv,'phoneNumberId','line-one','phoneNumberDisplay','+15550100999','phoneNumberName','Synthetic line','customerNumber','+15550100001','customerName','Synthetic customer'));
$$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.leads(id,customer_phone,customer_schedule_requirements) VALUES('00000000-0000-4000-8000-000000000001','+15550100001','Keep Friday 1-3 PM');
SELECT public.ingest_quo_message(pg_temp.delivery('delivery-one'));
SELECT pg_temp.check_result('ingests one event, message, conversation and flags atomically',
  (SELECT count(*)=1 FROM public.quo_webhook_events WHERE processing_status='processed') AND
  (SELECT count(*)=1 FROM public.quo_messages) AND (SELECT count(*)=1 FROM public.quo_conversations) AND (SELECT count(*)=1 FROM public.quo_conversation_flags));
SELECT pg_temp.check_result('links the saved lead without changing its workflow',
  (SELECT linked_lead_id='00000000-0000-4000-8000-000000000001'::uuid FROM public.quo_conversations) AND
  (SELECT status='scheduled' AND customer_schedule_requirements='Keep Friday 1-3 PM' FROM public.leads));
SELECT pg_temp.check_result('completed delivery retry is a no-op duplicate',
  (public.ingest_quo_message(pg_temp.delivery('delivery-one'))->>'duplicate')::boolean AND (SELECT count(*)=1 FROM public.quo_messages));
SELECT pg_temp.check_result('different delivery id for same message/type is deduplicated',
  (public.ingest_quo_message(pg_temp.delivery('delivery-copy'))->>'duplicate')::boolean AND (SELECT count(*)=1 FROM public.quo_webhook_events));

INSERT INTO public.quo_webhook_events(quo_event_id,event_type,quo_message_id,raw_payload,processing_status) VALUES('unfinished','message.received','message-two','{}','processing');
SELECT public.ingest_quo_message(pg_temp.delivery('unfinished','message-two'));
SELECT pg_temp.check_result('unfinished event is retried rather than acknowledged as a duplicate',
  (SELECT processing_status='processed' FROM public.quo_webhook_events WHERE quo_event_id='unfinished') AND (SELECT count(*)=2 FROM public.quo_messages));
INSERT INTO public.leads(id,customer_phone,created_at) VALUES('00000000-0000-4000-8000-000000000002','+15550100001',now()+interval '1 day');
UPDATE public.quo_conversations SET status='closed',current_status='closed',last_message_at=now()+interval '1 day';
INSERT INTO public.quo_webhook_events(quo_event_id,event_type,quo_message_id,raw_payload,processing_status) VALUES('old-retry','message.received','old-message','{}','failed');
SELECT public.ingest_quo_message(pg_temp.delivery('old-retry','old-message','chat-one',now()-interval '2 days'));
SELECT pg_temp.check_result('old retry preserves closed chat, newer message and manual lead link',
  (SELECT status='closed' AND current_status='closed' AND last_message_at>now() AND linked_lead_id='00000000-0000-4000-8000-000000000001'::uuid FROM public.quo_conversations WHERE quo_conversation_id='chat-one'));

CREATE FUNCTION pg_temp.reject_flags() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic flags failure'; END $$;
CREATE TRIGGER synthetic_failure BEFORE INSERT ON public.quo_conversation_flags FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_flags();
DO $$ BEGIN
  BEGIN PERFORM public.ingest_quo_message(pg_temp.delivery('must-rollback','failed-message','failed-chat')); EXCEPTION WHEN raise_exception THEN NULL; END;
END $$;
DROP TRIGGER synthetic_failure ON public.quo_conversation_flags;
SELECT pg_temp.check_result('late save failure rolls back event, message and conversation',
  NOT EXISTS(SELECT FROM public.quo_webhook_events WHERE quo_event_id='must-rollback') AND
  NOT EXISTS(SELECT FROM public.quo_messages WHERE quo_message_id='failed-message') AND NOT EXISTS(SELECT FROM public.quo_conversations WHERE quo_conversation_id='failed-chat'));
SELECT public.ingest_quo_message(pg_temp.delivery('must-rollback','failed-message','failed-chat'));
SELECT pg_temp.check_result('retry after rollback succeeds exactly once',(SELECT count(*)=1 FROM public.quo_messages WHERE quo_message_id='failed-message'));
SELECT pg_temp.check_result('browser roles cannot execute privileged ingestion',NOT has_function_privilege('anon','public.ingest_quo_message(jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.ingest_quo_message(jsonb)','EXECUTE'));
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  BEGIN
    PERFORM public.ingest_quo_message(pg_temp.delivery('unauthorized'));
    PERFORM pg_temp.check_result('service RPC also checks caller',false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.check_result('service RPC also checks caller',true); END;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
END $$;

INSERT INTO public.quo_webhook_events(quo_event_id,raw_payload,processing_status,received_at)
SELECT 'retention-'||n,'{"synthetic":true}',CASE n WHEN 1 THEN 'processed' WHEN 2 THEN 'ignored' WHEN 3 THEN 'processing' ELSE 'failed' END,now()-interval '40 days' FROM generate_series(1,4)n;
SELECT pg_temp.check_result('retention selects complete payloads only for old terminal events',
  (SELECT count(*)=2 AND bool_and(raw_payload='{"synthetic":true}'::jsonb) FROM public.webhook_retention_batch(now()-interval '30 days',1000)));
SELECT pg_temp.check_result('retention batch limit is exact',(SELECT count(*)=1 FROM public.webhook_retention_batch(now()-interval '30 days',1)));
SELECT pg_temp.check_result('retention read does not delete rows',(SELECT count(*)=4 FROM public.quo_webhook_events WHERE quo_event_id LIKE 'retention-%'));
SELECT pg_temp.check_result('browser roles cannot execute retention',NOT has_function_privilege('anon','public.webhook_retention_batch(timestamptz,integer)','EXECUTE') AND NOT has_function_privilege('authenticated','public.webhook_retention_batch(timestamptz,integer)','EXECUTE'));
DO $$ BEGIN
  BEGIN PERFORM public.webhook_retention_batch(now(),100); PERFORM pg_temp.check_result('retention rejects unsafe cutoff',false);
  EXCEPTION WHEN invalid_parameter_value THEN PERFORM pg_temp.check_result('retention rejects unsafe cutoff',true); END;
END $$;
SELECT name,result FROM checks ORDER BY name;
ROLLBACK;
