-- Disposable PGlite fixture ONLY. Never apply to a Supabase project.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','');
$$;
CREATE TABLE public.leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_phone text,created_at timestamptz DEFAULT now(),status text DEFAULT 'scheduled',customer_schedule_requirements text);
CREATE TABLE public.quo_phone_numbers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),quo_phone_number_id text UNIQUE NOT NULL,number text NOT NULL,display_number text,name text,label text,active boolean DEFAULT true);
CREATE TABLE public.quo_conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),quo_conversation_id text UNIQUE NOT NULL,customer_name text,customer_number text,number_id uuid REFERENCES public.quo_phone_numbers(id),linked_lead_id uuid REFERENCES public.leads(id),status text,current_status text,last_message_preview text,last_message_time timestamptz,last_message_at timestamptz,direction text,last_customer_message_at timestamptz,last_agent_message_at timestamptz,raw_payload jsonb);
CREATE TABLE public.quo_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),quo_message_id text UNIQUE NOT NULL,conversation_id uuid REFERENCES public.quo_conversations(id),sender text NOT NULL,direction text,recipients jsonb,text text,media jsonb,status text,message_time timestamptz,quo_created_at timestamptz,raw_payload jsonb);
CREATE TABLE public.quo_conversation_flags(conversation_id uuid PRIMARY KEY REFERENCES public.quo_conversations(id));
CREATE TABLE public.quo_webhook_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),quo_event_id text UNIQUE,event_type text,quo_message_id text,quo_conversation_id text,quo_phone_number_id text,raw_payload jsonb NOT NULL,received_at timestamptz DEFAULT now(),processed_at timestamptz,processing_status text NOT NULL DEFAULT 'received',error_message text,signature_verified boolean DEFAULT false,created_at timestamptz DEFAULT now(),UNIQUE(quo_message_id,event_type));
ALTER TABLE public.quo_webhook_events ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT SELECT ON public.quo_webhook_events TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
ALTER ROLE service_role BYPASSRLS;
