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
-- 20261203000000_opr_location_only: service role and a few Census places (synthetic subset).
CREATE ROLE service_role;
CREATE TABLE public.us_places(geoid text PRIMARY KEY, name text NOT NULL, state_code text NOT NULL, state_name text, population integer);
CREATE INDEX us_places_normalized_name_state_idx ON public.us_places(state_code, regexp_replace(lower(name), '[^a-z0-9]', '', 'g'));
GRANT SELECT ON public.us_places TO authenticated;
INSERT INTO public.us_places VALUES
  ('1','Coral Springs city','FL','Florida',134000),('2','Orlando city','FL','Florida',307000),('3','Miami city','FL','Florida',449000),
  ('4','Austin city','TX','Texas',974000),('5','Austin city','MN','Minnesota',26000),('6','Sauk Rapids city','MN','Minnesota',14000),
  ('7','St. Louis city','MO','Missouri',300000),('8','Ball Ground city','GA','Georgia',2500),('9','Atlanta city','GA','Georgia',498000),
  ('10','Lake Harmony CDP','PA','Pennsylvania',800),('11','Little Elm city','TX','Texas',50000),('12','Bonaire CDP','GA','Georgia',1500);
