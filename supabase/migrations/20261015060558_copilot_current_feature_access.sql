-- Purpose: synchronize read-only Copilot navigation with the existing CRM role
-- gates. No role grants, lead policies, status rights or customer rows change.
BEGIN;
CREATE OR REPLACE FUNCTION public.copilot_nav_allowed(p_section text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE r text:=public.copilot_caller_role(); override_value boolean;
BEGIN
 IF r IS NULL THEN RETURN false; END IF;
 IF r='admin' THEN RETURN true; END IF;
 -- Fixed gates precede arbitrary per-user navigation overrides, as in AuthContext.
 IF p_section='processor_board' THEN RETURN r='processor'; END IF;
 IF p_section='cx_updates' THEN RETURN r IN ('processor','cs_admin','customer_service'); END IF;
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
  'leads','schedule','processor_board','technicians','map_view','analytics','areas','optimization','quo_monitor','ai_assistance',
  'cancellation_requests','payment_requests','quote_approval_requests','quote_pending_requests',
  'technician_change_requests','urgent_review_requests','cx_updates','quick_chat','tech_quick_chat','settings','activity_logs']) s
 WHERE allowed_value AND public.copilot_nav_allowed(s);
 RETURN jsonb_build_object('allowed',COALESCE(allowed_value,false),'aiEnabled',COALESCE(allowed_value AND config.ai_enabled,false),
  'role',r,'timezone',COALESCE(config.timezone,'America/New_York'),'sections',sections);
END; $$;
REVOKE ALL ON FUNCTION public.copilot_nav_allowed(text), public.copilot_get_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copilot_nav_allowed(text), public.copilot_get_access() TO authenticated;
COMMIT;

-- Rollback (review/apply separately): restore ONLY copilot_nav_allowed and
-- copilot_get_access from 20261013045711_marshmallow_copilot.sql, with the same
-- authenticated-only grants. Never replay that full migration or remove grants
-- from users. This removes the new navigation/help entries, not CRM access.
