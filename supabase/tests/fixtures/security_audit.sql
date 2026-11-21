-- Minimal ISOLATED Postgres fixture for 20261231000100_security_audit_least_privilege.
-- Never apply to a Supabase project. Tables, policies and grants mirror production
-- as read on 2026-11-21 (the over-broad "USING (true)" policies and Supabase's
-- default table grants), so the harness proves the migration removes them.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA marshmallow_private;
GRANT USAGE ON SCHEMA auth, storage, marshmallow_private TO anon, authenticated, service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TYPE public.app_role AS ENUM('admin','processor','customer_service','opr','cs_admin','opr_admin');
CREATE TABLE public.user_roles(user_id uuid REFERENCES auth.users(id), role public.app_role, PRIMARY KEY(user_id, role));
GRANT SELECT ON public.user_roles TO authenticated;
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = $2);
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, full_name text, opr_code text);
CREATE TABLE public.navigation_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, nav_section text, allowed boolean);
CREATE TABLE public.technicians(id uuid PRIMARY KEY, name text, is_good_tech boolean, is_active boolean);
CREATE TABLE public.technician_change_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), technician_id uuid, technician_name text,
  change_type text, requested_value boolean, previous_value boolean, reason text, requested_by uuid, requested_by_name text,
  status text NOT NULL DEFAULT 'pending', reviewed_by_name text, reviewed_at timestamptz, review_note text, created_at timestamptz DEFAULT now());

-- Quo tables with production's pre-migration policies and default grants.
CREATE TABLE public.quo_conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quo_conversation_id text NOT NULL,
  customer_name text, customer_number text, linked_lead_id uuid, last_message_preview text, last_message_at timestamptz,
  last_message_time timestamptz, last_agent_message_at timestamptz, status text, current_status text DEFAULT 'new',
  updated_at timestamptz DEFAULT now());
CREATE TABLE public.quo_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid, sender text, direction text,
  text text, message_time timestamptz, quo_message_id text);
CREATE TABLE public.quo_number_preferences(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone_number_id text UNIQUE NOT NULL,
  emoji text DEFAULT '', hidden boolean DEFAULT false, sort_order int DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE public.lead_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, photo_url text, uploaded_by uuid);
ALTER TABLE public.quo_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quo_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quo_number_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_photos ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.quo_conversations, public.quo_messages, public.quo_number_preferences, public.lead_photos TO anon, authenticated;
CREATE POLICY "Allow all authenticated read on quo_conversations" ON public.quo_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert on quo_conversations" ON public.quo_conversations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update on quo_conversations" ON public.quo_conversations FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow all authenticated read on quo_messages" ON public.quo_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert on quo_messages" ON public.quo_messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated read on quo_number_preferences" ON public.quo_number_preferences FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert on quo_number_preferences" ON public.quo_number_preferences FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update on quo_number_preferences" ON public.quo_number_preferences FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can read lead photos" ON public.lead_photos FOR SELECT TO authenticated USING (true);

-- storage.objects, reduced to the columns the policy reads.
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner_id text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;
CREATE POLICY "Authenticated users can read lead-photos" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'lead-photos');
CREATE POLICY "Authenticated users can delete lead-photos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'lead-photos');

-- Pre-migration production function bodies (no caller checks).
CREATE FUNCTION public.assign_next_opr_code(_user_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN UPDATE public.profiles SET opr_code = 'OPR999' WHERE id = _user_id; RETURN 'OPR999'; END $$;
CREATE FUNCTION public.list_opr_codes() RETURNS TABLE(opr_code text, full_name text) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.opr_code, p.full_name FROM public.profiles p WHERE p.opr_code IS NOT NULL AND p.opr_code <> '' ORDER BY p.opr_code; $$;
CREATE FUNCTION public.list_technician_change_requests(p_status text DEFAULT 'pending') RETURNS TABLE(id uuid, technician_id uuid,
  technician_name text, change_type text, requested_value boolean, previous_value boolean, reason text, requested_by uuid,
  requested_by_name text, status text, reviewed_by_name text, reviewed_at timestamptz, review_note text, created_at timestamptz,
  current_is_good_tech boolean, current_is_active boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT r.id, r.technician_id, r.technician_name, r.change_type, r.requested_value, r.previous_value, r.reason,
         r.requested_by, r.requested_by_name, r.status, r.reviewed_by_name, r.reviewed_at, r.review_note, r.created_at,
         t.is_good_tech, t.is_active
    FROM public.technician_change_requests r LEFT JOIN public.technicians t ON t.id = r.technician_id
   WHERE r.status = coalesce(p_status, 'pending') ORDER BY r.created_at; $$;
GRANT EXECUTE ON FUNCTION public.assign_next_opr_code(uuid), public.list_opr_codes(), public.list_technician_change_requests(text) TO anon, authenticated;
