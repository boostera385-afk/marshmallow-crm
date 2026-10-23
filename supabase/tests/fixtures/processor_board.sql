-- ISOLATED fixture only. Never apply to an existing/shared Supabase project.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
CREATE TYPE public.app_role AS ENUM('admin','processor','customer_service','cs_admin','opr','opr_admin');
CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
CREATE FUNCTION public.has_role(uuid,public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role=$2) $$;
-- Mirror the live legacy overload: untyped literals must not resolve ambiguously
-- or accidentally use obsolete role membership.
CREATE TYPE public.app_role_old AS ENUM('admin','processor','customer_service','cs_admin','opr','opr_admin');
CREATE FUNCTION public.has_role(uuid,public.app_role_old) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text);
CREATE TABLE public.lead_status_visibility(user_id uuid,role public.app_role,status text,is_visible boolean);
CREATE TABLE public.leads(id uuid PRIMARY KEY,job_id text,customer_name text,customer_phone text,service_type text,address text,city text,state text,tech_name text,tech_number text,scheduled_date date,scheduled_time_start time,scheduled_time_end time,customer_schedule_requirements text,terms text,status text,updated_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now());
ALTER TABLE public.leads ADD COLUMN half_address text;
CREATE TABLE public.quo_conversations(id uuid PRIMARY KEY,last_message_time timestamptz);
ALTER TABLE public.quo_conversations ADD COLUMN linked_lead_id uuid, ADD COLUMN customer_number text;
CREATE TABLE public.activity_logs(id uuid DEFAULT gen_random_uuid(),user_id uuid,user_name text,action text,target_type text,target_id text,details text);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_lead_scope ON public.leads FOR SELECT TO authenticated USING(id<>'15000000-0000-4000-8000-000000000030');
GRANT SELECT ON public.leads,public.lead_status_visibility,public.user_roles,public.quo_conversations TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
-- Stand-ins for hosted Vault and pg_net: record dispatches, never send anything.
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
CREATE SCHEMA net;
CREATE TABLE net.fixture_requests(url text,headers jsonb,body jsonb);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO net.fixture_requests VALUES(url,headers,body) RETURNING 1::bigint
$$;
