-- =============================================================================
-- Migration : 20261210020000_cron_run_history_retention.sql
-- Purpose   : Keep pg_cron's run history (cron.job_run_details) to 7 days.
--
-- WHY
--   pg_cron writes one row per job run and never deletes them. On 2026-11-10
--   the table held 127,982 rows (23 MB) going back to 2026-07-07, of which
--   106,173 were older than 7 days, and it grows by ~3,500 rows a day (more
--   now that the load governor samples every minute). Nothing in Marshmallow
--   reads this history beyond recent troubleshooting.
--
-- WHAT
--   marshmallow_private.purge_cron_run_history(keep_days) deletes runs that
--   ended (or, if they never recorded an end, started) more than keep_days
--   ago, and returns how many rows it removed. Scheduled daily at 03:37 UTC
--   (quiet hours; the notifications retention job runs at 03:17).
--   Deleted space is reused by new rows, so the table stops growing; it does
--   not shrink on disk without a VACUUM FULL, which is not needed.
--
-- NOT CHANGED
--   No job, schedule or customer data is touched - only scheduler logs.
--
-- APPLY
--   Paste into the Supabase SQL Editor as postgres. Idempotent.
--
-- ROLLBACK (deleted history cannot be restored; it is logging only)
--   SELECT cron.unschedule('cron-run-history-retention');
--   DROP FUNCTION IF EXISTS marshmallow_private.purge_cron_run_history(integer);
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION marshmallow_private.purge_cron_run_history(p_keep_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  removed integer;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 1 THEN
    RAISE EXCEPTION 'keep at least 1 day of cron history' USING errcode = '22023';
  END IF;
  DELETE FROM cron.job_run_details
   WHERE coalesce(end_time, start_time) < now() - make_interval(days => p_keep_days);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;

REVOKE ALL ON FUNCTION marshmallow_private.purge_cron_run_history(integer) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('cron-run-history-retention', '37 3 * * *', 'SELECT marshmallow_private.purge_cron_run_history(7)');

COMMIT;
