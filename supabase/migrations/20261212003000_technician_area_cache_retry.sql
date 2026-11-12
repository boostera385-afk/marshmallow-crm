-- =============================================================================
-- Migration : 20261212003000_technician_area_cache_retry.sql
-- Purpose   : Let an unresolved technician Area coordinate heal instead of
--             staying NULL forever.
--
-- DEFECT
--   technician_area_place() (20261119000100_stop_coverage_timeout_blocking_lead_writes.sql)
--   checks technician_area_coordinate_cache by area_key and returns on ANY
--   cache hit, including one whose latitude/longitude are NULL from a failed
--   first lookup. That NULL is then permanent: even
--   refresh_technician_area_coordinate_cache() - the function that exists
--   specifically to re-resolve Areas - calls technician_area_place() per Area,
--   which immediately re-serves the same cached NULL instead of trying again.
--   Of 1,253 cached Areas, 1,002 have resolved coordinates - the remaining
--   ~251 can never resolve even after us_places/us_place_coordinates data is
--   extended, which is consistent with the coverage-preview audit's observed
--   uncached/unresolved gap.
--
-- WHAT THIS DOES
--   - Splits the live lookup out of technician_area_place() into
--     technician_area_place_live(), unchanged logic, no cache involved.
--   - technician_area_place() keeps serving a resolved cache hit immediately
--     (no behavior change there - the lead-write hot path this migration's
--     parent was built to protect is untouched). An UNRESOLVED hit is now
--     retried live, but only once the cached row is more than a day old -
--     a genuinely unresolvable Area still costs at most one extra live lookup
--     per day, not one per lead write.
--   - refresh_technician_area_coordinate_cache() - the explicit, admin-
--     triggered maintenance action - now calls technician_area_place_live()
--     directly, bypassing the cache entirely, so running it always actually
--     retries every unresolved Area, which is what an admin invoking "refresh"
--     expects to happen.
--
-- NOT CHANGED: the cache table, its RLS/grants, the initial backfill insert
-- from the parent migration (one-time, ran against an empty cache already),
-- trg_lead_coverage_refresh(), the 5s statement_timeout guard.
--
-- APPLY: Supabase SQL Editor as postgres. Idempotent (CREATE OR REPLACE only).
--        After applying, consider running
--        SELECT public.refresh_technician_area_coordinate_cache();
--        once (Admin only) to retry the currently-stuck unresolved Areas
--        immediately rather than waiting on individual lead writes.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.technician_area_place_live(text);
--   -- then re-apply technician_area_place() and
--   -- refresh_technician_area_coordinate_cache() bodies from
--   -- 20261119000100_stop_coverage_timeout_blocking_lead_writes.sql.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.technician_area_place_live(_area text)
 RETURNS TABLE(city text, state_code text, latitude double precision, longitude double precision)
 LANGUAGE plpgsql
 STABLE
 SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_text       text := btrim(coalesce(_area, ''));
  v_state      text;
  v_lat        double precision;
  v_lng        double precision;
  v_candidate  text;
  v_stripped   text;
  v_state_name text;
BEGIN
  IF v_text = '' THEN
    RETURN;
  END IF;

  v_state := public.us_state_code(v_text);
  v_candidate := btrim(split_part(v_text, ',', 1));

  SELECT p.latitude, p.longitude
    INTO v_lat, v_lng
    FROM public.us_place_coordinates(v_candidate, v_state) p;

  IF v_lat IS NULL AND v_state IS NOT NULL THEN
    SELECT p.state_name
      INTO v_state_name
      FROM public.us_places p
     WHERE p.state_code = v_state
       AND p.state_name IS NOT NULL
     ORDER BY p.name
     LIMIT 1;

    v_stripped := v_candidate;
    IF v_state_name IS NOT NULL THEN
      v_stripped := btrim(regexp_replace(v_stripped, '\s+' || v_state_name || '\s*$', '', 'i'));
    END IF;
    v_stripped := btrim(regexp_replace(v_stripped, '\s+[A-Za-z]{2}\s*$', ''));

    IF v_stripped <> '' AND v_stripped <> v_candidate THEN
      SELECT p.latitude, p.longitude
        INTO v_lat, v_lng
        FROM public.us_place_coordinates(v_stripped, v_state) p;

      IF v_lat IS NOT NULL THEN
        v_candidate := v_stripped;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT nullif(v_candidate, ''), v_state, v_lat, v_lng;
END;
$fn$;
REVOKE ALL ON FUNCTION public.technician_area_place_live(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.technician_area_place(_area text)
 RETURNS TABLE(city text, state_code text, latitude double precision, longitude double precision)
 LANGUAGE plpgsql
 STABLE
 SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_text        text := btrim(coalesce(_area, ''));
  v_key         text;
  v_city        text;
  v_state       text;
  v_lat         double precision;
  v_lng         double precision;
  v_resolved_at timestamptz;
  v_cached      boolean := false;
BEGIN
  IF v_text = '' THEN
    RETURN;
  END IF;

  v_key := regexp_replace(lower(v_text), '[^a-z0-9]+', '', 'g');

  SELECT c.city, c.state_code, c.latitude, c.longitude, c.resolved_at, true
    INTO v_city, v_state, v_lat, v_lng, v_resolved_at, v_cached
    FROM public.technician_area_coordinate_cache c
   WHERE c.area_key = v_key;

  -- A resolved hit is always reused. An unresolved (NULL-coordinate) hit is
  -- reused for a day too, so a genuinely unresolvable Area cannot retry a
  -- live lookup on every lead write - the statement-timeout risk this cache
  -- exists to prevent. Past that day it is retried, so new us_places data or
  -- a fixed spelling can heal it without waiting for an admin refresh.
  IF v_cached AND (v_lat IS NOT NULL OR v_resolved_at >= now() - interval '1 day') THEN
    RETURN QUERY SELECT v_city, v_state, v_lat, v_lng;
    RETURN;
  END IF;

  RETURN QUERY SELECT * FROM public.technician_area_place_live(v_text);
END;
$fn$;
REVOKE ALL ON FUNCTION public.technician_area_place(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.refresh_technician_area_coordinate_cache()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  WITH resolved AS (
    SELECT DISTINCT ON (regexp_replace(lower(btrim(coalesce(t.area, ''))), '[^a-z0-9]+', '', 'g'))
           regexp_replace(lower(btrim(coalesce(t.area, ''))), '[^a-z0-9]+', '', 'g') AS area_key,
           btrim(t.area) AS area,
           p.city, p.state_code, p.latitude, p.longitude
      FROM public.technicians t
      -- Bypasses technician_area_place()'s cache on purpose: this is the
      -- explicit retry action, not the lead-write hot path.
      CROSS JOIN LATERAL public.technician_area_place_live(t.area) p
     WHERE NULLIF(btrim(coalesce(t.area, '')), '') IS NOT NULL
     ORDER BY regexp_replace(lower(btrim(coalesce(t.area, ''))), '[^a-z0-9]+', '', 'g'),
              (p.latitude IS NOT NULL) DESC NULLS LAST
  ), upserted AS (
    INSERT INTO public.technician_area_coordinate_cache (area_key, area, city, state_code, latitude, longitude, resolved_at)
    SELECT area_key, area, city, state_code, latitude, longitude, now() FROM resolved
    ON CONFLICT (area_key) DO UPDATE
       SET area        = EXCLUDED.area,
           city        = EXCLUDED.city,
           state_code  = EXCLUDED.state_code,
           latitude    = COALESCE(EXCLUDED.latitude, public.technician_area_coordinate_cache.latitude),
           longitude   = COALESCE(EXCLUDED.longitude, public.technician_area_coordinate_cache.longitude),
           resolved_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;

  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refresh_technician_area_coordinate_cache() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_technician_area_coordinate_cache() TO authenticated;

COMMIT;
