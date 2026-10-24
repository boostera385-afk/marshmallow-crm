-- WRITE-BASED, disposable fixture only; never run on shared production.
-- Behavioral checks for 20261126000000_processor_board_last_30_days.sql.
BEGIN;
CREATE TEMP TABLE recent_checks(name text,result text);
GRANT ALL ON recent_checks TO authenticated;
CREATE FUNCTION pg_temp.check_recent(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO recent_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
DELETE FROM public.leads; DELETE FROM public.user_roles; DELETE FROM marshmallow_private.processor_check_attempts;
INSERT INTO public.user_roles VALUES('21000000-0000-4000-8000-000000000001','processor');
INSERT INTO public.leads(id,job_id,customer_name,status,tech_name,tech_number,scheduled_date,scheduled_time_start,created_at) VALUES
 ('21000000-0000-4000-8000-000000000101','NEW-TODAY','A','scheduled','Tech','4155550199',current_date+1,'10:00',now()),
 ('21000000-0000-4000-8000-000000000102','NEW-29-DAYS','B','payment_pending','Tech','4155550199',current_date-25,'10:00',now()-interval '29 days'),
 ('21000000-0000-4000-8000-000000000103','OLD-31-DAYS','C','payment_pending','Tech','4155550199',current_date-25,'10:00',now()-interval '31 days'),
 ('21000000-0000-4000-8000-000000000104','OLD-90-DAYS','D','scheduled','Tech','4155550199',current_date-80,'10:00',now()-interval '90 days');
SELECT set_config('request.jwt.claim.sub','21000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_recent('board shows only leads created in the last 30 days',
  (SELECT array_agg(r->>'job_id' ORDER BY r->>'job_id') FROM jsonb_array_elements(public.list_processor_board_jobs()->'rows') r)=ARRAY['NEW-29-DAYS','NEW-TODAY']);
SELECT pg_temp.check_recent('totals and counts exclude older leads',(public.list_processor_board_jobs()->>'all_total')::int=2
  AND (SELECT sum(value::int) FROM jsonb_each_text(public.list_processor_board_jobs()->'counts'))=2);
SELECT pg_temp.check_recent('search cannot reach older leads',(public.list_processor_board_jobs(0,'OLD-')->>'total')::int=0);
RESET ROLE;
SELECT pg_temp.check_recent('worker checks only recent leads',
  (SELECT array_agg(l.job_id ORDER BY l.job_id) FROM public.processor_board_due_jobs(10) d JOIN public.leads l ON l.id=d)=ARRAY['NEW-29-DAYS','NEW-TODAY']);
SELECT pg_temp.check_recent('older leads are left unchanged',(SELECT count(*) FROM public.leads WHERE job_id LIKE 'OLD-%' AND status IN ('payment_pending','scheduled'))=2);
SELECT * FROM recent_checks ORDER BY name;
ROLLBACK;
