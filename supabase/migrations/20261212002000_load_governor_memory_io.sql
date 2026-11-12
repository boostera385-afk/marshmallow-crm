-- =============================================================================
-- Migration : 20261212002000_load_governor_memory_io.sql
-- Purpose   : Give the load governor the memory/IO-wait blind spot it was
--             missing - it only ever looked at query execution time and
--             connection count.
--
-- DEFECT
--   marshmallow_private.decide_load_level() (20261210010000_load_governor.sql)
--   takes only recent busy-% and connection-% - never memory, swap or disk
--   IO wait, even though marshmallow_private.health_samples
--   (20261210040000_system_health_alerts.sql) already records exactly those
--   every minute. A stored sample from the 2026-11-09 incident shows 82.8% IO
--   wait while CPU/query-busy was only 9.7% - a pattern this governor could
--   not have reacted to, because it never looked.
--
-- WHAT THIS DOES
--   - decide_load_level() gains four OPTIONAL trailing parameters (default
--     NULL): p_mem_available_pct, p_iowait_pct, p_mem_elevated_pct,
--     p_iowait_elevated_pct. Called with just the original 4 arguments (as
--     supabase/tests/170_load_governor.sql still does), behavior is BYTE FOR
--     BYTE unchanged - this is why the function is DROPped and recreated with
--     defaults rather than just adding required params.
--   - sample_load() now reads the most recent health_samples row (if any,
--     within 5 minutes) and health_policy's own mem_available_warn_pct /
--     iowait_warn_pct thresholds (reused, not duplicated into load_policy),
--     and passes them through. Memory/IO pressure can now push the level to
--     "elevated" (shedding deferrable jobs) the same way high query-busy-%
--     already does. It never pushes straight to "critical" on its own - that
--     stays reserved for sustained query-busy-%, matching the existing
--     hysteresis design.
--   - If health_samples has no recent row (system-health-watch down, or this
--     migration applied before 20261210040000 was functioning), mem/io are
--     NULL and the decision is exactly what it was before: fails safe, same
--     philosophy as "no sample for 10 minutes -> normal" already documented
--     in current_load_level().
--
-- NOT CHANGED: load_policy columns, cron schedules, guarded wrappers, the
-- broadcast to open tabs (still {level, busy_pct, changed_at}), health_samples
-- itself, any notification.
--
-- APPLY: Supabase SQL Editor as postgres, after 20261210040000_system_health_alerts.sql.
--        Idempotent. Afterwards re-run supabase/tests/170_load_governor.sql -
--        every row must say PASS, including the new memory/IO cases appended
--        to it in this same change.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS marshmallow_private.decide_load_level(text, numeric[], numeric, marshmallow_private.load_policy, numeric, numeric, numeric, numeric);
--   -- then re-create the original 4-parameter decide_load_level() from
--   -- 20261210010000_load_governor.sql, and revert sample_load() to the body
--   -- in that same file (it no longer reads health_samples/health_policy).
-- =============================================================================

BEGIN;

-- Postgres treats a changed parameter list as a different function, so the
-- original 4-parameter overload is dropped explicitly rather than relying on
-- CREATE OR REPLACE (which would just add a second overload alongside it).
DROP FUNCTION IF EXISTS marshmallow_private.decide_load_level(text, numeric[], numeric, marshmallow_private.load_policy);

CREATE FUNCTION marshmallow_private.decide_load_level(
  p_current text, p_recent_busy_pct numeric[], p_connections_pct numeric,
  p_policy marshmallow_private.load_policy,
  p_mem_available_pct numeric DEFAULT NULL,
  p_iowait_pct numeric DEFAULT NULL,
  p_mem_elevated_pct numeric DEFAULT NULL,
  p_iowait_elevated_pct numeric DEFAULT NULL)
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
  mem_elevated boolean := p_mem_available_pct IS NOT NULL AND p_mem_elevated_pct IS NOT NULL
    AND p_mem_available_pct <= p_mem_elevated_pct;
  io_elevated boolean := p_iowait_pct IS NOT NULL AND p_iowait_elevated_pct IS NOT NULL
    AND p_iowait_pct >= p_iowait_elevated_pct;
BEGIN
  all_at_least_critical := n >= p_policy.critical_minutes AND NOT EXISTS (
    SELECT 1 FROM unnest(p_recent_busy_pct[1:p_policy.critical_minutes]) v WHERE v IS NULL OR v < p_policy.critical_pct);
  all_at_least_elevated := n >= p_policy.elevated_minutes AND NOT EXISTS (
    SELECT 1 FROM unnest(p_recent_busy_pct[1:p_policy.elevated_minutes]) v WHERE v IS NULL OR v < p_policy.elevated_pct);
  all_below_normal := n >= p_policy.recover_minutes AND NOT EXISTS (
    SELECT 1 FROM unnest(p_recent_busy_pct[1:p_policy.recover_minutes]) v WHERE v IS NOT NULL AND v >= p_policy.normal_pct);

  IF all_at_least_critical THEN
    RETURN 'critical';
  ELSIF all_at_least_elevated OR coalesce(p_connections_pct, 0) >= p_policy.connections_elevated_pct
        OR mem_elevated OR io_elevated THEN
    RETURN 'elevated';
  ELSIF coalesce(p_current, 'normal') <> 'normal' AND NOT all_below_normal THEN
    RETURN 'elevated';            -- hysteresis: hold until clearly recovered
  END IF;
  RETURN 'normal';
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.decide_load_level(text, numeric[], numeric, marshmallow_private.load_policy, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;

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
  mem_pct numeric;
  io_pct numeric;
  mem_warn numeric;
  io_warn numeric;
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

  -- Memory/IO pressure the health watcher already samples (marshmallow_private
  -- .health_samples / .health_policy). Stale or absent -> NULL -> no effect,
  -- same fail-safe philosophy as the query-busy sensor going stale.
  SELECT h.mem_available_pct, h.iowait_pct INTO mem_pct, io_pct
    FROM marshmallow_private.health_samples h
   WHERE h.sampled_at > now_ts - interval '5 minutes'
   ORDER BY h.sampled_at DESC LIMIT 1;
  SELECT hp.mem_available_warn_pct, hp.iowait_warn_pct INTO mem_warn, io_warn
    FROM marshmallow_private.health_policy hp WHERE hp.id;

  next_level := marshmallow_private.decide_load_level(
    st.level, recent, conns * 100.0 / greatest(maxc, 1), pol,
    mem_pct, io_pct, mem_warn, io_warn);

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

COMMIT;
