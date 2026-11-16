-- =============================================================================
-- Migration : 20261222000000_lead_diagnostic_fee_amount.sql
-- Applied   : production (kxiqholnmhkwhdkhtopp) 2026-11-16, at the user's request
--             (they chose "Every term, own column", which needs this migration).
-- Purpose   : Store a lead's Diagnostic Fee in its own column.
--
-- REQUEST (2026-11-16)
--   The owner wants a "Diagnostic Fee ($)" field beside For You and For Us in
--   the Internal Technician Share, on every quote term, so a Quoted job can
--   carry both its labor and a diagnostic fee. Until now the
--   Diagnostic/Service Call fee was kept in labor_amount; read-only check on
--   2026-11-16 found 0 leads with terms = 'diagnostic_service_call', so no
--   existing value needs moving (and no UPDATE of public.leads is made here).
--
-- WHAT THIS DOES
--   Adds leads.diagnostic_fee_amount numeric (nullable, never negative).
--   Additive only: existing leads read it as NULL. No RLS, grant, trigger or
--   function change. Lead RLS already governs the row; get_operator_safe_leads()
--   lists its columns explicitly, so Operators are not sent the new column, and
--   the CRM also strips it for Operators (src/lib/operator-privacy.ts).
--
-- APPLY ORDER
--   Apply before publishing the CRM build that reads/writes the column: the
--   Leads page selects it by name, and a missing column fails that read.
--
-- VERIFY (read-only)
--   SELECT data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'leads'
--      AND column_name = 'diagnostic_fee_amount';   -- numeric, YES
--
-- ROLLBACK (after reverting the CRM/Donut builds that use it; drops saved fees)
--   ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_diagnostic_fee_amount_non_negative;
--   ALTER TABLE public.leads DROP COLUMN IF EXISTS diagnostic_fee_amount;
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS diagnostic_fee_amount numeric;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_diagnostic_fee_amount_non_negative;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_diagnostic_fee_amount_non_negative
  CHECK (diagnostic_fee_amount IS NULL OR diagnostic_fee_amount >= 0);
