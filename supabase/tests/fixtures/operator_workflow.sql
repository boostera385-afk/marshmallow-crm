-- Minimal ISOLATED Postgres fixture for the exact operator-workflow migration.
-- Never apply to an existing Supabase project. No network integrations or live data.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TYPE public.app_role AS ENUM('admin','processor','customer_service','opr','cs_admin','opr_admin');
CREATE TABLE public.user_roles(user_id uuid REFERENCES auth.users(id),role public.app_role,PRIMARY KEY(user_id,role));
CREATE FUNCTION public.has_role(uuid,public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role=$2);
$$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.activity_logs(user_id uuid,user_name text,action text,target_type text,target_id text,details text);
CREATE TABLE public.leads(
  id uuid PRIMARY KEY,job_id text UNIQUE NOT NULL,status text NOT NULL,customer_name text NOT NULL,
  customer_phone text,customer_landline text,service_type text,service_details text,address text,city text,state text,zip_code text,
  customer_schedule_requirements text,scheduled_date date,scheduled_time_start time,scheduled_time_end time,
  tech_name text,tech_number text,cs_tag text,quote text,show_quote_to_opr boolean,created_by uuid
);
CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,lead_id uuid,title text,message text,read boolean DEFAULT false);
GRANT SELECT ON public.user_roles,public.profiles TO authenticated;
GRANT INSERT ON public.activity_logs TO authenticated;
CREATE PUBLICATION supabase_realtime;
INSERT INTO auth.users VALUES
  ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),('00000000-0000-4000-8000-000000000004');
INSERT INTO public.user_roles VALUES
  ('00000000-0000-4000-8000-000000000001','admin'),('00000000-0000-4000-8000-000000000002','opr'),
  ('00000000-0000-4000-8000-000000000003','opr_admin'),('00000000-0000-4000-8000-000000000004','customer_service');
INSERT INTO public.profiles SELECT id,'Synthetic User' FROM auth.users;
