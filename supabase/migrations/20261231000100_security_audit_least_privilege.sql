-- =============================================================================
-- Migration : 20261231000100_security_audit_least_privilege.sql
-- Purpose   : Close the access gaps found by the 2026-11-21 security audit
--             (verified read-only against production that day).
--
-- DEFECTS
--   1. public.quo_conversations / public.quo_messages: every signed-in user,
--      including OPR, OPR Admin and accounts with no role, could read every
--      customer SMS and call transcript (SELECT USING (true)).
--   2. Any signed-in user could UPDATE any quo_conversations column, including
--      linked_lead_id, customer_number and customer_name, and INSERT fabricated
--      conversations or customer-side messages (WITH CHECK (true)).
--   3. public.quo_number_preferences: any signed-in user could rewrite the Quo
--      Monitor number layout.
--   4. storage.objects (bucket lead-photos): any signed-in user could DELETE any
--      object, including another user's payment screenshot or cancellation
--      proof. The lead_photos table already limits row deletes to Admin or the
--      uploader; storage is brought in line (plus Processor, who replaces
--      operator-assignment photos).
--   5. SECURITY DEFINER RPCs without a caller check:
--        assign_next_opr_code(uuid)          - wrote an OPR code onto any profile
--        list_technician_change_requests(text) - reasons/requesters to every role
--        list_opr_codes()                    - every OPR code + full name
--      and four definer functions were executable by `anon`.
--   6. anon/authenticated held TRUNCATE/TRIGGER/REFERENCES on these tables
--      (Supabase defaults). TRUNCATE bypasses RLS.
--
-- WHO KEEPS ACCESS (traced from src/ and tmp_extension/ on 2026-11-21)
--   * Quo conversations/messages are read by Admin, Processor (Processor Board,
--     Quo Monitor grant), CS Admin and CS (AI Assistance follow-ups, lead-card
--     Quo indicators, Quo chat). OPR / OPR Admin never receive customer phone
--     numbers (get_operator_safe_leads nulls them), so they lose nothing.
--   * The only client writes are QuoChatDialog (agent outbound message + the
--     four last-message columns) and QuoDashboardPage (status/current_status).
--     Edge Functions and SECURITY DEFINER RPCs use their own privileges and are
--     unaffected. No client writes linked_lead_id.
--   * Donut does not touch the quo_* tables directly.
--
-- NOT CHANGED HERE (needs a product decision; see audit handoff)
--   * lead-photos bucket is public; Google Sheets export uses public URLs.
--   * lead_photos / user_roles / lead_operator_assignments SELECT USING (true).
--
-- HARNESS : supabase/tests/190_security_audit_least_privilege.sql
--           (isolated PGlite: node scripts/test-security-audit-db.mjs <pglite dir>)
--
-- ROLLBACK (restores the previous, over-broad behaviour; not recommended)
/*
DROP POLICY IF EXISTS "CRM staff read quo_conversations" ON public.quo_conversations;
DROP POLICY IF EXISTS "CRM staff update quo_conversations" ON public.quo_conversations;
CREATE POLICY "Allow all authenticated read on quo_conversations" ON public.quo_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert on quo_conversations" ON public.quo_conversations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update on quo_conversations" ON public.quo_conversations FOR UPDATE TO authenticated USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quo_conversations TO authenticated;
DROP POLICY IF EXISTS "CRM staff read quo_messages" ON public.quo_messages;
DROP POLICY IF EXISTS "CRM staff log outbound agent messages" ON public.quo_messages;
CREATE POLICY "Allow all authenticated read on quo_messages" ON public.quo_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert on quo_messages" ON public.quo_messages FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "CRM staff read quo_number_preferences" ON public.quo_number_preferences;
DROP POLICY IF EXISTS "Quo Monitor managers insert quo_number_preferences" ON public.quo_number_preferences;
DROP POLICY IF EXISTS "Quo Monitor managers update quo_number_preferences" ON public.quo_number_preferences;
CREATE POLICY "Allow authenticated read on quo_number_preferences" ON public.quo_number_preferences FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert on quo_number_preferences" ON public.quo_number_preferences FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update on quo_number_preferences" ON public.quo_number_preferences FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin, processor or uploader can delete lead-photos" ON storage.objects;
CREATE POLICY "Authenticated users can delete lead-photos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'lead-photos');
-- Functions: re-run the previous definitions from pg_get_functiondef (captured
-- in the audit) and GRANT EXECUTE ... TO anon on the four follow-up functions.
*/
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers (private schema: not exposed as /rest/v1/rpc endpoints)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marshmallow_private.is_crm_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
     WHERE r.user_id = (SELECT auth.uid())
       AND r.role::text IN ('admin', 'processor', 'cs_admin', 'customer_service')
  );
$$;
REVOKE ALL ON FUNCTION marshmallow_private.is_crm_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.is_crm_staff() TO authenticated;

-- Admin, or a user an Admin granted the Quo Monitor screen.
CREATE OR REPLACE FUNCTION marshmallow_private.can_manage_quo_monitor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.navigation_permissions np
         WHERE np.user_id = (SELECT auth.uid())
           AND np.nav_section = 'quo_monitor'
           AND np.allowed IS TRUE
      );
$$;
REVOKE ALL ON FUNCTION marshmallow_private.can_manage_quo_monitor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.can_manage_quo_monitor() TO authenticated;

-- ---------------------------------------------------------------------------
-- 1-2. quo_conversations
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all authenticated read on quo_conversations" ON public.quo_conversations;
DROP POLICY IF EXISTS "Allow authenticated insert on quo_conversations" ON public.quo_conversations;
DROP POLICY IF EXISTS "Allow authenticated update on quo_conversations" ON public.quo_conversations;
DROP POLICY IF EXISTS "CRM staff read quo_conversations" ON public.quo_conversations;
DROP POLICY IF EXISTS "CRM staff update quo_conversations" ON public.quo_conversations;

CREATE POLICY "CRM staff read quo_conversations"
  ON public.quo_conversations FOR SELECT TO authenticated
  USING ((SELECT marshmallow_private.is_crm_staff()));

CREATE POLICY "CRM staff update quo_conversations"
  ON public.quo_conversations FOR UPDATE TO authenticated
  USING ((SELECT marshmallow_private.is_crm_staff()))
  WITH CHECK ((SELECT marshmallow_private.is_crm_staff()));

-- Conversations are created only by server-side ingestion. Clients may update
-- just the columns the CRM writes; link/identity/AI columns stay server-owned.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.quo_conversations FROM anon, authenticated;
REVOKE SELECT ON public.quo_conversations FROM anon;
GRANT SELECT ON public.quo_conversations TO authenticated;
GRANT UPDATE (last_message_preview, last_message_at, last_message_time, last_agent_message_at,
              status, current_status, updated_at)
  ON public.quo_conversations TO authenticated;

-- ---------------------------------------------------------------------------
-- 1-2. quo_messages
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all authenticated read on quo_messages" ON public.quo_messages;
DROP POLICY IF EXISTS "Allow authenticated insert on quo_messages" ON public.quo_messages;
DROP POLICY IF EXISTS "CRM staff read quo_messages" ON public.quo_messages;
DROP POLICY IF EXISTS "CRM staff log outbound agent messages" ON public.quo_messages;

CREATE POLICY "CRM staff read quo_messages"
  ON public.quo_messages FOR SELECT TO authenticated
  USING ((SELECT marshmallow_private.is_crm_staff()));

-- QuoChatDialog logs the agent's own outbound text. A client can never insert
-- a message that claims to come from the customer.
CREATE POLICY "CRM staff log outbound agent messages"
  ON public.quo_messages FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT marshmallow_private.is_crm_staff())
    AND sender = 'agent'
    AND direction = 'outbound'
  );

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.quo_messages FROM anon, authenticated;
REVOKE SELECT, INSERT ON public.quo_messages FROM anon;

-- ---------------------------------------------------------------------------
-- 3. quo_number_preferences
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated read on quo_number_preferences" ON public.quo_number_preferences;
DROP POLICY IF EXISTS "Allow authenticated insert on quo_number_preferences" ON public.quo_number_preferences;
DROP POLICY IF EXISTS "Allow authenticated update on quo_number_preferences" ON public.quo_number_preferences;
DROP POLICY IF EXISTS "CRM staff read quo_number_preferences" ON public.quo_number_preferences;
DROP POLICY IF EXISTS "Quo Monitor managers insert quo_number_preferences" ON public.quo_number_preferences;
DROP POLICY IF EXISTS "Quo Monitor managers update quo_number_preferences" ON public.quo_number_preferences;

CREATE POLICY "CRM staff read quo_number_preferences"
  ON public.quo_number_preferences FOR SELECT TO authenticated
  USING ((SELECT marshmallow_private.is_crm_staff()));
CREATE POLICY "Quo Monitor managers insert quo_number_preferences"
  ON public.quo_number_preferences FOR INSERT TO authenticated
  WITH CHECK ((SELECT marshmallow_private.can_manage_quo_monitor()));
CREATE POLICY "Quo Monitor managers update quo_number_preferences"
  ON public.quo_number_preferences FOR UPDATE TO authenticated
  USING ((SELECT marshmallow_private.can_manage_quo_monitor()))
  WITH CHECK ((SELECT marshmallow_private.can_manage_quo_monitor()));

REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.quo_number_preferences FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE ON public.quo_number_preferences FROM anon;

-- lead_photos keeps its row policies; drop only the RLS-bypassing defaults.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.lead_photos FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.lead_photos FROM anon;

-- ---------------------------------------------------------------------------
-- 4. storage: lead-photos deletes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can delete lead-photos" ON storage.objects;
DROP POLICY IF EXISTS "Admin, processor or uploader can delete lead-photos" ON storage.objects;
CREATE POLICY "Admin, processor or uploader can delete lead-photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'lead-photos'
    AND (
      owner_id = (SELECT auth.uid())::text
      OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'processor'::public.app_role))
    )
  );

-- ---------------------------------------------------------------------------
-- 5. RPC caller checks (bodies otherwise unchanged from production)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_next_opr_code(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  existing text;
  nextnum int;
  newcode text;
BEGIN
  -- API callers must be the service role (admin-users Edge Function) or an
  -- Admin. A direct database session carries no JWT and is already trusted.
  IF nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL
     AND coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only an Admin can assign OPR codes' USING ERRCODE = '42501';
  END IF;

  SELECT opr_code INTO existing FROM public.profiles WHERE id = _user_id;
  IF existing IS NOT NULL AND existing <> '' THEN
    RETURN existing;
  END IF;

  SELECT COALESCE(MAX(NULLIF(regexp_replace(opr_code, '\D', '', 'g'), '')::int), 0) + 1
    INTO nextnum
    FROM public.profiles
    WHERE opr_code ~ '^OPR[0-9]+$';

  newcode := 'OPR' || lpad(nextnum::text, 3, '0');
  UPDATE public.profiles SET opr_code = newcode WHERE id = _user_id;
  RETURN newcode;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_technician_change_requests(p_status text DEFAULT 'pending'::text)
RETURNS TABLE(id uuid, technician_id uuid, technician_name text, change_type text, requested_value boolean,
              previous_value boolean, reason text, requested_by uuid, requested_by_name text, status text,
              reviewed_by_name text, reviewed_at timestamp with time zone, review_note text,
              created_at timestamp with time zone, current_is_good_tech boolean, current_is_active boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.id, r.technician_id, r.technician_name, r.change_type,
         r.requested_value, r.previous_value, r.reason,
         r.requested_by, r.requested_by_name, r.status,
         r.reviewed_by_name, r.reviewed_at, r.review_note, r.created_at,
         t.is_good_tech, t.is_active
    FROM public.technician_change_requests r
    LEFT JOIN public.technicians t ON t.id = r.technician_id
   WHERE r.status = coalesce(p_status, 'pending')
     -- Admin reviews; Processors raise these requests.
     AND (public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'processor'::public.app_role))
   ORDER BY r.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.list_opr_codes()
RETURNS TABLE(opr_code text, full_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.opr_code, p.full_name
  FROM public.profiles p
  WHERE p.opr_code IS NOT NULL AND p.opr_code <> ''
    -- Technician screens only; a signed-in account with no role gets nothing.
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid())
  ORDER BY p.opr_code;
$function$;

-- Not callable without signing in (each already checks auth.uid() internally).
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.get_cs_missed_followup_count(timestamp with time zone, timestamp with time zone, uuid[])',
    'public.list_cs_missed_followups(timestamp with time zone, timestamp with time zone, uuid[])',
    'public.mark_cs_followup_handled(uuid, boolean)',
    'public.enforce_technician_flags_admin_only()',
    'public.assign_next_opr_code(uuid)',
    'public.list_technician_change_requests(text)',
    'public.list_opr_codes()'
  ] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.assign_next_opr_code(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_technician_change_requests(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_opr_codes() TO authenticated;
