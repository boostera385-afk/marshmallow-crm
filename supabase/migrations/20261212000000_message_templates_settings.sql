-- =============================================================================
-- Migration : 20261212000000_message_templates_settings.sql
-- Applied   : production (kxiqholnmhkwhdkhtopp) 2026-11-12, at the user's request.
-- Purpose   : Storage for Settings > Templates: admin-edited texts for the
--             Copy Technician Message (no terms / Quoted / Free Estimate) and
--             the new Check Template.
--
-- BACKGROUND
--   20260616152000_message_templates_and_cancellation_images.sql was never
--   applied in production (read-only check 2026-11-12:
--   to_regclass('public.message_templates') IS NULL), which is why the old
--   Templates tab was removed on 2026-11-10. That file is left untouched; this
--   migration creates the table on its own, idempotently, with:
--     - keys limited to the four editable templates (CHECK);
--     - no seed rows: a missing row means "use the built-in text in the app";
--     - every signed-in user may read (all roles copy the same wording);
--     - only admins may insert, update or delete (RLS, has_role);
--     - updated_by / updated_at stamped by trigger from auth.uid(), so a
--       client cannot attribute a change to someone else;
--     - anon has no access.
--   Not added to the supabase_realtime publication: the app re-reads at most
--   once a minute, only while a copy dialog or Settings > Templates is open.
--
-- VERIFYING AFTER APPLYING
--   Run supabase/tests/176_message_templates.sql on an isolated database
--   (write-based, rolls back) and check every row is PASS.
--   Read-only on production:
--     SELECT policyname, cmd FROM pg_policies WHERE tablename = 'message_templates';
--   must list 4 policies (select / insert / update / delete).
--
-- APPLY
--   Paste into the Supabase SQL Editor and run as postgres. Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.message_templates (
  key TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_key_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_key_check CHECK (key IN (
    'technician_message',
    'technician_message_quoted',
    'technician_message_free_estimate',
    'check_template'
  ));

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_template_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_template_check
  CHECK (length(btrim(template)) > 0 AND length(template) <= 5000);

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.message_templates FROM anon;
REVOKE ALL ON public.message_templates FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_templates TO authenticated;

DROP POLICY IF EXISTS "Authenticated can read message templates" ON public.message_templates;
DROP POLICY IF EXISTS "Admins can manage message templates" ON public.message_templates;
DROP POLICY IF EXISTS message_templates_select_authenticated ON public.message_templates;
DROP POLICY IF EXISTS message_templates_insert_admin ON public.message_templates;
DROP POLICY IF EXISTS message_templates_update_admin ON public.message_templates;
DROP POLICY IF EXISTS message_templates_delete_admin ON public.message_templates;

CREATE POLICY message_templates_select_authenticated
  ON public.message_templates FOR SELECT TO authenticated
  USING (true);

CREATE POLICY message_templates_insert_admin
  ON public.message_templates FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE POLICY message_templates_update_admin
  ON public.message_templates FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE POLICY message_templates_delete_admin
  ON public.message_templates FOR DELETE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE OR REPLACE FUNCTION public.message_templates_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.message_templates_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS message_templates_set_updated_at ON public.message_templates;
DROP TRIGGER IF EXISTS message_templates_stamp ON public.message_templates;
CREATE TRIGGER message_templates_stamp
  BEFORE INSERT OR UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.message_templates_stamp();

-- =============================================================================
-- ROLLBACK - run manually. Drops the admin-edited texts; the app then falls back
-- to its built-in templates (and shows a load error in Settings > Templates).
--
-- DROP TRIGGER IF EXISTS message_templates_stamp ON public.message_templates;
-- DROP FUNCTION IF EXISTS public.message_templates_stamp();
-- DROP TABLE IF EXISTS public.message_templates;
-- =============================================================================
