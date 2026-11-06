-- =============================================================================
-- AI schedule confirmation: "Customer Require New Schedule" when the customer
-- asks for a different time
-- =============================================================================
-- Defect / purpose (business rule from 2026-11-06): the AI moved jobs to Ready to
-- schedule when the customer proposed their own date ("How about the 14th?",
-- "09:30 and 10:30 on Saturday", "In about 1 week"). Ready to schedule must mean
-- the customer clearly accepted the day/time window OUR TEAM sent, unchanged.
-- When the customer names, asks for or suggests their own/a different day or
-- time, narrows or conditions our window, or turned our time down (even if they
-- later accepted a new time we sent), the job needs a person to set a new
-- schedule: the AI now moves the tag to "Customer Require New Schedule"
-- (existing value `confirmation_sent`, label in src/types/index.ts).
--
-- What this changes:
--   * finish_schedule_check accepts decision 'new_schedule_needed'. It passes the
--     same deterministic guards as 'confirmed' (eligibility, conversation match,
--     single waiting job for the customer, 24-hour freshness, and the quote must
--     be the customer's own words after the tag). Automatic mode then changes
--     only waiting_schedule_confirmation -> confirmation_sent, marked AI.
--     Shadow records the decision without changing anything.
--   * New workflow notification event 'schedule_new_needed' to the same people as
--     schedule_ready (lead's CS, CS Admins, Admins, Processors who can see the job),
--     with the customer's words. Included in the Schedule category and pop-ups.
--   * workflow_notifications is re-created from the body found in production on
--     2026-11-06 (it differs from 20261020065810 — production had a newer,
--     NOT MATERIALIZED version applied outside this repository), changing only the
--     two event-type lists.
--
-- Not changed: lead status, agreed schedule fields, technician, quote, payment,
-- approvals, RLS policies, grants, worker claim, queue triggers, Admin controls.
-- No UPDATE of existing lead rows. Re-tagging a job to Waiting resets the AI's
-- starting point (existing capture_schedule_job trigger).
--
-- Apply manually after 20261201000000. Requires schedule-confirmation-monitor
-- with decision new_schedule_needed (deploy the worker AFTER this migration: the
-- previous finish function rejects the new decision as 'Invalid assessment').
-- Harnesses (isolated only): supabase/tests/160_schedule_confirmation_monitor.sql;
-- read-only post-install: supabase/tests/151_workflow_inbox_readonly.sql.
-- =============================================================================
BEGIN;

-- 1. New notification event type ------------------------------------------------
ALTER TABLE public.workflow_notification_events DROP CONSTRAINT IF EXISTS workflow_notification_events_event_type_check;
ALTER TABLE public.workflow_notification_events ADD CONSTRAINT workflow_notification_events_event_type_check
  CHECK (event_type IN ('update_requested', 'update_answered', 'update_resolved', 'schedule_ready', 'schedule_new_needed'));

-- 2. Finish: confirmed -> Ready to schedule; new_schedule_needed -> Customer Require New Schedule
CREATE OR REPLACE FUNCTION public.finish_schedule_check(p_input jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  l public.leads%rowtype; q marshmallow_private.schedule_monitor_queue%rowtype;
  c marshmallow_private.schedule_monitor_config%rowtype; conv public.quo_conversations%rowtype;
  users uuid[]; applied boolean := false; conv_found boolean;
  decision text := p_input->'result'->>'decision';
  quote text := btrim(coalesce(p_input->'result'->>'quote', ''));
  guard text := NULL; details text; schedule_text text;
  new_tag text; tag_label text; event_name text; title text; log_action text;
BEGIN
  SELECT * INTO c FROM marshmallow_private.schedule_monitor_config WHERE id FOR UPDATE;
  SELECT * INTO l FROM public.leads WHERE id = (p_input->>'lead_id')::uuid FOR UPDATE;
  SELECT * INTO q FROM marshmallow_private.schedule_monitor_queue WHERE lead_id = l.id FOR UPDATE;
  IF q.lease IS NULL OR q.lease IS DISTINCT FROM (p_input->>'lease')::uuid OR q.generation <> (p_input->>'generation')::integer
    OR q.lease_until < now() OR c.mode = 'off' OR marshmallow_private.schedule_ingestion_paused()
    OR c.mode IS DISTINCT FROM p_input->>'mode' OR c.changed_at IS DISTINCT FROM (p_input->>'config_changed_at')::timestamptz THEN
    RETURN false;
  END IF;
  IF decision IS NULL OR decision NOT IN ('confirmed', 'new_schedule_needed', 'needs_review', 'unavailable') THEN
    RAISE EXCEPTION 'Invalid assessment' USING errcode = '22023';
  END IF;

  -- Deterministic authority, independent of the AI's answer. Both tag-changing
  -- decisions need the same proof: the customer's own words in this job's chat.
  IF decision IN ('confirmed', 'new_schedule_needed') THEN
    SELECT * INTO conv FROM public.quo_conversations WHERE id = (q.evidence->>'conversation_id')::uuid;
    conv_found := FOUND;
    IF NOT marshmallow_private.schedule_eligible(l) THEN
      guard := 'Job is no longer eligible (status, tag or a pending approval changed).';
    ELSIF q.evidence IS NULL OR NOT conv_found OR NOT marshmallow_private.schedule_conversation_matches(conv, l) THEN
      guard := 'The customer conversation no longer matches this job.';
    ELSIF marshmallow_private.schedule_waiting_matches(conv.id) > 1 THEN
      guard := 'This customer has more than one job waiting for schedule confirmation.';
    ELSIF (q.evidence->>'message_time')::timestamptz NOT BETWEEN greatest(q.entered_at, now() - interval '24 hours') AND now() + interval '5 minutes' THEN
      guard := 'The latest message is too old to act on.';
    ELSIF NOT marshmallow_private.schedule_quote_is_customer(conv, l, q.entered_at, quote) THEN
      guard := 'The AI did not quote the customer''s own words from a text or call.';
    END IF;
    IF guard IS NOT NULL THEN decision := 'needs_review'; END IF;
  END IF;

  IF decision IN ('confirmed', 'new_schedule_needed') AND c.mode = 'automatic' THEN
    IF decision = 'confirmed' THEN
      new_tag := 'ready_to_schedule'; tag_label := 'Ready to schedule'; event_name := 'schedule_ready';
      title := 'AI: Customer confirmed schedule — Ready to schedule'; log_action := 'schedule_confirmation_tag_applied';
    ELSE
      new_tag := 'confirmation_sent'; tag_label := 'Customer Require New Schedule'; event_name := 'schedule_new_needed';
      title := 'AI: Customer requires new schedule'; log_action := 'schedule_new_schedule_tag_applied';
    END IF;
    PERFORM set_config('marshmallow.cs_tag_source', 'ai', true);
    EXECUTE format('UPDATE %I.%I SET cs_tag=$1 WHERE id=$2 AND cs_tag=$3', 'public', 'leads')
      USING new_tag, l.id, 'waiting_schedule_confirmation';
    PERFORM set_config('marshmallow.cs_tag_source', '', true);
    applied := true;

    schedule_text := coalesce(nullif(btrim(l.customer_schedule_requirements), ''),
      nullif(concat_ws(' ', l.scheduled_date::text, to_char(l.scheduled_time_start, 'HH24:MI')), ''), 'Not saved');
    details := concat_ws(E'\n',
      'Job ID: ' || l.job_id,
      'Customer: ' || coalesce(nullif(btrim(l.customer_name), ''), 'Unknown'),
      'Service: ' || coalesce(nullif(btrim(l.service_type), ''), 'Not set'),
      CASE WHEN nullif(btrim(concat_ws(', ', nullif(btrim(l.city), ''), nullif(btrim(l.state), ''))), '') IS NOT NULL
        THEN 'Location: ' || concat_ws(', ', nullif(btrim(l.city), ''), nullif(btrim(l.state), '')) END,
      'Schedule: ' || left(schedule_text, 200),
      'Customer said: "' || left(quote, 200) || '"',
      'Tag changed by AI: Waiting for CX for schedule confirmation -> ' || tag_label);

    SELECT array_agg(DISTINCT ur.user_id) INTO users FROM public.user_roles ur WHERE (
      ur.role::text IN ('admin', 'processor', 'cs_admin') OR (ur.role::text = 'customer_service' AND (
        l.created_by = ur.user_id OR l.assigned_cs = ur.user_id
        OR EXISTS (SELECT 1 FROM public.lead_shares s WHERE s.lead_id = l.id AND s.shared_with_user_id = ur.user_id))))
      AND marshmallow_private.workflow_job_visible_to(ur.user_id, l);
    PERFORM marshmallow_private.workflow_notify(users, event_name, title, details, l.id, l.job_id, NULL, NULL, q.generation);
    INSERT INTO public.activity_logs(user_id, user_name, action, target_type, target_id, details)
      VALUES (NULL, 'AI schedule confirmation', log_action, 'lead', l.id::text,
        'AI changed tag Waiting for CX for schedule confirmation -> ' || tag_label || '. Customer said: "' || left(quote, 300)
        || '" (latest message ' || (q.evidence->>'id') || '). Status and agreed schedule unchanged.');
  END IF;

  UPDATE marshmallow_private.schedule_monitor_queue SET lease = NULL, lease_until = NULL, checked_at = now(),
    result = jsonb_build_object('decision', decision,
      'reason', left(coalesce(guard, p_input->'result'->>'reason', ''), 500),
      'quote', nullif(left(quote, 300), ''), 'evidence_id', q.evidence->>'id', 'applied', applied),
    state = CASE WHEN decision = 'unavailable' AND q.attempts < 5 THEN 'pending' ELSE 'checked' END,
    available_at = now() + make_interval(secs => least(3600, 60 * power(2, least(q.attempts, 5)))::integer)
  WHERE lead_id = l.id;
  IF p_input->>'provider_status' = '429' THEN
    UPDATE marshmallow_private.schedule_monitor_config SET cooldown_until = now() + interval '15 minutes' WHERE id;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_schedule_check(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_schedule_check(jsonb) TO service_role;

-- 3. Notification center: the new event is a Schedule notification and a pop-up.
-- Body copied from production (2026-11-06); only the two event-type lists changed.
CREATE OR REPLACE FUNCTION public.workflow_notifications(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      (category='all' OR (category IN ('cx','tech') AND request_kind=category) OR (category='schedule' AND event_type IN ('schedule_ready','schedule_new_needed')) OR (category='other' AND event_type IS NULL))
      AND (search_text='' OR position(lower(search_text) IN lower(coalesce(job_id,'')||' '||title||' '||message))>0)
      AND (nullif(p_input->>'since','') IS NULL OR created_at >= (p_input->>'since')::timestamptz)
      AND (nullif(p_input->>'until','') IS NULL OR created_at < (p_input->>'until')::timestamptz)
      AND (view_name='all' OR (view_name='unread' AND NOT read) OR (view_name='action' AND action_required))
      AND (a<>'alerts' OR (event_type IN ('update_requested','update_answered','schedule_ready','schedule_new_needed')
        AND NOT read AND created_at >= (p_input->>'after')::timestamptz))
  ), page AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT CASE WHEN a='alerts' THEN 100 ELSE 20 END OFFSET page_offset)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered),'unread_count',(SELECT count(*) FROM visible WHERE NOT read)) INTO result;
  RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.workflow_notifications(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workflow_notifications(jsonb) TO authenticated;

COMMIT;

-- =============================================================================
-- Rollback (manual, reviewed):
--   1. Turn the AI Off in Notifications (kill switch), and redeploy the previous
--      schedule-confirmation-monitor (v10) so the worker stops sending the new
--      decision.
--   2. Re-run section 3 ("Finish") of 20261201000000_ai_schedule_confirmation_calls.sql
--      to restore finish_schedule_check without 'new_schedule_needed'.
--   3. Re-create workflow_notifications from the body above with the two lists
--      back to ('schedule_ready') / ('update_requested','update_answered','schedule_ready').
--   4. Only after no rows use it: DELETE is NOT part of rollback; keep history.
--      If 'schedule_new_needed' rows exist, leave the widened CHECK in place.
-- Leads already moved to Customer Require New Schedule keep that tag (a person
-- can change it). No lead data is changed by this migration or its rollback.
-- =============================================================================
