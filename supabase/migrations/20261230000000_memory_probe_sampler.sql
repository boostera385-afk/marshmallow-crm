-- =============================================================================
-- Migration : 20261230000000_memory_probe_sampler.sql
-- Purpose   : Temporary, read-only diagnostic. Find what uses the 2 GB host's
--             memory during busy hours.
--
-- WHY
--   marshmallow_private.health_samples (system-health-watch) already records
--   the host's free memory / swap / CPU every minute. On 2026-11-16 free memory
--   fell from ~56% (quiet) to 19-39% between 13:00 and 21:00 UTC, but nothing
--   records WHAT grew. This samples, every minute, the database-side drivers:
--   connections per owner (PostgREST, Realtime, pooler, other) by state,
--   Realtime postgres_changes subscriptions per table, cumulative temp-file
--   spill, and the longest running query's duration and owner. No query text,
--   no customer data.
--
-- SAFETY / COST
--   One catalog read per minute (pg_stat_activity, realtime.subscription,
--   pg_stat_database). Never writes to app tables. It stops itself: after
--   probe_until it unschedules its own cron job. Samples older than 7 days are
--   deleted by the sampler. Not readable by anon/authenticated.
--
-- REPORT (10-minute buckets joined to the host's memory):
--   SELECT * FROM marshmallow_private.memory_probe_report(now() - interval '1 day', now());
--
-- APPLY: idempotent. Re-running restarts the 48-hour window.
--
-- ROLLBACK
--   SELECT cron.unschedule('memory-probe-sample')
--     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'memory-probe-sample');
--   DROP FUNCTION IF EXISTS marshmallow_private.memory_probe_report(timestamptz, timestamptz);
--   DROP FUNCTION IF EXISTS marshmallow_private.sample_memory_probe();
--   DROP TABLE IF EXISTS marshmallow_private.memory_probe_samples;
--   DROP TABLE IF EXISTS marshmallow_private.memory_probe_policy;
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS marshmallow_private.memory_probe_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  probe_until timestamptz NOT NULL
);
INSERT INTO marshmallow_private.memory_probe_policy (id, probe_until)
VALUES (true, now() + interval '48 hours')
ON CONFLICT (id) DO UPDATE SET probe_until = EXCLUDED.probe_until;

CREATE TABLE IF NOT EXISTS marshmallow_private.memory_probe_samples (
  sampled_at timestamptz PRIMARY KEY,
  total_conns integer NOT NULL,
  active_conns integer NOT NULL,
  idle_in_tx_conns integer NOT NULL,
  postgrest_conns integer NOT NULL,
  postgrest_active integer NOT NULL,
  realtime_conns integer NOT NULL,
  pooler_conns integer NOT NULL,
  other_conns integer NOT NULL,
  realtime_subscriptions integer,
  realtime_subs_by_table jsonb,
  temp_bytes_total bigint,
  longest_active_seconds numeric,
  longest_active_app text
);

REVOKE ALL ON marshmallow_private.memory_probe_policy, marshmallow_private.memory_probe_samples
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.sample_memory_probe()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_until timestamptz;
  v_subs integer;
  v_by_table jsonb;
BEGIN
  SELECT probe_until INTO v_until FROM marshmallow_private.memory_probe_policy WHERE id;
  IF v_until IS NULL OR now() > v_until THEN
    PERFORM cron.unschedule('memory-probe-sample')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'memory-probe-sample');
    RETURN;
  END IF;

  BEGIN
    SELECT coalesce(sum(n), 0)::integer, coalesce(jsonb_object_agg(t, n), '{}'::jsonb)
      INTO v_subs, v_by_table
      FROM (SELECT s.entity::regclass::text AS t, count(*) AS n
              FROM realtime.subscription s GROUP BY 1) x;
  EXCEPTION WHEN OTHERS THEN
    v_subs := NULL; v_by_table := NULL;  -- realtime schema unavailable: record unknown, not zero
  END;

  INSERT INTO marshmallow_private.memory_probe_samples
  SELECT date_trunc('minute', now()),
         count(*),
         count(*) FILTER (WHERE a.state = 'active' AND a.pid <> pg_backend_pid()),
         count(*) FILTER (WHERE a.state LIKE 'idle in transaction%'),
         count(*) FILTER (WHERE a.application_name LIKE 'PostgREST%'),
         count(*) FILTER (WHERE a.application_name LIKE 'PostgREST%' AND a.state = 'active'),
         count(*) FILTER (WHERE a.application_name LIKE 'realtime%'),
         count(*) FILTER (WHERE a.usename IN ('pgbouncer', 'supavisor') OR a.application_name ILIKE '%supavisor%'),
         count(*) FILTER (WHERE a.application_name NOT LIKE 'PostgREST%' AND a.application_name NOT LIKE 'realtime%'
                            AND coalesce(a.usename, '') NOT IN ('pgbouncer', 'supavisor')),
         v_subs,
         v_by_table,
         (SELECT d.temp_bytes FROM pg_stat_database d WHERE d.datname = current_database()),
         (SELECT round(extract(epoch FROM now() - min(b.query_start))::numeric, 1)
            FROM pg_stat_activity b WHERE b.state = 'active' AND b.backend_type = 'client backend' AND b.pid <> pg_backend_pid()),
         (SELECT b.application_name FROM pg_stat_activity b
           WHERE b.state = 'active' AND b.backend_type = 'client backend' AND b.pid <> pg_backend_pid()
           ORDER BY b.query_start LIMIT 1)
    FROM pg_stat_activity a
   WHERE a.backend_type = 'client backend'
  ON CONFLICT (sampled_at) DO NOTHING;

  DELETE FROM marshmallow_private.memory_probe_samples WHERE sampled_at < now() - interval '7 days';
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.sample_memory_probe() FROM PUBLIC, anon, authenticated;

-- 10-minute buckets: host memory (from health_samples) next to the drivers.
CREATE OR REPLACE FUNCTION marshmallow_private.memory_probe_report(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  bucket timestamptz,
  mem_available_pct numeric,
  min_mem_available_pct numeric,
  swap_used_pct numeric,
  avg_conns numeric,
  max_conns integer,
  avg_active numeric,
  max_postgrest integer,
  max_realtime_conns integer,
  avg_realtime_subs numeric,
  max_realtime_subs integer,
  temp_mb_spilled numeric,
  max_query_seconds numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH p AS (
    SELECT date_bin('10 minutes', sampled_at, timestamptz '2026-01-01') AS b, *
      FROM marshmallow_private.memory_probe_samples
     WHERE sampled_at >= p_from AND sampled_at < p_to
  ), h AS (
    SELECT date_bin('10 minutes', sampled_at, timestamptz '2026-01-01') AS b,
           avg(mem_available_pct) AS mem, min(mem_available_pct) AS mem_min, max(swap_used_pct) AS swap
      FROM marshmallow_private.health_samples
     WHERE sampled_at >= p_from AND sampled_at < p_to AND metrics_ok
     GROUP BY 1
  ), agg AS (
    SELECT b,
           round(avg(total_conns), 1) AS avg_conns, max(total_conns) AS max_conns,
           round(avg(active_conns), 1) AS avg_active, max(postgrest_conns) AS max_postgrest,
           max(realtime_conns) AS max_realtime_conns,
           round(avg(realtime_subscriptions), 1) AS avg_subs, max(realtime_subscriptions) AS max_subs,
           round((max(temp_bytes_total) - min(temp_bytes_total)) / 1048576.0, 1) AS temp_mb,
           max(longest_active_seconds) AS max_q
      FROM p GROUP BY b
  )
  SELECT agg.b, round(h.mem, 1), round(h.mem_min, 1), round(h.swap, 1),
         agg.avg_conns, agg.max_conns, agg.avg_active, agg.max_postgrest, agg.max_realtime_conns,
         agg.avg_subs, agg.max_subs, agg.temp_mb, agg.max_q
    FROM agg LEFT JOIN h ON h.b = agg.b
   ORDER BY agg.b;
$$;
REVOKE ALL ON FUNCTION marshmallow_private.memory_probe_report(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('memory-probe-sample')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'memory-probe-sample');
SELECT cron.schedule('memory-probe-sample', '* * * * *', 'SELECT marshmallow_private.sample_memory_probe()');

COMMIT;
