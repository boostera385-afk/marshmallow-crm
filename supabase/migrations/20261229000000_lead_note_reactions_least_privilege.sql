-- =============================================================================
-- Migration : 20261229000000_lead_note_reactions_least_privilege.sql
-- Purpose   : Follow-up to 20261228000000_processor_note_thumbs_up.sql.
--
-- DEFECT
--   Supabase default privileges gave `authenticated` UPDATE, TRUNCATE,
--   REFERENCES and TRIGGER on public.lead_note_reactions (verified read-only on
--   production 2026-11-17). RLS blocks UPDATE (no policy) but TRUNCATE bypasses
--   RLS, and reactions are never updated, so only SELECT/INSERT/DELETE are kept.
--
-- ROLLBACK (restores the over-broad default; not recommended)
/*
GRANT UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.lead_note_reactions TO authenticated;
*/
-- =============================================================================

REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.lead_note_reactions FROM authenticated;
