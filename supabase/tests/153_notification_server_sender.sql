-- WRITE-BASED HARNESS. ISOLATED POSTGRES ONLY (scripts/test-notifications-db.mjs).
-- Covers 20261207000000_notification_server_sender: the database sends every lead
-- alert the browser used to send, to the same people, and browsers can no longer
-- create notifications. Everything rolls back.
BEGIN;
CREATE TEMP TABLE results(name text, result text);
GRANT ALL ON results TO authenticated;
CREATE FUNCTION pg_temp.check(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (p_name, CASE WHEN coalesce(p_ok, false) THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.check_error(p_name text, p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; PERFORM pg_temp.check(p_name, false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check(p_name, sqlstate = p_code); END $$;
CREATE FUNCTION pg_temp.as_user(p_id text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_id, true);
$$;
-- Recipients (last digit of the user id) of unread alerts of a kind for a lead, sorted.
CREATE FUNCTION pg_temp.who(p_job text, p_kind text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(right(n.user_id::text, 1), ',' ORDER BY n.user_id), '')
  FROM public.notifications n JOIN public.leads l ON l.id = n.lead_id
  WHERE l.job_id = p_job AND n.kind = p_kind AND n.read = false;
$$;
CREATE FUNCTION pg_temp.msg(p_job text, p_kind text) RETURNS text LANGUAGE sql AS $$
  SELECT min(n.message) FROM public.notifications n JOIN public.leads l ON l.id = n.lead_id WHERE l.job_id = p_job AND n.kind = p_kind;
$$;

INSERT INTO public.leads(id, job_id, customer_name, status, created_by, assigned_cs) VALUES
  ('15300000-0000-4000-8000-000000000101', 'S-A', 'Customer A', 'waiting_customer_response', '15300000-0000-4000-8000-000000000004', '15300000-0000-4000-8000-000000000003');
INSERT INTO public.lead_shares(lead_id, shared_with_user_id, shared_by) VALUES ('15300000-0000-4000-8000-000000000101', '15300000-0000-4000-8000-000000000004', '15300000-0000-4000-8000-000000000001');
INSERT INTO public.lead_operator_assignments(lead_id, operator_user_id, assigned_by, assigned_by_name) VALUES
  ('15300000-0000-4000-8000-000000000101', '15300000-0000-4000-8000-000000000006', '15300000-0000-4000-8000-000000000001', 'Synthetic Admin');
SELECT pg_temp.check('Share: the shared user is told, not the sharer', pg_temp.who('S-A', 'lead_shared') = '4'
  AND pg_temp.msg('S-A', 'lead_shared') = '"Customer A" has been shared with you by admin');
SELECT pg_temp.check('Assignment: the Operator is told who assigned it', pg_temp.who('S-A', 'lead_assigned') = '6'
  AND pg_temp.msg('S-A', 'lead_assigned') = 'Lead "Customer A" has been assigned to you by Synthetic Admin.');

-- Urgent by Admin 1: Admin 7, Processor, CS Admin, assigned CS 3, shared CS 4, Operator 6; never the actor.
SELECT pg_temp.as_user('15300000-0000-4000-8000-000000000001');
UPDATE public.leads SET status = 'urgent_job' WHERE job_id = 'S-A';
SELECT pg_temp.check('Urgent Job: same recipients as the browser sent, not the actor', pg_temp.who('S-A', 'urgent_job') = '2,3,4,5,6,7'
  AND pg_temp.msg('S-A', 'urgent_job') = 'Lead "Customer A" changed to Urgent Job');
SELECT pg_temp.check('Urgent Job keeps its title for older CRM builds',
  (SELECT bool_and(n.title = '[Alert] Urgent Job') FROM public.notifications n JOIN public.leads l ON l.id = n.lead_id WHERE l.job_id = 'S-A' AND n.kind = 'urgent_job'));
UPDATE public.leads SET cs_tag = NULL WHERE job_id = 'S-A';
SELECT pg_temp.check('Saving other fields sends nothing new', (SELECT count(*) = 6 FROM public.notifications n JOIN public.leads l ON l.id = n.lead_id WHERE l.job_id = 'S-A' AND n.kind = 'urgent_job'));

-- A CS user who is not tied to the lead never gets its urgent alert.
INSERT INTO public.leads(id, job_id, customer_name, status, created_by) VALUES
  ('15300000-0000-4000-8000-000000000102', 'S-B', 'Customer B', 'urgent_job', '15300000-0000-4000-8000-000000000003');
SELECT pg_temp.check('New urgent lead: "requires attention" wording; the creating CS is told, the CS not tied to it is not',
  pg_temp.who('S-B', 'urgent_job') = '2,3,5,7' AND pg_temp.msg('S-B', 'urgent_job') = 'New lead "Customer B" requires attention - marked as Urgent Job');

-- Need Tech, Job in Progress, Quote Updated.
UPDATE public.leads SET status = 'need_tech' WHERE job_id = 'S-B';
SELECT pg_temp.check('Need Tech: broad roles plus the lead''s CS', pg_temp.who('S-B', 'need_tech') = '2,3,5,7');
UPDATE public.leads SET status = 'job_in_progress' WHERE job_id = 'S-B';
SELECT pg_temp.check('Job in Progress: Admin and Processor only', pg_temp.who('S-B', 'job_in_progress') = '2,7'
  AND pg_temp.msg('S-B', 'job_in_progress') = 'Lead "Customer B" changed to Job in Progress');
UPDATE public.leads SET expected_completion_date = '2026-11-20' WHERE job_id = 'S-B';
SELECT pg_temp.check('Expected completion change refreshes the reminder instead of adding one',
  pg_temp.who('S-B', 'job_in_progress') = '2,7'
  AND (SELECT count(*) = 2 FROM public.notifications n JOIN public.leads l ON l.id = n.lead_id WHERE l.job_id = 'S-B' AND n.kind = 'job_in_progress')
  AND pg_temp.msg('S-B', 'job_in_progress') = 'Lead "Customer B" is In Progress. Expected completion: 2026-11-20');
UPDATE public.leads SET quote_requested_by = '15300000-0000-4000-8000-000000000004', status = 'quote_updated' WHERE job_id = 'S-B';
SELECT pg_temp.check('Quote Updated: the requester and CS Admin', pg_temp.who('S-B', 'quote_updated') = '4,5');

-- Operators never get Quote Updated or cancellation alerts, even when named.
INSERT INTO public.leads(id, job_id, customer_name, status, created_by, quote_requested_by) VALUES
  ('15300000-0000-4000-8000-000000000103', 'S-C', 'Customer C', 'pending_to_send', '15300000-0000-4000-8000-000000000003', '15300000-0000-4000-8000-000000000006');
UPDATE public.leads SET status = 'quote_updated' WHERE job_id = 'S-C';
SELECT pg_temp.check('Quote Updated: an Operator who requested the quote is not told', pg_temp.who('S-C', 'quote_updated') = '5');
SELECT pg_temp.check('Cancellation alert is never sent to an Operator, even if named',
  marshmallow_private.notify_lead(ARRAY['15300000-0000-4000-8000-000000000006'::uuid], '15300000-0000-4000-8000-000000000103',
    'cancellation_request', 'Lead cancellation request', 'x', NULL) = 0
  AND pg_temp.who('S-C', 'cancellation_request') = '');
SELECT pg_temp.check('Operators still get Urgent Job and assignment alerts', pg_temp.who('S-A', 'urgent_job') LIKE '%6%'
  AND pg_temp.who('S-A', 'lead_assigned') = '6');

-- Incomplete details tag.
UPDATE public.leads SET cs_tag = 'incomplete_details' WHERE job_id = 'S-B';
SELECT pg_temp.check('Incomplete Details: creator and CS Admin', pg_temp.who('S-B', 'incomplete_details') = '3,5');

-- Requests: cancellation by CS goes to Admins and Processor; by Processor to Admins only.
SELECT pg_temp.as_user('15300000-0000-4000-8000-000000000003');
INSERT INTO public.lead_cancellation_requests(lead_id, requested_by, requested_by_role, status)
  VALUES ('15300000-0000-4000-8000-000000000101', '15300000-0000-4000-8000-000000000003', 'customer_service', 'pending');
SELECT pg_temp.check('Cancellation request by CS: Admins and Processor', pg_temp.who('S-A', 'cancellation_request') = '1,2,7'
  AND pg_temp.msg('S-A', 'cancellation_request') = 'Customer A needs cancellation approval');
SELECT pg_temp.as_user('15300000-0000-4000-8000-000000000002');
INSERT INTO public.lead_cancellation_requests(lead_id, requested_by, requested_by_role, status)
  VALUES ('15300000-0000-4000-8000-000000000102', '15300000-0000-4000-8000-000000000002', 'processor', 'pending');
SELECT pg_temp.check('Cancellation request by Processor: Admins only', pg_temp.who('S-B', 'cancellation_request') = '1,7');
INSERT INTO public.lead_payment_requests(lead_id, requested_by, requested_by_role, status)
  VALUES ('15300000-0000-4000-8000-000000000102', '15300000-0000-4000-8000-000000000002', 'processor', 'pending');
SELECT pg_temp.check('Paid approval request: Admins', pg_temp.who('S-B', 'paid_approval_request') = '1,7'
  AND (SELECT bool_and(n.entity_id IS NOT NULL) FROM public.notifications n WHERE n.kind = 'paid_approval_request'));

-- Browsers.
SELECT pg_temp.as_user('15300000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_error('Browser cannot create a notification for someone else',
  $q$INSERT INTO public.notifications(user_id, title, message) VALUES ('15300000-0000-4000-8000-000000000002', '[Alert] Urgent Job', 'fake')$q$, '42501');
SELECT pg_temp.check_error('Browser cannot create a notification for itself either',
  $q$INSERT INTO public.notifications(user_id, title, message) VALUES ('15300000-0000-4000-8000-000000000003', 'x', 'x')$q$, '42501');
SELECT pg_temp.check('Old CRM sender is a no-op', public.dispatch_lead_status_notification(
  '15300000-0000-4000-8000-000000000101', '[Alert] Urgent Job', 'fake', ARRAY['15300000-0000-4000-8000-000000000002'::uuid]) = 0);
SELECT pg_temp.check_error('Browser cannot rewrite an alert''s text',
  $q$UPDATE public.notifications SET title = 'changed' WHERE user_id = '15300000-0000-4000-8000-000000000003'$q$, '42501');
UPDATE public.notifications SET read = true WHERE kind = 'urgent_job';
RESET ROLE;
SELECT pg_temp.check('Browser can still mark its own alerts read (and only its own)',
  (SELECT bool_and(read) FROM public.notifications WHERE kind = 'urgent_job' AND user_id = '15300000-0000-4000-8000-000000000003')
  AND (SELECT bool_and(NOT read) FROM public.notifications n JOIN public.leads l ON l.id = n.lead_id WHERE l.job_id = 'S-A' AND n.kind = 'urgent_job' AND n.user_id <> '15300000-0000-4000-8000-000000000003'));
SELECT pg_temp.check('No fake alert was created', NOT EXISTS (SELECT 1 FROM public.notifications WHERE message = 'fake'));

-- Other server producers get a kind from their title.
INSERT INTO public.notifications(user_id, title, message) VALUES ('15300000-0000-4000-8000-000000000001', 'Paid approval request', 'server-made');
SELECT pg_temp.check('Server producers get a kind from the title', (SELECT kind = 'paid_approval_request' FROM public.notifications WHERE message = 'server-made'));
SELECT pg_temp.check('Recent older rows were labelled; rows older than 3 days were left alone',
  (SELECT kind = 'system_sheets' FROM public.notifications WHERE id = '15300000-0000-4000-8000-000000000806')
  AND (SELECT kind IS NULL FROM public.notifications WHERE id = '15300000-0000-4000-8000-000000000804'));
SELECT name, result FROM results ORDER BY name;
ROLLBACK;
