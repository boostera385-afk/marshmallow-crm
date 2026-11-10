-- =============================================================================
-- Isolated harness: leads RLS single role lookup + load governor
--
-- Runs ONLY on a throwaway local PostgreSQL (16+). Never on the shared project:
-- it creates stand-in Supabase schemas, synthetic users and synthetic leads.
--
--   createdb mtest
--   psql -v ON_ERROR_STOP=1 -d mtest -f supabase/tests/171_leads_rls_and_load_governor_isolated.sql
--   dropdb mtest
--
-- What it proves:
--   1. Migration 20261210000000 keeps lead visibility identical: for one user of
--      every role, a second CS, and a user with no role, the visible lead ids
--      through real RLS are the same before and after (shares, granted paid
--      leads and NULL statuses included).
--   2. Migration 20261210010000 (load governor): level decisions and
--      hysteresis, which deferrable jobs run at each level, broadcasts, counter
--      reset and stopped-sensor safety, cron commands, privileges.
--   Ends with a PASS/FAIL grid and raises an error if anything failed.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\ir local/supabase_stubs.sql
CREATE TABLE public.results (n serial, check_name text, ok boolean, detail text);

-- 1. Lead visibility before and after ------------------------------------------
-- Synthetic users: one per role, a second CS, a user with no role.
INSERT INTO public.user_roles VALUES
 ('00000000-0000-4000-8000-0000000000a1','admin'),('00000000-0000-4000-8000-0000000000a2','processor'),
 ('00000000-0000-4000-8000-0000000000a3','opr'),('00000000-0000-4000-8000-0000000000a4','opr_admin'),
 ('00000000-0000-4000-8000-0000000000a5','cs_admin'),('00000000-0000-4000-8000-0000000000a6','customer_service'),
 ('00000000-0000-4000-8000-0000000000a7','customer_service');
CREATE TABLE public.test_users (u uuid, label text);
INSERT INTO public.test_users VALUES
 ('00000000-0000-4000-8000-0000000000a1','admin'),('00000000-0000-4000-8000-0000000000a2','processor'),
 ('00000000-0000-4000-8000-0000000000a3','opr'),('00000000-0000-4000-8000-0000000000a4','opr_admin'),
 ('00000000-0000-4000-8000-0000000000a5','cs_admin'),('00000000-0000-4000-8000-0000000000a6','cs_1'),
 ('00000000-0000-4000-8000-0000000000a7','cs_2'),('00000000-0000-4000-8000-0000000000a8','no_role');
-- Leads: every status x owner pattern (created_by / assigned / shared / nobody) for each test user.
INSERT INTO public.leads (id, status, created_by, assigned_cs)
SELECT gen_random_uuid(), st,
       CASE WHEN pat = 'created' THEN tu.u END,
       CASE WHEN pat = 'assigned' THEN tu.u END
FROM unnest(array['new','urgent_job','paid','partial_paid','cancelled','job_done','scammed','quoted',NULL]) st,
     unnest(array['created','assigned','shared','none']) pat,
     public.test_users tu;
INSERT INTO public.lead_shares (lead_id, shared_with_user_id)
SELECT l.id, tu.u FROM public.leads l JOIN public.test_users tu ON true
WHERE l.created_by IS NULL AND l.assigned_cs IS NULL AND l.id IN (
  SELECT id FROM public.leads WHERE created_by IS NULL AND assigned_cs IS NULL ORDER BY id LIMIT 200) AND random() < 0.15;
-- Paid grants for one CS.
INSERT INTO marshmallow_private.paid_grants SELECT '00000000-0000-4000-8000-0000000000a6', id FROM public.leads WHERE status = 'paid' LIMIT 5;
CREATE TABLE public.visibility (phase text, label text, lead_id uuid);
GRANT INSERT, SELECT ON public.visibility TO authenticated;
GRANT SELECT ON public.test_users TO authenticated;

\set phase old
SELECT format($f$
BEGIN;
SET LOCAL request.jwt.claims = %L;
SET LOCAL ROLE authenticated;
INSERT INTO public.visibility SELECT %L, %L, id FROM public.leads;
COMMIT;
$f$, json_build_object('sub', u, 'role', 'authenticated')::text, :'phase', label) FROM public.test_users \gexec

\ir ../migrations/20261210000000_leads_rls_single_role_lookup.sql
\set phase new
SELECT format($f$
BEGIN;
SET LOCAL request.jwt.claims = %L;
SET LOCAL ROLE authenticated;
INSERT INTO public.visibility SELECT %L, %L, id FROM public.leads;
COMMIT;
$f$, json_build_object('sub', u, 'role', 'authenticated')::text, :'phase', label) FROM public.test_users \gexec

INSERT INTO public.results(check_name, ok, detail)
SELECT 'leads visibility unchanged: ' || t.label,
  NOT EXISTS ((SELECT lead_id FROM public.visibility WHERE phase='old' AND label=t.label EXCEPT SELECT lead_id FROM public.visibility WHERE phase='new' AND label=t.label)
        UNION ALL (SELECT lead_id FROM public.visibility WHERE phase='new' AND label=t.label EXCEPT SELECT lead_id FROM public.visibility WHERE phase='old' AND label=t.label)),
  (SELECT count(*) FROM public.visibility WHERE phase='new' AND label=t.label)::text || ' visible'
FROM public.test_users t;

-- 2. Load governor -----------------------------------------------------------------
\ir ../migrations/20261210010000_load_governor.sql
-- helper: advance the clock by shifting history 60 s into the past, set the counter, sample.
CREATE FUNCTION public.minute(p_busy_pct numeric) RETURNS text LANGUAGE plpgsql AS $$
DECLARE lvl text; BEGIN
  UPDATE marshmallow_private.load_samples SET sampled_at = sampled_at - interval '60 seconds';
  UPDATE marshmallow_private.load_state SET sampled_at = sampled_at - interval '60 seconds', changed_at = changed_at - interval '60 seconds';
  UPDATE extensions.pg_stat_statements SET total_exec_time = total_exec_time + p_busy_pct / 100.0 * 120000;
  lvl := marshmallow_private.sample_load();
  RETURN lvl;
END $$;

-- 1. decide_load_level, table driven
INSERT INTO public.results(check_name, ok, detail)
SELECT 'decide: '||label, got = want, format('got %s want %s', got, want) FROM (
  SELECT label, want, marshmallow_private.decide_load_level(cur, arr, conn, (SELECT p FROM marshmallow_private.load_policy p)) got
  FROM (VALUES
    ('no samples', 'normal', NULL::numeric[], 0::numeric, 'normal'),
    ('one hot minute is not enough', 'normal', '{55}', 0, 'normal'),
    ('two minutes >=50 -> elevated', 'normal', '{55,60}', 0, 'elevated'),
    ('two minutes >=80 -> critical', 'normal', '{85,90}', 0, 'critical'),
    ('spike then calm stays normal', 'normal', '{85,40}', 0, 'normal'),
    ('elevated holds until clearly calm', 'elevated', '{40,60}', 0, 'elevated'),
    ('elevated recovers after 3 calm minutes', 'elevated', '{30,20,10}', 0, 'normal'),
    ('critical steps down to elevated', 'critical', '{60,90}', 0, 'elevated'),
    ('critical recovers after 3 calm minutes', 'critical', '{30,20,10}', 0, 'normal'),
    ('connections >=70% -> elevated', 'normal', '{10,10}', 75, 'elevated'),
    ('unknown minute never escalates', 'normal', '{NULL,90}', 0, 'normal'),
    ('two calm minutes are not recovery', 'elevated', '{20,20}', 0, 'elevated')
  ) t(label, cur, arr, conn, want)
) x;

-- 2. deferrable_job_allowed matrix
INSERT INTO public.results(check_name, ok, detail)
SELECT format('allowed: %s @ %s min%s since %s', job, lvl, minute, since), got = want, format('got %s want %s', got, want) FROM (
  SELECT job, lvl, minute, since, want, marshmallow_private.deferrable_job_allowed(job, lvl, minute, since, true, 10) got FROM (VALUES
    ('sheets_sync','normal',3,60,true), ('sheets_sync','elevated',3,60,false), ('sheets_sync','elevated',5,60,true), ('sheets_sync','critical',5,60,false),
    ('urgent_ai_refresh','normal',0,60,true), ('urgent_ai_refresh','elevated',0,60,false), ('urgent_ai_refresh','critical',0,60,false),
    ('processor_board_daily','normal',0,60,true), ('processor_board_daily','elevated',0,60,false),
    ('sheets_watchdog','normal',0,60,true), ('sheets_watchdog','normal',0,4,false), ('sheets_watchdog','elevated',0,60,false),
    ('schedule_monitor','normal',0,60,true), ('schedule_monitor','elevated',0,60,true), ('schedule_monitor','critical',0,60,false),
    ('anything_else','critical',0,60,true)
  ) t(job, lvl, minute, since, want)
) x;
INSERT INTO public.results(check_name, ok, detail)
SELECT 'shedding switch off lets everything run', marshmallow_private.deferrable_job_allowed('urgent_ai_refresh','critical',0,0,false,10), '';

-- 3. end to end: sensor, levels, broadcasts, wrappers
SELECT public.minute(0);                -- first sample: no previous, busy unknown
INSERT INTO public.results(check_name, ok, detail) SELECT 'first sample normal, unknown busy', level = 'normal' AND busy_pct IS NULL, level FROM marshmallow_private.load_samples ORDER BY sampled_at DESC LIMIT 1;
SELECT public.minute(60);
INSERT INTO public.results(check_name, ok, detail) SELECT 'busy % measured from counter delta', busy_pct BETWEEN 59 AND 61, busy_pct::text FROM marshmallow_private.load_samples ORDER BY sampled_at DESC LIMIT 1;
INSERT INTO public.results(check_name, ok, detail) SELECT 'one 60% minute stays normal', level = 'normal', level FROM marshmallow_private.load_state;
INSERT INTO public.results(check_name, ok, detail) SELECT 'no broadcast while normal and unchanged', count(*) = 0, count(*)::text FROM realtime.sent;
SELECT public.minute(65);
INSERT INTO public.results(check_name, ok, detail) SELECT 'two 60% minutes -> elevated', level = 'elevated', level FROM marshmallow_private.load_state;
INSERT INTO public.results(check_name, ok, detail) SELECT 'elevated broadcast on global-app-events (public)', count(*) = 1 AND bool_and(topic = 'global-app-events' AND event = 'system_load' AND NOT private AND payload->>'level' = 'elevated'), count(*)::text FROM realtime.sent;
INSERT INTO public.results(check_name, ok, detail) SELECT 'broadcast carries only level, busy_pct, changed_at', (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(payload) k) = '{busy_pct,changed_at,level}', payload::text FROM realtime.sent ORDER BY at DESC LIMIT 1;
TRUNCATE public.job_calls;
SELECT marshmallow_private.cron_guarded_urgent_ai_refresh(), marshmallow_private.cron_guarded_processor_board_daily(),
       marshmallow_private.cron_guarded_sheets_watchdog(), marshmallow_private.cron_guarded_schedule_monitor();
INSERT INTO public.results(check_name, ok, detail) SELECT 'elevated: only schedule monitor runs (of the four)', array_agg(job ORDER BY job) = '{schedule_monitor}', array_agg(job)::text FROM public.job_calls;
SELECT public.minute(90); SELECT public.minute(95);
INSERT INTO public.results(check_name, ok, detail) SELECT 'two 90% minutes -> critical', level = 'critical', level FROM marshmallow_private.load_state;
INSERT INTO public.results(check_name, ok, detail) SELECT 'rebroadcast every minute while raised', count(*) = 3, count(*)::text FROM realtime.sent;
TRUNCATE public.job_calls;
SELECT marshmallow_private.cron_guarded_sheets_sync(), marshmallow_private.cron_guarded_schedule_monitor(), marshmallow_private.cron_guarded_urgent_ai_refresh();
INSERT INTO public.results(check_name, ok, detail) SELECT 'critical: nothing deferrable runs', count(*) = 0, count(*)::text FROM public.job_calls;
SELECT public.minute(20); SELECT public.minute(15);
INSERT INTO public.results(check_name, ok, detail) SELECT 'two calm minutes hold elevated', level = 'elevated', level FROM marshmallow_private.load_state;
SELECT public.minute(10);
INSERT INTO public.results(check_name, ok, detail) SELECT 'three calm minutes -> normal', level = 'normal', level FROM marshmallow_private.load_state;
INSERT INTO public.results(check_name, ok, detail) SELECT 'normal broadcast once on recovery', payload->>'level' = 'normal', payload::text FROM realtime.sent ORDER BY at DESC LIMIT 1;
INSERT INTO public.results(check_name, ok, detail) SELECT 'watchdog waits after recovery', NOT marshmallow_private.deferrable_job_allowed_now('sheets_watchdog'), '';
TRUNCATE public.job_calls;
SELECT marshmallow_private.cron_guarded_sheets_sync(), marshmallow_private.cron_guarded_urgent_ai_refresh(), marshmallow_private.cron_guarded_schedule_monitor();
INSERT INTO public.results(check_name, ok, detail) SELECT 'normal: jobs run again', array_agg(job ORDER BY job) = '{schedule_monitor,sheets_sync,urgent_ai_refresh}', array_agg(job)::text FROM public.job_calls;
SELECT count(*) AS sent_before FROM realtime.sent \gset
SELECT public.minute(10);
INSERT INTO public.results(check_name, ok, detail) SELECT 'quiet when normal and unchanged', count(*) = :sent_before, count(*)::text FROM realtime.sent;
-- counter reset (e.g. stats reset) never reads as load
UPDATE extensions.pg_stat_statements SET total_exec_time = 0;
UPDATE marshmallow_private.load_samples SET sampled_at = sampled_at - interval '60 seconds';
SELECT marshmallow_private.sample_load();
INSERT INTO public.results(check_name, ok, detail) SELECT 'counter reset -> busy unknown', busy_pct IS NULL, coalesce(busy_pct::text,'null') FROM marshmallow_private.load_samples ORDER BY sampled_at DESC LIMIT 1;
-- stale sensor never leaves work shed
UPDATE marshmallow_private.load_state SET level = 'critical', sampled_at = now() - interval '11 minutes';
INSERT INTO public.results(check_name, ok, detail) SELECT 'stopped sensor reads as normal', marshmallow_private.current_load_level() = 'normal', marshmallow_private.current_load_level();
-- schedules
INSERT INTO public.results(check_name, ok, detail)
SELECT 'cron points at guarded wrappers + sampler; retention unchanged',
  (SELECT command FROM cron.job WHERE jobname='google-sheets-outbox-worker') = 'SELECT marshmallow_private.cron_guarded_sheets_sync()'
  AND (SELECT command FROM cron.job WHERE jobname='schedule-confirmation-monitor') = 'SELECT marshmallow_private.cron_guarded_schedule_monitor()'
  AND (SELECT schedule FROM cron.job WHERE jobname='urgent-ai-status-refresh') = '*/30 * * * *'
  AND (SELECT command FROM cron.job WHERE jobname='load-governor-sample') = 'SELECT marshmallow_private.sample_load()'
  AND (SELECT command FROM cron.job WHERE jobname='notifications-retention') = 'SELECT marshmallow_private.purge_old_notifications(30)', '';
-- privileges: signed-in users cannot read samples or call the sensor
INSERT INTO public.results(check_name, ok, detail)
SELECT 'authenticated cannot read governor tables or run sampler',
  NOT has_table_privilege('authenticated','marshmallow_private.load_samples','select')
  AND NOT has_table_privilege('authenticated','marshmallow_private.load_policy','select')
  AND NOT has_function_privilege('authenticated','marshmallow_private.sample_load()','execute')
  AND NOT has_function_privilege('anon','marshmallow_private.caller_role()','execute')
  AND has_function_privilege('authenticated','marshmallow_private.caller_role()','execute'), '';

\unset QUIET
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, check_name, detail FROM public.results ORDER BY n;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.results WHERE NOT ok) THEN RAISE EXCEPTION 'harness 171: % check(s) FAILED', (SELECT count(*) FROM public.results WHERE NOT ok); END IF;
END $$;
