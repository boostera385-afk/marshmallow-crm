-- =============================================================================
-- Migration : 20261224000000_lead_labor_percent_split.sql
-- Applied   : production (kxiqholnmhkwhdkhtopp) 2026-11-16, at the user's request.
-- Purpose   : Store the For You / For Us share of labor as a percentage.
--
-- REQUEST (2026-11-16)
--   The owner's technician-message formats need percentages of labor:
--     Free Estimate:           For You: xx% from Labor / For Us: xx% from Labor
--     Diagnostic/Service Call: For You: $xx from Diagnostic + xx% from Labor
--                              For Us:  $xx from Diagnostic + xx% from Labor
--   for_you_amount / for_us_amount hold dollars, so two percent fields are
--   added beside them in the Internal Technician Share.
--
-- WHAT THIS DOES
--   Adds leads.for_you_labor_percent and leads.for_us_labor_percent
--   (numeric, nullable, 0..100). Additive only: existing leads read NULL.
--   No RLS, grant, trigger or function change. get_operator_safe_leads() lists
--   its columns explicitly, so Operators are not sent them, and the CRM also
--   strips them for Operators (src/lib/operator-privacy.ts).
--
-- APPLY ORDER
--   Apply before publishing the CRM build that selects these columns by name.
--
-- VERIFY (read-only)
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'leads'
--      AND column_name IN ('for_you_labor_percent', 'for_us_labor_percent');
--
-- ROLLBACK (after reverting the CRM build that uses them; drops saved values)
--   ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_labor_percent_range;
--   ALTER TABLE public.leads
--     DROP COLUMN IF EXISTS for_you_labor_percent,
--     DROP COLUMN IF EXISTS for_us_labor_percent;
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS for_you_labor_percent numeric,
  ADD COLUMN IF NOT EXISTS for_us_labor_percent numeric;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_labor_percent_range;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_labor_percent_range CHECK (
    (for_you_labor_percent IS NULL OR for_you_labor_percent BETWEEN 0 AND 100)
    AND (for_us_labor_percent IS NULL OR for_us_labor_percent BETWEEN 0 AND 100)
  );
