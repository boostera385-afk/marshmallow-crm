-- Purpose: the Processor Board check now also reads the customer's own chat with
-- our office (customer's point of view on the job; never our share). A new
-- customer message must re-check the job, like a new technician message does.
--   * processor_board_due_jobs: a job is due (reason 1) when its customer's latest
--     message time differs from the one the last check read.
--   * list_processor_board_jobs: ai_stale ("new activity") includes it.
-- Only results saved by the new Edge code carry result.customer_chat, so older
-- results are never re-queued by this; a customer chat that could not be read
-- ("unavailable") is not compared, so a failing read cannot loop the queue.
-- Apply manually after 20261126000000_processor_board_last_30_days.sql. Order with
-- the Edge redeploy does not matter. Same signatures; no table, RLS, grant or data
-- change. Uses existing indexes on quo_conversations(linked_lead_id) and
-- (customer_number).
BEGIN;
CREATE OR REPLACE FUNCTION public.processor_board_due_jobs(p_limit integer DEFAULT 5)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH board AS (
    SELECT l.id, l.updated_at, l.status, l.customer_phone, public.processor_tech_phone_key(l.tech_number) AS phone,
      a.result, a.checked_at, a.lead_updated_at, c.last_message_time AS tech_last,
      -- Same definition as processor_customer_last_message(), inlined for the worker queue.
      (SELECT max(cc.last_message_time) FROM public.quo_conversations cc
        WHERE cc.linked_lead_id = l.id
          OR (length(right(regexp_replace(coalesce(l.customer_phone,''),'\D','','g'),10)) = 10
            AND cc.customer_number = '+1' || right(regexp_replace(coalesce(l.customer_phone,''),'\D','','g'),10))) AS customer_last
    FROM public.leads l
    LEFT JOIN public.processor_job_assessments a ON a.lead_id = l.id
    LEFT JOIN public.quo_conversations c ON c.id = nullif(a.result->>'mirror_conversation_id','')::uuid
    LEFT JOIN marshmallow_private.processor_check_attempts t ON t.lead_id = l.id
    WHERE (nullif(btrim(l.tech_name),'') IS NOT NULL OR nullif(btrim(l.tech_number),'') IS NOT NULL)
      AND (l.scheduled_date IS NOT NULL OR l.status IN ('scheduled','job_in_progress','payment_pending','payment_requested','job_done'))
      AND l.status NOT IN ('paid','partial_paid','cancelled','scammed','done','completed')
      AND l.created_at >= now() - interval '30 days'
      AND public.processor_tech_phone_key(l.tech_number) IS NOT NULL
      AND (t.retry_at IS NULL OR t.retry_at <= now())
  ), reasons AS (
    SELECT b.id, b.checked_at, CASE
      WHEN b.result IS NULL OR b.result->>'policy' IS DISTINCT FROM '11' OR b.result->>'tech_phone' IS DISTINCT FROM b.phone THEN 2
      WHEN b.lead_updated_at IS DISTINCT FROM b.updated_at
        OR nullif(b.result->>'mirror_last_message_at','')::timestamptz IS DISTINCT FROM b.tech_last
        -- A new customer message, once a check has read the customer's chat. An
        -- unreadable customer chat is not compared, so it cannot loop the queue.
        OR (b.result->'customer_chat'->>'state' IN ('read','none')
          AND nullif(b.result#>>'{customer_chat,last_message_at}','')::timestamptz IS DISTINCT FROM b.customer_last) THEN 1
      WHEN (b.status IN ('payment_pending','job_done') OR b.result->>'job_update' = 'completed'
          OR b.result->>'share_state' IN ('requested','promised','sent'))
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
        OR nullif(a.result->>'mirror_last_message_at','')::timestamptz IS DISTINCT FROM c.last_message_time
        OR (a.result->'customer_chat'->>'state' IN ('read','none')
          AND nullif(a.result#>>'{customer_chat,last_message_at}','')::timestamptz IS DISTINCT FROM public.processor_customer_last_message(l.id,l.customer_phone))), false) AS ai_stale,
      public.processor_board_status(l.status,l.scheduled_date,l.scheduled_time_start,l.tech_number,a.result,p_timezone,now()) AS board_status
    FROM public.leads l
    LEFT JOIN public.processor_job_assessments a ON a.lead_id=l.id
    LEFT JOIN public.quo_conversations c ON c.id=nullif(a.result->>'mirror_conversation_id','')::uuid
    WHERE (nullif(btrim(l.tech_name),'') IS NOT NULL OR nullif(btrim(l.tech_number),'') IS NOT NULL)
      AND (l.scheduled_date IS NOT NULL OR l.status IN ('scheduled','job_in_progress','payment_pending','payment_requested','job_done'))
      AND l.status NOT IN ('paid','partial_paid','cancelled','scammed','done','completed')
      AND l.created_at >= now() - interval '30 days'
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
        'share_state',m.result->'share_state','rules_only',m.result->'rules_only',
        'took_job_at',m.result#>'{timeline,took_job,at}','share_at',coalesce(m.result#>'{timeline,share_received,at}',m.result#>'{timeline,share_sent,at}',m.result#>'{timeline,share_promised,at}',m.result#>'{timeline,share_requested,at}'),
        'checked_by',m.result->'checked_by')) END AS ai_summary,
      m.ai_stale
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

-- Rollback: re-run processor_board_due_jobs and list_processor_board_jobs from
-- 20261126000000_processor_board_last_30_days.sql (customer messages then no
-- longer re-check a job; saved results stay readable).
