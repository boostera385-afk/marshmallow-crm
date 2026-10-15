-- WRITE-BASED: isolated copilot fixture ONLY; never run on shared production.
-- Synthetic navigation/permission changes are rolled back.
BEGIN;
UPDATE public.copilot_role_permissions SET allowed=true;
INSERT INTO public.navigation_permissions(user_id,nav_section,allowed)
SELECT u.user_id,s,CASE WHEN u.role IN ('opr','opr_admin','customer_service','cs_admin') THEN true ELSE false END
FROM public.user_roles u CROSS JOIN unnest(ARRAY['processor_board','cx_updates','quick_chat','tech_quick_chat']) s
ON CONFLICT(user_id,nav_section) DO UPDATE SET allowed=EXCLUDED.allowed;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE _current_features(name text,result text) ON COMMIT DROP;
DO $$
DECLARE u record; a jsonb; board boolean; updates boolean;
BEGIN
 FOR u IN SELECT user_id,role::text AS role FROM public.user_roles ORDER BY role LOOP
  PERFORM set_config('request.jwt.claim.sub',u.user_id::text,true);
  a:=public.copilot_get_access();
  board:=u.role IN ('admin','processor');
  updates:=u.role IN ('admin','processor','customer_service','cs_admin');
  INSERT INTO _current_features VALUES
   (u.role||' board fixed gate overrides switch',CASE WHEN public.copilot_nav_allowed('processor_board')=board AND (a->'sections' ? 'processor_board')=board THEN 'PASS' ELSE 'FAIL' END),
   (u.role||' CX fixed gate overrides switch',CASE WHEN public.copilot_nav_allowed('cx_updates')=updates AND (a->'sections' ? 'cx_updates')=updates THEN 'PASS' ELSE 'FAIL' END),
   (u.role||' Quickchat grants remain independent',CASE WHEN (a->'sections' ? 'quick_chat')=(u.role<>'processor') AND (a->'sections' ? 'tech_quick_chat')=(u.role<>'processor') THEN 'PASS' ELSE 'FAIL' END);
 END LOOP;
END; $$;
RESET ROLE;
UPDATE public.copilot_role_permissions SET allowed=false WHERE role='processor';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','eb18f72a-92f5-405b-83ac-a9192cca1d78',true);
INSERT INTO _current_features SELECT 'Excluded Processor gets no sections',CASE WHEN NOT (public.copilot_get_access()->>'allowed')::boolean AND public.copilot_get_access()->'sections'='[]'::jsonb THEN 'PASS' ELSE 'FAIL' END;
RESET ROLE;
SELECT * FROM _current_features ORDER BY name;
ROLLBACK;
