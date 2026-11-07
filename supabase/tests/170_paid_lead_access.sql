-- WRITE-BASED, ISOLATED ONLY (scripts/test-paid-lead-access-db.mjs). Synthetic rows;
-- everything rolls back. Covers 20261204000000_paid_lead_access.
BEGIN;
CREATE TEMP TABLE results(name text, result text);
GRANT SELECT, INSERT ON results TO authenticated;
CREATE FUNCTION pg_temp.check(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (p_name, CASE WHEN coalesce(p_ok, false) THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.check_error(p_name text, p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; PERFORM pg_temp.check(p_name, false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check(p_name, sqlstate = p_code); END $$;
CREATE FUNCTION pg_temp.as_user(p_id text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_id, true);
$$;
-- admin=...01, cs_admin=...02, cs=...03, other cs=...04
-- Paid leads by other CS, created (New York time): Oct 1, Oct 31 23:30, Nov 1 00:30, Dec 1.
INSERT INTO public.leads(job_id, status, created_by, created_at) VALUES
  ('P-OCT1', 'paid', '17000000-0000-4000-8000-000000000004', '2026-10-01 12:00-04'),
  ('P-OCT31', 'paid', '17000000-0000-4000-8000-000000000004', '2026-10-31 23:30-04'),
  ('P-NOV1', 'paid', '17000000-0000-4000-8000-000000000004', '2026-11-01 00:30-04'),
  ('P-DEC1', 'paid', '17000000-0000-4000-8000-000000000004', '2026-12-01 12:00-05'),
  ('C-OTHER', 'cancelled', '17000000-0000-4000-8000-000000000004', '2026-10-15 12:00-04'),
  ('U-OTHER', 'urgent_job', '17000000-0000-4000-8000-000000000004', '2026-10-15 12:00-04'),
  ('P-OWN', 'paid', '17000000-0000-4000-8000-000000000003', '2026-10-15 12:00-04');
CREATE FUNCTION pg_temp.visible(p_status text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(job_id, ',' ORDER BY job_id), '') FROM public.leads WHERE status = p_status;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.visible(text) TO authenticated;

-- Before any grant.
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000002'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('CS Admin sees no paid leads without a grant', pg_temp.visible('paid') = '');
SELECT pg_temp.check_error('CS Admin cannot grant paid access', $q$SELECT public.set_paid_lead_access('17000000-0000-4000-8000-000000000002', true, NULL, NULL)$q$, '42501');
RESET ROLE;
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('CS sees only their own paid lead without a grant', pg_temp.visible('paid') = 'P-OWN');
SELECT pg_temp.check_error('Browser cannot write grants directly', $q$INSERT INTO public.paid_lead_access(user_id) VALUES ('17000000-0000-4000-8000-000000000003')$q$, '42501');
RESET ROLE;

-- A role-wide Paid switch does not grant data.
INSERT INTO public.lead_status_visibility(role, status, is_visible) VALUES ('cs_admin', 'paid', true);
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000002'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('A role-wide Paid switch alone shows no paid leads', pg_temp.visible('paid') = '');
RESET ROLE;

-- Admin validates input.
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check_error('Range needs both dates', $q$SELECT public.set_paid_lead_access('17000000-0000-4000-8000-000000000002', true, '2026-10-01', NULL)$q$, '22023');
SELECT pg_temp.check_error('Range start must not be after end', $q$SELECT public.set_paid_lead_access('17000000-0000-4000-8000-000000000002', true, '2026-11-02', '2026-11-01')$q$, '22023');
-- All time for the CS Admin.
SELECT public.set_paid_lead_access('17000000-0000-4000-8000-000000000002', true, NULL, NULL);
RESET ROLE;
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000002'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('All time: CS Admin sees every paid lead', pg_temp.visible('paid') = 'P-DEC1,P-NOV1,P-OCT1,P-OCT31,P-OWN');
SELECT pg_temp.check('Grant does not open other statuses', pg_temp.visible('cancelled') = '' AND pg_temp.visible('urgent_job') = 'U-OTHER');
SELECT pg_temp.check('User reads own grant', (SELECT count(*) = 1 FROM public.paid_lead_access));
UPDATE public.leads SET job_id = 'CHANGED' WHERE status = 'paid';
SELECT pg_temp.check('Grant is read-only: no paid lead can be changed through it', (SELECT count(*) = 0 FROM public.leads WHERE job_id = 'CHANGED'));
RESET ROLE;

-- Custom range for the CS: October 2026 only (New York dates, end inclusive).
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT public.set_paid_lead_access('17000000-0000-4000-8000-000000000003', true, '2026-10-01', '2026-10-31');
SELECT pg_temp.check('Admin reads every grant', (SELECT count(*) = 2 FROM public.paid_lead_access));
RESET ROLE;
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('Range: CS sees paid leads created Oct 1 - Oct 31 (incl. 11:30 pm Oct 31) plus own',
  pg_temp.visible('paid') = 'P-OCT1,P-OCT31,P-OWN');
SELECT pg_temp.check('Range: other CS leads in other statuses stay hidden', pg_temp.visible('cancelled') = '' AND pg_temp.visible('urgent_job') = '');
SELECT pg_temp.check('User cannot read other users'' grants', (SELECT count(*) = 1 FROM public.paid_lead_access));
RESET ROLE;

-- Changing the range takes effect immediately.
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT public.set_paid_lead_access('17000000-0000-4000-8000-000000000003', true, '2026-11-01', '2026-12-31');
RESET ROLE;
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('New range replaces the old one', pg_temp.visible('paid') = 'P-DEC1,P-NOV1,P-OWN');
RESET ROLE;

-- Switching the user's Paid visibility off directly also ends access.
UPDATE public.lead_status_visibility SET is_visible = false WHERE user_id = '17000000-0000-4000-8000-000000000003' AND status = 'paid';
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('Paid switched off (even with a grant row) shows only own paid', pg_temp.visible('paid') = 'P-OWN');
RESET ROLE;

-- Turning it off through Settings removes the grant.
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT public.set_paid_lead_access('17000000-0000-4000-8000-000000000002', false, NULL, NULL);
RESET ROLE;
SELECT pg_temp.check('Off removes the grant and sets the switch off',
  NOT EXISTS (SELECT 1 FROM public.paid_lead_access WHERE user_id = '17000000-0000-4000-8000-000000000002')
  AND (SELECT is_visible = false FROM public.lead_status_visibility WHERE user_id = '17000000-0000-4000-8000-000000000002' AND status = 'paid'));
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000002'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('After Off: CS Admin sees no paid leads again', pg_temp.visible('paid') = '');
RESET ROLE;
SELECT pg_temp.check('Every change is audited', (SELECT count(*) = 4 FROM public.activity_logs WHERE action LIKE 'paid_lead_access_%'
  AND details LIKE 'Admin %') AND EXISTS (SELECT 1 FROM public.activity_logs WHERE details LIKE '%leads created 2026-10-01 to 2026-10-31%'));
SELECT pg_temp.check('Anonymous visitors cannot call the grant function', NOT has_function_privilege('anon', 'public.set_paid_lead_access(uuid,boolean,date,date)', 'EXECUTE'));
SELECT * FROM results ORDER BY name;
ROLLBACK;
