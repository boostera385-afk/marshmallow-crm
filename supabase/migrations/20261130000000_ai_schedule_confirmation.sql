-- =============================================================================
-- AI schedule confirmation for "Waiting for CX for schedule confirmation" leads
-- =============================================================================
-- Purpose / defect: the 20261020070343 schedule monitor only accepted a customer
-- text naming the exact job ID, an ISO date and a 24-hour time, plus an
-- Admin-verified conversation binding per job and five shadow reviews. Real
-- customers never write that way, so the monitor could not do its job. The
-- business rule is: when the customer replies in Quo and confirms the schedule,
-- move the tag from waiting_schedule_confirmation to ready_to_schedule, mark it as
-- set by AI, and notify the lead's CS, every CS Admin, Admin and Processor.
--
-- What this changes (replaces the monitor's gates, keeps its queue and worker):
--   * leads.cs_tag_source: 'ai' when the current tag was set by this worker, NULL
--     otherwise. A trigger owns the column: any other tag change clears it, and
--     clients cannot set it.
--   * Evidence: only a trusted (service_role / webhook) customer TEXT that arrives
--     after the lead entered the waiting tag. The conversation is matched to the
--     lead automatically: linked_lead_id, else the same 10-digit phone when the
--     conversation is not linked to another lead. Calls and summaries are ignored.
--   * Decision: the worker's AI reads the recent conversation. SQL still enforces
--     eligibility, freshness, a single unambiguous waiting lead for the customer,
--     and that the AI's quoted customer words exist in a customer message received
--     after the tag was set. Only the exact tag transition is possible.
--   * Notifications: schedule_ready workflow notifications carry the job ID,
--     customer, service, location, schedule and the customer's words.
--   * Admin control: Off / Shadow / Automatic with an audited reason; the
--     per-job binding and five-review activation gate are removed.
--
-- Not changed: lead status, agreed schedule fields, technician, quote, payment,
-- approvals, RLS policies. No UPDATE of existing lead rows. Mode stays as saved
-- (OFF on a fresh install). Worker cron/secrets remain separate approved steps
-- (supabase/manual/schedule_monitor_cron.sql).
--
-- Apply manually after 20261020065810 and 20261020070343. Harness:
-- supabase/tests/160_schedule_confirmation_monitor.sql (isolated only).
-- =============================================================================
BEGIN;

-- 1. AI tag marker -------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS cs_tag_source text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_cs_tag_source_check') THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_cs_tag_source_check CHECK (cs_tag_source IS NULL OR cs_tag_source = 'ai');
  END IF;
END $$;
COMMENT ON COLUMN public.leads.cs_tag_source IS
  'ai when the current cs_tag was set by the schedule confirmation AI; NULL when set by a person. Maintained by trigger.';

CREATE OR REPLACE FUNCTION marshmallow_private.stamp_cs_tag_source() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE requested text := nullif(current_setting('marshmallow.cs_tag_source', true), '');
BEGIN
  IF TG_OP = 'INSERT' OR NEW.cs_tag IS DISTINCT FROM OLD.cs_tag THEN
    -- Only the worker's guarded transition sets this transaction-local flag.
    NEW.cs_tag_source := CASE WHEN requested = 'ai' AND NEW.cs_tag IS NOT NULL THEN 'ai' ELSE NULL END;
  ELSE
    NEW.cs_tag_source := OLD.cs_tag_source;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.stamp_cs_tag_source() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS leads_stamp_cs_tag_source ON public.leads;
CREATE TRIGGER leads_stamp_cs_tag_source BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.stamp_cs_tag_source();

-- 2. Matching and eligibility --------------------------------------------------
CREATE OR REPLACE FUNCTION marshmallow_private.schedule_phone_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN length(d) >= 10 THEN right(d, 10) END
  FROM (SELECT regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') AS d) x;
$$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_phone_key(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.schedule_conversation_matches(c public.quo_conversations, l public.leads) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT coalesce(c.linked_lead_id = l.id
    OR (c.linked_lead_id IS NULL
        AND marshmallow_private.schedule_phone_key(c.customer_number) IS NOT NULL
        AND marshmallow_private.schedule_phone_key(c.customer_number) = marshmallow_private.schedule_phone_key(l.customer_phone)), false);
$$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_conversation_matches(public.quo_conversations, public.leads) FROM PUBLIC, anon, authenticated;

-- Any open lead carrying the waiting tag, unless it is already scheduled or later,
-- terminal, or held by a pending cancellation / payment / quote approval.
CREATE OR REPLACE FUNCTION marshmallow_private.schedule_eligible(l public.leads) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(l.cs_tag = 'waiting_schedule_confirmation'
    AND l.status NOT IN ('scheduled','job_in_progress','job_done','payment_pending','payment_requested','paid','partial_paid','cancelled','cancellation_requested','scammed')
    AND NOT EXISTS (SELECT 1 FROM public.lead_cancellation_requests WHERE lead_id = l.id AND status = 'pending')
    AND NOT EXISTS (SELECT 1 FROM public.lead_payment_requests WHERE lead_id = l.id AND status = 'pending')
    AND NOT EXISTS (SELECT 1 FROM public.lead_quote_approval_requests WHERE lead_id = l.id AND status = 'pending'), false);
$$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_eligible(public.leads) FROM PUBLIC, anon, authenticated;

-- How many waiting leads this conversation could belong to. More than one means
-- the AI cannot know which job the customer confirmed.
CREATE OR REPLACE FUNCTION marshmallow_private.schedule_waiting_matches(p_conversation uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT count(*)::integer
  FROM public.quo_conversations c
  JOIN marshmallow_private.schedule_monitor_queue q ON true
  JOIN public.leads l ON l.id = q.lead_id
  WHERE c.id = p_conversation AND l.cs_tag = 'waiting_schedule_confirmation'
    AND marshmallow_private.schedule_conversation_matches(c, l);
$$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_waiting_matches(uuid) FROM PUBLIC, anon, authenticated;

-- The existing update trigger queues leads when the tag changes; a lead created
-- with the tag already set is queued here, so every waiting lead has a queue row.
CREATE OR REPLACE FUNCTION marshmallow_private.capture_schedule_job_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO marshmallow_private.schedule_monitor_queue(lead_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.capture_schedule_job_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS leads_schedule_monitor_queue_insert ON public.leads;
CREATE TRIGGER leads_schedule_monitor_queue_insert AFTER INSERT ON public.leads
  FOR EACH ROW WHEN (NEW.cs_tag = 'waiting_schedule_confirmation')
  EXECUTE FUNCTION marshmallow_private.capture_schedule_job_insert();

-- 3. Evidence capture: trusted customer texts after the tag was set ------------
CREATE OR REPLACE FUNCTION marshmallow_private.capture_schedule_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  c public.quo_conversations%rowtype;
  msg_at timestamptz := coalesce(NEW.message_time, now());
BEGIN
  -- current_user is the DEFINER here, so it is not evidence of ingestion trust.
  -- The verified service JWT (or service_role SET ROLE in isolated tests) is.
  IF coalesce(claims->>'role', nullif(current_setting('request.jwt.claim.role', true), ''), '') <> 'service_role'
    AND current_setting('role', true) <> 'service_role' THEN RETURN NEW; END IF;
  -- Webhook re-upserts of an unchanged message must not restart a check.
  IF TG_OP = 'UPDATE' AND OLD.text IS NOT DISTINCT FROM NEW.text AND OLD.message_time IS NOT DISTINCT FROM NEW.message_time
    AND OLD.sender IS NOT DISTINCT FROM NEW.sender AND OLD.direction IS NOT DISTINCT FROM NEW.direction THEN RETURN NEW; END IF;
  IF NEW.sender IS DISTINCT FROM 'customer' OR lower(coalesce(NEW.direction, '')) NOT IN ('inbound', 'incoming')
    OR coalesce(NEW.quo_message_id, '') LIKE '%:%' OR btrim(coalesce(NEW.text, '')) = '' THEN RETURN NEW; END IF;
  SELECT * INTO c FROM public.quo_conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  UPDATE marshmallow_private.schedule_monitor_queue q SET generation = q.generation + 1,
    evidence = jsonb_build_object('id', NEW.id, 'conversation_id', NEW.conversation_id, 'text', left(NEW.text, 2000),
      'sender', NEW.sender, 'direction', NEW.direction, 'message_time', msg_at, 'quo_message_id', coalesce(NEW.quo_message_id, '')),
    result = NULL, state = 'pending', available_at = now() + interval '20 seconds', attempts = 0, lease = NULL, lease_until = NULL,
    reviewed_by = NULL, reviewed_at = NULL, review_decision = NULL, review_note = NULL
  FROM public.leads l
  WHERE l.id = q.lead_id AND l.cs_tag = 'waiting_schedule_confirmation'
    AND marshmallow_private.schedule_conversation_matches(c, l)
    AND msg_at >= q.entered_at
    AND (q.evidence IS NULL OR msg_at >= (q.evidence->>'message_time')::timestamptz);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.capture_schedule_evidence() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS quo_messages_schedule_evidence ON public.quo_messages;
CREATE TRIGGER quo_messages_schedule_evidence AFTER INSERT OR UPDATE OF text, message_time, direction, sender ON public.quo_messages
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.capture_schedule_evidence();

-- 4. Worker claim --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_schedule_checks() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c marshmallow_private.schedule_monitor_config%rowtype; output jsonb;
BEGIN
  SELECT * INTO c FROM marshmallow_private.schedule_monitor_config WHERE id FOR UPDATE;
  IF c.mode = 'off' OR marshmallow_private.schedule_ingestion_paused() OR c.cooldown_until > now()
    OR (c.usage_date = current_date AND c.daily_checks >= 200) THEN
    RETURN jsonb_build_object('mode', c.mode, 'timezone', c.timezone, 'rows', '[]'::jsonb);
  END IF;
  -- Recovery sweep only adds missing waiting jobs; no history is promoted to evidence.
  INSERT INTO marshmallow_private.schedule_monitor_queue(lead_id)
    SELECT id FROM public.leads WHERE cs_tag = 'waiting_schedule_confirmation' ON CONFLICT DO NOTHING;
  -- Only jobs with a customer reply waiting to be read cost an AI call.
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
      'ambiguous', marshmallow_private.schedule_waiting_matches((q.evidence->>'conversation_id')::uuid) > 1,
      'job_id', l.job_id, 'status', l.status, 'customer_name', l.customer_name, 'service_type', l.service_type,
      'service_details', l.service_details, 'schedule_requirements', l.customer_schedule_requirements,
      'scheduled_date', l.scheduled_date, 'scheduled_time_start', l.scheduled_time_start, 'scheduled_time_end', l.scheduled_time_end,
      -- The last 40 texts of the matched chat, so the worker needs no table access.
      'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('sender', m.sender, 'direction', m.direction, 'text', left(m.text, 600),
          'message_time', m.message_time, 'quo_message_id', m.quo_message_id) ORDER BY m.message_time DESC)
        FROM (SELECT * FROM public.quo_messages WHERE conversation_id = (q.evidence->>'conversation_id')::uuid
              AND coalesce(quo_message_id, '') NOT LIKE '%:%' AND btrim(coalesce(text, '')) <> ''
              ORDER BY message_time DESC NULLS LAST LIMIT 40) m), '[]'::jsonb))), '[]'::jsonb))
  INTO output
  FROM claimed q JOIN public.leads l ON l.id = q.lead_id;
  UPDATE marshmallow_private.schedule_monitor_config SET usage_date = current_date,
    daily_checks = CASE WHEN usage_date = current_date THEN daily_checks ELSE 0 END + jsonb_array_length(output->'rows') WHERE id;
  RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.claim_schedule_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_schedule_checks() TO service_role;

-- 5. Worker finish: the only path that changes the tag ------------------------
CREATE OR REPLACE FUNCTION public.finish_schedule_check(p_input jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  l public.leads%rowtype; q marshmallow_private.schedule_monitor_queue%rowtype;
  c marshmallow_private.schedule_monitor_config%rowtype; conv public.quo_conversations%rowtype;
  users uuid[]; applied boolean := false;
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
    IF NOT marshmallow_private.schedule_eligible(l) THEN
      guard := 'Job is no longer eligible (status, tag or a pending approval changed).';
    ELSIF q.evidence IS NULL OR NOT FOUND OR NOT marshmallow_private.schedule_conversation_matches(conv, l) THEN
      guard := 'The customer conversation no longer matches this job.';
    ELSIF marshmallow_private.schedule_waiting_matches(conv.id) > 1 THEN
      guard := 'This customer has more than one job waiting for schedule confirmation.';
    ELSIF (q.evidence->>'message_time')::timestamptz NOT BETWEEN greatest(q.entered_at, now() - interval '24 hours') AND now() + interval '5 minutes' THEN
      guard := 'The customer reply is too old to act on.';
    ELSIF length(quote) < 2 OR NOT EXISTS (
      SELECT 1 FROM public.quo_messages m
      WHERE m.conversation_id = conv.id AND m.sender = 'customer' AND lower(coalesce(m.direction, '')) IN ('inbound', 'incoming')
        AND coalesce(m.quo_message_id, '') NOT LIKE '%:%' AND m.message_time >= q.entered_at
        AND position(quote IN m.text) > 0) THEN
      guard := 'The AI did not quote the customer''s own confirmation.';
    END IF;
    IF guard IS NOT NULL THEN decision := 'needs_review'; END IF;
  END IF;

  IF decision = 'confirmed' AND c.mode = 'automatic' THEN
    -- Runtime tag transition only (never a migration-time repair). The flag is
    -- transaction-local and cleared straight after, so only this row is stamped.
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
        || '" (message ' || (q.evidence->>'id') || '). Status and agreed schedule unchanged.');
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

-- The exact job/date/time rule is superseded by the checks above.
DROP FUNCTION IF EXISTS marshmallow_private.schedule_exact_confirmation(public.leads, jsonb);

-- 6. Admin control: Off / Shadow / Automatic, audited -------------------------
CREATE OR REPLACE FUNCTION marshmallow_private.schedule_admin(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a text := p->>'action'; c marshmallow_private.schedule_monitor_config%rowtype;
  l public.leads%rowtype; reason text := btrim(p->>'reason'); output jsonb;
BEGIN
  IF auth.uid() IS NULL OR marshmallow_private.workflow_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501'; END IF;
  IF a IS NULL OR a NOT IN ('status', 'configure', 'retry') THEN
    RAISE EXCEPTION 'Invalid monitor action' USING errcode = '22023'; END IF;
  SELECT * INTO c FROM marshmallow_private.schedule_monitor_config WHERE id FOR UPDATE;
  IF a = 'status' THEN
    SELECT jsonb_build_object('mode', c.mode, 'changed_at', c.changed_at, 'cooldown_until', c.cooldown_until,
      'daily_checks', CASE WHEN c.usage_date = current_date THEN c.daily_checks ELSE 0 END, 'daily_limit', 200,
      'ingestion_paused', marshmallow_private.schedule_ingestion_paused(),
      'total', (SELECT count(*) FROM public.leads WHERE cs_tag = 'waiting_schedule_confirmation'),
      'rows', coalesce((SELECT jsonb_agg(item ORDER BY job_id) FROM (
        SELECT job.job_id, jsonb_build_object('lead_id', job.id, 'job_id', job.job_id, 'status', job.status,
          'customer_name', job.customer_name, 'service_type', job.service_type,
          'schedule_requirements', job.customer_schedule_requirements,
          'eligible', marshmallow_private.schedule_eligible(job), 'state', coalesce(q.state, 'not_queued'),
          'waiting_since', q.entered_at, 'checked_at', q.checked_at, 'result', q.result,
          'evidence', CASE WHEN q.evidence IS NOT NULL THEN jsonb_build_object('text', q.evidence->>'text', 'message_time', q.evidence->>'message_time') END) item
        FROM public.leads job LEFT JOIN marshmallow_private.schedule_monitor_queue q ON q.lead_id = job.id
        WHERE job.cs_tag = 'waiting_schedule_confirmation'
        ORDER BY job.job_id LIMIT 20 OFFSET greatest(coalesce((p->>'offset')::integer, 0), 0)) page), '[]'::jsonb))
    INTO output;
    RETURN output;
  END IF;
  IF reason IS NULL OR length(reason) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'Enter a reason (10–2000 characters)' USING errcode = '22023'; END IF;
  IF a = 'configure' THEN
    IF p->>'mode' IS NULL OR p->>'mode' NOT IN ('off', 'shadow', 'automatic') THEN
      RAISE EXCEPTION 'Choose Off, Shadow or Automatic' USING errcode = '22023'; END IF;
    -- Off is always available as a kill switch; turning on needs the latest view.
    IF p->>'mode' <> 'off' AND c.changed_at IS DISTINCT FROM (p->>'expectedChangedAt')::timestamptz THEN
      RAISE EXCEPTION 'Monitor configuration changed. Refresh and review it before saving.' USING errcode = '40001'; END IF;
    UPDATE marshmallow_private.schedule_monitor_config SET mode = p->>'mode', changed_at = clock_timestamp(),
      shadow_started_at = CASE WHEN p->>'mode' = 'shadow' AND c.mode <> 'shadow' THEN now() ELSE shadow_started_at END WHERE id;
  ELSE
    SELECT * INTO l FROM public.leads WHERE id = (p->>'leadId')::uuid FOR UPDATE;
    IF NOT FOUND OR l.cs_tag IS DISTINCT FROM 'waiting_schedule_confirmation' THEN
      RAISE EXCEPTION 'Waiting job unavailable' USING errcode = '22023'; END IF;
    UPDATE marshmallow_private.schedule_monitor_queue SET generation = generation + 1, available_at = now(), state = 'pending',
      result = NULL, lease = NULL, lease_until = NULL, attempts = 0 WHERE lead_id = l.id AND evidence IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'No customer reply to check yet' USING errcode = '22023'; END IF;
  END IF;
  INSERT INTO public.activity_logs(user_id, user_name, action, target_type, target_id, details)
    SELECT auth.uid(), coalesce(full_name, 'Admin'), 'schedule_monitor_' || a, 'lead', coalesce(l.id::text, 'configuration'),
      CASE WHEN a = 'configure' THEN 'Mode ' || (p->>'mode') || ': ' ELSE '' END || reason
    FROM public.profiles WHERE id = auth.uid();
  RETURN jsonb_build_object('saved', true);
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_admin(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.schedule_admin(jsonb) TO authenticated;

-- 7. Dispatcher: call the worker only when a customer reply is waiting --------
CREATE OR REPLACE FUNCTION marshmallow_private.dispatch_schedule_monitor() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c marshmallow_private.schedule_monitor_config%rowtype; base_url text; token text;
BEGIN
  SELECT * INTO c FROM marshmallow_private.schedule_monitor_config WHERE id;
  IF c.mode = 'off' OR marshmallow_private.schedule_ingestion_paused() OR c.cooldown_until > now()
    OR (c.usage_date = current_date AND c.daily_checks >= 200) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM marshmallow_private.schedule_monitor_queue WHERE evidence IS NOT NULL AND available_at <= now()
    AND (state = 'pending' OR (state = 'running' AND lease_until < now()))) THEN RETURN; END IF;
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name = 'schedule_monitor_project_url' LIMIT 1;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name = 'schedule_monitor_cron_secret' LIMIT 1;
  IF base_url IS NULL OR token IS NULL THEN RAISE EXCEPTION 'Schedule monitor dispatcher secrets are not configured'; END IF;
  PERFORM net.http_post(url := rtrim(base_url, '/') || '/functions/v1/schedule-confirmation-monitor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', token), body := '{}'::jsonb,
    timeout_milliseconds := 90000);
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.dispatch_schedule_monitor() FROM PUBLIC, anon, authenticated, service_role;

-- 8. Queue every lead already waiting; only replies after now() count ---------
INSERT INTO marshmallow_private.schedule_monitor_queue(lead_id)
  SELECT id FROM public.leads WHERE cs_tag = 'waiting_schedule_confirmation' ON CONFLICT DO NOTHING;

COMMIT;

-- =============================================================================
-- Rollback (manual, reviewed):
--   1. Turn the monitor Off from Notifications > Schedule confirmation (audited).
--   2. Re-apply supabase/migrations/20261020070343_schedule_confirmation_monitor.sql
--      to restore the strict monitor functions and trigger.
--   3. DROP TRIGGER IF EXISTS leads_stamp_cs_tag_source ON public.leads;
--      DROP TRIGGER IF EXISTS leads_schedule_monitor_queue_insert ON public.leads;
--      DROP FUNCTION IF EXISTS marshmallow_private.stamp_cs_tag_source(),
--        marshmallow_private.capture_schedule_job_insert(),
--        marshmallow_private.schedule_waiting_matches(uuid),
--        marshmallow_private.schedule_conversation_matches(public.quo_conversations, public.leads),
--        marshmallow_private.schedule_phone_key(text);
--   4. Optionally ALTER TABLE public.leads DROP COLUMN cs_tag_source (loses the
--      "set by AI" marker only). Do not bulk-revert tags; review any AI-set tag
--      individually under normal permissions. Statuses and schedules were never changed.
-- =============================================================================
