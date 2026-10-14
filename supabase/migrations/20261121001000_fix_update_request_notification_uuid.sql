-- Purpose: fix SQLSTATE 42804 when Get Tech Update creates notifications.
-- SELECT DISTINCT resolves an untyped NULL output as text before the INSERT,
-- while notifications.lead_id is uuid. Explicit uuid NULLs keep queue links
-- intentionally empty without changing leads, request history, or permissions.
-- Apply manually after 20261120001000_tech_update_requests_and_followups.sql.

BEGIN;

CREATE OR REPLACE FUNCTION marshmallow_private.update_requests(
  p_kind text, p_action text, p_lead_id uuid, p_request_id uuid, p_text text, p_offset integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  caller uuid := auth.uid();
  caller_role text;
  caller_name text;
  updated_status text;
  lead_row public.leads%rowtype;
  request_row public.lead_cx_update_requests%rowtype;
  recipient uuid;
  rows_json jsonb;
  total bigint;
BEGIN
  SELECT CASE WHEN count(*) = 1 THEN min(ur.role::text) ELSE NULL END, max(p.full_name)
    INTO caller_role, caller_name
    FROM public.user_roles ur LEFT JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.user_id = caller;
  IF caller IS NULL OR caller_role IS NULL OR caller_role NOT IN ('admin','processor','cs_admin','customer_service') THEN
    RAISE EXCEPTION 'Update request access denied' USING errcode = '42501';
  END IF;
  IF p_kind NOT IN ('cx','tech') OR p_kind IS NULL THEN
    RAISE EXCEPTION 'Invalid update request kind' USING errcode = '22023';
  END IF;
  IF p_action NOT IN ('list_pending','list_updated','count','create','complete','acknowledge','question_more') OR p_action IS NULL THEN
    RAISE EXCEPTION 'Invalid update request action' USING errcode = '22023';
  END IF;
  updated_status := CASE WHEN p_kind = 'cx' THEN 'cs_updated' ELSE 'tech_updated' END;

  IF p_action IN ('list_pending','list_updated','count') THEN
    IF p_offset IS NULL OR p_offset < 0 THEN RAISE EXCEPTION 'Invalid queue page' USING errcode = '22023'; END IF;
    IF p_action = 'list_updated' AND (
      (p_kind = 'cx' AND caller_role NOT IN ('admin','processor'))
      OR (p_kind = 'tech' AND caller_role NOT IN ('cs_admin','customer_service'))
    ) THEN RAISE EXCEPTION 'Completed requests are restricted to their requesting team' USING errcode = '42501'; END IF;

    IF p_action = 'count' THEN
      SELECT count(*) INTO total FROM public.lead_cx_update_requests r
       WHERE r.request_kind = p_kind AND r.acknowledged_at IS NULL AND (
         (r.status = 'pending' AND (
           (p_kind = 'cx' AND (caller_role IN ('admin','processor','cs_admin') OR r.recipient_cs = caller))
           OR (p_kind = 'tech' AND (caller_role IN ('admin','processor','cs_admin') OR r.requested_by = caller))
         ))
         OR (r.status = updated_status AND (
           (p_kind = 'cx' AND caller_role IN ('admin','processor'))
           OR (p_kind = 'tech' AND (caller_role = 'cs_admin' OR r.requested_by = caller))
         ))
       );
      RETURN jsonb_build_object('count', total);
    END IF;

    SELECT count(*) INTO total FROM public.lead_cx_update_requests r
     WHERE r.request_kind = p_kind
       AND r.status = CASE WHEN p_action = 'list_pending' THEN 'pending' ELSE updated_status END
       AND r.acknowledged_at IS NULL
       AND (
         (p_action = 'list_pending' AND (
           (p_kind = 'cx' AND (caller_role IN ('admin','processor','cs_admin') OR r.recipient_cs = caller))
           OR (p_kind = 'tech' AND (caller_role IN ('admin','processor','cs_admin') OR r.requested_by = caller))
         ))
         OR (p_action = 'list_updated' AND (
           (p_kind = 'cx' AND caller_role IN ('admin','processor'))
           OR (p_kind = 'tech' AND (caller_role = 'cs_admin' OR r.requested_by = caller))
         ))
       );

    SELECT coalesce(jsonb_agg(q.item ORDER BY q.created_at DESC, q.id), '[]'::jsonb) INTO rows_json FROM (
      SELECT r.created_at, r.id, jsonb_build_object(
        'id', r.id, 'lead_id', r.lead_id, 'request_kind', r.request_kind,
        'requested_by', r.requested_by, 'requester_name', requester.full_name,
        'recipient_cs', r.recipient_cs, 'recipient_name', cs.full_name,
        'request_text', r.request_text, 'status', r.status, 'response_text', r.response_text,
        'completed_at', r.completed_at, 'completed_by_name', responder.full_name,
        'created_at', r.created_at, 'thread', r.thread,
        'customer', jsonb_build_object(
          'job_id', l.job_id, 'customer_name', l.customer_name, 'customer_phone', l.customer_phone,
          'customer_landline', l.customer_landline, 'customer_email', l.customer_email,
          'service_type', l.service_type, 'service_details', l.service_details,
          'address', l.address, 'city', l.city, 'state', l.state, 'zip_code', l.zip_code,
          'customer_schedule_requirements', l.customer_schedule_requirements,
          'scheduled_date', l.scheduled_date, 'scheduled_time_start', l.scheduled_time_start,
          'scheduled_time_end', l.scheduled_time_end
        ),
        'technician', CASE WHEN p_kind = 'tech' AND caller_role IN ('admin','processor') THEN jsonb_build_object(
          'status', l.status, 'tech_name', l.tech_name, 'tech_number', l.tech_number, 'terms', l.terms
        ) ELSE NULL END
      ) item
      FROM public.lead_cx_update_requests r JOIN public.leads l ON l.id = r.lead_id
      LEFT JOIN public.profiles requester ON requester.id = r.requested_by
      LEFT JOIN public.profiles cs ON cs.id = r.recipient_cs
      LEFT JOIN public.profiles responder ON responder.id = r.completed_by
      WHERE r.request_kind = p_kind
        AND r.status = CASE WHEN p_action = 'list_pending' THEN 'pending' ELSE updated_status END
        AND r.acknowledged_at IS NULL
        AND (
          (p_action = 'list_pending' AND (
            (p_kind = 'cx' AND (caller_role IN ('admin','processor','cs_admin') OR r.recipient_cs = caller))
            OR (p_kind = 'tech' AND (caller_role IN ('admin','processor','cs_admin') OR r.requested_by = caller))
          ))
          OR (p_action = 'list_updated' AND (
            (p_kind = 'cx' AND caller_role IN ('admin','processor'))
            OR (p_kind = 'tech' AND (caller_role = 'cs_admin' OR r.requested_by = caller))
          ))
        )
      ORDER BY r.created_at DESC, r.id LIMIT 20 OFFSET p_offset
    ) q;
    RETURN jsonb_build_object('rows', rows_json, 'total', total);
  END IF;

  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request ID is required' USING errcode = '22023'; END IF;

  IF p_action = 'create' THEN
    IF (p_kind = 'cx' AND caller_role NOT IN ('admin','processor'))
       OR (p_kind = 'tech' AND caller_role NOT IN ('cs_admin','customer_service')) THEN
      RAISE EXCEPTION 'Your role cannot create this update request' USING errcode = '42501';
    END IF;
    IF p_text IS NULL OR length(btrim(p_text)) NOT BETWEEN 1 AND 2000 THEN
      RAISE EXCEPTION 'Describe the required update (1–2000 characters)' USING errcode = '22023';
    END IF;
    SELECT * INTO lead_row FROM public.leads WHERE id = p_lead_id FOR UPDATE;
    IF NOT found THEN RAISE EXCEPTION 'Lead unavailable' USING errcode = '42501'; END IF;
    -- The private function is callable only so the invoker wrapper can reach it;
    -- repeat lead visibility here so a direct private call cannot bypass RLS.
    IF p_kind = 'tech' AND (
      (caller_role = 'customer_service' AND NOT (
        lead_row.created_by = caller OR lead_row.assigned_cs = caller
        OR EXISTS (SELECT 1 FROM public.lead_shares s WHERE s.lead_id = lead_row.id AND s.shared_with_user_id = caller)
      ))
      OR (caller_role = 'cs_admin' AND lead_row.status IN ('paid','partial_paid','cancelled','job_done','scammed'))
    ) THEN RAISE EXCEPTION 'Lead outside your access scope' USING errcode = '42501'; END IF;
    SELECT * INTO request_row FROM public.lead_cx_update_requests WHERE id = p_request_id;
    IF found THEN
      IF request_row.requested_by = caller AND request_row.lead_id = p_lead_id
         AND request_row.request_kind = p_kind AND request_row.request_text = btrim(p_text) THEN
        RETURN jsonb_build_object('saved', true, 'id', request_row.id);
      END IF;
      RAISE EXCEPTION 'Request ID already used' USING errcode = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.lead_cx_update_requests WHERE lead_id = p_lead_id AND request_kind = p_kind AND status = 'pending') THEN
      RAISE EXCEPTION 'This lead already has a pending update request' USING errcode = '23505';
    END IF;
    recipient := NULL;
    IF p_kind = 'cx' THEN
      recipient := coalesce(lead_row.assigned_cs, lead_row.created_by);
      IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = recipient
        GROUP BY user_id HAVING count(*) = 1 AND min(role::text) = 'customer_service') THEN recipient := NULL; END IF;
    END IF;
    INSERT INTO public.lead_cx_update_requests(id, lead_id, requested_by, recipient_cs, request_text, request_kind, thread)
    VALUES (p_request_id, p_lead_id, caller, recipient, btrim(p_text), p_kind,
      jsonb_build_array(jsonb_build_object('type','question','text',btrim(p_text),'at',now(),'by_name',caller_name)));
    IF p_kind = 'cx' THEN
      INSERT INTO public.notifications(user_id, title, message, lead_id)
        SELECT DISTINCT ur.user_id, 'Get CX Update', 'A customer update has been requested. Open Get CX Update.', NULL::uuid
        FROM public.user_roles ur WHERE ur.role::text = 'cs_admin' OR ur.user_id = recipient;
    ELSE
      INSERT INTO public.notifications(user_id, title, message, lead_id)
        SELECT DISTINCT ur.user_id, 'Get Tech Update', 'A technician update has been requested. Open Get Tech Update.', NULL::uuid
        FROM public.user_roles ur WHERE ur.role::text IN ('admin','processor');
    END IF;
  ELSE
    SELECT * INTO request_row FROM public.lead_cx_update_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT found OR request_row.request_kind <> p_kind THEN RAISE EXCEPTION 'Request unavailable' USING errcode = '42501'; END IF;

    IF p_action = 'complete' THEN
      IF (p_kind = 'cx' AND caller_role <> 'cs_admin' AND (caller_role <> 'customer_service' OR request_row.recipient_cs IS DISTINCT FROM caller))
         OR (p_kind = 'tech' AND caller_role <> 'processor') THEN
        RAISE EXCEPTION 'Your role cannot complete this request' USING errcode = '42501';
      END IF;
      IF p_text IS NULL OR length(btrim(p_text)) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION 'Enter the update (1–4000 characters)' USING errcode = '22023';
      END IF;
      IF request_row.status <> 'pending' THEN
        IF request_row.completed_by = caller AND request_row.response_text = btrim(p_text) THEN
          RETURN jsonb_build_object('saved', true, 'id', p_request_id);
        END IF;
        RAISE EXCEPTION 'This request was already updated. Refresh the queue.' USING errcode = '40001';
      END IF;
      UPDATE public.lead_cx_update_requests SET status = updated_status, response_text = btrim(p_text),
        completed_by = caller, completed_at = now(),
        thread = coalesce(thread, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('type','response','text',btrim(p_text),'at',now(),'by_name',caller_name))
      WHERE id = p_request_id;
      IF p_kind = 'cx' THEN
        INSERT INTO public.notifications(user_id, title, message, lead_id)
          SELECT DISTINCT ur.user_id, 'CS Updated', 'A customer response is ready. Open Get CX Update → CS Updated.', NULL::uuid
          FROM public.user_roles ur WHERE ur.role::text = 'admin' OR ur.user_id = request_row.requested_by;
      ELSE
        INSERT INTO public.notifications(user_id, title, message, lead_id)
          SELECT DISTINCT ur.user_id, 'Tech Updated', 'A Processor response is ready. Open Get Tech Update → Tech Updated.', NULL::uuid
          FROM public.user_roles ur WHERE ur.role::text = 'cs_admin' OR ur.user_id = request_row.requested_by;
      END IF;
    ELSIF p_action = 'question_more' THEN
      IF (p_kind = 'cx' AND caller_role <> 'admin' AND (caller_role <> 'processor' OR request_row.requested_by IS DISTINCT FROM caller))
         OR (p_kind = 'tech' AND caller_role <> 'cs_admin' AND (caller_role <> 'customer_service' OR request_row.requested_by IS DISTINCT FROM caller)) THEN
        RAISE EXCEPTION 'Only the requester or supervising role may ask a follow-up' USING errcode = '42501';
      END IF;
      IF request_row.status <> updated_status THEN RAISE EXCEPTION 'This update is not ready for follow-up' USING errcode = '22023'; END IF;
      IF p_text IS NULL OR length(btrim(p_text)) NOT BETWEEN 1 AND 2000 THEN
        RAISE EXCEPTION 'Enter a follow-up question (1–2000 characters)' USING errcode = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.lead_cx_update_requests r WHERE r.lead_id = request_row.lead_id
        AND r.request_kind = p_kind AND r.status = 'pending' AND r.id <> p_request_id) THEN
        RAISE EXCEPTION 'This lead already has another pending update request' USING errcode = '23505';
      END IF;
      UPDATE public.lead_cx_update_requests SET status = 'pending', request_text = btrim(p_text), response_text = NULL,
        completed_by = NULL, completed_at = NULL, acknowledged_at = NULL,
        thread = coalesce(thread, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('type','question','text',btrim(p_text),'at',now(),'by_name',caller_name))
      WHERE id = p_request_id;
      IF p_kind = 'cx' THEN
        INSERT INTO public.notifications(user_id, title, message, lead_id)
          SELECT DISTINCT ur.user_id, 'Get CX Update', 'A follow-up customer question is ready. Open Get CX Update.', NULL::uuid
          FROM public.user_roles ur WHERE ur.role::text = 'cs_admin' OR ur.user_id = request_row.recipient_cs;
      ELSE
        INSERT INTO public.notifications(user_id, title, message, lead_id)
          SELECT DISTINCT ur.user_id, 'Get Tech Update', 'A follow-up technician question is ready. Open Get Tech Update.', NULL::uuid
          FROM public.user_roles ur WHERE ur.role::text IN ('admin','processor');
      END IF;
    ELSE
      IF (p_kind = 'cx' AND caller_role <> 'admin' AND (caller_role <> 'processor' OR request_row.requested_by IS DISTINCT FROM caller))
         OR (p_kind = 'tech' AND caller_role <> 'cs_admin' AND (caller_role <> 'customer_service' OR request_row.requested_by IS DISTINCT FROM caller)) THEN
        RAISE EXCEPTION 'Only the requester or supervising role may acknowledge this response' USING errcode = '42501';
      END IF;
      IF request_row.status <> updated_status THEN RAISE EXCEPTION 'The update is not completed yet' USING errcode = '22023'; END IF;
      IF request_row.acknowledged_at IS NOT NULL THEN RETURN jsonb_build_object('saved', true, 'id', p_request_id); END IF;
      UPDATE public.lead_cx_update_requests SET acknowledged_at = now() WHERE id = p_request_id;
    END IF;
  END IF;

  INSERT INTO public.activity_logs(user_id, user_name, action, target_type, target_id, details)
    VALUES (caller, coalesce(caller_name, 'Unknown'), p_kind || '_update_' || p_action, 'lead',
      (CASE WHEN p_action = 'create' THEN lead_row.id ELSE request_row.lead_id END)::text,
      upper(p_kind) || ' update request ' || p_request_id::text);
  RETURN jsonb_build_object('saved', true, 'id', p_request_id);
END;
$fn$;

REVOKE ALL ON FUNCTION marshmallow_private.update_requests(text,text,uuid,uuid,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.update_requests(text,text,uuid,uuid,text,integer) TO authenticated;

COMMIT;

-- Rollback: restore the private update_requests function from migration
-- 20261120001000. Existing requests, notifications, and leads require no repair.
