-- Purpose: pilot readiness, stale configuration protection and exact saved-lead
-- briefs. No existing lead policies, schedules, records or approval gates change.
-- Apply manually after the two installed Copilot migrations, on an approved target.
BEGIN;

CREATE OR REPLACE FUNCTION public.copilot_configure_checked(p_expected jsonb,
 p_enabled boolean,p_ai_enabled boolean,p_monthly_budget_cents integer,
 p_daily_ai_limit integer,p_timezone text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_config jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
  RAISE EXCEPTION 'Only Admin may manage Copilot' USING ERRCODE='42501';
 END IF;
 SELECT to_jsonb(c)-'id' INTO current_config FROM public.copilot_config c WHERE id FOR UPDATE;
 IF p_expected IS NULL OR current_config IS DISTINCT FROM p_expected THEN
  RAISE EXCEPTION 'Configuration changed in another session. Reload saved settings before saving.' USING ERRCODE='40001';
 END IF;
 PERFORM public.copilot_configure(p_enabled,p_ai_enabled,p_monthly_budget_cents,p_daily_ai_limit,p_timezone);
END; $$;

CREATE OR REPLACE FUNCTION public.copilot_diagnostics() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.copilot_config; month_start timestamptz; day_start timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
  RAISE EXCEPTION 'Only Admin may read diagnostics' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM public.copilot_config WHERE id;
 month_start:=date_trunc('month',clock_timestamp() AT TIME ZONE c.timezone) AT TIME ZONE c.timezone;
 day_start:=date_trunc('day',clock_timestamp() AT TIME ZONE c.timezone) AT TIME ZONE c.timezone;
 RETURN jsonb_build_object(
  'configChangedAt',(SELECT max(created_at) FROM public.activity_logs WHERE action='copilot_configured'),
  'lastSuccessAt',(SELECT max(created_at) FROM marshmallow_private.copilot_usage WHERE status='completed'),
  'remainingCents',greatest(0,c.monthly_budget_cents-(SELECT COALESCE(sum(charged_cents),0) FROM marshmallow_private.copilot_usage WHERE created_at>=month_start)),
  'remainingToday',greatest(0,c.daily_ai_limit-(SELECT count(*) FROM marshmallow_private.copilot_usage WHERE user_id=auth.uid() AND created_at>=day_start)),
  'completedThisMonth',(SELECT count(*) FROM marshmallow_private.copilot_usage WHERE status='completed' AND created_at>=month_start));
END; $$;

CREATE OR REPLACE FUNCTION public.copilot_lead_brief(p_lead_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; r text:=public.copilot_caller_role();
BEGIN
 PERFORM public.copilot_require_access('leads');
 SELECT jsonb_build_object('id',id,'job_id',job_id,'customer_name',customer_name,
  'customer_phone',customer_phone,'service_type',service_type,'service_details',service_details,
  'address',address,'city',city,'state',state,'zip_code',zip_code,'status',status,'cs_tag',cs_tag,
  'customer_schedule_requirements',customer_schedule_requirements,
  'scheduled_date',CASE WHEN public.copilot_nav_allowed('schedule') THEN scheduled_date ELSE NULL END,
  'scheduled_time_start',CASE WHEN public.copilot_nav_allowed('schedule') THEN scheduled_time_start ELSE NULL END,
  'quote',CASE WHEN r IN ('opr','opr_admin') AND show_quote_to_opr IS NOT TRUE THEN NULL ELSE quote END,
  'tech_name',CASE WHEN r='cs_admin' THEN NULL ELSE tech_name END,
  'tech_number',CASE WHEN r='cs_admin' THEN NULL ELSE tech_number END)
 INTO result FROM public.leads WHERE id=p_lead_id AND
  (status=ANY((SELECT public.copilot_visible_statuses())::text[]) OR
   (r IN ('opr','opr_admin') AND cs_tag IN ('booked','ready_to_schedule','confirmation_sent','waiting_schedule_confirmation')));
 -- Identical outcome for a missing, hidden or out-of-scope ID; do not leak existence.
 RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.copilot_configure_checked(jsonb,boolean,boolean,integer,integer,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.copilot_diagnostics() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.copilot_lead_brief(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.copilot_configure_checked(jsonb,boolean,boolean,integer,integer,text),public.copilot_diagnostics(),public.copilot_lead_brief(uuid) TO authenticated;
COMMIT;

-- Rollback: disable Copilot globally, restore the previous frontend/function, then
-- drop only copilot_configure_checked(jsonb,boolean,boolean,integer,integer,text),
-- copilot_diagnostics() and copilot_lead_brief(uuid). Keep existing config/usage.
-- No customer data or existing RLS needs rollback. Do not rerun old migrations.
