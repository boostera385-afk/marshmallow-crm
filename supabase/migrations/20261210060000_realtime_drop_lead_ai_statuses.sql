-- =============================================================================
-- Stop publishing lead_ai_statuses to Supabase Realtime
-- =============================================================================
-- Defect / purpose (2026-11-10): Realtime's change reader was ~55% of database
-- execution time on the shared project (pg_stat_statements, ~11.5 h window).
-- It must decode every row change on every published table, whether or not any
-- browser listens. lead_ai_statuses is the second most-written published table
-- (2,621 updates vs 13 inserts) but nothing subscribes to it:
--   * realtime.subscription had no rows for it while ~12 CRM tabs were open;
--   * no postgres_changes listener for it exists, or ever existed (git history),
--     in the CRM (src/), Donut (tmp_extension/quo-crm-extension/) or
--     supabase/functions/.
-- The Leads page reads AI status as a join in its urgent-table read (15 s poll
-- while visible); that read is unaffected because publication membership does
-- not change table access, RLS or grants.
--
-- What this changes: removes public.lead_ai_statuses from the
-- supabase_realtime publication. Nothing else. No data, RLS, grant or function
-- change. Idempotent: does nothing if the table is already unpublished.
--
-- Apply manually in the SQL editor at a quiet time (open tabs may briefly
-- reconnect to Realtime). Check: supabase/tests/173_realtime_publication_scope.sql
-- (read-only) before and after.
-- =============================================================================
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'lead_ai_statuses'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.lead_ai_statuses;
  END IF;
END $$;

COMMIT;

-- -----------------------------------------------------------------------------
-- Rollback (manual): re-publish the table, e.g. before adding a live listener.
-- -----------------------------------------------------------------------------
-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM pg_publication_tables
--      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
--        AND tablename = 'lead_ai_statuses'
--   ) THEN
--     ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_ai_statuses;
--   END IF;
-- END $$;
