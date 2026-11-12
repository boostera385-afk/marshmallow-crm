-- WRITE-BASED, ISOLATED ONLY (scripts/test-message-templates-db.mjs). Synthetic rows;
-- everything rolls back. Covers 20261212000000_message_templates_settings.
-- admin=...01, cs_admin=...02, processor=...03, opr=...04
BEGIN;
CREATE TEMP TABLE results(name text, result text);
GRANT SELECT, INSERT ON results TO authenticated, anon;
CREATE FUNCTION pg_temp.check(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (p_name, CASE WHEN coalesce(p_ok, false) THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.check_error(p_name text, p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; PERFORM pg_temp.check(p_name, false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check(p_name, sqlstate = p_code); END $$;
CREATE FUNCTION pg_temp.as_user(p_id text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_id, true);
$$;

-- Admin saves (insert, then update) a template.
SELECT pg_temp.as_user('17600000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
INSERT INTO public.message_templates(key, template, updated_by)
  VALUES ('check_template', 'Hi {tech_name}', '17600000-0000-4000-8000-000000000002');
SELECT pg_temp.check('Admin can insert a template', (SELECT template = 'Hi {tech_name}' FROM public.message_templates WHERE key = 'check_template'));
SELECT pg_temp.check('updated_by is the caller, not the value sent',
  (SELECT updated_by = '17600000-0000-4000-8000-000000000001' FROM public.message_templates WHERE key = 'check_template'));
INSERT INTO public.message_templates(key, template) VALUES ('check_template', 'Hello {tech_name}')
  ON CONFLICT (key) DO UPDATE SET template = excluded.template;
SELECT pg_temp.check('Admin can update a template (upsert)', (SELECT template = 'Hello {tech_name}' FROM public.message_templates WHERE key = 'check_template'));
INSERT INTO public.message_templates(key, template) VALUES ('technician_message_quoted', 'Quoted {customer_name}');
SELECT pg_temp.check_error('Unknown template keys are rejected',
  $$INSERT INTO public.message_templates(key, template) VALUES ('technician_reminder', 'x')$$, '23514');
SELECT pg_temp.check_error('Blank templates are rejected',
  $$INSERT INTO public.message_templates(key, template) VALUES ('technician_message', '   ')$$, '23514');
RESET ROLE;

-- Every other role reads, but cannot write.
SELECT pg_temp.as_user('17600000-0000-4000-8000-000000000002'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('CS Admin reads the saved templates', (SELECT count(*) = 2 FROM public.message_templates));
SELECT pg_temp.check_error('CS Admin cannot insert', $$INSERT INTO public.message_templates(key, template) VALUES ('technician_message', 'x')$$, '42501');
UPDATE public.message_templates SET template = 'hacked' WHERE key = 'check_template';
DELETE FROM public.message_templates WHERE key = 'check_template';
RESET ROLE;
SELECT pg_temp.check('CS Admin update/delete change nothing', (SELECT template = 'Hello {tech_name}' FROM public.message_templates WHERE key = 'check_template'));

SELECT pg_temp.as_user('17600000-0000-4000-8000-000000000003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('Processor reads the saved templates', (SELECT count(*) = 2 FROM public.message_templates));
SELECT pg_temp.check_error('Processor cannot insert', $$INSERT INTO public.message_templates(key, template) VALUES ('technician_message', 'x')$$, '42501');
RESET ROLE;

SELECT pg_temp.as_user('17600000-0000-4000-8000-000000000004'); SET LOCAL ROLE authenticated;
SELECT pg_temp.check('OPR reads the saved templates', (SELECT count(*) = 2 FROM public.message_templates));
UPDATE public.message_templates SET template = 'hacked' WHERE key = 'technician_message_quoted';
RESET ROLE;
SELECT pg_temp.check('OPR update changes nothing', (SELECT template = 'Quoted {customer_name}' FROM public.message_templates WHERE key = 'technician_message_quoted'));

SELECT pg_temp.as_user(''); SET LOCAL ROLE anon;
SELECT pg_temp.check_error('Anonymous visitors cannot read', $$SELECT count(*) FROM public.message_templates$$, '42501');
RESET ROLE;

-- Admin resets a template to the built-in text by deleting its row.
SELECT pg_temp.as_user('17600000-0000-4000-8000-000000000001'); SET LOCAL ROLE authenticated;
DELETE FROM public.message_templates WHERE key = 'check_template';
RESET ROLE;
SELECT pg_temp.check('Admin can delete (reset to built-in)', NOT EXISTS (SELECT 1 FROM public.message_templates WHERE key = 'check_template'));
SELECT pg_temp.check('Exactly four policies (select/insert/update/delete)',
  (SELECT count(*) = 4 FROM pg_policies WHERE tablename = 'message_templates'));
SELECT * FROM results ORDER BY name;
ROLLBACK;
