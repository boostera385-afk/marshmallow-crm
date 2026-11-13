-- ISOLATED fixture only. Never apply this file to the linked project.
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TYPE public.app_role AS ENUM ('admin','processor','customer_service','cs_admin','opr','opr_admin');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = $2);
$$;
INSERT INTO public.user_roles
SELECT ('17800000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, role::public.app_role
FROM (VALUES (1,'admin'),(2,'processor'),(3,'customer_service'),(4,'cs_admin'),(5,'opr'),(6,'opr_admin')) r(n,role);
CREATE TABLE public.leads (id integer PRIMARY KEY, status text, payment_amount numeric, created_by uuid);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_scope ON public.leads TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'processor') OR created_by = auth.uid())
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'processor') OR created_by = auth.uid());
GRANT SELECT, UPDATE ON public.leads TO authenticated;
CREATE TABLE public.lead_payment_requests (id integer PRIMARY KEY, lead_id integer, amount numeric);
ALTER TABLE public.lead_payment_requests ENABLE ROW LEVEL SECURITY;
INSERT INTO public.leads VALUES
  (1,'job_done',NULL,'17800000-0000-4000-8000-000000000003'),
  (2,'paid',100,'17800000-0000-4000-8000-000000000003'),
  (3,'partial_paid',25,'17800000-0000-4000-8000-000000000003'),
  (4,'job_done',NULL,'17800000-0000-4000-8000-000000000099');
INSERT INTO public.lead_payment_requests VALUES (1,1,100);
