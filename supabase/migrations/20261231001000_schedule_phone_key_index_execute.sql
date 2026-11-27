-- =============================================================================
-- Migration : 20261231001000_schedule_phone_key_index_execute.sql
-- Purpose   : Restore EXECUTE on the pure phone-key helper used by two
--             expression indexes, so lead and conversation writes stop failing.
--
-- DEFECT
--   20261127061235_lead_contact_events created expression indexes
--     public.leads             leads_phone_key_idx              (schedule_phone_key(customer_phone))
--     public.quo_conversations quo_conversations_phone_key_idx  (schedule_phone_key(customer_number))
--   20261130000000_ai_schedule_confirmation then ran
--     REVOKE ALL ON FUNCTION marshmallow_private.schedule_phone_key(text)
--       FROM PUBLIC, anon, authenticated;
--   Postgres evaluates index expressions as the writing role. Since then any
--   authenticated or service_role write that maintains those indexes (an INSERT,
--   or an UPDATE that cannot be HOT) fails with
--     ERROR 42501: permission denied for function schedule_phone_key
--   Seen in Donut "Create Lead"; the CRM and Edge Functions writing directly as
--   service_role hit the same path. Verified read-only on 2026-11-27:
--   has_function_privilege(authenticated|service_role, ..., EXECUTE) = false.
--
-- WHY THIS IS SAFE
--   schedule_phone_key is IMMUTABLE, SECURITY INVOKER, search_path='' and only
--   strips non-digits from its text argument and keeps the last 10 digits. It
--   reads no table, so granting EXECUTE exposes no data and changes no RLS.
--   Only the roles that write these tables get it; anon / PUBLIC stay revoked.
--   No function body, index, policy or row is changed. No UPDATE public.leads.
--
-- HARNESS  : supabase/tests/202_schedule_phone_key_execute_readonly.sql (read-only)
-- ROLLBACK : REVOKE EXECUTE ON FUNCTION marshmallow_private.schedule_phone_key(text)
--              FROM authenticated, service_role;
--            (re-breaks lead / conversation writes while the indexes exist)
-- =============================================================================
BEGIN;

GRANT EXECUTE ON FUNCTION marshmallow_private.schedule_phone_key(text) TO authenticated, service_role;

COMMIT;
