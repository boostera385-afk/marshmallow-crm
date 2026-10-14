-- MANUAL BEHAVIOR HARNESS. WRITES synthetic fixtures; LOCAL/ISOLATED DB ONLY.
-- Never execute on shared production without explicit approval. Apply migrations
-- 20261120001000 and 20261120002000 first, run this exact file as postgres,
-- inspect every PASS/FAIL row, and note that the whole transaction rolls back.
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id::text LIKE '14000000-%')
    OR EXISTS (SELECT 1 FROM public.leads WHERE id::text LIKE '14000000-%') THEN
    RAISE EXCEPTION 'Reserved update-request test IDs already exist';
  END IF;
END $$;

INSERT INTO auth.users(id, email) VALUES
 ('14000000-0000-4000-8000-000000000001','updates-admin@example.invalid'),
 ('14000000-0000-4000-8000-000000000002','updates-processor@example.invalid'),
 ('14000000-0000-4000-8000-000000000003','updates-cs@example.invalid'),
 ('14000000-0000-4000-8000-000000000004','updates-other-cs@example.invalid'),
 ('14000000-0000-4000-8000-000000000005','updates-cs-admin@example.invalid'),
 ('14000000-0000-4000-8000-000000000006','updates-opr@example.invalid');
INSERT INTO public.profiles(id, full_name, email)
 SELECT id, split_part(email, '@', 1), email FROM auth.users WHERE id::text LIKE '14000000-%'
 ON CONFLICT(id) DO NOTHING;
DELETE FROM public.user_roles WHERE user_id::text LIKE '14000000-%';
INSERT INTO public.user_roles(user_id, role) VALUES
 ('14000000-0000-4000-8000-000000000001','admin'),
 ('14000000-0000-4000-8000-000000000002','processor'),
 ('14000000-0000-4000-8000-000000000003','customer_service'),
 ('14000000-0000-4000-8000-000000000004','customer_service'),
 ('14000000-0000-4000-8000-000000000005','cs_admin'),
 ('14000000-0000-4000-8000-000000000006','opr');

INSERT INTO public.leads(id, job_id, customer_name, status, created_by, assigned_cs, tech_name, tech_number, customer_schedule_requirements)
VALUES ('14000000-0000-4000-8000-000000000010','UPDATE-TEST','Synthetic update customer','urgent_job',
 '14000000-0000-4000-8000-000000000004','14000000-0000-4000-8000-000000000003','Synthetic Tech','5550109999','Friday afternoon');
CREATE TEMP TABLE _update_original AS SELECT id, to_jsonb(l) record FROM public.leads l WHERE id='14000000-0000-4000-8000-000000000010';
CREATE TEMP TABLE _update_checks(name text, result text);
GRANT ALL ON _update_checks TO authenticated, anon;
CREATE FUNCTION pg_temp.update_check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO _update_checks VALUES(label, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.update_error(label text, statement text, expected_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  PERFORM pg_temp.update_check(label, false);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.update_check(label, sqlstate = expected_code);
END $$;

-- Assigned CS creates the reverse Tech request.
SELECT set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT public.update_requests('tech','create','14000000-0000-4000-8000-000000000010','14000000-0000-4000-8000-000000000020','Has the technician collected the part?',0);
SELECT pg_temp.update_check('CS sees own pending Tech request', (public.update_requests('tech','list_pending')->>'total')::int = 1);
SELECT pg_temp.update_error('CS cannot complete Tech request', $$select public.update_requests('tech','complete',null,'14000000-0000-4000-8000-000000000020','Spoofed',0)$$, '42501');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.update_check('Unrelated CS does not see Tech request', (public.update_requests('tech','list_pending')->>'total')::int = 0);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.update_check('Admin can monitor pending Tech request', (public.update_requests('tech','list_pending')->>'total')::int = 1);
SELECT pg_temp.update_error('Admin cannot answer Processor-owned queue', $$select public.update_requests('tech','complete',null,'14000000-0000-4000-8000-000000000020','Admin answer',0)$$, '42501');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.update_check('Processor sees technician context', public.update_requests('tech','list_pending')->'rows'->0->'technician'->>'tech_name' = 'Synthetic Tech');
SELECT public.update_requests('tech','complete',null,'14000000-0000-4000-8000-000000000020','Part collected at noon',0);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.update_check('Requester sees Tech Updated response', public.update_requests('tech','list_updated')->'rows'->0->>'response_text' = 'Part collected at noon');
SELECT public.update_requests('tech','question_more',null,'14000000-0000-4000-8000-000000000020','What is the arrival time?',0);
SELECT pg_temp.update_check('Question More reopens request and preserves thread',
  (SELECT status='pending' AND response_text IS NULL AND jsonb_array_length(thread)=3 FROM public.lead_cx_update_requests WHERE id='14000000-0000-4000-8000-000000000020'));
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT public.update_requests('tech','complete',null,'14000000-0000-4000-8000-000000000020','Arrival is 2 PM',0);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.update_check('CS Admin sees every returned Tech response', (public.update_requests('tech','list_updated')->>'total')::int = 1);
SELECT public.update_requests('tech','acknowledge',null,'14000000-0000-4000-8000-000000000020',null,0);
SELECT pg_temp.update_check('Acknowledgement clears returned Tech queue', (public.update_requests('tech','list_updated')->>'total')::int = 0);
RESET ROLE;

-- Existing CX direction remains available, with CS Admin seeing all requests.
SELECT set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT public.cx_update_requests('create','14000000-0000-4000-8000-000000000010','14000000-0000-4000-8000-000000000021','Confirm Friday availability');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.update_check('CS Admin receives all pending CX requests', (public.update_requests('cx','list_pending')->>'total')::int = 1);
RESET ROLE;

-- Server-side notification filter rejects the previous creator after assignment.
SELECT set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT public.dispatch_lead_status_notification('14000000-0000-4000-8000-000000000010','[Alert] Urgent Job','Synthetic urgent',ARRAY[
 '14000000-0000-4000-8000-000000000003'::uuid,
 '14000000-0000-4000-8000-000000000004'::uuid
]);
RESET ROLE;
SELECT pg_temp.update_check('Assigned CS receives Urgent alert', EXISTS(SELECT 1 FROM public.notifications WHERE lead_id='14000000-0000-4000-8000-000000000010' AND title='[Alert] Urgent Job' AND user_id='14000000-0000-4000-8000-000000000003'));
SELECT pg_temp.update_check('Previous creator does not receive unrelated Urgent alert', NOT EXISTS(SELECT 1 FROM public.notifications WHERE lead_id='14000000-0000-4000-8000-000000000010' AND title='[Alert] Urgent Job' AND user_id='14000000-0000-4000-8000-000000000004'));

SELECT set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000006',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.update_error('Operator cannot access update RPC', $$select public.update_requests('tech','count')$$, '42501');
RESET ROLE;

SELECT pg_temp.update_check('Update workflow leaves every lead field unchanged', NOT EXISTS(
 SELECT 1 FROM _update_original o JOIN public.leads l ON l.id=o.id WHERE to_jsonb(l) IS DISTINCT FROM o.record));
SELECT pg_temp.update_check('Tech notifications link to queue instead of hidden lead', EXISTS(
 SELECT 1 FROM public.notifications WHERE title='Tech Updated' AND user_id='14000000-0000-4000-8000-000000000003' AND lead_id IS NULL));
SELECT * FROM _update_checks ORDER BY name;
ROLLBACK;
