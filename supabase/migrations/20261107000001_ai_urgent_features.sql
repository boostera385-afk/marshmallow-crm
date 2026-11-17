-- =============================================================================
-- Migration : 20261107000000_ai_urgent_features.sql
-- Purpose   : Backend for three AI features on the Urgent Leads / Cancellation
--             screens:
--               1. Apply AI-suggested form fixes (whitelisted columns only) and
--                  enforce required data before a customer_service user can
--                  make a lead Urgent.
--               2. AI Status per urgent lead, refreshed every 30 minutes by
--                  cron and on demand, stored apart from `leads`.
--               3. AI cancellation reason suggestion audit columns.
--
-- DESIGN NOTES
--   * lead_ai_statuses is its own table. Writing to `leads` every 30 minutes
--     would fire the Google Sheets outbox trigger and the urgent gate for every
--     urgent lead.
--   * apply_urgent_form_fixes can only write customer_name, address, city,
--     state, zip_code and service_type. service_details and every schedule
--     column are NOT writable through it. Each fix carries the value the user
--     saw ("old"); if the stored value has changed since, that fix is skipped.
--   * Required-data enforcement is deterministic SQL. Spelling / grammar is
--     never enforced by the database.
--   * Required location is address OR city OR state (not city+state): the
--     city/state columns are empty on ~98% of leads because the location lives
--     in `address`.
--
-- ROLLBACK : see the bottom of this file.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. AI status per lead
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_ai_statuses (
  lead_id         uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  status          text NOT NULL,
  checked_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  message_count   integer NOT NULL DEFAULT 0,
  source          text NOT NULL DEFAULT 'ai',
  model           text,
  CONSTRAINT lead_ai_status_label CHECK (status IN (
    'Awaiting Response', 'Quote Sent', 'Awaiting Approval', 'Awaiting Schedule',
    'Schedule Confirmed', 'Follow Up Needed', 'Cancellation Risk', 'Cancelled',
    'Needs Review'
  )),
  CONSTRAINT lead_ai_status_source CHECK (source IN ('ai', 'rule'))
);

COMMENT ON TABLE public.lead_ai_statuses IS
  'Short AI status label per lead, derived from the customer chat. Written only '
  'by the refresh-urgent-statuses edge function (service role).';

ALTER TABLE public.lead_ai_statuses ENABLE ROW LEVEL SECURITY;

-- Visibility is inherited from leads: the subquery runs under the caller's own
-- row level security, so a user sees a status only for a lead they can see.
DROP POLICY IF EXISTS "Read ai status of visible leads" ON public.lead_ai_statuses;
CREATE POLICY "Read ai status of visible leads"
  ON public.lead_ai_statuses
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_ai_statuses.lead_id));

REVOKE ALL ON TABLE public.lead_ai_statuses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_ai_statuses TO authenticated;
GRANT ALL ON public.lead_ai_statuses TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'lead_ai_statuses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_ai_statuses;
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- 2. Refresh lock / cooldown (single row)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_status_refresh_runs (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_trigger     text,
  last_summary     jsonb
);

INSERT INTO public.ai_status_refresh_runs (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ai_status_refresh_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_status_refresh_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_status_refresh_runs TO service_role;

-- Atomically claims the refresh. Returns false when another run is in flight
-- (started in the last 5 minutes and not finished) or the cooldown has not
-- elapsed since the last finish.
CREATE OR REPLACE FUNCTION public.claim_ai_status_refresh(
  p_trigger          text,
  p_cooldown_seconds integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_claimed boolean;
BEGIN
  UPDATE public.ai_status_refresh_runs
     SET last_started_at = now(),
         last_trigger    = left(coalesce(p_trigger, 'unknown'), 40)
   WHERE id
     AND (
          last_started_at IS NULL
       OR last_started_at < now() - interval '5 minutes'
       OR (
            last_finished_at IS NOT NULL
        AND last_finished_at >= last_started_at
        AND last_finished_at < now() - make_interval(secs => greatest(coalesce(p_cooldown_seconds, 0), 0))
       )
     )
  RETURNING true INTO v_claimed;

  RETURN coalesce(v_claimed, false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finish_ai_status_refresh(p_summary jsonb DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  UPDATE public.ai_status_refresh_runs
     SET last_finished_at = now(), last_summary = p_summary
   WHERE id;
$fn$;

REVOKE ALL ON FUNCTION public.claim_ai_status_refresh(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_ai_status_refresh(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_status_refresh(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_ai_status_refresh(jsonb) TO service_role;


-- -----------------------------------------------------------------------------
-- 3. Cancellation reason suggestion audit columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.lead_cancellation_requests
  ADD COLUMN IF NOT EXISTS ai_suggested_reason text,
  ADD COLUMN IF NOT EXISTS ai_reason_code      text,
  ADD COLUMN IF NOT EXISTS ai_suggested_at     timestamptz,
  ADD COLUMN IF NOT EXISTS ai_reason_applied   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lead_cancellation_requests.ai_reason_applied IS
  'True only when staff clicked Apply reason on the AI suggestion. The AI never writes the reason itself.';


-- -----------------------------------------------------------------------------
-- 4. Required data for Urgent (deterministic)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.urgent_required_missing(p_lead_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT array_remove(ARRAY[
    CASE WHEN coalesce(btrim(l.customer_name), '') = '' THEN 'customer_name' END,
    CASE WHEN coalesce(btrim(l.service_type), '')  = '' THEN 'service_type'  END,
    CASE WHEN coalesce(btrim(l.address), '') = ''
          AND coalesce(btrim(l.city), '')    = ''
          AND coalesce(btrim(l.state), '')   = '' THEN 'address' END
  ], NULL)
  FROM public.leads l
  WHERE l.id = p_lead_id;
$fn$;

REVOKE ALL ON FUNCTION public.urgent_required_missing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.urgent_required_missing(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.assert_urgent_required_data(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_missing text[];
BEGIN
  v_missing := public.urgent_required_missing(p_lead_id);
  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Required details are missing, so this lead cannot be made urgent yet: %',
      array_to_string(v_missing, ', ')
      USING ERRCODE = '23514',
            HINT = 'Fill in the missing fields, then try again.';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.assert_urgent_required_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_urgent_required_data(uuid) TO service_role;

-- approve_urgent_verification: rebased on the LIVE definition (access-based
-- authorisation for every role, and settlement of pending review requests from
-- 20261104002000). The only addition is the required-data assertion, applied to
-- roles that do not bypass the gate.
CREATE OR REPLACE FUNCTION public.approve_urgent_verification(
  p_lead_id   uuid,
  p_ai_summary text DEFAULT NULL,
  p_ai_model   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  IF NOT (
       public.has_role(v_uid, 'admin'::app_role)
    OR public.has_role(v_uid, 'cs_admin'::app_role)
    OR public.has_role(v_uid, 'processor'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.leads l
       WHERE l.id = p_lead_id
         AND (l.created_by = v_uid OR l.assigned_cs = v_uid)
    )
  ) THEN
    RAISE EXCEPTION 'You cannot verify a lead you do not have access to'
      USING ERRCODE = '42501';
  END IF;

  -- Required details must exist for roles that do not bypass the gate.
  IF NOT (
       public.has_role(v_uid, 'admin'::app_role)
    OR public.has_role(v_uid, 'cs_admin'::app_role)
    OR public.has_role(v_uid, 'processor'::app_role)
  ) THEN
    PERFORM public.assert_urgent_required_data(p_lead_id);
  END IF;

  v_name := COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'Customer Service');

  PERFORM 1 FROM public.leads WHERE id = p_lead_id FOR UPDATE;

  PERFORM set_config('app.urgent_verified', 'on', true);
  UPDATE public.leads
     SET status = 'urgent_job',
         last_edited_by      = v_uid,
         last_edited_by_name = COALESCE(
           (SELECT full_name FROM public.profiles WHERE id = v_uid), 'Customer Service'),
         last_edited_at = now(),
         updated_at     = now()
   WHERE id = p_lead_id
     AND status IS DISTINCT FROM 'urgent_job';
  PERFORM set_config('app.urgent_verified', 'off', true);

  UPDATE public.lead_urgent_review_requests
     SET status     = 'approved',
         reviewed_at = now(),
         review_note = left(coalesce(review_note, '')
                           || ' Settled automatically: the conversation was corrected and re-checked, and it came back clean.',
                           500),
         updated_at  = now()
   WHERE lead_id = p_lead_id
     AND status = 'pending';

  INSERT INTO public.activity_logs (
    user_id, user_name, action, target_type, target_id, details
  )
  VALUES (
    v_uid,
    v_name,
    'urgent_verified',
    'lead',
    p_lead_id,
    jsonb_build_object(
      'ai_summary', coalesce(p_ai_summary, 'All verification checks passed'),
      'ai_model',   p_ai_model
    )
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.urgent_verified', 'off', true);
  RAISE;
END;
$fn$;

-- approve_urgent_acknowledgement: rebased on the LIVE definition (including the
-- pending-request settlement) plus the required-data assertion for roles that
-- do not bypass the gate (admin, cs_admin and processor keep their bypass).
CREATE OR REPLACE FUNCTION public.approve_urgent_acknowledgement(
  p_lead_id uuid,
  p_reason  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  IF NOT (
       public.has_role(v_uid, 'admin'::app_role)
    OR public.has_role(v_uid, 'cs_admin'::app_role)
    OR public.has_role(v_uid, 'processor'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.leads l
       WHERE l.id = p_lead_id
         AND (l.created_by = v_uid OR l.assigned_cs = v_uid)
    )
  ) THEN
    RAISE EXCEPTION 'You cannot approve a lead you do not have access to'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
       public.has_role(v_uid, 'admin'::app_role)
    OR public.has_role(v_uid, 'cs_admin'::app_role)
    OR public.has_role(v_uid, 'processor'::app_role)
  ) THEN
    PERFORM public.assert_urgent_required_data(p_lead_id);
  END IF;

  v_name := COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'Customer Service');

  PERFORM set_config('app.urgent_verified', 'on', true);
  UPDATE public.leads
     SET status              = 'urgent_job',
         last_edited_by      = v_uid,
         last_edited_by_name = v_name,
         last_edited_at      = now(),
         updated_at          = now()
   WHERE id = p_lead_id;
  PERFORM set_config('app.urgent_verified', 'off', true);

  UPDATE public.lead_urgent_review_requests
     SET status     = 'approved',
         reviewed_at = now(),
         review_note = left(coalesce(review_note, '')
                           || ' Settled automatically: marked urgent without a check, by decision.',
                           500),
         updated_at  = now()
   WHERE lead_id = p_lead_id
     AND status = 'pending';

  INSERT INTO public.activity_logs (
    user_id, user_name, action, target_type, target_id, details
  )
  VALUES (
    v_uid, v_name, 'urgent_unverified_acknowledged', 'lead', p_lead_id,
    jsonb_build_object(
      'verified', false,
      'reason',   left(coalesce(p_reason, 'No conversation available to check'), 300)
    )
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.urgent_verified', 'off', true);
  RAISE;
END;
$fn$;

REVOKE ALL ON FUNCTION public.approve_urgent_verification(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_urgent_acknowledgement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_urgent_verification(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_urgent_acknowledgement(uuid, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. Apply AI-suggested form fixes
--    p_fixes: [{"field": "city", "old": "...", "new": "..."}, ...]
--    Returns: {"applied": [{field, old, new}], "skipped": [{field, reason}]}
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_urgent_form_fixes(
  p_lead_id uuid,
  p_fixes   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_name      text;
  v_lead      jsonb;
  v_fix       jsonb;
  v_field     text;
  v_old       text;
  v_new       text;
  v_current   text;
  v_applied   jsonb := '[]'::jsonb;
  v_skipped   jsonb := '[]'::jsonb;
  v_allowed   constant text[] := ARRAY['customer_name', 'address', 'city', 'state', 'zip_code', 'service_type'];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  IF p_fixes IS NULL OR jsonb_typeof(p_fixes) <> 'array' THEN
    RAISE EXCEPTION 'p_fixes must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_fixes) > 10 THEN
    RAISE EXCEPTION 'Too many fixes in one request' USING ERRCODE = '22023';
  END IF;

  IF NOT (
       public.has_role(v_uid, 'admin'::app_role)
    OR public.has_role(v_uid, 'cs_admin'::app_role)
    OR public.has_role(v_uid, 'processor'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.leads l
       WHERE l.id = p_lead_id
         AND (l.created_by = v_uid OR l.assigned_cs = v_uid)
    )
  ) THEN
    RAISE EXCEPTION 'You cannot edit a lead you do not have access to'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the row and read it once. All comparisons are against this snapshot.
  SELECT to_jsonb(l) INTO v_lead
    FROM public.leads l
   WHERE l.id = p_lead_id
   FOR UPDATE;

  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;

  v_name := COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'Staff');

  FOR v_fix IN SELECT * FROM jsonb_array_elements(p_fixes) LOOP
    v_field := v_fix->>'field';
    v_old   := coalesce(v_fix->>'old', '');
    v_new   := btrim(coalesce(v_fix->>'new', ''));

    -- Hard whitelist. service_details and the schedule columns can never be
    -- written here, whatever the caller (or the model) sends.
    IF v_field IS NULL OR NOT (v_field = ANY (v_allowed)) THEN
      v_skipped := v_skipped || jsonb_build_object('field', coalesce(v_field, ''), 'reason', 'not_allowed');
      CONTINUE;
    END IF;

    IF v_new = '' OR length(v_new) > 200 THEN
      v_skipped := v_skipped || jsonb_build_object('field', v_field, 'reason', 'invalid_value');
      CONTINUE;
    END IF;

    IF v_field = 'state' AND v_new !~ '^[A-Z]{2}$' THEN
      v_skipped := v_skipped || jsonb_build_object('field', v_field, 'reason', 'invalid_state');
      CONTINUE;
    END IF;

    IF v_field = 'zip_code' AND v_new !~ '^\d{5}(-\d{4})?$' THEN
      v_skipped := v_skipped || jsonb_build_object('field', v_field, 'reason', 'invalid_zip');
      CONTINUE;
    END IF;

    v_current := coalesce(v_lead->>v_field, '');

    -- Stale guard: the user approved a change from "old" to "new". If the
    -- stored value is no longer "old", someone edited it in the meantime.
    IF v_current <> v_old THEN
      v_skipped := v_skipped || jsonb_build_object('field', v_field, 'reason', 'stale');
      CONTINUE;
    END IF;

    IF v_current = v_new THEN
      v_skipped := v_skipped || jsonb_build_object('field', v_field, 'reason', 'no_change');
      CONTINUE;
    END IF;

    EXECUTE format('UPDATE public.leads SET %I = $1 WHERE id = $2', v_field)
      USING v_new, p_lead_id;

    v_applied := v_applied || jsonb_build_object('field', v_field, 'old', v_current, 'new', v_new);
  END LOOP;

  IF jsonb_array_length(v_applied) > 0 THEN
    UPDATE public.leads
       SET last_edited_by      = v_uid,
           last_edited_by_name = v_name,
           last_edited_at      = now(),
           updated_at          = now()
     WHERE id = p_lead_id;

    INSERT INTO public.activity_logs (user_id, user_name, action, target_type, target_id, details)
    VALUES (
      v_uid, v_name, 'urgent_ai_fixes_applied', 'lead', p_lead_id,
      jsonb_build_object('applied', v_applied, 'skipped', v_skipped)
    );
  END IF;

  RETURN jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
END;
$fn$;

COMMENT ON FUNCTION public.apply_urgent_form_fixes(uuid, jsonb) IS
  'Applies reviewed AI form fixes to a whitelisted set of lead columns. Never '
  'touches service_details or schedule columns. Skips any fix whose old value no '
  'longer matches the stored value.';

REVOKE ALL ON FUNCTION public.apply_urgent_form_fixes(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_urgent_form_fixes(uuid, jsonb) TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. 30-minute cron for the AI status refresh
--    Same vault + cron_secret pattern as the Google Sheets worker.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_refresh_urgent_ai_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_project_url     text;
  v_publishable_key text;
  v_cron_secret     text;
BEGIN
  SELECT decrypted_secret INTO v_project_url
    FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_publishable_key
    FROM vault.decrypted_secrets WHERE name = 'publishable_key' LIMIT 1;
  SELECT CASE
      WHEN jsonb_typeof(value) = 'array'  THEN value ->> 0
      WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}'
      WHEN jsonb_typeof(value) = 'object' THEN value ->> 'secret'
      ELSE NULL
    END
    INTO v_cron_secret
    FROM public.quo_ai_settings WHERE key = 'cron_secret' LIMIT 1;

  IF coalesce(v_project_url, '') = ''
     OR coalesce(v_publishable_key, '') = ''
     OR coalesce(v_cron_secret, '') = '' THEN
    RAISE WARNING 'Urgent AI status refresh not invoked: project_url, publishable_key, or cron_secret is missing';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/refresh-urgent-statuses',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_publishable_key,
      'x-cron-secret', v_cron_secret
    ),
    body := jsonb_build_object('trigger', 'cron'),
    timeout_milliseconds := 10000
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.cron_refresh_urgent_ai_status() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('urgent-ai-status-refresh')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'urgent-ai-status-refresh');
  PERFORM cron.schedule(
    'urgent-ai-status-refresh',
    '*/30 * * * *',
    'SELECT public.cron_refresh_urgent_ai_status()'
  );
END $$;


-- =============================================================================
-- ROLLBACK - run manually to undo this migration.
--
--   SELECT cron.unschedule('urgent-ai-status-refresh');
--   DROP FUNCTION IF EXISTS public.cron_refresh_urgent_ai_status();
--   DROP FUNCTION IF EXISTS public.apply_urgent_form_fixes(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.assert_urgent_required_data(uuid);
--   DROP FUNCTION IF EXISTS public.urgent_required_missing(uuid);
--   DROP FUNCTION IF EXISTS public.claim_ai_status_refresh(text, integer);
--   DROP FUNCTION IF EXISTS public.finish_ai_status_refresh(jsonb);
--   DROP TABLE IF EXISTS public.ai_status_refresh_runs;
--   DROP TABLE IF EXISTS public.lead_ai_statuses;
--   ALTER TABLE public.lead_cancellation_requests
--     DROP COLUMN IF EXISTS ai_suggested_reason, DROP COLUMN IF EXISTS ai_reason_code,
--     DROP COLUMN IF EXISTS ai_suggested_at,     DROP COLUMN IF EXISTS ai_reason_applied;
--   -- Then re-apply approve_urgent_verification / approve_urgent_acknowledgement
--   -- from 20261104000000_urgent_review_gate.sql (and later fixes) to drop the
--   -- required-data assertion.
-- =============================================================================
