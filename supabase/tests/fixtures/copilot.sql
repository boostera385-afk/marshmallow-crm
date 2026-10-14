-- ISOLATED fixture ONLY. Never apply to an existing project. Synthetic records.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
CREATE TYPE public.app_role AS ENUM('admin','processor','customer_service','opr','cs_admin','opr_admin');
CREATE TABLE public.user_roles(user_id uuid REFERENCES auth.users(id),role public.app_role,PRIMARY KEY(user_id,role));
CREATE FUNCTION public.has_role(uuid,public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role=$2); $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text,can_manage_users boolean DEFAULT false,is_quotation_master boolean DEFAULT false,opr_code text);
CREATE TABLE public.navigation_permissions(id uuid DEFAULT gen_random_uuid(),user_id uuid,nav_section text,allowed boolean,UNIQUE(user_id,nav_section));
CREATE TABLE public.lead_status_visibility(user_id uuid,role text,status text,is_visible boolean);
CREATE TABLE public.activity_logs(user_id uuid,user_name text,action text,target_type text,target_id text,details text,created_at timestamptz DEFAULT now());
CREATE TABLE public.lead_shares(lead_id uuid,shared_with_user_id uuid);
CREATE TABLE public.leads(
 id uuid PRIMARY KEY,job_id text,status text,customer_name text,customer_phone text,customer_landline text,
 service_type text,service_details text,address text,city text,state text,zip_code text,cs_tag text,quote text,show_quote_to_opr boolean,
 tech_name text,tech_number text,customer_schedule_requirements text,scheduled_date date,scheduled_time_start time,
 created_by uuid,assigned_cs uuid,last_edited_by uuid,last_edited_at timestamptz,created_at timestamptz DEFAULT now()
);
CREATE TABLE public.technicians(id uuid PRIMARY KEY,name text,phone_number text,service text,area text,is_active boolean,is_good_tech boolean,opr_code text);
CREATE TABLE public.quo_webhook_events(received_at timestamptz,error_message text);
CREATE TABLE public.quo_ai_settings(key text,value jsonb);
CREATE FUNCTION public.get_sheets_sync_health(integer) RETURNS TABLE(status text,queue_depth integer,failed_jobs integer,leads_behind integer,last_success_at timestamptz)
LANGUAGE sql AS $$ SELECT 'healthy'::text,0,0,0,now(); $$;
GRANT SELECT ON public.user_roles,public.profiles,public.navigation_permissions,public.lead_status_visibility,public.leads,public.technicians,public.lead_shares,public.quo_webhook_events,public.quo_ai_settings TO authenticated;
GRANT INSERT ON public.activity_logs TO authenticated;
GRANT SELECT ON public.activity_logs TO authenticated;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Fixture audit admin" ON public.activity_logs FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE POLICY "Fixture own audit insert" ON public.activity_logs FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Fixture mirrors existing role-scoped reads" ON public.leads FOR SELECT TO authenticated USING(
 public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'processor') OR public.has_role(auth.uid(),'opr') OR
 (public.has_role(auth.uid(),'opr_admin') AND (status='urgent_job' OR created_by=auth.uid())) OR
 (public.has_role(auth.uid(),'cs_admin') AND status NOT IN ('paid','partial_paid','cancelled','job_done','scammed')) OR
 (created_by=auth.uid() OR assigned_cs=auth.uid() OR id IN(SELECT lead_id FROM public.lead_shares WHERE shared_with_user_id=auth.uid()))
);
ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Fixture technician scope" ON public.technicians FOR SELECT TO authenticated USING(
 public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'processor') OR
 (public.has_role(auth.uid(),'opr') AND opr_code=(SELECT p.opr_code FROM public.profiles p WHERE p.id=auth.uid())) OR
 (public.has_role(auth.uid(),'opr_admin') AND opr_code IS NOT NULL));
INSERT INTO auth.users VALUES
 ('9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203'),('5c5aa71f-d441-44ce-ba50-2ccb63ac486f'),
 ('e25b3e94-6559-471a-92ea-f209effa5f02'),('eb18f72a-92f5-405b-83ac-a9192cca1d78'),
 ('7c3ac25f-7106-4bf1-b367-1277cc5c3872'),('0071cf5f-1eec-4ad6-abf7-82e16fee76b1');
INSERT INTO public.user_roles VALUES
 ('9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203','admin'),('5c5aa71f-d441-44ce-ba50-2ccb63ac486f','cs_admin'),
 ('e25b3e94-6559-471a-92ea-f209effa5f02','customer_service'),('eb18f72a-92f5-405b-83ac-a9192cca1d78','processor'),
 ('7c3ac25f-7106-4bf1-b367-1277cc5c3872','opr'),('0071cf5f-1eec-4ad6-abf7-82e16fee76b1','opr_admin');
INSERT INTO public.profiles SELECT id,'Synthetic User',false,false,CASE WHEN id='7c3ac25f-7106-4bf1-b367-1277cc5c3872' THEN 'OPR1' ELSE NULL END FROM auth.users;
INSERT INTO public.leads(id,job_id,status,customer_name,customer_phone,service_type,service_details,address,city,state,quote,show_quote_to_opr,tech_name,tech_number,created_by,created_at,scheduled_date) VALUES
 ('00000000-0000-4000-8000-000000000001','MM-101','urgent_job','Synthetic Own','(555) 010-1000','Plumbing','Synthetic repair','10 Test St Apt 2','Miami','FL','HIDDEN QUOTE',false,'Synthetic Tech','5550101001','e25b3e94-6559-471a-92ea-f209effa5f02','2026-03-08T05:01:00Z','2026-03-08'),
 ('00000000-0000-4000-8000-000000000002','MM-102','need_tech','Synthetic Outside','5550101002','Plumbing','Test','20 Test St','Miami','FL','Other quote',true,'Synthetic Tech','5550101001','eb18f72a-92f5-405b-83ac-a9192cca1d78','2026-03-08T05:01:00Z',NULL),
 ('00000000-0000-4000-8000-000000000003','MM-103','paid','Synthetic Paid','5550101003','Plumbing','Test','30 Test St','Miami','FL','Paid quote',true,NULL,NULL,'9ac11fa9-72e9-4ac8-8c6f-c1a4f413e203','2026-03-08T05:01:00Z',NULL),
 ('00000000-0000-4000-8000-000000000004','MM-104','scheduled','Synthetic Yesterday','5550101004','Plumbing','Test','40 Test St','Miami','FL','Saved quote',true,NULL,NULL,'e25b3e94-6559-471a-92ea-f209effa5f02','2026-03-08T04:59:00Z','2026-03-08');
INSERT INTO public.technicians VALUES
 ('00000000-0000-4000-8000-000000000011','Synthetic Own Tech','(555) 010-1001','Plumbing','Miami',true,true,'OPR1'),
 ('00000000-0000-4000-8000-000000000012','Synthetic Other Tech','5550101002','Electrical','Orlando',false,false,'OPR2');
