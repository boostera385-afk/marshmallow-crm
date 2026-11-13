-- ISOLATED behavioral harness: requires fixtures/partial_paid_requests.sql,
-- the exact migration (twice for idempotency), and its normal leads trigger.
-- Never run against production: uses synthetic integer lead ids and real writes.
BEGIN;
CREATE TEMP TABLE checks (name text, result text);
DO $$
DECLARE
  caller record;
  target text;
  denied boolean;
  terminal boolean;
BEGIN
  INSERT INTO checks SELECT 'legacy request defaults to paid',
    CASE WHEN request_type = 'paid' THEN 'PASS' ELSE 'FAIL' END FROM public.lead_payment_requests WHERE id=1;
  INSERT INTO public.lead_payment_requests VALUES (2,1,25,'partial_paid');
  INSERT INTO checks SELECT 'partial request stored without changing amount',
    CASE WHEN request_type='partial_paid' AND amount=25 THEN 'PASS' ELSE 'FAIL' END FROM public.lead_payment_requests WHERE id=2;
  BEGIN
    INSERT INTO public.lead_payment_requests VALUES (3,1,25,'invalid');
    INSERT INTO checks VALUES ('invalid request type rejected','FAIL');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO checks VALUES ('invalid request type rejected','PASS');
  END;
  FOR caller IN SELECT * FROM public.user_roles LOOP
    PERFORM set_config('request.jwt.claim.sub', caller.user_id::text, true);
    FOREACH target IN ARRAY ARRAY['paid','partial_paid'] LOOP
      denied := false;
      BEGIN
        UPDATE public.leads SET status=target WHERE id=1;
      EXCEPTION WHEN insufficient_privilege THEN denied := true;
      END;
      INSERT INTO checks VALUES (caller.role || ' setting ' || target,
        CASE WHEN denied = (caller.role <> 'admin') THEN 'PASS' ELSE 'FAIL' END);
      -- Restore only as the privileged fixture owner with the trigger removed
      -- from this reset; paid's terminal behavior is tested separately below.
      ALTER TABLE public.leads DISABLE TRIGGER enforce_paid_status_rules;
      UPDATE public.leads SET status='job_done' WHERE id=1;
      ALTER TABLE public.leads ENABLE TRIGGER enforce_paid_status_rules;
    END LOOP;
    terminal := false;
    BEGIN
      UPDATE public.leads SET status='job_done' WHERE id=2;
    EXCEPTION WHEN check_violation THEN terminal := true;
    END;
    INSERT INTO checks VALUES (caller.role || ' cannot reopen paid', CASE WHEN terminal THEN 'PASS' ELSE 'FAIL' END);
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.leads SET status='partial_paid' WHERE id=1;
  INSERT INTO checks SELECT 'trusted server may set partial paid', CASE WHEN status='partial_paid' THEN 'PASS' ELSE 'FAIL' END FROM public.leads WHERE id=1;
  UPDATE public.leads SET status='payment_pending' WHERE id=1;
  INSERT INTO checks SELECT 'partial paid is not terminal', CASE WHEN status='payment_pending' THEN 'PASS' ELSE 'FAIL' END FROM public.leads WHERE id=1;
  UPDATE public.leads SET payment_amount=101 WHERE id=2;
  UPDATE public.leads SET status='paid' WHERE id=2;
  INSERT INTO checks SELECT 'paid fields and same-status saves still work', CASE WHEN payment_amount=101 AND status='paid' THEN 'PASS' ELSE 'FAIL' END FROM public.leads WHERE id=2;
END $$;
GRANT SELECT, INSERT ON checks TO authenticated;
SELECT set_config('request.jwt.claim.sub','17800000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
WITH changed AS (UPDATE public.leads SET status='payment_pending' WHERE id=4 RETURNING id)
INSERT INTO checks SELECT 'CS cannot mutate an out-of-scope lead', CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM changed;
RESET ROLE;
SELECT name, result FROM checks ORDER BY name;
ROLLBACK;
