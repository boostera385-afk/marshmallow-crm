-- =============================================================================
-- AI schedule confirmation: also react to our texts, calls and call transcripts
-- =============================================================================
-- Purpose: 20261130000000 started a check only when the CUSTOMER texted. The
-- team also confirms schedules on the phone and in our own texts, so a check now
-- starts on any trusted (webhook / service-role) event in the matched chat after
-- the lead entered the waiting tag: customer texts, our texts, calls, call
-- transcripts, call summaries.
--
-- The AI now reads calls too. Call transcripts are read from the stored Quo
-- dialogue (raw_payload), where each line is either a Quo user (our team) or a
-- phone number. Only lines from the customer's number count as the customer.
--
-- Proof rule unchanged in spirit: the tag changes only when the AI quotes the
-- CUSTOMER's own words, now from a customer text OR from the customer's lines in a
-- call transcript received after the tag was set. Our team's words and Quo's call
-- summaries are context, never proof.
--
-- Not changed: eligibility, single-match rule, 24-hour freshness, notifications,
-- AI marker, Admin control. No lead rows are updated. Apply after 20261130000000.
-- Harness: supabase/tests/160_schedule_confirmation_monitor.sql (isolated only);
-- read-only post-install: supabase/tests/151_workflow_inbox_readonly.sql.
-- =============================================================================
BEGIN;

-- What kind of event a stored Quo message is.
CREATE OR REPLACE FUNCTION marshmallow_private.schedule_event_kind(p_quo_message_id text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN coalesce(p_quo_message_id, '') LIKE '%:call.transcript.completed' THEN 'call_transcript'
    WHEN coalesce(p_quo_message_id, '') LIKE '%:call.summary.completed' THEN 'call_summary'
    WHEN coalesce(p_quo_message_id, '') LIKE '%:%' THEN 'call'
    ELSE 'text' END;
$$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_event_kind(text) FROM PUBLIC, anon, authenticated;

-- Speaker-attributed lines of a stored call transcript. A line with a Quo user id
-- is our team; a line whose phone matches one of p_customer_keys is the customer;
-- anything else is unknown and never treated as the customer.
CREATE OR REPLACE FUNCTION marshmallow_private.schedule_dialogue(p_payload jsonb, p_customer_keys text[]) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('speaker', x.speaker, 'content', x.content) ORDER BY x.n), '[]'::jsonb)
  FROM (
    SELECT d.n,
      CASE WHEN nullif(btrim(coalesce(d.part->>'userId', '')), '') IS NOT NULL THEN 'our_team'
           WHEN marshmallow_private.schedule_phone_key(d.part->>'identifier') = ANY (p_customer_keys) THEN 'customer'
           ELSE 'unknown' END AS speaker,
      btrim(d.part->>'content') AS content
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(coalesce(p_payload #> '{data,object,dialogue}', p_payload #> '{data,resource,dialogue}')) = 'array'
      THEN coalesce(p_payload #> '{data,object,dialogue}', p_payload #> '{data,resource,dialogue}') ELSE '[]'::jsonb END)
      WITH ORDINALITY AS d(part, n)
    WHERE jsonb_typeof(d.part) = 'object' AND btrim(coalesce(d.part->>'content', '')) <> ''
  ) x;
$$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_dialogue(jsonb, text[]) FROM PUBLIC, anon, authenticated;

-- The customer's phone keys for a job: the lead's phone and the chat's number.
CREATE OR REPLACE FUNCTION marshmallow_private.schedule_customer_keys(c public.quo_conversations, l public.leads) RETURNS text[]
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT array_remove(ARRAY[marshmallow_private.schedule_phone_key(l.customer_phone), marshmallow_private.schedule_phone_key(c.customer_number)], NULL);
$$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_customer_keys(public.quo_conversations, public.leads) FROM PUBLIC, anon, authenticated;

-- True when p_quote is the customer's own words in this chat since p_since:
-- a customer text, or a customer line of a call transcript.
CREATE OR REPLACE FUNCTION marshmallow_private.schedule_quote_is_customer(c public.quo_conversations, l public.leads, p_since timestamptz, p_quote text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT length(btrim(coalesce(p_quote, ''))) >= 2 AND (
    EXISTS (
      SELECT 1 FROM public.quo_messages m
      WHERE m.conversation_id = c.id AND m.message_time >= p_since
        AND marshmallow_private.schedule_event_kind(m.quo_message_id) = 'text'
        AND m.sender = 'customer' AND lower(coalesce(m.direction, '')) IN ('inbound', 'incoming')
        AND position(btrim(p_quote) IN m.text) > 0)
    OR EXISTS (
      SELECT 1 FROM public.quo_messages m
      CROSS JOIN LATERAL jsonb_array_elements(marshmallow_private.schedule_dialogue(m.raw_payload, marshmallow_private.schedule_customer_keys(c, l))) seg
      WHERE m.conversation_id = c.id AND m.message_time >= p_since
        AND marshmallow_private.schedule_event_kind(m.quo_message_id) = 'call_transcript'
        AND seg->>'speaker' = 'customer' AND position(btrim(p_quote) IN seg->>'content') > 0));
$$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_quote_is_customer(public.quo_conversations, public.leads, timestamptz, text) FROM PUBLIC, anon, authenticated;

-- 1. Any trusted event in the matched chat after the tag starts a check --------
CREATE OR REPLACE FUNCTION marshmallow_private.capture_schedule_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  c public.quo_conversations%rowtype;
  msg_at timestamptz := coalesce(NEW.message_time, now());
  kind text := marshmallow_private.schedule_event_kind(NEW.quo_message_id);
BEGIN
  -- current_user is the DEFINER here, so it is not evidence of ingestion trust.
  -- The verified service JWT (or service_role SET ROLE in isolated tests) is.
  IF coalesce(claims->>'role', nullif(current_setting('request.jwt.claim.role', true), ''), '') <> 'service_role'
    AND current_setting('role', true) <> 'service_role' THEN RETURN NEW; END IF;
  -- Webhook re-upserts of an unchanged message must not restart a check.
  IF TG_OP = 'UPDATE' AND OLD.text IS NOT DISTINCT FROM NEW.text AND OLD.message_time IS NOT DISTINCT FROM NEW.message_time
    AND OLD.sender IS NOT DISTINCT FROM NEW.sender AND OLD.direction IS NOT DISTINCT FROM NEW.direction THEN RETURN NEW; END IF;
  -- Texts need words; call events (completed, transcript, summary) always count.
  IF kind = 'text' AND btrim(coalesce(NEW.text, '')) = '' THEN RETURN NEW; END IF;
  SELECT * INTO c FROM public.quo_conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  UPDATE marshmallow_private.schedule_monitor_queue q SET generation = q.generation + 1,
    evidence = jsonb_build_object('id', NEW.id, 'conversation_id', NEW.conversation_id, 'kind', kind,
      'text', left(coalesce(NEW.text, ''), 2000), 'sender', coalesce(NEW.sender, ''), 'direction', coalesce(NEW.direction, ''),
      'message_time', msg_at, 'quo_message_id', coalesce(NEW.quo_message_id, '')),
    -- Transcripts and summaries follow a call within seconds; wait to read them together.
    result = NULL, state = 'pending', available_at = now() + CASE WHEN kind = 'text' THEN interval '20 seconds' ELSE interval '45 seconds' END,
    attempts = 0, lease = NULL, lease_until = NULL,
    reviewed_by = NULL, reviewed_at = NULL, review_decision = NULL, review_note = NULL
  FROM public.leads l
  WHERE l.id = q.lead_id AND l.cs_tag = 'waiting_schedule_confirmation'
    AND marshmallow_private.schedule_conversation_matches(c, l)
    AND msg_at >= q.entered_at
    AND (q.evidence IS NULL OR msg_at >= (q.evidence->>'message_time')::timestamptz);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.capture_schedule_evidence() FROM PUBLIC, anon, authenticated;

-- 2. Claim: recent texts, calls, transcripts (with speakers) and summaries -----
CREATE OR REPLACE FUNCTION public.claim_schedule_checks() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c marshmallow_private.schedule_monitor_config%rowtype; output jsonb;
BEGIN
  SELECT * INTO c FROM marshmallow_private.schedule_monitor_config WHERE id FOR UPDATE;
  IF c.mode = 'off' OR marshmallow_private.schedule_ingestion_paused() OR c.cooldown_until > now()
    OR (c.usage_date = current_date AND c.daily_checks >= 200) THEN
    RETURN jsonb_build_object('mode', c.mode, 'timezone', c.timezone, 'rows', '[]'::jsonb);
  END IF;
  INSERT INTO marshmallow_private.schedule_monitor_queue(lead_id)
    SELECT id FROM public.leads WHERE cs_tag = 'waiting_schedule_confirmation' ON CONFLICT DO NOTHING;
  WITH candidates AS (
    SELECT q.lead_id FROM marshmallow_private.schedule_monitor_queue q
    WHERE q.evidence IS NOT NULL AND q.available_at <= now()
      AND (q.state = 'pending' OR (q.state = 'running' AND q.lease_until < now()))
    ORDER BY q.available_at, q.lead_id
    LIMIT least(5, 200 - CASE WHEN c.usage_date = current_date THEN c.daily_checks ELSE 0 END)
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE marshmallow_private.schedule_monitor_queue q SET state = 'running', lease = gen_random_uuid(),
      lease_until = now() + interval '2 minutes', attempts = q.attempts + 1
    FROM candidates x WHERE q.lead_id = x.lead_id RETURNING q.*
  )
  SELECT jsonb_build_object('mode', c.mode, 'timezone', c.timezone, 'config_changed_at', c.changed_at,
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'lead_id', q.lead_id, 'lease', q.lease, 'generation', q.generation, 'attempts', q.attempts, 'entered_at', q.entered_at,
      'evidence', q.evidence, 'eligible', marshmallow_private.schedule_eligible(l),
      'ambiguous', marshmallow_private.schedule_waiting_matches(conv.id) > 1,
      'job_id', l.job_id, 'status', l.status, 'customer_name', l.customer_name, 'service_type', l.service_type,
      'service_details', l.service_details, 'schedule_requirements', l.customer_schedule_requirements,
      'scheduled_date', l.scheduled_date, 'scheduled_time_start', l.scheduled_time_start, 'scheduled_time_end', l.scheduled_time_end,
      -- The last 40 events of the matched chat, so the worker needs no table access.
      -- Transcripts carry speaker-attributed lines (last 80, 300 characters each).
      'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', m.kind, 'sender', m.sender, 'direction', m.direction,
          -- Transcript text is a fallback for the AI only when no attributed lines exist.
          'text', left(m.text, 600),
          'message_time', m.message_time, 'quo_message_id', m.quo_message_id,
          'dialogue', CASE WHEN m.kind = 'call_transcript' THEN (
            SELECT coalesce(jsonb_agg(jsonb_build_object('speaker', s.seg->>'speaker', 'content', left(s.seg->>'content', 300)) ORDER BY s.n), '[]'::jsonb)
            FROM (SELECT seg, n FROM jsonb_array_elements(marshmallow_private.schedule_dialogue(m.raw_payload, marshmallow_private.schedule_customer_keys(conv, l)))
                    WITH ORDINALITY AS t(seg, n)
                  WHERE seg->>'speaker' <> 'unknown' ORDER BY n DESC LIMIT 80) s) END) ORDER BY m.message_time DESC)
        FROM (SELECT x.*, marshmallow_private.schedule_event_kind(x.quo_message_id) AS kind FROM public.quo_messages x
              WHERE x.conversation_id = conv.id
                AND (btrim(coalesce(x.text, '')) <> '' OR marshmallow_private.schedule_event_kind(x.quo_message_id) = 'call_transcript')
              ORDER BY x.message_time DESC NULLS LAST LIMIT 40) m), '[]'::jsonb))), '[]'::jsonb))
  INTO output
  FROM claimed q JOIN public.leads l ON l.id = q.lead_id
  LEFT JOIN public.quo_conversations conv ON conv.id = (q.evidence->>'conversation_id')::uuid;
  UPDATE marshmallow_private.schedule_monitor_config SET usage_date = current_date,
    daily_checks = CASE WHEN usage_date = current_date THEN daily_checks ELSE 0 END + jsonb_array_length(output->'rows') WHERE id;
  RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.claim_schedule_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_schedule_checks() TO service_role;

-- 3. Finish: the quote may come from a customer text or the customer's call lines
CREATE OR REPLACE FUNCTION public.finish_schedule_check(p_input jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  l public.leads%rowtype; q marshmallow_private.schedule_monitor_queue%rowtype;
  c marshmallow_private.schedule_monitor_config%rowtype; conv public.quo_conversations%rowtype;
  users uuid[]; applied boolean := false; conv_found boolean;
  decision text := p_input->'result'->>'decision';
  quote text := btrim(coalesce(p_input->'result'->>'quote', ''));
  guard text := NULL; details text; schedule_text text;
BEGIN
  SELECT * INTO c FROM marshmallow_private.schedule_monitor_config WHERE id FOR UPDATE;
  SELECT * INTO l FROM public.leads WHERE id = (p_input->>'lead_id')::uuid FOR UPDATE;
  SELECT * INTO q FROM marshmallow_private.schedule_monitor_queue WHERE lead_id = l.id FOR UPDATE;
  IF q.lease IS NULL OR q.lease IS DISTINCT FROM (p_input->>'lease')::uuid OR q.generation <> (p_input->>'generation')::integer
    OR q.lease_until < now() OR c.mode = 'off' OR marshmallow_private.schedule_ingestion_paused()
    OR c.mode IS DISTINCT FROM p_input->>'mode' OR c.changed_at IS DISTINCT FROM (p_input->>'config_changed_at')::timestamptz THEN
    RETURN false;
  END IF;
  IF decision IS NULL OR decision NOT IN ('confirmed', 'needs_review', 'unavailable') THEN
    RAISE EXCEPTION 'Invalid assessment' USING errcode = '22023';
  END IF;

  -- Deterministic authority, independent of the AI's answer.
  IF decision = 'confirmed' THEN
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

  IF decision = 'confirmed' AND c.mode = 'automatic' THEN
    PERFORM set_config('marshmallow.cs_tag_source', 'ai', true);
    EXECUTE format('UPDATE %I.%I SET cs_tag=$1 WHERE id=$2 AND cs_tag=$3', 'public', 'leads')
      USING 'ready_to_schedule', l.id, 'waiting_schedule_confirmation';
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
      'Tag changed by AI: Waiting for CX for schedule confirmation -> Ready to schedule');

    SELECT array_agg(DISTINCT ur.user_id) INTO users FROM public.user_roles ur WHERE (
      ur.role::text IN ('admin', 'processor', 'cs_admin') OR (ur.role::text = 'customer_service' AND (
        l.created_by = ur.user_id OR l.assigned_cs = ur.user_id
        OR EXISTS (SELECT 1 FROM public.lead_shares s WHERE s.lead_id = l.id AND s.shared_with_user_id = ur.user_id))))
      AND marshmallow_private.workflow_job_visible_to(ur.user_id, l);
    PERFORM marshmallow_private.workflow_notify(users, 'schedule_ready', 'AI: Customer confirmed schedule — Ready to schedule',
      details, l.id, l.job_id, NULL, NULL, q.generation);
    INSERT INTO public.activity_logs(user_id, user_name, action, target_type, target_id, details)
      VALUES (NULL, 'AI schedule confirmation', 'schedule_confirmation_tag_applied', 'lead', l.id::text,
        'AI changed tag Waiting for CX for schedule confirmation -> Ready to schedule. Customer said: "' || left(quote, 300)
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

COMMIT;

-- =============================================================================
-- Rollback (manual, reviewed): turn the AI Off in Notifications, then re-apply
-- supabase/migrations/20261130000000_ai_schedule_confirmation.sql to restore the
-- customer-text-only trigger, claim and finish functions, and
-- DROP FUNCTION IF EXISTS marshmallow_private.schedule_quote_is_customer(public.quo_conversations, public.leads, timestamptz, text),
--   marshmallow_private.schedule_customer_keys(public.quo_conversations, public.leads),
--   marshmallow_private.schedule_dialogue(jsonb, text[]),
--   marshmallow_private.schedule_event_kind(text);
-- No lead data is changed by this migration or its rollback.
-- =============================================================================
