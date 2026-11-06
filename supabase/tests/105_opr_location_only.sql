-- WRITE-BASED, ISOLATED ONLY (scripts/test-operator-workflow-db.mjs). Synthetic rows;
-- everything rolls back. Covers 20261203000000_opr_location_only.
BEGIN;
CREATE TEMP TABLE loc_results(name text, result text);
GRANT SELECT, INSERT ON loc_results TO authenticated;
CREATE FUNCTION pg_temp.loc_check(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO loc_results VALUES(p_name, CASE WHEN coalesce(p_ok, false) THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.as_user(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',p_id,'role','authenticated')::text, true);
END $$;

-- City/state from real-world address shapes (street details are synthetic).
CREATE TEMP TABLE cases(job text, address text, city text, state text, expected text);
INSERT INTO cases VALUES
  ('L1', '9 Synthetic Way, Somewhere, FL 33071', 'Miami', 'FL', 'Miami, FL 33071'),
  ('L2', '123 Main St, Coral Springs, FL 33071', NULL, NULL, 'Coral Springs, FL 33071'),
  ('L3', '123 Main St Austin, TX 78701, USA', NULL, NULL, 'Austin, TX 78701'),
  ('L4', '605 2nd St S Sauk Rapids MN 56379', NULL, NULL, 'Sauk Rapids, MN 56379'),
  ('L5', '742 Evergreen Ter, FL 33071, USA', NULL, NULL, 'FL 33071'),
  ('L6', '12 Oak Ave, Apt 4, GA 30301', NULL, NULL, 'GA 30301'),
  ('L7', '55 Pine Rd, Suite B, Orlando, FL 32801', NULL, NULL, 'Orlando, FL 32801'),
  ('L8', 'call customer for address', NULL, NULL, NULL),
  ('L9', '1 A St, Coral Springs, FL 33071', NULL, 'Florida', 'Coral Springs, FL 33071'),
  ('L10', '8 Ridge Rd, Saint Simons Island, GA 31522', NULL, NULL, 'Saint Simons Island, GA 31522'),
  ('L11', '400 Market St St Louis, MO 63101', NULL, NULL, 'St. Louis, MO 63101'),
  ('L12', '77 Sunset Blvd, ZZ 90026', NULL, NULL, '90026'), -- unknown state code: ZIP only, never the street
  ('L13', '10 Lake Rd Ball Ground GA 30107', NULL, NULL, 'Ball Ground, GA 30107'),
  ('L14', '3 Elm St, Atlanta, GA 30301', '12 Elm St', 'GA', 'Atlanta, GA 30301'),
  ('L15', '9 Oak Dr, Loop Austin, TX 78701', NULL, NULL, 'Austin, TX 78701'),
  ('L16', E'9 Oak Dr,\nUpatoi, GA 31829', NULL, NULL, 'Upatoi, GA 31829'),
  ('L17', '9 Oak Dr, Port Saint Lucie, FL 34952', NULL, NULL, 'Port Saint Lucie, FL 34952'),
  ('L18', '9 Oak Dr, Saint Louis, MO 63101', NULL, NULL, 'St. Louis, MO 63101'),
  -- Street text typed into the city field or a comma part: never shown.
  ('L19', '9 Oak Dr, TX 75068', 'Kistler Dr Little Elm', 'TX', 'Little Elm, TX 75068'),
  ('L20', '9 Oak Dr, TX 75068', 'Burdsall Ave', 'TX', 'TX 75068'),
  ('L21', '9 Oak St, Greenwood Ave, FL 33071', NULL, NULL, 'FL 33071'),
  ('L22', '9 Oak St, Lorraine Drive, TX 75068', NULL, NULL, 'TX 75068'),
  ('L23', '9 Oak St, BONAIRE, GA 31005', NULL, NULL, 'Bonaire, GA 31005'),
  ('L24', '9 Oak St', 'BROWNS SUMMIT', 'GA', 'Browns Summit, GA'),
  ('L25', '9 Oak St, St Simons Island, GA 31522', NULL, NULL, 'St Simons Island, GA 31522'),
  ('L26', '9 Oak St, Main St Rex, GA 30273', NULL, NULL, 'GA 30273');
INSERT INTO public.leads(id,job_id,status,customer_name,customer_phone,address,city,state)
SELECT gen_random_uuid(), 'LOC-'||job, 'urgent_job', 'Synthetic', '5550100000', address, city, state FROM cases;
SELECT pg_temp.loc_check('Location ' || c.job || ' -> ' || coalesce(c.expected, 'nothing'),
  public.location_label(l) IS NOT DISTINCT FROM c.expected)
FROM cases c JOIN public.leads l ON l.job_id = 'LOC-' || c.job;
SELECT pg_temp.loc_check('Location never contains a house number or street words',
  NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.job_id LIKE 'LOC-%'
    AND (regexp_replace(public.location_label(l), '(^| )\d{5}$', '') ~ '\d' OR public.location_label(l) ~* '\m(main|oak|pine|elm st|market|ridge|evergreen|sunset|synthetic|lake rd|ave|rd|blvd|way|ter|apt|suite|dr|drive|kistler|burdsall|greenwood|lorraine)\M')));

-- Hold alerts: opr gets location only; opr_admin keeps full details.
CREATE TEMP TABLE ctx AS SELECT gen_random_uuid() AS lead_id,
  (SELECT user_id FROM public.user_roles WHERE role='opr' LIMIT 1) AS opr_id,
  (SELECT user_id FROM public.user_roles WHERE role='opr_admin' LIMIT 1) AS opr_admin_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.leads(id,job_id,status,customer_name,customer_phone,customer_landline,service_type,address,zip_code,tech_name,tech_number,quote,show_quote_to_opr)
SELECT lead_id,'LOC-HOLD','urgent_job','Synthetic hold','5550100000','5550109999','Plumbing','123 Main St, Coral Springs, FL 33071','33071','Synthetic Tech','5550108888','$200',true FROM ctx;
UPDATE public.leads SET cs_tag='ready_to_schedule' WHERE id=(SELECT lead_id FROM ctx);
SELECT pg_temp.loc_check('Operator snapshot has no address, customer number or technician',
  (SELECT snapshot->>'customer_phone' IS NULL AND snapshot->>'customer_landline' IS NULL AND snapshot->>'address' IS NULL
     AND snapshot->>'tech_name' IS NULL AND snapshot->>'tech_number' IS NULL
   FROM public.lead_hold_alerts WHERE lead_id=(SELECT lead_id FROM ctx) AND user_id=(SELECT opr_id FROM ctx)));
SELECT pg_temp.loc_check('Operator snapshot shows City, State and ZIP',
  (SELECT snapshot->>'city'='Coral Springs' AND snapshot->>'state'='FL' AND snapshot->>'zip_code'='33071' AND snapshot->>'quote'='$200' AND snapshot->>'customer_name'='Synthetic hold'
   FROM public.lead_hold_alerts WHERE lead_id=(SELECT lead_id FROM ctx) AND user_id=(SELECT opr_id FROM ctx)));
SELECT pg_temp.loc_check('Operator Admin snapshot is unchanged',
  (SELECT snapshot->>'customer_phone'='5550100000' AND snapshot->>'address' LIKE '123 Main St%' AND snapshot->>'tech_number'='5550108888'
   FROM public.lead_hold_alerts WHERE lead_id=(SELECT lead_id FROM ctx) AND user_id=(SELECT opr_admin_id FROM ctx)));
-- A snapshot stored before this change (full details) is redacted when an Operator reads it.
UPDATE public.lead_hold_alerts SET snapshot = snapshot || '{"customer_phone":"5550100000","address":"123 Main St","tech_name":"Synthetic Tech","city":"Coral Springs","state":"FL"}'::jsonb
WHERE lead_id=(SELECT lead_id FROM ctx) AND user_id=(SELECT opr_id FROM ctx);
SELECT pg_temp.as_user(opr_id) FROM ctx;
SET LOCAL ROLE authenticated;
SELECT pg_temp.loc_check('Operator reading alerts never gets the address, number or technician',
  (SELECT bool_and(a->'snapshot'->>'customer_phone' IS NULL AND a->'snapshot'->>'address' IS NULL AND a->'snapshot'->>'tech_name' IS NULL
     AND a->'snapshot'->>'city'='Coral Springs' AND a->'snapshot'->>'state'='FL') AND count(*)=1
   FROM jsonb_array_elements(public.get_operator_hold_alerts()->'alerts') a));
RESET ROLE;
SELECT pg_temp.as_user(opr_admin_id) FROM ctx;
SET LOCAL ROLE authenticated;
SELECT pg_temp.loc_check('Operator Admin reading alerts still gets full details',
  (SELECT bool_and(a->'snapshot'->>'customer_phone'='5550100000' AND a->'snapshot'->>'tech_number'='5550108888') AND count(*)=1
   FROM jsonb_array_elements(public.get_operator_hold_alerts()->'alerts') a));
RESET ROLE;
SELECT pg_temp.loc_check('Hold lead label is City, ST ZIP',
  (SELECT public.location_label(l)='Coral Springs, FL 33071' FROM public.leads l WHERE job_id='LOC-HOLD'));
SELECT pg_temp.loc_check('Signed-in users can compute the label',
  has_function_privilege('authenticated', 'public.location_label(public.leads)', 'EXECUTE'));
SELECT pg_temp.loc_check('Anonymous visitors cannot call the label function',
  NOT has_function_privilege('anon', 'public.location_label(public.leads)', 'EXECUTE'));
SELECT * FROM loc_results ORDER BY name;
ROLLBACK;
