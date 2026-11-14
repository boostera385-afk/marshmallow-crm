-- =============================================================================
-- Migration : 20261218000000_operator_safe_leads_hide_quote.sql
-- Purpose   : Stop sending regular Operators (`opr`) the free-text quote again.
--
-- BACKGROUND
--   20261217000000_operator_safe_leads_quote.sql (applied 2026-11-13) made
--   get_operator_safe_leads() return `quote` so Operators could see the full
--   quote. On 2026-11-14 the business owner changed the rule: a regular Operator
--   sees only the terms (Quoted / Free Estimate Visit), HALF the recorded labor
--   amount, and the parts/materials amount when one is recorded — never the full
--   free-text quote. The CRM computes that summary from terms, labor_amount and
--   material_amount (src/lib/operator-quote.ts), which this function already
--   returns unchanged.
--
-- THE FIX
--   Recreate get_operator_safe_leads() with the identical signature, rows and
--   columns, except `quote` is NULL again (same as 20261216000000). No policy,
--   grant or row change; opr_admin and every other role are unaffected.
--
-- KNOWN LIMIT
--   labor_amount is still returned whole (the CRM halves it for display), so a
--   technically skilled Operator could read the full labor figure from the API
--   response. Halving it server-side would also change the column every other
--   caller relies on; returning a separate half-labor column is a possible
--   follow-up if the full figure must never reach the browser.
--
-- APPLY
--   Run this file as written against the linked project (SQL editor or
--   `supabase db query --file <this file> --linked`). Publish the CRM first or
--   at the same time: until the new frontend is live, the CRM shows Operators
--   the full quote whenever the API still returns it.
--
-- VERIFY
--   SELECT position('THEN l.quote' in pg_get_functiondef(
--     'public.get_operator_safe_leads()'::regprocedure)) = 0;   -- true
--   and as an `opr` session:
--   SELECT count(*) FILTER (WHERE quote IS NOT NULL) FROM public.get_operator_safe_leads();  -- 0
--
-- ROLLBACK
--   Re-run 20261217000000_operator_safe_leads_quote.sql (quote passes through
--   unless show_quote_to_opr is false).
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
    NULL::text,                                                  -- quote (Operators get terms / half labor / parts-materials only)
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
