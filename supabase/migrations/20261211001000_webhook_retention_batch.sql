-- Purpose: select bounded retention IDs through the terminal-event index BEFORE
-- reading large payloads. Literal status predicates also work with generic plans.
-- Apply manually after 20261211000000_webhook_retention_index.sql. Deploy the
-- matching retention Edge Function separately; no deletion occurs in this RPC.
-- Rollback: DROP FUNCTION IF EXISTS public.webhook_retention_batch(timestamptz, integer);
BEGIN;
CREATE OR REPLACE FUNCTION public.webhook_retention_batch(p_cutoff timestamptz, p_limit integer DEFAULT 1000)
RETURNS SETOF public.quo_webhook_events
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF p_cutoff IS NULL OR p_cutoff > now() - interval '7 days'
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Invalid webhook retention window or batch size' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH ids AS MATERIALIZED (
    SELECT e.id, e.received_at
      FROM public.quo_webhook_events e
     WHERE e.processing_status IN ('processed', 'ignored') AND e.received_at < p_cutoff
     ORDER BY e.received_at, e.id LIMIT p_limit
  )
  SELECT e.* FROM ids JOIN public.quo_webhook_events e USING (id)
   ORDER BY ids.received_at, ids.id;
END $$;
REVOKE ALL ON FUNCTION public.webhook_retention_batch(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_retention_batch(timestamptz, integer) TO service_role;
COMMIT;
