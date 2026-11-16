-- =============================================================================
-- Migration : 20261221000000_message_template_diagnostic_key.sql
-- Applied   : production (kxiqholnmhkwhdkhtopp) 2026-11-16, at the user's request;
--             message_templates_key_check verified read-only afterwards.
-- Purpose   : Allow Settings > Templates to save the new
--             "Technician Message: Diagnostic/Service Call" template.
--
-- REQUEST (2026-11-16)
--   Quote terms gain "Diagnostic/Service Call" (leads.terms =
--   'diagnostic_service_call'; leads.terms is plain text with no CHECK, so no
--   lead schema change). Its Copy Technician Message has its own editable text,
--   key 'technician_message_diagnostic_service_call'. The live
--   message_templates_key_check (captured 2026-11-16) only lists the four
--   existing keys, so an admin's save of the new template would be rejected.
--   Until this is applied the app still copies the built-in wording; only saving
--   an edited version fails.
--
-- WHAT THIS DOES
--   Recreates message_templates_key_check with the fifth key. No data change,
--   no RLS/grant change (admin-only writes stay as they are).
--
-- VERIFY (read-only)
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'message_templates_key_check';
--   must include 'technician_message_diagnostic_service_call'.
--   Harness: supabase/tests/176_message_templates.sql (write-based, rolls back).
--
-- ROLLBACK (only after deleting any saved row with the new key)
--   DELETE FROM public.message_templates WHERE key = 'technician_message_diagnostic_service_call';
--   ALTER TABLE public.message_templates DROP CONSTRAINT IF EXISTS message_templates_key_check;
--   ALTER TABLE public.message_templates ADD CONSTRAINT message_templates_key_check
--     CHECK (key IN ('technician_message', 'technician_message_quoted',
--                    'technician_message_free_estimate', 'check_template'));
-- =============================================================================

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_key_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_key_check CHECK (key IN (
    'technician_message',
    'technician_message_quoted',
    'technician_message_free_estimate',
    'technician_message_diagnostic_service_call',
    'check_template'
  ));
