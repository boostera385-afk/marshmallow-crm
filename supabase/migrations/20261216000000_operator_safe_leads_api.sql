-- =============================================================================
-- Migration : 20261216000000_operator_safe_leads_api.sql
-- Purpose   : Close the column-level exposure left open by 20261215000000.
--
-- THE DEFECT
--   Regular Operators (`opr`) can read `leads.customer_name`, `leads.quote` and
--   the legacy `leads.cs_notes` column through their own authenticated Supabase
--   session, even though every CRM screen hides these fields client-side
--   (src/lib/operator-privacy.ts, src/lib/operator-quote.ts). Postgres RLS is
--   row-level only — the existing "Lead visibility by role" policy
--   (20261213000000) correctly limits WHICH rows a plain Operator may read
--   (urgent_job, cs_tag IS NULL) but still returns every column of those rows.
--   A read-only production probe (supabase/tests/181_operator_todo_audit_readonly.sql)
--   confirmed 76 raw names, 76 raw quotes and 273 CS note rows were reachable
--   this way. UI hiding is not authorization (docs/OPERATOR_TODO_AUDIT.md).
--
-- THE FIX
--   1. `public.get_operator_safe_leads()` — a SECURITY DEFINER function that
--      returns exactly the same rows a plain Operator may already see, with the
--      same columns `redactLeadForOperator`/`operatorQuoteSummary` already null
--      client-side (customer_name, customer_email, customer_phone,
--      customer_landline, tech_name, tech_number, half_address, latitude,
--      longitude, quote, cs_notes, for_you_amount, for_us_amount) replaced with
--      NULL at the source, plus the existing server-computed `location_label`.
--      Every other column (status, cs_tag, scheduling, labor/material amounts,
--      terms, etc.) passes through unchanged — operators already see these.
--   2. A new RESTRICTIVE SELECT policy denies a plain Operator (`opr` without
--      `opr_admin`) any DIRECT read of `public.leads`, forcing every Operator
--      read through the function above. Every other role is unaffected: the
--      policy is a no-op for admin, processor, opr_admin, cs_admin and
--      customer_service.
--
-- WHY A FUNCTION, NOT JUST A NARROWER RLS POLICY
--   Row Level Security cannot mask individual columns — only whole rows. The
--   only way to stop `opr` from reading a permitted row's sensitive columns is
--   to deny direct table access entirely and serve a hand-picked projection
--   through a function that bypasses RLS internally (SECURITY DEFINER, owned
--   by the migration role) and never selects the hidden columns in the first
--   place.
--
-- KNOWN, ACCEPTED CONSEQUENCE — REALTIME
--   Supabase Realtime's `postgres_changes` is gated by the same RLS policies.
--   Once this ships, a plain Operator's browser no longer receives ANY
--   `leads` realtime event (insert/update/delete), because RLS denies them
--   direct SELECT outright. The CRM frontend (src/pages/LeadsPage.tsx) is
--   updated in the same change to stop opening that subscription for `opr`
--   and instead poll `get_operator_safe_leads()` every ~15s while the page is
--   visible, reusing the existing visibility-gated poll/cache plumbing. This
--   was discussed and accepted explicitly (2026-11-13): Operators trade
--   instant push for ~15s-fresh polling, in exchange for the server never
--   sending their browser the hidden columns again, over any channel.
--   `src/pages/LeadsPage.tsx`'s "Urgent in area" overview widget's "needs CX
--   reply" indicator (which matched the raw `customer_phone` against
--   `quo_conversations`) is disabled for `opr` by the same change, since the
--   hidden column it depended on is no longer available client-side and
--   reimplementing phone normalization/matching server-side is a separate,
--   explicitly deferred follow-up — not silently claimed as done here.
--
-- VERIFYING THIS IS SAFE
--   Run supabase/tests/40_leads_rls_baseline.sql BEFORE and AFTER applying
--   this. The `opr` row should drop to ZERO directly-visible leads (by
--   design — they now read through the function); every other role's row,
--   including opr_admin, must be unchanged. If any other row moves, stop and
--   roll back. Then call `get_operator_safe_leads()` as an `opr` session and
--   confirm it returns the same urgent/untagged leads as before, with
--   customer_name/customer_email/customer_phone/customer_landline/tech_name/
--   tech_number/half_address/latitude/longitude/quote/cs_notes/for_you_amount/
--   for_us_amount all NULL and location_label populated.
--
-- ROLLBACK
--   DROP POLICY IF EXISTS "Regular OPR cannot read leads directly" ON public.leads;
--   DROP FUNCTION IF EXISTS public.get_operator_safe_leads();
--   This restores the exact pre-migration behavior (direct `opr` reads of
--   permitted rows, all columns). No lead row is altered by this migration
--   either way — it changes read access only.
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
    NULL::text,                                                  -- quote
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

DROP POLICY IF EXISTS "Regular OPR cannot read leads directly" ON public.leads;
CREATE POLICY "Regular OPR cannot read leads directly" ON public.leads
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  NOT (SELECT public.has_role(auth.uid(), 'opr'::public.app_role))
  OR (SELECT public.has_role(auth.uid(), 'opr_admin'::public.app_role))
  OR (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
  OR (SELECT public.has_role(auth.uid(), 'processor'::public.app_role))
  OR (SELECT public.has_role(auth.uid(), 'cs_admin'::public.app_role))
  OR (SELECT public.has_role(auth.uid(), 'customer_service'::public.app_role))
);
