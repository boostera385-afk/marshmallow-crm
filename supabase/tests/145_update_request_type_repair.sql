-- MANUAL BEHAVIOR HARNESS. WRITES synthetic fixtures; LOCAL/ISOLATED DB ONLY.
-- Never execute on shared production without explicit approval. Apply migrations
-- 20261013082939, 20261120001000 and 20261121001000 first, run this exact file as
-- postgres, inspect every PASS/FAIL row, and note that the transaction rolls back.
BEGIN;

INSERT INTO auth.users(id, email) VALUES
 ('14500000-0000-4000-8000-000000000001','repair-admin@example.invalid'),
 ('14500000-0000-4000-8000-000000000002','repair-processor@example.invalid'),
 ('14500000-0000-4000-8000-000000000003','repair-cs@example.invalid'),
 ('14500000-0000-4000-8000-000000000004','repair-cs-admin@example.invalid'),
 ('14500000-0000-4000-8000-000000000005','repair-opr@example.invalid');
INSERT INTO public.profiles(id, full_name, email)
 SELECT id, split_part(email, '@', 1), email FROM auth.users WHERE id::text LIKE '14500000-%';
INSERT INTO public.user_roles(user_id, role) VALUES
 ('14500000-0000-4000-8000-000000000001','admin'),
 ('14500000-0000-4000-8000-000000000002','processor'),
 ('14500000-0000-4000-8000-000000000003','customer_service'),
 ('14500000-0000-4000-8000-000000000004','cs_admin'),
 ('14500000-0000-4000-8000-000000000005','opr');
INSERT INTO public.leads(id, job_id, customer_name, status, created_by, assigned_cs, tech_name, tech_number)
VALUES
 ('14500000-0000-4000-8000-000000000010','TYPE-REPAIR-CS','Synthetic CS lead','urgent_job',
  '14500000-0000-4000-8000-000000000003','14500000-0000-4000-8000-000000000003','Synthetic Tech','5550101450'),
 ('14500000-0000-4000-8000-000000000011','TYPE-REPAIR-ADMIN','Synthetic CS Admin lead','urgent_job',
  '14500000-0000-4000-8000-000000000004',NULL,'Synthetic Tech','5550101451');

CREATE TEMP TABLE _repair_original AS
 SELECT id, to_jsonb(l) record FROM public.leads l WHERE id::text LIKE '14500000-%';
CREATE TEMP TABLE _repair_checks(name text, result text);
GRANT ALL ON _repair_checks TO authenticated;
CREATE FUNCTION pg_temp.repair_check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO _repair_checks VALUES(label, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.repair_error(label text, statement text, expected_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  PERFORM pg_temp.repair_check(label, false);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.repair_check(label, sqlstate = expected_code);
END $$;

SELECT pg_temp.repair_check('request_kind remains canonical text', (
  SELECT format_type(a.atttypid, a.atttypmod) = 'text' FROM pg_attribute a
   WHERE a.attrelid='public.lead_cx_update_requests'::regclass AND a.attname='request_kind' AND NOT a.attisdropped));
SELECT pg_temp.repair_check('status remains canonical text', (
  SELECT format_type(a.atttypid, a.atttypmod) = 'text' FROM pg_attribute a
   WHERE a.attrelid='public.lead_cx_update_requests'::regclass AND a.attname='status' AND NOT a.attisdropped));
SELECT pg_temp.repair_check('thread remains canonical jsonb', (
  SELECT format_type(a.atttypid, a.atttypmod) = 'jsonb' FROM pg_attribute a
   WHERE a.attrelid='public.lead_cx_update_requests'::regclass AND a.attname='thread' AND NOT a.attisdropped));

SELECT set_config('request.jwt.claim.sub','14500000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT public.update_requests('tech','create','14500000-0000-4000-8000-000000000010',
  '14500000-0000-4000-8000-000000000020','Confirm technician arrival',0);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','14500000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT public.update_requests('tech','create','14500000-0000-4000-8000-000000000011',
  '14500000-0000-4000-8000-000000000021','Confirm technician materials',0);
RESET ROLE;

SELECT pg_temp.repair_check('CS creates a Tech request after repair', EXISTS(
 SELECT 1 FROM public.lead_cx_update_requests WHERE id='14500000-0000-4000-8000-000000000020'
   AND request_kind='tech' AND status='pending'));
SELECT pg_temp.repair_check('CS Admin creates a Tech request after repair', EXISTS(
 SELECT 1 FROM public.lead_cx_update_requests WHERE id='14500000-0000-4000-8000-000000000021'
   AND request_kind='tech' AND status='pending'));
SELECT pg_temp.repair_check('Processor notifications are created', (
 SELECT count(*)=2 FROM public.notifications WHERE user_id='14500000-0000-4000-8000-000000000002'
   AND title='Get Tech Update'));

SELECT set_config('request.jwt.claim.sub','14500000-0000-4000-8000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.repair_error('OPR remains excluded',
 $$select public.update_requests('tech','create','14500000-0000-4000-8000-000000000010',
   '14500000-0000-4000-8000-000000000022','Not allowed',0)$$, '42501');
RESET ROLE;

SELECT pg_temp.repair_check('Repair and requests leave leads unchanged', NOT EXISTS(
 SELECT 1 FROM _repair_original o JOIN public.leads l ON l.id=o.id WHERE to_jsonb(l) IS DISTINCT FROM o.record));

SELECT * FROM _repair_checks ORDER BY name;
ROLLBACK;
