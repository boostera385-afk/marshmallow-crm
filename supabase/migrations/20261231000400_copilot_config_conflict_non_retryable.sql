-- Defect: public.copilot_configure_checked raises business-rule conflicts with SQLSTATE 40001
-- (serialization_failure). PostgREST 14 treats 40001 as transient and retries
-- the whole transaction indefinitely, as happened to the payment RPC on
-- 2026-11-21/22 (fixed in 20261231000300).
-- See https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
--
-- Conflict: a stale Copilot settings save ("Configuration changed in another
-- session"). Caller: Edge Function marshmallow-copilot.
--
-- Fix: raise the same messages with SQLSTATE PT409 (HTTP 409, never retried).
-- Each statement is copied from the latest migration defining that function,
-- whose body matched production on 2026-11-23. Logic, messages,
-- authorization, SECURITY DEFINER/INVOKER and search_path are otherwise
-- unchanged; CREATE OR REPLACE keeps existing owners and grants. No data repair.
--
-- Rollout: deploy Edge Function marshmallow-copilot (accepts PT409) BEFORE
-- applying; until then a stale save shows the generic CRM error instead of the
-- reload message. No Donut counterpart.
--
-- Idempotent: CREATE OR REPLACE only.
-- Rollback: re-run each function's CREATE OR REPLACE statement from the source
-- migration named above it (restores 40001 and the retry-loop risk).
BEGIN;

-- From 20261014034546_copilot_pilot_readiness_and_briefs.sql (1 conflict raise -> PT409)
CREATE OR REPLACE FUNCTION public.copilot_configure_checked(p_expected jsonb,
 p_enabled boolean,p_ai_enabled boolean,p_monthly_budget_cents integer,
 p_daily_ai_limit integer,p_timezone text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_config jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
  RAISE EXCEPTION 'Only Admin may manage Copilot' USING ERRCODE='42501';
 END IF;
 SELECT to_jsonb(c)-'id' INTO current_config FROM public.copilot_config c WHERE id FOR UPDATE;
 IF p_expected IS NULL OR current_config IS DISTINCT FROM p_expected THEN
  RAISE EXCEPTION 'Configuration changed in another session. Reload saved settings before saving.' USING ERRCODE='PT409';
 END IF;
 PERFORM public.copilot_configure(p_enabled,p_ai_enabled,p_monthly_budget_cents,p_daily_ai_limit,p_timezone);
END; $$;
COMMIT;
