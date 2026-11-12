-- =============================================================================
-- Migration : 20261212001000_webhook_retention_run_status.sql
-- Purpose   : Let an Admin tell "cron fired" apart from "retention actually
--             finished" - the other half of the webhook retention defect.
--
-- DEFECT
--   marshmallow_private.cron_quo_webhook_events_retention() only submits an
--   async net.http_post and returns; pg_cron then marks the job "succeeded"
--   regardless of what the Edge Function did. On 2026-11-12 04:07 UTC the
--   function logged "read failed: canceling statement due to statement
--   timeout" while cron still showed success for that run. 20261211000000 and
--   20261211001000 already fixed the query itself (bounded batch through a
--   new partial index); this migration adds the missing completion signal so
--   a future failure is visible without grepping function logs.
--
-- WHAT THIS DOES
--   - marshmallow_private.webhook_retention_state: one row (same shape as
--     load_state / health_state) holding last_run_at, last_ok, last_stopped,
--     last_error, last_success_at, consecutive_failures.
--   - public.record_webhook_retention_run(p_result jsonb): SECURITY DEFINER,
--     service_role only, called by the Edge Function itself at the end of
--     every run (success or failure) so completion is reported by the worker,
--     not inferred from cron dispatch.
--   - Requires the matching Edge Function change (same commit) in
--     supabase/functions/quo-webhook-events-retention/index.ts, which calls
--     this RPC right before returning, in both the success and catch paths.
--     Deploy that function together with this migration - applying one without
--     the other just means no status gets recorded yet (safe no-op either way).
--
-- HOW TO CHECK
--   SELECT * FROM marshmallow_private.webhook_retention_state;
--   last_ok = false or consecutive_failures > 0 means the nightly archive is
--   not actually completing, even if cron.job_run_details looks clean.
--
-- NOT CHANGED: the retention query/RPC, the archive bucket, cron schedule,
-- any notification UI. This only adds a status row and its writer function.
--
-- APPLY: Supabase SQL Editor as postgres, after 20261211001000. Idempotent.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.record_webhook_retention_run(jsonb);
--   DROP TABLE IF EXISTS marshmallow_private.webhook_retention_state;
--   -- Revert the matching Edge Function change so it stops calling the RPC.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS marshmallow_private.webhook_retention_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_run_at timestamptz,
  last_ok boolean,
  last_stopped text,
  last_error text,
  last_success_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0
);
INSERT INTO marshmallow_private.webhook_retention_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON marshmallow_private.webhook_retention_state FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_webhook_retention_run(p_result jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ok boolean := coalesce((p_result->>'ok')::boolean, false);
BEGIN
  UPDATE marshmallow_private.webhook_retention_state
     SET last_run_at = now(),
         last_ok = v_ok,
         last_stopped = p_result->>'stopped',
         last_error = left(p_result->>'error', 500),
         last_success_at = CASE WHEN v_ok THEN now() ELSE last_success_at END,
         consecutive_failures = CASE WHEN v_ok THEN 0 ELSE consecutive_failures + 1 END
   WHERE id;
END $$;
REVOKE ALL ON FUNCTION public.record_webhook_retention_run(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_retention_run(jsonb) TO service_role;

COMMIT;
