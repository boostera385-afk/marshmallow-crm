-- Defect: list_processor_board_jobs returned ai_stale = NULL (not false) for a job
-- that AI never checked when the customer has a saved CRM conversation
-- (NULL ? 'payment' is NULL). The CRM rejects the whole page as an out-of-date
-- backend, so the board shows no jobs.
-- Fix: ai_stale is always true/false. Only this function changes; same signature,
-- grants, scope, order, statuses and counts. No data, table, RLS or index change.
-- Apply manually after 20261122001000_processor_board_daily_check.sql. Idempotent.
BEGIN;
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
    OR (p_ai_status IS NOT NULL AND p_ai_status NOT IN ('take_job_update','job_in_progress','payment_pending','payment_overdue','send_dose','not_enough_details','upcoming')) THEN
    RAISE EXCEPTION 'Invalid board filters' USING ERRCODE='22023';
  END IF;
  WITH base AS MATERIALIZED (
    SELECT l.id,l.job_id,l.customer_name,l.customer_phone,l.service_type,l.address,l.half_address,l.city,l.state,l.tech_name,l.tech_number,
      l.scheduled_date,l.scheduled_time_start,l.scheduled_time_end,l.customer_schedule_requirements,l.terms,l.status,l.updated_at,l.created_at,
      a.result AS assessment, a.checked_at,
      -- Stale = the lead or its technician conversation changed after the check.
      -- The customer's chat is compared on the page only (payment checks only).
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
    SELECT m.id,m.job_id,m.customer_name,m.customer_phone,m.service_type,m.address,m.half_address,m.city,m.state,m.tech_name,m.tech_number,
      m.scheduled_date,m.scheduled_time_start,m.scheduled_time_end,m.customer_schedule_requirements,m.terms,m.status,m.updated_at,m.created_at,
      m.assessment,m.checked_at,m.board_status,
      -- Never NULL: an unchecked job has no saved payment read to compare.
      coalesce(m.ai_stale, false) OR (coalesce(m.assessment ? 'payment', false) AND nullif(m.assessment->>'customer_last_message_at','')::timestamptz
        IS DISTINCT FROM public.processor_customer_last_message(m.id,m.customer_phone)) AS ai_stale
    FROM matching m ORDER BY m.created_at DESC, m.id DESC LIMIT 25 OFFSET p_offset
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

-- Rollback: re-run the list_processor_board_jobs definition from
-- 20261122000000_processor_board_lead_window_statuses.sql (restores the defect).
