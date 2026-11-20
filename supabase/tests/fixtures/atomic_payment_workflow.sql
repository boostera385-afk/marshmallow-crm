-- Disposable Postgres ONLY. Never run this fixture against Supabase.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA marshmallow_private;
CREATE TYPE public.app_role AS ENUM ('admin','processor','customer_service','cs_admin','opr','opr_admin');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE TABLE public.user_roles(user_id uuid, role public.app_role);
INSERT INTO public.user_roles SELECT
  ('18000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, role::public.app_role
FROM (VALUES (1,'admin'),(2,'processor'),(3,'customer_service'),(4,'cs_admin'),(5,'opr'),(6,'opr_admin')) r(n,role);
CREATE FUNCTION public.has_role(uuid,public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role=$2);
$$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, full_name text);
INSERT INTO public.profiles SELECT user_id, role::text FROM public.user_roles;
CREATE TABLE public.leads(
  id uuid PRIMARY KEY, job_id text, customer_name text, status text NOT NULL, amount numeric,
  payment_amount numeric, payment_screenshot_url text, cs_tag text, last_edited_by uuid,
  last_edited_by_name text, updated_at timestamptz, last_edited_at timestamptz,
  scheduled_date date DEFAULT '2026-11-25', scheduled_time_start time DEFAULT '10:00',
  customer_schedule_requirements text DEFAULT 'Keep the agreed schedule'
);
CREATE TABLE public.lead_payment_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES public.leads(id),
  previous_status text NOT NULL,requested_by uuid,requested_by_name text,requested_by_role text NOT NULL,
  request_type text NOT NULL DEFAULT 'paid' CHECK(request_type IN ('paid','partial_paid')),
  amount numeric NOT NULL,screenshot_path text,comment text,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by uuid,reviewed_by_name text,reviewed_at timestamptz,review_note text
);
CREATE TABLE public.activity_logs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,user_name text NOT NULL,
  action text NOT NULL,target_type text NOT NULL,target_id text,details text
);
CREATE TABLE storage.objects(bucket_id text,name text,owner uuid,owner_id text);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_scope ON public.leads TO authenticated
USING(public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'processor'));
ALTER TABLE public.lead_payment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY old_request_reads ON public.lead_payment_requests FOR SELECT TO authenticated USING(true);
CREATE POLICY old_request_inserts ON public.lead_payment_requests FOR INSERT TO authenticated WITH CHECK(true);
CREATE POLICY old_request_updates ON public.lead_payment_requests FOR UPDATE TO authenticated USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA auth,public TO authenticated;
GRANT SELECT,UPDATE ON public.leads TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.lead_payment_requests TO authenticated;
GRANT SELECT ON public.profiles,public.user_roles TO authenticated;
CREATE FUNCTION marshmallow_private.workflow_requests(jsonb) RETURNS jsonb
LANGUAGE sql AS $$ SELECT '{"legacy":true}'::jsonb $$;
GRANT USAGE ON SCHEMA marshmallow_private TO authenticated;
GRANT EXECUTE ON FUNCTION marshmallow_private.workflow_requests(jsonb) TO authenticated;
INSERT INTO public.leads(id,job_id,customer_name,status)
SELECT ('18000000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,'TEST-'||n,'Synthetic '||n,'job_done'
FROM generate_series(1,15) n;
CREATE FUNCTION public.fail_payment_test_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('test.fail_payment_write',true)='yes' THEN
    RAISE EXCEPTION 'Synthetic backend failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_fail_lead BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.fail_payment_test_write();
CREATE FUNCTION public.fail_payment_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('test.fail_payment_audit',true)='yes' THEN
    RAISE EXCEPTION 'Synthetic audit failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_fail_audit BEFORE INSERT ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION public.fail_payment_test_audit();
