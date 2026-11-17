-- =============================================================================
-- Migration: 20261119000000_urgent_review_scope_quote_fixes.sql
-- Purpose: Let a reviewed urgent pre-check correct service scope and price, not
--          just formatting, and keep schedule/status columns blocked.
-- Defect fixed: check-urgent-lead now judges the latest CONFIRMED customer
--               agreement, which is service_details and quote. Those two columns
--               were absent from apply_urgent_form_fixes()'s whitelist, so the
--               database silently returned reason "not_allowed" and every scope
--               or quote correction raised a red error while the UI reported a
--               normal correction. The model could not propose these fields
--               before, so no existing caller relied on them being rejected.
-- Safety:     Nothing is written without a human pressing Apply. The stale-value
--             guard, role check and FOR UPDATE lock are unchanged, and schedule,
--             terms, status and payment columns stay absent from the whitelist.
-- ROLLBACK:
--   Re-apply the previous apply_urgent_form_fixes() body from
--   20261107000001_ai_urgent_features.sql (whitelist without service_details
--   and quote).
-- =============================================================================

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
  -- Scope and price are the fields the latest-agreement review corrects. They
  -- are still never written without a person applying the suggestion.
  v_allowed   constant text[] := ARRAY[
    'customer_name', 'service_type', 'service_details', 'quote'
  ];
  v_max_len   integer;
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

    -- Hard whitelist. customer_schedule_requirements, scheduled_* , terms,
    -- status, quote_requested_by and payment columns can never be written here,
    -- whatever the caller (or the model) sends.
    IF v_field IS NULL OR NOT (v_field = ANY (v_allowed)) THEN
      v_skipped := v_skipped || jsonb_build_object('field', coalesce(v_field, ''), 'reason', 'not_allowed');
      CONTINUE;
    END IF;

    v_max_len := CASE v_field
      WHEN 'service_details' THEN 8000
      WHEN 'quote'           THEN 2000
      ELSE 200
    END;

    IF v_new = '' OR length(v_new) > v_max_len THEN
      v_skipped := v_skipped || jsonb_build_object('field', v_field, 'reason', 'invalid_value');
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

    -- Keep the snapshot current so a second fix in the same batch compares
    -- against what is now stored.
    v_lead := jsonb_set(v_lead, ARRAY[v_field], to_jsonb(v_new), false);
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
  'Applies human-reviewed urgent pre-check corrections to customer_name, '
  'service_type, service_details and quote. Never touches schedule, terms, '
  'status or payment columns. Skips any fix whose old value no longer matches '
  'the stored value. Address/city/state/zip corrections come from Google '
  'verification and are applied by the geocoder path instead.';

REVOKE ALL ON FUNCTION public.apply_urgent_form_fixes(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_urgent_form_fixes(uuid, jsonb) TO authenticated;