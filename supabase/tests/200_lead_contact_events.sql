-- ISOLATED ONLY: synthetic fixtures are created by test-lead-contact-events-db.mjs.
BEGIN;
CREATE TEMP TABLE checks(name text, result text);
GRANT SELECT, INSERT ON checks TO authenticated;

CREATE FUNCTION pg_temp.check(n text, ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO checks VALUES (n, CASE WHEN coalesce(ok, false) THEN 'PASS' ELSE 'FAIL' END);
$$;

-- Backfill (chat matched by phone key, no linked_lead_id)
SELECT pg_temp.check('backfill: one call row for two call.* events',
  (SELECT count(*) FROM public.lead_contact_events WHERE lead_id='a0000000-0000-4000-8000-000000000001' AND kind='call') = 1);
SELECT pg_temp.check('backfill: message older than 14 days before the lead is excluded',
  (SELECT count(*) FROM public.lead_contact_events WHERE lead_id='a0000000-0000-4000-8000-000000000001') = 2);
SELECT pg_temp.check('backfill: first contact is the earliest in window (msg_out, auto)',
  (SELECT contact='msg_out' AND source='auto' FROM public.lead_first_contacts WHERE lead_id='a0000000-0000-4000-8000-000000000001'));

-- Live ingestion on lead B's number; history-sync style row (no direction)
INSERT INTO public.quo_conversations VALUES ('c0000000-0000-4000-8000-000000000002', 'CN-B', NULL, '+14075550202');
INSERT INTO public.quo_messages (quo_message_id, conversation_id, sender, direction, status, message_time) VALUES
  ('MSG-B1', 'c0000000-0000-4000-8000-000000000002', 'customer', NULL, NULL, '2026-11-02 09:00+00');
SELECT pg_temp.check('live message matched by phone (sender fallback = msg_in)',
  (SELECT contact FROM public.lead_first_contacts WHERE lead_id='b0000000-0000-4000-8000-000000000002') = 'msg_in');
INSERT INTO public.quo_messages (quo_message_id, conversation_id, sender, direction, status, message_time) VALUES
  ('CALL-B:call.completed', 'c0000000-0000-4000-8000-000000000002', 'agent', 'outbound', 'completed', '2026-11-02 08:00+00');
SELECT pg_temp.check('an earlier event arriving late becomes the first contact',
  (SELECT contact FROM public.lead_first_contacts WHERE lead_id='b0000000-0000-4000-8000-000000000002') = 'call_out');
INSERT INTO public.quo_messages (quo_message_id, conversation_id, sender, direction, status, message_time) VALUES
  ('MSG-B-weird', 'c0000000-0000-4000-8000-000000000002', 'weird', 'sideways', NULL, '2026-11-02 10:00+00');
SELECT pg_temp.check('unknown direction is ignored',
  (SELECT count(*) FROM public.lead_contact_events WHERE lead_id='b0000000-0000-4000-8000-000000000002') = 2);

-- Unknown number records nothing
INSERT INTO public.quo_conversations VALUES ('c0000000-0000-4000-8000-000000000009', 'CN-X', NULL, '+12125550999');
INSERT INTO public.quo_messages (quo_message_id, conversation_id, sender, direction, message_time) VALUES
  ('MSG-X', 'c0000000-0000-4000-8000-000000000009', 'customer', 'inbound', '2026-11-02 09:00+00');
SELECT pg_temp.check('chat with no matching lead records nothing',
  NOT EXISTS (SELECT 1 FROM public.lead_contact_events WHERE conversation_id='c0000000-0000-4000-8000-000000000009'));

-- A lead created after the customer already wrote picks up that history
INSERT INTO public.leads VALUES
  ('c1000000-0000-4000-8000-000000000003', 'urgent_job', NULL, NULL, '212 555 0999', '2026-11-03 12:00+00');
SELECT pg_temp.check('new lead backfills its earlier chat',
  (SELECT contact FROM public.lead_first_contacts WHERE lead_id='c1000000-0000-4000-8000-000000000003') = 'msg_in');

-- Repeat customer: a second lead on lead A's number starts after the first lead
INSERT INTO public.leads VALUES
  ('d1000000-0000-4000-8000-000000000004', 'urgent_job', NULL, NULL, '3055550101', '2026-11-05 12:00+00');
SELECT pg_temp.check('repeat customer: old job chat is not the new lead''s history',
  NOT EXISTS (SELECT 1 FROM public.lead_contact_events WHERE lead_id='d1000000-0000-4000-8000-000000000004'));
INSERT INTO public.quo_messages (quo_message_id, conversation_id, sender, direction, message_time) VALUES
  ('MSG-A2', 'c0000000-0000-4000-8000-000000000001', 'customer', 'inbound', '2026-11-05 11:00+00');
SELECT pg_temp.check('repeat customer: new message counts for the new lead',
  (SELECT contact FROM public.lead_first_contacts WHERE lead_id='d1000000-0000-4000-8000-000000000004') = 'msg_in');
SELECT pg_temp.check('repeat customer: first lead keeps its own first contact',
  (SELECT contact FROM public.lead_first_contacts WHERE lead_id='a0000000-0000-4000-8000-000000000001') = 'msg_out');

-- Manual override and permissions
SET LOCAL ROLE authenticated;
DO $$
DECLARE caller record; ok boolean;
BEGIN
  FOR caller IN SELECT * FROM public.user_roles LOOP
    PERFORM set_config('request.jwt.claim.sub', caller.user_id::text, true);
    BEGIN
      PERFORM public.set_lead_first_contact('a0000000-0000-4000-8000-000000000001', 'call_in');
      ok := true;
    EXCEPTION WHEN insufficient_privilege THEN ok := false;
    END;
    INSERT INTO checks VALUES (caller.role || ' manual set on lead A',
      CASE WHEN ok = (caller.role::text IN ('admin','processor','customer_service','cs_admin')) THEN 'PASS' ELSE 'FAIL' END);
    BEGIN
      PERFORM public.set_lead_first_contact('b0000000-0000-4000-8000-000000000002', 'call_in');
      ok := true;
    EXCEPTION WHEN insufficient_privilege THEN ok := false;
    END;
    INSERT INTO checks VALUES (caller.role || ' manual set on lead B (not own)',
      CASE WHEN ok = (caller.role::text IN ('admin','processor','cs_admin')) THEN 'PASS' ELSE 'FAIL' END);
  END LOOP;
  BEGIN
    INSERT INTO public.lead_first_contacts(lead_id, contact, source) VALUES ('a0000000-0000-4000-8000-000000000001','msg_in','manual');
    INSERT INTO checks VALUES ('direct client write is blocked', 'FAIL');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO checks VALUES ('direct client write is blocked', 'PASS');
  END;
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', true);
  INSERT INTO checks VALUES ('CS reads only own lead contacts',
    CASE WHEN (SELECT count(DISTINCT lead_id) FROM public.lead_first_contacts) = 1 THEN 'PASS' ELSE 'FAIL' END);
  PERFORM set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
  BEGIN
    PERFORM public.set_lead_first_contact('a0000000-0000-4000-8000-000000000001', 'bogus');
    INSERT INTO checks VALUES ('unknown contact type rejected', 'FAIL');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO checks VALUES ('unknown contact type rejected', 'PASS');
  END;
END $$;
RESET ROLE;

SELECT pg_temp.check('manual value survives new Quo events',
  (SELECT contact='call_in' AND source='manual' FROM public.lead_first_contacts WHERE lead_id='a0000000-0000-4000-8000-000000000001'));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
SELECT public.set_lead_first_contact('a0000000-0000-4000-8000-000000000001', NULL);
RESET ROLE;
SELECT pg_temp.check('clearing manual returns to automatic',
  (SELECT contact='msg_out' AND source='auto' FROM public.lead_first_contacts WHERE lead_id='a0000000-0000-4000-8000-000000000001'));

-- Linking the chat to another lead moves its events there
UPDATE public.quo_conversations SET linked_lead_id='c1000000-0000-4000-8000-000000000003' WHERE id='c0000000-0000-4000-8000-000000000001';
SELECT pg_temp.check('linking moves the chat: old lead loses events, auto first contact cleared',
  NOT EXISTS (SELECT 1 FROM public.lead_contact_events WHERE lead_id='a0000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.lead_first_contacts WHERE lead_id='a0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.check('linking moves the chat: linked lead gains its events',
  EXISTS (SELECT 1 FROM public.lead_contact_events WHERE lead_id='c1000000-0000-4000-8000-000000000003' AND conversation_id='c0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.check('lead B keeps a manual first contact through relinks',
  (SELECT source FROM public.lead_first_contacts WHERE lead_id='b0000000-0000-4000-8000-000000000002') = 'manual');

-- A broken helper must not block ingestion
ALTER FUNCTION marshmallow_private.lead_contact_window_start(uuid) RENAME TO lead_contact_window_start_off;
INSERT INTO public.quo_messages (quo_message_id, conversation_id, sender, direction, message_time) VALUES
  ('MSG-SAFE', 'c0000000-0000-4000-8000-000000000002', 'customer', 'inbound', '2026-11-06 09:00+00');
SELECT pg_temp.check('ingestion still succeeds when the contact trigger fails',
  EXISTS (SELECT 1 FROM public.quo_messages WHERE quo_message_id='MSG-SAFE'));
ALTER FUNCTION marshmallow_private.lead_contact_window_start_off(uuid) RENAME TO lead_contact_window_start;

SELECT name, result FROM checks ORDER BY name;
ROLLBACK;
