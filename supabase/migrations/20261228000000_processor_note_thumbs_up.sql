-- =============================================================================
-- Migration : 20261228000000_processor_note_thumbs_up.sql
-- Status    : NOT APPLIED. Apply manually with explicit approval.
-- Purpose   : A single thumbs-up (👍) reaction on Processor Notes. Processors
--             (and Admins) can react to OTHER people's notes in a lead's
--             Processor Notes thread; every Processor/Admin who can read the
--             thread sees who reacted.
--
-- DESIGN
--   A separate table, not a column on lead_notes, so reacting never touches the
--   note row: no "Edited by" stamp, no content-edit grant needed, and the
--   protect_lead_note_identity() / stamp_lead_note_edit() triggers are not
--   involved. One row per (note, user) = at most one thumbs-up each, toggled by
--   insert / delete. The emoji is fixed (no column), as requested.
--
-- AUTHORIZATION (enforced here, UI is only a convenience)
--   SELECT : processor or admin, on processor-type notes the caller can already
--            read (lead_notes RLS applies inside the EXISTS).
--   INSERT : same, user_id must be the caller, and not on the caller's own note.
--   DELETE : only your own reaction.
--   UPDATE : no policy (reactions are never edited).
--   CS / CS Admin / OPR / anon: no access. Other threads' notes: rejected.
--
-- LAYERS
--   UI            : NoteThread (processor thread only)
--   frontend perms: src/lib/access.ts :: canReactToProcessorNotes()
--   RLS           : policies below
--   edge funcs    : none read or write this table
--   types         : regenerate src/integrations/supabase/types.ts after apply
--   Realtime      : table is deliberately NOT added to the supabase_realtime
--                   publication (see 20261210080000: WAL decoding is the largest
--                   CPU cost). Other viewers see a reaction on the thread's
--                   existing refresh (notes realtime event, visibility change,
--                   2-min safety poll). Add it to the publication only with
--                   evidence that faster delivery is worth the cost.
--   Donut         : no note threads in the extension - no counterpart
--
-- HARNESS : supabase/tests/97_processor_note_thumbs_up.sql (rolls back)
--
-- -----------------------------------------------------------------------------
-- ROLLBACK (reactions are lost; notes are unaffected)
-- -----------------------------------------------------------------------------
/*
DROP TABLE IF EXISTS public.lead_note_reactions;
*/
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.lead_note_reactions (
  note_id    uuid        NOT NULL REFERENCES public.lead_notes(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id)
);

-- PK serves note_id lookups (the embedded read); this serves the user FK cascade.
CREATE INDEX IF NOT EXISTS lead_note_reactions_user_id_idx
  ON public.lead_note_reactions (user_id);

ALTER TABLE public.lead_note_reactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.lead_note_reactions FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.lead_note_reactions TO authenticated;
GRANT ALL ON public.lead_note_reactions TO service_role;

DROP POLICY IF EXISTS "Processors and admins read note reactions" ON public.lead_note_reactions;
CREATE POLICY "Processors and admins read note reactions" ON public.lead_note_reactions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    ((SELECT public.has_role(auth.uid(), 'processor'::public.app_role))
      OR (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
    AND EXISTS (
      SELECT 1 FROM public.lead_notes n
       WHERE n.id = lead_note_reactions.note_id
         AND n.note_type = 'processor'
    )
  );

DROP POLICY IF EXISTS "Processors and admins react to others' notes" ON public.lead_note_reactions;
CREATE POLICY "Processors and admins react to others' notes" ON public.lead_note_reactions
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND ((SELECT public.has_role(auth.uid(), 'processor'::public.app_role))
      OR (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)))
    AND EXISTS (
      SELECT 1 FROM public.lead_notes n
       WHERE n.id = lead_note_reactions.note_id
         AND n.note_type = 'processor'
         AND n.user_id IS DISTINCT FROM (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users remove their own note reaction" ON public.lead_note_reactions;
CREATE POLICY "Users remove their own note reaction" ON public.lead_note_reactions
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
