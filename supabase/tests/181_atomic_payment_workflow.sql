-- Disposable fixture only. Synthetic writes, NEVER run on shared production.
BEGIN;
CREATE TEMP TABLE checks(name text,result text);
CREATE FUNCTION pg_temp.payment_call(action text, lead_number integer, operation_number integer,
  extras jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.workflow_requests(jsonb_build_object(
    'kind','payment','action',action,
    'leadId','18000000-0000-4000-9000-'||lpad(lead_number::text,12,'0'),
    'operationId','18000000-0000-4000-a000-'||lpad(operation_number::text,12,'0'),
    'expectedStatus','job_done','requestType','partial_paid','amount',25.50)||extras);
$$;
DO $$
DECLARE
  r jsonb; again jsonb; denied boolean; role_row record; amount_value text; n integer:=100;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000002',true);
  r:=pg_temp.payment_call('create',1,1);
  again:=pg_temp.payment_call('create',1,1);
  INSERT INTO checks VALUES('creation moves lead and request together; retry is idempotent',
    CASE WHEN r=again AND (SELECT status='payment_requested' FROM public.leads WHERE job_id='TEST-1')
      AND (SELECT count(*)=1 FROM public.lead_payment_requests)
      AND (SELECT count(*)=1 FROM public.activity_logs) THEN 'PASS' ELSE 'FAIL' END);
  denied:=false;
  BEGIN PERFORM pg_temp.payment_call('create',1,2,jsonb_build_object('expectedStatus','payment_requested'));
  EXCEPTION WHEN unique_violation THEN denied:=true; END;
  INSERT INTO checks VALUES('second pending request rejected',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
  PERFORM set_config('test.fail_payment_write','yes',true);
  denied:=false;
  BEGIN PERFORM pg_temp.payment_call('create',2,3);
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  PERFORM set_config('test.fail_payment_write','no',true);
  INSERT INTO checks VALUES('failed creation lead write rolls back request audit and idempotency',
    CASE WHEN denied AND NOT EXISTS(SELECT 1 FROM public.lead_payment_requests WHERE lead_id='18000000-0000-4000-9000-000000000002')
      AND NOT EXISTS(SELECT 1 FROM marshmallow_private.payment_operations WHERE id='18000000-0000-4000-a000-000000000003')
      THEN 'PASS' ELSE 'FAIL' END);

  PERFORM set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000001',true);
  PERFORM set_config('test.fail_payment_write','yes',true);
  denied:=false;
  BEGIN PERFORM pg_temp.payment_call('review',1,4,jsonb_build_object('requestId',r->>'id','decision','approved'));
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  PERFORM set_config('test.fail_payment_write','no',true);
  INSERT INTO checks VALUES('failed approval leaves request pending and original lead intact',
    CASE WHEN denied AND (SELECT status='pending' FROM public.lead_payment_requests WHERE id=(r->>'id')::uuid)
      AND (SELECT status='payment_requested' FROM public.leads WHERE job_id='TEST-1') THEN 'PASS' ELSE 'FAIL' END);
  again:=pg_temp.payment_call('review',1,4,jsonb_build_object('requestId',r->>'id','decision','approved','amount',999,'requestType','paid'));
  INSERT INTO checks VALUES('approval uses saved partial outcome amount and schedule, not browser values',
    CASE WHEN (SELECT status='partial_paid' AND payment_amount=25.5 AND scheduled_date='2026-11-25'
      AND scheduled_time_start='10:00' AND customer_schedule_requirements='Keep the agreed schedule'
      FROM public.leads WHERE job_id='TEST-1')
      AND (SELECT status='approved' FROM public.lead_payment_requests WHERE id=(r->>'id')::uuid) THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO checks VALUES('uncertain review retry returns saved acknowledgement with no second audit',
    CASE WHEN again=pg_temp.payment_call('review',1,4,jsonb_build_object('requestId',r->>'id','decision','approved','amount',999,'requestType','paid'))
      AND (SELECT count(*)=2 FROM public.activity_logs) THEN 'PASS' ELSE 'FAIL' END);
  denied:=false;
  BEGIN PERFORM pg_temp.payment_call('review',1,5,jsonb_build_object('requestId',r->>'id','decision','rejected'));
  EXCEPTION WHEN serialization_failure THEN denied:=true; END;
  INSERT INTO checks VALUES('stale/conflicting second review cannot overwrite approval',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);

  PERFORM set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000002',true);
  r:=pg_temp.payment_call('create',3,6,jsonb_build_object('requestType','paid'));
  PERFORM set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000001',true);
  PERFORM pg_temp.payment_call('review',3,7,jsonb_build_object('requestId',r->>'id','decision','rejected'));
  INSERT INTO checks VALUES('rejection restores saved previous status atomically',
    CASE WHEN (SELECT status='job_done' FROM public.leads WHERE job_id='TEST-3')
      AND (SELECT status='rejected' FROM public.lead_payment_requests WHERE id=(r->>'id')::uuid) THEN 'PASS' ELSE 'FAIL' END);
  PERFORM set_config('test.fail_payment_audit','yes',true);
  denied:=false;
  BEGIN PERFORM pg_temp.payment_call('direct',4,8);
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  PERFORM set_config('test.fail_payment_audit','no',true);
  INSERT INTO checks VALUES('audit failure rolls back direct payment and operation ledger',
    CASE WHEN denied AND (SELECT status='job_done' AND payment_amount IS NULL FROM public.leads WHERE job_id='TEST-4')
      AND NOT EXISTS(SELECT 1 FROM marshmallow_private.payment_operations WHERE id='18000000-0000-4000-a000-000000000008') THEN 'PASS' ELSE 'FAIL' END);
  PERFORM pg_temp.payment_call('direct',4,8,jsonb_build_object('requestType','paid'));
  denied:=false;
  BEGIN PERFORM pg_temp.payment_call('direct',4,9,jsonb_build_object('expectedStatus','paid'));
  EXCEPTION WHEN check_violation THEN denied:=true; END;
  INSERT INTO checks VALUES('paid remains terminal even for Admin',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
  PERFORM pg_temp.payment_call('direct',5,10);
  PERFORM pg_temp.payment_call('direct',5,11,jsonb_build_object('expectedStatus','partial_paid','requestType','paid'));
  INSERT INTO checks VALUES('partial paid is nonterminal and can finish Paid',
    CASE WHEN (SELECT status='paid' FROM public.leads WHERE job_id='TEST-5') THEN 'PASS' ELSE 'FAIL' END);
  denied:=false;
  BEGIN PERFORM pg_temp.payment_call('direct',6,12,jsonb_build_object('expectedStatus','scheduled'));
  EXCEPTION WHEN serialization_failure THEN denied:=true; END;
  INSERT INTO checks VALUES('stale lead version fails without mutation',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
  denied:=false;
  BEGIN PERFORM pg_temp.payment_call('direct',99,13);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  INSERT INTO checks VALUES('unavailable lead never returns a successful zero-row write',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);

  FOREACH amount_value IN ARRAY ARRAY['0','-1','NaN','Infinity','1.001'] LOOP
    denied:=false; n:=n+1;
    BEGIN PERFORM pg_temp.payment_call('direct',6,n,jsonb_build_object('amount',amount_value));
    EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
    INSERT INTO checks VALUES('backend rejects amount '||amount_value,CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
  END LOOP;
  denied:=false;
  BEGIN PERFORM pg_temp.payment_call('direct',6,14,jsonb_build_object('screenshotPath','payments/missing.png'));
  EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
  INSERT INTO checks VALUES('missing/foreign screenshot cannot produce saved payment',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO storage.objects VALUES('lead-photos',
    'payments/18000000-0000-4000-9000-000000000006/18000000-0000-4000-8000-000000000001/18000000-0000-4000-a000-000000000014/proof.png',
    '18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.payment_call('direct',6,14,jsonb_build_object('screenshotPath',
    'payments/18000000-0000-4000-9000-000000000006/18000000-0000-4000-8000-000000000001/18000000-0000-4000-a000-000000000014/proof.png'));
  INSERT INTO checks VALUES('existing caller-owned screenshot saved with payment',
    CASE WHEN (SELECT payment_screenshot_url LIKE '%proof.png' FROM public.leads WHERE job_id='TEST-6') THEN 'PASS' ELSE 'FAIL' END);
  denied:=false;
  BEGIN PERFORM pg_temp.payment_call('direct',6,14,jsonb_build_object('amount',50));
  EXCEPTION WHEN serialization_failure THEN denied:=true; END;
  INSERT INTO checks VALUES('operation ID cannot be reused for different details',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);

  FOR role_row IN SELECT * FROM public.user_roles WHERE role<>'admin' LOOP
    PERFORM set_config('request.jwt.claim.sub',role_row.user_id::text,true);
    denied:=false; n:=n+1;
    BEGIN PERFORM pg_temp.payment_call('direct',7,n);
    EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
    INSERT INTO checks VALUES(role_row.role||' cannot directly record payments',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
    IF role_row.role<>'processor' THEN
      denied:=false; n:=n+1;
      BEGIN PERFORM pg_temp.payment_call('create',7,n);
      EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
      INSERT INTO checks VALUES(role_row.role||' cannot create requests',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','',true);
  denied:=false;
  BEGIN PERFORM pg_temp.payment_call('direct',7,200);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  INSERT INTO checks VALUES('unauthenticated caller denied',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
  PERFORM set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000001',true);
  INSERT INTO checks VALUES('existing CX/Tech dispatcher unchanged',
    CASE WHEN public.workflow_requests('{"kind":"cx","action":"counts"}')='{"legacy":true}'::jsonb THEN 'PASS' ELSE 'FAIL' END);
END $$;
GRANT SELECT,INSERT ON checks TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE denied boolean;
BEGIN
  denied:=false;
  BEGIN
    INSERT INTO public.lead_payment_requests(lead_id,previous_status,requested_by_role,amount)
    VALUES('18000000-0000-4000-9000-000000000007','job_done','admin',25);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  INSERT INTO checks VALUES('legacy direct request insert fails closed',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
  WITH changed AS (UPDATE public.lead_payment_requests SET status='approved' WHERE status='pending' RETURNING id)
  INSERT INTO checks SELECT 'legacy direct review affects zero rows',CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM changed;
  denied:=false;
  BEGIN UPDATE public.leads SET status='paid',payment_amount=25 WHERE job_id='TEST-7';
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  INSERT INTO checks VALUES('legacy direct paid transition rejected even for Admin',CASE WHEN denied THEN 'PASS' ELSE 'FAIL' END);
END $$;
RESET ROLE;
SELECT * FROM checks ORDER BY name;
ROLLBACK;
