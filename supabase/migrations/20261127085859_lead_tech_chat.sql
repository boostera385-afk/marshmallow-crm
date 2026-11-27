-- Purpose: open a tech's saved Quo chat from Tech Status (click Texted / Called or "Chat").
--   Returns the stored messages and call events between our Quo numbers and that tech's
--   phone, for this job only: from a day before the lead was created onward, newest 150,
--   oldest first. Read-only; never sends anything.
--   Same gate as AI Tech Status (marshmallow_private.can_see_tech_status, 20261127085131)
--   plus the caller must be able to see the lead (workflow_job_visible_to).
-- Idempotent. Rollback: DROP FUNCTION IF EXISTS public.get_lead_tech_chat(uuid, integer);
BEGIN;

CREATE OR REPLACE FUNCTION public.get_lead_tech_chat(p_lead_id uuid, p_tech_number integer)
RETURNS TABLE (
  id uuid,
  sender text,
  kind text,
  text text,
  message_time timestamptz,
  status text,
  has_media boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  uid uuid := auth.uid();
  lead_row public.leads;
  key text;
BEGIN
  IF uid IS NULL OR NOT marshmallow_private.can_see_tech_status(uid) THEN
    RAISE EXCEPTION 'AI Tech Status is not enabled for this user.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO lead_row FROM public.leads l WHERE l.id = p_lead_id;
  IF NOT FOUND OR NOT marshmallow_private.workflow_job_visible_to(uid, lead_row) THEN
    RAISE EXCEPTION 'You cannot open this lead.' USING ERRCODE = '42501';
  END IF;
  SELECT t.phone_key INTO key FROM public.lead_tech_contacts t
   WHERE t.lead_id = p_lead_id AND t.tech_number = p_tech_number;
  IF key IS NULL OR key !~ '^\d{10}$' THEN
    RETURN; -- no usable phone on the tech's line: nothing to show
  END IF;

  RETURN QUERY
  SELECT m.id, m.sender,
         CASE WHEN m.quo_message_id LIKE '%:call.%' THEN 'call' ELSE 'text' END,
         left(m.text, 2000),
         m.message_time,
         m.status,
         coalesce(jsonb_typeof(m.media) = 'array' AND jsonb_array_length(m.media) > 0, false)
    FROM (
      SELECT q.* FROM public.quo_messages q
       WHERE q.conversation_id IN (
               SELECT c.id FROM public.quo_conversations c
                WHERE marshmallow_private.schedule_phone_key(c.customer_number) = key)
         AND q.message_time >= lead_row.created_at - interval '1 day'
         AND (nullif(btrim(q.text), '') IS NOT NULL
              OR (jsonb_typeof(q.media) = 'array' AND jsonb_array_length(q.media) > 0))
       ORDER BY q.message_time DESC
       LIMIT 150
    ) m
   ORDER BY m.message_time ASC;
END $$;
REVOKE ALL ON FUNCTION public.get_lead_tech_chat(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lead_tech_chat(uuid, integer) TO authenticated;

COMMIT;
