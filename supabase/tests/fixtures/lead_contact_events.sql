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
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
INSERT INTO public.profiles
SELECT ('20000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1, 6) n;
INSERT INTO public.user_roles
SELECT ('20000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, role::public.app_role
FROM (VALUES (1,'admin'),(2,'processor'),(3,'customer_service'),(4,'cs_admin'),(5,'opr'),(6,'opr_admin')) r(n,role);

-- Copy of the production helper (20261130000000_ai_schedule_confirmation.sql).
CREATE FUNCTION marshmallow_private.schedule_phone_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN length(d) >= 10 THEN right(d, 10) END
  FROM (SELECT regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') AS d) x;
$$;

CREATE TABLE public.leads (
  id uuid PRIMARY KEY, status text, created_by uuid, assigned_cs uuid,
  customer_phone text, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_visibility ON public.leads FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role IN ('admin','processor','opr'))
  OR created_by = auth.uid());
GRANT SELECT ON public.leads, public.user_roles TO authenticated;
CREATE TABLE public.lead_shares (lead_id uuid, shared_with_user_id uuid);
CREATE TABLE public.lead_status_visibility (user_id uuid, role public.app_role, status text, is_visible boolean);

-- Lead A: urgent, created by CS (user 3), phone (305) 555-0101, chat matched by phone.
-- Lead B: urgent, created by nobody here, phone 407-555-0202.
INSERT INTO public.leads VALUES
  ('a0000000-0000-4000-8000-000000000001', 'urgent_job', '20000000-0000-4000-8000-000000000003', NULL, '(305) 555-0101', '2026-11-01 12:00+00'),
  ('b0000000-0000-4000-8000-000000000002', 'urgent_job', NULL, NULL, '407-555-0202', '2026-11-02 12:00+00');

CREATE TABLE public.quo_conversations (
  id uuid PRIMARY KEY, quo_conversation_id text, linked_lead_id uuid, customer_number text);
CREATE TABLE public.quo_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quo_message_id text UNIQUE, conversation_id uuid,
  sender text, direction text, status text, message_time timestamptz, quo_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());

-- Copy of the production helper (20261205* workflow migration).
CREATE OR REPLACE FUNCTION marshmallow_private.workflow_job_visible_to(u uuid,l public.leads) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r text; visible boolean;
BEGIN
  SELECT CASE WHEN count(*)=1 THEN min(role::text) END INTO r FROM public.user_roles WHERE user_id=u
    AND EXISTS(SELECT 1 FROM public.profiles WHERE id=u);
  IF r='admin' THEN RETURN true; END IF;
  IF r IS NULL OR r NOT IN ('processor','cs_admin','customer_service') THEN RETURN false; END IF;
  IF r='cs_admin' AND l.status IN ('paid','partial_paid','cancelled','job_done','scammed') THEN RETURN false; END IF;
  IF r='customer_service' AND NOT coalesce(l.created_by=u OR l.assigned_cs=u OR EXISTS(
    SELECT 1 FROM public.lead_shares WHERE lead_id=l.id AND shared_with_user_id=u),false) THEN RETURN false; END IF;
  SELECT is_visible INTO visible FROM public.lead_status_visibility WHERE user_id=u AND status=l.status LIMIT 1;
  IF visible IS NULL THEN SELECT is_visible INTO visible FROM public.lead_status_visibility WHERE user_id IS NULL AND role::text=r AND status=l.status LIMIT 1; END IF;
  RETURN coalesce(visible,CASE r WHEN 'processor' THEN l.status NOT IN ('pending_to_send','quote_updated')
    ELSE l.status NOT IN ('scammed','quote_change','pending_to_send','quote_updated') END);
END $$;
GRANT EXECUTE ON FUNCTION marshmallow_private.workflow_job_visible_to(uuid, public.leads) TO authenticated;

-- History before the migration: lead A's chat (matched by phone, not linked).
-- A text 20 days before the lead (outside the 14-day window), then an outgoing
-- text, then an incoming call with two call.* rows.
INSERT INTO public.quo_conversations VALUES
  ('c0000000-0000-4000-8000-000000000001', 'CN-A', NULL, '+13055550101');
INSERT INTO public.quo_messages (quo_message_id, conversation_id, sender, direction, status, message_time) VALUES
  ('MSG-OLD', 'c0000000-0000-4000-8000-000000000001', 'customer', 'inbound', NULL, '2026-10-12 10:00+00'),
  ('MSG-1', 'c0000000-0000-4000-8000-000000000001', 'agent', 'outbound', 'delivered', '2026-11-01 10:00+00'),
  ('CALL-1:call.completed', 'c0000000-0000-4000-8000-000000000001', 'customer', 'inbound', 'completed', '2026-11-01 11:00+00'),
  ('CALL-1:call.summary.completed', 'c0000000-0000-4000-8000-000000000001', 'customer', 'inbound', 'call.summary.completed', '2026-11-01 11:05+00');
