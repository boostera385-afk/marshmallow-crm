-- =============================================================================
-- Migration : 20261210010000_load_governor.sql
-- Purpose   : Let the database notice rising load and shed deferrable work
--             BEFORE it fails, and tell open CRM tabs to do the same.
--
-- WHY
--   On 2026-11-07 and 2026-11-09 the database ran hot for 7-8 busy hours and
--   then stopped answering. Nothing reacted until requests were already timing
--   out. This adds a governor:
--     1. SENSE  every minute (pg_cron): how busy the database was over the last
--               minute (delta of pg_stat_statements total_exec_time) and how many
--               connections are in use. Samples kept 7 days - a record of what
--               happened, for calibration and incident review.
--     2. DECIDE a level - normal / elevated / critical - with hysteresis, from
--               thresholds kept in one row (marshmallow_private.load_policy) so
--               they can be tuned from real samples without code changes.
--     3. ACT    on the server: deferrable cron jobs skip their turn while the
--               level is raised; nothing is lost, the next allowed run catches
--               up (queues stay queued).
--     4. TELL   the browsers: the level is broadcast on the existing
--               "global-app-events" realtime channel (realtime.send, public
--               broadcast - no table, no per-change RLS check). Tabs then stretch
--               or pause BACKGROUND refreshes only. User actions, page loads and
--               realtime are never blocked or delayed.
--
--   | Job                            | normal      | elevated        | critical |
--   |--------------------------------|-------------|-----------------|----------|
--   | google-sheets-outbox-worker    | every min   | every 5th min   | skipped  |
--   | urgent-ai-status-refresh       | runs        | skipped         | skipped  |
--   | processor-board-daily-check    | runs        | skipped         | skipped  |
--   | sheets-sync-watchdog           | runs (*)    | skipped         | skipped  |
--   | schedule-confirmation-monitor  | runs        | runs            | skipped  |
--   | notifications-retention        | unchanged (nightly, not wrapped)          |
--   (*) also skipped for 10 minutes after returning to normal, so the sync can
--       catch up before the watchdog (15-minute threshold) checks it.
--
--   Default thresholds (Small compute = 2 vCPU = 120,000 busy ms per minute):
--     elevated : busy >= 50% for 2 consecutive minutes, or connections >= 70%
--                of max_connections
--     critical : busy >= 80% for 2 consecutive minutes
--     normal   : only after busy < 35% for 3 consecutive minutes (hysteresis)
--   If the sampler stops (no sample for 10 minutes) the level reads as normal,
--   so a broken sensor can never leave work shed. To switch shedding off
--   without removing anything:
--     UPDATE marshmallow_private.load_policy SET shedding_enabled = false;
--
-- SAFETY
--   - Reads only pg_stat_statements / pg_stat_activity counters: a few ms per
--     minute. No user data is read or broadcast; the broadcast carries only
--     {level, busy_pct, changed_at}.
--   - A failed broadcast never fails sampling.
--   - Original job functions are not modified; the cron jobs call guarded
--     wrappers that call them unchanged.
--   - The decision functions are pure and covered by the read-only harness
--     supabase/tests/170_load_governor.sql.
--
-- APPLY
--   Paste into the Supabase SQL Editor and run as postgres. Idempotent.
--   Afterwards run supabase/tests/170_load_governor.sql (read-only) and check
--   every row says PASS.
-- =============================================================================

BEGIN;

-- 1. Thresholds -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marshmallow_private.load_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  capacity_ms_per_minute numeric NOT NULL DEFAULT 120000 CHECK (capacity_ms_per_minute > 0),
  elevated_pct numeric NOT NULL DEFAULT 50,
  critical_pct numeric NOT NULL DEFAULT 80,
  normal_pct numeric NOT NULL DEFAULT 35,
  elevated_minutes integer NOT NULL DEFAULT 2 CHECK (elevated_minutes >= 1),
  critical_minutes integer NOT NULL DEFAULT 2 CHECK (critical_minutes >= 1),
  recover_minutes integer NOT NULL DEFAULT 3 CHECK (recover_minutes >= 1),
  connections_elevated_pct numeric NOT NULL DEFAULT 70,
  watchdog_quiet_minutes integer NOT NULL DEFAULT 10,
  shedding_enabled boolean NOT NULL DEFAULT true
);
INSERT INTO marshmallow_private.load_policy (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 2. Samples (7-day record) and current state --------------------------------
CREATE TABLE IF NOT EXISTS marshmallow_private.load_samples (
  sampled_at timestamptz PRIMARY KEY,
  total_exec_ms double precision NOT NULL,
  busy_pct numeric,
  active_connections integer NOT NULL,
  total_connections integer NOT NULL,
  max_connections integer NOT NULL,
  level text NOT NULL CHECK (level IN ('normal', 'elevated', 'critical'))
);

CREATE TABLE IF NOT EXISTS marshmallow_private.load_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  level text NOT NULL DEFAULT 'normal' CHECK (level IN ('normal', 'elevated', 'critical')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  sampled_at timestamptz
);
INSERT INTO marshmallow_private.load_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON marshmallow_private.load_policy, marshmallow_private.load_samples, marshmallow_private.load_state
  FROM PUBLIC, anon, authenticated;

-- 3. Pure decision functions (tested by supabase/tests/170_load_governor.sql) --

-- Next level from the current level, recent busy percentages (newest first)
-- and the connection usage percentage.
CREATE OR REPLACE FUNCTION marshmallow_private.decide_load_level(
  p_current text, p_recent_busy_pct numeric[], p_connections_pct numeric,
  p_policy marshmallow_private.load_policy)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  n integer := coalesce(array_length(p_recent_busy_pct, 1), 0);
  all_at_least_critical boolean;
  all_at_least_elevated boolean;
  all_below_normal boolean;
BEGIN
  all_at_least_critical := n >= p_policy.critical_minutes AND NOT EXISTS (
    SELECT 1 FROM unnest(p_recent_busy_pct[1:p_policy.critical_minutes]) v WHERE v IS NULL OR v < p_policy.critical_pct);
  all_at_least_elevated := n >= p_policy.elevated_minutes AND NOT EXISTS (
    SELECT 1 FROM unnest(p_recent_busy_pct[1:p_policy.elevated_minutes]) v WHERE v IS NULL OR v < p_policy.elevated_pct);
  all_below_normal := n >= p_policy.recover_minutes AND NOT EXISTS (
    SELECT 1 FROM unnest(p_recent_busy_pct[1:p_policy.recover_minutes]) v WHERE v IS NOT NULL AND v >= p_policy.normal_pct);

  IF all_at_least_critical THEN
    RETURN 'critical';
  ELSIF all_at_least_elevated OR coalesce(p_connections_pct, 0) >= p_policy.connections_elevated_pct THEN
    RETURN 'elevated';
  ELSIF coalesce(p_current, 'normal') <> 'normal' AND NOT all_below_normal THEN
    RETURN 'elevated';            -- hysteresis: hold until clearly recovered
  END IF;
  RETURN 'normal';
END $$;

-- May a deferrable job run now?
CREATE OR REPLACE FUNCTION marshmallow_private.deferrable_job_allowed(
  p_job text, p_level text, p_minute integer, p_minutes_since_change numeric, p_shedding_enabled boolean,
  p_watchdog_quiet_minutes integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT coalesce(p_shedding_enabled, true) THEN true
    WHEN p_job = 'sheets_sync' THEN p_level = 'normal' OR (p_level = 'elevated' AND p_minute % 5 = 0)
    WHEN p_job IN ('urgent_ai_refresh', 'processor_board_daily') THEN p_level = 'normal'
    WHEN p_job = 'sheets_watchdog' THEN p_level = 'normal' AND coalesce(p_minutes_since_change, 1e9) >= p_watchdog_quiet_minutes
    WHEN p_job = 'schedule_monitor' THEN p_level <> 'critical'
    ELSE true
  END
$$;

-- The level jobs act on. A sampler that has stopped (no sample for 10 minutes)
-- reads as normal, so a broken sensor never leaves work shed.
CREATE OR REPLACE FUNCTION marshmallow_private.current_load_level()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN s.sampled_at IS NULL OR s.sampled_at < now() - interval '10 minutes' THEN 'normal' ELSE s.level END
    FROM marshmallow_private.load_state s WHERE s.id
$$;

CREATE OR REPLACE FUNCTION marshmallow_private.deferrable_job_allowed_now(p_job text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT marshmallow_private.deferrable_job_allowed(
    p_job,
    marshmallow_private.current_load_level(),
    extract(minute FROM now())::integer,
    extract(epoch FROM now() - s.changed_at) / 60,
    p.shedding_enabled,
    p.watchdog_quiet_minutes)
  FROM marshmallow_private.load_state s, marshmallow_private.load_policy p
  WHERE s.id AND p.id
$$;

-- 4. Sensor ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marshmallow_private.sample_load()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  pol marshmallow_private.load_policy;
  prev marshmallow_private.load_samples;
  st marshmallow_private.load_state;
  now_ts timestamptz := now();
  total double precision;
  busy numeric;
  active integer;
  conns integer;
  maxc integer := current_setting('max_connections')::integer;
  recent numeric[];
  next_level text;
BEGIN
  SELECT * INTO pol FROM marshmallow_private.load_policy WHERE id;
  SELECT * INTO st FROM marshmallow_private.load_state WHERE id FOR UPDATE;
  SELECT * INTO prev FROM marshmallow_private.load_samples ORDER BY sampled_at DESC LIMIT 1;

  SELECT coalesce(sum(s.total_exec_time), 0) INTO total FROM extensions.pg_stat_statements s;
  SELECT count(*) FILTER (WHERE a.state = 'active' AND a.pid <> pg_backend_pid()), count(*)
    INTO active, conns
    FROM pg_stat_activity a WHERE a.backend_type = 'client backend';

  -- Busy % over the elapsed time; unknown (NULL) after a counter reset or a gap.
  IF prev.sampled_at IS NOT NULL AND total >= prev.total_exec_ms
     AND now_ts - prev.sampled_at BETWEEN interval '20 seconds' AND interval '5 minutes' THEN
    busy := round(((total - prev.total_exec_ms)
              / (extract(epoch FROM now_ts - prev.sampled_at) / 60)
              / pol.capacity_ms_per_minute * 100)::numeric, 1);
  END IF;

  SELECT array_agg(b ORDER BY t DESC) INTO recent FROM (
    SELECT busy AS b, now_ts AS t
    UNION ALL
    (SELECT ls.busy_pct, ls.sampled_at FROM marshmallow_private.load_samples ls
      WHERE ls.sampled_at > now_ts - interval '15 minutes' ORDER BY ls.sampled_at DESC LIMIT 10)
  ) r;

  next_level := marshmallow_private.decide_load_level(st.level, recent, conns * 100.0 / greatest(maxc, 1), pol);

  INSERT INTO marshmallow_private.load_samples (sampled_at, total_exec_ms, busy_pct, active_connections, total_connections, max_connections, level)
  VALUES (now_ts, total, busy, active, conns, maxc, next_level)
  ON CONFLICT (sampled_at) DO NOTHING;
  DELETE FROM marshmallow_private.load_samples WHERE sampled_at < now_ts - interval '7 days';

  UPDATE marshmallow_private.load_state
     SET level = next_level,
         changed_at = CASE WHEN next_level <> st.level THEN now_ts ELSE changed_at END,
         sampled_at = now_ts
   WHERE id;

  -- Tell open tabs on change, and every minute while raised (late joiners learn
  -- within a minute; a tab that stops hearing it lets the level expire).
  IF next_level <> st.level OR next_level <> 'normal' THEN
    BEGIN
      PERFORM realtime.send(
        jsonb_build_object('level', next_level, 'busy_pct', busy, 'changed_at',
          CASE WHEN next_level <> st.level THEN now_ts ELSE st.changed_at END),
        'system_load', 'global-app-events', false);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'load governor broadcast failed: %', SQLERRM;
    END;
  END IF;

  RETURN next_level;
END $$;

REVOKE ALL ON FUNCTION marshmallow_private.sample_load() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION marshmallow_private.decide_load_level(text, numeric[], numeric, marshmallow_private.load_policy) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION marshmallow_private.deferrable_job_allowed(text, text, integer, numeric, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION marshmallow_private.current_load_level() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION marshmallow_private.deferrable_job_allowed_now(text) FROM PUBLIC, anon, authenticated;

-- 5. Guarded wrappers (originals unchanged) ------------------------------------
CREATE OR REPLACE FUNCTION marshmallow_private.cron_guarded_sheets_sync()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF marshmallow_private.deferrable_job_allowed_now('sheets_sync') THEN
    PERFORM public.cron_google_sheets_sync_worker();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION marshmallow_private.cron_guarded_urgent_ai_refresh()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF marshmallow_private.deferrable_job_allowed_now('urgent_ai_refresh') THEN
    PERFORM public.cron_refresh_urgent_ai_status();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION marshmallow_private.cron_guarded_processor_board_daily()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF marshmallow_private.deferrable_job_allowed_now('processor_board_daily') THEN
    PERFORM marshmallow_private.dispatch_processor_board_daily();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION marshmallow_private.cron_guarded_sheets_watchdog()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF marshmallow_private.deferrable_job_allowed_now('sheets_watchdog') THEN
    PERFORM marshmallow_private.cron_raise_sheets_sync_stale_alert();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION marshmallow_private.cron_guarded_schedule_monitor()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF marshmallow_private.deferrable_job_allowed_now('schedule_monitor') THEN
    PERFORM marshmallow_private.dispatch_schedule_monitor();
  END IF;
END $$;

REVOKE ALL ON FUNCTION marshmallow_private.cron_guarded_sheets_sync(), marshmallow_private.cron_guarded_urgent_ai_refresh(),
  marshmallow_private.cron_guarded_processor_board_daily(), marshmallow_private.cron_guarded_sheets_watchdog(),
  marshmallow_private.cron_guarded_schedule_monitor() FROM PUBLIC, anon, authenticated;

-- 6. Schedules (cron.schedule updates an existing job with the same name) -----
SELECT cron.schedule('load-governor-sample', '* * * * *', 'SELECT marshmallow_private.sample_load()');
SELECT cron.schedule('google-sheets-outbox-worker', '* * * * *', 'SELECT marshmallow_private.cron_guarded_sheets_sync()');
SELECT cron.schedule('urgent-ai-status-refresh', '*/30 * * * *', 'SELECT marshmallow_private.cron_guarded_urgent_ai_refresh()');
SELECT cron.schedule('processor-board-daily-check', '*/5 * * * *', 'SELECT marshmallow_private.cron_guarded_processor_board_daily()');
SELECT cron.schedule('sheets-sync-watchdog', '*/5 * * * *', 'SELECT marshmallow_private.cron_guarded_sheets_watchdog()');
SELECT cron.schedule('schedule-confirmation-monitor', '* * * * *', 'SELECT marshmallow_private.cron_guarded_schedule_monitor()');

COMMIT;

-- =============================================================================
-- ROLLBACK - run manually. Restores the original job commands first, so work
-- is never left unscheduled, then removes the governor.
--
-- BEGIN;
-- SELECT cron.schedule('google-sheets-outbox-worker', '* * * * *', 'SELECT public.cron_google_sheets_sync_worker()');
-- SELECT cron.schedule('urgent-ai-status-refresh', '*/30 * * * *', 'SELECT public.cron_refresh_urgent_ai_status()');
-- SELECT cron.schedule('processor-board-daily-check', '*/5 * * * *', 'SELECT marshmallow_private.dispatch_processor_board_daily()');
-- SELECT cron.schedule('sheets-sync-watchdog', '*/5 * * * *', 'SELECT marshmallow_private.cron_raise_sheets_sync_stale_alert()');
-- SELECT cron.schedule('schedule-confirmation-monitor', '* * * * *', 'SELECT marshmallow_private.dispatch_schedule_monitor()');
-- SELECT cron.unschedule('load-governor-sample');
-- DROP FUNCTION IF EXISTS marshmallow_private.cron_guarded_sheets_sync();
-- DROP FUNCTION IF EXISTS marshmallow_private.cron_guarded_urgent_ai_refresh();
-- DROP FUNCTION IF EXISTS marshmallow_private.cron_guarded_processor_board_daily();
-- DROP FUNCTION IF EXISTS marshmallow_private.cron_guarded_sheets_watchdog();
-- DROP FUNCTION IF EXISTS marshmallow_private.cron_guarded_schedule_monitor();
-- DROP FUNCTION IF EXISTS marshmallow_private.sample_load();
-- DROP FUNCTION IF EXISTS marshmallow_private.deferrable_job_allowed_now(text);
-- DROP FUNCTION IF EXISTS marshmallow_private.current_load_level();
-- DROP FUNCTION IF EXISTS marshmallow_private.deferrable_job_allowed(text, text, integer, numeric, boolean, integer);
-- DROP FUNCTION IF EXISTS marshmallow_private.decide_load_level(text, numeric[], numeric, marshmallow_private.load_policy);
-- DROP TABLE IF EXISTS marshmallow_private.load_state;
-- DROP TABLE IF EXISTS marshmallow_private.load_samples;
-- DROP TABLE IF EXISTS marshmallow_private.load_policy;
-- COMMIT;
-- Open tabs simply stop hearing "system_load"; their raised level expires
-- by itself within 3 minutes.
-- =============================================================================
