-- WRITE-BASED HARNESS. ISOLATED POSTGRES ONLY (scripts/test-workflow-inbox-db.mjs).
-- Covers 20261206000000_notification_access_on_read: a notification that names a
-- lead is shown only while its recipient can open that lead. Everything rolls back.
BEGIN;
CREATE TEMP TABLE checks(name text, result text);
GRANT ALL ON checks TO authenticated;
CREATE FUNCTION pg_temp.check_result(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO checks VALUES (label, CASE WHEN coalesce(ok, false) THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.as_user(p_id text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_id, true);
$$;
-- Titles of the caller's notifications the caller can read, sorted.
CREATE FUNCTION pg_temp.mine() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(title, ',' ORDER BY title COLLATE "C"), '') FROM public.notifications;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.mine() TO authenticated;

-- 1 admin, 2 processor, 3 CS (owner), 4 other CS, 5 CS Admin, 6 operator
INSERT INTO auth.users(id, email) SELECT ('15200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'access-' || n || '@example.invalid' FROM generate_series(1, 6) n;
INSERT INTO public.profiles(id, full_name) SELECT id, 'Synthetic ' || right(id::text, 1) FROM auth.users WHERE id::text LIKE '15200000-%';
INSERT INTO public.user_roles(user_id, role) VALUES
  ('15200000-0000-4000-8000-000000000001', 'admin'), ('15200000-0000-4000-8000-000000000002', 'processor'),
  ('15200000-0000-4000-8000-000000000003', 'customer_service'), ('15200000-0000-4000-8000-000000000004', 'customer_service'),
  ('15200000-0000-4000-8000-000000000005', 'cs_admin'), ('15200000-0000-4000-8000-000000000006', 'opr');
INSERT INTO public.leads(id, job_id, status, customer_name, created_by) VALUES
  ('15200000-0000-4000-8000-000000000101', 'ACC-OWN', 'urgent_job', 'Synthetic A', '15200000-0000-4000-8000-000000000003'),
  ('15200000-0000-4000-8000-000000000102', 'ACC-OTHER', 'urgent_job', 'Synthetic B', '15200000-0000-4000-8000-000000000004'),
  ('15200000-0000-4000-8000-000000000103', 'ACC-PAID', 'paid', 'Synthetic C', '15200000-0000-4000-8000-000000000004'),
  ('15200000-0000-4000-8000-000000000104', 'ACC-QUOTE', 'quote_updated', 'Synthetic D', '15200000-0000-4000-8000-000000000004');
-- Every user gets the same five notifications: four leads plus one without a lead.
INSERT INTO public.notifications(user_id, lead_id, title, message)
SELECT u.id, x.lead_id, x.title, 'Synthetic'
FROM auth.users u CROSS JOIN (VALUES
  ('15200000-0000-4000-8000-000000000101'::uuid, 'own-urgent'),
  ('15200000-0000-4000-8000-000000000102'::uuid, 'other-urgent'),
  ('15200000-0000-4000-8000-000000000103'::uuid, 'paid'),
  ('15200000-0000-4000-8000-000000000104'::uuid, 'quote-updated'),
  (NULL::uuid, 'no-lead')) AS x(lead_id, title)
WHERE u.id::text LIKE '15200000-%';

SELECT pg_temp.as_user('15200000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Admin sees every notification', pg_temp.mine() = 'no-lead,other-urgent,own-urgent,paid,quote-updated');
RESET ROLE;

SELECT pg_temp.as_user('15200000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('CS sees alerts only for leads they can open (own lead + no-lead)', pg_temp.mine() = 'no-lead,own-urgent');
SELECT pg_temp.check_result('CS cannot read other users'' notifications', (SELECT count(*) = 2 FROM public.notifications));
RESET ROLE;

-- Sharing the other CS's lead brings its alerts back; nothing was deleted.
INSERT INTO public.lead_shares(lead_id, shared_with_user_id) VALUES ('15200000-0000-4000-8000-000000000102', '15200000-0000-4000-8000-000000000003');
SELECT pg_temp.as_user('15200000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Access granted later: the hidden alert reappears', pg_temp.mine() = 'no-lead,other-urgent,own-urgent');
RESET ROLE;

SELECT pg_temp.as_user('15200000-0000-4000-8000-000000000005'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('CS Admin: no alerts for paid or (by default) quote-updated leads',
  pg_temp.mine() = 'no-lead,other-urgent,own-urgent');
RESET ROLE;

-- A user-specific status visibility grant opens quote-updated leads for that CS Admin.
INSERT INTO public.lead_status_visibility(user_id, role, status, is_visible) VALUES ('15200000-0000-4000-8000-000000000005', 'cs_admin', 'quote_updated', true);
SELECT pg_temp.as_user('15200000-0000-4000-8000-000000000005'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('CS Admin with Quote Updated visibility sees that alert', pg_temp.mine() = 'no-lead,other-urgent,own-urgent,quote-updated');
RESET ROLE;

SELECT pg_temp.as_user('15200000-0000-4000-8000-000000000002'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Processor: same status visibility as the CRM (quote updated hidden by default)',
  pg_temp.mine() = 'no-lead,other-urgent,own-urgent,paid');
RESET ROLE;

SELECT pg_temp.as_user('15200000-0000-4000-8000-000000000006'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Operator unchanged in this phase (bell scopes by assignment)',
  pg_temp.mine() = 'no-lead,other-urgent,own-urgent,paid,quote-updated');
RESET ROLE;

-- Status change hides it again: the other CS lead is cancelled, a status CS Admin cannot see.
UPDATE public.leads SET status = 'cancelled' WHERE job_id = 'ACC-OTHER';
SELECT pg_temp.as_user('15200000-0000-4000-8000-000000000005'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_result('Lead moves to a hidden status: its alert disappears for CS Admin', pg_temp.mine() = 'no-lead,own-urgent,quote-updated');
RESET ROLE;

SELECT pg_temp.as_user('15200000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
UPDATE public.notifications SET read = true WHERE title = 'own-urgent';
SELECT pg_temp.check_result('Recipients can still mark visible alerts read', (SELECT read FROM public.notifications WHERE title = 'own-urgent'));
RESET ROLE;

SELECT pg_temp.check_result('Anonymous visitors cannot call the access check',
  NOT has_function_privilege('anon', 'marshmallow_private.notification_visible(uuid,uuid)', 'EXECUTE'));
SELECT pg_temp.check_result('Policy uses the new access check',
  (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'public.notifications'::regclass AND polname = 'Users can select own notifications') LIKE '%notification_visible(id, lead_id)%');
SELECT name, result FROM checks ORDER BY name;
ROLLBACK;
