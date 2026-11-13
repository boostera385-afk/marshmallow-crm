-- Production-safe post-application smoke checks. No writes, identities or PII.
-- Behavioral role/transition tests are isolated in 178_partial_paid_requests.sql.
SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT 'request type is required with legacy paid default' AS name, EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='lead_payment_requests' AND column_name='request_type'
      AND is_nullable='NO' AND column_default = '''paid''::text'
  ) AS ok
  UNION ALL SELECT 'request type constraint includes both outcomes', EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.lead_payment_requests'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) LIKE '%request_type%'
      AND pg_get_constraintdef(oid) LIKE '%partial_paid%' AND pg_get_constraintdef(oid) LIKE '%''paid''%'
  )
  UNION ALL SELECT 'all request outcomes valid', NOT EXISTS (
    SELECT 1 FROM public.lead_payment_requests WHERE request_type IS NULL OR request_type NOT IN ('paid','partial_paid')
  )
  UNION ALL SELECT 'paid gate trigger enabled', EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid='public.leads'::regclass
      AND tgname='enforce_paid_status_rules' AND tgenabled='O'
      AND tgfoid='public.enforce_paid_status_rules()'::regprocedure
  )
  UNION ALL SELECT 'gate remains invoker with fixed search path and both rules', EXISTS (
    SELECT 1 FROM pg_proc WHERE oid='public.enforce_paid_status_rules()'::regprocedure
      AND NOT prosecdef AND proconfig @> ARRAY['search_path=public']
      AND prosrc LIKE '%NEW.status = ''partial_paid''%'
      AND prosrc LIKE '%OLD.status = ''paid''%'
      AND prosrc LIKE '%insufficient_privilege%' AND prosrc LIKE '%check_violation%'
  )
  UNION ALL SELECT 'existing request RLS remains enabled', relrowsecurity
    FROM pg_class WHERE oid='public.lead_payment_requests'::regclass
) checks ORDER BY name;
