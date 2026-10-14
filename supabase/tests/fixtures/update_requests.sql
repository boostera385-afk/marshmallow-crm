-- Minimal ISOLATED Postgres fixture for update-request migrations.
-- Never apply to an existing Supabase project. No live data or network access.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;

CREATE TYPE public.app_role AS ENUM('admin','processor','customer_service','opr','cs_admin','opr_admin');
CREATE TABLE public.user_roles(user_id uuid REFERENCES auth.users(id), role public.app_role, PRIMARY KEY(user_id, role));
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role=$2);
$$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, full_name text, email text);
CREATE TABLE public.activity_logs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, user_name text NOT NULL,
  action text NOT NULL, target_type text NOT NULL, target_id text, details text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.leads(
  id uuid PRIMARY KEY, job_id text UNIQUE NOT NULL, status text NOT NULL, customer_name text NOT NULL,
  customer_phone text, customer_landline text, customer_email text, service_type text, service_details text,
  address text, city text, state text, zip_code text, customer_schedule_requirements text,
  scheduled_date date, scheduled_time_start time, scheduled_time_end time, tech_name text, tech_number text,
  terms text, created_by uuid REFERENCES public.profiles(id), assigned_cs uuid REFERENCES public.profiles(id)
);
CREATE TABLE public.lead_shares(lead_id uuid REFERENCES public.leads(id), shared_with_user_id uuid REFERENCES public.profiles(id));
CREATE TABLE public.notifications(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, lead_id uuid,
  title text NOT NULL, message text NOT NULL, read boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.user_roles, public.profiles, public.leads, public.lead_shares TO authenticated;
