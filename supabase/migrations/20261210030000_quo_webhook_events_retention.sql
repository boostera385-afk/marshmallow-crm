-- =============================================================================
-- Migration : 20261210030000_quo_webhook_events_retention.sql
-- Purpose   : 30-day retention for public.quo_webhook_events, export first.
--
-- WHAT THE TABLE IS
--   The raw delivery log of Quo/OpenPhone webhooks (357 MB, 40% of the
--   database on 2026-11-10, growing ~3,000 rows/day, never pruned). It is NOT
--   the CRM's messages: those are in public.quo_messages and are not touched.
--
-- WHAT THIS DOES (decided 2026-11-10: 30 days, export before deleting)
--   - Creates the PRIVATE Storage bucket "archives" (no public access; only the
--     service role can read or write it).
--   - Nightly at 04:07 UTC, only while the load governor reports normal, calls
--     the Edge Function quo-webhook-events-retention, which for each batch of the
--     oldest finished events (processed / ignored, received > 30 days ago):
--       1. uploads them to archives/quo_webhook_events/<date>/...jsonl.gz,
--       2. deletes exactly those ids, and only if the upload succeeded.
--     Events still "processing" or "failed" are never selected or deleted.
--   - Up to 10 batches x 1,000 rows per run; a backlog drains over several
--     nights (or by calling the function again).
--
-- NOT CHANGED: quo_messages, quo_conversations, the webhook functions.
--
-- APPLY: Supabase SQL Editor as postgres, after 20261210010000_load_governor.
--        Idempotent. Needs the Edge Function quo-webhook-events-retention.
--
-- ROLLBACK (archived files stay in Storage; deleted rows can be restored from them)
--   SELECT cron.unschedule('quo-webhook-events-retention');
--   DROP FUNCTION IF EXISTS marshmallow_private.cron_quo_webhook_events_retention();
--   -- and re-run the deferrable_job_allowed definition from 20261210010000.
-- =============================================================================

BEGIN;

-- 1. Private archive bucket ----------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('archives', 'archives', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2. Retention is deferrable: run only at normal load ----------------------------
CREATE OR REPLACE FUNCTION marshmallow_private.deferrable_job_allowed(
  p_job text, p_level text, p_minute integer, p_minutes_since_change numeric, p_shedding_enabled boolean,
  p_watchdog_quiet_minutes integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT coalesce(p_shedding_enabled, true) THEN true
    WHEN p_job = 'sheets_sync' THEN p_level = 'normal' OR (p_level = 'elevated' AND p_minute % 5 = 0)
    WHEN p_job IN ('urgent_ai_refresh', 'processor_board_daily', 'webhook_retention') THEN p_level = 'normal'
    WHEN p_job = 'sheets_watchdog' THEN p_level = 'normal' AND coalesce(p_minutes_since_change, 1e9) >= p_watchdog_quiet_minutes
    WHEN p_job = 'schedule_monitor' THEN p_level <> 'critical'
    ELSE true
  END
$$;
REVOKE ALL ON FUNCTION marshmallow_private.deferrable_job_allowed(text, text, integer, numeric, boolean, integer) FROM PUBLIC, anon, authenticated;

-- 3. Nightly caller (same secrets pattern as cron_refresh_urgent_ai_status) ----
CREATE OR REPLACE FUNCTION marshmallow_private.cron_quo_webhook_events_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_url text;
  v_publishable_key text;
  v_cron_secret text;
BEGIN
  IF NOT marshmallow_private.deferrable_job_allowed_now('webhook_retention') THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO v_project_url FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_publishable_key FROM vault.decrypted_secrets WHERE name = 'publishable_key' LIMIT 1;
  SELECT CASE
      WHEN jsonb_typeof(value) = 'array' THEN value ->> 0
      WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}'
      WHEN jsonb_typeof(value) = 'object' THEN value ->> 'secret'
    END INTO v_cron_secret
    FROM public.quo_ai_settings WHERE key = 'cron_secret' LIMIT 1;
  IF coalesce(v_project_url, '') = '' OR coalesce(v_publishable_key, '') = '' OR coalesce(v_cron_secret, '') = '' THEN
    RAISE WARNING 'Webhook events retention not invoked: project_url, publishable_key or cron_secret is missing';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/quo-webhook-events-retention',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_publishable_key, 'x-cron-secret', v_cron_secret),
    body := jsonb_build_object('keep_days', 30),
    timeout_milliseconds := 120000
  );
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.cron_quo_webhook_events_retention() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('quo-webhook-events-retention', '7 4 * * *', 'SELECT marshmallow_private.cron_quo_webhook_events_retention()');

COMMIT;
