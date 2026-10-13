-- Purpose: address Copilot-only auth initplan / duplicate SELECT advisories
-- without changing effective access. The original migration is already applied.
BEGIN;
ALTER POLICY "Copilot configuration admin" ON public.copilot_config
USING ((SELECT public.has_role((SELECT auth.uid()),'admin'::public.app_role)))
WITH CHECK ((SELECT public.has_role((SELECT auth.uid()),'admin'::public.app_role)));
ALTER POLICY "Copilot override read" ON public.copilot_user_permissions
USING (user_id=(SELECT auth.uid()) OR (SELECT public.has_role((SELECT auth.uid()),'admin'::public.app_role)));

-- SELECT is already handled by the existing read policies. Limit the Admin
-- write policies to their actual commands instead of evaluating FOR ALL twice.
DROP POLICY IF EXISTS "Copilot role admin" ON public.copilot_role_permissions;
DROP POLICY IF EXISTS "Copilot override admin" ON public.copilot_user_permissions;
DO $$ DECLARE t text; label text; BEGIN
 FOR t,label IN SELECT * FROM (VALUES
  ('copilot_role_permissions','Copilot role admin'),
  ('copilot_user_permissions','Copilot override admin')) AS targets(t,label) LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',label||' insert',t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',label||' update',t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',label||' delete',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_role((SELECT auth.uid()),''admin''::public.app_role)))',label||' insert',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()),''admin''::public.app_role))) WITH CHECK ((SELECT public.has_role((SELECT auth.uid()),''admin''::public.app_role)))',label||' update',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT public.has_role((SELECT auth.uid()),''admin''::public.app_role)))',label||' delete',t);
 END LOOP;
END; $$;
COMMIT;

-- Rollback: after review, restore just the original Copilot policy definitions
-- from 20261013045711_marshmallow_copilot.sql, dropping the six command-specific
-- policies above first. Do not reapply the entire original migration or touch
-- leads/technicians/RLS. The previous policies enforce the same access rules;
-- rollback only restores their less-efficient evaluation.
