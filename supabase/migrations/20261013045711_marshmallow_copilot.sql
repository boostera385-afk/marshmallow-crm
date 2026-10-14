-- Purpose: read-only Marshmallow Copilot with opt-in role/user access, caller-scoped
-- queries and atomic AI budget reservations. Existing lead/technician policies and
-- approval/status triggers are NOT changed. Apply manually to an approved target;
-- 110_copilot.sql is WRITE-BASED and only for its isolated synthetic fixture.
BEGIN;
CREATE SCHEMA IF NOT EXISTS marshmallow_private;
REVOKE ALL ON SCHEMA marshmallow_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.copilot_config (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  enabled boolean NOT NULL DEFAULT true,
  ai_enabled boolean NOT NULL DEFAULT false,
  monthly_budget_cents integer NOT NULL DEFAULT 1000 CHECK(monthly_budget_cents BETWEEN 0 AND 100000),
  daily_ai_limit integer NOT NULL DEFAULT 20 CHECK(daily_ai_limit BETWEEN 0 AND 100),
  timezone text NOT NULL DEFAULT 'America/New_York'
);
CREATE TABLE IF NOT EXISTS public.copilot_role_permissions (
  role public.app_role PRIMARY KEY,
  allowed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.copilot_user_permissions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  allowed boolean NOT NULL
);
INSERT INTO public.copilot_config(id) VALUES(true) ON CONFLICT DO NOTHING;
INSERT INTO public.copilot_role_permissions(role,allowed)
SELECT r::public.app_role,r='admin' FROM unnest(ARRAY['admin','processor','customer_service','cs_admin','opr','opr_admin']) r
ON CONFLICT DO NOTHING;
ALTER TABLE public.copilot_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_user_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.copilot_config,public.copilot_role_permissions,public.copilot_user_permissions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.copilot_config,public.copilot_role_permissions,public.copilot_user_permissions TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.copilot_role_permissions,public.copilot_user_permissions TO authenticated;
GRANT UPDATE ON public.copilot_config TO authenticated;
DROP POLICY IF EXISTS "Copilot configuration read" ON public.copilot_config;
CREATE POLICY "Copilot configuration read" ON public.copilot_config FOR SELECT TO authenticated USING((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Copilot configuration admin" ON public.copilot_config;
CREATE POLICY "Copilot configuration admin" ON public.copilot_config FOR UPDATE TO authenticated
USING((SELECT public.has_role(auth.uid(),'admin'::public.app_role))) WITH CHECK((SELECT public.has_role(auth.uid(),'admin'::public.app_role)));
DROP POLICY IF EXISTS "Copilot role read" ON public.copilot_role_permissions;
CREATE POLICY "Copilot role read" ON public.copilot_role_permissions FOR SELECT TO authenticated USING((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "Copilot role admin" ON public.copilot_role_permissions;
CREATE POLICY "Copilot role admin" ON public.copilot_role_permissions FOR ALL TO authenticated
USING((SELECT public.has_role(auth.uid(),'admin'::public.app_role))) WITH CHECK((SELECT public.has_role(auth.uid(),'admin'::public.app_role)));
DROP POLICY IF EXISTS "Copilot override read" ON public.copilot_user_permissions;
CREATE POLICY "Copilot override read" ON public.copilot_user_permissions FOR SELECT TO authenticated
USING(user_id=(SELECT auth.uid()) OR (SELECT public.has_role(auth.uid(),'admin'::public.app_role)));
DROP POLICY IF EXISTS "Copilot override admin" ON public.copilot_user_permissions;
CREATE POLICY "Copilot override admin" ON public.copilot_user_permissions FOR ALL TO authenticated
USING((SELECT public.has_role(auth.uid(),'admin'::public.app_role))) WITH CHECK((SELECT public.has_role(auth.uid(),'admin'::public.app_role)));

CREATE OR REPLACE FUNCTION public.copilot_caller_role() RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT role::text FROM public.user_roles WHERE user_id=auth.uid()
 ORDER BY (role::text='admin') DESC,role::text LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.copilot_nav_allowed(p_section text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE r text:=public.copilot_caller_role(); override_value boolean;
BEGIN
 IF r IS NULL THEN RETURN false; END IF;
 IF r='admin' THEN RETURN true; END IF;
 IF p_section IN ('payment_requests','optimization','crm_updates','activity_logs') THEN RETURN false; END IF;
 IF p_section='settings' THEN RETURN r='cs_admin' AND COALESCE((SELECT can_manage_users FROM public.profiles WHERE id=auth.uid()),false); END IF;
 IF p_section='quote_pending_requests' THEN RETURN COALESCE((SELECT is_quotation_master FROM public.profiles WHERE id=auth.uid()),false); END IF;
 IF p_section='ai_assistance' THEN RETURN r IN ('cs_admin','customer_service'); END IF;
 IF p_section='cancellation_requests' AND r='processor' THEN RETURN true; END IF;
 SELECT allowed INTO override_value FROM public.navigation_permissions WHERE user_id=auth.uid() AND nav_section=p_section;
 RETURN COALESCE(override_value, CASE
  WHEN r='processor' THEN p_section IN ('leads','schedule','cancellation_requests','map_view','technicians')
  WHEN r='customer_service' THEN p_section IN ('leads','schedule','quote_approval_requests','ai_assistance')
  WHEN r='cs_admin' THEN p_section IN ('leads','schedule','quote_approval_requests','urgent_review_requests','ai_assistance')
  ELSE p_section='leads' END);
END; $$;
CREATE OR REPLACE FUNCTION public.copilot_get_access() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE r text:=public.copilot_caller_role(); config public.copilot_config; allowed_value boolean; sections jsonb;
BEGIN
 SELECT * INTO config FROM public.copilot_config WHERE id;
 allowed_value:= r IS NOT NULL AND COALESCE(config.enabled,false) AND (r='admin' OR COALESCE(
  (SELECT allowed FROM public.copilot_user_permissions WHERE user_id=auth.uid()),
  (SELECT allowed FROM public.copilot_role_permissions WHERE role::text=r),false));
 SELECT COALESCE(jsonb_agg(s),'[]'::jsonb) INTO sections FROM unnest(ARRAY[
  'leads','schedule','technicians','map_view','analytics','areas','optimization','quo_monitor','ai_assistance',
  'cancellation_requests','payment_requests','quote_approval_requests','quote_pending_requests',
  'technician_change_requests','urgent_review_requests','settings','activity_logs']) s
 WHERE allowed_value AND public.copilot_nav_allowed(s);
 RETURN jsonb_build_object('allowed',COALESCE(allowed_value,false),'aiEnabled',COALESCE(allowed_value AND config.ai_enabled,false),
  'role',r,'timezone',COALESCE(config.timezone,'America/New_York'),'sections',sections);
END; $$;
CREATE OR REPLACE FUNCTION public.copilot_require_access(p_section text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT COALESCE((public.copilot_get_access()->>'allowed')::boolean,false) OR
    (p_section IS NOT NULL AND NOT public.copilot_nav_allowed(p_section)) THEN
  RAISE EXCEPTION 'Copilot access is not permitted' USING ERRCODE='42501';
 END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.copilot_get_settings() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'admin'::public.app_role) OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Only Admin may manage Copilot' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('config',(SELECT to_jsonb(c)-'id' FROM public.copilot_config c WHERE id),
  'roles',(SELECT COALESCE(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.copilot_role_permissions p),
  'users',(SELECT COALESCE(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.copilot_user_permissions p));
END; $$;
CREATE OR REPLACE FUNCTION public.copilot_set_permission(p_role public.app_role,p_user_id uuid,p_allowed boolean) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'admin'::public.app_role) OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Only Admin may manage Copilot' USING ERRCODE='42501'; END IF;
 IF (p_role IS NULL)=(p_user_id IS NULL) THEN RAISE EXCEPTION 'Choose one role or user'; END IF;
 IF p_role='admin'::public.app_role OR (p_user_id IS NOT NULL AND public.has_role(p_user_id,'admin'::public.app_role)) THEN
  RAISE EXCEPTION 'Admin access is controlled by the global switch'; END IF;
 IF p_role IS NOT NULL THEN
  INSERT INTO public.copilot_role_permissions VALUES(p_role,COALESCE(p_allowed,false)) ON CONFLICT(role) DO UPDATE SET allowed=EXCLUDED.allowed;
 ELSIF p_allowed IS NULL THEN DELETE FROM public.copilot_user_permissions WHERE user_id=p_user_id;
 ELSE INSERT INTO public.copilot_user_permissions VALUES(p_user_id,p_allowed) ON CONFLICT(user_id) DO UPDATE SET allowed=EXCLUDED.allowed;
 END IF;
 INSERT INTO public.activity_logs(user_id,user_name,action,target_type,target_id,details)
 VALUES(auth.uid(),'Admin','copilot_permission_changed','permission',COALESCE(p_user_id::text,p_role::text),
  jsonb_build_object('role',p_role,'user_id',p_user_id,'allowed',p_allowed)::text);
END; $$;
CREATE OR REPLACE FUNCTION public.copilot_configure(p_enabled boolean,p_ai_enabled boolean,p_monthly_budget_cents integer,p_daily_ai_limit integer,p_timezone text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT public.has_role(auth.uid(),'admin'::public.app_role) OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Only Admin may manage Copilot' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid timezone'; END IF;
 UPDATE public.copilot_config SET enabled=p_enabled,ai_enabled=p_ai_enabled,monthly_budget_cents=p_monthly_budget_cents,
  daily_ai_limit=p_daily_ai_limit,timezone=p_timezone WHERE id;
 INSERT INTO public.activity_logs(user_id,user_name,action,target_type,target_id,details)
 VALUES(auth.uid(),'Admin','copilot_configured','copilot','global',jsonb_build_object('enabled',p_enabled,'ai_enabled',p_ai_enabled,
  'monthly_budget_cents',p_monthly_budget_cents,'daily_ai_limit',p_daily_ai_limit,'timezone',p_timezone)::text);
END; $$;

-- Mirrors useAllowedStatuses on top of RLS, never instead of RLS.
CREATE OR REPLACE FUNCTION public.copilot_status_visible(p_status text,p_tag text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE r text:=public.copilot_caller_role(); v boolean; vr text;
BEGIN
 IF r IS NULL THEN RETURN false; END IF;
 IF r='admin' THEN RETURN true; END IF;
 IF r IN ('opr','opr_admin') AND p_tag IN ('booked','ready_to_schedule','confirmation_sent','waiting_schedule_confirmation') THEN RETURN true; END IF;
 vr:=CASE WHEN r='opr_admin' THEN 'opr' ELSE r END;
 SELECT is_visible INTO v FROM public.lead_status_visibility WHERE status=p_status AND
  (user_id=auth.uid() OR (user_id IS NULL AND role=vr)) ORDER BY (user_id IS NOT NULL) DESC LIMIT 1;
 RETURN COALESCE(v,CASE WHEN r IN ('opr','opr_admin') THEN p_status='urgent_job'
  WHEN r='processor' THEN p_status NOT IN ('pending_to_send','quote_updated')
  WHEN r='cs_admin' THEN p_status NOT IN ('scammed','quote_change','quote_updated','paid','partial_paid','cancelled','job_done')
  ELSE p_status NOT IN ('scammed','quote_change','pending_to_send','quote_updated') END);
END; $$;

-- Resolve status overrides once per statement instead of querying permissions
-- once for every lead. Scheduling-tag visibility is applied separately below.
CREATE OR REPLACE FUNCTION public.copilot_visible_statuses() RETURNS text[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT COALESCE(array_agg(s),ARRAY[]::text[]) FROM unnest(ARRAY[
  'waiting_complete_details','urgent_job','quote_sent_waiting','post_visit_quote_sent_waiting',
  'post_visit_confirmation','activate_customer','quote_sent_need_follow_up','needs_quote','tech_making_quote',
  'quote_change','waiting_customer_response','need_tech','scheduled','job_in_progress','needs_reschedule',
  'job_done','payment_pending','cancellation_requested','cancelled','paid','partial_paid','payment_requested',
  'scammed','pending_to_send','quote_updated']) s WHERE public.copilot_status_visible(s,NULL);
$$;

CREATE OR REPLACE FUNCTION public.copilot_search(p_kind text,p_query text DEFAULT '',p_status text DEFAULT NULL,p_offset integer DEFAULT 0,
 p_service text DEFAULT '',p_area text DEFAULT '',p_active boolean DEFAULT NULL,p_date date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE rows jsonb; r text:=public.copilot_caller_role(); q text; phone text; service_q text; area_q text;
BEGIN
 PERFORM public.copilot_require_access(CASE WHEN p_kind='technicians' THEN 'technicians' ELSE 'leads' END);
 IF p_kind NOT IN ('leads','technicians','attention') OR p_offset<0 OR p_offset>200 OR length(p_query)>200 THEN RAISE EXCEPTION 'Invalid search'; END IF;
 IF p_date IS NOT NULL THEN PERFORM public.copilot_require_access('schedule'); END IF;
 IF p_kind='technicians' AND r='cs_admin' THEN RAISE EXCEPTION 'Technician details are restricted' USING ERRCODE='42501'; END IF;
 q:=replace(replace(replace(trim(p_query),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_');
 service_q:=replace(replace(replace(p_service,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_');
 area_q:=replace(replace(replace(p_area,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_');
 phone:=regexp_replace(p_query,'[^0-9]','','g');
 IF p_kind='technicians' THEN
  SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO rows FROM (
   SELECT id,name,phone_number,service,area,is_active,is_good_tech,opr_code FROM public.technicians
   WHERE (q='' OR name ILIKE '%'||q||'%' OR service ILIKE '%'||q||'%' OR area ILIKE '%'||q||'%' OR opr_code ILIKE '%'||q||'%'
    OR (length(phone)>=4 AND regexp_replace(phone_number,'[^0-9]','','g') LIKE '%'||phone||'%'))
    AND (p_service='' OR service ILIKE '%'||service_q||'%')
    AND (p_area='' OR area ILIKE '%'||area_q||'%') AND (p_active IS NULL OR is_active=p_active)
   AND (r<>'opr' OR upper(trim(opr_code))=(SELECT upper(trim(opr_code)) FROM public.profiles WHERE id=auth.uid()))
   AND (r<>'opr_admin' OR NULLIF(trim(opr_code),'') IS NOT NULL)
   ORDER BY (lower(name)=lower(p_query)) DESC,is_active DESC,name,id LIMIT 11 OFFSET p_offset
  ) t;
 ELSE
  SELECT COALESCE(jsonb_agg(to_jsonb(l)),'[]'::jsonb) INTO rows FROM (
   SELECT id,job_id,customer_name,customer_phone,service_type,address,city,state,zip_code,status,cs_tag,
    service_details,customer_schedule_requirements,scheduled_date,scheduled_time_start,
    CASE WHEN r IN ('opr','opr_admin') AND show_quote_to_opr=false THEN NULL ELSE quote END AS quote,
    CASE WHEN r='cs_admin' THEN NULL ELSE tech_name END AS tech_name,
    CASE WHEN r='cs_admin' THEN NULL ELSE tech_number END AS tech_number
   FROM public.leads WHERE (status=ANY((SELECT public.copilot_visible_statuses())::text[]) OR
    (r IN ('opr','opr_admin') AND cs_tag IN ('booked','ready_to_schedule','confirmation_sent','waiting_schedule_confirmation')))
   AND (q='' OR job_id ILIKE '%'||q||'%' OR customer_name ILIKE '%'||q||'%' OR address ILIKE '%'||q||'%'
    OR city ILIKE '%'||q||'%' OR zip_code ILIKE '%'||q||'%'
    OR (length(phone)>=4 AND (regexp_replace(customer_phone,'[^0-9]','','g') LIKE '%'||phone||'%'
      OR regexp_replace(customer_landline,'[^0-9]','','g') LIKE '%'||phone||'%')))
    AND (p_status IS NULL OR status=p_status) AND (p_service='' OR service_type ILIKE '%'||service_q||'%')
    AND (p_area='' OR city ILIKE '%'||area_q||'%' OR state ILIKE '%'||area_q||'%')
   AND (p_date IS NULL OR (public.copilot_nav_allowed('schedule') AND scheduled_date=p_date))
   AND (p_kind<>'attention' OR status IN ('waiting_complete_details','need_tech','quote_sent_need_follow_up','needs_reschedule')
     OR cs_tag='incomplete_details' OR (scheduled_date<=(clock_timestamp() AT TIME ZONE (SELECT timezone FROM public.copilot_config WHERE id))::date AND status IN ('urgent_job','scheduled','job_in_progress')))
   ORDER BY (lower(job_id)=lower(p_query)) DESC,(status='urgent_job') DESC,created_at DESC,id LIMIT 11 OFFSET p_offset
  ) l;
 END IF;
 RETURN rows;
END; $$;

CREATE OR REPLACE FUNCTION public.copilot_report(p_start date,p_end date,p_scope text DEFAULT 'mine') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE tz text; metrics jsonb; r text:=public.copilot_caller_role();
BEGIN
 PERFORM public.copilot_require_access('leads');
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>30 OR p_scope NOT IN ('mine','team') THEN RAISE EXCEPTION 'Choose a date range of at most 31 days'; END IF;
 IF p_scope='team' AND NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'Team reports are Admin only' USING ERRCODE='42501'; END IF;
 SELECT timezone INTO tz FROM public.copilot_config WHERE id;
 SELECT jsonb_build_object('created',count(*) FILTER(WHERE created_at>=p_start::timestamp AT TIME ZONE tz AND created_at<(p_end+1)::timestamp AT TIME ZONE tz),
  'latestEdits',count(*) FILTER(WHERE last_edited_by=auth.uid() AND last_edited_at>=p_start::timestamp AT TIME ZONE tz AND last_edited_at<(p_end+1)::timestamp AT TIME ZONE tz),
  'scheduled',CASE WHEN public.copilot_nav_allowed('schedule') THEN count(*) FILTER(WHERE scheduled_date BETWEEN p_start AND p_end) ELSE NULL END,
  'urgent',count(*) FILTER(WHERE status='urgent_job'),'incomplete',count(*) FILTER(WHERE status='waiting_complete_details' OR cs_tag='incomplete_details'),
  'needTech',count(*) FILTER(WHERE status='need_tech'),'followups',count(*) FILTER(WHERE status='quote_sent_need_follow_up')) INTO metrics
 FROM public.leads WHERE (status=ANY((SELECT public.copilot_visible_statuses())::text[]) OR
  (r IN ('opr','opr_admin') AND cs_tag IN ('booked','ready_to_schedule','confirmation_sent','waiting_schedule_confirmation')))
 AND (p_scope='team' OR created_by=auth.uid() OR assigned_cs=auth.uid() OR last_edited_by=auth.uid());
 RETURN jsonb_build_object('metrics',metrics,'start',p_start,'end',p_end,'scope',p_scope,'timezone',tz,'refreshedAt',clock_timestamp());
END; $$;

-- No customer content is retained in this ledger. A conservative 2-cent charge
-- per request bounds this fixed small-model integration, including unknown outcomes.
CREATE TABLE IF NOT EXISTS marshmallow_private.copilot_usage (
 request_id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','completed','unavailable')),
 charged_cents integer NOT NULL DEFAULT 2 CHECK(charged_cents=2),input_tokens integer,output_tokens integer
);
CREATE INDEX IF NOT EXISTS copilot_usage_user_time ON marshmallow_private.copilot_usage(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS copilot_usage_time ON marshmallow_private.copilot_usage(created_at DESC);
ALTER TABLE marshmallow_private.copilot_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marshmallow_private.copilot_usage FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.copilot_reserve_ai(p_user_id uuid,p_request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.copilot_config; r text; allowed_value boolean; used integer;
BEGIN
 SELECT * INTO c FROM public.copilot_config WHERE id FOR UPDATE;
 SELECT role::text INTO r FROM public.user_roles WHERE user_id=p_user_id ORDER BY (role::text='admin') DESC,role::text LIMIT 1;
 allowed_value:=r='admin' OR COALESCE((SELECT allowed FROM public.copilot_user_permissions WHERE user_id=p_user_id),
  (SELECT allowed FROM public.copilot_role_permissions WHERE role::text=r),false);
 IF r IS NULL OR NOT COALESCE(allowed_value AND c.enabled AND c.ai_enabled,false) THEN RAISE EXCEPTION 'AI access denied' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM marshmallow_private.copilot_usage WHERE request_id=p_request_id) THEN RAISE EXCEPTION 'Request already reserved; do not retry a paid request'; END IF;
 IF (SELECT count(*) FROM marshmallow_private.copilot_usage WHERE user_id=p_user_id AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE c.timezone) AT TIME ZONE c.timezone)>=c.daily_ai_limit THEN
  RAISE EXCEPTION 'Daily AI limit reached; CRM tools remain available'; END IF;
 IF EXISTS(SELECT 1 FROM marshmallow_private.copilot_usage WHERE user_id=p_user_id AND created_at>clock_timestamp()-interval '5 seconds') THEN RAISE EXCEPTION 'Please wait before another AI request'; END IF;
 SELECT COALESCE(sum(charged_cents),0) INTO used FROM marshmallow_private.copilot_usage WHERE created_at>=date_trunc('month',clock_timestamp() AT TIME ZONE c.timezone) AT TIME ZONE c.timezone;
 IF used+2>c.monthly_budget_cents THEN RAISE EXCEPTION 'Monthly AI budget reached; CRM tools remain available'; END IF;
 INSERT INTO marshmallow_private.copilot_usage(request_id,user_id) VALUES(p_request_id,p_user_id);
END; $$;
CREATE OR REPLACE FUNCTION public.copilot_finish_ai(p_request_id uuid,p_input integer,p_output integer,p_success boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE marshmallow_private.copilot_usage SET status=CASE WHEN p_success THEN 'completed' ELSE 'unavailable' END,
 input_tokens=CASE WHEN p_input IS NULL THEN NULL ELSE greatest(p_input,0) END,
 output_tokens=CASE WHEN p_output IS NULL THEN NULL ELSE greatest(p_output,0) END WHERE request_id=p_request_id AND status='reserved';
END; $$;
CREATE OR REPLACE FUNCTION public.copilot_usage_summary() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tz text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'Only Admin may read usage' USING ERRCODE='42501'; END IF;
 SELECT timezone INTO tz FROM public.copilot_config WHERE id;
 RETURN (SELECT jsonb_build_object('requests',count(*),'reservedCents',COALESCE(sum(charged_cents),0),'inputTokens',COALESCE(sum(input_tokens),0),
 'outputTokens',COALESCE(sum(output_tokens),0),'unavailable',count(*) FILTER(WHERE status<>'completed'))
 FROM marshmallow_private.copilot_usage WHERE created_at>=date_trunc('month',clock_timestamp() AT TIME ZONE tz) AT TIME ZONE tz);
END; $$;

CREATE OR REPLACE FUNCTION public.copilot_health() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE sheets jsonb; webhook jsonb;
BEGIN
 PERFORM public.copilot_require_access();
 IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN RAISE EXCEPTION 'System health is Admin only' USING ERRCODE='42501'; END IF;
 BEGIN SELECT to_jsonb(h) INTO sheets FROM public.get_sheets_sync_health(900) h LIMIT 1;
 EXCEPTION WHEN OTHERS THEN sheets:=NULL; END;
 BEGIN SELECT jsonb_build_object('lastReceivedAt',max(received_at),'errors24h',count(*) FILTER(WHERE error_message IS NOT NULL),
  'ingestionPaused',(SELECT value='true'::jsonb FROM public.quo_ai_settings WHERE key='quo_webhook_ingestion_paused')) INTO webhook
  FROM public.quo_webhook_events WHERE received_at>clock_timestamp()-interval '24 hours';
 EXCEPTION WHEN OTHERS THEN webhook:=NULL; END;
 RETURN jsonb_build_object('checkedAt',clock_timestamp(),'database','reachable','sheets',CASE WHEN sheets IS NULL THEN NULL ELSE jsonb_build_object(
  'status',sheets->'status','queueDepth',sheets->'queue_depth','failedJobs',sheets->'failed_jobs','leadsBehind',sheets->'leads_behind','lastSuccessAt',sheets->'last_success_at') END,
  'webhook',webhook,'usage',public.copilot_usage_summary());
END; $$;

-- Explicit execute grants: never rely on Postgres' default PUBLIC privileges.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.proname,p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'copilot\_%' ESCAPE '\' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  -- regprocedure text may be schema-qualified depending on the installer's
  -- search_path. Never classify privileged routines by its display spelling.
  IF f.proname IN ('copilot_reserve_ai','copilot_finish_ai') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  ELSE EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
 END LOOP;
END; $$;
COMMIT;

-- Rollback: disable the global switch first (Admin), deploy the prior frontend,
-- back up configuration and the private usage ledger, then drop ONLY copilot_*
-- functions and these four new tables. Do not drop marshmallow_private itself;
-- existing Operator workflows use it. No leads, schedules or existing policies
-- require rollback because this migration does not write or alter them.
