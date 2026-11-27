-- =============================================================================
-- Every 15 minutes: re-read tracked techs' Quo chats (lead-tech-status)
-- =============================================================================
-- Same vault + cron_secret pattern as cron_refresh_urgent_ai_status
-- (20261107000001). The function itself skips the model unless a tech wrote
-- something new, so a quiet run costs no AI calls.
--
-- Requires: pg_cron, pg_net, vault secrets project_url + publishable_key, and
-- quo_ai_settings.cron_secret (all already used by the urgent AI refresh).
-- Deploy the `lead-tech-status` Edge Function before applying this.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cron_lead_tech_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_project_url     text;
  v_publishable_key text;
  v_cron_secret     text;
BEGIN
  -- Nothing tracked: skip the HTTP call entirely.
  IF NOT EXISTS (SELECT 1 FROM public.lead_tech_contacts WHERE state <> 'not_texted') THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_publishable_key
    FROM vault.decrypted_secrets WHERE name = 'publishable_key' LIMIT 1;
  SELECT CASE
      WHEN jsonb_typeof(value) = 'array'  THEN value ->> 0
      WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}'
      WHEN jsonb_typeof(value) = 'object' THEN value ->> 'secret'
      ELSE NULL
    END
    INTO v_cron_secret
    FROM public.quo_ai_settings WHERE key = 'cron_secret' LIMIT 1;

  IF coalesce(v_project_url, '') = ''
     OR coalesce(v_publishable_key, '') = ''
     OR coalesce(v_cron_secret, '') = '' THEN
    RAISE WARNING 'Lead tech status not invoked: project_url, publishable_key, or cron_secret is missing';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/lead-tech-status',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_publishable_key,
      'x-cron-secret', v_cron_secret
    ),
    body := jsonb_build_object('trigger', 'cron'),
    timeout_milliseconds := 10000
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.cron_lead_tech_status() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('lead-tech-status')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lead-tech-status');
  PERFORM cron.schedule('lead-tech-status', '*/15 * * * *', 'SELECT public.cron_lead_tech_status()');
END $$;

-- ROLLBACK
--   SELECT cron.unschedule('lead-tech-status');
--   DROP FUNCTION IF EXISTS public.cron_lead_tech_status();
