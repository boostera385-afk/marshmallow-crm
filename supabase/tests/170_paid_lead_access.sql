-- WRITE-BASED, ISOLATED ONLY (scripts/test-paid-lead-access-db.mjs). Synthetic rows;
-- everything rolls back. Covers 20261204000000_paid_lead_access and
-- 20261205000000_paid_lead_access_by_paid_date (ranges use the date a lead became
-- paid, not its created date).
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
CREATE FUNCTION pg_temp.paid_on(p_job text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce((SELECT p.source || '@' || to_char(p.paid_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI')
    FROM public.lead_paid_dates p JOIN public.leads l ON l.id = p.lead_id WHERE l.job_id = p_job), 'none');
$$;

-- Backfill from the fixture's payment history (fixture rows exist before the migration).
SELECT pg_temp.check('Backfill: payment log date, not created date', pg_temp.paid_on('L-SEP-PAIDOCT') = 'payment_log@2026-10-20 12:00');
SELECT pg_temp.check('Backfill: approved payment request date', pg_temp.paid_on('L-OCT-PAIDNOV') = 'payment_request@2026-11-02 12:00');
SELECT pg_temp.check('Backfill: earliest of several payment events', pg_temp.paid_on('L-TWO-EVENTS') = 'payment_log@2026-10-05 12:00');
SELECT pg_temp.check('Backfill: no payment record means no guessed date', pg_temp.paid_on('L-NO-RECORD') = 'none');
SELECT pg_temp.check('Backfill: leads not paid are ignored (and malformed log rows do not fail)',
  pg_temp.paid_on('L-NOT-PAID') = 'none' AND (SELECT count(*) = 3 FROM public.lead_paid_dates));

-- admin=...01, cs_admin=...02, cs=...03, other cs=...04
-- New paid leads by the other CS (trigger records them), plus one of the CS's own.
INSERT INTO public.leads(job_id, status, created_by, created_at) VALUES
  ('P-OCT1', 'paid', '17000000-0000-4000-8000-000000000004', '2026-10-01 12:00-04'),
  ('P-OCT31', 'paid', '17000000-0000-4000-8000-000000000004', '2026-10-31 23:30-04'),
  ('P-NOV1', 'paid', '17000000-0000-4000-8000-000000000004', '2026-11-01 00:30-04'),
  ('P-DEC1', 'paid', '17000000-0000-4000-8000-000000000004', '2026-12-01 12:00-05'),
  ('P-LATE', 'paid', '17000000-0000-4000-8000-000000000004', '2026-09-20 12:00-04'),
  ('C-OTHER', 'cancelled', '17000000-0000-4000-8000-000000000004', '2026-10-15 12:00-04'),
  ('U-OTHER', 'urgent_job', '17000000-0000-4000-8000-000000000004', '2026-10-15 12:00-04'),
  ('P-OWN', 'paid', '17000000-0000-4000-8000-000000000003', '2026-10-15 12:00-04');
SELECT pg_temp.check('Trigger: a lead saved as paid records when it became paid',
  (SELECT count(*) = 6 FROM public.lead_paid_dates p JOIN public.leads l ON l.id = p.lead_id
   WHERE l.job_id LIKE 'P-%' AND p.source = 'status_change' AND p.paid_at = now()));
SELECT pg_temp.check('Trigger: other statuses record nothing', pg_temp.paid_on('C-OTHER') = 'none' AND pg_temp.paid_on('U-OTHER') = 'none');
-- Give the new leads a known history: paid on their created date, except P-LATE
-- (created in September, paid on Nov 5).
UPDATE public.lead_paid_dates p SET paid_at = l.created_at FROM public.leads l WHERE l.id = p.lead_id AND l.job_id LIKE 'P-%';
UPDATE public.lead_paid_dates p SET paid_at = '2026-11-05 12:00-05' FROM public.leads l WHERE l.id = p.lead_id AND l.job_id = 'P-LATE';

UPDATE public.leads SET status = 'paid' WHERE job_id = 'L-NOT-PAID';
SELECT pg_temp.check('Trigger: becoming paid by update records the moment', pg_temp.paid_on('L-NOT-PAID') LIKE 'status_change@%'
  AND (SELECT paid_at = now() FROM public.lead_paid_dates p JOIN public.leads l ON l.id = p.lead_id WHERE l.job_id = 'L-NOT-PAID'));
UPDATE public.leads SET job_id = 'P-LATE' WHERE job_id = 'P-LATE';
UPDATE public.leads SET status = 'paid' WHERE job_id = 'L-SEP-PAIDOCT';
SELECT pg_temp.check('Trigger: later saves of a paid lead keep the first paid date',
  pg_temp.paid_on('P-LATE') = 'status_change@2026-11-05 12:00' AND pg_temp.paid_on('L-SEP-PAIDOCT') = 'payment_log@2026-10-20 12:00');
-- Restore the synthetic unpaid lead for the visibility checks below.
DELETE FROM public.lead_paid_dates WHERE lead_id = '17100000-0000-4000-8000-000000000005';
UPDATE public.leads SET status = 'payment_pending' WHERE job_id = 'L-NOT-PAID';

CREATE FUNCTION pg_temp.visible(p_status text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(job_id, ',' ORDER BY job_id COLLATE "C"), '') FROM public.leads WHERE status = p_status;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.visible(text) TO authenticated;
CREATE FUNCTION pg_temp.my_paid_ids() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(job_id, ',' ORDER BY job_id COLLATE "C"), '') FROM public.leads WHERE id = ANY(public.my_paid_lead_ids());
$$;
GRANT EXECUTE ON FUNCTION pg_temp.my_paid_ids() TO authenticated;

-- Before any grant.
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000002'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('CS Admin sees no paid leads without a grant', pg_temp.visible('paid') = '');
SELECT pg_temp.check('No grant: my_paid_lead_ids is empty', cardinality(public.my_paid_lead_ids()) = 0);
SELECT pg_temp.check_error('CS Admin cannot grant paid access', $q$SELECT public.set_paid_lead_access('17000000-0000-4000-8000-000000000002', true, NULL, NULL)$q$, '42501');
SELECT pg_temp.check_error('Browser cannot read paid dates', $q$SELECT count(*) FROM public.lead_paid_dates$q$, '42501');
SELECT pg_temp.check_error('Browser cannot write paid dates', $q$INSERT INTO public.lead_paid_dates(lead_id, paid_at, source) SELECT id, now(), 'status_change' FROM public.leads LIMIT 1$q$, '42501');
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
SELECT pg_temp.check('All time: CS Admin sees every paid lead, including ones with no paid record',
  pg_temp.visible('paid') = 'L-NO-RECORD,L-OCT-PAIDNOV,L-SEP-PAIDOCT,L-TWO-EVENTS,P-DEC1,P-LATE,P-NOV1,P-OCT1,P-OCT31,P-OWN');
SELECT pg_temp.check('All time: my_paid_lead_ids matches', pg_temp.my_paid_ids() = pg_temp.visible('paid'));
SELECT pg_temp.check('Grant does not open other statuses', pg_temp.visible('cancelled') = '' AND pg_temp.visible('urgent_job') = 'U-OTHER');
SELECT pg_temp.check('User reads own grant', (SELECT count(*) = 1 FROM public.paid_lead_access));
UPDATE public.leads SET job_id = 'CHANGED' WHERE status = 'paid';
SELECT pg_temp.check('Grant is read-only: no paid lead can be changed through it', (SELECT count(*) = 0 FROM public.leads WHERE job_id = 'CHANGED'));
RESET ROLE;

-- Custom range for the CS: October 2026 (New York dates, end inclusive), by PAID date.
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT public.set_paid_lead_access('17000000-0000-4000-8000-000000000003', true, '2026-10-01', '2026-10-31');
SELECT pg_temp.check('Admin reads every grant', (SELECT count(*) = 2 FROM public.paid_lead_access));
RESET ROLE;
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('October: leads that became paid in October (incl. 11:30 pm Oct 31), whenever created',
  pg_temp.visible('paid') = 'L-SEP-PAIDOCT,L-TWO-EVENTS,P-OCT1,P-OCT31,P-OWN');
SELECT pg_temp.check('October: created in October but paid in November is excluded',
  position('L-OCT-PAIDNOV' IN pg_temp.visible('paid')) = 0 AND position('L-NO-RECORD' IN pg_temp.visible('paid')) = 0);
SELECT pg_temp.check('October: my_paid_lead_ids returns the same window', pg_temp.my_paid_ids() = 'L-SEP-PAIDOCT,L-TWO-EVENTS,P-OCT1,P-OCT31,P-OWN');
SELECT pg_temp.check('Range: other CS leads in other statuses stay hidden', pg_temp.visible('cancelled') = '' AND pg_temp.visible('urgent_job') = '');
SELECT pg_temp.check('User cannot read other users'' grants', (SELECT count(*) = 1 FROM public.paid_lead_access));
RESET ROLE;

-- Changing the range takes effect immediately.
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
SELECT public.set_paid_lead_access('17000000-0000-4000-8000-000000000003', true, '2026-11-01', '2026-12-31');
RESET ROLE;
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('Nov-Dec: paid in the range (created in Sep/Oct included), plus own',
  pg_temp.visible('paid') = 'L-OCT-PAIDNOV,P-DEC1,P-LATE,P-NOV1,P-OWN');
RESET ROLE;

-- Switching the user's Paid visibility off directly also ends access.
UPDATE public.lead_status_visibility SET is_visible = false WHERE user_id = '17000000-0000-4000-8000-000000000003' AND status = 'paid';
SELECT pg_temp.as_user('17000000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('Paid switched off (even with a grant row) shows only own paid', pg_temp.visible('paid') = 'P-OWN');
SELECT pg_temp.check('Paid switched off: my_paid_lead_ids is empty', cardinality(public.my_paid_lead_ids()) = 0);
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
SELECT pg_temp.check('Every change is audited, ranges as paid dates', (SELECT count(*) = 4 FROM public.activity_logs WHERE action LIKE 'paid_lead_access_%'
  AND details LIKE 'Admin %') AND EXISTS (SELECT 1 FROM public.activity_logs WHERE details LIKE '%leads paid 2026-10-01 to 2026-10-31%'));
SELECT pg_temp.check('Anonymous visitors cannot call the grant or id functions',
  NOT has_function_privilege('anon', 'public.set_paid_lead_access(uuid,boolean,date,date)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.my_paid_lead_ids()', 'EXECUTE'));
SELECT * FROM results ORDER BY name;
ROLLBACK;
