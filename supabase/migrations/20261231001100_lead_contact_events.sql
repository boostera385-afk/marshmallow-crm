-- =============================================================================
-- Lead contact events: Call Incoming / Call Outgoing / Msg Incoming / Msg Outgoing
-- =============================================================================
-- WHAT
--   * lead_contact_events  : one row per call or text on a lead's Quo chat (a call
--                            counts once, however many call.* events Quo sends).
--   * lead_first_contacts  : the lead's first contact, set automatically from the
--                            earliest event, or set by hand (manual always wins).
--   * set_lead_first_contact(lead, contact) : the manual override. Staff who can
--                            see the lead in the workflow only; NULL clears the
--                            manual value and returns the lead to automatic.
--
-- WHICH CHATS
--   Found the way the schedule monitor does (schedule_conversation_matches,
--   20261130000000): a conversation linked to the lead, else an unlinked one with
--   the lead's 10-digit phone key. History starts 14 days before the lead was
--   created (the customer usually writes first), but never before the previous
--   lead on the same number, so a repeat customer's old job is not this job's
--   first contact.
--
-- WHY SEPARATE TABLES (not columns on leads)
--   Writing to `leads` on every Quo message would fire the Google Sheets outbox
--   and urgent-gate triggers and bump "last edited" (same reason as
--   lead_ai_statuses in 20261107000001).
--
-- HOW IT STAYS CURRENT
--   Triggers on quo_messages (every ingestion path), quo_conversations (link or
--   number change) and leads (new lead, changed phone). Each swallows its own
--   errors with a WARNING: this is a display aid and must never block Quo
--   ingestion or a lead save. Existing data is backfilled once.
--
-- HARNESS : supabase/tests/200_lead_contact_events.sql
--           (isolated PGlite: node scripts/test-lead-contact-events-db.mjs <pglite dir>)
-- ROLLBACK: bottom of this file.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS marshmallow_private;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_contact_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  direction       text NOT NULL,
  occurred_at     timestamptz NOT NULL,
  source          text NOT NULL DEFAULT 'quo',
  -- Quo message id for a text, Quo call id for a call (dedupes call.* events).
  source_key      text NOT NULL,
  conversation_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_contact_event_kind CHECK (kind IN ('call', 'msg')),
  CONSTRAINT lead_contact_event_direction CHECK (direction IN ('in', 'out')),
  CONSTRAINT lead_contact_event_source CHECK (source IN ('quo')),
  CONSTRAINT lead_contact_event_unique UNIQUE (lead_id, source_key)
);

CREATE INDEX IF NOT EXISTS lead_contact_events_lead_time_idx
  ON public.lead_contact_events (lead_id, occurred_at, id);

COMMENT ON TABLE public.lead_contact_events IS
  'Every call / text on a lead''s Quo chat, with its direction. Written only by '
  'triggers on quo_messages / quo_conversations / leads.';

CREATE TABLE IF NOT EXISTS public.lead_first_contacts (
  lead_id      uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  -- call_in | call_out | msg_in | msg_out
  contact      text NOT NULL,
  occurred_at  timestamptz,
  source       text NOT NULL,
  set_by       uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_first_contact_value CHECK (contact IN ('call_in', 'call_out', 'msg_in', 'msg_out')),
  CONSTRAINT lead_first_contact_source CHECK (source IN ('auto', 'manual'))
);

COMMENT ON TABLE public.lead_first_contacts IS
  'How the customer was first contacted. source=auto comes from the earliest '
  'lead_contact_events row; source=manual was chosen by staff and is never '
  'overwritten automatically.';

-- -----------------------------------------------------------------------------
-- 2. Read access follows lead visibility; no direct client writes.
-- -----------------------------------------------------------------------------
ALTER TABLE public.lead_contact_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_first_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read contact events of visible leads" ON public.lead_contact_events;
CREATE POLICY "Read contact events of visible leads"
  ON public.lead_contact_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_contact_events.lead_id));

DROP POLICY IF EXISTS "Read first contact of visible leads" ON public.lead_first_contacts;
CREATE POLICY "Read first contact of visible leads"
  ON public.lead_first_contacts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_first_contacts.lead_id));

REVOKE ALL ON TABLE public.lead_contact_events, public.lead_first_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_contact_events, public.lead_first_contacts TO authenticated;
GRANT ALL ON public.lead_contact_events, public.lead_first_contacts TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Helpers
-- -----------------------------------------------------------------------------
-- 'in' / 'out' from a stored Quo message. The webhook stores inbound/outbound;
-- history sync leaves direction empty, so fall back to the sender.
CREATE OR REPLACE FUNCTION marshmallow_private.quo_contact_direction(p_direction text, p_sender text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN lower(coalesce(p_direction, '')) IN ('inbound', 'incoming') THEN 'in'
    WHEN lower(coalesce(p_direction, '')) IN ('outbound', 'outgoing') THEN 'out'
    WHEN lower(coalesce(p_sender, '')) = 'customer' THEN 'in'
    WHEN lower(coalesce(p_sender, '')) = 'agent' THEN 'out'
  END
$$;

-- Calls are stored as "<callId>:call.<event>" rows (quo-ai.ts normalizeQuoCall).
CREATE OR REPLACE FUNCTION marshmallow_private.quo_contact_is_call(p_quo_message_id text, p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(p_quo_message_id, '') ~ ':call\.' OR coalesce(p_status, '') LIKE 'call.%'
$$;

-- Same 10-digit key the schedule monitor uses; indexed for the lookups below.
CREATE INDEX IF NOT EXISTS quo_conversations_phone_key_idx
  ON public.quo_conversations (marshmallow_private.schedule_phone_key(customer_number));
CREATE INDEX IF NOT EXISTS leads_phone_key_idx
  ON public.leads (marshmallow_private.schedule_phone_key(customer_phone));

CREATE OR REPLACE FUNCTION marshmallow_private.lead_contact_window_start(p_lead_id uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(greatest(
           l.created_at - interval '14 days',
           (SELECT max(o.created_at) FROM public.leads o
             WHERE marshmallow_private.schedule_phone_key(o.customer_phone) = marshmallow_private.schedule_phone_key(l.customer_phone)
               AND o.id <> l.id AND o.created_at < l.created_at)),
         '-infinity'::timestamptz)
    FROM public.leads l WHERE l.id = p_lead_id
$$;

CREATE OR REPLACE FUNCTION marshmallow_private.conversation_lead_ids(p_conversation_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.linked_lead_id FROM public.quo_conversations c
   WHERE c.id = p_conversation_id AND c.linked_lead_id IS NOT NULL
  UNION
  SELECT l.id FROM public.quo_conversations c
    JOIN public.leads l
      ON marshmallow_private.schedule_phone_key(l.customer_phone) = marshmallow_private.schedule_phone_key(c.customer_number)
   WHERE c.id = p_conversation_id AND c.linked_lead_id IS NULL
     AND marshmallow_private.schedule_phone_key(c.customer_number) IS NOT NULL
$$;

-- Re-derive the automatic first contact. Manual values are left alone.
CREATE OR REPLACE FUNCTION marshmallow_private.refresh_lead_first_contact(p_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE first_event record;
BEGIN
  IF p_lead_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.lead_first_contacts WHERE lead_id = p_lead_id AND source = 'manual') THEN
    RETURN;
  END IF;

  SELECT kind, direction, occurred_at INTO first_event
    FROM public.lead_contact_events
   WHERE lead_id = p_lead_id
   ORDER BY occurred_at, id
   LIMIT 1;

  IF NOT FOUND THEN
    DELETE FROM public.lead_first_contacts WHERE lead_id = p_lead_id AND source = 'auto';
    RETURN;
  END IF;

  INSERT INTO public.lead_first_contacts AS f (lead_id, contact, occurred_at, source, set_by, updated_at)
  VALUES (p_lead_id, first_event.kind || '_' || first_event.direction, first_event.occurred_at, 'auto', NULL, now())
  ON CONFLICT (lead_id) DO UPDATE
     SET contact = excluded.contact, occurred_at = excluded.occurred_at, updated_at = now()
   WHERE f.source = 'auto'
     AND (f.contact, f.occurred_at) IS DISTINCT FROM (excluded.contact, excluded.occurred_at);
END $$;

-- Record one stored Quo message against a lead (idempotent).
CREATE OR REPLACE FUNCTION marshmallow_private.record_lead_contact_event(
  p_lead_id uuid, p_conversation_id uuid, p_quo_message_id text, p_status text,
  p_direction text, p_sender text, p_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  dir text := marshmallow_private.quo_contact_direction(p_direction, p_sender);
  is_call boolean := marshmallow_private.quo_contact_is_call(p_quo_message_id, p_status);
  key text;
BEGIN
  IF p_lead_id IS NULL OR dir IS NULL OR p_quo_message_id IS NULL OR p_at IS NULL THEN RETURN false; END IF;
  key := CASE WHEN is_call THEN 'call:' || split_part(p_quo_message_id, ':', 1) ELSE 'msg:' || p_quo_message_id END;

  INSERT INTO public.lead_contact_events AS e (lead_id, kind, direction, occurred_at, source, source_key, conversation_id)
  VALUES (p_lead_id, CASE WHEN is_call THEN 'call' ELSE 'msg' END, dir, p_at, 'quo', key, p_conversation_id)
  ON CONFLICT (lead_id, source_key) DO UPDATE
     SET occurred_at = least(e.occurred_at, excluded.occurred_at)
   WHERE excluded.occurred_at < e.occurred_at;
  RETURN true;
END $$;

-- Re-derive one lead's events from scratch (new lead, changed phone, relinked chat).
CREATE OR REPLACE FUNCTION marshmallow_private.rebuild_lead_contact_events(p_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE since timestamptz; k text;
BEGIN
  IF p_lead_id IS NULL THEN RETURN; END IF;
  DELETE FROM public.lead_contact_events WHERE lead_id = p_lead_id;
  SELECT marshmallow_private.schedule_phone_key(customer_phone) INTO k FROM public.leads WHERE id = p_lead_id;
  IF FOUND THEN
    since := marshmallow_private.lead_contact_window_start(p_lead_id);
    INSERT INTO public.lead_contact_events (lead_id, kind, direction, occurred_at, source, source_key, conversation_id)
    SELECT p_lead_id, x.kind, x.direction, min(x.at), 'quo', x.source_key, (array_agg(x.conversation_id ORDER BY x.at))[1]
      FROM (
        SELECT CASE WHEN marshmallow_private.quo_contact_is_call(m.quo_message_id, m.status) THEN 'call' ELSE 'msg' END AS kind,
               marshmallow_private.quo_contact_direction(m.direction, m.sender) AS direction,
               coalesce(m.message_time, m.quo_created_at, m.created_at) AS at,
               CASE WHEN marshmallow_private.quo_contact_is_call(m.quo_message_id, m.status)
                    THEN 'call:' || split_part(m.quo_message_id, ':', 1) ELSE 'msg:' || m.quo_message_id END AS source_key,
               c.id AS conversation_id
          FROM public.quo_conversations c
          JOIN public.quo_messages m ON m.conversation_id = c.id
         WHERE (c.linked_lead_id = p_lead_id
                OR (c.linked_lead_id IS NULL AND k IS NOT NULL
                    AND marshmallow_private.schedule_phone_key(c.customer_number) = k))
      ) x
     WHERE x.direction IS NOT NULL AND x.at IS NOT NULL AND x.at >= since
     GROUP BY x.kind, x.direction, x.source_key
    ON CONFLICT (lead_id, source_key) DO NOTHING;
  END IF;
  PERFORM marshmallow_private.refresh_lead_first_contact(p_lead_id);
END $$;

REVOKE ALL ON FUNCTION marshmallow_private.lead_contact_window_start(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION marshmallow_private.conversation_lead_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION marshmallow_private.refresh_lead_first_contact(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION marshmallow_private.record_lead_contact_event(uuid, uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION marshmallow_private.rebuild_lead_contact_events(uuid) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Triggers (each swallows its own errors; see header)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marshmallow_private.trg_quo_message_contact_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lead uuid; at timestamptz := coalesce(NEW.message_time, NEW.quo_created_at, NEW.created_at);
BEGIN
  FOR lead IN SELECT marshmallow_private.conversation_lead_ids(NEW.conversation_id) LOOP
    IF at >= marshmallow_private.lead_contact_window_start(lead)
       AND marshmallow_private.record_lead_contact_event(
             lead, NEW.conversation_id, NEW.quo_message_id, NEW.status, NEW.direction, NEW.sender, at) THEN
      PERFORM marshmallow_private.refresh_lead_first_contact(lead);
    END IF;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'lead contact event skipped for Quo message %: %', NEW.quo_message_id, SQLERRM;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS quo_message_contact_event ON public.quo_messages;
CREATE TRIGGER quo_message_contact_event
  AFTER INSERT OR UPDATE OF conversation_id, direction, sender, status, message_time ON public.quo_messages
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.trg_quo_message_contact_event();

CREATE OR REPLACE FUNCTION marshmallow_private.trg_quo_conversation_contact_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lead uuid;
BEGIN
  FOR lead IN
    SELECT OLD.linked_lead_id
    UNION SELECT NEW.linked_lead_id
    UNION SELECT l.id FROM public.leads l
     WHERE marshmallow_private.schedule_phone_key(l.customer_phone) IN (
       marshmallow_private.schedule_phone_key(OLD.customer_number),
       marshmallow_private.schedule_phone_key(NEW.customer_number))
  LOOP
    IF lead IS NOT NULL THEN PERFORM marshmallow_private.rebuild_lead_contact_events(lead); END IF;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'lead contact relink skipped for conversation %: %', NEW.id, SQLERRM;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS quo_conversation_contact_link_upd ON public.quo_conversations;
CREATE TRIGGER quo_conversation_contact_link_upd
  AFTER UPDATE OF linked_lead_id, customer_number ON public.quo_conversations
  FOR EACH ROW
  WHEN (OLD.linked_lead_id IS DISTINCT FROM NEW.linked_lead_id OR OLD.customer_number IS DISTINCT FROM NEW.customer_number)
  EXECUTE FUNCTION marshmallow_private.trg_quo_conversation_contact_link();

-- A lead created after the customer already wrote (the usual case), or a corrected number.
CREATE OR REPLACE FUNCTION marshmallow_private.trg_lead_contact_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM marshmallow_private.rebuild_lead_contact_events(NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'lead contact history skipped for lead %: %', NEW.id, SQLERRM;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS lead_contact_history_ins ON public.leads;
CREATE TRIGGER lead_contact_history_ins
  AFTER INSERT ON public.leads
  FOR EACH ROW WHEN (NEW.customer_phone IS NOT NULL)
  EXECUTE FUNCTION marshmallow_private.trg_lead_contact_history();

DROP TRIGGER IF EXISTS lead_contact_history_upd ON public.leads;
CREATE TRIGGER lead_contact_history_upd
  AFTER UPDATE OF customer_phone ON public.leads
  FOR EACH ROW WHEN (OLD.customer_phone IS DISTINCT FROM NEW.customer_phone)
  EXECUTE FUNCTION marshmallow_private.trg_lead_contact_history();

REVOKE ALL ON FUNCTION marshmallow_private.trg_quo_message_contact_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION marshmallow_private.trg_quo_conversation_contact_link() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION marshmallow_private.trg_lead_contact_history() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Manual override
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_lead_first_contact(p_lead_id uuid, p_contact text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lead_row public.leads; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF p_contact IS NOT NULL AND p_contact NOT IN ('call_in', 'call_out', 'msg_in', 'msg_out') THEN
    RAISE EXCEPTION 'Unknown contact type.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO lead_row FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND OR NOT marshmallow_private.workflow_job_visible_to(uid, lead_row) THEN
    RAISE EXCEPTION 'You cannot change this lead.' USING ERRCODE = '42501';
  END IF;

  IF p_contact IS NULL THEN
    -- Back to automatic.
    DELETE FROM public.lead_first_contacts WHERE lead_id = p_lead_id AND source = 'manual';
    PERFORM marshmallow_private.refresh_lead_first_contact(p_lead_id);
  ELSE
    INSERT INTO public.lead_first_contacts AS f (lead_id, contact, occurred_at, source, set_by, updated_at)
    VALUES (p_lead_id, p_contact, NULL, 'manual', uid, now())
    ON CONFLICT (lead_id) DO UPDATE
       SET contact = excluded.contact, occurred_at = NULL, source = 'manual', set_by = uid, updated_at = now();
  END IF;

  RETURN coalesce(
    (SELECT jsonb_build_object('contact', contact, 'source', source, 'occurred_at', occurred_at)
       FROM public.lead_first_contacts WHERE lead_id = p_lead_id),
    jsonb_build_object('contact', NULL, 'source', NULL, 'occurred_at', NULL));
END $$;

REVOKE ALL ON FUNCTION public.set_lead_first_contact(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_first_contact(uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Realtime + one-time backfill
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                      AND schemaname = 'public' AND tablename = 'lead_first_contacts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_first_contacts;
  END IF;
END $$;

DO $$
DECLARE l uuid;
BEGIN
  FOR l IN SELECT id FROM public.leads WHERE customer_phone IS NOT NULL
           UNION SELECT linked_lead_id FROM public.quo_conversations WHERE linked_lead_id IS NOT NULL LOOP
    PERFORM marshmallow_private.rebuild_lead_contact_events(l);
  END LOOP;
END $$;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
/*
DROP TRIGGER IF EXISTS quo_message_contact_event ON public.quo_messages;
DROP TRIGGER IF EXISTS quo_conversation_contact_link_upd ON public.quo_conversations;
DROP TRIGGER IF EXISTS lead_contact_history_ins ON public.leads;
DROP TRIGGER IF EXISTS lead_contact_history_upd ON public.leads;
DROP FUNCTION IF EXISTS public.set_lead_first_contact(uuid, text);
DROP FUNCTION IF EXISTS marshmallow_private.trg_lead_contact_history();
DROP FUNCTION IF EXISTS marshmallow_private.trg_quo_message_contact_event();
DROP FUNCTION IF EXISTS marshmallow_private.trg_quo_conversation_contact_link();
DROP FUNCTION IF EXISTS marshmallow_private.rebuild_lead_contact_events(uuid);
DROP FUNCTION IF EXISTS marshmallow_private.record_lead_contact_event(uuid, uuid, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS marshmallow_private.refresh_lead_first_contact(uuid);
DROP FUNCTION IF EXISTS marshmallow_private.conversation_lead_ids(uuid);
DROP FUNCTION IF EXISTS marshmallow_private.lead_contact_window_start(uuid);
DROP FUNCTION IF EXISTS marshmallow_private.quo_contact_is_call(text, text);
DROP FUNCTION IF EXISTS marshmallow_private.quo_contact_direction(text, text);
DROP INDEX IF EXISTS public.quo_conversations_phone_key_idx;
DROP INDEX IF EXISTS public.leads_phone_key_idx;
DROP TABLE IF EXISTS public.lead_first_contacts;
DROP TABLE IF EXISTS public.lead_contact_events;
*/
