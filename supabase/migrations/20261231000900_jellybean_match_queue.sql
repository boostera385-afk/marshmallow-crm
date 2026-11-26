-- Purpose: make the JellyBean department matcher cheap when idle.
--
-- Before: every minute, dispatch_jellybean_match() found pending leads with an
-- anti-join over ALL of public.leads against lead_jellybean_matches
-- (prod 2026-11-26: 6,194 leads, ~4,200 buffer reads and ~68 ms per run,
-- 1,440 runs a day, growing with the table) even though nothing was pending.
--
-- After: a small queue table holds only the leads waiting to be checked.
--   * New leads are queued by a statement-level INSERT trigger (one insert per
--     statement, so bulk imports stay cheap).
--   * A phone/landline edit drops the saved answer (as before) and re-queues.
--   * save_jellybean_matches() removes a lead from the queue in the same
--     statement that saves its answer. An answer rejected because the phone
--     changed mid-check leaves the lead queued.
--   * The per-minute dispatcher only checks whether the queue has any row.
--   * A daily sweep re-queues any lead that has no answer and is not queued
--     (safety net; the only full anti-join left, once a day instead of 1,440x).
-- Behaviour, rules, report and security are unchanged. leads is never written.
--
-- Harness: supabase/tests/191_jellybean_lead_departments.sql via
--   scripts/test-jellybean-departments-db.mjs (isolated embedded Postgres).
BEGIN;

CREATE TABLE IF NOT EXISTS public.lead_jellybean_match_queue (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lead_jellybean_match_queue IS
  'Leads waiting for the jellybean-match-leads worker. Filled by triggers on leads, emptied by save_jellybean_matches(). Service role only.';
ALTER TABLE public.lead_jellybean_match_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_jellybean_match_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_jellybean_match_queue TO service_role;

-- Queue every lead that has no answer yet (no-op on prod after the backfill).
INSERT INTO public.lead_jellybean_match_queue (lead_id)
SELECT l.id FROM public.leads l
 WHERE NOT EXISTS (SELECT 1 FROM public.lead_jellybean_matches m WHERE m.lead_id = l.id)
ON CONFLICT (lead_id) DO NOTHING;

-- New leads (CRM, Donut, imports): one queue insert per statement.
CREATE OR REPLACE FUNCTION marshmallow_private.queue_new_leads_for_jellybean() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.lead_jellybean_match_queue (lead_id)
  SELECT n.id FROM new_leads n
  ON CONFLICT (lead_id) DO NOTHING;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.queue_new_leads_for_jellybean() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS leads_queue_jellybean_match ON public.leads;
CREATE TRIGGER leads_queue_jellybean_match
  AFTER INSERT ON public.leads
  REFERENCING NEW TABLE AS new_leads
  FOR EACH STATEMENT
  EXECUTE FUNCTION marshmallow_private.queue_new_leads_for_jellybean();

-- Phone/landline edit: drop the stale answer and re-queue (trigger unchanged).
CREATE OR REPLACE FUNCTION marshmallow_private.reset_jellybean_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.lead_jellybean_matches WHERE lead_id = NEW.id;
  INSERT INTO public.lead_jellybean_match_queue (lead_id) VALUES (NEW.id)
  ON CONFLICT (lead_id) DO NOTHING;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.reset_jellybean_match() FROM PUBLIC, anon, authenticated;

-- Pending leads, newest first: reads the queue, not the whole leads table.
CREATE OR REPLACE FUNCTION public.jellybean_match_candidates(p_limit integer DEFAULT 200)
RETURNS TABLE (id uuid, created_at timestamptz, customer_phone text, customer_landline text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT l.id, l.created_at, l.customer_phone, l.customer_landline
    FROM public.lead_jellybean_match_queue q
    JOIN public.leads l ON l.id = q.lead_id
   ORDER BY l.created_at DESC, l.id DESC
   LIMIT least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
REVOKE ALL ON FUNCTION public.jellybean_match_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jellybean_match_candidates(integer) TO service_role;

-- Same save rule as before; saved leads leave the queue in the same statement.
CREATE OR REPLACE FUNCTION public.save_jellybean_matches(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE saved_count integer;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;
  WITH saved AS (
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
      source_role = excluded.source_role, matched_phone = excluded.matched_phone, checked_at = excluded.checked_at
    RETURNING m.lead_id
  ), dequeued AS (
    DELETE FROM public.lead_jellybean_match_queue q USING saved s WHERE q.lead_id = s.lead_id
  )
  SELECT count(*) INTO saved_count FROM saved;
  RETURN saved_count;
END $$;
REVOKE ALL ON FUNCTION public.save_jellybean_matches(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_jellybean_matches(jsonb) TO service_role;

-- Cron entry point: a probe of the (normally empty) queue when idle.
CREATE OR REPLACE FUNCTION marshmallow_private.dispatch_jellybean_match() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base_url text; token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lead_jellybean_match_queue) THEN RETURN false; END IF;
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

-- Daily safety net: re-queue any lead with no answer that is not queued.
CREATE OR REPLACE FUNCTION marshmallow_private.requeue_unchecked_jellybean_matches() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE queued integer;
BEGIN
  INSERT INTO public.lead_jellybean_match_queue (lead_id)
  SELECT l.id FROM public.leads l
   WHERE NOT EXISTS (SELECT 1 FROM public.lead_jellybean_matches m WHERE m.lead_id = l.id)
  ON CONFLICT (lead_id) DO NOTHING;
  GET DIAGNOSTICS queued = ROW_COUNT;
  RETURN queued;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.requeue_unchecked_jellybean_matches() FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('jellybean-lead-match-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jellybean-lead-match-sweep');
    PERFORM cron.schedule('jellybean-lead-match-sweep', '53 3 * * *', 'SELECT marshmallow_private.requeue_unchecked_jellybean_matches()');
  END IF;
END $$;
COMMIT;

-- Rollback (re-apply 20261231000800 to restore the anti-join versions first):
--   SELECT cron.unschedule('jellybean-lead-match-sweep');
--   DROP FUNCTION IF EXISTS marshmallow_private.requeue_unchecked_jellybean_matches();
--   DROP TRIGGER IF EXISTS leads_queue_jellybean_match ON public.leads;
--   DROP FUNCTION IF EXISTS marshmallow_private.queue_new_leads_for_jellybean();
--   DROP TABLE IF EXISTS public.lead_jellybean_match_queue;
