-- =============================================================================
-- Isolated harness: overload early-warning alert (20261210040000)
--
-- Runs ONLY on a throwaway local PostgreSQL (16+). Never on the shared project:
-- it creates stand-in Supabase schemas, synthetic users and synthetic samples.
--
--   createdb mtest
--   psql -v ON_ERROR_STOP=1 -d mtest -f supabase/tests/172_system_health_isolated.sql
--   dropdb mtest
--
-- What it proves: warning / critical / back-to-normal with their persistence
-- windows, step-down, reminders, no repeats, CPU and IO wait from counters
-- (and counter resets), swap "rising", the load governor signal, "metrics
-- unavailable" never reads as fine, the once-a-day notices, test and dry-run
-- modes, the disable switch, Admin-only recipients, the top-connections line,
-- privileges and the cron job.
-- Ends with a PASS/FAIL grid and raises an error if anything failed.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\ir local/supabase_stubs.sql
\ir ../migrations/20261210010000_load_governor.sql

-- Extra stand-ins this migration touches. Synthetic only.
CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL, message text NOT NULL,
  kind text, lead_id uuid, read boolean NOT NULL DEFAULT false, resolved_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE realtime.subscription (id bigserial, claims jsonb);
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
CREATE TABLE public.quo_ai_settings (key text, value jsonb);
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE net.calls (url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (url, body) RETURNING 1::bigint $$;

\ir ../migrations/20261210040000_system_health_alerts.sql
\ir ../migrations/20261210050000_system_health_cpu_carry_forward.sql

CREATE TABLE public.results (n serial, check_name text, ok boolean, detail text);
CREATE TABLE public.t_last (r jsonb);

-- Synthetic people: two Admins, a CS user and a Processor.
INSERT INTO public.user_roles VALUES
 ('00000000-0000-4000-8000-0000000000a1','admin'),('00000000-0000-4000-8000-0000000000a9','admin'),
 ('00000000-0000-4000-8000-0000000000a5','customer_service'),('00000000-0000-4000-8000-0000000000a2','processor');
INSERT INTO public.profiles VALUES ('00000000-0000-4000-8000-0000000000a5', 'Synthetic Ali');

CREATE FUNCTION public.t_reset() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  DELETE FROM marshmallow_private.health_samples; DELETE FROM public.notifications; DELETE FROM public.t_last;
  DELETE FROM realtime.subscription; DELETE FROM marshmallow_private.load_samples;
  UPDATE marshmallow_private.health_policy SET enabled = true;
  UPDATE marshmallow_private.health_state SET level_rank = 0, changed_at = now(), last_notified_at = NULL,
    cpu_total = NULL, cpu_idle = NULL, cpu_iowait = NULL, counters_at = NULL,
    last_unavailable_notice_at = NULL, last_email_missing_notice_at = NULL;
  UPDATE marshmallow_private.load_state SET level = 'normal', sampled_at = now();
END $$;
-- Past minutes with the given levels, oldest first, ending one minute ago.
CREATE FUNCTION public.t_hist(p_ranks int[], p_swap numeric DEFAULT 5) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n int := cardinality(p_ranks); BEGIN
  FOR i IN 1..n LOOP
    INSERT INTO marshmallow_private.health_samples (sampled_at, metrics_ok, swap_used_pct, instant_rank)
    VALUES (now() - make_interval(mins => n - i + 1), true, p_swap, p_ranks[i]);
  END LOOP;
END $$;
CREATE FUNCTION public.t_s(p_mem numeric, p_swap numeric DEFAULT 5, p_disk numeric DEFAULT 20, p_ok boolean DEFAULT true, p_email boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT CASE WHEN p_ok THEN jsonb_build_object('metrics_ok', true, 'email_configured', p_email,
    'mem_available_pct', p_mem, 'swap_used_pct', p_swap, 'disk_used_pct', p_disk)
  ELSE jsonb_build_object('metrics_ok', false, 'metrics_error', 'Metrics API HTTP 401', 'email_configured', p_email) END $$;
CREATE FUNCTION public.t_call(p_sample jsonb, p_options jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  DELETE FROM public.t_last; INSERT INTO public.t_last SELECT public.record_system_health(p_sample, p_options);
END $$;
CREATE FUNCTION public.t_check(p_name text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.results (check_name, ok, detail) VALUES (p_name, coalesce(p_ok, false), p_detail) $$;
CREATE VIEW public.t_r AS SELECT r FROM public.t_last;
CREATE VIEW public.t_unread AS SELECT * FROM public.notifications WHERE kind = 'system_health' AND NOT read;

-- 1. A normal minute -------------------------------------------------------------
SELECT public.t_reset();
SELECT public.t_call(public.t_s(60));
SELECT public.t_check('normal minute: level normal, nobody notified',
  (SELECT r->>'level' = 'normal' AND NOT (r->>'notified')::boolean FROM public.t_r) AND NOT EXISTS (SELECT 1 FROM public.notifications));

-- 2. Warning needs 3 minutes in a row ----------------------------------------------
SELECT public.t_reset(); SELECT public.t_hist(ARRAY[0,1]);
SELECT public.t_call(public.t_s(15));
SELECT public.t_check('2 warning minutes: not yet', (SELECT r->>'level' = 'normal' AND r->>'instant_level' = 'warning' FROM public.t_r));
SELECT public.t_reset(); SELECT public.t_hist(ARRAY[1,1]);
SELECT public.t_call(public.t_s(15));
SELECT public.t_check('3 warning minutes: warning, notified, email returned',
  (SELECT r->>'level' = 'warning' AND (r->>'changed')::boolean AND r->'email'->>'subject' LIKE '[Marshmallow] [Alert] Database load warning: memory 15% free%' FROM public.t_r),
  (SELECT r->'email'->>'subject' FROM public.t_r));
SELECT public.t_check('warning goes to the two Admins only',
  (SELECT count(*) = 2 AND bool_and(user_id IN ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a9')) FROM public.t_unread));
SELECT public.t_check('message says what to do',
  (SELECT bool_and(message LIKE '%What is high: memory 15% free%' AND message LIKE '%close extra CRM tabs%' AND message LIKE '%upgrade compute%') FROM public.t_unread));

-- 3. Escalate to critical (2 minutes), older alert replaced ----------------------------
DELETE FROM marshmallow_private.health_samples; SELECT public.t_hist(ARRAY[1,1,2]);
SELECT public.t_call(public.t_s(8));
SELECT public.t_check('2 critical minutes: critical',
  (SELECT r->>'level' = 'critical' AND r->>'previous_level' = 'warning' FROM public.t_r));
SELECT public.t_check('only the latest alert stays unread',
  (SELECT count(*) = 2 AND bool_and(title LIKE '[Alert] Database overload critical: memory 8% free%') FROM public.t_unread)
  AND (SELECT count(*) = 2 FROM public.notifications WHERE read AND resolved_at IS NOT NULL));

-- 4. No repeat, then a reminder after 30 minutes -------------------------------------
SELECT public.t_call(public.t_s(8));
SELECT public.t_check('still critical next minute: no repeat', (SELECT r->>'level' = 'critical' AND NOT (r->>'notified')::boolean AND r->'email' = 'null'::jsonb FROM public.t_r));
UPDATE marshmallow_private.health_state SET last_notified_at = now() - interval '31 minutes', changed_at = now() - interval '40 minutes';
SELECT public.t_call(public.t_s(8));
SELECT public.t_check('reminder after 30 minutes',
  (SELECT (r->>'reminder')::boolean AND r->'email'->>'subject' LIKE '%Database load still critical%' FROM public.t_r)
  AND (SELECT bool_and(message LIKE '%This has lasted since%') FROM public.t_unread));

-- 5. Stepping down needs 10 calm minutes -----------------------------------------------
DELETE FROM marshmallow_private.health_samples; SELECT public.t_hist(ARRAY[0,0,0]);
SELECT public.t_call(public.t_s(60));
SELECT public.t_check('3 calm minutes: stays critical', (SELECT r->>'level' = 'critical' FROM public.t_r));
DELETE FROM marshmallow_private.health_samples; SELECT public.t_hist(ARRAY[0,0,0,0,0,0,0,0,0,0]);
SELECT public.t_call(public.t_s(60));
SELECT public.t_check('10 calm minutes: back to normal, Admins told',
  (SELECT r->>'level' = 'normal' AND r->'email'->>'subject' = '[Marshmallow] Database load back to normal' FROM public.t_r)
  AND (SELECT count(*) = 2 AND bool_and(title = 'Database load back to normal') FROM public.t_unread));

SELECT public.t_reset(); UPDATE marshmallow_private.health_state SET level_rank = 2;
SELECT public.t_hist(ARRAY[1,1,1,1,1,1,1,1,1,1]);
SELECT public.t_call(public.t_s(15));
SELECT public.t_check('critical -> warning when it eases but is not clear', (SELECT r->>'level' = 'warning' FROM public.t_r));

-- 6. Metrics unavailable is never "fine" ---------------------------------------------
SELECT public.t_reset(); UPDATE marshmallow_private.health_state SET level_rank = 1;
SELECT public.t_hist(ARRAY[0,0,0,0,0,0,0,0,0,0]);
SELECT public.t_call(public.t_s(NULL, p_ok => false));
SELECT public.t_check('unavailable: level does not step down', (SELECT r->>'level' = 'warning' AND NOT (r->>'metrics_ok')::boolean FROM public.t_r));
SELECT public.t_check('unavailable: one notice to Admins with the reason',
  (SELECT count(*) = 2 AND bool_and(message LIKE '%Metrics API HTTP 401%') FROM public.notifications WHERE title = 'Overload alert cannot read memory metrics'));
SELECT public.t_call(public.t_s(NULL, p_ok => false));
SELECT public.t_check('unavailable: not repeated within a day',
  (SELECT count(*) = 2 FROM public.notifications WHERE title = 'Overload alert cannot read memory metrics'));

-- 7. CPU and IO wait from counters ------------------------------------------------------
SELECT public.t_reset();
UPDATE marshmallow_private.health_state SET cpu_total = 1000, cpu_idle = 900, cpu_iowait = 0, counters_at = now() - interval '1 minute';
SELECT public.t_call(public.t_s(60) || '{"cpu_total_seconds": 1100, "cpu_idle_seconds": 905, "cpu_iowait_seconds": 45}');
SELECT public.t_check('IO wait 45% and CPU 50% from counter deltas',
  (SELECT (r->'readings'->>'iowait_pct')::numeric = 45 AND (r->'readings'->>'cpu_busy_pct')::numeric = 50
      AND r->>'instant_level' = 'critical' AND r->'reasons'->>0 LIKE 'disk wait (IO wait) 45%' FROM public.t_r),
  (SELECT r->>'readings' FROM public.t_r));
SELECT public.t_check('counters saved for the next minute',
  (SELECT cpu_total = 1100 AND cpu_idle = 905 AND cpu_iowait = 45 FROM marshmallow_private.health_state));
UPDATE marshmallow_private.health_state SET counters_at = now() - interval '1 minute';
SELECT public.t_call(public.t_s(60) || '{"cpu_total_seconds": 10, "cpu_idle_seconds": 9, "cpu_iowait_seconds": 0}');
SELECT public.t_check('counter reset (host restart): no CPU reading, no false alarm',
  (SELECT r->'readings'->'cpu_busy_pct' = 'null'::jsonb AND r->>'instant_level' = 'normal' FROM public.t_r));

SELECT public.t_reset();
UPDATE marshmallow_private.health_state SET cpu_total = 1100, cpu_idle = 905, cpu_iowait = 45, counters_at = now() - interval '1 minute';
INSERT INTO marshmallow_private.health_samples (sampled_at, metrics_ok, cpu_busy_pct, iowait_pct, instant_rank) VALUES (now() - interval '1 minute', true, 50, 45, 2);
SELECT public.t_call(public.t_s(60) || '{"cpu_total_seconds": 1100, "cpu_idle_seconds": 905, "cpu_iowait_seconds": 45}');
SELECT public.t_check('feed not refreshed: last CPU / IO wait reading carried, streak kept',
  (SELECT (r->'readings'->>'iowait_pct')::numeric = 45 AND (r->'readings'->>'cpu_busy_pct')::numeric = 50 AND r->>'instant_level' = 'critical' FROM public.t_r)
  AND (SELECT counters_at < now() - interval '50 seconds' FROM marshmallow_private.health_state));
UPDATE marshmallow_private.health_state SET counters_at = now() - interval '4 minutes';
SELECT public.t_call(public.t_s(60) || '{"cpu_total_seconds": 1100, "cpu_idle_seconds": 905, "cpu_iowait_seconds": 45}');
SELECT public.t_check('feed stuck over 3 minutes: no stale CPU reading',
  (SELECT r->'readings'->'cpu_busy_pct' = 'null'::jsonb AND r->>'instant_level' = 'normal' FROM public.t_r));

-- 8. Swap only warns while rising --------------------------------------------------------
SELECT public.t_reset();
INSERT INTO marshmallow_private.health_samples (sampled_at, metrics_ok, swap_used_pct, instant_rank) VALUES (now() - interval '10 minutes', true, 20, 0);
SELECT public.t_call(public.t_s(60, 30));
SELECT public.t_check('swap 30% and rising from 20%: warning signal',
  (SELECT r->>'instant_level' = 'warning' AND r->'reasons'->>0 = 'swap 30% of RAM and rising (was 20% 10 min ago)' FROM public.t_r));
SELECT public.t_reset();
INSERT INTO marshmallow_private.health_samples (sampled_at, metrics_ok, swap_used_pct, instant_rank) VALUES (now() - interval '10 minutes', true, 30, 0);
SELECT public.t_call(public.t_s(60, 30));
SELECT public.t_check('swap 30% but steady: no signal', (SELECT r->>'instant_level' = 'normal' FROM public.t_r));
SELECT public.t_call(public.t_s(60, 65));
SELECT public.t_check('swap 65% of RAM: critical signal', (SELECT r->>'instant_level' = 'critical' FROM public.t_r));

-- 9. Load governor, connections, disk ----------------------------------------------------
SELECT public.t_reset();
UPDATE marshmallow_private.load_state SET level = 'elevated', sampled_at = now();
INSERT INTO marshmallow_private.load_samples (sampled_at, total_exec_ms, busy_pct, active_connections, total_connections, max_connections, level)
VALUES (now() - interval '30 seconds', 0, 55, 10, 45, 60, 'elevated');
SELECT public.t_call(public.t_s(60, 5, 85));
SELECT public.t_check('governor elevated, connections 75%, disk 85%: warning signals',
  (SELECT r->>'instant_level' = 'warning' AND r->'reasons' @> '["database connections 75.0% of the limit", "disk 85% full", "database busy 55% (load governor: elevated)"]'::jsonb FROM public.t_r),
  (SELECT r->>'reasons' FROM public.t_r));
UPDATE marshmallow_private.load_state SET level = 'critical', sampled_at = now() - interval '11 minutes';
DELETE FROM marshmallow_private.load_samples;
SELECT public.t_call(public.t_s(60));
SELECT public.t_check('a stopped governor sensor is not read as critical', (SELECT r->>'instant_level' = 'normal' FROM public.t_r));

-- 10. Who to ask to close tabs; email-not-set-up notice -----------------------------------
SELECT public.t_reset(); SELECT public.t_hist(ARRAY[1,1]);
INSERT INTO realtime.subscription (claims) SELECT '{"sub":"00000000-0000-4000-8000-0000000000a5"}' FROM generate_series(1, 5);
INSERT INTO realtime.subscription (claims) SELECT '{"sub":"00000000-0000-4000-8000-0000000000a2"}' FROM generate_series(1, 2);
SELECT public.t_call(public.t_s(15, p_email => false));
SELECT public.t_check('alert names the users with the most live connections',
  (SELECT bool_and(message LIKE '%Most live connections (more = more open tabs): Synthetic Ali 5, Unknown user 2.%') FROM public.t_unread WHERE title LIKE '[Alert]%'));
SELECT public.t_check('email not set up: Admins told once',
  (SELECT count(*) = 2 FROM public.notifications WHERE title = 'Overload alert email is not set up'));

-- 11. Test, dry run, disabled -------------------------------------------------------------
SELECT public.t_reset();
SELECT public.t_call(public.t_s(60), '{"test_level": "critical"}');
SELECT public.t_check('test alert: labelled, sent, level unchanged',
  (SELECT (r->>'test')::boolean AND r->'email'->>'subject' LIKE '[Marshmallow] [Test] Database load critical%' FROM public.t_r)
  AND (SELECT count(*) = 2 FROM public.notifications WHERE title LIKE '[Test]%')
  AND (SELECT level_rank = 0 FROM marshmallow_private.health_state));
SELECT public.t_reset(); SELECT public.t_hist(ARRAY[1,1]);
SELECT public.t_call(public.t_s(15), '{"dry_run": true}');
SELECT public.t_check('dry run: computes warning, notifies nobody, keeps state',
  (SELECT r->>'computed_level' = 'warning' AND NOT (r->>'notified')::boolean FROM public.t_r)
  AND NOT EXISTS (SELECT 1 FROM public.notifications) AND (SELECT level_rank = 0 FROM marshmallow_private.health_state));
SELECT public.t_reset(); SELECT public.t_hist(ARRAY[1,1]); UPDATE marshmallow_private.health_policy SET enabled = false;
SELECT public.t_call(public.t_s(15));
SELECT public.t_check('disabled: records but notifies nobody',
  NOT EXISTS (SELECT 1 FROM public.notifications) AND (SELECT count(*) = 3 FROM marshmallow_private.health_samples));

-- 12. Privileges and schedule -------------------------------------------------------------
SELECT public.t_check('browsers cannot call record_system_health',
  NOT has_function_privilege('anon', 'public.record_system_health(jsonb, jsonb)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.record_system_health(jsonb, jsonb)', 'execute')
  AND has_function_privilege('service_role', 'public.record_system_health(jsonb, jsonb)', 'execute'));
SELECT public.t_check('browsers cannot read the health tables',
  NOT has_table_privilege('authenticated', 'marshmallow_private.health_samples', 'select')
  AND NOT has_table_privilege('authenticated', 'marshmallow_private.health_policy', 'select')
  AND NOT has_function_privilege('authenticated', 'marshmallow_private.notify_admins_system_health(text, text, boolean)', 'execute'));
SELECT public.t_check('runs every minute, not gated by the governor',
  (SELECT schedule = '* * * * *' AND command = 'SELECT marshmallow_private.cron_system_health_watch()' FROM cron.job WHERE jobname = 'system-health-watch'));
INSERT INTO vault.decrypted_secrets VALUES ('project_url', 'https://example.test/'), ('publishable_key', 'pk_synthetic');
INSERT INTO public.quo_ai_settings VALUES ('cron_secret', '"synthetic-secret"');
UPDATE marshmallow_private.load_state SET level = 'critical', sampled_at = now();
SELECT marshmallow_private.cron_system_health_watch();
SELECT public.t_check('cron calls the function even at critical load',
  (SELECT count(*) = 1 AND bool_and(url = 'https://example.test/functions/v1/system-health-watch') FROM net.calls));

-- Results -----------------------------------------------------------------------------------
\set QUIET 0
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, check_name, detail FROM public.results ORDER BY n;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.results WHERE NOT ok) THEN RAISE EXCEPTION 'harness 172: % check(s) FAILED', (SELECT count(*) FROM public.results WHERE NOT ok); END IF;
END $$;
