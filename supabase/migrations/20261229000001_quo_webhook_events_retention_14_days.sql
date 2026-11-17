-- =============================================================================
-- Migration : 20261229000001_quo_webhook_events_retention_14_days.sql
-- Purpose   : Keep the raw Quo webhook delivery log for 14 days instead of 30.
--
-- WHY
--   On 2026-11-17 quo_webhook_events was 362 MB (269 MB heap, 70 MB indexes)
--   on a 2 GB compute whose 640 MB shared_buffers it shares with every hot CRM
--   table; together with quo_messages it was ~75% of the database. About 3,500
--   events arrive a day and ~92,000 processed rows sit inside the 30-day window.
--   Processed events are already turned into quo_messages / quo_conversations,
--   and the nightly worker archives every batch to the private "archives"
--   bucket (gzipped JSON lines) BEFORE deleting it, so nothing is lost: rows
--   older than 14 days move from the database to the archive.
--
-- WHAT THIS DOES
--   Re-creates marshmallow_private.cron_quo_webhook_events_retention() exactly
--   as in 20261210030000 except body keep_days 30 -> 14. The Edge Function
--   still enforces its own >= 7 day floor and still only deletes rows whose
--   processing_status is 'processed' or 'ignored' ("processing"/"failed" rows
--   are never touched). The worker removes at most 10 x 1,000 rows per night,
--   so the backlog (~44,000 rows between 14 and 30 days) drains over ~5 nights
--   instead of in one large delete. Freed heap space is reused by new events;
--   the table stops growing rather than shrinking on disk (no VACUUM FULL).
--
-- NOT CHANGED: schedule (04:07 UTC), load-governor deferral, archive bucket,
--   secrets lookup, grants, the Edge Function, ingestion, or quo_messages.
--
-- APPLY: Supabase SQL Editor as postgres (or supabase db push with approval).
--   Idempotent. Verify afterwards:
--     SELECT pg_get_functiondef('marshmallow_private.cron_quo_webhook_events_retention()'::regprocedure)
--       LIKE '%''keep_days'', 14%';
--   and, after the next nightly run(s), that the oldest processed/ignored row
--   is no older than ~14 days and new archive files exist in "archives".
--
-- ROLLBACK: re-run section 3 of 20261210030000_quo_webhook_events_retention.sql
--   (same function with keep_days 30). Archived rows are not restored into the
--   table by rollback; they remain available in the "archives" bucket.
-- =============================================================================

BEGIN;

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
    body := jsonb_build_object('keep_days', 14),
    timeout_milliseconds := 120000
  );
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.cron_quo_webhook_events_retention() FROM PUBLIC, anon, authenticated;

COMMIT;
