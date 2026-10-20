-- Purpose: requester-owned CX/Tech resolution, revision-safe follow-ups, complete
-- recipient notification history and server-owned event metadata. No lead writes.
-- Prerequisite: installed Tech Update / UUID repair schema (inspect, do not replay
-- historical migrations blindly). Apply manually; deploy both inbox functions next.
BEGIN;

ALTER TABLE public.lead_cx_update_requests
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN IF NOT EXISTS resolution_owner uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_owner_assigned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_by_name text;
-- Original requester remains immutable. An unassigned override uses the requester;
-- a deleted explicit override stays unassigned rather than falling back silently.
-- old acknowledgements retain their timestamp, never a guessed resolving actor.

CREATE TABLE IF NOT EXISTS public.workflow_notification_events (
  notification_id uuid PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('update_requested','update_answered','update_resolved','schedule_ready')),
  request_id uuid REFERENCES public.lead_cx_update_requests(id) ON DELETE CASCADE,
  request_kind text CHECK (request_kind IN ('cx','tech')),
  revision integer NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  job_id text NOT NULL,
  event_key text NOT NULL UNIQUE
);
ALTER TABLE public.workflow_notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_notification_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workflow_notification_events TO authenticated;
DROP POLICY IF EXISTS workflow_event_recipient ON public.workflow_notification_events;
CREATE POLICY workflow_event_recipient ON public.workflow_notification_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.notifications n WHERE n.id=notification_id AND n.user_id=(SELECT auth.uid())));

CREATE OR REPLACE FUNCTION marshmallow_private.workflow_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN count(*)=1 THEN min(role::text) END FROM public.user_roles WHERE user_id=auth.uid()
    AND EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid());
$$;
REVOKE ALL ON FUNCTION marshmallow_private.workflow_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.workflow_role() TO authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.workflow_resolution_owner(r public.lead_cx_update_requests) RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN r.resolution_owner_assigned THEN r.resolution_owner ELSE r.requested_by END;
$$;
REVOKE ALL ON FUNCTION marshmallow_private.workflow_resolution_owner(public.lead_cx_update_requests) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.workflow_resolution_owner(public.lead_cx_update_requests) TO authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.workflow_job_visible_to(u uuid,l public.leads) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r text; visible boolean;
BEGIN
  SELECT CASE WHEN count(*)=1 THEN min(role::text) END INTO r FROM public.user_roles WHERE user_id=u
    AND EXISTS(SELECT 1 FROM public.profiles WHERE id=u);
  IF r='admin' THEN RETURN true; END IF;
  IF r IS NULL OR r NOT IN ('processor','cs_admin','customer_service') THEN RETURN false; END IF;
  IF r='cs_admin' AND l.status IN ('paid','partial_paid','cancelled','job_done','scammed') THEN RETURN false; END IF;
  IF r='customer_service' AND NOT coalesce(l.created_by=u OR l.assigned_cs=u OR EXISTS(
    SELECT 1 FROM public.lead_shares WHERE lead_id=l.id AND shared_with_user_id=u),false) THEN RETURN false; END IF;
  SELECT is_visible INTO visible FROM public.lead_status_visibility WHERE user_id=u AND status=l.status LIMIT 1;
  IF visible IS NULL THEN SELECT is_visible INTO visible FROM public.lead_status_visibility WHERE user_id IS NULL AND role::text=r AND status=l.status LIMIT 1; END IF;
  RETURN coalesce(visible,CASE r WHEN 'processor' THEN l.status NOT IN ('pending_to_send','quote_updated')
    ELSE l.status NOT IN ('scammed','quote_change','pending_to_send','quote_updated') END);
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.workflow_job_visible_to(uuid,public.leads) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.workflow_job_visible_to(uuid,public.leads) TO authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.workflow_request_visible(r public.lead_cx_update_requests)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND coalesce(CASE marshmallow_private.workflow_role()
    WHEN 'admin' THEN true
    WHEN 'processor' THEN r.request_kind='cx' OR r.status='pending' OR r.completed_by=auth.uid() OR r.resolution_owner=auth.uid()
    WHEN 'cs_admin' THEN true
    WHEN 'customer_service' THEN r.requested_by=auth.uid() OR r.resolution_owner=auth.uid()
      OR (r.request_kind='cx' AND r.recipient_cs=auth.uid())
    ELSE false END,false);
$$;
REVOKE ALL ON FUNCTION marshmallow_private.workflow_request_visible(public.lead_cx_update_requests) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.workflow_request_visible(public.lead_cx_update_requests) TO authenticated;
DROP POLICY IF EXISTS update_request_recipient_read ON public.lead_cx_update_requests;
CREATE POLICY update_request_recipient_read ON public.lead_cx_update_requests FOR SELECT TO authenticated
  USING (marshmallow_private.workflow_request_visible(lead_cx_update_requests));

-- Apply current workflow access to the legacy bell/realtime transport too. A
-- role/share change must not leave old workflow previews visible in that bell.
-- Private DEFINER lookup avoids a notifications <-> event-policy RLS cycle.
CREATE OR REPLACE FUNCTION marshmallow_private.workflow_notification_visible(n uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.workflow_notification_events%rowtype; r public.lead_cx_update_requests%rowtype; l public.leads%rowtype;
BEGIN
  SELECT * INTO e FROM public.workflow_notification_events WHERE notification_id=n;
  IF NOT found THEN RETURN true; END IF; -- Legacy recipient notifications unchanged.
  IF marshmallow_private.workflow_role() IS NULL OR marshmallow_private.workflow_role() NOT IN ('admin','processor','cs_admin','customer_service') THEN RETURN false; END IF;
  IF e.request_id IS NOT NULL THEN
    SELECT * INTO r FROM public.lead_cx_update_requests WHERE id=e.request_id;
    RETURN found AND marshmallow_private.workflow_request_visible(r);
  END IF;
  SELECT * INTO l FROM public.leads WHERE id=e.lead_id;
  RETURN found AND marshmallow_private.workflow_job_visible_to(auth.uid(),l);
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.workflow_notification_visible(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.workflow_notification_visible(uuid) TO authenticated;
DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
CREATE POLICY "Users can select own notifications" ON public.notifications FOR SELECT TO authenticated
  USING (user_id=(SELECT auth.uid()) AND marshmallow_private.workflow_notification_visible(id));

-- Called only by trusted private functions, never by a browser. Metadata is not
-- stored in writable notification title/message columns and cannot be forged.
CREATE OR REPLACE FUNCTION marshmallow_private.workflow_notify(
  p_users uuid[], p_event text, p_title text, p_message text, p_lead uuid,
  p_job text, p_request uuid, p_kind text, p_revision integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; n uuid; k text;
BEGIN
  FOR u IN SELECT DISTINCT x FROM unnest(p_users) x WHERE x IS NOT NULL LOOP
    k := p_event||':'||coalesce(p_request::text,p_lead::text)||':'||p_revision||':'||u;
    -- Callers hold the request/job lock. Retries cannot create duplicate rows.
    IF EXISTS(SELECT 1 FROM public.workflow_notification_events WHERE event_key=k) THEN CONTINUE; END IF;
    INSERT INTO public.notifications(user_id,title,message,lead_id)
      VALUES(u,p_title,p_message,NULL::uuid) RETURNING id INTO n;
    INSERT INTO public.workflow_notification_events(notification_id,event_type,request_id,request_kind,revision,lead_id,job_id,event_key)
      VALUES(n,p_event,p_request,p_kind,p_revision,p_lead,p_job,k);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.workflow_notify(uuid[],text,text,text,uuid,text,uuid,text,integer) FROM PUBLIC, anon, authenticated;

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
    IF expected IS NULL OR expected<>r.revision THEN RAISE EXCEPTION 'This request changed. Refresh before saving.' USING errcode='40001'; END IF;
    IF r.acknowledged_at IS NOT NULL THEN RAISE EXCEPTION 'This request is resolved' USING errcode='40001'; END IF;
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
      IF r.status<>'pending' THEN RAISE EXCEPTION 'The request already has a response' USING errcode='40001'; END IF;
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
REVOKE ALL ON FUNCTION marshmallow_private.workflow_requests(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.workflow_requests(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.workflow_requests(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_input->>'action'='create' AND NOT EXISTS(SELECT 1 FROM public.leads WHERE id=(p_input->>'leadId')::uuid) THEN
    RAISE EXCEPTION 'Lead outside your access scope' USING errcode='42501'; END IF;
  RETURN marshmallow_private.workflow_requests(p_input);
END $$;
REVOKE ALL ON FUNCTION public.workflow_requests(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workflow_requests(jsonb) TO authenticated;

-- Close ALL legacy mutation paths too, including the old private CX function.
CREATE OR REPLACE FUNCTION marshmallow_private.update_requests(p_kind text,p_action text,p_lead_id uuid,p_request_id uuid,p_text text,p_offset integer)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.workflow_requests(jsonb_build_object('kind',p_kind,'action',p_action,'leadId',p_lead_id,'requestId',p_request_id,'text',p_text,'offset',p_offset));
$$;
CREATE OR REPLACE FUNCTION marshmallow_private.cx_update_requests(p_action text,p_lead_id uuid,p_request_id uuid,p_text text,p_offset integer)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT public.workflow_requests(jsonb_build_object('kind','cx','action',p_action,'leadId',p_lead_id,'requestId',p_request_id,'text',p_text,'offset',p_offset));
$$;

CREATE OR REPLACE FUNCTION public.workflow_notifications(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  a text:=p_input->>'action'; category text:=coalesce(p_input->>'category','all');
  view_name text:=coalesce(p_input->>'view','all'); search_text text:=btrim(coalesce(p_input->>'search',''));
  page_offset integer:=coalesce((p_input->>'offset')::integer,0); result jsonb; destination text;
  event public.workflow_notification_events%rowtype; request_row public.lead_cx_update_requests%rowtype;
BEGIN
  IF marshmallow_private.workflow_role() IS NULL OR marshmallow_private.workflow_role() NOT IN ('admin','processor','cs_admin','customer_service') THEN
    RAISE EXCEPTION 'Notification center access denied' USING errcode='42501'; END IF;
  IF a NOT IN ('list','alerts','read','open') OR a IS NULL OR page_offset<0 OR length(search_text)>100
    OR category NOT IN ('all','cx','tech','schedule','other') OR view_name NOT IN ('all','unread','action') THEN
    RAISE EXCEPTION 'Invalid notification query' USING errcode='22023'; END IF;
  IF a IN ('read','open') THEN
    IF a='open' THEN
      IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE id=(p_input->>'notificationId')::uuid AND user_id=auth.uid()) THEN
        RAISE EXCEPTION 'Notification unavailable' USING errcode='42501'; END IF;
      SELECT e.* INTO event FROM public.workflow_notification_events e JOIN public.notifications n ON n.id=e.notification_id
        WHERE n.id=(p_input->>'notificationId')::uuid AND n.user_id=auth.uid();
      IF found THEN
        IF event.request_id IS NOT NULL THEN
          SELECT * INTO request_row FROM public.lead_cx_update_requests WHERE id=event.request_id;
          IF NOT found THEN RAISE EXCEPTION 'You no longer have access to this request' USING errcode='42501'; END IF;
          destination:='/get-'||event.request_kind||'-update?request='||event.request_id;
        ELSE
          IF NOT EXISTS(SELECT 1 FROM public.leads l WHERE id=event.lead_id AND marshmallow_private.workflow_job_visible_to(auth.uid(),l)) THEN RAISE EXCEPTION 'You no longer have access to this job' USING errcode='42501'; END IF;
          destination:='/leads/'||event.lead_id;
        END IF;
      END IF;
    END IF;
    -- Snapshot list supplied by client; never clear future/unseen rows implicitly.
    IF a='open' THEN
      UPDATE public.notifications SET read=true WHERE id=(p_input->>'notificationId')::uuid AND user_id=auth.uid();
    ELSE
      IF jsonb_array_length(p_input->'ids')>100 THEN RAISE EXCEPTION 'Select at most 100 notifications' USING errcode='22023'; END IF;
      UPDATE public.notifications SET read=true WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_input->'ids')) AND user_id=auth.uid();
    END IF;
    RETURN jsonb_build_object('saved',true,'href',destination);
  END IF;
  WITH visible AS (
    SELECT n.id,n.title,n.message,n.lead_id,n.read,n.created_at,e.event_type,e.request_kind,e.request_id,e.revision,e.job_id,
      coalesce(e.revision=r.revision AND ((e.event_type='update_requested' AND r.status='pending' AND r.acknowledged_at IS NULL AND
        ((e.request_kind='cx' AND (marshmallow_private.workflow_role()='cs_admin' OR r.recipient_cs=auth.uid())) OR
         (e.request_kind='tech' AND marshmallow_private.workflow_role()='processor')))
       OR (e.event_type='update_answered' AND r.status<>'pending' AND r.acknowledged_at IS NULL
          AND marshmallow_private.workflow_resolution_owner(r)=auth.uid())),false) AS action_required
    FROM public.notifications n LEFT JOIN public.workflow_notification_events e ON e.notification_id=n.id
    LEFT JOIN public.lead_cx_update_requests r ON r.id=e.request_id
    WHERE n.user_id=auth.uid()
      AND (e.notification_id IS NULL OR (e.request_id IS NOT NULL AND r.id IS NOT NULL)
        OR (e.request_id IS NULL AND EXISTS(SELECT 1 FROM public.leads l WHERE id=e.lead_id AND marshmallow_private.workflow_job_visible_to(auth.uid(),l))))
  ), filtered AS (
    SELECT * FROM visible v WHERE
      (category='all' OR (category IN ('cx','tech') AND request_kind=category) OR (category='schedule' AND event_type='schedule_ready') OR (category='other' AND event_type IS NULL))
      AND (search_text='' OR position(lower(search_text) IN lower(coalesce(job_id,'')||' '||title||' '||message))>0)
      AND (nullif(p_input->>'since','') IS NULL OR created_at >= (p_input->>'since')::timestamptz)
      AND (nullif(p_input->>'until','') IS NULL OR created_at < (p_input->>'until')::timestamptz)
      AND (view_name='all' OR (view_name='unread' AND NOT read) OR (view_name='action' AND action_required))
      AND (a<>'alerts' OR (event_type IN ('update_requested','update_answered','schedule_ready')
        AND NOT read AND created_at >= (p_input->>'after')::timestamptz))
  ), page AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT CASE WHEN a='alerts' THEN 100 ELSE 20 END OFFSET page_offset)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered),'unread_count',(SELECT count(*) FROM visible WHERE NOT read)) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.workflow_notifications(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workflow_notifications(jsonb) TO authenticated;

COMMIT;
-- Rollback: unpublish these UI entries, revoke authenticated EXECUTE on the two
-- new public RPCs, then restore old function bodies/policy from the reviewed UUID
-- repair and Tech Update migrations. Retain added columns/event and request
-- history. Restoring old resolution rules re-enables supervisor acknowledgement;
-- do not roll back without business approval. No lead repair is needed.
