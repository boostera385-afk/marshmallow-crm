-- Minimal ISOLATED Postgres fixture for the notification redesign migrations
-- (20261206000000 .. 20261208000000). Never apply to a Supabase project. Tables
-- carry the production columns these migrations touch (2026-11-09).
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE SCHEMA marshmallow_private;
GRANT USAGE ON SCHEMA marshmallow_private TO authenticated;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '');
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TYPE public.app_role AS ENUM('admin','processor','customer_service','opr','cs_admin','opr_admin');
CREATE TABLE public.user_roles(user_id uuid REFERENCES auth.users(id), role public.app_role, PRIMARY KEY(user_id, role));
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = $2);
$$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.leads(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id text, customer_name text, status text NOT NULL, cs_tag text,
  created_by uuid, assigned_cs uuid, quote_requested_by uuid, expected_completion_date date,
  created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.leads TO authenticated;
CREATE POLICY fixture_leads ON public.leads FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'processor')
  OR (public.has_role(auth.uid(), 'cs_admin') AND status NOT IN ('paid','partial_paid','cancelled','job_done','scammed'))
  OR created_by = auth.uid() OR assigned_cs = auth.uid());
CREATE POLICY fixture_leads_update ON public.leads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE TABLE public.lead_shares(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES public.leads(id),
  shared_with_user_id uuid, shared_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.lead_operator_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES public.leads(id),
  operator_user_id uuid, assigned_by uuid, assigned_by_name text, created_at timestamptz DEFAULT now());
CREATE TABLE public.lead_cancellation_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES public.leads(id),
  requested_by uuid, requested_by_role text, status text NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE public.lead_payment_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES public.leads(id),
  requested_by uuid, requested_by_role text, status text NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL, message text NOT NULL,
  lead_id uuid, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
-- Production policies before the redesign (2026-11-09).
CREATE POLICY "Self or admin can create notifications" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'processor')
    OR public.has_role(auth.uid(), 'customer_service'));
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own notifications" ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE TABLE public.workflow_notification_events(notification_id uuid PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
  event_type text, lead_id uuid, request_id uuid);
CREATE FUNCTION marshmallow_private.workflow_notification_visible(n uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
GRANT EXECUTE ON FUNCTION marshmallow_private.workflow_notification_visible(uuid) TO authenticated;
CREATE POLICY "Users can select own notifications" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND marshmallow_private.workflow_notification_visible(id));
-- Previous browser-facing sender, kept for the compatibility check.
CREATE FUNCTION public.dispatch_lead_status_notification(p_lead_id uuid, p_title text, p_message text, p_user_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.notifications(user_id, title, message, lead_id) SELECT u, p_title, p_message, p_lead_id FROM unnest(p_user_ids) u;
  RETURN cardinality(p_user_ids);
END $$;
GRANT EXECUTE ON FUNCTION public.dispatch_lead_status_notification(uuid, text, text, uuid[]) TO authenticated;
-- Sheets health is controlled by the harness.
CREATE TABLE public.fixture_sheets_health(status text, consecutive_failures int, failed_jobs int, queue_depth int, last_error_message text);
INSERT INTO public.fixture_sheets_health VALUES ('healthy', 0, 0, 0, NULL);
CREATE FUNCTION public.get_sheets_sync_health(p integer) RETURNS SETOF public.fixture_sheets_health LANGUAGE sql STABLE AS $$
  SELECT * FROM public.fixture_sheets_health LIMIT 1;
$$;

-- 1 admin, 2 processor, 3 CS owner, 4 other CS, 5 CS Admin, 6 operator, 7 second admin
INSERT INTO auth.users SELECT ('15300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1, 7) n;
INSERT INTO public.profiles SELECT id, 'Synthetic ' || right(id::text, 1) FROM auth.users;
INSERT INTO public.user_roles VALUES
  ('15300000-0000-4000-8000-000000000001', 'admin'), ('15300000-0000-4000-8000-000000000002', 'processor'),
  ('15300000-0000-4000-8000-000000000003', 'customer_service'), ('15300000-0000-4000-8000-000000000004', 'customer_service'),
  ('15300000-0000-4000-8000-000000000005', 'cs_admin'), ('15300000-0000-4000-8000-000000000006', 'opr'),
  ('15300000-0000-4000-8000-000000000007', 'admin');

-- History before the redesign (input for the phase 3 one-time clean-up and retention).
INSERT INTO public.leads(id, job_id, customer_name, status, created_by) VALUES
  ('15300000-0000-4000-8000-000000000901', 'OLD-DECIDED', 'Old Decided', 'cancelled', '15300000-0000-4000-8000-000000000003'),
  ('15300000-0000-4000-8000-000000000902', 'OLD-PENDING', 'Old Pending', 'cancellation_requested', '15300000-0000-4000-8000-000000000003');
INSERT INTO public.lead_cancellation_requests(lead_id, requested_by, requested_by_role, status) VALUES
  ('15300000-0000-4000-8000-000000000901', '15300000-0000-4000-8000-000000000003', 'customer_service', 'approved'),
  ('15300000-0000-4000-8000-000000000902', '15300000-0000-4000-8000-000000000003', 'customer_service', 'pending');
INSERT INTO public.notifications(id, user_id, title, message, lead_id, created_at) VALUES
  ('15300000-0000-4000-8000-000000000801', '15300000-0000-4000-8000-000000000001', 'Lead cancellation request', 'Old Decided needs cancellation approval', '15300000-0000-4000-8000-000000000901', now() - interval '5 days'),
  ('15300000-0000-4000-8000-000000000802', '15300000-0000-4000-8000-000000000001', 'Lead cancellation request', 'Old Pending needs cancellation approval', '15300000-0000-4000-8000-000000000902', now() - interval '5 days'),
  ('15300000-0000-4000-8000-000000000803', '15300000-0000-4000-8000-000000000001', '[Alert] Urgent Job', 'Lead "Very Old" changed to Urgent Job', NULL, now() - interval '45 days'),
  ('15300000-0000-4000-8000-000000000804', '15300000-0000-4000-8000-000000000001', '[Alert] Urgent Job', 'Lead "Recent" changed to Urgent Job', NULL, now() - interval '10 days'),
  ('15300000-0000-4000-8000-000000000805', '15300000-0000-4000-8000-000000000001', '[Alert] Google Sheets backup is behind', 'old copy', NULL, now() - interval '2 days'),
  ('15300000-0000-4000-8000-000000000806', '15300000-0000-4000-8000-000000000001', '[Alert] Google Sheets backup is behind', 'newest copy', NULL, now() - interval '1 day');
INSERT INTO public.workflow_notification_events VALUES ('15300000-0000-4000-8000-000000000803', 'update_requested', NULL, NULL);
