-- =============================================================================
-- Migration : 20261225000000_lead_diagnostic_split.sql
-- Applied   : production (kxiqholnmhkwhdkhtopp) 2026-11-16, at the user's request.
-- Purpose   : Store the For You / For Us share of the Diagnostic Fee.
--
-- REQUEST (2026-11-16)
--   The Diagnostic Fee (20261222000000) is offered on every term. The owner
--   wants its For You / For Us split on every term too, separate from the
--   labor split (for_you_amount / for_us_amount in dollars, and the
--   for_*_labor_percent columns from 20261224000000).
--
-- WHAT THIS DOES
--   Adds leads.for_you_diagnostic_amount and leads.for_us_diagnostic_amount
--   (numeric, nullable, never negative). Additive only: existing leads read
--   NULL. No RLS, grant, trigger or function change. get_operator_safe_leads()
--   lists its columns explicitly, so Operators are not sent them; the CRM also
--   strips them for Operators (src/lib/operator-privacy.ts).
--
-- APPLY ORDER
--   Apply before publishing the CRM build that selects these columns by name.
--
-- VERIFY (read-only)
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'leads'
--      AND column_name IN ('for_you_diagnostic_amount', 'for_us_diagnostic_amount');
--
-- ROLLBACK (after reverting the CRM build that uses them; drops saved values)
--   ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_diagnostic_split_non_negative;
--   ALTER TABLE public.leads
--     DROP COLUMN IF EXISTS for_you_diagnostic_amount,
--     DROP COLUMN IF EXISTS for_us_diagnostic_amount;
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS for_you_diagnostic_amount numeric,
  ADD COLUMN IF NOT EXISTS for_us_diagnostic_amount numeric;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_diagnostic_split_non_negative;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_diagnostic_split_non_negative CHECK (
    (for_you_diagnostic_amount IS NULL OR for_you_diagnostic_amount >= 0)
    AND (for_us_diagnostic_amount IS NULL OR for_us_diagnostic_amount >= 0)
  );
