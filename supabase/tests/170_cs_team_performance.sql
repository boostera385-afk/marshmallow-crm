-- WRITE-BASED, disposable fixture only; never run on shared production.
-- Behavioral checks for 20261128000000_cs_team_performance_access.sql.
BEGIN;
CREATE TEMP TABLE cs_checks(name text,result text);
GRANT ALL ON cs_checks TO authenticated;
CREATE FUNCTION pg_temp.check_cs(name text,ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO cs_checks VALUES(name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END)
$$;
-- Synthetic team: admin A, CS B (granted), CS C (not granted), CS Admin D, processor E (granted), CS F (denied override).
INSERT INTO public.user_roles VALUES
 ('70000000-0000-4000-8000-00000000000a','admin'),('70000000-0000-4000-8000-00000000000b','customer_service'),
 ('70000000-0000-4000-8000-00000000000c','customer_service'),('70000000-0000-4000-8000-00000000000d','cs_admin'),
 ('70000000-0000-4000-8000-00000000000e','processor'),('70000000-0000-4000-8000-00000000000f','customer_service');
INSERT INTO public.profiles VALUES ('70000000-0000-4000-8000-00000000000b','Bea'),('70000000-0000-4000-8000-00000000000c','Cal'),('70000000-0000-4000-8000-00000000000d','Dee');
INSERT INTO public.navigation_permissions(user_id,nav_section,allowed) VALUES
 ('70000000-0000-4000-8000-00000000000b','cs_team_performance',true),('70000000-0000-4000-8000-00000000000e','cs_team_performance',true),
 ('70000000-0000-4000-8000-00000000000f','cs_team_performance',false),('70000000-0000-4000-8000-00000000000c','analytics',true);
INSERT INTO public.leads(status,created_by,created_at) VALUES
 ('needs_quote','70000000-0000-4000-8000-00000000000b','2026-10-10'),('scheduled','70000000-0000-4000-8000-00000000000b','2026-10-11'),
 ('paid','70000000-0000-4000-8000-00000000000b','2026-10-12'),('job_done','70000000-0000-4000-8000-00000000000c','2026-10-12'),
 ('cancelled','70000000-0000-4000-8000-00000000000c','2026-10-13'),('waiting_complete_details','70000000-0000-4000-8000-00000000000d','2026-10-14'),
 ('paid','70000000-0000-4000-8000-00000000000a','2026-10-14'),('paid','70000000-0000-4000-8000-00000000000e','2026-10-14'),
 ('paid','70000000-0000-4000-8000-00000000000b','2026-08-01');
CREATE FUNCTION pg_temp.as_user(id text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub',id,true) $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('70000000-0000-4000-8000-00000000000b');
SELECT pg_temp.check_cs('1 a granted CS user gets every CS member''s counts, not just their own',
  (SELECT array_agg(member_name||':'||total_added||'/'||engaged||'/'||scheduled||'/'||completed||':'||member_role ORDER BY member_name)
   FROM public.cs_team_performance('2026-10-01','2026-10-31')) = ARRAY['Bea:3/2/2/1:customer_service','Cal:2/2/1/1:customer_service','Dee:1/0/0/0:cs_admin']);
SELECT pg_temp.check_cs('2 the same CS user still reads only their own lead rows directly', (SELECT count(*) FROM public.leads) = 4);
SELECT pg_temp.check_cs('3 leads by admin or other roles and outside the range are not counted',
  (SELECT sum(total_added) FROM public.cs_team_performance('2026-10-01','2026-10-31')) = 6
  AND (SELECT sum(total_added) FROM public.cs_team_performance('2026-07-01','2026-10-31')) = 7);
SELECT pg_temp.as_user('70000000-0000-4000-8000-00000000000a');
SELECT pg_temp.check_cs('4 admin is allowed without a grant', (SELECT count(*) FROM public.cs_team_performance('2026-10-01','2026-10-31')) = 3);
SELECT pg_temp.as_user('70000000-0000-4000-8000-00000000000e');
SELECT pg_temp.check_cs('5 the grant works for another role too', (SELECT count(*) FROM public.cs_team_performance('2026-10-01','2026-10-31')) = 3);
CREATE FUNCTION pg_temp.denied(id text, s timestamptz, e timestamptz, code text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',id,true);
  PERFORM * FROM public.cs_team_performance(s,e);
  RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE = code;
END $$;
SELECT pg_temp.check_cs('6 denied: no grant, an Analytics-only grant, a denied override, or signed out',
  pg_temp.denied('70000000-0000-4000-8000-00000000000c','2026-10-01','2026-10-31','42501')
  AND pg_temp.denied('70000000-0000-4000-8000-00000000000f','2026-10-01','2026-10-31','42501')
  AND pg_temp.denied('','2026-10-01','2026-10-31','42501'));
SELECT pg_temp.check_cs('7 an invalid range is rejected', pg_temp.denied('70000000-0000-4000-8000-00000000000b','2026-10-31','2026-10-01','22023'));
RESET ROLE;
SELECT pg_temp.check_cs('8 anon cannot execute it', NOT has_function_privilege('anon','public.cs_team_performance(timestamptz,timestamptz)','EXECUTE')
  AND has_function_privilege('authenticated','public.cs_team_performance(timestamptz,timestamptz)','EXECUTE'));
SELECT * FROM cs_checks ORDER BY name;
ROLLBACK;
