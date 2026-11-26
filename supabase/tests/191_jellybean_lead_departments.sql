-- WRITE-BASED, disposable fixture only; never run on shared production.
-- Behavioral checks for 20261231000800_jellybean_lead_departments.sql
-- and 20261231000900_jellybean_match_queue.sql.
-- Run: node scripts/test-jellybean-departments-db.mjs <PGlite installation directory>
BEGIN;
CREATE TEMP TABLE jb_checks (name text, result text);
GRANT ALL ON jb_checks TO authenticated, service_role;
-- Writes and the reads that verify them run as separate statements (statement snapshots).
CREATE FUNCTION pg_temp.check_jb(name text, ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO jb_checks VALUES (name, CASE WHEN coalesce(ok, false) THEN 'PASS' ELSE 'FAIL' END)
$$;
CREATE FUNCTION pg_temp.as_user(id text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', id, true) $$;
CREATE FUNCTION pg_temp.fails_with(p_sql text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE = code;
END $$;

-- Synthetic users: admin A, customer_service B.
INSERT INTO public.user_roles VALUES
  ('91000000-0000-4000-8000-00000000000a', 'admin'),
  ('91000000-0000-4000-8000-00000000000b', 'customer_service');
-- Leads 1-5 in October, 6 in August (outside the October range).
INSERT INTO public.leads (id, status, created_by, customer_phone, customer_landline, created_at) VALUES
  ('91000000-0000-4000-8000-000000000001', 'paid',      '91000000-0000-4000-8000-00000000000b', '(404) 555-0101', NULL,        '2026-10-01'),
  ('91000000-0000-4000-8000-000000000002', 'scheduled', '91000000-0000-4000-8000-00000000000b', '4045550102',     NULL,        '2026-10-02'),
  ('91000000-0000-4000-8000-000000000003', 'scheduled', '91000000-0000-4000-8000-00000000000b', '4045550103',     NULL,        '2026-10-03'),
  ('91000000-0000-4000-8000-000000000004', 'cancelled', '91000000-0000-4000-8000-00000000000b', NULL,             NULL,        '2026-10-04'),
  ('91000000-0000-4000-8000-000000000005', 'paid',      '91000000-0000-4000-8000-00000000000b', '4045550105',     '4045550199','2026-10-05'),
  ('91000000-0000-4000-8000-000000000006', 'paid',      '91000000-0000-4000-8000-00000000000b', '4045550106',     NULL,        '2026-08-01');

-- 1. Worker queue -------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT pg_temp.check_jb('01 every unchecked lead is pending, newest first',
  (SELECT array_agg(right(id::text, 1) ORDER BY ord) FROM (
     SELECT id, row_number() OVER () AS ord FROM public.jellybean_match_candidates(10)) s)
  = ARRAY['5','4','3','2','1','6']);
CREATE TEMP TABLE jb_saved AS SELECT public.save_jellybean_matches(jsonb_build_array(
    jsonb_build_object('lead_id','91000000-0000-4000-8000-000000000001','match_status','matched','department','ND',
      'jellybean_lead_id','91000000-0000-4000-8000-0000000000f1','jellybean_created_at','2026-09-20','source_role','maturing',
      'matched_phone','+14045550101','customer_phone','(404) 555-0101','customer_landline',NULL),
    jsonb_build_object('lead_id','91000000-0000-4000-8000-000000000002','match_status','matched','department','FB',
      'source_role','facebook','customer_phone','4045550102','customer_landline',NULL),
    jsonb_build_object('lead_id','91000000-0000-4000-8000-000000000003','match_status','not_found',
      'customer_phone','4045550103','customer_landline',NULL),
    jsonb_build_object('lead_id','91000000-0000-4000-8000-000000000004','match_status','no_phone',
      'customer_phone',NULL,'customer_landline',NULL),
    jsonb_build_object('lead_id','91000000-0000-4000-8000-000000000006','match_status','matched','department','SEO',
      'source_role','seo','customer_phone','4045550106','customer_landline',NULL))) AS n;
SELECT pg_temp.check_jb('02 the worker saves matched, not-found and no-phone answers',
  (SELECT n FROM jb_saved) = 5
  AND (SELECT array_agg(right(id::text, 1)) FROM public.jellybean_match_candidates(10)) = ARRAY['5']);
SELECT pg_temp.check_jb('03 an answer for phones that changed mid-check is not saved',
  public.save_jellybean_matches(jsonb_build_array(jsonb_build_object(
    'lead_id','91000000-0000-4000-8000-000000000005','match_status','matched','department','ND',
    'customer_phone','4045550105','customer_landline',NULL))) = 0
  AND NOT EXISTS (SELECT 1 FROM public.lead_jellybean_matches WHERE lead_id = '91000000-0000-4000-8000-000000000005'));
SELECT pg_temp.check_jb('04 a department is never stored on a not-found answer',
  public.save_jellybean_matches(jsonb_build_array(jsonb_build_object(
    'lead_id','91000000-0000-4000-8000-000000000003','match_status','not_found','department','FB',
    'customer_phone','4045550103','customer_landline',NULL))) = 1
  AND (SELECT department IS NULL FROM public.lead_jellybean_matches WHERE lead_id = '91000000-0000-4000-8000-000000000003'));
SELECT pg_temp.check_jb('05 a matched row without a department is rejected',
  pg_temp.fails_with($q$INSERT INTO public.lead_jellybean_matches (lead_id, match_status)
    VALUES ('91000000-0000-4000-8000-000000000005', 'matched')$q$, '23514'));
RESET ROLE;

-- 2. Phone edits re-queue the lead; other edits do not --------------------------
UPDATE public.leads SET status = 'paid' WHERE id = '91000000-0000-4000-8000-000000000002';
SELECT pg_temp.check_jb('06 a status change keeps the saved department',
  EXISTS (SELECT 1 FROM public.lead_jellybean_matches WHERE lead_id = '91000000-0000-4000-8000-000000000002' AND department = 'FB'));
UPDATE public.leads SET customer_phone = '4045550177' WHERE id = '91000000-0000-4000-8000-000000000002';
SELECT pg_temp.check_jb('07 changing the phone clears the answer so the lead is checked again',
  NOT EXISTS (SELECT 1 FROM public.lead_jellybean_matches WHERE lead_id = '91000000-0000-4000-8000-000000000002')
  AND '91000000-0000-4000-8000-000000000002' IN (SELECT id FROM public.jellybean_match_candidates(10)));
UPDATE public.leads SET customer_phone = '4045550102' WHERE id = '91000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT public.save_jellybean_matches(jsonb_build_array(jsonb_build_object(
  'lead_id','91000000-0000-4000-8000-000000000002','match_status','matched','department','FB',
  'customer_phone','4045550102','customer_landline',NULL)));
RESET ROLE;

-- 3. Admin report ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('91000000-0000-4000-8000-00000000000a');
SELECT pg_temp.check_jb('08 admin sees department x status counts for the range, including pending and not-in-JellyBean',
  (SELECT array_agg(department || ':' || status || ':' || lead_count ORDER BY department, status)
     FROM public.get_lead_department_breakdown('2026-10-01', '2026-10-31 23:59:59'))
  = ARRAY['FB:paid:1', 'ND:paid:1', 'not_in_jellybean:cancelled:1', 'not_in_jellybean:scheduled:1', 'pending:paid:1']);
SELECT pg_temp.check_jb('09 "all time" includes older leads (August SEO lead)',
  (SELECT sum(lead_count) FROM public.get_lead_department_breakdown('1970-01-01', '2026-12-31')) = 6
  AND EXISTS (SELECT 1 FROM public.get_lead_department_breakdown('1970-01-01', '2026-12-31') WHERE department = 'SEO'));
SELECT pg_temp.check_jb('10 admin can read the stored matches', (SELECT count(*) FROM public.lead_jellybean_matches) = 5);
SELECT pg_temp.check_jb('11 an invalid range is rejected',
  pg_temp.fails_with($q$SELECT * FROM public.get_lead_department_breakdown('2026-10-31', '2026-10-01')$q$, '22023'));

SELECT pg_temp.as_user('91000000-0000-4000-8000-00000000000b');
SELECT pg_temp.check_jb('12 a non-admin cannot run the report even for their own leads',
  pg_temp.fails_with($q$SELECT * FROM public.get_lead_department_breakdown('2026-10-01', '2026-10-31')$q$, '42501'));
SELECT pg_temp.check_jb('13 a non-admin reads no match rows', (SELECT count(*) FROM public.lead_jellybean_matches) = 0);
SELECT pg_temp.check_jb('14 a non-admin cannot write match rows',
  pg_temp.fails_with($q$INSERT INTO public.lead_jellybean_matches (lead_id, match_status)
    VALUES ('91000000-0000-4000-8000-000000000005', 'not_found')$q$, '42501'));
SELECT pg_temp.as_user('');
SELECT pg_temp.check_jb('15 signed out is denied',
  pg_temp.fails_with($q$SELECT * FROM public.get_lead_department_breakdown('2026-10-01', '2026-10-31')$q$, '42501'));
RESET ROLE;

-- 4. Privileges ----------------------------------------------------------------
SELECT pg_temp.check_jb('16 worker RPCs are service_role only; report is authenticated only',
  NOT has_function_privilege('authenticated', 'public.jellybean_match_candidates(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.save_jellybean_matches(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.jellybean_match_worker_authorized(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.save_jellybean_matches(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_lead_department_breakdown(timestamptz,timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_lead_department_breakdown(timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'public.lead_jellybean_matches', 'SELECT'));

-- 5. Cron credential and dispatcher ---------------------------------------------
SELECT pg_temp.check_jb('17 exactly one Vault cron secret exists after applying the migration twice',
  (SELECT count(*) FROM vault.secrets WHERE name = 'jellybean_match_cron_secret') = 1);
SELECT set_config('jb.cron_secret', (SELECT secret FROM vault.secrets WHERE name = 'jellybean_match_cron_secret'), true);
SET LOCAL ROLE service_role;
SELECT pg_temp.check_jb('18 the worker accepts only the Vault cron secret (and cannot read Vault itself)',
  public.jellybean_match_worker_authorized(current_setting('jb.cron_secret'))
  AND pg_temp.fails_with($q$SELECT 1 FROM vault.decrypted_secrets$q$, '42501')
  AND NOT public.jellybean_match_worker_authorized('wrong')
  AND NOT public.jellybean_match_worker_authorized('')
  AND NOT public.jellybean_match_worker_authorized(NULL));
RESET ROLE;
CREATE TEMP TABLE jb_dispatched AS SELECT marshmallow_private.dispatch_jellybean_match() AS called;
SELECT pg_temp.check_jb('19 with a pending lead, cron calls the worker with the secret',
  (SELECT called FROM jb_dispatched)
  AND (SELECT count(*) FROM net.calls) = 1
  AND (SELECT url = 'https://marshmallow.example.invalid/functions/v1/jellybean-match-leads'
          AND headers->>'x-cron-secret' = (SELECT secret FROM vault.secrets WHERE name = 'jellybean_match_cron_secret')
         FROM net.calls));
SET LOCAL ROLE service_role;
SELECT public.save_jellybean_matches(jsonb_build_array(jsonb_build_object(
  'lead_id','91000000-0000-4000-8000-000000000005','match_status','not_found',
  'customer_phone','4045550105','customer_landline','4045550199')));
RESET ROLE;
UPDATE jb_dispatched SET called = marshmallow_private.dispatch_jellybean_match();
SELECT pg_temp.check_jb('20 with nothing pending, cron does not call the worker',
  NOT (SELECT called FROM jb_dispatched) AND (SELECT count(*) FROM net.calls) = 1);

-- 6. Pending queue (20261231000900) -------------------------------------------
SELECT pg_temp.check_jb('21 once every lead is answered the queue is empty',
  NOT EXISTS (SELECT 1 FROM public.lead_jellybean_match_queue));
INSERT INTO public.leads (id, status, created_by, customer_phone, created_at) VALUES
  ('91000000-0000-4000-8000-000000000007', 'new', '91000000-0000-4000-8000-00000000000b', '4045550107', '2026-11-01'),
  ('91000000-0000-4000-8000-000000000008', 'new', '91000000-0000-4000-8000-00000000000b', '4045550108', '2026-11-02');
UPDATE jb_dispatched SET called = marshmallow_private.dispatch_jellybean_match();
SELECT pg_temp.check_jb('22 a multi-row insert queues every new lead and wakes the worker',
  (SELECT count(*) FROM public.lead_jellybean_match_queue) = 2
  AND (SELECT called FROM jb_dispatched) AND (SELECT count(*) FROM net.calls) = 2);
DELETE FROM public.leads WHERE id = '91000000-0000-4000-8000-000000000008';
SELECT pg_temp.check_jb('23 deleting a lead removes it from the queue',
  (SELECT array_agg(lead_id) FROM public.lead_jellybean_match_queue) = ARRAY['91000000-0000-4000-8000-000000000007'::uuid]);
DELETE FROM public.lead_jellybean_match_queue;
DELETE FROM public.lead_jellybean_matches WHERE lead_id = '91000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE jb_swept AS SELECT marshmallow_private.requeue_unchecked_jellybean_matches() AS first_run;
ALTER TABLE jb_swept ADD COLUMN second_run integer;
UPDATE jb_swept SET second_run = marshmallow_private.requeue_unchecked_jellybean_matches();
SELECT pg_temp.check_jb('24 the daily sweep re-queues answerless leads that fell out of the queue',
  (SELECT first_run = 2 AND second_run = 0 FROM jb_swept)
  AND (SELECT array_agg(right(lead_id::text, 1) ORDER BY lead_id) FROM public.lead_jellybean_match_queue) = ARRAY['1','7']);
SELECT pg_temp.check_jb('25 the queue and its sweep are not reachable by app users',
  NOT has_table_privilege('authenticated', 'public.lead_jellybean_match_queue', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.lead_jellybean_match_queue', 'SELECT')
  AND NOT has_function_privilege('authenticated', 'marshmallow_private.requeue_unchecked_jellybean_matches()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'marshmallow_private.requeue_unchecked_jellybean_matches()', 'EXECUTE'));

SELECT * FROM jb_checks ORDER BY name;
ROLLBACK;
