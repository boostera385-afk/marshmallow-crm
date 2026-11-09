-- =============================================================================
-- Operators never receive Quote Updated or cancellation-request alerts
-- =============================================================================
-- Business decision (2026-11-09): Operators (opr, opr_admin) must not get
-- "Quote Updated" or "Lead cancellation request" notifications. Production had
-- 391 + 54 such rows for Operators (16 Oct - 5 Nov 2026), all sent by the old
-- browser sender; the server sender (20261207000000) already picks recipients
-- that exclude Operators. This makes the rule explicit in the one function that
-- writes lead notifications, so a later recipient change cannot send them again.
--
-- What this changes: marshmallow_private.notify_lead drops recipients whose only
-- roles are Operator roles for kinds quote_updated and cancellation_request.
-- Everything else in notify_lead is unchanged (actor exclusion, CS urgent rule,
-- one unread alert per user/lead/kind). Existing rows are not changed: the 445
-- old ones are read, outside the 3-day window, and removed by the 30-day
-- retention by 2026-12-05.
--
-- Apply after 20261208000000. Isolated harness: supabase/tests/153 (new checks)
-- via scripts/test-notifications-db.mjs. Rollback: re-run notify_lead from
-- 20261207000000.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION marshmallow_private.notify_lead(
  p_recipients uuid[], p_lead uuid, p_kind text, p_title text, p_message text, p_actor uuid, p_entity uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v uuid[];
  inserted integer := 0;
BEGIN
  SELECT coalesce(array_agg(DISTINCT c), '{}'::uuid[]) INTO v
  FROM unnest(p_recipients) c
  WHERE c IS NOT NULL AND c IS DISTINCT FROM p_actor
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = c)
    AND (p_kind <> 'urgent_job'
      OR NOT public.has_role(c, 'customer_service'::public.app_role)
      OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = p_lead AND (
        l.assigned_cs = c OR (l.assigned_cs IS NULL AND l.created_by = c)
        OR EXISTS (SELECT 1 FROM public.lead_shares s WHERE s.lead_id = l.id AND s.shared_with_user_id = c))))
    -- Operators never get Quote Updated or cancellation-request alerts.
    AND (p_kind NOT IN ('quote_updated', 'cancellation_request')
      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = c AND ur.role::text NOT IN ('opr', 'opr_admin')));
  IF cardinality(v) = 0 THEN
    RETURN 0;
  END IF;
  UPDATE public.notifications n SET message = p_message, created_at = now(), kind = p_kind, entity_id = coalesce(p_entity, n.entity_id)
  WHERE n.lead_id = p_lead AND n.read = false AND n.user_id = ANY (v)
    AND (n.kind = p_kind OR (n.kind IS NULL AND n.title = p_title));
  INSERT INTO public.notifications (user_id, title, message, lead_id, read, kind, entity_id)
  SELECT r, p_title, p_message, p_lead, false, p_kind, p_entity FROM unnest(v) r
  WHERE NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = r AND n.lead_id = p_lead AND n.read = false
    AND (n.kind = p_kind OR (n.kind IS NULL AND n.title = p_title)));
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.notify_lead(uuid[], uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
