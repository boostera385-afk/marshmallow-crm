-- ISOLATED fixture additions only; load after fixtures/update_requests.sql.
CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO service_role;
ALTER TABLE public.leads ADD COLUMN cs_tag text, ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE TABLE public.lead_status_visibility(user_id uuid,role public.app_role,status text,is_visible boolean);
CREATE TABLE public.lead_cancellation_requests(lead_id uuid,status text);
CREATE TABLE public.lead_payment_requests(lead_id uuid,status text);
CREATE TABLE public.lead_quote_approval_requests(lead_id uuid,status text);
CREATE TABLE public.quo_conversations(id uuid PRIMARY KEY,customer_number text,number_id uuid,linked_lead_id uuid,last_message_time timestamptz);
CREATE TABLE public.quo_messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES public.quo_conversations(id),quo_message_id text,
  sender text,direction text,text text,message_time timestamptz);
CREATE TABLE public.quo_ai_settings(key text PRIMARY KEY,value jsonb);
GRANT SELECT ON public.lead_status_visibility,public.quo_conversations,public.quo_messages TO authenticated;
GRANT ALL ON public.leads,public.quo_messages,public.quo_conversations TO service_role;
GRANT INSERT ON public.quo_messages TO authenticated;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_lead_visibility ON public.leads FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'processor')
  OR (public.has_role(auth.uid(),'cs_admin') AND status NOT IN ('paid','partial_paid','cancelled','job_done','scammed'))
  OR created_by=auth.uid() OR assigned_cs=auth.uid()
  OR EXISTS(SELECT 1 FROM public.lead_shares WHERE lead_id=id AND shared_with_user_id=auth.uid()));
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON public.notifications TO authenticated;
CREATE POLICY "Users can select own notifications" ON public.notifications FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY fixture_recipient_update ON public.notifications FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
