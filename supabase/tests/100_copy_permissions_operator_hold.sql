-- Behavioral regression harness. MANUAL, write-based, synthetic lead only.
-- Requires the Copy Details / operator hold migration and existing users with
-- admin, opr, opr_admin and customer_service roles. Everything rolls back.
-- Run on an isolated test DB first; get explicit approval before shared-project use.
BEGIN;
CREATE TEMP TABLE hold_test_context AS
SELECT gen_random_uuid() AS lead_id,
  (SELECT user_id FROM public.user_roles WHERE role = 'admin' ORDER BY user_id LIMIT 1) AS admin_id,
  (SELECT user_id FROM public.user_roles WHERE role = 'opr' ORDER BY user_id LIMIT 1) AS opr_id,
  (SELECT user_id FROM public.user_roles WHERE role = 'opr_admin' ORDER BY user_id LIMIT 1) AS opr_admin_id,
  (SELECT user_id FROM public.user_roles WHERE role = 'customer_service' ORDER BY user_id LIMIT 1) AS cs_id;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM hold_test_context WHERE admin_id IS NULL OR opr_id IS NULL OR opr_admin_id IS NULL OR cs_id IS NULL) THEN
    RAISE EXCEPTION 'Harness needs admin, opr, opr_admin and customer_service test users';
  END IF;
END $$;
CREATE TEMP TABLE hold_test_results(name text, result text);
CREATE TEMP TABLE hold_test_versions(id uuid, revision uuid, observed_at timestamptz);
GRANT SELECT ON hold_test_context TO authenticated;
GRANT SELECT, INSERT, DELETE ON hold_test_results, hold_test_versions TO authenticated;
CREATE FUNCTION pg_temp.hold_check(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO hold_test_results VALUES(p_name, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.hold_as_user(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',p_id,'role','authenticated')::text, true);
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.hold_as_user(admin_id) FROM hold_test_context;
SELECT public.set_lead_copy_permission('opr',NULL,true);
SELECT public.set_lead_copy_permission('opr_admin',NULL,true);
SELECT public.set_lead_copy_permission(NULL,opr_id,NULL) FROM hold_test_context;
SELECT public.set_lead_copy_permission(NULL,opr_admin_id,NULL) FROM hold_test_context;
SELECT pg_temp.hold_as_user(opr_id) FROM hold_test_context;
SELECT pg_temp.hold_check('OPR enabled by default', public.get_lead_copy_access());
SELECT pg_temp.hold_as_user(opr_admin_id) FROM hold_test_context;
SELECT pg_temp.hold_check('OPR Admin enabled by default', public.get_lead_copy_access());
DO $$ BEGIN
  BEGIN
    PERFORM public.set_lead_copy_permission('opr',NULL,false);
    PERFORM pg_temp.hold_check('Non-admin cannot change role permissions', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.hold_check('Non-admin cannot change role permissions', true);
  END;
  BEGIN
    INSERT INTO public.lead_copy_user_permissions(user_id,allowed)
    SELECT opr_admin_id,true FROM hold_test_context;
    PERFORM pg_temp.hold_check('No direct self-grant bypass', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.hold_check('No direct self-grant bypass', true);
  END;
END $$;
SELECT pg_temp.hold_as_user(admin_id) FROM hold_test_context;
SELECT public.set_lead_copy_permission('opr',NULL,false);
SELECT pg_temp.hold_as_user(opr_id) FROM hold_test_context;
SELECT pg_temp.hold_check('Role deny takes effect', NOT public.get_lead_copy_access());
SELECT pg_temp.hold_as_user(admin_id) FROM hold_test_context;
SELECT public.set_lead_copy_permission(NULL,opr_id,true) FROM hold_test_context;
SELECT pg_temp.hold_as_user(opr_id) FROM hold_test_context;
SELECT pg_temp.hold_check('User allow overrides role deny', public.get_lead_copy_access());
SELECT pg_temp.hold_as_user(admin_id) FROM hold_test_context;
SELECT public.set_lead_copy_permission('opr',NULL,true);
SELECT public.set_lead_copy_permission(NULL,opr_id,false) FROM hold_test_context;
SELECT pg_temp.hold_as_user(opr_id) FROM hold_test_context;
SELECT pg_temp.hold_check('User deny overrides role allow', NOT public.get_lead_copy_access());
SELECT pg_temp.hold_as_user(admin_id) FROM hold_test_context;
SELECT public.set_lead_copy_permission(NULL,opr_id,NULL) FROM hold_test_context;
SELECT pg_temp.hold_as_user(opr_id) FROM hold_test_context;
SELECT pg_temp.hold_check('Inherit removes the override', public.get_lead_copy_access());

RESET ROLE;
SELECT pg_temp.hold_as_user(admin_id) FROM hold_test_context;
INSERT INTO public.leads(id,job_id,status,customer_name,customer_phone,service_type,created_by,
  address,service_details,customer_schedule_requirements,scheduled_date,scheduled_time_start,quote,show_quote_to_opr)
SELECT lead_id,'HOLD-TEST-'||lead_id::text,'urgent_job','Synthetic hold harness','5550100000','Plumbing',admin_id,
  '','Synthetic repair','Friday afternoon','2026-10-16','13:00:00','PRIVATE QUOTE',false
FROM hold_test_context;
INSERT INTO public.notifications(user_id,lead_id,title,message)
SELECT opr_id,lead_id,'[Alert] Urgent Job','Synthetic urgent alert' FROM hold_test_context;
UPDATE public.leads SET cs_tag = 'ready_to_schedule' WHERE id = (SELECT lead_id FROM hold_test_context);
SELECT pg_temp.hold_check('All OPR/OPR Admin users notified without assignment',
  (SELECT count(*) FROM public.lead_hold_alerts WHERE lead_id=(SELECT lead_id FROM hold_test_context)) =
  (SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role IN ('opr','opr_admin')));
SELECT pg_temp.hold_check('Only operator roles receive holds', NOT EXISTS(
  SELECT 1 FROM public.lead_hold_alerts a WHERE lead_id=(SELECT lead_id FROM hold_test_context)
  AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=a.user_id AND r.role IN ('opr','opr_admin'))));
SELECT pg_temp.hold_check('Hidden quote redacted before storage', NOT EXISTS(
  SELECT 1 FROM public.lead_hold_alerts WHERE lead_id=(SELECT lead_id FROM hold_test_context) AND snapshot->>'quote' IS NOT NULL));
SELECT pg_temp.hold_check('Private fields absent from snapshot', NOT EXISTS(
  SELECT 1 FROM public.lead_hold_alerts WHERE lead_id=(SELECT lead_id FROM hold_test_context)
  AND (snapshot ? 'customer_email' OR snapshot ? 'processor_notes' OR snapshot ? 'payment_screenshot_url')));
SELECT pg_temp.hold_check('Obsolete OPR urgent alert cleared', NOT EXISTS(
  SELECT 1 FROM public.notifications WHERE lead_id=(SELECT lead_id FROM hold_test_context)
  AND title='[Alert] Urgent Job' AND user_id=(SELECT opr_id FROM hold_test_context) AND read=false));
INSERT INTO hold_test_versions SELECT id,revision,clock_timestamp() FROM public.lead_hold_alerts
WHERE user_id=(SELECT opr_id FROM hold_test_context) AND lead_id=(SELECT lead_id FROM hold_test_context);
UPDATE public.leads SET cs_tag='waiting_schedule_confirmation' WHERE id=(SELECT lead_id FROM hold_test_context);
SELECT pg_temp.hold_check('Waiting for CX schedule confirmation refreshes the hold card', EXISTS(
  SELECT 1 FROM public.lead_hold_alerts
  WHERE id=(SELECT id FROM hold_test_versions)
    AND reason='waiting_schedule_confirmation'
    AND revision<>(SELECT revision FROM hold_test_versions)));
UPDATE hold_test_versions v SET revision=a.revision, observed_at=clock_timestamp()
FROM public.lead_hold_alerts a WHERE a.id=v.id;
UPDATE public.leads SET cs_tag='waiting_schedule_confirmation',service_details='Unrelated edit' WHERE id=(SELECT lead_id FROM hold_test_context);
SELECT pg_temp.hold_check('Repeated tag and unrelated edits do not alert',
  (SELECT revision FROM public.lead_hold_alerts WHERE id=(SELECT id FROM hold_test_versions)) = (SELECT revision FROM hold_test_versions));
UPDATE public.leads SET cs_tag='booked' WHERE id=(SELECT lead_id FROM hold_test_context);
SELECT pg_temp.hold_check('Booked is not Scheduled',
  (SELECT revision FROM public.lead_hold_alerts WHERE id=(SELECT id FROM hold_test_versions)) = (SELECT revision FROM hold_test_versions));
UPDATE public.leads SET status='scheduled',cs_tag=NULL WHERE id=(SELECT lead_id FROM hold_test_context);
SELECT pg_temp.hold_check('Scheduled coalesces the existing unread card',
  (SELECT count(*) FROM public.lead_hold_alerts WHERE user_id=(SELECT opr_id FROM hold_test_context) AND lead_id=(SELECT lead_id FROM hold_test_context))=1
  AND (SELECT reason FROM public.lead_hold_alerts WHERE id=(SELECT id FROM hold_test_versions))='scheduled');
SELECT pg_temp.hold_check('Schedule requirement/date/time preserved',
  EXISTS(SELECT 1 FROM public.leads WHERE id=(SELECT lead_id FROM hold_test_context)
  AND customer_schedule_requirements='Friday afternoon' AND scheduled_date='2026-10-16' AND scheduled_time_start='13:00:00'));

SET LOCAL ROLE authenticated;
SELECT pg_temp.hold_as_user(opr_id) FROM hold_test_context;
SELECT pg_temp.hold_check('OPR sees only own alert projections',
  NOT EXISTS(SELECT 1 FROM public.lead_hold_alerts WHERE user_id<>auth.uid()));
SELECT pg_temp.hold_check('Stale acknowledgement cannot clear a newer revision',
  public.acknowledge_operator_hold_alert((SELECT id FROM hold_test_versions),(SELECT revision FROM hold_test_versions),NULL)=0);
SELECT pg_temp.hold_check('Mark all does not swallow newly refreshed alerts',
  public.acknowledge_operator_hold_alert(NULL,NULL,(SELECT jsonb_agg(jsonb_build_object('id',id,'revision',revision)) FROM hold_test_versions))=0);
DO $$ BEGIN
  BEGIN
    UPDATE public.lead_hold_alerts SET snapshot='{}'::jsonb WHERE id=(SELECT id FROM hold_test_versions);
    PERFORM pg_temp.hold_check('Snapshot cannot be edited by recipient', false);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.hold_check('Snapshot cannot be edited by recipient', true);
  END;
END $$;
SELECT pg_temp.hold_as_user(opr_admin_id) FROM hold_test_context;
SELECT pg_temp.hold_check('OPR Admin cannot acknowledge OPR inbox',
  public.acknowledge_operator_hold_alert((SELECT id FROM hold_test_versions),(SELECT revision FROM public.lead_hold_alerts LIMIT 1),NULL)=0);
SELECT pg_temp.hold_as_user(cs_id) FROM hold_test_context;
SELECT pg_temp.hold_check('CS cannot read operator snapshots', NOT EXISTS(SELECT 1 FROM public.lead_hold_alerts));
SELECT pg_temp.hold_as_user(opr_id) FROM hold_test_context;
SELECT pg_temp.hold_check('Current revision acknowledges only own alert',
  public.acknowledge_operator_hold_alert((SELECT id FROM hold_test_versions),
    (SELECT revision FROM public.lead_hold_alerts WHERE id=(SELECT id FROM hold_test_versions)),NULL)=1);

RESET ROLE;
SELECT pg_temp.hold_as_user(admin_id) FROM hold_test_context;
UPDATE public.leads SET status='cancelled' WHERE id=(SELECT lead_id FROM hold_test_context);
SELECT pg_temp.hold_check('Non-urgent cancellation creates no new hold',
  (SELECT count(*) FROM public.lead_hold_alerts WHERE user_id=(SELECT opr_id FROM hold_test_context) AND lead_id=(SELECT lead_id FROM hold_test_context))=1);
UPDATE public.leads SET status='urgent_job',cs_tag=NULL WHERE id=(SELECT lead_id FROM hold_test_context);
UPDATE public.leads SET status='cancellation_requested' WHERE id=(SELECT lead_id FROM hold_test_context);
SELECT pg_temp.hold_check('Cancellation request alone does not alert',
  (SELECT count(*) FROM public.lead_hold_alerts WHERE user_id=(SELECT opr_id FROM hold_test_context) AND lead_id=(SELECT lead_id FROM hold_test_context))=1);
UPDATE public.leads SET status='cancelled' WHERE id=(SELECT lead_id FROM hold_test_context);
SELECT pg_temp.hold_check('Final cancellation remembers its urgent origin', EXISTS(
  SELECT 1 FROM public.lead_hold_alerts WHERE lead_id=(SELECT lead_id FROM hold_test_context)
  AND user_id=(SELECT opr_id FROM hold_test_context) AND reason='cancelled' AND read=false));
UPDATE public.leads SET status='urgent_job' WHERE id=(SELECT lead_id FROM hold_test_context);
UPDATE public.leads SET status='cancellation_requested' WHERE id=(SELECT lead_id FROM hold_test_context);
UPDATE public.leads SET status='urgent_job' WHERE id=(SELECT lead_id FROM hold_test_context);
SELECT pg_temp.hold_check('Rejected request removes its cancellation marker', NOT EXISTS(
  SELECT 1 FROM marshmallow_private.urgent_cancellation_origins WHERE lead_id=(SELECT lead_id FROM hold_test_context)));
UPDATE public.leads SET status='cancelled' WHERE id=(SELECT lead_id FROM hold_test_context);
SELECT pg_temp.hold_check('Direct urgent cancellation is detected', EXISTS(
  SELECT 1 FROM public.lead_hold_alerts WHERE lead_id=(SELECT lead_id FROM hold_test_context) AND reason='cancelled'));
SELECT pg_temp.hold_check('Realtime publications enabled', (SELECT count(*) FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND schemaname='public'
  AND tablename IN ('notifications','lead_hold_alerts','lead_copy_role_permissions','lead_copy_user_permissions'))=4);

SELECT * FROM hold_test_results ORDER BY name;
ROLLBACK;
