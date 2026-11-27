-- ISOLATED fixture only. Never apply this file to the linked project.
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA marshmallow_private;
GRANT USAGE ON SCHEMA auth, marshmallow_private TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TYPE public.app_role AS ENUM ('admin','processor','customer_service','cs_admin','opr','opr_admin');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
INSERT INTO public.user_roles
SELECT ('30000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, role::public.app_role
FROM (VALUES (1,'admin'),(2,'processor'),(3,'customer_service'),(4,'cs_admin'),(5,'opr'),(6,'opr_admin')) r(n,role);
GRANT SELECT ON public.user_roles TO authenticated;

-- Copy of the production helper (20261210000000_leads_rls_single_role_lookup.sql).
CREATE FUNCTION marshmallow_private.caller_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION marshmallow_private.caller_role() TO authenticated;

-- Copies of the production has_role() and Feature Access table (tech_status grant, 20261127085131).
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE TABLE public.navigation_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, nav_section text, allowed boolean,
  UNIQUE (user_id, nav_section));

CREATE TABLE public.leads (id uuid PRIMARY KEY);
INSERT INTO public.leads VALUES ('a1000000-0000-4000-8000-000000000001'), ('b1000000-0000-4000-8000-000000000002');
GRANT SELECT ON public.leads TO authenticated; -- production: leads RLS decides which rows
CREATE TABLE public.lead_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, note_type text, content text,
  created_at timestamptz DEFAULT now(), edited_at timestamptz);

-- Existing notes before the migration (backfill): one line per tech, plus noise.
INSERT INTO public.lead_notes (lead_id, note_type, content, created_at) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'processor', 'Tech 1: Michael - (305) 555-0123 - he is available', '2026-11-01 10:00+00'),
  ('a1000000-0000-4000-8000-000000000001', 'processor', 'Tech 2: David - +1 (407) 555-0199', '2026-11-01 10:05+00'),
  ('a1000000-0000-4000-8000-000000000001', 'processor', 'called the customer, waiting', '2026-11-01 10:06+00'),
  ('a1000000-0000-4000-8000-000000000001', 'cs', 'Tech 9: not a processor note', '2026-11-01 10:07+00');
