-- =============================================================================
-- Migration : 20261129000000_sheets_watchdog_cron_caller.sql
-- Purpose   : Let the pg_cron Sheets watchdog pass the admin/service gate again.
--
-- DEFECT
--   20261103010000 scheduled `sheets-sync-watchdog` every five minutes as
--   `SELECT public.raise_sheets_sync_stale_alert(900, 15)`. 20261106010000 then
--   added an Admin-or-service_role gate to that function and to the
--   get_sheets_sync_health()/sheets_sync_lag() calls it makes. pg_cron runs with
--   no request JWT, so auth.role() and auth.uid() are NULL and every run raises
--   42501 "Admin access required". Production Postgres logs show it at every
--   five-minute tick. The "[Alert] Google Sheets backup is behind" notification
--   therefore never fires from the server, which is the safety net this job
--   exists for.
--
--   Harness 70 did not catch it because it impersonates an Admin JWT before
--   calling the alert, which a cron run never has.
--
-- FIX
--   A private wrapper, executable by no API role, marks only its own call as
--   service_role and then calls the unchanged public function. The public gates
--   are not widened: an anon/authenticated client without the Admin role is
--   still refused, and the wrapper is not reachable through PostgREST.
--   The previous JWT claim settings are restored after the call so a postgres
--   session that calls the wrapper does not keep the service_role claim.
--
-- VERIFY
--   supabase/tests/71_sheets_watchdog_cron_caller.sql (rolls back).
--   After applying, Postgres logs should stop showing 42501
--   "Admin access required" on five-minute ticks, and
--     SELECT status, return_message FROM cron.job_run_details d
--       JOIN cron.job j USING (jobid)
--      WHERE j.jobname = 'sheets-sync-watchdog'
--      ORDER BY d.start_time DESC LIMIT 5;
--   should show `succeeded`.
--
-- ROLLBACK
--   Restores the failing job; only do this together with another fix.
--   SELECT cron.unschedule('sheets-sync-watchdog');
--   SELECT cron.schedule('sheets-sync-watchdog', '*/5 * * * *',
--     $job$SELECT public.raise_sheets_sync_stale_alert(900, 15);$job$);
--   DROP FUNCTION IF EXISTS marshmallow_private.cron_raise_sheets_sync_stale_alert();
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS marshmallow_private;

CREATE OR REPLACE FUNCTION marshmallow_private.cron_raise_sheets_sync_stale_alert()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_claims text := current_setting('request.jwt.claims', true);
  v_role   text := current_setting('request.jwt.claim.role', true);
  v_sent   integer;
BEGIN
  -- auth.role() reads request.jwt.claim.role first, then request.jwt.claims.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  v_sent := public.raise_sheets_sync_stale_alert(900, 15);

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  RETURN v_sent;
END;
$fn$;

REVOKE ALL ON FUNCTION marshmallow_private.cron_raise_sheets_sync_stale_alert()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION marshmallow_private.cron_raise_sheets_sync_stale_alert() IS
  'pg_cron entry point for the Google Sheets stale-backup alert. Not executable by API roles.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sheets-sync-watchdog';
    PERFORM cron.schedule(
      'sheets-sync-watchdog',
      '*/5 * * * *',
      'SELECT marshmallow_private.cron_raise_sheets_sync_stale_alert()'
    );
  ELSE
    RAISE WARNING 'pg_cron is unavailable; the Google Sheets watchdog is not scheduled.';
  END IF;
END $$;
