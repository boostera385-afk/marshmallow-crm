-- Purpose: avoid materializing complete recipient history and computing action
-- metadata for every historical row on each notification alert poll. Reuse the
-- existing (user_id, read, created_at) index; no new index/write amplification.
-- Prerequisite: workflow resolution/notification schema is already installed.
-- Apply manually after review. No RLS, grants, API, schedule or data changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.workflow_notifications(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  a text:=p_input->>'action'; category text:=coalesce(p_input->>'category','all');
  view_name text:=coalesce(p_input->>'view','all'); search_text text:=btrim(coalesce(p_input->>'search',''));
  page_offset integer:=coalesce((p_input->>'offset')::integer,0); result jsonb; destination text;
  caller uuid:=auth.uid(); role_name text:=marshmallow_private.workflow_role();
  event public.workflow_notification_events%rowtype; request_row public.lead_cx_update_requests%rowtype;
BEGIN
  IF role_name IS NULL OR role_name NOT IN ('admin','processor','cs_admin','customer_service') THEN
    RAISE EXCEPTION 'Notification center access denied' USING errcode='42501'; END IF;
  IF a NOT IN ('list','alerts','read','open') OR a IS NULL OR page_offset<0 OR length(search_text)>100
    OR category NOT IN ('all','cx','tech','schedule','other') OR view_name NOT IN ('all','unread','action') THEN
    RAISE EXCEPTION 'Invalid notification query' USING errcode='22023'; END IF;
  IF a IN ('read','open') THEN
    IF a='open' THEN
      IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE id=(p_input->>'notificationId')::uuid AND user_id=caller) THEN
        RAISE EXCEPTION 'Notification unavailable' USING errcode='42501'; END IF;
      SELECT e.* INTO event FROM public.workflow_notification_events e JOIN public.notifications n ON n.id=e.notification_id
        WHERE n.id=(p_input->>'notificationId')::uuid AND n.user_id=caller;
      IF found THEN
        IF event.request_id IS NOT NULL THEN
          SELECT * INTO request_row FROM public.lead_cx_update_requests WHERE id=event.request_id;
          IF NOT found THEN RAISE EXCEPTION 'You no longer have access to this request' USING errcode='42501'; END IF;
          destination:='/get-'||event.request_kind||'-update?request='||event.request_id;
        ELSE
          IF NOT EXISTS(SELECT 1 FROM public.leads l WHERE id=event.lead_id AND marshmallow_private.workflow_job_visible_to(caller,l)) THEN RAISE EXCEPTION 'You no longer have access to this job' USING errcode='42501'; END IF;
          destination:='/leads/'||event.lead_id;
        END IF;
      END IF;
    END IF;
    -- Snapshot IDs only; reading never resolves a request or clears future rows.
    IF a='open' THEN
      UPDATE public.notifications SET read=true WHERE id=(p_input->>'notificationId')::uuid AND user_id=caller;
    ELSE
      IF jsonb_array_length(p_input->'ids')>100 THEN RAISE EXCEPTION 'Select at most 100 notifications' USING errcode='22023'; END IF;
      UPDATE public.notifications SET read=true WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_input->'ids')) AND user_id=caller;
    END IF;
    RETURN jsonb_build_object('saved',true,'href',destination);
  END IF;
  -- These reads need different row sets: the page/total respects its filters;
  -- unread_count remains exact across ALL currently visible unread notifications.
  -- Inlining permits independent predicate pushdown and projection pruning. In
  -- particular the unread aggregate does not evaluate unused action expressions.
  WITH visible AS NOT MATERIALIZED (
    SELECT n.id,n.title,n.message,n.lead_id,n.read,n.created_at,e.event_type,e.request_kind,e.request_id,e.revision,e.job_id,
      coalesce(e.revision=r.revision AND ((e.event_type='update_requested' AND r.status='pending' AND r.acknowledged_at IS NULL AND
        ((e.request_kind='cx' AND (role_name='cs_admin' OR r.recipient_cs=caller)) OR
         (e.request_kind='tech' AND role_name='processor')))
       OR (e.event_type='update_answered' AND r.status<>'pending' AND r.acknowledged_at IS NULL
          AND marshmallow_private.workflow_resolution_owner(r)=caller)),false) AS action_required
    FROM public.notifications n LEFT JOIN public.workflow_notification_events e ON e.notification_id=n.id
    LEFT JOIN public.lead_cx_update_requests r ON r.id=e.request_id
    WHERE n.user_id=caller
      AND (e.notification_id IS NULL OR (e.request_id IS NOT NULL AND r.id IS NOT NULL)
        OR (e.request_id IS NULL AND EXISTS(SELECT 1 FROM public.leads l WHERE id=e.lead_id AND marshmallow_private.workflow_job_visible_to(caller,l))))
  ), filtered AS (
    SELECT * FROM visible v WHERE
      (category='all' OR (category IN ('cx','tech') AND request_kind=category) OR (category='schedule' AND event_type='schedule_ready') OR (category='other' AND event_type IS NULL))
      AND (search_text='' OR position(lower(search_text) IN lower(coalesce(job_id,'')||' '||title||' '||message))>0)
      AND (nullif(p_input->>'since','') IS NULL OR created_at >= (p_input->>'since')::timestamptz)
      AND (nullif(p_input->>'until','') IS NULL OR created_at < (p_input->>'until')::timestamptz)
      AND (view_name='all' OR (view_name='unread' AND NOT read) OR (view_name='action' AND action_required))
      AND (a<>'alerts' OR (event_type IN ('update_requested','update_answered','schedule_ready')
        AND NOT read AND created_at >= (p_input->>'after')::timestamptz))
  ), page AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT CASE WHEN a='alerts' THEN 100 ELSE 20 END OFFSET page_offset)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered),'unread_count',(SELECT count(*) FROM visible WHERE NOT read)) INTO result;
  RETURN result;
END $$;

COMMIT;
-- Rollback: restore ONLY public.workflow_notifications(jsonb) from the reviewed
-- 20261020065810_workflow_resolution_notifications.sql function definition.
-- Do not replay that entire migration, drop event history, or relax any RLS.
-- This replaces only the query plan, so neither type regeneration nor a backend
-- deployment is required for this SQL change. CRM polling intervals are unchanged.
