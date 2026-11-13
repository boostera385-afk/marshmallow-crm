-- Production-safe audit: no customer values, inserts, updates or schema changes.
-- Uses an existing regular OPR account; reports counts only through real RLS.
BEGIN READ ONLY;
SELECT set_config('request.jwt.claim.sub', (
  SELECT user_id::text FROM public.user_roles WHERE role='opr' ORDER BY user_id LIMIT 1
), true);
SET LOCAL ROLE authenticated;
SELECT
  public.has_role(auth.uid(), 'opr'::public.app_role) AS verified_regular_opr,
  count(*) AS visible_leads,
  count(*) FILTER (WHERE status <> 'urgent_job' OR cs_tag IS NOT NULL) AS unexpected_status_or_tag,
  count(*) FILTER (WHERE customer_name IS NOT NULL AND customer_name <> '') AS raw_customer_names_accessible,
  count(*) FILTER (WHERE quote IS NOT NULL AND quote <> '') AS raw_quotes_accessible,
  (SELECT count(*) FROM public.lead_notes WHERE note_type='cs') AS cs_thread_rows_accessible,
  (public.current_user_opr_code() IS NOT NULL) AS has_own_operator_code,
  EXISTS (SELECT 1 FROM public.navigation_permissions WHERE user_id=auth.uid() AND nav_section='technicians' AND allowed) AS technicians_navigation_enabled
FROM public.leads;
ROLLBACK;
