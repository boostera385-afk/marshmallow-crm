-- Purpose: AI Tech Status becomes a Feature Access section ("tech_status").
--   Admin always sees it. Processor sees it by default. Admin can switch it on for any
--   other user, or off for a Processor, in Settings > Feature Access
--   (navigation_permissions row, nav_section = 'tech_status'). CS Admin never: tech names
--   and numbers are hidden from that role.
--   Granted users read techs only on leads they can already see (leads RLS).
--   Marking techs Texted / Called (set_lead_tech_contact_state) stays Admin / Processor.
-- Idempotent. Rollback at the end.
BEGIN;

CREATE OR REPLACE FUNCTION marshmallow_private.can_see_tech_status(p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_uid IS NOT NULL
     AND NOT public.has_role(p_uid, 'cs_admin'::public.app_role)
     AND (
       public.has_role(p_uid, 'admin'::public.app_role)
       OR coalesce(
         (SELECT np.allowed FROM public.navigation_permissions np
           WHERE np.user_id = p_uid AND np.nav_section = 'tech_status'
           ORDER BY np.allowed DESC LIMIT 1),
         public.has_role(p_uid, 'processor'::public.app_role)
       )
     );
$$;
REVOKE ALL ON FUNCTION marshmallow_private.can_see_tech_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.can_see_tech_status(uuid) TO authenticated, service_role;

-- For the lead-tech-status Edge Function: the signed-in caller's own answer.
CREATE OR REPLACE FUNCTION public.can_see_tech_status()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT marshmallow_private.can_see_tech_status(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.can_see_tech_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_tech_status() TO authenticated;

DROP POLICY IF EXISTS "Admins and processors read lead techs" ON public.lead_tech_contacts;
DROP POLICY IF EXISTS "Tech status users read techs of visible leads" ON public.lead_tech_contacts;
CREATE POLICY "Tech status users read techs of visible leads"
  ON public.lead_tech_contacts FOR SELECT TO authenticated
  USING (
    (SELECT marshmallow_private.can_see_tech_status((SELECT auth.uid())))
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_tech_contacts.lead_id)
  );

COMMIT;

-- Rollback:
--   DROP POLICY IF EXISTS "Tech status users read techs of visible leads" ON public.lead_tech_contacts;
--   CREATE POLICY "Admins and processors read lead techs" ON public.lead_tech_contacts
--     FOR SELECT TO authenticated USING ((SELECT marshmallow_private.caller_role()) IN ('admin', 'processor'));
--   DROP FUNCTION IF EXISTS public.can_see_tech_status();
--   DROP FUNCTION IF EXISTS marshmallow_private.can_see_tech_status(uuid);
-- Feature Access rows with nav_section = 'tech_status' are harmless if left.
