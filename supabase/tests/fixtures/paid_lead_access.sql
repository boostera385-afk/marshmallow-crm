-- Minimal ISOLATED Postgres fixture for 20261204000000_paid_lead_access.
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
CREATE TABLE public.activity_logs(user_id uuid, user_name text, action text, target_type text, target_id text, details text);
CREATE TABLE public.lead_status_visibility(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role text, status text NOT NULL,
  is_visible boolean NOT NULL DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), user_id uuid);
GRANT SELECT, INSERT, UPDATE ON public.lead_status_visibility TO authenticated;
CREATE TABLE public.leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id text, status text NOT NULL,
  created_by uuid, assigned_cs uuid, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
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
