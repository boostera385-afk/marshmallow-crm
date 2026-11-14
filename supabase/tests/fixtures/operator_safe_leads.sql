-- Minimal ISOLATED Postgres fixture for 20261219000000_operator_safe_leads_half_labor.
-- Never apply to a Supabase project. location_label/location_parts are simplified
-- stand-ins; the function under test only passes their results through.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA marshmallow_private;
GRANT USAGE ON SCHEMA marshmallow_private TO authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TYPE public.app_role AS ENUM('admin','processor','customer_service','opr','cs_admin','opr_admin');
CREATE TABLE public.user_roles(user_id uuid, role public.app_role, PRIMARY KEY(user_id, role));
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = $2);
$$;
CREATE TABLE public.leads(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id text, status text NOT NULL, customer_name text, customer_email text,
  customer_phone text, service_type text, address text, city text, state text, zip_code text, scheduled_date date,
  scheduled_time_start time, scheduled_time_end time, amount numeric, created_by uuid, assigned_cs uuid, last_edited_by uuid,
  last_edited_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), payment_amount numeric,
  payment_screenshot_url text, number_name text, quote text, service_details text, customer_schedule_requirements text,
  reference_name text, tech_name text, tech_number text, terms text, labor_amount numeric, material_amount numeric,
  for_you_amount numeric, for_us_amount numeric, direction text, cs_tag text, half_address text, cancellation_reason text,
  source_url text, created_by_name text, last_edited_by_name text, booked_at timestamptz, latitude double precision,
  longitude double precision, nearby_areas jsonb, show_quote_to_opr boolean, expected_completion_date text,
  quote_requested_by uuid, customer_landline text, cs_notes text, processor_notes text, general_notes text,
  urgent_at timestamptz, org_id uuid, manual_entry boolean, coverage_tech_count integer, coverage_level text,
  coverage_area_label text, coverage_checked_at timestamptz, cs_tag_source text);
CREATE FUNCTION public.location_label(l public.leads) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT concat_ws(' ', l.city || ',', l.state, l.zip_code);
$$;
CREATE FUNCTION marshmallow_private.location_parts(l public.leads) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('city', l.city, 'state', l.state, 'zip', l.zip_code);
$$;
INSERT INTO public.user_roles VALUES
  ('18000000-0000-4000-8000-000000000001','opr'),('18000000-0000-4000-8000-000000000002','opr_admin'),
  ('18000000-0000-4000-8000-000000000003','admin');
