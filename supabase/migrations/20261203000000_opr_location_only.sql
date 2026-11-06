-- =============================================================================
-- Operator (opr) sees only City, State: no address, customer number or technician
-- =============================================================================
-- Purpose (business request 2026-11-06): Operators (role `opr`, NOT `opr_admin`)
-- must see a job's location as "City, ST ZIP" only (ZIP allowed 2026-11-06), never
-- the street address or map position, never the customer's phone/landline, and never the technician's
-- name or number. Most leads have no saved city/state (4,836 of 5,327 on
-- 2026-11-06), so the city/state is derived from the address on the server.
--
-- What this changes:
--   1. public.location_label(leads): "City, ST 12345" (or "ST 12345", or NULL). PostgREST
--      computed field, selected as `location_label`. Saved city/state first; else
--      the state code before the ZIP; the city is the comma part before the state
--      or, when the city is not separated from the street, the longest trailing
--      1-4 words that are a Census place (public.us_places) in that state. It never
--      returns digits or anything from the street segment; unsure -> state only.
--   2. Hold-alert snapshots for `opr` recipients are stored without customer phone,
--      landline, address, technician name/number, with city/state/ZIP from (1).
--      `opr_admin` snapshots are unchanged.
--   3. get_operator_hold_alerts redacts the same fields for an `opr` caller, and
--      existing unread/read `opr` snapshots are redacted in place (hold-alert rows
--      only; no lead rows are changed).
--
-- Not changed: lead rows, lead RLS, opr_admin and every other role, quote hiding,
-- grants on existing objects. NOTE: lead RLS still lets `opr` read lead rows
-- directly; the CRM hides these fields from `opr` at the screen boundary
-- (src/lib/operator-privacy.ts). Server-only enforcement for direct lead reads is
-- a separate, larger change (an Operator-only read path) not made here.
--
-- Apply manually. Harness (isolated): supabase/tests/105_opr_location_only.sql via
-- scripts/test-operator-workflow-db.mjs. Rollback at the end of this file.
-- =============================================================================
BEGIN;

-- The label and hold-alert reads run as the signed-in user and call these private
-- helpers. Production already grants this (checked 2026-11-06), so it is a no-op there.
GRANT USAGE ON SCHEMA marshmallow_private TO authenticated;

-- 1. City/state label -----------------------------------------------------------
-- Census place name without its type suffix ("Sauk Rapids city" -> "Sauk Rapids").
CREATE OR REPLACE FUNCTION marshmallow_private.place_display_name(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT btrim(regexp_replace(p_name,
    '\s+(city and borough|city|town|village|borough|CDP|municipality|plantation|township|comunidad|zona urbana)(\s+\(balance\))?$', '', 'i'));
$$;

-- The best Census place in p_state whose name (without type) equals p_candidate,
-- ignoring case/punctuation and "Saint"/"St". Uses us_places_normalized_name_state_idx.
CREATE OR REPLACE FUNCTION marshmallow_private.match_us_place(p_state text, p_candidate text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
  base text := regexp_replace(lower(coalesce(p_candidate, '')), '[^a-z0-9 ]', '', 'g');
  keys text[]; k text; hit text;
BEGIN
  IF p_state IS NULL OR btrim(base) = '' THEN RETURN NULL; END IF;
  keys := ARRAY[base, regexp_replace(base, '\msaint\M', 'st', 'g'), regexp_replace(base, '\mst\M', 'saint', 'g'),
    regexp_replace(base, '\mmount\M', 'mt', 'g'), regexp_replace(base, '\mmt\M', 'mount', 'g')];
  FOREACH k IN ARRAY keys LOOP
    k := replace(k, ' ', '');
    SELECT marshmallow_private.place_display_name(p.name) INTO hit
    FROM public.us_places p
    WHERE p.state_code = p_state
      AND regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g') = ANY (ARRAY[
        k, k || 'city', k || 'town', k || 'village', k || 'cdp', k || 'borough', k || 'municipality',
        k || 'cityandborough', k || 'plantation', k || 'township', k || 'citybalance'])
    ORDER BY p.population DESC NULLS LAST
    LIMIT 1;
    IF hit IS NOT NULL THEN RETURN hit; END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- A city name safe to show: a Census place when one matches (also after a street
-- word typed in front of it), otherwise the text as written ONLY when it has no
-- digits, no unit and no street word. Anything doubtful -> NULL (state only).
CREATE OR REPLACE FUNCTION marshmallow_private.clean_city(p_state text, p_candidate text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
  cand text := btrim(regexp_replace(coalesce(p_candidate, ''), '\s+', ' ', 'g'), E' \t\r\n,.');
  words text[]; hit text; k int;
BEGIN
  IF cand = '' OR cand ~ '\d' OR length(cand) > 40
     OR cand ~* '^(apt|apartment|suite|ste|unit|bldg|building|lot|floor|fl|room|rm|#|po box|p o box)\M' THEN
    RETURN NULL;
  END IF;
  hit := marshmallow_private.match_us_place(p_state, cand);
  IF hit IS NOT NULL THEN RETURN hit; END IF;
  words := regexp_split_to_array(cand, ' ');
  FOR k IN REVERSE least(3, coalesce(array_length(words, 1), 0) - 1)..1 LOOP
    hit := marshmallow_private.match_us_place(p_state, array_to_string(words[array_length(words, 1) - k + 1 : array_length(words, 1)], ' '));
    IF hit IS NOT NULL THEN RETURN hit; END IF;
  END LOOP;
  IF cand ~* '\m(ave|avenue|dr|drive|ct|court|ln|lane|rd|road|blvd|boulevard|way|hl|hwy|highway|cir|circle|ter|terrace|pl|place|pkwy|parkway|trl|trail|loop|street|apt|suite|unit|box)\M'
     OR cand ~* '\s(st|str)\M' THEN
    RETURN NULL;
  END IF;
  RETURN CASE WHEN cand = upper(cand) OR cand = lower(cand) THEN initcap(lower(cand)) ELSE cand END;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.clean_city(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.clean_city(text, text) TO authenticated, service_role;

-- City, state and ZIP of a lead, never the street. ZIP: the saved ZIP when it is 5
-- digits, else the ZIP at the end of the address. Doubtful parts are NULL.
CREATE OR REPLACE FUNCTION marshmallow_private.location_parts(l public.leads) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
  st text := upper(nullif(btrim(l.state), ''));
  city text := nullif(btrim(l.city), '');
  zip text := substring(coalesce(l.zip_code, '') FROM '^\s*(\d{5})(?:-\d{4})?\s*$');
  a text := btrim(coalesce(l.address, ''));
  m text[]; addr_state text; body text; parts text[]; words text[]; cand text; hit text; n int; k int;
BEGIN
  -- A saved full state name ("Florida") becomes its code.
  IF st IS NOT NULL AND length(st) <> 2 THEN
    SELECT p.state_code INTO st FROM public.us_places p WHERE upper(p.state_name) = st LIMIT 1;
  END IF;
  IF st IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.us_places p WHERE p.state_code = st) THEN st := NULL; END IF;

  a := regexp_replace(a, '[\s,]*(USA|U\.S\.A\.|United States( of America)?|US)\.?\s*$', '', 'i');
  m := regexp_match(a, '(?:^|[\s,])([A-Za-z]{2})\.?[\s,]*(\d{5})(?:-\d{4})?\s*$');
  IF m IS NULL THEN m := regexp_match(a, ',\s*([A-Za-z]{2})\.?\s*()$'); END IF;
  IF m IS NOT NULL AND EXISTS (SELECT 1 FROM public.us_places p WHERE p.state_code = upper(m[1])) THEN
    addr_state := upper(m[1]);
    IF zip IS NULL AND m[2] <> '' THEN zip := m[2]; END IF;
    body := btrim(regexp_replace(a, '(?:^|[\s,])[A-Za-z]{2}\.?(?:[\s,]*\d{5}(?:-\d{4})?)?\s*$', ''), ' ,');
  END IF;
  -- A trailing ZIP without a recognised state still gives the area.
  IF zip IS NULL THEN zip := substring(a FROM '(?:^|[\s,])(\d{5})(?:-\d{4})?\s*$'); END IF;
  IF st IS NULL THEN st := addr_state; END IF;
  -- A saved city passes the same check as one read from the address.
  IF city IS NOT NULL THEN city := marshmallow_private.clean_city(st, city); END IF;

  -- Only read the city from the address when its state is the job's state.
  IF city IS NULL AND st IS NOT NULL AND addr_state = st AND coalesce(body, '') <> '' THEN
    SELECT array_agg(btrim(x, E' \t\r\n')) INTO parts FROM unnest(string_to_array(body, ',')) x WHERE btrim(x, E' \t\r\n') <> '';
    n := coalesce(array_length(parts, 1), 0);
    IF n >= 2 THEN
      -- "street, City, ST 12345": the part before the state.
      city := marshmallow_private.clean_city(st, parts[n]);
    ELSIF n = 1 THEN
      -- "123 Main St Austin, TX 12345": a known place at the end of the street part,
      -- leaving at least one word (the street) before it.
      words := regexp_split_to_array(parts[1], '\s+');
      FOR k IN REVERSE least(4, coalesce(array_length(words, 1), 0) - 1)..1 LOOP
        cand := array_to_string(words[array_length(words, 1) - k + 1 : array_length(words, 1)], ' ');
        CONTINUE WHEN cand ~ '\d';
        hit := marshmallow_private.match_us_place(st, cand);
        IF hit IS NOT NULL THEN city := hit; EXIT; END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN jsonb_build_object('city', city, 'state', st, 'zip', zip);
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.location_parts(public.leads) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.location_parts(public.leads) TO authenticated, service_role;

-- "City, ST 12345" / "ST 12345" / "12345" / NULL. PostgREST computed field.
CREATE OR REPLACE FUNCTION public.location_label(l public.leads) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT nullif(concat_ws(', ', p->>'city', nullif(concat_ws(' ', p->>'state', p->>'zip'), '')), '')
  FROM (SELECT marshmallow_private.location_parts(l) AS p) x;
$$;
REVOKE ALL ON FUNCTION public.location_label(public.leads) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.location_label(public.leads) TO authenticated, service_role;
REVOKE ALL ON FUNCTION marshmallow_private.match_us_place(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.match_us_place(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION marshmallow_private.place_display_name(text) TO authenticated, service_role;

-- 2. Operator-safe snapshot ------------------------------------------------------
-- p_location: location_parts() output ({city,state,zip}).
CREATE OR REPLACE FUNCTION marshmallow_private.opr_safe_hold_snapshot(p_snapshot jsonb, p_location jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT p_snapshot || jsonb_build_object(
    'customer_phone', NULL, 'customer_landline', NULL, 'address', NULL,
    'tech_name', NULL, 'tech_number', NULL,
    'city', p_location->>'city', 'state', p_location->>'state', 'zip_code', p_location->>'zip');
$$;

-- Users who see location only: role opr without opr_admin.
CREATE OR REPLACE FUNCTION marshmallow_private.is_location_only_operator(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role = 'opr'::public.app_role)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role = 'opr_admin'::public.app_role);
$$;
REVOKE ALL ON FUNCTION marshmallow_private.is_location_only_operator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.is_location_only_operator(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.capture_operator_hold_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reason text;
  v_snapshot jsonb;
  v_opr_snapshot jsonb;
BEGIN
  -- This trigger is not an exposed RPC and cannot be called by a browser.
  IF OLD.status = 'urgent_job' AND NEW.status = 'cancellation_requested' THEN
    INSERT INTO marshmallow_private.urgent_cancellation_origins(lead_id) VALUES(NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;

  IF OLD.status = 'urgent_job' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('scheduled','cancelled') THEN
    v_reason := NEW.status;
  ELSIF OLD.status = 'cancellation_requested' AND NEW.status = 'cancelled'
     AND EXISTS (
       SELECT 1 FROM marshmallow_private.urgent_cancellation_origins WHERE lead_id = NEW.id
     ) THEN
    v_reason := 'cancelled';
  ELSIF OLD.status = 'urgent_job' AND NEW.status = 'urgent_job'
     AND NEW.cs_tag IN ('ready_to_schedule','waiting_schedule_confirmation')
     AND NEW.cs_tag IS DISTINCT FROM OLD.cs_tag THEN
    v_reason := NEW.cs_tag;
  END IF;

  IF OLD.status = 'cancellation_requested' AND NEW.status <> 'cancellation_requested' THEN
    DELETE FROM marshmallow_private.urgent_cancellation_origins WHERE lead_id = NEW.id;
  END IF;
  IF v_reason IS NULL THEN RETURN NEW; END IF;

  -- An old "work this urgent job" alert is obsolete once the hold instruction
  -- arrives. Only clear operator recipients' urgent alerts, not other roles.
  UPDATE public.notifications n SET read = true
  WHERE n.lead_id = NEW.id AND n.title = '[Alert] Urgent Job' AND n.read = false
    AND EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = n.user_id
        AND r.role IN ('opr'::public.app_role, 'opr_admin'::public.app_role)
    );

  v_snapshot := jsonb_build_object(
    'job_id', NEW.job_id, 'customer_name', NEW.customer_name,
    'customer_phone', NEW.customer_phone, 'customer_landline', NEW.customer_landline,
    'service_type', NEW.service_type, 'service_details', NEW.service_details,
    'address', NEW.address, 'city', NEW.city, 'state', NEW.state, 'zip_code', NEW.zip_code,
    'customer_schedule_requirements', NEW.customer_schedule_requirements,
    'scheduled_date', NEW.scheduled_date, 'scheduled_time_start', NEW.scheduled_time_start,
    'scheduled_time_end', NEW.scheduled_time_end, 'tech_name', NEW.tech_name,
    'tech_number', NEW.tech_number, 'status', NEW.status, 'cs_tag', NEW.cs_tag,
    'quote', CASE WHEN NEW.show_quote_to_opr IS FALSE THEN NULL ELSE NEW.quote END
  );
  v_opr_snapshot := marshmallow_private.opr_safe_hold_snapshot(v_snapshot, marshmallow_private.location_parts(NEW));

  -- One unread card per user/job is refreshed atomically with a new revision.
  -- Operators (opr) get the location-only snapshot; Operator Admins the full one.
  INSERT INTO public.lead_hold_alerts(user_id, lead_id, reason, snapshot)
  SELECT DISTINCT r.user_id, NEW.id, v_reason,
    CASE WHEN marshmallow_private.is_location_only_operator(r.user_id) THEN v_opr_snapshot ELSE v_snapshot END
  FROM public.user_roles r
  WHERE r.role IN ('opr'::public.app_role, 'opr_admin'::public.app_role)
  ON CONFLICT(user_id, lead_id) WHERE read = false DO UPDATE
  SET reason = EXCLUDED.reason,
      snapshot = EXCLUDED.snapshot,
      revision = gen_random_uuid(),
      created_at = clock_timestamp();

  RETURN NEW;
END;
$$;

-- 3. Reads redact for an opr caller (covers any snapshot stored before this).
CREATE OR REPLACE FUNCTION public.get_operator_hold_alerts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'observed_at', clock_timestamp(),
    'unread_count', (SELECT count(*) FROM public.lead_hold_alerts WHERE read = false),
    'alerts', (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.read, a.created_at DESC), '[]'::jsonb)
      FROM (SELECT id, lead_id, revision, reason,
          CASE WHEN marshmallow_private.is_location_only_operator(auth.uid())
            THEN marshmallow_private.opr_safe_hold_snapshot(snapshot, jsonb_build_object(
              'city', snapshot->>'city', 'state', snapshot->>'state',
              'zip', substring(coalesce(snapshot->>'zip_code', '') FROM '^\s*(\d{5})')))
            ELSE snapshot END AS snapshot,
          read, created_at
        FROM public.lead_hold_alerts ORDER BY read, created_at DESC LIMIT 100) a));
$function$;

-- Stored opr snapshots from before this migration: same redaction, location from the lead.
UPDATE public.lead_hold_alerts h
SET snapshot = marshmallow_private.opr_safe_hold_snapshot(h.snapshot, marshmallow_private.location_parts(l))
FROM public.leads l
WHERE l.id = h.lead_id AND marshmallow_private.is_location_only_operator(h.user_id);

COMMIT;

-- =============================================================================
-- Rollback (manual, reviewed): re-run capture_operator_hold_alert() from
-- 20261121000000_operator_hold_waiting_schedule_confirmation.sql and
-- get_operator_hold_alerts() from 20261012041715_lead_copy_permissions_and_operator_hold_alerts.sql,
-- then DROP FUNCTION public.location_label(public.leads),
-- marshmallow_private.match_us_place(text,text), marshmallow_private.place_display_name(text),
-- marshmallow_private.opr_safe_hold_snapshot(jsonb,jsonb), marshmallow_private.location_parts(public.leads),
-- marshmallow_private.clean_city(text,text),
-- marshmallow_private.is_location_only_operator(uuid) — only after a CRM build
-- that no longer selects location_label is published. Redacted opr snapshots are
-- not restored (they are notifications, not lead data). No lead rows are changed.
-- =============================================================================
