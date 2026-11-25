-- ISOLATED fixture ONLY. Never apply to an existing project. Synthetic records.
-- Minimal stand-ins for Supabase roles, auth, Vault, pgcrypto and pg_net so
-- 20261231000800_jellybean_lead_departments.sql can run on embedded Postgres.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'processor', 'customer_service', 'opr', 'cs_admin', 'opr_admin');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = $2) $$;

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text,
  created_by uuid,
  customer_phone text,
  customer_landline text,
  created_at timestamptz DEFAULT now()
);
-- Mirrors the real shape: admins read every lead, others only their own.
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Fixture lead visibility" ON public.leads FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR created_by = auth.uid());
CREATE POLICY "Fixture lead updates" ON public.leads FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR created_by = auth.uid());
GRANT SELECT, UPDATE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
GRANT SELECT ON public.user_roles TO authenticated, service_role;

CREATE SCHEMA extensions;
CREATE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS
  $$ SELECT decode(md5(random()::text || clock_timestamp()::text), 'hex') $$;

CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text, description text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text, new_description text DEFAULT '') RETURNS uuid
  LANGUAGE sql AS $$ INSERT INTO vault.secrets (secret, name, description) VALUES (new_secret, new_name, new_description) RETURNING id $$;
INSERT INTO vault.secrets (name, secret) VALUES ('project_url', 'https://marshmallow.example.invalid');

CREATE SCHEMA net;
CREATE TABLE net.calls (url text, headers jsonb, body jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (url, headers, body); SELECT 1::bigint $$;
