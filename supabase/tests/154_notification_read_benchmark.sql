-- ISOLATED SYNTHETIC BENCHMARK ONLY. Requires the disposable runner's previous
-- RPC copy. Never run on production. Same data/connection/role for both versions.
-- 16,000 legacy rows (15% unread), 20 workflow events; median of seven warm runs.
BEGIN;
INSERT INTO auth.users(id,email) VALUES('15400000-0000-4000-8000-000000000001','benchmark@example.invalid');
INSERT INTO public.profiles(id,full_name) VALUES('15400000-0000-4000-8000-000000000001','Synthetic Admin');
INSERT INTO public.user_roles(user_id,role) VALUES('15400000-0000-4000-8000-000000000001','admin');
INSERT INTO public.leads(id,job_id,customer_name,status) VALUES('15400000-0000-4000-8000-000000000010','BENCH-1','Synthetic job','urgent_job');
-- Mirror the relevant production indexes; these are fixture-only, not migration DDL.
CREATE INDEX IF NOT EXISTS fixture_notification_user_read ON public.notifications(user_id,read,created_at DESC);
CREATE INDEX IF NOT EXISTS fixture_notification_user ON public.notifications(user_id);
INSERT INTO public.notifications(user_id,title,message,read,created_at)
  SELECT '15400000-0000-4000-8000-000000000001','History '||n,'Synthetic legacy message',n%20>=3,now()-interval '2 days'
  FROM generate_series(1,16000) n;
SELECT marshmallow_private.workflow_notify(ARRAY['15400000-0000-4000-8000-000000000001'::uuid],
  'schedule_ready','Synthetic confirmation','Synthetic event','15400000-0000-4000-8000-000000000010','BENCH-1',NULL,NULL,n)
  FROM generate_series(1,20) n;
ANALYZE public.notifications;
ANALYZE public.workflow_notification_events;
ANALYZE public.user_roles;
CREATE TEMP TABLE timings(workload text,version text,elapsed_ms numeric,identical boolean);
GRANT ALL ON timings TO authenticated;
SELECT set_config('request.jwt.claim.sub','15400000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE p jsonb; i integer; started timestamptz; old jsonb; new jsonb;
BEGIN
  FOREACH p IN ARRAY ARRAY[
    '{"action":"list"}'::jsonb,
    '{"action":"list","view":"unread"}'::jsonb,
    '{"action":"list","view":"action"}'::jsonb,
    '{"action":"list","search":"History 999"}'::jsonb,
    jsonb_build_object('action','list','since',now()-interval '1 day'),
    jsonb_build_object('action','alerts','after',now()-interval '15 seconds'),
    jsonb_build_object('action','alerts','after',now()+interval '1 second')
  ] LOOP
    -- First execution warms the function's plans/cache and is not timed.
    PERFORM public.workflow_notifications_before(p);
    PERFORM public.workflow_notifications(p);
    FOR i IN 1..7 LOOP
      -- Alternate order to avoid always giving either implementation a warm edge.
      IF i%2=1 THEN
        started:=clock_timestamp(); old:=public.workflow_notifications_before(p);
        INSERT INTO timings VALUES(p::text,'before',extract(epoch FROM clock_timestamp()-started)*1000,true);
        started:=clock_timestamp(); new:=public.workflow_notifications(p);
        INSERT INTO timings VALUES(p::text,'after',extract(epoch FROM clock_timestamp()-started)*1000,old=new);
      ELSE
        started:=clock_timestamp(); new:=public.workflow_notifications(p);
        INSERT INTO timings VALUES(p::text,'after',extract(epoch FROM clock_timestamp()-started)*1000,true);
        started:=clock_timestamp(); old:=public.workflow_notifications_before(p);
        INSERT INTO timings VALUES(p::text,'before',extract(epoch FROM clock_timestamp()-started)*1000,old=new);
      END IF;
    END LOOP;
  END LOOP;
END $$;
RESET ROLE;
SELECT workload,
  round((percentile_cont(0.5) WITHIN GROUP(ORDER BY elapsed_ms) FILTER(WHERE version='before'))::numeric,2) AS before_ms,
  round((percentile_cont(0.5) WITHIN GROUP(ORDER BY elapsed_ms) FILTER(WHERE version='after'))::numeric,2) AS after_ms,
  bool_and(identical) AS identical
FROM timings GROUP BY workload ORDER BY workload;
ROLLBACK;
