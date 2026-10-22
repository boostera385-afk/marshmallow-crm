-- Purpose: the Processor Board contains only assigned jobs with a saved appointment.
-- Apply manually after 20261022041621_processor_board_active_radar.sql.
-- Missing technician name/number/date/start time stays in All Jobs, not this radar.
-- No lead writes, authorization widening, RLS/index changes or new API signature.
BEGIN;
CREATE OR REPLACE FUNCTION public.list_processor_jobs(p_offset integer DEFAULT 0, p_search text DEFAULT '', p_history boolean DEFAULT false, p_timezone text DEFAULT 'America/New_York')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE answer jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin'::public.app_role) OR public.has_role(auth.uid(),'processor'::public.app_role)) THEN
    RAISE EXCEPTION 'Processor Board is restricted to Admin and Processor' USING ERRCODE='42501';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 100000 OR length(p_search)>100 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN
    RAISE EXCEPTION 'Invalid board filters' USING ERRCODE='22023';
  END IF;
  WITH matching AS MATERIALIZED (
    SELECT l.id,l.job_id,l.customer_name,l.customer_phone,l.service_type,l.address,l.city,l.state,l.tech_name,l.tech_number,
      l.scheduled_date,l.scheduled_time_start,l.scheduled_time_end,l.customer_schedule_requirements,l.terms,l.status,l.updated_at,l.created_at
    FROM public.leads l
    WHERE nullif(btrim(l.tech_name),'') IS NOT NULL
      AND nullif(btrim(l.tech_number),'') IS NOT NULL
      AND l.scheduled_date IS NOT NULL AND l.scheduled_time_start IS NOT NULL
      AND (p_history OR l.status NOT IN ('paid','cancelled','job_done','done','completed'))
      AND public.processor_can_view_status(l.status)
      AND (coalesce(p_search,'')='' OR strpos(lower(concat_ws(' ',l.job_id,l.customer_name,l.tech_name,l.tech_number,l.address,l.city,l.state)),lower(p_search))>0)
  ), page AS (
    SELECT * FROM matching ORDER BY scheduled_date DESC,scheduled_time_start DESC,created_at DESC,id DESC LIMIT 25 OFFSET p_offset
  ), projected AS (
    SELECT p.*,
      CASE WHEN a.lead_updated_at=p.updated_at AND a.result->>'timezone'=p_timezone
        AND nullif(a.result->>'mirror_last_message_at','')::timestamptz IS NOT DISTINCT FROM c.last_message_time
        THEN a.result ELSE NULL END AS assessment,
      a.checked_at
    FROM page p LEFT JOIN public.processor_job_assessments a ON a.lead_id=p.id
    LEFT JOIN public.quo_conversations c ON c.id=(a.result->>'mirror_conversation_id')::uuid
  ) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p)-'created_at' ORDER BY p.scheduled_date DESC,p.scheduled_time_start DESC,p.created_at DESC,p.id DESC) FROM projected p),'[]'::jsonb),
      'total',(SELECT count(*) FROM matching),'observed_at',now(),'timezone',p_timezone) INTO answer;
  RETURN answer;
END;
$$;
REVOKE ALL ON FUNCTION public.list_processor_jobs(integer,text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_processor_jobs(integer,text,boolean,text) TO authenticated;
COMMIT;
-- Rollback: restore ONLY list_processor_jobs from
-- 20261022041621_processor_board_active_radar.sql (lines 4-39).
-- This restores incomplete-job visibility without changing any customer records.
