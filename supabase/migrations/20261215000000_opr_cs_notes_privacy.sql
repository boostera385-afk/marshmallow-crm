-- Purpose: a regular Operator must not read CS note threads through REST, even
-- when the parent untagged urgent lead is visible. UI hiding is not authorization.
-- Restrictive policy intersects every existing SELECT policy; grants, write
-- policies and other roles' lead visibility remain unchanged. No customer writes.
-- Apply only with explicit approval. Test: supabase/tests/180_opr_cs_notes.sql
-- via scripts/test-opr-cs-notes-db.mjs (isolated only).
-- Rollback: DROP POLICY IF EXISTS "Regular OPR cannot read CS notes" ON public.lead_notes;
-- IMPORTANT: this closes CS-thread access only. Column-level privacy for name,
-- raw quote and legacy leads.cs_notes still needs a coordinated safe Operator API;
-- this policy must not be represented as fixing those separate exposures.
DROP POLICY IF EXISTS "Regular OPR cannot read CS notes" ON public.lead_notes;
CREATE POLICY "Regular OPR cannot read CS notes" ON public.lead_notes
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  note_type IS DISTINCT FROM 'cs'
  OR NOT (SELECT public.has_role(auth.uid(), 'opr'::public.app_role))
  -- Keep callers with an additional non-OPR role's existing access.
  OR (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
  OR (SELECT public.has_role(auth.uid(), 'opr_admin'::public.app_role))
  OR (SELECT public.has_role(auth.uid(), 'processor'::public.app_role))
  OR (SELECT public.has_role(auth.uid(), 'cs_admin'::public.app_role))
  OR (SELECT public.has_role(auth.uid(), 'customer_service'::public.app_role))
);
