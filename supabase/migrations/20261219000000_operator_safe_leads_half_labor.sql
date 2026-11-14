-- =============================================================================
-- Migration : 20261219000000_operator_safe_leads_half_labor.sql
-- Purpose   : Send a regular Operator (`opr`) only HALF the labor amount.
--
-- BACKGROUND
--   Owner rule 2026-11-14: a regular Operator sees the terms, HALF the recorded
--   labor and the parts/materials amount; never the full quote. Until now
--   get_operator_safe_leads() returned the full labor_amount and the CRM halved
--   it on screen (KNOWN LIMIT in 20261218000000), so the full figure could be
--   read from the API response. On 2026-11-14 the owner asked for the database
--   to send only the half.
--
-- THE FIX
--   Recreate get_operator_safe_leads() (same rows, same columns, same security
--   definer and search_path) with:
--     - labor_amount   -> NULL (the full figure never leaves the server), and
--     - a new last column operator_labor_amount = round(labor_amount / 2, 2)
--       (NULL when no labor is recorded).
--   Adding a column changes the return type, so the function is dropped and
--   created in one transaction (nothing depends on it; checked 2026-11-14).
--   Grants are restored exactly: authenticated + service_role, not anon/PUBLIC.
--   The function still returns rows only to a plain Operator; opr_admin and every
--   other role are unaffected (they never call it).
--
-- ORDER / COMPATIBILITY
--   The CRM shows operator_labor_amount as-is when present and only halves
--   labor_amount when the column is absent, so either order is safe:
--     - CRM published first: shows half (computed) until this runs, then half
--       (from the server).
--     - This applied first: the older CRM build sees labor_amount NULL and shows
--       "Quoted" without a labor figure (never the full or a quartered amount)
--       until the CRM is published.
--
-- APPLY (manual): run this file as written against the linked project.
--
-- VERIFY (read-only)
--   SELECT pg_get_function_result('public.get_operator_safe_leads()'::regprocedure)
--     LIKE '%operator_labor_amount numeric%';                         -- true
--   SELECT has_function_privilege('anon', 'public.get_operator_safe_leads()', 'EXECUTE'); -- false
--   As a sampled `opr` session (rolled back):
--     SELECT count(*) FILTER (WHERE labor_amount IS NOT NULL) = 0
--     FROM public.get_operator_safe_leads();                           -- true
--
-- ROLLBACK
--   Re-run 20261218000000_operator_safe_leads_hide_quote.sql after
--   DROP FUNCTION public.get_operator_safe_leads(); (the CRM falls back to
--   halving labor_amount on screen). No data is changed by this migration.
-- =============================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.get_operator_safe_leads();

CREATE FUNCTION public.get_operator_safe_leads()
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
  location_label text, operator_labor_amount numeric
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
    l.terms,
    NULL::numeric,                                               -- labor_amount: the full figure never reaches an Operator
    l.material_amount,
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
    public.location_label(l),                                    -- location_label
    round(l.labor_amount / 2, 2)                                 -- operator_labor_amount: HALF the labor, to the cent
  FROM public.leads l
  CROSS JOIN LATERAL (SELECT marshmallow_private.location_parts(l) AS parts) loc
  WHERE l.status = 'urgent_job'
    AND l.cs_tag IS NULL
    AND (SELECT public.has_role(auth.uid(), 'opr'::public.app_role))
    AND NOT (SELECT public.has_role(auth.uid(), 'opr_admin'::public.app_role));
$$;

REVOKE ALL ON FUNCTION public.get_operator_safe_leads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operator_safe_leads() TO authenticated, service_role;

COMMIT;
