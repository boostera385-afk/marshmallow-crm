-- Purpose: once-a-day safety check for completed, unpaid Processor Board jobs.
-- New chat messages already trigger a re-check; this covers jobs where nobody
-- writes anything (customer or technician ignoring the payment), and a webhook
-- message the CRM mirror may have missed. A changed chat costs one AI call; an
-- unchanged one reuses the saved answer, so the daily pass is mostly Quo reads.
--
-- Apply manually after 20261122000000_processor_board_lead_window_statuses.sql.
-- Before it can run, an Admin must (separately approved):
--   1. set Edge secret PROCESSOR_DAILY_CRON_SECRET on processor-board-daily;
--   2. store the same value in Vault as processor_board_daily_cron_secret, and the
--      project URL as processor_board_daily_project_url;
--   3. deploy processor-board-daily (verify_jwt=false; it checks the secret).
-- Until both Vault secrets exist the dispatcher does nothing. No lead writes,
-- no table/RLS/index change. Audit rows for these checks name the daily check.
BEGIN;
CREATE SCHEMA IF NOT EXISTS marshmallow_private;

-- Same save as before; a NULL actor means the scheduled daily check.
CREATE OR REPLACE FUNCTION public.save_processor_job_assessment(
  p_lead_id uuid, p_token uuid, p_updated_at timestamptz, p_hash text, p_result jsonb, p_actor uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE actor_name text;
BEGIN
  PERFORM 1 FROM public.processor_job_refresh_locks WHERE lead_id=p_lead_id AND token=p_token AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.leads WHERE id=p_lead_id AND updated_at=p_updated_at FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_actor IS NULL THEN actor_name := 'Processor Board daily check';
  ELSE
    SELECT coalesce(p.full_name,'Unknown user') INTO actor_name FROM public.profiles p WHERE p.id=p_actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'Actor profile unavailable'; END IF;
  END IF;
  INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
    VALUES(p_lead_id,p_updated_at,p_hash,p_result,now())
    ON CONFLICT(lead_id) DO UPDATE SET lead_updated_at=excluded.lead_updated_at,input_hash=excluded.input_hash,result=excluded.result,checked_at=excluded.checked_at;
  INSERT INTO public.activity_logs(user_id,user_name,action,target_type,target_id,details)
    VALUES(p_actor,actor_name,'processor_job_assessed','lead',p_lead_id::text,
      'Job-specific advisory assessment: ' || coalesce(p_result->>'status','unavailable'));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.save_processor_job_assessment(uuid,uuid,timestamptz,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_processor_job_assessment(uuid,uuid,timestamptz,text,jsonb,uuid) TO service_role;

-- Completed, unpaid board jobs not checked in the last 20 hours, oldest check
-- first. Payment approvals already with the office are skipped.
CREATE OR REPLACE FUNCTION public.processor_board_daily_candidates(p_limit integer DEFAULT 3)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT l.id FROM public.leads l
  LEFT JOIN public.processor_job_assessments a ON a.lead_id = l.id
  WHERE length(right(regexp_replace(coalesce(l.tech_number,''),'\D','','g'),10)) = 10
    AND l.status NOT IN ('paid','partial_paid','cancelled','scammed','done','completed','payment_requested')
    AND (l.status IN ('payment_pending','job_done')
      OR (a.result->>'policy' = '10' AND a.result->>'job_update' = 'completed'
        AND a.result->>'tech_phone' = right(regexp_replace(l.tech_number,'\D','','g'),10)))
    AND (a.checked_at IS NULL OR a.checked_at < now() - interval '20 hours')
  ORDER BY a.checked_at NULLS FIRST, l.id
  LIMIT least(greatest(coalesce(p_limit,3),1),10);
$$;
REVOKE ALL ON FUNCTION public.processor_board_daily_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.processor_board_daily_candidates(integer) TO service_role;

-- Called by cron. Invokes the Edge worker only when there is work and both
-- Vault secrets are configured, so idle runs cost one indexed query.
CREATE OR REPLACE FUNCTION marshmallow_private.dispatch_processor_board_daily() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base_url text; token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.processor_board_daily_candidates(1)) THEN RETURN false; END IF;
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name='processor_board_daily_project_url' LIMIT 1;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='processor_board_daily_cron_secret' LIMIT 1;
  IF coalesce(base_url,'') = '' OR coalesce(token,'') = '' THEN
    RAISE WARNING 'Processor Board daily check not invoked: Vault secrets are not configured';
    RETURN false;
  END IF;
  PERFORM net.http_post(url:=rtrim(base_url,'/')||'/functions/v1/processor-board-daily',
    headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',token),
    body:=jsonb_build_object('limit',3), timeout_milliseconds:=150000);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.dispatch_processor_board_daily() FROM PUBLIC, anon, authenticated, service_role;

-- Every 15 minutes, 3 jobs per call: about 280 jobs/day of capacity, spread out.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('processor-board-daily-check') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'processor-board-daily-check');
    PERFORM cron.schedule('processor-board-daily-check', '*/15 * * * *', 'SELECT marshmallow_private.dispatch_processor_board_daily()');
  END IF;
END $$;
COMMIT;

-- Rollback:
--   SELECT cron.unschedule('processor-board-daily-check');
--   DROP FUNCTION IF EXISTS marshmallow_private.dispatch_processor_board_daily();
--   DROP FUNCTION IF EXISTS public.processor_board_daily_candidates(integer);
--   Restore save_processor_job_assessment from
--   20261015045700_processor_board_job_assessments.sql (a NULL actor is then
--   rejected again). Undeploy processor-board-daily and delete its Vault/Edge
--   secrets. Saved checks and audit rows are kept; no lead data changes.
