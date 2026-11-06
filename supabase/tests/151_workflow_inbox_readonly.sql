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
    ('Requester revision column installed',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_cx_update_requests' AND column_name='revision')),
    -- 20261130000000_ai_schedule_confirmation
    ('AI tag marker column installed',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='cs_tag_source')),
    ('AI tag marker trigger installed',EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='leads_stamp_cs_tag_source' AND NOT tgisinternal)),
    ('New waiting leads are queued',EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='leads_schedule_monitor_queue_insert' AND NOT tgisinternal)),
    ('Exact job/date/time rule retired',to_regprocedure('marshmallow_private.schedule_exact_confirmation(public.leads,jsonb)') IS NULL),
    -- 20261201000000_ai_schedule_confirmation_calls
    ('Customer words checked in texts and calls',to_regprocedure('marshmallow_private.schedule_quote_is_customer(public.quo_conversations,public.leads,timestamp with time zone,text)') IS NOT NULL),
    ('Call transcript speakers are read',to_regprocedure('marshmallow_private.schedule_dialogue(jsonb,text[])') IS NOT NULL),
    -- 20261202000000_ai_schedule_new_schedule_tag
    ('New-schedule alert type allowed',EXISTS(SELECT 1 FROM pg_constraint WHERE conname='workflow_notification_events_event_type_check'
      AND pg_get_constraintdef(oid) LIKE '%schedule_new_needed%')),
    ('Worker can record a new-schedule decision',position('new_schedule_needed' IN coalesce(pg_get_functiondef(to_regprocedure('public.finish_schedule_check(jsonb)')),''))>0),
    ('New-schedule alerts are listed as Schedule',position('schedule_new_needed' IN coalesce(pg_get_functiondef(to_regprocedure('public.workflow_notifications(jsonb)')),''))>0),
    ('Every waiting lead is queued',NOT EXISTS(SELECT 1 FROM public.leads l WHERE l.cs_tag='waiting_schedule_confirmation'
      AND NOT EXISTS(SELECT 1 FROM marshmallow_private.schedule_monitor_queue q WHERE q.lead_id=l.id)))
)
SELECT name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks ORDER BY name;
