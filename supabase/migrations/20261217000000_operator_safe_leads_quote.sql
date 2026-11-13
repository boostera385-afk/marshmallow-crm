-- =============================================================================
-- Migration : 20261217000000_operator_safe_leads_quote.sql
-- Purpose   : Give regular Operators (`opr`) the full free-text quote again.
--
-- THE DEFECT
--   20261216000000_operator_safe_leads_api.sql returned `quote` as NULL for every
--   lead served by get_operator_safe_leads(). Before 2026-11-13 a regular Operator
--   could see and copy the full quote (unless an admin set show_quote_to_opr =
--   false on that lead). The business owner asked on 2026-11-13 to restore that.
--
-- THE FIX
--   Recreate get_operator_safe_leads() with the identical signature, rows and
--   other columns, except `quote` now passes through when show_quote_to_opr is
--   not false. labor_amount / material_amount already passed through unchanged.
--   for_you_amount / for_us_amount (internal technician split), customer name,
--   email, phone, landline, technician, street address, map point and cs_notes
--   stay NULL exactly as before. No policy, grant or row change.
--
-- APPLY
--   Run this file as written against the linked project (SQL editor or
--   `supabase db query --file <this file> --linked`). Order relative to the CRM
--   publish does not matter: the frontend shows the quote when present and the
--   Quoted/Free Estimate terms otherwise.
--
-- VERIFY
--   As an `opr` session: SELECT count(*) FILTER (WHERE quote IS NOT NULL),
--   count(*) FILTER (WHERE customer_name IS NOT NULL OR customer_phone IS NOT NULL
--   OR for_you_amount IS NOT NULL OR for_us_amount IS NOT NULL OR cs_notes IS NOT NULL)
--   FROM public.get_operator_safe_leads();  -- second count must be 0.
--   40_leads_rls_baseline.sql is unaffected (no RLS change).
--
-- ROLLBACK
--   Re-run the CREATE OR REPLACE FUNCTION block from
--   20261216000000_operator_safe_leads_api.sql (quote back to NULL::text).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_operator_safe_leads()
RETURNS TABLE (
  id uuid, job_id text, status text, customer_name text, customer_email text,
  customer_phone text, service_type text, address text, city text, state text,
  zip_code text, scheduled_date date, scheduled_time_start time without time zone,
  scheduled_time_end time without time zone, amount numeric, created_by uuid,
  assigned_cs uuid, last_edited_by uuid, last_edited_at timestamp with time zone,
  created_at timestamp with time zone, updated_at timestamp with time zone,
  payment_amount numeric, payment_screenshot_url text, number_name text, quote text,
  service_details text, customer_schedule_requirements text, reference_name text,
  tech_name text, tech_number text, terms text, labor_amount numeric, material_amount numeric,
  for_you_amount numeric, for_us_amount numeric, direction text, cs_tag text,
  half_address text, cancellation_reason text, source_url text, created_by_name text,
  last_edited_by_name text, booked_at timestamp with time zone, latitude double precision,
  longitude double precision, nearby_areas jsonb, show_quote_to_opr boolean,
  expected_completion_date text, quote_requested_by uuid, customer_landline text,
  cs_notes text, processor_notes text, general_notes text, urgent_at timestamp with time zone,
  org_id uuid, manual_entry boolean, coverage_tech_count integer, coverage_level text,
  coverage_area_label text, coverage_checked_at timestamp with time zone, cs_tag_source text,
  location_label text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    l.id, l.job_id, l.status,
    NULL::text, NULL::text, NULL::text,                         -- customer_name, customer_email, customer_phone
    l.service_type,
    public.location_label(l),                                   -- address: label only, never the street
    loc.parts->>'city', loc.parts->>'state', loc.parts->>'zip',  -- city, state, zip_code
    l.scheduled_date, l.scheduled_time_start, l.scheduled_time_end, l.amount,
    l.created_by, l.assigned_cs, l.last_edited_by, l.last_edited_at, l.created_at, l.updated_at,
    l.payment_amount, l.payment_screenshot_url, l.number_name,
    CASE WHEN l.show_quote_to_opr IS DISTINCT FROM false THEN l.quote END,  -- quote (admin per-lead hide respected)
    l.service_details, l.customer_schedule_requirements, l.reference_name,
    NULL::text, NULL::text,                                      -- tech_name, tech_number
    l.terms, l.labor_amount, l.material_amount,
    NULL::numeric, NULL::numeric,                                -- for_you_amount, for_us_amount
    l.direction, l.cs_tag,
    NULL::text,                                                  -- half_address
    l.cancellation_reason, l.source_url, l.created_by_name, l.last_edited_by_name, l.booked_at,
    NULL::double precision, NULL::double precision,              -- latitude, longitude
    l.nearby_areas, l.show_quote_to_opr, l.expected_completion_date, l.quote_requested_by,
    NULL::text,                                                  -- customer_landline
    NULL::text,                                                  -- cs_notes
    l.processor_notes, l.general_notes, l.urgent_at, l.org_id, l.manual_entry,
    l.coverage_tech_count, l.coverage_level, l.coverage_area_label, l.coverage_checked_at, l.cs_tag_source,
    public.location_label(l)                                     -- location_label
  FROM public.leads l
  CROSS JOIN LATERAL (SELECT marshmallow_private.location_parts(l) AS parts) loc
  WHERE l.status = 'urgent_job'
    AND l.cs_tag IS NULL
    AND (SELECT public.has_role(auth.uid(), 'opr'::public.app_role))
    AND NOT (SELECT public.has_role(auth.uid(), 'opr_admin'::public.app_role));
$$;

REVOKE ALL ON FUNCTION public.get_operator_safe_leads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operator_safe_leads() TO authenticated;
