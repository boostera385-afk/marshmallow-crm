-- =============================================================================
-- Migration : 20261223000000_lead_note_edited_by.sql
-- Purpose   : Record who last edited a lead note, so the Processor Notes thread
--             can show which processor changed a note.
--
-- REQUEST (2026-11-16)
--   Since 20261220000000 a granted Processor can edit other users' processor
--   notes. The thread still showed only the original author, so nobody could
--   tell which processor changed a note. The owner wants the editor's name.
--
-- WHAT THIS DOES
--   1. lead_notes.edited_by (uuid -> profiles, ON DELETE SET NULL),
--      edited_by_name (text snapshot, like user_name) and edited_at.
--   2. stamp_lead_note_edit() BEFORE INSERT OR UPDATE trigger:
--        - INSERT by a signed-in user: the three fields are cleared (a new note
--          has not been edited; a client cannot pre-fill them).
--        - UPDATE that changes `content`: stamped from auth.uid(), the
--          editor's profile name, and now(). Client-sent values are ignored.
--        - UPDATE that does not change `content`: the previous stamp is kept,
--          so it cannot be forged or cleared on its own.
--        - No JWT (service_role / internal jobs): values pass through as sent.
--      SECURITY DEFINER only to read the editor's profile name (profiles RLS
--      does not let every role read every profile); fixed search_path; no
--      caller-supplied input reaches SQL.
--   Existing notes keep NULLs (no backfill; no edit history exists).
--   No policy change: who may edit is unchanged (author, admin, granted
--   processor). protect_lead_note_identity() still keeps author/lead/thread.
--
-- HARNESS : supabase/tests/96_lead_note_edited_by.sql (rolls back)
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS stamp_lead_note_edit ON public.lead_notes;
--   DROP FUNCTION IF EXISTS public.stamp_lead_note_edit();
--   ALTER TABLE public.lead_notes
--     DROP COLUMN IF EXISTS edited_at,
--     DROP COLUMN IF EXISTS edited_by_name,
--     DROP COLUMN IF EXISTS edited_by;
-- =============================================================================

ALTER TABLE public.lead_notes
  ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_by_name text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE OR REPLACE FUNCTION public.stamp_lead_note_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.edited_by := NULL;
    NEW.edited_by_name := NULL;
    NEW.edited_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.content IS DISTINCT FROM OLD.content THEN
    NEW.edited_by := v_caller;
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), p.email, 'Unknown user')
      INTO NEW.edited_by_name
      FROM public.profiles p
     WHERE p.id = v_caller;
    NEW.edited_by_name := COALESCE(NEW.edited_by_name, 'Unknown user');
    NEW.edited_at := now();
  ELSE
    NEW.edited_by := OLD.edited_by;
    NEW.edited_by_name := OLD.edited_by_name;
    NEW.edited_at := OLD.edited_at;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stamp_lead_note_edit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stamp_lead_note_edit() FROM anon;

DROP TRIGGER IF EXISTS stamp_lead_note_edit ON public.lead_notes;
CREATE TRIGGER stamp_lead_note_edit
  BEFORE INSERT OR UPDATE ON public.lead_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_lead_note_edit();
