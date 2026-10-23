-- Defect: incomplete scheduled jobs disappeared instead of showing Needs Review;
-- city/state-only projection also hid saved partial customer addresses.
-- Apply manually after processor_board_assigned_schedules_only. No lead writes,
-- new table/enum, RLS change, elevated reads or status/approval changes.
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
    SELECT l.id,l.job_id,l.customer_name,l.customer_phone,l.service_type,l.address,l.half_address,l.city,l.state,l.tech_name,l.tech_number,
      l.scheduled_date,l.scheduled_time_start,l.scheduled_time_end,l.customer_schedule_requirements,l.terms,l.status,l.updated_at,l.created_at
    FROM public.leads l
    WHERE (l.scheduled_date IS NOT NULL OR l.status IN ('scheduled','job_in_progress','payment_pending','partial_paid'))
      AND (p_history OR l.status NOT IN ('paid','cancelled','job_done','done','completed'))
      AND public.processor_can_view_status(l.status)
      AND (coalesce(p_search,'')='' OR strpos(lower(concat_ws(' ',l.job_id,l.customer_name,l.tech_name,l.tech_number,l.address,l.half_address,l.city,l.state)),lower(p_search))>0)
  ), page AS (
    SELECT * FROM matching ORDER BY scheduled_date DESC NULLS LAST,scheduled_time_start DESC NULLS LAST,created_at DESC,id DESC LIMIT 25 OFFSET p_offset
  ), projected AS (
    SELECT p.*,
      CASE WHEN a.lead_updated_at=p.updated_at AND a.result->>'timezone'=p_timezone
        AND nullif(a.result->>'mirror_last_message_at','')::timestamptz IS NOT DISTINCT FROM c.last_message_time
        THEN a.result ELSE NULL END AS assessment,
      a.checked_at
    FROM page p LEFT JOIN public.processor_job_assessments a ON a.lead_id=p.id
    LEFT JOIN public.quo_conversations c ON c.id=(a.result->>'mirror_conversation_id')::uuid
  ) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p)-'created_at' ORDER BY p.scheduled_date DESC NULLS LAST,p.scheduled_time_start DESC NULLS LAST,p.created_at DESC,p.id DESC) FROM projected p),'[]'::jsonb),
      'total',(SELECT count(*) FROM matching),'observed_at',now(),'timezone',p_timezone) INTO answer;
  RETURN answer;
END;
$$;
REVOKE ALL ON FUNCTION public.list_processor_jobs(integer,text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_processor_jobs(integer,text,boolean,text) TO authenticated;
COMMIT;
-- Rollback: restore only list_processor_jobs from
-- 20261022111039_processor_board_assigned_schedules_only.sql. This hides incomplete
-- jobs again and removes half_address from this RPC; no customer data is changed.
