-- =============================================================================
-- Migration : 20261214000000_partial_paid_requests.sql
-- Purpose   : Add a Partial Paid request/approval path, mirroring the existing
--             Paid request flow, and close the matching gap at the database
--             layer (business decision 2026-11-14).
--
-- THE GAP
--   `lead_payment_requests` (20260709035444) only ever produces `paid`: a
--   Processor requests it with an amount/screenshot/comment and an Admin
--   approves or rejects it. `partial_paid` has no such path — a Processor or a
--   Customer Service user can set it straight from the status dropdown
--   (STATUS_CHANGE_ACCESS) with no amount, no evidence, and no Admin review at
--   all, unlike every other money-moving status in this product.
--
-- THE FIX
--   1. `lead_payment_requests` gets a `request_type` column ('paid' or
--      'partial_paid'), reusing the same table, RLS policies, realtime
--      publication and review queue rather than duplicating them. A request
--      row's `request_type` decides which status an approval applies.
--   2. `enforce_paid_status_rules()` (20261030020000) gets a third rule,
--      alongside its existing two: only an Admin, or a trusted server-side
--      caller (service_role, null auth.uid()), may move a lead INTO
--      `partial_paid`. This is the same Rule 2 pattern, not a new terminal
--      rule — `partial_paid` does not become immutable the way `paid` is;
--      only who may set it is restricted. Existing Rules 1 and 2 (`paid` is
--      terminal; only Admin may set `paid`) are carried over unchanged.
--
--   The frontend change that goes with this (not in this file): Processor
--   keeps `partial_paid` in STATUS_CHANGE_ACCESS, but picking it now opens the
--   same request dialog "paid" already does, calling createPaymentRequest
--   with requestType: 'partial_paid' instead of a direct status write.
--   Customer Service loses `partial_paid` from STATUS_CHANGE_ACCESS entirely
--   (business decision 2026-11-14) — same shape as never having had `paid`.
--   Admin is unaffected either way and keeps setting both directly.
--
-- VERIFYING THIS IS SAFE
--   Confirm existing paid/partial_paid rows are untouched (request_type
--   backfills to 'paid', which was already the only possibility). Then, in a
--   transaction you roll back: attempt `UPDATE leads SET status =
--   'partial_paid'` as a non-admin (should now raise insufficient_privilege,
--   where it previously succeeded) and as an Admin (should still succeed).
--   Confirm a `paid` lead still cannot change status at all (Rule 1
--   untouched).
--
-- ROLLBACK
--   ALTER TABLE public.lead_payment_requests DROP COLUMN IF EXISTS request_type;
--   Then CREATE OR REPLACE FUNCTION public.enforce_paid_status_rules() with
--   the body from 20261030020000 (Rules 1 and 2 only, no Rule 3). No data
--   in leads is altered by this migration. Preserve/export request_type before
--   dropping it: rollback discards the distinction for Partial Paid requests.
--   Resolve pending Partial Paid requests and revert/refresh clients first.
--
-- LOCAL HARNESS: supabase/tests/178_partial_paid_requests.sql (isolated only),
-- via scripts/test-partial-paid-requests-db.mjs. Post-apply read-only checks:
-- supabase/tests/179_partial_paid_requests_readonly.sql.
-- =============================================================================

ALTER TABLE public.lead_payment_requests
  ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'paid'
    CHECK (request_type IN ('paid', 'partial_paid'));

CREATE OR REPLACE FUNCTION public.enforce_paid_status_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  -- Rule 1: paid is terminal, for everyone. Unchanged from 20261030020000.
  IF OLD.status = 'paid' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'A paid lead cannot change status (attempted % -> %). Paid is final.', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Rule 2: only an Admin, or a trusted server-side caller, may mark paid.
  -- Unchanged from 20261030020000.
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    IF v_caller IS NULL THEN
      RETURN NEW;
    END IF;

    IF public.has_role(v_caller, 'admin'::public.app_role) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Only an Admin can mark a lead paid. Submit a Paid Request and have it approved instead.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Rule 3 (new): only an Admin, or a trusted server-side caller, may mark
  -- partial_paid. partial_paid is NOT made terminal by this rule - only who
  -- may set it is restricted, same as Rule 2 for paid.
  IF NEW.status = 'partial_paid' AND OLD.status IS DISTINCT FROM 'partial_paid' THEN
    IF v_caller IS NULL THEN
      RETURN NEW;
    END IF;

    IF public.has_role(v_caller, 'admin'::public.app_role) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Only an Admin can mark a lead partial paid. Submit a Partial Paid Request and have it approved instead.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;
