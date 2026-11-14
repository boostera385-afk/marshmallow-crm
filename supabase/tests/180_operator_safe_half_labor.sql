-- WRITE-BASED, ISOLATED ONLY (scripts/test-operator-safe-leads-db.mjs). Synthetic rows;
-- everything rolls back. Covers 20261219000000_operator_safe_leads_half_labor:
-- a plain Operator receives half the labor and never the full labor amount.
BEGIN;
CREATE TEMP TABLE results(name text, result text);
GRANT SELECT, INSERT ON results TO authenticated;
CREATE FUNCTION pg_temp.check(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (p_name, CASE WHEN coalesce(p_ok, false) THEN 'PASS' ELSE 'FAIL' END);
$$;
INSERT INTO public.leads(job_id, status, customer_name, quote, terms, labor_amount, material_amount, for_you_amount, for_us_amount, city, state, zip_code) VALUES
  ('U-200', 'urgent_job', 'Synthetic A', 'Full quote $250', 'quoted', 200, 50, 120, 80, 'Miami', 'FL', '33101'),
  ('U-ODD', 'urgent_job', 'Synthetic B', NULL, 'quoted', 99.99, NULL, NULL, NULL, 'Miami', 'FL', '33101'),
  ('U-NONE', 'urgent_job', 'Synthetic C', NULL, 'free_estimate', NULL, NULL, NULL, NULL, 'Miami', 'FL', '33101'),
  ('PAID', 'paid', 'Synthetic D', NULL, 'quoted', 300, NULL, NULL, NULL, 'Miami', 'FL', '33101');
CREATE TEMP TABLE seen AS SELECT * FROM public.get_operator_safe_leads() WITH NO DATA;
GRANT SELECT, INSERT ON seen TO authenticated;

SELECT set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
INSERT INTO seen SELECT * FROM public.get_operator_safe_leads();
RESET ROLE;
SELECT pg_temp.check('Operator gets half the labor, to the cent',
  (SELECT operator_labor_amount FROM seen WHERE job_id = 'U-200') = 100
  AND (SELECT operator_labor_amount FROM seen WHERE job_id = 'U-ODD') = 50.00);
SELECT pg_temp.check('Operator never receives the full labor amount',
  (SELECT count(*) FROM seen WHERE labor_amount IS NOT NULL) = 0);
SELECT pg_temp.check('No labor recorded means no half labor (nothing inferred)',
  (SELECT operator_labor_amount IS NULL FROM seen WHERE job_id = 'U-NONE'));
SELECT pg_temp.check('Parts/materials and terms still sent; quote, customer and split still hidden',
  (SELECT material_amount = 50 AND terms = 'quoted' AND quote IS NULL AND customer_name IS NULL
     AND for_you_amount IS NULL AND for_us_amount IS NULL FROM seen WHERE job_id = 'U-200'));
SELECT pg_temp.check('Rows are unchanged: urgent untagged leads only', (SELECT count(*) = 3 FROM seen) AND NOT EXISTS (SELECT 1 FROM seen WHERE job_id = 'PAID'));
SELECT pg_temp.check('Stored labor is unchanged', (SELECT labor_amount = 200 FROM public.leads WHERE job_id = 'U-200'));

DELETE FROM seen;
SELECT set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
INSERT INTO seen SELECT * FROM public.get_operator_safe_leads();
RESET ROLE;
SELECT pg_temp.check('OPR Admin and other roles get no rows from it (they read leads normally)', (SELECT count(*) = 0 FROM seen));

SELECT pg_temp.check('Grants unchanged: authenticated and service_role, not anon',
  has_function_privilege('authenticated', 'public.get_operator_safe_leads()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_operator_safe_leads()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_operator_safe_leads()', 'EXECUTE'));
SELECT pg_temp.check('Still SECURITY DEFINER with a fixed search_path',
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.get_operator_safe_leads()'::regprocedure));
SELECT * FROM results ORDER BY name;
ROLLBACK;
