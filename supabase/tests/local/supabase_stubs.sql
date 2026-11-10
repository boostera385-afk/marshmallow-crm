-- Local stand-ins for the Supabase objects that migrations 20261210000000 and
-- 20261210010000 touch. For a throwaway local Postgres ONLY - never production.
-- Used by supabase/tests/171_leads_rls_and_load_governor_isolated.sql.
-- Local stand-ins for the Supabase pieces the two migrations touch. Synthetic only.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA cron; CREATE SCHEMA realtime; CREATE SCHEMA marshmallow_private;
GRANT USAGE ON SCHEMA public, auth, marshmallow_private TO authenticated, anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TYPE public.app_role AS ENUM ('admin','processor','opr','opr_admin','cs_admin','customer_service');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = _role::text) $$;
CREATE TABLE public.leads (id uuid PRIMARY KEY, status text, created_by uuid, assigned_cs uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.lead_shares (lead_id uuid, shared_with_user_id uuid);
CREATE FUNCTION public.leads_owned_by_caller(_lead public.leads) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT _lead.created_by = auth.uid() OR _lead.assigned_cs = auth.uid()
      OR EXISTS (SELECT 1 FROM public.lead_shares s WHERE s.lead_id = _lead.id AND s.shared_with_user_id = auth.uid()) $$;
CREATE TABLE marshmallow_private.paid_grants (user_id uuid, lead_id uuid);
CREATE FUNCTION marshmallow_private.my_granted_paid_lead_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(array_agg(lead_id), '{}') FROM marshmallow_private.paid_grants WHERE user_id = auth.uid() $$;
GRANT EXECUTE ON FUNCTION marshmallow_private.my_granted_paid_lead_ids() TO authenticated;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.leads, public.lead_shares TO authenticated;
CREATE POLICY "Granted paid leads" ON public.leads FOR SELECT TO authenticated
  USING ((status = 'paid'::text) AND (id = ANY ((SELECT marshmallow_private.my_granted_paid_lead_ids())::uuid[])));
-- The policy as it is in production today (20261030160000).
CREATE POLICY "Lead visibility by role" ON public.leads FOR SELECT TO authenticated
USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'processor'::app_role)
    OR has_role(auth.uid(), 'opr'::app_role)
    OR (has_role(auth.uid(), 'opr_admin'::app_role)
        AND (status = 'urgent_job'::text OR (status <> 'scammed'::text AND public.leads_owned_by_caller(leads.*))))
    OR (has_role(auth.uid(), 'cs_admin'::app_role)
        AND status <> ALL (ARRAY['paid'::text, 'partial_paid'::text, 'cancelled'::text, 'job_done'::text, 'scammed'::text]))
    OR (NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'processor'::app_role)
             OR has_role(auth.uid(), 'opr'::app_role) OR has_role(auth.uid(), 'opr_admin'::app_role)
             OR has_role(auth.uid(), 'cs_admin'::app_role))
        AND public.leads_owned_by_caller(leads.*))
);
-- pg_stat_statements: one controllable counter.
CREATE TABLE extensions.pg_stat_statements (total_exec_time double precision);
INSERT INTO extensions.pg_stat_statements VALUES (0);
-- pg_cron and realtime.send stand-ins that record what happens.
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING 1::bigint $$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = p_name RETURNING true $$;
INSERT INTO cron.job (jobname, schedule, command) VALUES
 ('google-sheets-outbox-worker','* * * * *','SELECT public.cron_google_sheets_sync_worker()'),
 ('urgent-ai-status-refresh','*/30 * * * *','SELECT public.cron_refresh_urgent_ai_status()'),
 ('processor-board-daily-check','*/5 * * * *','SELECT marshmallow_private.dispatch_processor_board_daily()'),
 ('sheets-sync-watchdog','*/5 * * * *','SELECT marshmallow_private.cron_raise_sheets_sync_stale_alert()'),
 ('schedule-confirmation-monitor','* * * * *','SELECT marshmallow_private.dispatch_schedule_monitor()'),
 ('notifications-retention','17 3 * * *','SELECT marshmallow_private.purge_old_notifications(30)');
CREATE TABLE realtime.sent (payload jsonb, event text, topic text, private boolean, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO realtime.sent (payload, event, topic, private) VALUES (payload, event, topic, private) $$;
-- Original jobs: record each call.
CREATE TABLE public.job_calls (job text, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.cron_google_sheets_sync_worker() RETURNS void LANGUAGE sql AS $$ INSERT INTO public.job_calls(job) VALUES ('sheets_sync') $$;
CREATE FUNCTION public.cron_refresh_urgent_ai_status() RETURNS void LANGUAGE sql AS $$ INSERT INTO public.job_calls(job) VALUES ('urgent_ai_refresh') $$;
CREATE FUNCTION marshmallow_private.dispatch_processor_board_daily() RETURNS boolean LANGUAGE sql AS $$ INSERT INTO public.job_calls(job) VALUES ('processor_board_daily') RETURNING true $$;
CREATE FUNCTION marshmallow_private.cron_raise_sheets_sync_stale_alert() RETURNS integer LANGUAGE sql AS $$ INSERT INTO public.job_calls(job) VALUES ('sheets_watchdog') RETURNING 0 $$;
CREATE FUNCTION marshmallow_private.dispatch_schedule_monitor() RETURNS void LANGUAGE sql AS $$ INSERT INTO public.job_calls(job) VALUES ('schedule_monitor') $$;
