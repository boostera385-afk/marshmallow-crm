-- =============================================================================
-- Migration : 20261210050000_system_health_cpu_carry_forward.sql
-- Purpose   : Overload alert: keep CPU / IO wait readings on minutes when the
--             Metrics API has not refreshed.
--
-- DEFECT (production, 2026-11-10, first hour after 20261210040000)
--   Supabase's Metrics API refreshes less often than once a minute. On about
--   half the minutes (15 of 34) the CPU counters were unchanged, so
--   record_system_health() had no CPU busy / IO wait reading for that minute.
--   A real CPU or IO wait problem needs 3 minutes in a row to warn, so these
--   empty minutes could delay the warning. Memory, swap and disk were not
--   affected (they are plain gauges).
--
-- FIX
--   When the counters are exactly unchanged and are less than 3 minutes old,
--   reuse the last CPU / IO wait reading. Unchanged counters no longer refresh
--   their timestamp, so a feed that stays stuck stops being carried after
--   3 minutes (the reading goes back to "none"). Everything else is unchanged.
--
-- APPLY: SQL Editor as postgres, after 20261210040000. Idempotent.
--        Harness: supabase/tests/172_system_health_isolated.sql.
-- ROLLBACK: re-run the record_system_health definition from
--           20261210040000_system_health_alerts.sql.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.record_system_health(p_sample jsonb, p_options jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p marshmallow_private.health_policy%ROWTYPE;
  st marshmallow_private.health_state%ROWTYPE;
  v_now timestamptz := now();
  v_ok boolean := coalesce((p_sample ->> 'metrics_ok')::boolean, false);
  v_mem numeric := (p_sample ->> 'mem_available_pct')::numeric;
  v_swap numeric := (p_sample ->> 'swap_used_pct')::numeric;
  v_disk numeric := (p_sample ->> 'disk_used_pct')::numeric;
  v_tot double precision := (p_sample ->> 'cpu_total_seconds')::double precision;
  v_idle double precision := (p_sample ->> 'cpu_idle_seconds')::double precision;
  v_iow double precision := (p_sample ->> 'cpu_iowait_seconds')::double precision;
  v_cpu numeric;
  v_io numeric;
  v_swap_prev numeric;
  v_gov text;
  v_db_busy numeric;
  v_conn numeric;
  v_rank smallint := 0;
  v_reasons text[] := '{}';
  v_esc smallint := 0;
  v_new smallint;
  v_cnt integer;
  v_max smallint;
  v_dry boolean := coalesce((p_options ->> 'dry_run')::boolean, false);
  v_test text := p_options ->> 'test_level';
  v_reminder boolean := false;
  v_notify boolean := false;
  v_title text;
  v_message text;
  v_top text;
  v_email jsonb;
  v_since text;
  v_names text[] := ARRAY['normal', 'warning', 'critical'];
BEGIN
  SELECT * INTO p FROM marshmallow_private.health_policy WHERE id;
  SELECT * INTO st FROM marshmallow_private.health_state WHERE id FOR UPDATE;

  -- CPU busy % and IO wait % from the counters since the previous minute. A
  -- counter reset (host restart) or a gap over 10 minutes gives no reading.
  IF v_ok AND v_tot IS NOT NULL AND st.cpu_total IS NOT NULL AND v_tot > st.cpu_total
     AND v_idle >= st.cpu_idle AND v_iow >= st.cpu_iowait AND v_now - st.counters_at < interval '10 minutes' THEN
    v_io := round((100 * (v_iow - st.cpu_iowait) / (v_tot - st.cpu_total))::numeric, 1);
    v_cpu := round((100 * (1 - ((v_idle - st.cpu_idle) + (v_iow - st.cpu_iowait)) / (v_tot - st.cpu_total)))::numeric, 1);
  ELSIF v_ok AND v_tot IS NOT NULL AND v_tot = st.cpu_total AND v_now - st.counters_at < interval '3 minutes' THEN
    -- The Metrics API had not refreshed since last minute: keep the last
    -- reading so a CPU / IO wait streak is not broken by an empty minute.
    SELECT h.cpu_busy_pct, h.iowait_pct INTO v_cpu, v_io
      FROM marshmallow_private.health_samples h
     WHERE h.sampled_at > v_now - interval '3 minutes' AND h.cpu_busy_pct IS NOT NULL
     ORDER BY h.sampled_at DESC LIMIT 1;
  END IF;
  -- Unchanged counters keep their timestamp, so a stuck feed stops being
  -- carried forward after 3 minutes; anything else (new or reset) re-baselines.
  IF v_ok AND v_tot IS NOT NULL AND v_tot IS DISTINCT FROM st.cpu_total THEN
    UPDATE marshmallow_private.health_state
       SET cpu_total = v_tot, cpu_idle = v_idle, cpu_iowait = v_iow, counters_at = v_now
     WHERE id;
  END IF;

  -- The load governor's view of the database (busy time, connections).
  SELECT CASE WHEN ls.sampled_at > v_now - interval '10 minutes' THEN ls.level ELSE 'normal' END
    INTO v_gov FROM marshmallow_private.load_state ls WHERE ls.id;
  SELECT s.busy_pct, round(100.0 * s.total_connections / nullif(s.max_connections, 0), 1)
    INTO v_db_busy, v_conn
    FROM marshmallow_private.load_samples s
   WHERE s.sampled_at > v_now - interval '5 minutes'
   ORDER BY s.sampled_at DESC LIMIT 1;

  SELECT h.swap_used_pct INTO v_swap_prev
    FROM marshmallow_private.health_samples h
   WHERE h.sampled_at <= v_now - interval '9 minutes' AND h.sampled_at > v_now - interval '15 minutes'
     AND h.swap_used_pct IS NOT NULL
   ORDER BY h.sampled_at DESC LIMIT 1;

  -- Each signal on its own; the minute's level is the worst of them.
  IF v_mem IS NOT NULL AND v_mem <= p.mem_available_crit_pct THEN
    v_rank := 2; v_reasons := v_reasons || format('memory %s%% free (critical below %s%%)', v_mem, p.mem_available_crit_pct);
  ELSIF v_mem IS NOT NULL AND v_mem <= p.mem_available_warn_pct THEN
    v_rank := greatest(v_rank, 1); v_reasons := v_reasons || format('memory %s%% free (warning below %s%%)', v_mem, p.mem_available_warn_pct);
  END IF;
  IF v_swap IS NOT NULL AND v_swap >= p.swap_crit_pct THEN
    v_rank := 2; v_reasons := v_reasons || format('swap %s%% of RAM (critical above %s%%)', v_swap, p.swap_crit_pct);
  ELSIF v_swap IS NOT NULL AND v_swap >= p.swap_warn_pct AND v_swap_prev IS NOT NULL AND v_swap - v_swap_prev >= p.swap_rise_points THEN
    v_rank := greatest(v_rank, 1); v_reasons := v_reasons || format('swap %s%% of RAM and rising (was %s%% 10 min ago)', v_swap, v_swap_prev);
  END IF;
  IF v_io IS NOT NULL AND v_io >= p.iowait_crit_pct THEN
    v_rank := 2; v_reasons := v_reasons || format('disk wait (IO wait) %s%% (critical above %s%%)', v_io, p.iowait_crit_pct);
  ELSIF v_io IS NOT NULL AND v_io >= p.iowait_warn_pct THEN
    v_rank := greatest(v_rank, 1); v_reasons := v_reasons || format('disk wait (IO wait) %s%% (warning above %s%%)', v_io, p.iowait_warn_pct);
  END IF;
  IF v_cpu IS NOT NULL AND v_cpu >= p.cpu_crit_pct THEN
    v_rank := 2; v_reasons := v_reasons || format('CPU %s%% (critical above %s%%)', v_cpu, p.cpu_crit_pct);
  ELSIF v_cpu IS NOT NULL AND v_cpu >= p.cpu_warn_pct THEN
    v_rank := greatest(v_rank, 1); v_reasons := v_reasons || format('CPU %s%% (warning above %s%%)', v_cpu, p.cpu_warn_pct);
  END IF;
  IF v_conn IS NOT NULL AND v_conn >= p.conn_crit_pct THEN
    v_rank := 2; v_reasons := v_reasons || format('database connections %s%% of the limit', v_conn);
  ELSIF v_conn IS NOT NULL AND v_conn >= p.conn_warn_pct THEN
    v_rank := greatest(v_rank, 1); v_reasons := v_reasons || format('database connections %s%% of the limit', v_conn);
  END IF;
  IF v_disk IS NOT NULL AND v_disk >= p.disk_crit_pct THEN
    v_rank := 2; v_reasons := v_reasons || format('disk %s%% full', v_disk);
  ELSIF v_disk IS NOT NULL AND v_disk >= p.disk_warn_pct THEN
    v_rank := greatest(v_rank, 1); v_reasons := v_reasons || format('disk %s%% full', v_disk);
  END IF;
  IF v_gov = 'critical' THEN
    v_rank := 2; v_reasons := v_reasons || format('database busy %s%% (load governor: critical)', coalesce(v_db_busy::text, '?'));
  ELSIF v_gov = 'elevated' THEN
    v_rank := greatest(v_rank, 1); v_reasons := v_reasons || format('database busy %s%% (load governor: elevated)', coalesce(v_db_busy::text, '?'));
  END IF;

  INSERT INTO marshmallow_private.health_samples AS h
    (sampled_at, metrics_ok, mem_available_pct, swap_used_pct, cpu_busy_pct, iowait_pct, disk_used_pct,
     db_busy_pct, db_level, conn_pct, instant_rank, reasons)
  VALUES (v_now, v_ok, v_mem, v_swap, v_cpu, v_io, v_disk, v_db_busy, v_gov, v_conn, v_rank, v_reasons)
  ON CONFLICT (sampled_at) DO NOTHING;

  -- Persistence: escalate only after the signal held for N minutes in a row.
  SELECT count(*) FILTER (WHERE r >= 2) INTO v_cnt FROM (
    SELECT h.instant_rank r FROM marshmallow_private.health_samples h
     WHERE h.sampled_at > v_now - make_interval(mins => p.crit_minutes, secs => 50)
     ORDER BY h.sampled_at DESC LIMIT p.crit_minutes) x;
  IF v_cnt >= p.crit_minutes THEN
    v_esc := 2;
  ELSE
    SELECT count(*) FILTER (WHERE r >= 1) INTO v_cnt FROM (
      SELECT h.instant_rank r FROM marshmallow_private.health_samples h
       WHERE h.sampled_at > v_now - make_interval(mins => p.warn_minutes, secs => 50)
       ORDER BY h.sampled_at DESC LIMIT p.warn_minutes) x;
    IF v_cnt >= p.warn_minutes THEN v_esc := 1; END IF;
  END IF;

  IF v_esc >= st.level_rank THEN
    v_new := v_esc;
  ELSE
    -- Step down only after clear_minutes below the current level, and never
    -- while the host metrics are unavailable.
    SELECT count(*), max(h.instant_rank) INTO v_cnt, v_max
      FROM marshmallow_private.health_samples h
     WHERE h.sampled_at > v_now - make_interval(mins => p.clear_minutes, secs => 50);
    IF v_ok AND v_cnt >= p.clear_minutes AND v_max < st.level_rank THEN
      v_new := greatest(v_esc, v_max);
    ELSE
      v_new := st.level_rank;
    END IF;
  END IF;

  -- Who has the most live connections (each open CRM tab subscribes several times).
  BEGIN
    SELECT string_agg(format('%s %s', coalesce(nullif(pr.full_name, ''), 'Unknown user'), s.c), ', ' ORDER BY s.c DESC)
      INTO v_top
      FROM (SELECT (rs.claims ->> 'sub')::uuid AS uid, count(*) AS c
              FROM realtime.subscription rs
             WHERE rs.claims ->> 'sub' IS NOT NULL
             GROUP BY 1 ORDER BY 2 DESC LIMIT 3) s
      LEFT JOIN public.profiles pr ON pr.id = s.uid;
  EXCEPTION WHEN OTHERS THEN
    v_top := NULL;
  END;

  -- A forced test alert: labelled, sent to Admins (and email), state unchanged.
  IF v_test IN ('warning', 'critical') THEN
    v_title := format('[Test] Database load %s (test only, nothing is wrong)', v_test);
    v_message := format('This is a test of the overload alert. Current readings: memory %s%% free, swap %s%% of RAM, CPU %s%%, IO wait %s%%, disk %s%% full, database busy %s%%.',
      coalesce(v_mem::text, '?'), coalesce(v_swap::text, '?'), coalesce(v_cpu::text, '?'), coalesce(v_io::text, '?'),
      coalesce(v_disk::text, '?'), coalesce(v_db_busy::text, '?'))
      || CASE WHEN v_top IS NOT NULL THEN format(' Most live connections: %s.', v_top) ELSE '' END;
    PERFORM marshmallow_private.notify_admins_system_health(v_title, v_message, false);
    RETURN jsonb_build_object('level', v_names[st.level_rank + 1], 'test', true, 'notified', true,
      'email', jsonb_build_object('subject', '[Marshmallow] ' || v_title, 'text', v_message));
  END IF;

  IF NOT coalesce(p.enabled, true) OR v_dry THEN
    RETURN jsonb_build_object('level', v_names[st.level_rank + 1], 'computed_level', v_names[v_new + 1],
      'instant_level', v_names[v_rank + 1], 'reasons', to_jsonb(v_reasons), 'dry_run', v_dry, 'enabled', p.enabled,
      'readings', jsonb_build_object('mem_available_pct', v_mem, 'swap_used_pct', v_swap, 'cpu_busy_pct', v_cpu,
        'iowait_pct', v_io, 'disk_used_pct', v_disk, 'db_busy_pct', v_db_busy, 'conn_pct', v_conn, 'db_level', v_gov),
      'metrics_ok', v_ok, 'top_connections', v_top, 'notified', false);
  END IF;

  v_reminder := v_new = st.level_rank AND v_new > 0 AND (st.last_notified_at IS NULL OR st.last_notified_at <
    v_now - make_interval(mins => CASE WHEN v_new = 2 THEN p.crit_remind_minutes ELSE p.warn_remind_minutes END));
  v_notify := v_new <> st.level_rank OR v_reminder;

  IF v_notify THEN
    v_since := to_char(st.changed_at AT TIME ZONE 'UTC', 'HH24:MI') || ' UTC';
    IF v_new = 0 THEN
      v_title := 'Database load back to normal';
      v_message := format('All readings have been below warning levels for %s minutes (the alert started at %s). Nothing else to do.',
        p.clear_minutes, v_since);
    ELSE
      v_title := '[Alert] ' || CASE WHEN v_reminder THEN 'Database load still ' || v_names[v_new + 1]
                                    WHEN v_new = 2 THEN 'Database overload critical'
                                    ELSE 'Database load warning' END
                 || ': ' || coalesce(array_to_string(v_reasons[1:2], '; '), 'see details');
      v_message := 'What is high: ' || coalesce(nullif(array_to_string(v_reasons, '; '), ''), 'readings are easing but not yet clear') || '.'
        || CASE WHEN v_top IS NOT NULL THEN format(E'\nMost live connections (more = more open tabs): %s.', v_top) ELSE '' END
        || CASE WHEN v_reminder THEN format(E'\nThis has lasted since %s.', v_since) ELSE '' END
        || E'\nWhat to do now:'
        || E'\n1) Ask the users above to close extra CRM tabs, then check again in 2 minutes.'
        || E'\n2) Avoid exports, bulk syncs and the Supabase dashboard''s Query Performance page.'
        || E'\n3) If Quo webhooks are piling up, pause Quo ingestion.'
        || CASE WHEN v_new = 2 THEN E'\n4) If it does not ease within 10 minutes, upgrade compute (Supabase > Settings > Compute).'
                ELSE E'\n4) If it turns critical or lasts 30 minutes, upgrade compute (Supabase > Settings > Compute).' END;
    END IF;
    PERFORM marshmallow_private.notify_admins_system_health(v_title, v_message, true);
    v_email := jsonb_build_object('subject', '[Marshmallow] ' || v_title, 'text', v_message);
    UPDATE marshmallow_private.health_state
       SET level_rank = v_new,
           changed_at = CASE WHEN v_new <> st.level_rank THEN v_now ELSE changed_at END,
           last_notified_at = CASE WHEN v_new = 0 THEN NULL ELSE v_now END
     WHERE id;
  END IF;

  -- Host metrics unreadable: say so once a day (it is not "all fine").
  IF NOT v_ok AND (st.last_unavailable_notice_at IS NULL OR st.last_unavailable_notice_at < v_now - interval '1 day') THEN
    PERFORM marshmallow_private.notify_admins_system_health(
      'Overload alert cannot read memory metrics',
      format('The overload alert could not read memory, swap, CPU and IO from Supabase (%s). It still watches database load and connections. Check the system-health-watch function.',
        left(coalesce(p_sample ->> 'metrics_error', 'unknown error'), 200)),
      false);
    UPDATE marshmallow_private.health_state SET last_unavailable_notice_at = v_now WHERE id;
  END IF;

  -- An alert was raised but email is not set up: say so once a day.
  IF v_notify AND v_new > 0 AND coalesce((p_sample ->> 'email_configured')::boolean, false) = false
     AND (st.last_email_missing_notice_at IS NULL OR st.last_email_missing_notice_at < v_now - interval '1 day') THEN
    PERFORM marshmallow_private.notify_admins_system_health(
      'Overload alert email is not set up',
      'This alert was shown in the CRM only. To also get it by email, add the RESEND_API_KEY and HEALTH_ALERT_EMAILS Edge Function secrets.',
      false);
    UPDATE marshmallow_private.health_state SET last_email_missing_notice_at = v_now WHERE id;
  END IF;

  -- Keep keep_days of samples (checked once an hour).
  IF extract(minute FROM v_now) = 0 THEN
    DELETE FROM marshmallow_private.health_samples WHERE sampled_at < v_now - make_interval(days => p.keep_days);
  END IF;

  RETURN jsonb_build_object(
    'level', v_names[v_new + 1], 'previous_level', v_names[st.level_rank + 1], 'instant_level', v_names[v_rank + 1],
    'changed', v_new <> st.level_rank, 'reminder', v_reminder, 'notified', v_notify,
    'reasons', to_jsonb(v_reasons), 'metrics_ok', v_ok,
    'readings', jsonb_build_object('mem_available_pct', v_mem, 'swap_used_pct', v_swap, 'cpu_busy_pct', v_cpu,
      'iowait_pct', v_io, 'disk_used_pct', v_disk, 'db_busy_pct', v_db_busy, 'conn_pct', v_conn, 'db_level', v_gov),
    'email', v_email);
END $$;
REVOKE ALL ON FUNCTION public.record_system_health(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_system_health(jsonb, jsonb) TO service_role;

COMMIT;
