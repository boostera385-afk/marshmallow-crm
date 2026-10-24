-- Purpose: Processor Board rules after user testing (2026-10-24).
--  * Send Dose: the technician took or completed the job, it is still not paid,
--    and 3+ days have passed since the scheduled date/time. If the chat (or the
--    saved lead) says the job is still in progress, it stays Job In Progress.
--    The old "60 minutes unanswered" and "Payment Overdue" rules are removed.
--  * Wrong Tech Number: the saved technician number is missing or is not a valid
--    10-digit US number (11 digits only with a leading 1).
--  * Checks run on the server only: a 5-minute dispatcher calls the existing
--    processor-board-daily worker only when a job's lead or chat changed, a job
--    was never checked, or a completed unpaid job was not checked in 20 hours.
--    Failed jobs back off (15 min doubling to 24 h) instead of retrying forever.
--  * The board list returns every job (no pagination) with a compact AI summary;
--    full evidence is fetched only when a Review is opened.
--
-- Apply manually after 20261122002000_processor_board_stale_never_null.sql.
-- Same function signatures; one new private table; no lead writes, RLS or index
-- change. The processor-board and processor-board-daily functions must be
-- redeployed with this change (the CRM reads ai_summary and the detail action).
BEGIN;
CREATE SCHEMA IF NOT EXISTS marshmallow_private;

-- Matches the Edge phoneKey(): 10 digits, or 11 digits starting with 1.
CREATE OR REPLACE FUNCTION public.processor_tech_phone_key(p_number text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN length(d) = 10 THEN d WHEN length(d) = 11 AND left(d, 1) = '1' THEN right(d, 10) END
  FROM (SELECT regexp_replace(coalesce(p_number, ''), '\D', '', 'g') AS d) digits;
$$;
REVOKE ALL ON FUNCTION public.processor_tech_phone_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.processor_tech_phone_key(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.processor_board_status(
  p_lead_status text, p_scheduled_date date, p_scheduled_time time, p_tech_number text,
  p_result jsonb, p_timezone text, p_now timestamptz
) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH facts AS (
    SELECT public.processor_tech_phone_key(p_tech_number) AS phone,
      CASE WHEN p_result->>'policy' = '10' AND p_result->>'tech_phone' = public.processor_tech_phone_key(p_tech_number) THEN p_result END AS f,
      coalesce(p_scheduled_date IS NOT NULL AND p_scheduled_time IS NOT NULL
        AND (p_scheduled_date + p_scheduled_time) <= (p_now AT TIME ZONE p_timezone), false) AS passed,
      coalesce((p_scheduled_date + coalesce(p_scheduled_time, time '00:00')) + interval '3 days' <= (p_now AT TIME ZONE p_timezone), false) AS dose_due
  ) SELECT CASE
    WHEN phone IS NULL THEN 'wrong_tech_number'
    -- Payment approval is already with the office.
    WHEN p_lead_status = 'payment_requested' THEN 'payment_pending'
    WHEN p_lead_status IN ('payment_pending','job_done') OR f->>'job_update' = 'completed'
      THEN CASE WHEN dose_due THEN 'send_dose' ELSE 'payment_pending' END
    -- A long job or a problem: the chat says work is still going, so no dose yet.
    WHEN f->>'job_update' = 'in_progress' OR p_lead_status = 'job_in_progress' THEN 'job_in_progress'
    WHEN (f->>'tech_took_job')::boolean IS TRUE AND dose_due THEN 'send_dose'
    WHEN f IS NULL THEN CASE WHEN passed THEN 'take_job_update' ELSE 'upcoming' END
    WHEN (f->>'enough_context')::boolean IS NOT TRUE THEN 'not_enough_details'
    WHEN passed THEN 'take_job_update'
    ELSE 'upcoming' END
  FROM facts;
$$;
REVOKE ALL ON FUNCTION public.processor_board_status(text,date,time,text,jsonb,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.processor_board_status(text,date,time,text,jsonb,text,timestamptz) TO authenticated, service_role;

-- Server-side retry state for the worker. Not readable by browsers.
CREATE TABLE IF NOT EXISTS marshmallow_private.processor_check_attempts (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  failures integer NOT NULL DEFAULT 0,
  retry_at timestamptz NOT NULL,
  last_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- RLS on with no policies: browsers get nothing even if the schema is ever exposed.
-- The worker reaches it only through the SECURITY DEFINER functions below (owner).
ALTER TABLE marshmallow_private.processor_check_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marshmallow_private.processor_check_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_processor_check_attempt(p_lead_id uuid, p_ok boolean, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_ok THEN
    DELETE FROM marshmallow_private.processor_check_attempts WHERE lead_id = p_lead_id;
    RETURN;
  END IF;
  INSERT INTO marshmallow_private.processor_check_attempts AS t(lead_id, failures, retry_at, last_code, updated_at)
  VALUES (p_lead_id, CASE WHEN p_code = 'busy' THEN 0 ELSE 1 END,
    now() + CASE WHEN p_code = 'busy' THEN interval '5 minutes' ELSE interval '15 minutes' END, left(p_code, 40), now())
  ON CONFLICT (lead_id) DO UPDATE SET
    failures = t.failures + CASE WHEN p_code = 'busy' THEN 0 ELSE 1 END,
    retry_at = now() + CASE WHEN p_code = 'busy' THEN interval '5 minutes'
      ELSE least(interval '24 hours', interval '15 minutes' * power(2, t.failures)) END,
    last_code = left(p_code, 40), updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.record_processor_check_attempt(uuid,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_processor_check_attempt(uuid,boolean,text) TO service_role;

-- A successful save (user or worker) also clears that job's retry state.
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
  PERFORM public.record_processor_check_attempt(p_lead_id, true, NULL);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.save_processor_job_assessment(uuid,uuid,timestamptz,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_processor_job_assessment(uuid,uuid,timestamptz,text,jsonb,uuid) TO service_role;

-- Jobs the worker should check now, most urgent first:
--   1 = lead edited, or a new message in its tech chat (or, for a payment
--       check, in the customer's chat) since the last check;
--   2 = never checked by this version, or saved for another technician;
--   3 = completed and unpaid, not checked in the last 20 hours (daily check).
-- Jobs waiting out a retry backoff are skipped. Wrong tech numbers are skipped.
CREATE OR REPLACE FUNCTION public.processor_board_due_jobs(p_limit integer DEFAULT 5)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH board AS (
    SELECT l.id, l.updated_at, l.status, l.customer_phone, public.processor_tech_phone_key(l.tech_number) AS phone,
      a.result, a.checked_at, a.lead_updated_at, c.last_message_time AS tech_last
    FROM public.leads l
    LEFT JOIN public.processor_job_assessments a ON a.lead_id = l.id
    LEFT JOIN public.quo_conversations c ON c.id = nullif(a.result->>'mirror_conversation_id','')::uuid
    LEFT JOIN marshmallow_private.processor_check_attempts t ON t.lead_id = l.id
    WHERE (nullif(btrim(l.tech_name),'') IS NOT NULL OR nullif(btrim(l.tech_number),'') IS NOT NULL)
      AND (l.scheduled_date IS NOT NULL OR l.status IN ('scheduled','job_in_progress','payment_pending','payment_requested','job_done'))
      AND l.status NOT IN ('paid','partial_paid','cancelled','scammed','done','completed')
      AND public.processor_tech_phone_key(l.tech_number) IS NOT NULL
      AND (t.retry_at IS NULL OR t.retry_at <= now())
  ), reasons AS (
    SELECT b.id, b.checked_at, CASE
      WHEN b.result IS NULL OR b.result->>'policy' IS DISTINCT FROM '10' OR b.result->>'tech_phone' IS DISTINCT FROM b.phone THEN 2
      WHEN b.lead_updated_at IS DISTINCT FROM b.updated_at
        OR nullif(b.result->>'mirror_last_message_at','')::timestamptz IS DISTINCT FROM b.tech_last THEN 1
      WHEN b.result ? 'payment' AND nullif(b.result->>'customer_last_message_at','')::timestamptz IS DISTINCT FROM (
          SELECT max(c2.last_message_time) FROM public.quo_conversations c2
          WHERE c2.linked_lead_id = b.id
            OR (length(right(regexp_replace(coalesce(b.customer_phone,''),'\D','','g'),10)) = 10
              AND c2.customer_number = '+1' || right(regexp_replace(coalesce(b.customer_phone,''),'\D','','g'),10))) THEN 1
      WHEN (b.status IN ('payment_pending','job_done') OR b.result->>'job_update' = 'completed')
        AND b.checked_at < now() - interval '20 hours' THEN 3
    END AS reason
    FROM board b
  )
  SELECT r.id FROM reasons r WHERE r.reason IS NOT NULL
  ORDER BY r.reason, r.checked_at NULLS FIRST, r.id
  LIMIT least(greatest(coalesce(p_limit, 5), 1), 10);
$$;
REVOKE ALL ON FUNCTION public.processor_board_due_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.processor_board_due_jobs(integer) TO service_role;

-- Kept for the previously deployed worker until it is redeployed.
CREATE OR REPLACE FUNCTION public.processor_board_daily_candidates(p_limit integer DEFAULT 3)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.processor_board_due_jobs(p_limit);
$$;
REVOKE ALL ON FUNCTION public.processor_board_daily_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.processor_board_daily_candidates(integer) TO service_role;

CREATE OR REPLACE FUNCTION marshmallow_private.dispatch_processor_board_daily() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base_url text; token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.processor_board_due_jobs(1)) THEN RETURN false; END IF;
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name='processor_board_daily_project_url' LIMIT 1;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='processor_board_daily_cron_secret' LIMIT 1;
  IF coalesce(base_url,'') = '' OR coalesce(token,'') = '' THEN
    RAISE WARNING 'Processor Board worker not invoked: Vault secrets are not configured';
    RETURN false;
  END IF;
  PERFORM net.http_post(url:=rtrim(base_url,'/')||'/functions/v1/processor-board-daily',
    headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',token),
    body:=jsonb_build_object('limit',5), timeout_milliseconds:=150000);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.dispatch_processor_board_daily() FROM PUBLIC, anon, authenticated, service_role;

-- Every 5 minutes so a new message is picked up quickly; idle runs make no call.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('processor-board-daily-check') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'processor-board-daily-check');
    PERFORM cron.schedule('processor-board-daily-check', '*/5 * * * *', 'SELECT marshmallow_private.dispatch_processor_board_daily()');
  END IF;
END $$;

-- Every job (no pagination) with a compact AI summary instead of full evidence.
CREATE OR REPLACE FUNCTION public.list_processor_board_jobs(
  p_offset integer DEFAULT 0, p_search text DEFAULT '', p_timezone text DEFAULT 'America/New_York', p_ai_status text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE answer jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin'::public.app_role) OR public.has_role(auth.uid(),'processor'::public.app_role)) THEN
    RAISE EXCEPTION 'Processor Board is restricted to Admin and Processor' USING ERRCODE='42501';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 100000 OR length(coalesce(p_search,''))>100
    OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone)
    OR (p_ai_status IS NOT NULL AND p_ai_status NOT IN ('take_job_update','job_in_progress','payment_pending','send_dose','wrong_tech_number','not_enough_details','upcoming')) THEN
    RAISE EXCEPTION 'Invalid board filters' USING ERRCODE='22023';
  END IF;
  WITH base AS MATERIALIZED (
    SELECT l.id,l.job_id,l.customer_name,l.customer_phone,l.service_type,l.address,l.half_address,l.city,l.state,l.tech_name,l.tech_number,
      l.scheduled_date,l.scheduled_time_start,l.scheduled_time_end,l.customer_schedule_requirements,l.terms,l.status,l.updated_at,l.created_at,
      a.result, a.checked_at,
      coalesce(a.lead_id IS NOT NULL AND (a.lead_updated_at IS DISTINCT FROM l.updated_at
        OR nullif(a.result->>'mirror_last_message_at','')::timestamptz IS DISTINCT FROM c.last_message_time), false) AS ai_stale,
      public.processor_board_status(l.status,l.scheduled_date,l.scheduled_time_start,l.tech_number,a.result,p_timezone,now()) AS board_status
    FROM public.leads l
    LEFT JOIN public.processor_job_assessments a ON a.lead_id=l.id
    LEFT JOIN public.quo_conversations c ON c.id=nullif(a.result->>'mirror_conversation_id','')::uuid
    WHERE (nullif(btrim(l.tech_name),'') IS NOT NULL OR nullif(btrim(l.tech_number),'') IS NOT NULL)
      AND (l.scheduled_date IS NOT NULL OR l.status IN ('scheduled','job_in_progress','payment_pending','payment_requested','job_done'))
      AND l.status NOT IN ('paid','partial_paid','cancelled','scammed','done','completed')
      AND public.processor_can_view_status(l.status)
      AND (coalesce(p_search,'')='' OR strpos(lower(concat_ws(' ',l.job_id,l.customer_name,l.tech_name,l.tech_number,l.address,l.half_address,l.city,l.state,l.service_type)),lower(p_search))>0)
  ), matching AS (
    SELECT * FROM base WHERE p_ai_status IS NULL OR board_status=p_ai_status
  ), page AS (
    SELECT m.id,m.job_id,m.customer_name,m.customer_phone,m.service_type,m.address,m.half_address,m.city,m.state,m.tech_name,m.tech_number,
      m.scheduled_date,m.scheduled_time_start,m.scheduled_time_end,m.customer_schedule_requirements,m.terms,m.status,m.updated_at,m.created_at,
      m.checked_at,m.board_status,
      CASE WHEN m.result IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
        'policy',m.result->'policy','tech_phone',m.result->'tech_phone','job_update',m.result->'job_update',
        'tech_took_job',m.result->'tech_took_job','enough_context',m.result->'enough_context','completed_at',m.result->'completed_at',
        'payment_state',m.result#>'{payment,state}','payment_waiting_since',m.result#>'{payment,waiting_since}',
        'payment_promised_date',m.result#>'{payment,promised_date}',
        'payment_error',CASE WHEN m.result ? 'payment_error' THEN to_jsonb(true) END,'checked_by',m.result->'checked_by')) END AS ai_summary,
      m.ai_stale OR (coalesce(m.result ? 'payment', false) AND nullif(m.result->>'customer_last_message_at','')::timestamptz
        IS DISTINCT FROM public.processor_customer_last_message(m.id,m.customer_phone)) AS ai_stale
    FROM matching m ORDER BY m.created_at DESC, m.id DESC OFFSET p_offset
  ) SELECT jsonb_build_object(
      'rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC, p.id DESC) FROM page p),'[]'::jsonb),
      'total',(SELECT count(*) FROM matching),
      'counts',(SELECT coalesce(jsonb_object_agg(s.board_status,s.n),'{}'::jsonb) FROM (SELECT board_status,count(*) n FROM base GROUP BY board_status) s),
      'all_total',(SELECT count(*) FROM base),
      'observed_at',now(),'timezone',p_timezone) INTO answer;
  RETURN answer;
END;
$$;
REVOKE ALL ON FUNCTION public.list_processor_board_jobs(integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_processor_board_jobs(integer,text,text,text) TO authenticated;
COMMIT;

-- Rollback (no customer data changes):
--   Re-run, in order, processor_board_status from 20261122000000, the save
--   function, daily candidates and dispatcher from 20261122001000 (which also
--   reschedules every 15 minutes), and list_processor_board_jobs from
--   20261122002000; then
--   DROP FUNCTION IF EXISTS public.processor_board_due_jobs(integer);
--   DROP FUNCTION IF EXISTS public.record_processor_check_attempt(uuid,boolean,text);
--   DROP FUNCTION IF EXISTS public.processor_tech_phone_key(text);
--   DROP TABLE IF EXISTS marshmallow_private.processor_check_attempts;
-- Restore the matching processor-board / processor-board-daily / CRM versions together.
