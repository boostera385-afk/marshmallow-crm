-- ISOLATED fixture ONLY. Never apply to an existing project. Synthetic records.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TYPE public.app_role AS ENUM('admin','processor','customer_service','opr','cs_admin','opr_admin');
CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
CREATE FUNCTION public.has_role(uuid,public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role=$2) $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text);
CREATE TABLE public.navigation_permissions(id uuid DEFAULT gen_random_uuid(),user_id uuid,nav_section text,allowed boolean,UNIQUE(user_id,nav_section));
CREATE TABLE public.leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text,created_by uuid,customer_name text,created_at timestamptz DEFAULT now());
-- Mirrors the real scoping: a CS user reads only their own leads directly.
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Fixture own leads" ON public.leads FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin') OR created_by=auth.uid());
GRANT SELECT ON public.leads,public.user_roles,public.profiles,public.navigation_permissions TO authenticated;
