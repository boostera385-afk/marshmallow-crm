-- READ-ONLY. Safe on the shared project: no writes, no role switch.
-- Covers 20261210080000_realtime_trim_unsubscribed_tables.
-- Run before the migration (expect the "no longer published" checks to FAIL)
-- and after (all PASS). Every row must be PASS after the migration.
WITH listened(tablename) AS (
  -- Tables the CRM / Donut subscribe to with postgres_changes (src/, tmp_extension/)
  -- as audited on 2026-11-11. activity_logs and message_templates have listeners
  -- but were never published; that pre-existing gap is out of scope here.
  VALUES ('leads'), ('notifications'), ('quo_messages'), ('quo_conversations'),
         ('technicians'), ('lead_notes'), ('lead_hold_alerts'), ('lead_cx_update_requests'),
         ('lead_copy_role_permissions'), ('lead_copy_user_permissions'),
         ('lead_cancellation_requests'), ('lead_payment_requests'),
         ('lead_quote_approval_requests'), ('map_coverage_areas')
), dropped(tablename) AS (
  -- Published until this migration, but with no postgres_changes listener in
  -- the CRM, Donut or any Edge Function.
  VALUES ('crm_updates'), ('lead_operator_assignments'), ('lead_photos'),
         ('lead_urgent_review_requests'), ('quo_number_preferences'),
         ('quo_outbound_messages'), ('quo_pinned_conversations'),
         ('technician_change_requests')
), published AS (
  SELECT tablename FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
)
SELECT 'no longer published (no listener anywhere): ' || d.tablename AS name,
       CASE WHEN NOT EXISTS (SELECT 1 FROM published p WHERE p.tablename = d.tablename)
            THEN 'PASS' ELSE 'FAIL' END AS result
  FROM dropped d
UNION ALL
SELECT 'still published (has a live listener): ' || l.tablename,
       CASE WHEN EXISTS (SELECT 1 FROM published p WHERE p.tablename = l.tablename)
            THEN 'PASS' ELSE 'FAIL' END
  FROM listened l
UNION ALL
-- The publication should now be exactly the listened set: anything else is a
-- new unaudited table that someone must either subscribe to or drop.
SELECT 'published but in neither audited list: ' || p.tablename,
       'FAIL'
  FROM published p
 WHERE p.tablename NOT IN (SELECT tablename FROM listened)
ORDER BY 1;
