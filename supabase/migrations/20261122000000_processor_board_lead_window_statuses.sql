-- Purpose: Processor Board v2 list. The board holds every lead with an assigned
-- technician that is not paid, partially paid, cancelled or scammed, newest lead
-- first. Its AI status is derived here, once, from the saved advisory facts plus
-- the current time, so the status filter and counts cover every matching job,
-- not just one loaded page, and the CRM never re-derives a different answer.
--
-- Time-based changes (appointment passed, technician silent for 60 minutes) need
-- no new AI call: the saved facts stay valid until the lead or its technician
-- conversation changes (ai_stale), and only then is the job re-read.
--
-- Apply manually after 20261023041010_processor_board_review_visibility.sql.
-- Adds two functions only. No lead writes, no table/RLS/index/enum change, no
-- status or approval change. The previous list_processor_jobs is left untouched
-- so the currently deployed Edge Function keeps working until v2 is deployed.
BEGIN;

-- Pure status rule; reads no table. Facts are used only when they were saved for
-- the technician currently assigned (a reassignment must not inherit them).
CREATE OR REPLACE FUNCTION public.processor_board_status(
  p_lead_status text, p_scheduled_date date, p_scheduled_time time, p_tech_number text,
  p_result jsonb, p_timezone text, p_now timestamptz
) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH facts AS (
    SELECT CASE WHEN p_result->>'policy' = '10'
        AND p_result->>'tech_phone' = right(regexp_replace(coalesce(p_tech_number,''),'\D','','g'),10)
      THEN p_result END AS f,
      coalesce(p_scheduled_date IS NOT NULL AND p_scheduled_time IS NOT NULL
        AND (p_scheduled_date + p_scheduled_time) <= (p_now AT TIME ZONE p_timezone), false) AS passed
  ) SELECT CASE
    WHEN p_lead_status IN ('payment_pending','payment_requested','job_done') THEN 'payment_pending'
    WHEN f->>'job_update' = 'completed' THEN 'payment_pending'
    WHEN f IS NULL THEN CASE WHEN p_lead_status = 'job_in_progress' THEN 'job_in_progress'
      WHEN passed THEN 'take_job_update' ELSE 'upcoming' END
    WHEN (f->>'tech_took_job')::boolean IS TRUE AND nullif(f->>'waiting_since','')::timestamptz <= p_now - interval '60 minutes' THEN 'send_dose'
    WHEN f->>'job_update' = 'in_progress' OR p_lead_status = 'job_in_progress' THEN 'job_in_progress'
    WHEN (f->>'enough_context')::boolean IS NOT TRUE THEN 'not_enough_details'
    WHEN passed THEN 'take_job_update'
    ELSE 'upcoming' END
  FROM facts;
$$;
REVOKE ALL ON FUNCTION public.processor_board_status(text,date,time,text,jsonb,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.processor_board_status(text,date,time,text,jsonb,text,timestamptz) TO authenticated, service_role;

-- Caller-token read: lead RLS and per-user status visibility still apply.
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
    OR (p_ai_status IS NOT NULL AND p_ai_status NOT IN ('take_job_update','job_in_progress','payment_pending','send_dose','not_enough_details','upcoming')) THEN
    RAISE EXCEPTION 'Invalid board filters' USING ERRCODE='22023';
  END IF;
  WITH base AS MATERIALIZED (
    SELECT l.id,l.job_id,l.customer_name,l.customer_phone,l.service_type,l.address,l.half_address,l.city,l.state,l.tech_name,l.tech_number,
      l.scheduled_date,l.scheduled_time_start,l.scheduled_time_end,l.customer_schedule_requirements,l.terms,l.status,l.updated_at,l.created_at,
      a.result AS assessment, a.checked_at,
      -- Stale = the lead or its technician conversation changed after the check.
      (a.lead_id IS NOT NULL AND (a.lead_updated_at IS DISTINCT FROM l.updated_at
        OR nullif(a.result->>'mirror_last_message_at','')::timestamptz IS DISTINCT FROM c.last_message_time)) AS ai_stale,
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
    SELECT * FROM matching ORDER BY created_at DESC, id DESC LIMIT 25 OFFSET p_offset
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

-- Rollback (no data to restore; nothing else depends on these functions):
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.list_processor_board_jobs(integer,text,text,text);
--   DROP FUNCTION IF EXISTS public.processor_board_status(text,date,time,text,jsonb,text,timestamptz);
--   COMMIT;
-- First restore the previous CRM and processor-board Edge Function (v10, which uses
-- list_processor_jobs) together. The old CRM cannot parse v2 results saved in
-- processor_job_assessments (result->>'policy' = '10'); clearing that advisory cache
-- is a separate, approved write. activity_logs audit rows are kept.
