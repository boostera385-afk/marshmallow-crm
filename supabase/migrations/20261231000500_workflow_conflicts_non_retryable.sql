-- Defect: marshmallow_private.workflow_requests and schedule_admin raise business-rule conflicts with SQLSTATE 40001
-- (serialization_failure). PostgREST 14 treats 40001 as transient and retries
-- the whole transaction indefinitely, as happened to the payment RPC on
-- 2026-11-21/22 (fixed in 20261231000300).
-- See https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
--
-- Conflicts: CX/Tech update stale revision, already resolved, already
-- answered (public.workflow_requests); stale schedule-monitor enablement
-- (public.schedule_monitor_admin). Callers: the CRM directly
-- (src/lib/cx-update-requests.ts) and Edge Functions cx-update-requests and
-- workflow-inbox.
--
-- Fix: raise the same messages with SQLSTATE PT409 (HTTP 409, never retried).
-- Each statement is copied from the latest migration defining that function,
-- whose body matched production on 2026-11-23 (schedule_admin differs only by CRLF line endings, normalized here). Logic, messages,
-- authorization, SECURITY DEFINER/INVOKER and search_path are otherwise
-- unchanged; CREATE OR REPLACE keeps existing owners and grants. No data repair.
--
-- Rollout: publish the CRM and deploy Edge Functions cx-update-requests and
-- workflow-inbox (they accept PT409) BEFORE applying; until then these
-- conflicts show "unavailable" instead of the refresh message. No Donut
-- counterpart.
--
-- Idempotent: CREATE OR REPLACE only.
-- Rollback: re-run each function's CREATE OR REPLACE statement from the source
-- migration named above it (restores 40001 and the retry-loop risk).
BEGIN;

-- From 20261020065810_workflow_resolution_notifications.sql (3 conflict raises -> PT409)
CREATE OR REPLACE FUNCTION marshmallow_private.workflow_requests(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  caller uuid := auth.uid(); role_name text := marshmallow_private.workflow_role();
  kind text := p->>'kind'; action text := p->>'action';
  request_id uuid := nullif(p->>'requestId','')::uuid; lead_id uuid := nullif(p->>'leadId','')::uuid;
  body text := btrim(p->>'text'); expected integer := (p->>'revision')::integer;
  page_offset integer := coalesce((p->>'offset')::integer,0);
  r public.lead_cx_update_requests%rowtype; l public.leads%rowtype;
  owner uuid; recipient uuid; actor_name text; users uuid[]; total bigint; rows_json jsonb;
BEGIN
  IF caller IS NULL OR role_name IS NULL OR role_name NOT IN ('admin','processor','cs_admin','customer_service') THEN
    RAISE EXCEPTION 'Update request access denied' USING errcode='42501'; END IF;
  IF kind IS NULL OR kind NOT IN ('cx','tech') OR action IS NULL OR action NOT IN
    ('count','counts','owners','list_pending','list_updated','list_action','list_resolved','get','create','complete','resolve','acknowledge','question_more','reassign') THEN
    RAISE EXCEPTION 'Invalid update request action' USING errcode='22023'; END IF;
  IF page_offset < 0 THEN RAISE EXCEPTION 'Invalid page' USING errcode='22023'; END IF;
  SELECT full_name INTO actor_name FROM public.profiles WHERE id=caller;
  IF action='owners' THEN
    IF role_name<>'admin' THEN RAISE EXCEPTION 'Admin only' USING errcode='42501'; END IF;
    SELECT jsonb_build_object('owners',coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'role',x.role_name) ORDER BY x.full_name),'[]'::jsonb)) INTO rows_json
      FROM (SELECT p.id,p.full_name,min(ur.role::text) AS role_name FROM public.profiles p JOIN public.user_roles ur ON ur.user_id=p.id
        GROUP BY p.id,p.full_name HAVING count(*)=1 AND min(ur.role::text)=ANY(CASE WHEN kind='cx' THEN ARRAY['admin','processor'] ELSE ARRAY['cs_admin','customer_service'] END)) x;
    RETURN rows_json;
  END IF;

  IF action IN ('count','counts') THEN
    SELECT jsonb_build_object('cx',count(*) FILTER(WHERE request_kind='cx'),'tech',count(*) FILTER(WHERE request_kind='tech'))
      INTO rows_json FROM public.lead_cx_update_requests q
      WHERE acknowledged_at IS NULL AND marshmallow_private.workflow_request_visible(q);
    IF action='counts' THEN RETURN rows_json; END IF;
    RETURN jsonb_build_object('count',(rows_json->>kind)::bigint);
  END IF;
  IF action IN ('list_pending','list_updated','list_action','list_resolved','get') THEN
    WITH visible AS (
      SELECT q.* FROM public.lead_cx_update_requests q
      WHERE q.request_kind=kind AND marshmallow_private.workflow_request_visible(q)
      AND CASE action
        WHEN 'get' THEN q.id=request_id
        WHEN 'list_resolved' THEN q.acknowledged_at IS NOT NULL
        WHEN 'list_pending' THEN q.acknowledged_at IS NULL AND q.status='pending'
        WHEN 'list_updated' THEN q.acknowledged_at IS NULL AND q.status<>'pending'
        ELSE q.acknowledged_at IS NULL AND (
          (q.status<>'pending' AND marshmallow_private.workflow_resolution_owner(q)=caller)
          OR (q.status='pending' AND ((kind='cx' AND (role_name='cs_admin' OR (role_name='customer_service' AND q.recipient_cs=caller)))
            OR (kind='tech' AND role_name='processor')))) END
    ), page AS (SELECT * FROM visible ORDER BY created_at DESC,id LIMIT 20 OFFSET page_offset)
    SELECT jsonb_build_object('total',(SELECT count(*) FROM visible),'rows',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,id) FROM (
      SELECT q.created_at,q.id,jsonb_build_object(
        'id',q.id,'lead_id',q.lead_id,'request_kind',q.request_kind,'requested_by',q.requested_by,
        'requester_name',requester.full_name,'recipient_cs',q.recipient_cs,'recipient_name',cs.full_name,
        'resolution_owner',marshmallow_private.workflow_resolution_owner(q),'owner_name',owner_profile.full_name,
        'revision',q.revision,'acknowledged_at',q.acknowledged_at,'resolved_by_name',coalesce(q.resolved_by_name,resolver.full_name),
        'request_text',q.request_text,'status',q.status,'response_text',q.response_text,'completed_at',q.completed_at,
        'completed_by_name',responder.full_name,'created_at',q.created_at,'thread',q.thread,
        'customer',jsonb_build_object('job_id',j.job_id,'customer_name',j.customer_name,'customer_phone',j.customer_phone,
          'customer_landline',j.customer_landline,'customer_email',j.customer_email,'service_type',j.service_type,
          'service_details',j.service_details,'address',j.address,'city',j.city,'state',j.state,'zip_code',j.zip_code,
          'customer_schedule_requirements',j.customer_schedule_requirements,'scheduled_date',j.scheduled_date,
          'scheduled_time_start',j.scheduled_time_start,'scheduled_time_end',j.scheduled_time_end),
        'technician',CASE WHEN kind='tech' AND role_name IN ('admin','processor') THEN
          jsonb_build_object('status',j.status,'tech_name',j.tech_name,'tech_number',j.tech_number,'terms',j.terms) ELSE NULL END
      ) item FROM page q JOIN public.leads j ON j.id=q.lead_id
      LEFT JOIN public.profiles requester ON requester.id=q.requested_by
      LEFT JOIN public.profiles cs ON cs.id=q.recipient_cs
      LEFT JOIN public.profiles responder ON responder.id=q.completed_by
      LEFT JOIN public.profiles owner_profile ON owner_profile.id=marshmallow_private.workflow_resolution_owner(q)
      LEFT JOIN public.profiles resolver ON resolver.id=q.resolved_by
    ) results),'[]'::jsonb)) INTO rows_json;
    RETURN rows_json;
  END IF;
  IF request_id IS NULL THEN RAISE EXCEPTION 'Request ID required' USING errcode='22023'; END IF;
  IF action='create' THEN
    IF (kind='cx' AND role_name NOT IN ('admin','processor')) OR (kind='tech' AND role_name NOT IN ('cs_admin','customer_service')) THEN
      RAISE EXCEPTION 'Your role cannot create this request' USING errcode='42501'; END IF;
    IF body IS NULL OR length(body) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter a question (1–2000 characters)' USING errcode='22023'; END IF;
    SELECT * INTO l FROM public.leads WHERE id=lead_id FOR UPDATE;
    IF NOT found THEN RAISE EXCEPTION 'Lead unavailable' USING errcode='42501'; END IF;
    -- Repeat the public invoker's ownership check: private schema execution is
    -- not an alternative path around the existing lead policy.
    IF (role_name='customer_service' AND NOT coalesce(l.created_by=caller OR l.assigned_cs=caller OR EXISTS(
      SELECT 1 FROM public.lead_shares s WHERE s.lead_id=l.id AND s.shared_with_user_id=caller),false))
      OR (role_name='cs_admin' AND l.status IN ('paid','partial_paid','cancelled','job_done','scammed')) THEN
      RAISE EXCEPTION 'Lead outside your access scope' USING errcode='42501'; END IF;
    SELECT * INTO r FROM public.lead_cx_update_requests WHERE id=request_id;
    IF found THEN
      IF r.requested_by=caller AND r.lead_id=lead_id AND r.request_kind=kind AND coalesce(r.thread->0->>'text',r.request_text)=body THEN
        RETURN jsonb_build_object('saved',true,'id',r.id); END IF;
      RAISE EXCEPTION 'Request ID already used' USING errcode='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.lead_cx_update_requests q WHERE q.lead_id=l.id AND q.request_kind=kind AND q.status='pending') THEN
      RAISE EXCEPTION 'This job already has a pending request. Review the existing conversation.' USING errcode='23505'; END IF;
    IF kind='cx' THEN
      recipient:=coalesce(l.assigned_cs,l.created_by);
      IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=recipient GROUP BY user_id HAVING count(*)=1 AND min(role::text)='customer_service') THEN recipient:=NULL; END IF;
    END IF;
    INSERT INTO public.lead_cx_update_requests(id,lead_id,requested_by,recipient_cs,request_text,request_kind,thread)
      VALUES(request_id,l.id,caller,recipient,body,kind,jsonb_build_array(jsonb_build_object('type','question','text',body,'at',now(),'by_name',actor_name))) RETURNING * INTO r;
  ELSE
    -- Same lock order as creation prevents follow-up vs creation deadlocks.
    SELECT q.lead_id INTO lead_id FROM public.lead_cx_update_requests q WHERE q.id=request_id;
    PERFORM 1 FROM public.leads WHERE id=lead_id FOR UPDATE;
    SELECT * INTO r FROM public.lead_cx_update_requests WHERE id=request_id FOR UPDATE;
    IF NOT found OR r.request_kind<>kind OR NOT marshmallow_private.workflow_request_visible(r) THEN
      RAISE EXCEPTION 'Request unavailable' USING errcode='42501'; END IF;
    owner:=marshmallow_private.workflow_resolution_owner(r);
    IF action IN ('resolve','acknowledge','question_more') AND owner IS DISTINCT FROM caller THEN
      RAISE EXCEPTION 'Only the request owner may resolve or follow up this response' USING errcode='42501'; END IF;
    IF action IN ('resolve','acknowledge') AND r.acknowledged_at IS NOT NULL AND r.resolved_by=caller THEN
      RETURN jsonb_build_object('saved',true,'id',r.id); END IF;
    IF action='complete' AND r.completed_by=caller AND r.response_text=body AND r.revision=expected+1 THEN
      RETURN jsonb_build_object('saved',true,'id',r.id); END IF;
    IF expected IS NULL OR expected<>r.revision THEN RAISE EXCEPTION 'This request changed. Refresh before saving.' USING errcode='PT409'; END IF;
    IF r.acknowledged_at IS NOT NULL THEN RAISE EXCEPTION 'This request is resolved' USING errcode='PT409'; END IF;
    IF action='reassign' THEN
      IF role_name<>'admin' OR body IS NULL OR length(body) NOT BETWEEN 10 AND 2000 THEN
        RAISE EXCEPTION 'Admin and a reassignment reason are required' USING errcode='42501'; END IF;
      recipient:=(p->>'ownerId')::uuid;
      IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=recipient GROUP BY user_id HAVING count(*)=1 AND min(role::text)=ANY(
        CASE WHEN kind='cx' THEN ARRAY['admin','processor'] ELSE ARRAY['cs_admin','customer_service'] END)) THEN
        RAISE EXCEPTION 'Choose an eligible resolution owner' USING errcode='22023'; END IF;
      UPDATE public.lead_cx_update_requests SET resolution_owner=recipient,resolution_owner_assigned=true,revision=revision+1 WHERE id=request_id RETURNING * INTO r;
    ELSIF action='complete' THEN
      IF (kind='cx' AND NOT coalesce(role_name='cs_admin' OR (role_name='customer_service' AND r.recipient_cs=caller),false))
        OR (kind='tech' AND role_name<>'processor') THEN RAISE EXCEPTION 'Your role cannot answer this request' USING errcode='42501'; END IF;
      IF r.status<>'pending' THEN RAISE EXCEPTION 'The request already has a response' USING errcode='PT409'; END IF;
      IF body IS NULL OR length(body) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Enter an update (1–4000 characters)' USING errcode='22023'; END IF;
      UPDATE public.lead_cx_update_requests SET status=CASE WHEN kind='cx' THEN 'cs_updated' ELSE 'tech_updated' END,
        response_text=body,completed_by=caller,completed_at=now(),revision=revision+1,
        thread=thread||jsonb_build_array(jsonb_build_object('type','response','text',body,'at',now(),'by_name',actor_name))
        WHERE id=request_id RETURNING * INTO r;
    ELSIF action='question_more' THEN
      IF r.status='pending' THEN RAISE EXCEPTION 'Wait for a response before asking a follow-up' USING errcode='22023'; END IF;
      IF body IS NULL OR length(body) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter a follow-up (1–2000 characters)' USING errcode='22023'; END IF;
      IF EXISTS(SELECT 1 FROM public.lead_cx_update_requests q WHERE q.lead_id=r.lead_id AND q.request_kind=kind AND q.status='pending' AND q.id<>r.id) THEN
        RAISE EXCEPTION 'Another request is awaiting a response' USING errcode='23505'; END IF;
      UPDATE public.lead_cx_update_requests SET status='pending',request_text=body,response_text=NULL,completed_by=NULL,completed_at=NULL,
        revision=revision+1,thread=thread||jsonb_build_array(jsonb_build_object('type','question','text',body,'at',now(),'by_name',actor_name))
        WHERE id=request_id RETURNING * INTO r;
    ELSE
      IF r.status='pending' THEN RAISE EXCEPTION 'An unanswered request cannot be resolved' USING errcode='22023'; END IF;
      UPDATE public.lead_cx_update_requests SET acknowledged_at=now(),resolved_by=caller,resolved_by_name=actor_name,revision=revision+1 WHERE id=request_id RETURNING * INTO r;
    END IF;
    SELECT * INTO l FROM public.leads WHERE id=r.lead_id;
  END IF;
  IF action IN ('create','question_more') THEN
    SELECT array_agg(DISTINCT user_id) INTO users FROM public.user_roles WHERE
      (kind='cx' AND (role::text='cs_admin' OR user_id=r.recipient_cs)) OR (kind='tech' AND role::text IN ('admin','processor'));
  ELSE
    SELECT array_agg(DISTINCT user_id) INTO users FROM public.user_roles WHERE user_id IN (marshmallow_private.workflow_resolution_owner(r),r.requested_by)
      OR (kind='cx' AND role::text='admin') OR (kind='tech' AND role::text='cs_admin');
    IF action IN ('resolve','acknowledge') THEN users:=array_remove(array_append(users,r.completed_by),caller); END IF;
  END IF;
  PERFORM marshmallow_private.workflow_notify(users,
    CASE WHEN action IN ('create','question_more') THEN 'update_requested' WHEN action IN ('resolve','acknowledge') THEN 'update_resolved' ELSE 'update_answered' END,
    CASE WHEN action='reassign' THEN 'Resolution owner reassigned' WHEN action IN ('create','question_more') THEN CASE WHEN kind='cx' THEN 'Get CX Update' ELSE 'Get Tech Update' END WHEN action IN ('resolve','acknowledge') THEN upper(kind)||' Update Resolved' ELSE CASE WHEN kind='cx' THEN 'CS Updated' ELSE 'Tech Updated' END END,
    'Job '||l.job_id||CASE WHEN action='reassign' THEN ' has a new resolution owner.' WHEN action IN ('create','question_more') THEN ' needs an update.' WHEN action IN ('resolve','acknowledge') THEN ' update resolved.' ELSE ' has a response awaiting requester resolution.' END,
    l.id,l.job_id,r.id,kind,r.revision);
  INSERT INTO public.activity_logs(user_id,user_name,action,target_type,target_id,details)
    VALUES(caller,coalesce(actor_name,'Team member'),kind||'_update_'||action,'lead',l.id::text,
      'Request '||r.id||' revision '||r.revision||CASE WHEN action='reassign' THEN ': '||body ELSE '' END);
  RETURN jsonb_build_object('saved',true,'id',r.id);
END $$;

-- From 20261130000000_ai_schedule_confirmation.sql (1 conflict raise -> PT409)
CREATE OR REPLACE FUNCTION marshmallow_private.schedule_admin(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a text := p->>'action'; c marshmallow_private.schedule_monitor_config%rowtype;
  l public.leads%rowtype; reason text := btrim(p->>'reason'); output jsonb;
BEGIN
  IF auth.uid() IS NULL OR marshmallow_private.workflow_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501'; END IF;
  IF a IS NULL OR a NOT IN ('status', 'configure', 'retry') THEN
    RAISE EXCEPTION 'Invalid monitor action' USING errcode = '22023'; END IF;
  SELECT * INTO c FROM marshmallow_private.schedule_monitor_config WHERE id FOR UPDATE;
  IF a = 'status' THEN
    SELECT jsonb_build_object('mode', c.mode, 'changed_at', c.changed_at, 'cooldown_until', c.cooldown_until,
      'daily_checks', CASE WHEN c.usage_date = current_date THEN c.daily_checks ELSE 0 END, 'daily_limit', 200,
      'ingestion_paused', marshmallow_private.schedule_ingestion_paused(),
      'total', (SELECT count(*) FROM public.leads WHERE cs_tag = 'waiting_schedule_confirmation'),
      'rows', coalesce((SELECT jsonb_agg(item ORDER BY job_id) FROM (
        SELECT job.job_id, jsonb_build_object('lead_id', job.id, 'job_id', job.job_id, 'status', job.status,
          'customer_name', job.customer_name, 'service_type', job.service_type,
          'schedule_requirements', job.customer_schedule_requirements,
          'eligible', marshmallow_private.schedule_eligible(job), 'state', coalesce(q.state, 'not_queued'),
          'waiting_since', q.entered_at, 'checked_at', q.checked_at, 'result', q.result,
          'evidence', CASE WHEN q.evidence IS NOT NULL THEN jsonb_build_object('text', q.evidence->>'text', 'message_time', q.evidence->>'message_time') END) item
        FROM public.leads job LEFT JOIN marshmallow_private.schedule_monitor_queue q ON q.lead_id = job.id
        WHERE job.cs_tag = 'waiting_schedule_confirmation'
        ORDER BY job.job_id LIMIT 20 OFFSET greatest(coalesce((p->>'offset')::integer, 0), 0)) page), '[]'::jsonb))
    INTO output;
    RETURN output;
  END IF;
  IF reason IS NULL OR length(reason) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'Enter a reason (10–2000 characters)' USING errcode = '22023'; END IF;
  IF a = 'configure' THEN
    IF p->>'mode' IS NULL OR p->>'mode' NOT IN ('off', 'shadow', 'automatic') THEN
      RAISE EXCEPTION 'Choose Off, Shadow or Automatic' USING errcode = '22023'; END IF;
    -- Off is always available as a kill switch; turning on needs the latest view.
    IF p->>'mode' <> 'off' AND c.changed_at IS DISTINCT FROM (p->>'expectedChangedAt')::timestamptz THEN
      RAISE EXCEPTION 'Monitor configuration changed. Refresh and review it before saving.' USING errcode = 'PT409'; END IF;
    UPDATE marshmallow_private.schedule_monitor_config SET mode = p->>'mode', changed_at = clock_timestamp(),
      shadow_started_at = CASE WHEN p->>'mode' = 'shadow' AND c.mode <> 'shadow' THEN now() ELSE shadow_started_at END WHERE id;
  ELSE
    SELECT * INTO l FROM public.leads WHERE id = (p->>'leadId')::uuid FOR UPDATE;
    IF NOT FOUND OR l.cs_tag IS DISTINCT FROM 'waiting_schedule_confirmation' THEN
      RAISE EXCEPTION 'Waiting job unavailable' USING errcode = '22023'; END IF;
    UPDATE marshmallow_private.schedule_monitor_queue SET generation = generation + 1, available_at = now(), state = 'pending',
      result = NULL, lease = NULL, lease_until = NULL, attempts = 0 WHERE lead_id = l.id AND evidence IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'No customer reply to check yet' USING errcode = '22023'; END IF;
  END IF;
  INSERT INTO public.activity_logs(user_id, user_name, action, target_type, target_id, details)
    SELECT auth.uid(), coalesce(full_name, 'Admin'), 'schedule_monitor_' || a, 'lead', coalesce(l.id::text, 'configuration'),
      CASE WHEN a = 'configure' THEN 'Mode ' || (p->>'mode') || ': ' ELSE '' END || reason
    FROM public.profiles WHERE id = auth.uid();
  RETURN jsonb_build_object('saved', true);
END $$;
COMMIT;
