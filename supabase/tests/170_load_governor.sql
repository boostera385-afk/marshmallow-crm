-- =============================================================================
-- Read-only harness: load governor (20261210010000_load_governor.sql)
--
-- Run on the shared project AFTER applying the migration, in the Supabase SQL
-- Editor as postgres. It only SELECTs: no rows, jobs or settings change.
-- Every row must say PASS. The full behavioural test (sensor loop, broadcasts,
-- wrappers) runs on a throwaway database: 171_leads_rls_and_load_governor_isolated.sql.
-- =============================================================================
WITH pol AS (SELECT p FROM marshmallow_private.load_policy p WHERE p.id),
decide AS (
  SELECT 'decide: ' || label AS check_name,
         marshmallow_private.decide_load_level(cur, arr, conn, (SELECT p FROM pol)) = want AS ok
  FROM (VALUES
    ('two minutes >=50 -> elevated', 'normal', '{55,60}'::numeric[], 0::numeric, 'elevated'),
    ('two minutes >=80 -> critical', 'normal', '{85,90}', 0, 'critical'),
    ('one hot minute is not enough', 'normal', '{90}', 0, 'normal'),
    ('elevated holds until clearly calm', 'elevated', '{40,60}', 0, 'elevated'),
    ('recovers after 3 calm minutes', 'critical', '{30,20,10}', 0, 'normal'),
    ('connections >=70% -> elevated', 'normal', '{10,10}', 75, 'elevated'),
    ('unknown minute never escalates', 'normal', '{NULL,90}', 0, 'normal')
  ) t(label, cur, arr, conn, want)
),
allowed AS (
  SELECT format('allowed: %s @ %s', job, lvl) AS check_name,
         marshmallow_private.deferrable_job_allowed(job, lvl, minute, 60, true, 10) = want AS ok
  FROM (VALUES
    ('sheets_sync', 'normal', 3, true), ('sheets_sync', 'elevated', 3, false), ('sheets_sync', 'elevated', 5, true),
    ('sheets_sync', 'critical', 5, false), ('urgent_ai_refresh', 'elevated', 0, false),
    ('processor_board_daily', 'elevated', 0, false), ('sheets_watchdog', 'elevated', 0, false),
    ('schedule_monitor', 'elevated', 0, true), ('schedule_monitor', 'critical', 0, false)
  ) t(job, lvl, minute, want)
),
config AS (
  SELECT 'policy row present, shedding enabled' AS check_name,
         EXISTS (SELECT 1 FROM marshmallow_private.load_policy WHERE id AND shedding_enabled) AS ok
  UNION ALL SELECT 'sampler scheduled every minute',
         EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'load-governor-sample' AND schedule = '* * * * *'
                   AND command = 'SELECT marshmallow_private.sample_load()' AND active)
  UNION ALL SELECT 'deferrable jobs call guarded wrappers on their old schedules',
         (SELECT count(*) FROM cron.job WHERE (jobname, schedule, command) IN (
            ('google-sheets-outbox-worker', '* * * * *', 'SELECT marshmallow_private.cron_guarded_sheets_sync()'),
            ('urgent-ai-status-refresh', '*/30 * * * *', 'SELECT marshmallow_private.cron_guarded_urgent_ai_refresh()'),
            ('processor-board-daily-check', '*/5 * * * *', 'SELECT marshmallow_private.cron_guarded_processor_board_daily()'),
            ('sheets-sync-watchdog', '*/5 * * * *', 'SELECT marshmallow_private.cron_guarded_sheets_watchdog()'),
            ('schedule-confirmation-monitor', '* * * * *', 'SELECT marshmallow_private.cron_guarded_schedule_monitor()'))) = 5
  UNION ALL SELECT 'notifications retention untouched',
         EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notifications-retention'
                   AND command = 'SELECT marshmallow_private.purge_old_notifications(30)')
  UNION ALL SELECT 'signed-in users cannot read samples or run the sensor',
         NOT has_table_privilege('authenticated', 'marshmallow_private.load_samples', 'select')
         AND NOT has_table_privilege('authenticated', 'marshmallow_private.load_policy', 'select')
         AND NOT has_function_privilege('authenticated', 'marshmallow_private.sample_load()', 'execute')
  UNION ALL SELECT 'sensor has sampled in the last 3 minutes (wait 2 minutes after applying)',
         EXISTS (SELECT 1 FROM marshmallow_private.load_samples WHERE sampled_at > now() - interval '3 minutes')
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, check_name
FROM (SELECT * FROM decide UNION ALL SELECT * FROM allowed UNION ALL SELECT * FROM config) all_checks
UNION ALL
SELECT 'INFO', format('current level %s since %s; last sample %s; busy %s%%',
  s.level, s.changed_at, s.sampled_at,
  (SELECT busy_pct FROM marshmallow_private.load_samples ORDER BY sampled_at DESC LIMIT 1))
FROM marshmallow_private.load_state s WHERE s.id;
