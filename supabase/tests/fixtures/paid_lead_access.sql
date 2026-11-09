-- Minimal ISOLATED Postgres fixture for 20261204000000_paid_lead_access and
-- 20261205000000_paid_lead_access_by_paid_date.
-- Never apply to a Supabase project. The lead SELECT policy mirrors production's
-- "Lead visibility by role" for the roles exercised here (2026-11-07).
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE SCHEMA marshmallow_private;
GRANT USAGE ON SCHEMA marshmallow_private TO authenticated;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TYPE public.app_role AS ENUM('admin','processor','customer_service','opr','cs_admin','opr_admin');
CREATE TABLE public.user_roles(user_id uuid REFERENCES auth.users(id), role public.app_role, PRIMARY KEY(user_id, role));
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = $2);
$$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.activity_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, user_name text, action text,
  target_type text, target_id text, details text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.lead_status_visibility(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role text, status text NOT NULL,
  is_visible boolean NOT NULL DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), user_id uuid);
GRANT SELECT, INSERT, UPDATE ON public.lead_status_visibility TO authenticated;
CREATE TABLE public.leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id text, status text NOT NULL,
  created_by uuid, assigned_cs uuid, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.lead_payment_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES public.leads(id),
  status text NOT NULL, reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, UPDATE ON public.leads TO authenticated;
CREATE POLICY "Lead visibility by role" ON public.leads FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'processor')
  OR (public.has_role(auth.uid(), 'cs_admin') AND status <> ALL (ARRAY['paid','partial_paid','cancelled','job_done','scammed']))
  OR (NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'processor') OR public.has_role(auth.uid(), 'cs_admin'))
      AND (created_by = auth.uid() OR assigned_cs = auth.uid())));
INSERT INTO auth.users VALUES
  ('17000000-0000-4000-8000-000000000001'),('17000000-0000-4000-8000-000000000002'),
  ('17000000-0000-4000-8000-000000000003'),('17000000-0000-4000-8000-000000000004');
INSERT INTO public.user_roles VALUES
  ('17000000-0000-4000-8000-000000000001','admin'),('17000000-0000-4000-8000-000000000002','cs_admin'),
  ('17000000-0000-4000-8000-000000000003','customer_service'),('17000000-0000-4000-8000-000000000004','customer_service');
INSERT INTO public.profiles VALUES
  ('17000000-0000-4000-8000-000000000001','Synthetic Admin'),('17000000-0000-4000-8000-000000000002','Synthetic CS Admin'),
  ('17000000-0000-4000-8000-000000000003','Synthetic CS'),('17000000-0000-4000-8000-000000000004','Other CS');
-- Paid before 20261205000000 (backfill input), by the other CS. Created dates differ
-- from the dates they became paid on purpose.
INSERT INTO public.leads(id, job_id, status, created_by, created_at) VALUES
  ('17100000-0000-4000-8000-000000000001', 'L-SEP-PAIDOCT', 'paid', '17000000-0000-4000-8000-000000000004', '2026-09-01 12:00-04'),
  ('17100000-0000-4000-8000-000000000002', 'L-OCT-PAIDNOV', 'paid', '17000000-0000-4000-8000-000000000004', '2026-10-10 12:00-04'),
  ('17100000-0000-4000-8000-000000000003', 'L-TWO-EVENTS', 'paid', '17000000-0000-4000-8000-000000000004', '2026-09-15 12:00-04'),
  ('17100000-0000-4000-8000-000000000004', 'L-NO-RECORD', 'paid', '17000000-0000-4000-8000-000000000004', '2026-10-15 12:00-04'),
  ('17100000-0000-4000-8000-000000000005', 'L-NOT-PAID', 'payment_pending', '17000000-0000-4000-8000-000000000004', '2026-10-15 12:00-04');
INSERT INTO public.activity_logs(action, target_type, target_id, details, created_at) VALUES
  ('payment_recorded', 'lead', '17100000-0000-4000-8000-000000000001', '{"status_from":"payment_pending","status_to":"paid","message":"Recorded"}', '2026-10-20 12:00-04'),
  ('payment_recorded', 'lead', '17100000-0000-4000-8000-000000000003', '{"status_to": "paid"}', '2026-10-05 12:00-04'),
  ('payment_recorded', 'lead', '17100000-0000-4000-8000-000000000005', '{"status_to":"paid"}', '2026-10-21 12:00-04'),
  ('payment_recorded', 'lead', 'not-a-uuid', 'not json "status_to":"paid"', '2026-10-21 12:00-04'),
  ('status_changed', 'lead', '17100000-0000-4000-8000-000000000004', '{"status_to":"payment_pending"}', '2026-10-22 12:00-04');
INSERT INTO public.lead_payment_requests(lead_id, status, reviewed_at) VALUES
  ('17100000-0000-4000-8000-000000000002', 'approved', '2026-11-02 12:00-05'),
  ('17100000-0000-4000-8000-000000000003', 'approved', '2026-10-07 12:00-04'),
  ('17100000-0000-4000-8000-000000000004', 'rejected', '2026-10-23 12:00-04');
