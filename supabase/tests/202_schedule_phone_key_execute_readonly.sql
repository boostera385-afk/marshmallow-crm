-- POST-INSTALL read-only checks for
-- 20261231001000_schedule_phone_key_index_execute.sql.
-- No fixtures, writes, role impersonation or provider calls.
WITH fn AS (SELECT to_regprocedure('marshmallow_private.schedule_phone_key(text)') AS oid),
checks(name, ok) AS (
  VALUES
    ('Phone-key helper installed', (SELECT oid FROM fn) IS NOT NULL),
    ('Phone-key helper is pure (IMMUTABLE, invoker)',
      coalesce((SELECT provolatile = 'i' AND NOT prosecdef FROM pg_proc WHERE oid = (SELECT oid FROM fn)), false)),
    ('Phone-key helper normalizes a formatted number',
      marshmallow_private.schedule_phone_key('+1 (727) 851-4535') IS NOT DISTINCT FROM '7278514535'),
    ('Phone-key helper ignores short numbers',
      marshmallow_private.schedule_phone_key('851-4535') IS NULL),
    ('Signed-in writers can maintain the phone-key indexes',
      coalesce(has_function_privilege('authenticated', (SELECT oid FROM fn), 'EXECUTE'), false)),
    ('Service-role writers can maintain the phone-key indexes',
      coalesce(has_function_privilege('service_role', (SELECT oid FROM fn), 'EXECUTE'), false)),
    ('Anonymous execution still denied',
      NOT coalesce(has_function_privilege('anon', (SELECT oid FROM fn), 'EXECUTE'), true)),
    ('Every public index function is executable by authenticated',
      NOT EXISTS (
        SELECT 1
        FROM pg_index x
        JOIN pg_class c ON c.oid = x.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = x.indexrelid
                        AND d.refclassid = 'pg_proc'::regclass
        WHERE NOT has_function_privilege('authenticated', d.refobjid, 'EXECUTE')))
)
SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks ORDER BY name;
