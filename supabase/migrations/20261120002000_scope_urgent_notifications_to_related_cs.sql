-- Purpose: prevent Urgent Job alerts from reaching an unrelated Customer Service
-- user even if a client submits that user in p_user_ids. Assigned CS wins; the
-- creator is eligible only while unassigned, and an explicit share stays related.
-- Other roles and notification titles retain their current behavior.

CREATE OR REPLACE FUNCTION public.dispatch_lead_status_notification(
  p_lead_id uuid, p_title text, p_message text, p_user_ids uuid[]
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_recipients uuid[];
  v_inserted integer := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (
    public.has_role(v_actor, 'admin'::public.app_role) OR public.has_role(v_actor, 'processor'::public.app_role)
    OR public.has_role(v_actor, 'opr'::public.app_role) OR public.has_role(v_actor, 'cs_admin'::public.app_role)
    OR public.has_role(v_actor, 'customer_service'::public.app_role)
  ) THEN RAISE EXCEPTION 'Not permitted to dispatch lead notifications'; END IF;
  IF p_lead_id IS NULL OR p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN RETURN 0; END IF;

  SELECT coalesce(array_agg(DISTINCT candidate), '{}'::uuid[]) INTO v_recipients
  FROM unnest(p_user_ids) candidate
  WHERE candidate IS NOT NULL AND candidate <> v_actor AND (
    p_title <> '[Alert] Urgent Job'
    OR NOT public.has_role(candidate, 'customer_service'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.leads l WHERE l.id = p_lead_id AND (
        l.assigned_cs = candidate
        OR (l.assigned_cs IS NULL AND l.created_by = candidate)
        OR EXISTS (SELECT 1 FROM public.lead_shares s WHERE s.lead_id = l.id AND s.shared_with_user_id = candidate)
      )
    )
  );
  IF array_length(v_recipients, 1) IS NULL THEN RETURN 0; END IF;

  UPDATE public.notifications n SET message = p_message, created_at = now()
   WHERE n.lead_id = p_lead_id AND n.title = p_title AND n.read = false
     AND n.user_id = ANY(v_recipients);
  INSERT INTO public.notifications(user_id, title, message, lead_id, read)
  SELECT recipient, p_title, p_message, p_lead_id, false FROM unnest(v_recipients) recipient
   WHERE NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = recipient
     AND n.lead_id = p_lead_id AND n.title = p_title AND n.read = false);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$fn$;
REVOKE ALL ON FUNCTION public.dispatch_lead_status_notification(uuid,text,text,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_lead_status_notification(uuid,text,text,uuid[]) TO authenticated;

-- Rollback: restore the function body from
-- 20260909120000_dedupe_lead_status_notifications.sql. Existing notifications
-- are retained; no lead or customer data is changed by this migration.
