-- =============================================================================
-- Read-only harness: three follow-up fixes from the November 2026 DB audit
--   - 20261212000000_processor_board_daily_vault_secrets.sql
--   - 20261212001000_webhook_retention_run_status.sql
--   - 20261212003000_technician_area_cache_retry.sql
--
-- Run on the shared project AFTER applying all three, in the Supabase SQL
-- Editor as postgres. It only SELECTs: no rows, jobs, settings or Vault
-- secrets change. Every row must say PASS.
-- =============================================================================
WITH vault_secrets AS (
  SELECT format('vault secret present: %s', name) AS check_name,
         EXISTS (SELECT 1 FROM vault.decrypted_secrets v WHERE v.name = name) AS ok
    FROM (VALUES ('processor_board_daily_project_url'), ('processor_board_daily_cron_secret')) t(name)
),
retention_status AS (
  SELECT 'webhook_retention_state row present' AS check_name,
         EXISTS (SELECT 1 FROM marshmallow_private.webhook_retention_state WHERE id) AS ok
  UNION ALL SELECT 'signed-in users cannot read webhook_retention_state or call the recorder',
         NOT has_table_privilege('authenticated', 'marshmallow_private.webhook_retention_state', 'select')
         AND NOT has_function_privilege('authenticated', 'public.record_webhook_retention_run(jsonb)', 'execute')
         AND NOT has_function_privilege('anon', 'public.record_webhook_retention_run(jsonb)', 'execute')
  UNION ALL SELECT 'service_role can call the recorder',
         has_function_privilege('service_role', 'public.record_webhook_retention_run(jsonb)', 'execute')
),
cache_retry AS (
  SELECT 'technician_area_place_live() exists' AS check_name,
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'technician_area_place_live') AS ok
  UNION ALL SELECT 'technician_area_place() falls through to the live lookup',
         pg_get_functiondef('public.technician_area_place(text)'::regprocedure) LIKE '%technician_area_place_live%'
  UNION ALL SELECT 'refresh_technician_area_coordinate_cache() bypasses the cache (calls the live lookup directly)',
         pg_get_functiondef('public.refresh_technician_area_coordinate_cache()'::regprocedure) LIKE '%technician_area_place_live%'
  UNION ALL SELECT 'anon/public still cannot call either placement function',
         NOT has_function_privilege('anon', 'public.technician_area_place(text)', 'execute')
         AND NOT has_function_privilege('anon', 'public.technician_area_place_live(text)', 'execute')
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, check_name
FROM (SELECT * FROM vault_secrets UNION ALL SELECT * FROM retention_status UNION ALL SELECT * FROM cache_retry) all_checks
UNION ALL
SELECT 'INFO', format('webhook retention: last_run_at %s, last_ok %s, consecutive_failures %s, last_success_at %s',
  s.last_run_at, s.last_ok, s.consecutive_failures, s.last_success_at)
FROM marshmallow_private.webhook_retention_state s WHERE s.id
UNION ALL
SELECT 'INFO', format('technician areas cached unresolved (now eligible to retry after 1 day): %s of %s cached',
  count(*) FILTER (WHERE latitude IS NULL), count(*))
FROM public.technician_area_coordinate_cache;
