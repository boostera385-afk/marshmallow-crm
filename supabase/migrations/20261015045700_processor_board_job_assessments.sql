-- Purpose: job-keyed Processor Board advisory assessments, never technician-wide lead updates.
-- Apply manually after review. Does not alter lead policies, statuses, schedules or approvals.
BEGIN;
CREATE OR REPLACE FUNCTION public.processor_can_view_status(p_status text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT public.has_role(auth.uid(),'admin'::public.app_role) OR (public.has_role(auth.uid(),'processor'::public.app_role) AND coalesce(
    (SELECT v.is_visible FROM public.lead_status_visibility v WHERE v.user_id=auth.uid() AND v.status=p_status LIMIT 1),
    (SELECT v.is_visible FROM public.lead_status_visibility v WHERE v.user_id IS NULL AND v.role='processor' AND v.status=p_status LIMIT 1),
    p_status NOT IN ('pending_to_send','quote_updated')));
$$;
REVOKE ALL ON FUNCTION public.processor_can_view_status(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.processor_can_view_status(text) TO authenticated;
CREATE TABLE IF NOT EXISTS public.processor_job_assessments (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  lead_updated_at timestamptz NOT NULL,
  input_hash text NOT NULL,
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.processor_job_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.processor_job_assessments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.processor_job_assessments TO authenticated;
GRANT ALL ON public.processor_job_assessments TO service_role;
DROP POLICY IF EXISTS processor_job_assessments_read ON public.processor_job_assessments;
CREATE POLICY processor_job_assessments_read ON public.processor_job_assessments FOR SELECT TO authenticated
USING ((public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.has_role((SELECT auth.uid()), 'processor'::public.app_role))
  AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND public.processor_can_view_status(l.status)));

-- Service-only leases deduplicate concurrent refreshes, including separate browser sessions.
CREATE TABLE IF NOT EXISTS public.processor_job_refresh_locks (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  token uuid NOT NULL, expires_at timestamptz NOT NULL
);
ALTER TABLE public.processor_job_refresh_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.processor_job_refresh_locks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.processor_job_refresh_locks TO service_role;
CREATE OR REPLACE FUNCTION public.claim_processor_job_refresh(p_lead_id uuid, p_token uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  WITH claimed AS (
    INSERT INTO public.processor_job_refresh_locks(lead_id, token, expires_at)
    VALUES (p_lead_id, p_token, now() + interval '2 minutes')
    ON CONFLICT (lead_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
      WHERE processor_job_refresh_locks.expires_at < now()
    RETURNING lead_id
  ) SELECT EXISTS(SELECT 1 FROM claimed);
$$;
REVOKE ALL ON FUNCTION public.claim_processor_job_refresh(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_processor_job_refresh(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.save_processor_job_assessment(
  p_lead_id uuid, p_token uuid, p_updated_at timestamptz, p_hash text, p_result jsonb, p_actor uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.processor_job_refresh_locks WHERE lead_id=p_lead_id AND token=p_token AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.leads WHERE id=p_lead_id AND updated_at=p_updated_at FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.processor_job_assessments(lead_id,lead_updated_at,input_hash,result,checked_at)
    VALUES(p_lead_id,p_updated_at,p_hash,p_result,now())
    ON CONFLICT(lead_id) DO UPDATE SET lead_updated_at=excluded.lead_updated_at,input_hash=excluded.input_hash,result=excluded.result,checked_at=excluded.checked_at;
  INSERT INTO public.activity_logs(user_id,user_name,action,target_type,target_id,details)
    SELECT p_actor,coalesce(p.full_name,'Unknown user'),'processor_job_assessed','lead',p_lead_id::text,
      'Job-specific advisory assessment: ' || coalesce(p_result->>'status','unavailable')
    FROM public.profiles p WHERE p.id=p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Actor profile unavailable'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.save_processor_job_assessment(uuid,uuid,timestamptz,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_processor_job_assessment(uuid,uuid,timestamptz,text,jsonb,uuid) TO service_role;

-- Caller-token reads preserve existing lead RLS. All dates use the explicitly displayed timezone.
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
      l.scheduled_date,l.scheduled_time_start,l.scheduled_time_end,l.customer_schedule_requirements,l.terms,l.status,l.updated_at
    FROM public.leads l
    WHERE (l.scheduled_date IS NOT NULL OR l.status='scheduled')
      AND (p_history OR l.status IN ('scheduled','job_in_progress','job_done','payment_pending','partial_paid'))
      AND public.processor_can_view_status(l.status)
      AND (coalesce(p_search,'')='' OR strpos(lower(concat_ws(' ',l.job_id,l.customer_name,l.tech_name,l.tech_number,l.address,l.city,l.state)),lower(p_search))>0)
  ), page AS (
    SELECT * FROM matching ORDER BY scheduled_date ASC NULLS FIRST,scheduled_time_start ASC NULLS FIRST,id LIMIT 25 OFFSET p_offset
  ), projected AS (
    SELECT p.*,
      CASE WHEN a.lead_updated_at=p.updated_at AND a.result->>'timezone'=p_timezone
        AND nullif(a.result->>'mirror_last_message_at','')::timestamptz IS NOT DISTINCT FROM c.last_message_time
        THEN a.result ELSE NULL END AS assessment,
      a.checked_at
    FROM page p LEFT JOIN public.processor_job_assessments a ON a.lead_id=p.id
    LEFT JOIN public.quo_conversations c ON c.id=(a.result->>'mirror_conversation_id')::uuid
  ) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.scheduled_date ASC NULLS FIRST,p.scheduled_time_start ASC NULLS FIRST,p.id) FROM projected p),'[]'::jsonb),
      'total',(SELECT count(*) FROM matching),'observed_at',now(),'timezone',p_timezone) INTO answer;
  RETURN answer;
END;
$$;
REVOKE ALL ON FUNCTION public.list_processor_jobs(integer,text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_processor_jobs(integer,text,boolean,text) TO authenticated;
COMMIT;
-- Rollback (retain advisory/audit history):
-- REVOKE EXECUTE ON FUNCTION public.list_processor_jobs(integer,text,boolean,text) FROM authenticated;
-- Revoke service_role execution of claim_processor_job_refresh/save_processor_job_assessment;
-- unpublish the board/undeploy processor-board. Do not delete history without an approved archive.
