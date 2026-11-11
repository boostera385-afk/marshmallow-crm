-- READ-ONLY. Safe on the shared project: no writes, no role switch.
-- Covers 20261210070000_rls_initplan_wrap_auth_uid.
-- Run before the migration (expect FAILs) and after (all PASS).
--
-- The migration must leave no policy expression on these tables calling
-- auth.uid() outside a (SELECT ...) wrapper, and must not change which
-- policies exist. pg_get_expr prints a wrapped call as "( SELECT auth.uid()",
-- so a bare "auth.uid()" preceded by anything other than "SELECT " marks a
-- per-row re-evaluation (the advisor's auth_rls_initplan finding).
WITH affected(tablename) AS (
  VALUES ('google_sheets_sync_errors'), ('google_sheets_sync_health'),
         ('google_sheets_sync_queue'), ('lead_cancellation_requests'),
         ('lead_notes'), ('lead_updates'), ('lead_urgent_review_requests'),
         ('leads'), ('optimized_areas'), ('profiles'),
         ('technician_change_requests'), ('user_access_codes')
), policies AS (
  SELECT p.tablename, p.policyname,
         coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') AS expr
    FROM pg_policies p
    JOIN affected a ON a.tablename = p.tablename
   WHERE p.schemaname = 'public'
)
SELECT 'no bare auth.uid(): ' || tablename || ' / ' || policyname AS name,
       -- Remove every wrapped occurrence; anything left is a bare per-row call.
       CASE WHEN regexp_replace(expr, 'SELECT auth\.uid\(\)', '', 'g') NOT LIKE '%auth.uid()%'
            THEN 'PASS' ELSE 'FAIL' END AS result
  FROM policies
UNION ALL
-- Policy inventory must not change: the migration ALTERs expressions only.
SELECT 'policy count unchanged on ' || tablename,
       CASE count(*)
         WHEN (CASE tablename
                 WHEN 'google_sheets_sync_errors' THEN 1
                 WHEN 'google_sheets_sync_health' THEN 1
                 WHEN 'google_sheets_sync_queue' THEN 2
                 WHEN 'lead_cancellation_requests' THEN 6
                 WHEN 'lead_notes' THEN 5
                 WHEN 'lead_updates' THEN 3
                 WHEN 'lead_urgent_review_requests' THEN 3
                 WHEN 'leads' THEN 5
                 WHEN 'optimized_areas' THEN 4
                 WHEN 'profiles' THEN 4
                 WHEN 'technician_change_requests' THEN 4
                 WHEN 'user_access_codes' THEN 5
               END)
         THEN 'PASS' ELSE 'FAIL' END
  FROM policies
 GROUP BY tablename
ORDER BY 1;
