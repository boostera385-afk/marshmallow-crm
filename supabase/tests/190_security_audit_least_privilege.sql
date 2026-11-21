-- WRITE-BASED HARNESS. ISOLATED POSTGRES ONLY (scripts/test-security-audit-db.mjs).
-- Covers 20261231000100_security_audit_least_privilege. Uses synthetic users and
-- rows only; everything rolls back.
BEGIN;
CREATE TEMP TABLE checks(name text, result text);
GRANT ALL ON checks TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.check_result(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO checks VALUES (label, CASE WHEN coalesce(ok, false) THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.as_user(p_id text, p_role text DEFAULT 'authenticated') RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_id, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', p_role)::text, true);
$$;
-- Rows affected by a statement, or -1 when it is refused with an error.
CREATE FUNCTION pg_temp.affected(stmt text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
EXCEPTION WHEN insufficient_privilege OR raise_exception THEN RETURN -1;
END $$;
CREATE FUNCTION pg_temp.visible(stmt text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || stmt || ') q' INTO n; RETURN n;
EXCEPTION WHEN insufficient_privilege THEN RETURN -1;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.affected(text), pg_temp.visible(text) TO authenticated, anon, service_role;

-- 1 admin, 2 processor, 3 CS, 4 CS Admin, 5 OPR, 6 OPR Admin, 7 no role,
-- 8 CS granted the Quo Monitor screen.
INSERT INTO auth.users SELECT ('19000000-0000-4000-8000-00000000000' || n)::uuid FROM generate_series(1, 8) n;
INSERT INTO public.profiles(id, full_name, opr_code)
SELECT id, 'Synthetic ' || right(id::text, 1), CASE WHEN right(id::text, 1) = '5' THEN 'OPR001' END
  FROM auth.users WHERE id::text LIKE '19000000-%';
INSERT INTO public.user_roles VALUES
  ('19000000-0000-4000-8000-000000000001', 'admin'), ('19000000-0000-4000-8000-000000000002', 'processor'),
  ('19000000-0000-4000-8000-000000000003', 'customer_service'), ('19000000-0000-4000-8000-000000000004', 'cs_admin'),
  ('19000000-0000-4000-8000-000000000005', 'opr'), ('19000000-0000-4000-8000-000000000006', 'opr_admin'),
  ('19000000-0000-4000-8000-000000000008', 'customer_service');
INSERT INTO public.navigation_permissions(user_id, nav_section, allowed) VALUES
  ('19000000-0000-4000-8000-000000000008', 'quo_monitor', true),
  ('19000000-0000-4000-8000-000000000003', 'quo_monitor', false);
INSERT INTO public.quo_conversations(id, quo_conversation_id, customer_name, customer_number) VALUES
  ('19100000-0000-4000-8000-000000000001', 'CN-SYN-1', 'Synthetic Customer', '+15550000001');
INSERT INTO public.quo_messages(conversation_id, sender, direction, text) VALUES
  ('19100000-0000-4000-8000-000000000001', 'customer', 'inbound', 'synthetic inbound');
INSERT INTO public.quo_number_preferences(phone_number_id) VALUES ('PN-SYN-1');
INSERT INTO storage.objects(id, bucket_id, name, owner_id) VALUES
  ('19200000-0000-4000-8000-000000000001', 'lead-photos', 'pay/cs3.jpg', '19000000-0000-4000-8000-000000000003'),
  ('19200000-0000-4000-8000-000000000002', 'lead-photos', 'pay/cs3-b.jpg', '19000000-0000-4000-8000-000000000003'),
  ('19200000-0000-4000-8000-000000000003', 'lead-photos', 'pay/cs3-c.jpg', '19000000-0000-4000-8000-000000000003');
INSERT INTO public.technician_change_requests(technician_name, change_type, reason) VALUES ('Synthetic Tech', 'set_active', 'synthetic');

-- ---- Reads: CRM staff yes; OPR, OPR Admin and role-less accounts no ----------
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Admin reads conversations and messages',
  pg_temp.visible('SELECT 1 FROM public.quo_conversations') = 1 AND pg_temp.visible('SELECT 1 FROM public.quo_messages') = 1);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000002'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Processor reads conversations (Processor Board)', pg_temp.visible('SELECT 1 FROM public.quo_conversations') = 1);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('CS reads conversations and messages (AI Assistance, Quo chat)',
  pg_temp.visible('SELECT 1 FROM public.quo_conversations') = 1 AND pg_temp.visible('SELECT 1 FROM public.quo_messages') = 1);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000004'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('CS Admin reads conversations', pg_temp.visible('SELECT 1 FROM public.quo_conversations') = 1);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000005'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('OPR cannot read customer conversations or messages',
  pg_temp.visible('SELECT 1 FROM public.quo_conversations') = 0 AND pg_temp.visible('SELECT 1 FROM public.quo_messages') = 0);
SELECT pg_temp.check_result('OPR cannot read Quo number preferences', pg_temp.visible('SELECT 1 FROM public.quo_number_preferences') = 0);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000006'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('OPR Admin cannot read customer messages', pg_temp.visible('SELECT 1 FROM public.quo_messages') = 0);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000007'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('A signed-in account with no role reads no conversations or messages',
  pg_temp.visible('SELECT 1 FROM public.quo_conversations') = 0 AND pg_temp.visible('SELECT 1 FROM public.quo_messages') = 0);
RESET ROLE;
SELECT pg_temp.as_user(NULL, 'anon'); SET LOCAL ROLE anon;
SELECT pg_temp.check_result('anon has no table access to conversations or messages',
  pg_temp.visible('SELECT 1 FROM public.quo_conversations') = -1 AND pg_temp.visible('SELECT 1 FROM public.quo_messages') = -1);
RESET ROLE;

-- ---- Conversation writes --------------------------------------------------
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('CS can record the last agent message (QuoChatDialog columns)',
  pg_temp.affected($$UPDATE public.quo_conversations SET last_message_preview = 'hi', last_message_at = now(),
    last_message_time = now(), last_agent_message_at = now() WHERE id = '19100000-0000-4000-8000-000000000001'$$) = 1);
SELECT pg_temp.check_result('CS can change Quo lead status (Quo Monitor columns)',
  pg_temp.affected($$UPDATE public.quo_conversations SET status = 'contacted', current_status = 'contacted', updated_at = now()
    WHERE id = '19100000-0000-4000-8000-000000000001'$$) = 1);
SELECT pg_temp.check_result('CS cannot re-link a conversation to another lead',
  pg_temp.affected($$UPDATE public.quo_conversations SET linked_lead_id = gen_random_uuid() WHERE id = '19100000-0000-4000-8000-000000000001'$$) = -1);
SELECT pg_temp.check_result('CS cannot rename the customer or change their number',
  pg_temp.affected($$UPDATE public.quo_conversations SET customer_name = 'x' WHERE id = '19100000-0000-4000-8000-000000000001'$$) = -1
  AND pg_temp.affected($$UPDATE public.quo_conversations SET customer_number = '+15550009999' WHERE id = '19100000-0000-4000-8000-000000000001'$$) = -1);
SELECT pg_temp.check_result('CS cannot create or delete conversations',
  pg_temp.affected($$INSERT INTO public.quo_conversations(quo_conversation_id) VALUES ('CN-FAKE')$$) = -1
  AND pg_temp.affected($$DELETE FROM public.quo_conversations$$) = -1);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000005'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('OPR update of a conversation changes nothing',
  pg_temp.affected($$UPDATE public.quo_conversations SET status = 'lost' WHERE id = '19100000-0000-4000-8000-000000000001'$$) = 0);
RESET ROLE;
SELECT pg_temp.check_result('Saved link and customer identity are untouched',
  (SELECT linked_lead_id IS NULL AND customer_name = 'Synthetic Customer' AND customer_number = '+15550000001' AND status = 'contacted'
     FROM public.quo_conversations WHERE id = '19100000-0000-4000-8000-000000000001'));

-- ---- Message inserts ------------------------------------------------------
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('CS can log their own outbound agent message',
  pg_temp.affected($$INSERT INTO public.quo_messages(conversation_id, sender, direction, text, quo_message_id)
    VALUES ('19100000-0000-4000-8000-000000000001', 'agent', 'outbound', 'synthetic reply', 'msg_web_1')$$) = 1);
SELECT pg_temp.check_result('CS cannot forge a message from the customer',
  pg_temp.affected($$INSERT INTO public.quo_messages(conversation_id, sender, direction, text)
    VALUES ('19100000-0000-4000-8000-000000000001', 'customer', 'inbound', 'forged')$$) = -1);
SELECT pg_temp.check_result('CS cannot edit or delete stored messages',
  pg_temp.affected($$UPDATE public.quo_messages SET text = 'edited'$$) = -1 AND pg_temp.affected($$DELETE FROM public.quo_messages$$) = -1);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000007'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('A role-less account cannot insert messages',
  pg_temp.affected($$INSERT INTO public.quo_messages(conversation_id, sender, direction, text)
    VALUES ('19100000-0000-4000-8000-000000000001', 'agent', 'outbound', 'x')$$) = -1);
RESET ROLE;

-- ---- Quo number preferences ---------------------------------------------------
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000008'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('A user granted Quo Monitor can manage number layout',
  pg_temp.affected($$UPDATE public.quo_number_preferences SET sort_order = 2 WHERE phone_number_id = 'PN-SYN-1'$$) = 1
  AND pg_temp.affected($$INSERT INTO public.quo_number_preferences(phone_number_id) VALUES ('PN-SYN-2')$$) = 1);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('CS without (or with a denied) Quo Monitor grant can read but not change the layout',
  pg_temp.visible('SELECT 1 FROM public.quo_number_preferences') = 2
  AND pg_temp.affected($$UPDATE public.quo_number_preferences SET hidden = true$$) = 0
  AND pg_temp.affected($$INSERT INTO public.quo_number_preferences(phone_number_id) VALUES ('PN-SYN-3')$$) = -1);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Admin can manage number layout',
  pg_temp.affected($$UPDATE public.quo_number_preferences SET hidden = false$$) = 2);
RESET ROLE;

-- ---- Storage deletes ------------------------------------------------------
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000005'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('OPR cannot delete another user''s payment screenshot',
  pg_temp.affected($$DELETE FROM storage.objects WHERE id = '19200000-0000-4000-8000-000000000001'$$) = 0);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000004'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('CS Admin cannot delete another user''s upload',
  pg_temp.affected($$DELETE FROM storage.objects WHERE id = '19200000-0000-4000-8000-000000000001'$$) = 0);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('The uploader can still remove their own failed upload (Donut cleanup)',
  pg_temp.affected($$DELETE FROM storage.objects WHERE id = '19200000-0000-4000-8000-000000000001'$$) = 1);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000002'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Processor can replace operator-assignment photos',
  pg_temp.affected($$DELETE FROM storage.objects WHERE id = '19200000-0000-4000-8000-000000000002'$$) = 1);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Admin can delete a photo',
  pg_temp.affected($$DELETE FROM storage.objects WHERE id = '19200000-0000-4000-8000-000000000003'$$) = 1);
RESET ROLE;

-- ---- RPC caller checks ------------------------------------------------------
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('CS cannot assign an OPR code to another profile',
  pg_temp.affected($$SELECT public.assign_next_opr_code('19000000-0000-4000-8000-000000000007')$$) = -1);
SELECT pg_temp.check_result('CS cannot list technician change requests',
  pg_temp.visible('SELECT * FROM public.list_technician_change_requests()') = 0);
SELECT pg_temp.check_result('CS (a staff role) can still list OPR codes', pg_temp.visible('SELECT * FROM public.list_opr_codes()') = 1);
RESET ROLE;
SELECT pg_temp.check_result('The refused OPR-code call wrote nothing',
  (SELECT opr_code IS NULL FROM public.profiles WHERE id = '19000000-0000-4000-8000-000000000007'));
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000007'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('A role-less account gets no OPR codes', pg_temp.visible('SELECT * FROM public.list_opr_codes()') = 0);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000002'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Processor lists technician change requests',
  pg_temp.visible('SELECT * FROM public.list_technician_change_requests()') = 1);
RESET ROLE;
SELECT pg_temp.as_user('19000000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Admin assigns an OPR code', pg_temp.affected($$SELECT public.assign_next_opr_code('19000000-0000-4000-8000-000000000006')$$) = 1);
RESET ROLE;
SELECT pg_temp.as_user(NULL, 'service_role'); SET LOCAL ROLE service_role;
SELECT pg_temp.check_result('The admin-users Edge Function (service role) assigns an OPR code',
  pg_temp.affected($$SELECT public.assign_next_opr_code('19000000-0000-4000-8000-000000000007')$$) = 1);
RESET ROLE;
SELECT pg_temp.as_user(NULL, 'anon'); SET LOCAL ROLE anon;
SELECT pg_temp.check_result('anon cannot execute the OPR-code RPCs',
  pg_temp.affected($$SELECT public.assign_next_opr_code('19000000-0000-4000-8000-000000000007')$$) = -1
  AND pg_temp.visible('SELECT * FROM public.list_opr_codes()') = -1);
RESET ROLE;

SELECT name, result FROM checks;
ROLLBACK;
