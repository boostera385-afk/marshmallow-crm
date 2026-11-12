-- Minimal ISOLATED Postgres fixture for 20261212000000_message_templates_settings.
-- Never apply to a Supabase project.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT USAGE ON SCHEMA public TO authenticated, anon;
CREATE TYPE public.app_role AS ENUM('admin','processor','customer_service','opr','cs_admin','opr_admin');
CREATE TABLE public.user_roles(user_id uuid REFERENCES auth.users(id), role public.app_role, PRIMARY KEY(user_id, role));
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = $2);
$$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, full_name text);
INSERT INTO auth.users VALUES
  ('17600000-0000-4000-8000-000000000001'),('17600000-0000-4000-8000-000000000002'),
  ('17600000-0000-4000-8000-000000000003'),('17600000-0000-4000-8000-000000000004');
INSERT INTO public.user_roles VALUES
  ('17600000-0000-4000-8000-000000000001','admin'),('17600000-0000-4000-8000-000000000002','cs_admin'),
  ('17600000-0000-4000-8000-000000000003','processor'),('17600000-0000-4000-8000-000000000004','opr');
INSERT INTO public.profiles VALUES
  ('17600000-0000-4000-8000-000000000001','Synthetic Admin'),('17600000-0000-4000-8000-000000000002','Synthetic CS Admin'),
  ('17600000-0000-4000-8000-000000000003','Synthetic Processor'),('17600000-0000-4000-8000-000000000004','Synthetic OPR');
