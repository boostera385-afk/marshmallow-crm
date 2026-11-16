-- =============================================================================
-- Migration : 20261226000000_technician_area_cache_refresh_job.sql
-- Applied   : production (kxiqholnmhkwhdkhtopp) 2026-11-16, at the user's request.
-- Purpose   : Keep technician_area_coordinate_cache fresh in the background so
--             coverage previews and lead-coverage refreshes stop doing ~150
--             live area lookups on every call.
--
-- DEFECT (measured read-only 2026-11-16, pg_stat_statements since 2026-11-09)
--   preview_lead_technician_coverage(_at_point) averaged 1.1-1.4 s per call
--   (2,303 calls, ~13.5% of all database time). An EXPLAIN ANALYZE of
--   calculate_lead_technician_coverage() took 1,989 ms, of which 1,912 ms was
--   technician_area_place() over the 632 distinct Areas of active technicians
--   without a stored map point.
--   20261212003000 made an UNRESOLVED cache row retry the live lookup once it
--   is more than a day old, expecting "at most one extra live lookup per day".
--   But technician_area_place() is STABLE and cannot write the cache, and no
--   job ran refresh_technician_area_coordinate_cache() (admin-only, manual).
--   So after the first day every unresolved Area (138) plus every Area never
--   cached (14) is looked up live on EVERY preview and lead coverage refresh.
--   The same 632 Areas answered from the cache alone took 5 ms.
--
-- WHAT THIS DOES
--   1. marshmallow_private.refresh_stale_technician_area_cache(): re-resolves
--      only Areas that are missing from the cache or still unresolved, using
--      technician_area_place_live() (the same lookup the readers use), and
--      upserts them with resolved_at = now(). An Area that still cannot be
--      resolved is stored with NULL coordinates and a fresh resolved_at, which
--      readers already treat as "known unresolvable for a day" (no behaviour
--      change for them: the live lookup returned no point either). Resolved
--      coordinates are never overwritten with NULL.
--   2. marshmallow_private.cron_guarded_technician_area_cache_refresh(): runs
--      it only while the load governor reports 'normal' (skips while raised).
--   3. pg_cron job 'technician-area-cache-refresh' every 6 hours (minute 41),
--      well inside the 1-day window, so unresolved rows never go stale.
--   4. Runs the refresh once now so the effect is immediate.
--   No change to coverage results, technician_area_place(), RLS, grants on
--   public objects, or leads. No UPDATE of public.leads.
--
-- VERIFY : supabase/tests/92_technician_area_cache_refresh.sql (read-only).
--
-- ROLLBACK
--   SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'technician-area-cache-refresh';
--   DROP FUNCTION IF EXISTS marshmallow_private.cron_guarded_technician_area_cache_refresh();
--   DROP FUNCTION IF EXISTS marshmallow_private.refresh_stale_technician_area_cache(integer);
--   (Cache rows written by the refresh are valid lookups and can stay.)
-- =============================================================================

CREATE OR REPLACE FUNCTION marshmallow_private.refresh_stale_technician_area_cache(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH area_names AS (
    SELECT DISTINCT
           btrim(t.area) AS area,
           regexp_replace(lower(btrim(t.area)), '[^a-z0-9]+', '', 'g') AS area_key
      FROM public.technicians t
     WHERE NULLIF(btrim(coalesce(t.area, '')), '') IS NOT NULL
  ),
  targets AS (
    SELECT a.area, a.area_key
      FROM area_names a
      LEFT JOIN public.technician_area_coordinate_cache c ON c.area_key = a.area_key
     WHERE a.area_key <> ''
       AND (c.area_key IS NULL OR c.latitude IS NULL)
  ),
  resolved AS (
    SELECT DISTINCT ON (t.area_key)
           t.area_key, t.area, p.city, p.state_code, p.latitude, p.longitude
      FROM targets t
      LEFT JOIN LATERAL public.technician_area_place_live(t.area) p ON true
     ORDER BY t.area_key, (p.latitude IS NOT NULL) DESC NULLS LAST
     LIMIT greatest(coalesce(p_limit, 1000), 1)
  ),
  upserted AS (
    INSERT INTO public.technician_area_coordinate_cache
           (area_key, area, city, state_code, latitude, longitude, resolved_at)
    SELECT area_key, area, city, state_code, latitude, longitude, now()
      FROM resolved
    ON CONFLICT (area_key) DO UPDATE
       SET area        = EXCLUDED.area,
           city        = COALESCE(EXCLUDED.city, public.technician_area_coordinate_cache.city),
           state_code  = COALESCE(EXCLUDED.state_code, public.technician_area_coordinate_cache.state_code),
           latitude    = COALESCE(EXCLUDED.latitude, public.technician_area_coordinate_cache.latitude),
           longitude   = COALESCE(EXCLUDED.longitude, public.technician_area_coordinate_cache.longitude),
           resolved_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION marshmallow_private.cron_guarded_technician_area_cache_refresh()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  -- Deferrable maintenance: skip while the load governor reports pressure.
  -- Readers keep working meanwhile (they fall back to the live lookup).
  IF marshmallow_private.current_load_level() = 'normal' THEN
    PERFORM marshmallow_private.refresh_stale_technician_area_cache();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION marshmallow_private.refresh_stale_technician_area_cache(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION marshmallow_private.cron_guarded_technician_area_cache_refresh() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION marshmallow_private.refresh_stale_technician_area_cache(integer) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION marshmallow_private.cron_guarded_technician_area_cache_refresh() FROM anon, authenticated;
  END IF;
END $$;

-- Idempotent schedule: replace any earlier job with this name.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'technician-area-cache-refresh';
SELECT cron.schedule(
  'technician-area-cache-refresh',
  '41 */6 * * *',
  $cron$SELECT marshmallow_private.cron_guarded_technician_area_cache_refresh()$cron$
);

-- Heal the cache now instead of waiting for the first run.
SELECT marshmallow_private.refresh_stale_technician_area_cache();
