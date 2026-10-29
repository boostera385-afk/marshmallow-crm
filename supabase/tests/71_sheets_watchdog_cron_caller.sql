-- =============================================================================
-- Harness : 71_sheets_watchdog_cron_caller.sql
-- Purpose : Prove the pg_cron Sheets watchdog runs without a request JWT and
--           that the admin gate on the public alert RPC still holds.
--
-- WHY THIS EXISTS
--   Harness 70 impersonates an Admin JWT, so it never saw that the scheduled
--   job (no JWT) failed with 42501 "Admin access required" every five minutes.
--   These checks clear every JWT claim first, the way pg_cron runs.
--
-- HOW TO RUN
--   Apply 20261129000000_sheets_watchdog_cron_caller.sql first, then run this
--   in the Supabase SQL editor as postgres. It writes health/queue/notification
--   rows inside the transaction and rolls everything back at the end.
--
--   Expected: every OK is true.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _results (
  seq    integer PRIMARY KEY,
  name   text NOT NULL,
  ok     boolean NOT NULL,
  detail text
) ON COMMIT DROP;

-- The cron context: no JWT claims at all.
SELECT set_config('request.jwt.claims', '', true),
       set_config('request.jwt.claim.role', '', true),
       set_config('request.jwt.claim.sub', '', true);


-- -----------------------------------------------------------------------------
-- 01  The scheduled job calls the private wrapper
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_command text;
BEGIN
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'sheets-sync-watchdog';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'sheets-sync-watchdog is not scheduled';
  END IF;
  IF v_command NOT LIKE '%marshmallow_private.cron_raise_sheets_sync_stale_alert()%' THEN
    RAISE EXCEPTION 'job still runs: %', v_command;
  END IF;
  INSERT INTO _results VALUES (1, 'job calls the cron wrapper', true, v_command);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _results VALUES (1, 'job calls the cron wrapper', false, SQLERRM);
END $$;


-- -----------------------------------------------------------------------------
-- 02  Without a JWT the public RPC is still refused (gate not widened)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.raise_sheets_sync_stale_alert(900, 15);
  INSERT INTO _results VALUES (2, 'public RPC refuses no-JWT caller', false, 'call succeeded');
EXCEPTION
  WHEN insufficient_privilege THEN
    INSERT INTO _results VALUES (2, 'public RPC refuses no-JWT caller', true, SQLERRM);
  WHEN OTHERS THEN
    INSERT INTO _results VALUES (2, 'public RPC refuses no-JWT caller', false, SQLSTATE || ' ' || SQLERRM);
END $$;


-- -----------------------------------------------------------------------------
-- 03  A down sync alerts every admin through the wrapper, then throttles
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_first  integer;
  v_second integer;
  v_admins integer;
BEGIN
  -- record_sheets_sync_failure is gated too; mark only this setup as service.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  DELETE FROM public.google_sheets_sync_health;
  DELETE FROM public.notifications WHERE title = '[Alert] Google Sheets backup is behind';
  FOR i IN 1..10 LOOP
    PERFORM public.record_sheets_sync_failure('harness 71', NULL, 'sync');
  END LOOP;
  PERFORM set_config('request.jwt.claim.role', '', true);

  SELECT count(*) INTO v_admins FROM public.user_roles WHERE role = 'admin';
  v_first := marshmallow_private.cron_raise_sheets_sync_stale_alert();
  v_second := marshmallow_private.cron_raise_sheets_sync_stale_alert();

  IF v_first <> v_admins THEN
    RAISE EXCEPTION 'alerted % of % admins', v_first, v_admins;
  END IF;
  IF v_second <> 0 THEN
    RAISE EXCEPTION 'throttle failed: second run inserted %', v_second;
  END IF;
  INSERT INTO _results VALUES (3, 'cron wrapper alerts admins once', true,
                               format('%s admin(s) alerted, throttle held', v_first));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _results VALUES (3, 'cron wrapper alerts admins once', false, SQLSTATE || ' ' || SQLERRM);
END $$;


-- -----------------------------------------------------------------------------
-- 04  The wrapper does not leave a service_role claim behind
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_role text;
BEGIN
  PERFORM marshmallow_private.cron_raise_sheets_sync_stale_alert();
  v_role := auth.role();
  IF v_role IS NOT NULL THEN
    RAISE EXCEPTION 'auth.role() is % after the call, expected NULL', v_role;
  END IF;
  INSERT INTO _results VALUES (4, 'claims restored after call', true, 'auth.role() is NULL');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _results VALUES (4, 'claims restored after call', false, SQLSTATE || ' ' || SQLERRM);
END $$;


-- -----------------------------------------------------------------------------
-- 05  No API role can execute the wrapper
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_allowed text;
BEGIN
  SELECT string_agg(r, ', ') INTO v_allowed
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
   WHERE has_function_privilege(r, 'marshmallow_private.cron_raise_sheets_sync_stale_alert()', 'EXECUTE');
  IF v_allowed IS NOT NULL THEN
    RAISE EXCEPTION 'executable by: %', v_allowed;
  END IF;
  INSERT INTO _results VALUES (5, 'API roles cannot execute wrapper', true, 'anon, authenticated, service_role denied');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _results VALUES (5, 'API roles cannot execute wrapper', false, SQLERRM);
END $$;


SELECT seq, name, ok, detail FROM _results ORDER BY seq;

ROLLBACK;
