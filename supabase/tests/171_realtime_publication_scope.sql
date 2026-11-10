-- READ-ONLY. Safe on the shared project: no writes, no role switch.
-- Covers 20261210000000_realtime_drop_lead_ai_statuses.
-- Run before the migration (expect the first check to FAIL) and after (all PASS).
-- Every row must be PASS after the migration.
WITH listened(tablename) AS (
  -- Tables the CRM / Donut subscribe to with postgres_changes (src/, tmp_extension/)
  -- that are published today. activity_logs and message_templates have listeners
  -- but were never published; that pre-existing gap is out of scope here.
  VALUES ('leads'), ('notifications'), ('quo_messages'), ('quo_conversations'),
         ('technicians'), ('lead_notes'), ('lead_hold_alerts'), ('lead_cx_update_requests'),
         ('lead_copy_role_permissions'), ('lead_copy_user_permissions'),
         ('lead_cancellation_requests'), ('lead_payment_requests'),
         ('lead_quote_approval_requests'), ('map_coverage_areas')
), published AS (
  SELECT tablename FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
)
SELECT 'lead_ai_statuses is not published to Realtime' AS name,
       CASE WHEN NOT EXISTS (SELECT 1 FROM published WHERE tablename = 'lead_ai_statuses')
            THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'still published (has a live listener): ' || l.tablename,
       CASE WHEN EXISTS (SELECT 1 FROM published p WHERE p.tablename = l.tablename)
            THEN 'PASS' ELSE 'FAIL' END
  FROM listened l
UNION ALL
SELECT 'lead_ai_statuses still readable by signed-in users (urgent table join)',
       CASE WHEN has_table_privilege('authenticated', 'public.lead_ai_statuses', 'SELECT')
             AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lead_ai_statuses'::regclass)
            THEN 'PASS' ELSE 'FAIL' END
ORDER BY 1;
