-- Defect: marshmallow_private.payment_workflow raised business-rule conflicts
-- (stale expectedStatus, already-reviewed request, reused operation ID, zero-row
-- guards) with SQLSTATE 40001 (serialization_failure). PostgREST 14 treats 40001
-- as transient and retries the whole transaction indefinitely, so one stale
-- "record payment" call re-ran public.workflow_requests about once per second
-- from 2026-11-21 ~21:00 to 2026-11-22 20:40 UTC (~83k identical Postgres
-- errors, one PostgREST connection) while the browser request timed out.
-- See https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
--
-- Fix: raise the same messages with SQLSTATE PT409. PostgREST returns it once as
-- HTTP 409 and never retries it. Function logic, messages, authorization, locks,
-- idempotency ledger, audit rows, SECURITY DEFINER and search_path are otherwise
-- byte-for-byte unchanged from 20261231000000_atomic_payment_workflow.sql.
-- The CRM shows error.message only, so no client change is needed. No Donut
-- counterpart (Donut has no payment flow). No data repair; no public.leads UPDATE.
--
-- Idempotent: CREATE OR REPLACE plus re-stated grants.
-- Rollback: re-run only the payment_workflow CREATE OR REPLACE, REVOKE and GRANT
-- statements from 20261231000000_atomic_payment_workflow.sql (restores 40001 and
-- the retry-loop risk). No table, policy, trigger or data change to undo.
BEGIN;

CREATE OR REPLACE FUNCTION marshmallow_private.payment_workflow(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  caller uuid := auth.uid();
  admin boolean := public.has_role(caller,'admin'::public.app_role);
  processor boolean := public.has_role(caller,'processor'::public.app_role);
  action text := p->>'action';
  operation_id uuid := (p->>'operationId')::uuid;
  v_lead_id uuid := (p->>'leadId')::uuid;
  request_id uuid := nullif(p->>'requestId','')::uuid;
  outcome text := p->>'requestType';
  decision text := p->>'decision';
  amount_paid numeric := nullif(p->>'amount','')::numeric;
  screenshot text := nullif(p->>'screenshotPath','');
  comment_text text := nullif(btrim(p->>'comment'),'');
  actor_name text;
  l public.leads%rowtype;
  r public.lead_payment_requests%rowtype;
  prior marshmallow_private.payment_operations%rowtype;
  result jsonb;
  audit_action text;
  status_before text;
BEGIN
  IF caller IS NULL OR NOT coalesce(admin OR processor,false) THEN
    RAISE EXCEPTION 'Payment access denied' USING errcode='42501';
  END IF;
  IF action IS NULL OR action NOT IN ('create','direct','review') OR operation_id IS NULL
     OR v_lead_id IS NULL OR octet_length(p::text)>20000 THEN
    RAISE EXCEPTION 'Invalid payment operation' USING errcode='22023';
  END IF;
  IF (action='create' AND NOT processor) OR (action IN ('direct','review') AND NOT admin) THEN
    RAISE EXCEPTION 'Your role cannot perform this payment action' USING errcode='42501';
  END IF;
  -- Same operation serializes uncertain retries; every action then locks lead
  -- before request, including creation, so review/create cannot deadlock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('payment:'||operation_id::text,0));
  SELECT * INTO prior FROM marshmallow_private.payment_operations WHERE id=operation_id;
  IF found THEN
    IF prior.actor<>caller OR prior.payload<>p THEN
      RAISE EXCEPTION 'Payment operation ID already used with different details' USING errcode='PT409';
    END IF;
    RETURN prior.result;
  END IF;
  -- Admin and Processor are globally lead-scoped in the existing leads RLS;
  -- all other roles are rejected above. The public invoker also checks live RLS.
  SELECT * INTO l FROM public.leads WHERE id=v_lead_id FOR UPDATE;
  IF NOT found THEN RAISE EXCEPTION 'Lead unavailable' USING errcode='42501'; END IF;
  status_before := l.status;
  SELECT full_name INTO actor_name FROM public.profiles WHERE id=caller;
  actor_name := coalesce(actor_name,'Team member');

  IF action='review' THEN
    IF decision IS NULL OR decision NOT IN ('approved','rejected') OR request_id IS NULL THEN
      RAISE EXCEPTION 'Invalid payment review' USING errcode='22023';
    END IF;
    SELECT * INTO r FROM public.lead_payment_requests WHERE id=request_id AND lead_id=l.id FOR UPDATE;
    IF NOT found THEN RAISE EXCEPTION 'Payment request unavailable' USING errcode='42501'; END IF;
    IF r.status<>'pending' THEN
      RAISE EXCEPTION 'This payment request was already reviewed. Refresh the queue.' USING errcode='PT409';
    END IF;
    IF r.requested_by=caller THEN
      RAISE EXCEPTION 'You cannot approve or reject your own payment request' USING errcode='42501';
    END IF;
    IF l.status<>'payment_requested' THEN
      RAISE EXCEPTION 'Lead status changed after this request. Refresh and review it.' USING errcode='PT409';
    END IF;
    outcome := CASE WHEN decision='approved' THEN r.request_type ELSE r.previous_status END;
    amount_paid := r.amount;
    screenshot := r.screenshot_path;
    IF outcome IS NULL OR (decision='approved' AND outcome NOT IN ('paid','partial_paid')) THEN
      RAISE EXCEPTION 'Invalid saved payment outcome' USING errcode='22023';
    END IF;
  ELSE
    IF l.status='paid' THEN RAISE EXCEPTION 'Paid is final' USING errcode='23514'; END IF;
    IF p->>'expectedStatus' IS DISTINCT FROM l.status THEN
      RAISE EXCEPTION 'Lead status changed. Refresh before recording payment.' USING errcode='PT409';
    END IF;
    IF outcome IS NULL OR outcome NOT IN ('paid','partial_paid') THEN
      RAISE EXCEPTION 'Invalid payment outcome' USING errcode='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.lead_payment_requests WHERE lead_id=l.id AND status='pending') THEN
      RAISE EXCEPTION 'This lead already has a pending payment request. Review it first.' USING errcode='23505';
    END IF;
  END IF;
  IF action<>'review' OR decision='approved' THEN
    IF amount_paid IS NULL OR amount_paid<=0 OR amount_paid::text IN ('NaN','Infinity','-Infinity')
       OR trunc(amount_paid,2)<>amount_paid THEN
      RAISE EXCEPTION 'Enter a positive payment amount with at most two decimal places' USING errcode='22023';
    END IF;
  END IF;
  IF length(coalesce(comment_text,''))>4000 THEN
    RAISE EXCEPTION 'Payment comment is too long' USING errcode='22023';
  END IF;
  IF screenshot IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='lead-photos' AND name=screenshot) THEN
      RAISE EXCEPTION 'Selected payment screenshot is unavailable. Upload it again.' USING errcode='22023';
    END IF;
    IF action<>'review' AND (screenshot NOT LIKE (CASE WHEN action='create' THEN 'payment-requests/' ELSE 'payments/' END
       ||l.id::text||'/'||caller::text||'/'||operation_id::text||'/%')
       OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='lead-photos' AND name=screenshot
                      AND (owner_id=caller::text OR owner=caller))) THEN
      RAISE EXCEPTION 'Selected payment screenshot is unavailable. Upload it again.' USING errcode='22023';
    END IF;
  END IF;

  IF action='create' THEN
    INSERT INTO public.lead_payment_requests(id,lead_id,previous_status,requested_by,requested_by_name,
      requested_by_role,request_type,amount,screenshot_path,comment,status)
    VALUES(operation_id,l.id,l.status,caller,actor_name,'processor',outcome,amount_paid,screenshot,comment_text,'pending')
    RETURNING * INTO r;
    UPDATE public.leads SET status='payment_requested',cs_tag=NULL,last_edited_by=caller,
      last_edited_by_name=actor_name,updated_at=now(),last_edited_at=now() WHERE id=l.id;
    audit_action := 'payment_requested';
    result := jsonb_build_object('saved',true,'id',r.id,'status','payment_requested');
  ELSIF action='review' AND decision='rejected' THEN
    UPDATE public.leads SET status=outcome,last_edited_by=caller,last_edited_by_name=actor_name,
      updated_at=now(),last_edited_at=now() WHERE id=l.id;
    audit_action := 'payment_rejected';
    result := jsonb_build_object('saved',true,'id',r.id,'status',outcome);
  ELSE
    UPDATE public.leads SET status=outcome,amount=amount_paid,payment_amount=amount_paid,
      payment_screenshot_url=screenshot,cs_tag=NULL,last_edited_by=caller,last_edited_by_name=actor_name,
      updated_at=now(),last_edited_at=now() WHERE id=l.id;
    audit_action := CASE WHEN action='review' THEN 'payment_approved' ELSE 'payment_recorded' END;
    result := jsonb_build_object('saved',true,'id',coalesce(r.id,operation_id),'status',outcome);
  END IF;
  IF NOT found THEN RAISE EXCEPTION 'Payment lead update was not applied' USING errcode='PT409'; END IF;
  IF action='review' THEN
    UPDATE public.lead_payment_requests SET status=decision,reviewed_by=caller,reviewed_by_name=actor_name,
      reviewed_at=now(),review_note=comment_text WHERE id=r.id AND status='pending';
    IF NOT found THEN RAISE EXCEPTION 'Payment review was not applied' USING errcode='PT409'; END IF;
  END IF;
  INSERT INTO public.activity_logs(user_id,user_name,action,target_type,target_id,details)
  VALUES(caller,actor_name,audit_action,'lead',l.id::text,jsonb_build_object(
    'operation_id',operation_id,'request_id',r.id,'job_id',l.job_id,'target_name',l.job_id,
    'request_type',CASE WHEN action='review' THEN r.request_type ELSE p->>'requestType' END,
    'amount',amount_paid,'screenshot_path',screenshot,'status_from',status_before,
    'status_to',result->>'status','review_note',comment_text)::text);
  INSERT INTO marshmallow_private.payment_operations(id,actor,payload,result)
    VALUES(operation_id,caller,p,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.payment_workflow(jsonb) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA marshmallow_private TO authenticated;
GRANT EXECUTE ON FUNCTION marshmallow_private.payment_workflow(jsonb) TO authenticated;
COMMIT;
