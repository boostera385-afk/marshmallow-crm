-- =============================================================================
-- Read-only harness: technician Area cache refresh job
--   (supabase/migrations/20261226000000_technician_area_cache_refresh_job.sql)
--
-- HOW TO RUN
--   Paste into the SQL Editor and run. READ-ONLY: no writes, safe on the shared
--   project. Every row is PASS or FAIL; any FAIL is a defect.
--
-- Result on production right after applying (2026-11-16): all PASS.
--   Before: calculate_lead_technician_coverage() 1,989 ms (152 live lookups).
--   After:  47.6 ms; refresh job 3.5 s per run, every 6 hours.
-- =============================================================================

WITH active_areas AS (
  SELECT DISTINCT btrim(t.area) AS area,
         regexp_replace(lower(btrim(t.area)), '[^a-z0-9]+', '', 'g') AS area_key
    FROM public.technicians t
   WHERE coalesce(t.is_active, true)
     AND (t.latitude IS NULL OR t.longitude IS NULL)
     AND NULLIF(btrim(coalesce(t.area, '')), '') IS NOT NULL
),
checks(label, ok) AS (
  SELECT 'cron job technician-area-cache-refresh is scheduled and active',
         EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'technician-area-cache-refresh' AND active
                    AND command ILIKE '%cron_guarded_technician_area_cache_refresh%')
  UNION ALL
  SELECT 'every active technician Area without a map point is cached',
         NOT EXISTS (SELECT 1 FROM active_areas a
                       LEFT JOIN public.technician_area_coordinate_cache c ON c.area_key = a.area_key
                      WHERE c.area_key IS NULL)
  UNION ALL
  -- Readers retry an unresolved row live once it is more than a day old; the
  -- 6-hourly job must keep that from happening (allow for a skipped run).
  SELECT 'no unresolved cache row is old enough to force live lookups',
         NOT EXISTS (SELECT 1 FROM active_areas a
                       JOIN public.technician_area_coordinate_cache c ON c.area_key = a.area_key
                      WHERE c.latitude IS NULL AND c.resolved_at < now() - interval '1 day')
  UNION ALL
  SELECT 'app users cannot run the refresh directly',
         NOT has_function_privilege('authenticated', 'marshmallow_private.refresh_stale_technician_area_cache(integer)', 'EXECUTE')
         AND NOT has_function_privilege('anon', 'marshmallow_private.cron_guarded_technician_area_cache_refresh()', 'EXECUTE')
  UNION ALL
  -- Slow (~3 s): compares every cached point with a fresh live lookup, so the
  -- cache can never change a coverage result.
  SELECT 'cached points equal a live lookup for every active Area',
         NOT EXISTS (SELECT 1 FROM active_areas a
                       LEFT JOIN public.technician_area_coordinate_cache c ON c.area_key = a.area_key
                       LEFT JOIN LATERAL public.technician_area_place_live(a.area) l ON true
                      WHERE c.latitude IS DISTINCT FROM l.latitude
                         OR c.longitude IS DISTINCT FROM l.longitude)
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, label FROM checks ORDER BY ok, label;
