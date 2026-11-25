-- Purpose: record, for every Marshmallow lead, whether the customer was already
-- a JellyBean lead when Marshmallow added them, and which JellyBean department
-- (ND = Nextdoor, FB = Facebook, SEO, Other) brought them in. Powers the
-- Admin-only "Leads by Department" Analytics section.
--
-- How it works:
--   * lead_jellybean_matches holds one row per checked lead. No row = pending.
--   * Every minute, cron runs dispatch_jellybean_match(). Only when a lead is
--     pending does it call the jellybean-match-leads Edge worker, which asks
--     JellyBean's marshmallow-lead-lookup function (shared secret) and saves the
--     answer. Leads from the CRM, Donut, or any other path are all covered,
--     and existing leads are backfilled the same way (newest first).
--   * Changing a lead's phone or landline deletes its match row, so it is
--     checked again. leads itself is never written.
--   * Department rule (owner decision 2026-11-25): the LATEST JellyBean lead
--     created at or before the Marshmallow lead's created_at, by phone.
--
-- Security: matches are readable by Admin only; writes are service_role only.
-- The cron->worker credential is generated here into Vault and never leaves
-- the database; the worker checks it via jellybean_match_worker_authorized().
-- The cross-project secret (JELLYBEAN_LOOKUP_SECRET here,
-- MARSHMALLOW_LOOKUP_SECRET on JellyBean) is an Edge secret set by an Admin.
--
-- Harness: supabase/tests/191_jellybean_lead_departments.sql via
--   scripts/test-jellybean-departments-db.mjs (isolated embedded Postgres).
BEGIN;
CREATE SCHEMA IF NOT EXISTS marshmallow_private;

CREATE TABLE IF NOT EXISTS public.lead_jellybean_matches (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  match_status text NOT NULL CHECK (match_status IN ('matched', 'not_found', 'no_phone')),
  department text CHECK (department IN ('ND', 'FB', 'SEO', 'Other')),
  jellybean_lead_id uuid,
  jellybean_created_at timestamptz,
  source_role text,
  matched_phone text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_jellybean_matches_department_when_matched
    CHECK ((match_status = 'matched') = (department IS NOT NULL))
);
COMMENT ON TABLE public.lead_jellybean_matches IS
  'Whether each lead was already a JellyBean lead (by phone) when it was added, and which JellyBean department. Written only by the jellybean-match-leads worker (service role). No row = not checked yet.';

ALTER TABLE public.lead_jellybean_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_jellybean_matches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_jellybean_matches TO authenticated;
GRANT ALL ON public.lead_jellybean_matches TO service_role;
DROP POLICY IF EXISTS "Admins read JellyBean matches" ON public.lead_jellybean_matches;
CREATE POLICY "Admins read JellyBean matches" ON public.lead_jellybean_matches
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

-- A phone/landline edit makes the saved answer stale: drop it so it is re-checked.
CREATE OR REPLACE FUNCTION marshmallow_private.reset_jellybean_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.lead_jellybean_matches WHERE lead_id = NEW.id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.reset_jellybean_match() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS leads_reset_jellybean_match ON public.leads;
CREATE TRIGGER leads_reset_jellybean_match
  AFTER UPDATE OF customer_phone, customer_landline ON public.leads
  FOR EACH ROW
  WHEN (OLD.customer_phone IS DISTINCT FROM NEW.customer_phone
     OR OLD.customer_landline IS DISTINCT FROM NEW.customer_landline)
  EXECUTE FUNCTION marshmallow_private.reset_jellybean_match();

-- Pending leads, newest first so fresh leads are answered before the backfill.
CREATE OR REPLACE FUNCTION public.jellybean_match_candidates(p_limit integer DEFAULT 200)
RETURNS TABLE (id uuid, created_at timestamptz, customer_phone text, customer_landline text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT l.id, l.created_at, l.customer_phone, l.customer_landline
    FROM public.leads l
   WHERE NOT EXISTS (SELECT 1 FROM public.lead_jellybean_matches m WHERE m.lead_id = l.id)
   ORDER BY l.created_at DESC, l.id DESC
   LIMIT least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
REVOKE ALL ON FUNCTION public.jellybean_match_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jellybean_match_candidates(integer) TO service_role;

-- Saves answers only while the lead still has the phones that were checked, so a
-- phone edited mid-check is never stamped with the old number's department.
CREATE OR REPLACE FUNCTION public.save_jellybean_matches(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE saved integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lead_jellybean_matches AS m
    (lead_id, match_status, department, jellybean_lead_id, jellybean_created_at, source_role, matched_phone, checked_at)
  SELECT l.id, r.match_status,
         CASE WHEN r.match_status = 'matched' THEN r.department END,
         r.jellybean_lead_id, r.jellybean_created_at, r.source_role, r.matched_phone, now()
    FROM jsonb_to_recordset(p_rows) AS r(
      lead_id uuid, match_status text, department text, jellybean_lead_id uuid,
      jellybean_created_at timestamptz, source_role text, matched_phone text,
      customer_phone text, customer_landline text)
    JOIN public.leads l ON l.id = r.lead_id
     AND l.customer_phone IS NOT DISTINCT FROM r.customer_phone
     AND l.customer_landline IS NOT DISTINCT FROM r.customer_landline
  ON CONFLICT (lead_id) DO UPDATE SET
    match_status = excluded.match_status, department = excluded.department,
    jellybean_lead_id = excluded.jellybean_lead_id, jellybean_created_at = excluded.jellybean_created_at,
    source_role = excluded.source_role, matched_phone = excluded.matched_phone, checked_at = excluded.checked_at;
  GET DIAGNOSTICS saved = ROW_COUNT;
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.save_jellybean_matches(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_jellybean_matches(jsonb) TO service_role;

-- Internal cron credential, generated once and kept in Vault.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'jellybean_match_cron_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'jellybean_match_cron_secret', 'Marshmallow cron -> jellybean-match-leads worker');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.jellybean_match_worker_authorized(p_secret text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(p_secret, '') <> '' AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
     WHERE name = 'jellybean_match_cron_secret' AND decrypted_secret = p_secret);
$$;
REVOKE ALL ON FUNCTION public.jellybean_match_worker_authorized(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jellybean_match_worker_authorized(text) TO service_role;

-- Cron entry point: one indexed anti-join when idle; calls the worker only when work exists.
CREATE OR REPLACE FUNCTION marshmallow_private.dispatch_jellybean_match() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base_url text; token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.jellybean_match_candidates(1)) THEN RETURN false; END IF;
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name = 'jellybean_match_cron_secret' LIMIT 1;
  IF coalesce(base_url, '') = '' OR coalesce(token, '') = '' THEN
    RAISE WARNING 'JellyBean match worker not invoked: Vault secrets are not configured';
    RETURN false;
  END IF;
  PERFORM net.http_post(url := rtrim(base_url, '/') || '/functions/v1/jellybean-match-leads',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', token),
    body := '{}'::jsonb, timeout_milliseconds := 55000);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.dispatch_jellybean_match() FROM PUBLIC, anon, authenticated, service_role;

-- Admin report: leads created in the range, by JellyBean department and current status.
-- department is ND / FB / SEO / Other, 'not_in_jellybean', or 'pending' (not checked yet).
CREATE OR REPLACE FUNCTION public.get_lead_department_breakdown(p_start timestamptz, p_end timestamptz)
RETURNS TABLE (department text, status text, lead_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only Admins can view the department report' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_start > p_end THEN
    RAISE EXCEPTION 'Choose a valid date range' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT CASE WHEN m.lead_id IS NULL THEN 'pending'
              WHEN m.match_status = 'matched' THEN m.department
              ELSE 'not_in_jellybean' END,
         l.status,
         count(*)::bigint
    FROM public.leads l
    LEFT JOIN public.lead_jellybean_matches m ON m.lead_id = l.id
   WHERE l.created_at >= p_start AND l.created_at <= p_end
   GROUP BY 1, 2;
END $$;
REVOKE ALL ON FUNCTION public.get_lead_department_breakdown(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lead_department_breakdown(timestamptz, timestamptz) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('jellybean-lead-match') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jellybean-lead-match');
    PERFORM cron.schedule('jellybean-lead-match', '* * * * *', 'SELECT marshmallow_private.dispatch_jellybean_match()');
  END IF;
END $$;
COMMIT;

-- Rollback (no lead data is touched; only the derived match table is dropped):
--   SELECT cron.unschedule('jellybean-lead-match');
--   DROP FUNCTION IF EXISTS public.get_lead_department_breakdown(timestamptz, timestamptz);
--   DROP FUNCTION IF EXISTS marshmallow_private.dispatch_jellybean_match();
--   DROP FUNCTION IF EXISTS public.jellybean_match_worker_authorized(text);
--   DROP FUNCTION IF EXISTS public.save_jellybean_matches(jsonb);
--   DROP FUNCTION IF EXISTS public.jellybean_match_candidates(integer);
--   DROP TRIGGER IF EXISTS leads_reset_jellybean_match ON public.leads;
--   DROP FUNCTION IF EXISTS marshmallow_private.reset_jellybean_match();
--   DROP TABLE IF EXISTS public.lead_jellybean_matches;
--   DELETE FROM vault.secrets WHERE name = 'jellybean_match_cron_secret';
--   Undeploy jellybean-match-leads and delete its JELLYBEAN_LOOKUP_SECRET.
