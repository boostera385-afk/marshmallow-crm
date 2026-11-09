-- WRITE-BASED HARNESS. ISOLATED POSTGRES ONLY (scripts/test-notifications-db.mjs).
-- Covers 20261208000000_notification_lifecycle_retention: alerts close when their
-- fact is over, one open Sheets alert, 30-day retention. Everything rolls back.
BEGIN;
CREATE TEMP TABLE results(name text, result text);
CREATE FUNCTION pg_temp.check(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (p_name, CASE WHEN coalesce(p_ok, false) THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.check_error(p_name text, p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; PERFORM pg_temp.check(p_name, false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check(p_name, sqlstate = p_code); END $$;
CREATE FUNCTION pg_temp.unread(p_job text, p_kind text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.notifications n JOIN public.leads l ON l.id = n.lead_id WHERE l.job_id = p_job AND n.kind = p_kind AND NOT n.read;
$$;
CREATE FUNCTION pg_temp.resolved(p_job text, p_kind text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.notifications n JOIN public.leads l ON l.id = n.lead_id WHERE l.job_id = p_job AND n.kind = p_kind AND n.read AND n.resolved_at IS NOT NULL;
$$;
SELECT set_config('request.jwt.claim.sub', '15300000-0000-4000-8000-000000000001', true);

-- One-time clean-up when the migration was applied.
SELECT pg_temp.check('One-time: a decided request''s unread alert was resolved',
  (SELECT read AND resolved_at IS NOT NULL FROM public.notifications WHERE id = '15300000-0000-4000-8000-000000000801'));
SELECT pg_temp.check('One-time: a still-pending request''s alert stays unread',
  (SELECT NOT read FROM public.notifications WHERE id = '15300000-0000-4000-8000-000000000802'));
SELECT pg_temp.check('One-time: only the newest Sheets alert stays open',
  (SELECT read FROM public.notifications WHERE id = '15300000-0000-4000-8000-000000000805')
  AND (SELECT NOT read FROM public.notifications WHERE id = '15300000-0000-4000-8000-000000000806'));

INSERT INTO public.leads(id, job_id, customer_name, status, created_by) VALUES
  ('15300000-0000-4000-8000-000000000201', 'L-A', 'Customer A', 'urgent_job', '15300000-0000-4000-8000-000000000003');
SELECT pg_temp.check('Setup: urgent alerts are open', pg_temp.unread('L-A', 'urgent_job') = 4);
UPDATE public.leads SET status = 'scheduled' WHERE job_id = 'L-A';
SELECT pg_temp.check('Lead leaves Urgent Job: its urgent alerts close for everyone',
  pg_temp.unread('L-A', 'urgent_job') = 0 AND pg_temp.resolved('L-A', 'urgent_job') = 4);
UPDATE public.leads SET status = 'job_in_progress' WHERE job_id = 'L-A';
UPDATE public.leads SET cs_tag = 'incomplete_details' WHERE job_id = 'L-A';
UPDATE public.leads SET cs_tag = NULL WHERE job_id = 'L-A';
SELECT pg_temp.check('Tag removed: Incomplete Details alerts close', pg_temp.unread('L-A', 'incomplete_details') = 0
  AND pg_temp.resolved('L-A', 'incomplete_details') = 2);
SELECT pg_temp.check('Other open alerts on the lead are untouched', pg_temp.unread('L-A', 'job_in_progress') = 2);

-- Requests.
INSERT INTO public.lead_cancellation_requests(id, lead_id, requested_by, requested_by_role, status) VALUES
  ('15300000-0000-4000-8000-000000000301', '15300000-0000-4000-8000-000000000201', '15300000-0000-4000-8000-000000000003', 'customer_service', 'pending'),
  ('15300000-0000-4000-8000-000000000302', '15300000-0000-4000-8000-000000000201', '15300000-0000-4000-8000-000000000004', 'customer_service', 'pending');
UPDATE public.lead_cancellation_requests SET status = 'rejected' WHERE id = '15300000-0000-4000-8000-000000000301';
SELECT pg_temp.check('One request decided while another is pending: alert stays open', pg_temp.unread('L-A', 'cancellation_request') > 0);
UPDATE public.lead_cancellation_requests SET status = 'approved' WHERE id = '15300000-0000-4000-8000-000000000302';
SELECT pg_temp.check('Last pending cancellation decided: alerts close', pg_temp.unread('L-A', 'cancellation_request') = 0);
INSERT INTO public.lead_payment_requests(id, lead_id, requested_by, requested_by_role, status) VALUES
  ('15300000-0000-4000-8000-000000000401', '15300000-0000-4000-8000-000000000201', '15300000-0000-4000-8000-000000000002', 'processor', 'pending');
SELECT pg_temp.check('Setup: paid approval alert open', pg_temp.unread('L-A', 'paid_approval_request') > 0);
UPDATE public.lead_payment_requests SET status = 'approved' WHERE id = '15300000-0000-4000-8000-000000000401';
SELECT pg_temp.check('Paid request decided: alerts close', pg_temp.unread('L-A', 'paid_approval_request') = 0);

-- Sheets health.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
UPDATE public.fixture_sheets_health SET status = 'degraded', consecutive_failures = 3, failed_jobs = 2, queue_depth = 9, last_error_message = 'timeout';
SELECT public.raise_sheets_sync_stale_alert(900, 15);
SELECT public.raise_sheets_sync_stale_alert(900, 15);
SELECT pg_temp.check('Sheets: one open alert per Admin, refreshed instead of copied',
  (SELECT count(*) = 2 FROM public.notifications WHERE title = '[Alert] Google Sheets backup is behind' AND NOT read)
  AND (SELECT count(*) = 2 FROM public.notifications WHERE title = '[Alert] Google Sheets backup is behind' AND NOT read AND message LIKE 'Status degraded.%'));
UPDATE public.fixture_sheets_health SET status = 'healthy';
SELECT public.raise_sheets_sync_stale_alert(900, 15);
SELECT pg_temp.check('Sheets healthy again: the alert closes',
  NOT EXISTS (SELECT 1 FROM public.notifications WHERE title = '[Alert] Google Sheets backup is behind' AND NOT read));
SELECT set_config('request.jwt.claim.role', '', true);

-- Retention.
SELECT pg_temp.check_error('Retention below 30 days is refused', $q$SELECT marshmallow_private.purge_old_notifications(7)$q$, '22023');
CREATE TEMP TABLE purged AS SELECT marshmallow_private.purge_old_notifications(30) AS n;
SELECT pg_temp.check('Retention removes only rows older than 30 days', (SELECT n = 1 FROM purged)
  AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE id = '15300000-0000-4000-8000-000000000803')
  AND EXISTS (SELECT 1 FROM public.notifications WHERE id = '15300000-0000-4000-8000-000000000804'));
SELECT pg_temp.check('Retention also removes the deleted rows'' workflow events',
  NOT EXISTS (SELECT 1 FROM public.workflow_notification_events WHERE notification_id = '15300000-0000-4000-8000-000000000803'));
SELECT pg_temp.check('Browsers cannot run the clean-up', NOT has_function_privilege('authenticated', 'marshmallow_private.purge_old_notifications(integer)', 'EXECUTE'));
SELECT name, result FROM results ORDER BY name;
ROLLBACK;
