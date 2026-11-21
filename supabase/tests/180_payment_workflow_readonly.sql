-- Read-only production preflight. No customer identities, records or writes.
SELECT jsonb_build_object(
  'duplicate_pending_leads',(SELECT count(*) FROM (
    SELECT lead_id FROM public.lead_payment_requests WHERE status='pending'
    GROUP BY lead_id HAVING count(*)>1) duplicates),
  'invalid_request_amounts',(SELECT count(*) FROM public.lead_payment_requests
    WHERE amount<=0 OR amount::text IN ('NaN','Infinity','-Infinity')),
  'indexes',(SELECT jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef))
    FROM pg_indexes WHERE schemaname='public' AND tablename='lead_payment_requests'),
  'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid)) FROM pg_constraint
    WHERE conrelid='public.lead_payment_requests'::regclass),
  'policies',(SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p
    WHERE schemaname='public' AND tablename IN ('lead_payment_requests','leads')),
  'payment_gate',pg_get_functiondef('public.enforce_paid_status_rules()'::regprocedure),
  'workflow_wrapper',pg_get_functiondef('public.workflow_requests(jsonb)'::regprocedure),
  'storage_columns',(SELECT jsonb_agg(column_name) FROM information_schema.columns
    WHERE table_schema='storage' AND table_name='objects')
) AS payment_preflight;
