-- POST-INSTALL read-only checks. No fixtures, writes, role impersonation or
-- provider calls. Safe to review/run after approved installation on intended DB.
WITH checks(name,ok) AS (
  VALUES
    ('Request RPC installed',to_regprocedure('public.workflow_requests(jsonb)') IS NOT NULL),
    ('Notification RPC installed',to_regprocedure('public.workflow_notifications(jsonb)') IS NOT NULL),
    ('Admin monitor RPC installed',to_regprocedure('public.schedule_monitor_admin(jsonb)') IS NOT NULL),
    ('Event RLS enabled',coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.workflow_notification_events')),false)),
    ('Anonymous request execution denied',NOT coalesce(has_function_privilege('anon',to_regprocedure('public.workflow_requests(jsonb)'),'EXECUTE'),true)),
    ('Browser worker claim denied',NOT coalesce(has_function_privilege('authenticated',to_regprocedure('public.claim_schedule_checks()'),'EXECUTE'),true)),
    ('Browser worker finish denied',NOT coalesce(has_function_privilege('authenticated',to_regprocedure('public.finish_schedule_check(jsonb)'),'EXECUTE'),true)),
    ('Service worker finish allowed',coalesce(has_function_privilege('service_role',to_regprocedure('public.finish_schedule_check(jsonb)'),'EXECUTE'),false)),
    ('Server event writes denied',NOT coalesce(has_table_privilege('authenticated',to_regclass('public.workflow_notification_events'),'INSERT'),true)),
    ('Trusted-message trigger installed',EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='quo_messages_schedule_evidence' AND NOT tgisinternal)),
    ('Pause invalidation trigger installed',EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='settings_invalidate_schedule_evidence' AND NOT tgisinternal)),
    ('Requester revision column installed',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_cx_update_requests' AND column_name='revision'))
)
SELECT name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks ORDER BY name;
