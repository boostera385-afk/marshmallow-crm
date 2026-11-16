-- =============================================================================
-- Migration : 20261220000000_processor_notes_edit_grant.sql
-- Applied   : production (kxiqholnmhkwhdkhtopp) 2026-11-16, at the user's request.
-- Purpose   : Per-user Feature Access grant that lets a Processor edit other
--             users' notes in a lead's Processor Notes thread.
--
-- DEFECT / REQUEST
--   lead_notes UPDATE was author-or-admin only ("Author or admin can update
--   notes"), so a Processor could not correct a colleague's processor note.
--   The business wants this allowed, but only for Processors an Admin has
--   switched on in Settings -> Feature Access ("Edit Processor Notes").
--
-- WHAT THIS DOES
--   1. profiles.can_edit_processor_notes (boolean, default false)
--   2. protect_profile_privilege_flags() now also guards that flag, so only an
--      Admin (or service_role) can set it; nobody can self-grant it.
--   3. public.can_edit_others_processor_notes()
--        processor role AND the flag (single source of truth for RLS)
--   4. lead_notes UPDATE policy "Granted processors can edit processor notes":
--        note_type = 'processor' only, on leads the caller can already read
--        (leads RLS), before and after the update.
--   5. protect_lead_note_identity() BEFORE UPDATE trigger: a non-author,
--        non-admin editor can change `content` only - never lead_id, user_id,
--        user_name, note_type or created_at (authorship stays truthful and a
--        note cannot be moved to another lead or thread).
--
--   Unchanged: author/admin update, insert, select and delete policies. The
--   grant does not allow deleting anyone's note. CS / OPR / general threads are
--   unaffected.
--
-- LAYERS
--   UI            : Settings Feature Access switch; NoteThread edit pencil
--   frontend perms: src/lib/access.ts :: canEditOthersProcessorNotes()
--   RLS           : policy (4) + trigger (5)
--   edge funcs    : none write lead_notes updates (verified by grep)
--   types         : regenerate src/integrations/supabase/types.ts after apply
--   Donut         : no note threads in the extension - no counterpart
--
-- HARNESS : supabase/tests/95_processor_notes_edit_grant.sql (rolls back)
--
-- -----------------------------------------------------------------------------
-- ROLLBACK - run verbatim to undo everything below.
-- -----------------------------------------------------------------------------
/*
DROP POLICY IF EXISTS "Granted processors can edit processor notes" ON public.lead_notes;
DROP TRIGGER IF EXISTS protect_lead_note_identity ON public.lead_notes;
DROP FUNCTION IF EXISTS public.protect_lead_note_identity();
DROP FUNCTION IF EXISTS public.can_edit_others_processor_notes();
-- Restore protect_profile_privilege_flags() from
-- supabase/migrations/20261023040000_manual_lead_addition_gate.sql (section 5)
-- BEFORE dropping the column, or every profiles write will fail.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS can_edit_processor_notes;
*/
-- =============================================================================


-- 1 : the grant ----------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_edit_processor_notes boolean NOT NULL DEFAULT false;


-- 2 : no self-grant ------------------------------------------------------------
--     Same body as live production (captured 2026-11-16 via pg_get_functiondef)
--     plus can_edit_processor_notes in every flag comparison. The CS Admin
--     path still only lets Manual Lead Addition change.
CREATE OR REPLACE FUNCTION public.protect_profile_privilege_flags()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_can_manage boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.has_role(v_caller, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.can_add_manual_leads
       OR NEW.can_manage_users
       OR NEW.is_quotation_master
       OR NEW.can_view_tech_report
       OR NEW.can_edit_processor_notes THEN
      RAISE EXCEPTION 'Not permitted to set privilege flags';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.can_add_manual_leads   IS NOT DISTINCT FROM OLD.can_add_manual_leads
     AND NEW.can_manage_users   IS NOT DISTINCT FROM OLD.can_manage_users
     AND NEW.is_quotation_master IS NOT DISTINCT FROM OLD.is_quotation_master
     AND NEW.can_view_tech_report IS NOT DISTINCT FROM OLD.can_view_tech_report
     AND NEW.can_edit_processor_notes IS NOT DISTINCT FROM OLD.can_edit_processor_notes THEN
    RETURN NEW;
  END IF;

  SELECT can_manage_users INTO v_can_manage FROM public.profiles WHERE id = v_caller;

  IF public.has_role(v_caller, 'cs_admin'::public.app_role)
     AND v_can_manage IS TRUE
     AND public.has_role(NEW.id, 'customer_service'::public.app_role)
     AND NEW.id <> v_caller
     AND NEW.can_add_manual_leads IS DISTINCT FROM OLD.can_add_manual_leads
     AND NEW.can_manage_users    IS NOT DISTINCT FROM OLD.can_manage_users
     AND NEW.is_quotation_master IS NOT DISTINCT FROM OLD.is_quotation_master
     AND NEW.can_view_tech_report IS NOT DISTINCT FROM OLD.can_view_tech_report
     AND NEW.can_edit_processor_notes IS NOT DISTINCT FROM OLD.can_edit_processor_notes THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not permitted to change privilege flags';
END;
$$;


-- 3 : who holds the grant -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_edit_others_processor_notes()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'processor'::public.app_role)
     AND EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.can_edit_processor_notes
     );
$$;

REVOKE EXECUTE ON FUNCTION public.can_edit_others_processor_notes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_edit_others_processor_notes() FROM anon;
GRANT  EXECUTE ON FUNCTION public.can_edit_others_processor_notes() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.can_edit_others_processor_notes() TO service_role;


-- 4 : the UPDATE policy ---------------------------------------------------------
DROP POLICY IF EXISTS "Granted processors can edit processor notes" ON public.lead_notes;
CREATE POLICY "Granted processors can edit processor notes" ON public.lead_notes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    note_type = 'processor'
    AND (SELECT public.can_edit_others_processor_notes())
    AND EXISTS (SELECT 1 FROM public.leads WHERE leads.id = lead_notes.lead_id)
  )
  WITH CHECK (
    note_type = 'processor'
    AND (SELECT public.can_edit_others_processor_notes())
    AND EXISTS (SELECT 1 FROM public.leads WHERE leads.id = lead_notes.lead_id)
  );


-- 5 : content-only for non-authors ----------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_lead_note_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  -- service_role / internal jobs, admins and the note's own author keep their
  -- existing behaviour.
  IF v_caller IS NULL
     OR public.has_role(v_caller, 'admin'::public.app_role)
     OR OLD.user_id = v_caller THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.user_name IS DISTINCT FROM OLD.user_name
     OR NEW.note_type IS DISTINCT FROM OLD.note_type
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Only the note text can be edited on another user''s note';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_lead_note_identity ON public.lead_notes;
CREATE TRIGGER protect_lead_note_identity
  BEFORE UPDATE ON public.lead_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_lead_note_identity();
