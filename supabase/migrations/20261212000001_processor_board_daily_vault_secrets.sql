-- =============================================================================
-- Migration : 20261212000000_processor_board_daily_vault_secrets.sql
-- Purpose   : Self-provision the two Vault secrets the Processor Board daily
--             dispatcher has been waiting on since it was added.
--
-- DEFECT
--   marshmallow_private.dispatch_processor_board_daily() (added in
--   20261122001000_processor_board_daily_check.sql) checks Vault for
--   'processor_board_daily_project_url' and 'processor_board_daily_cron_secret'
--   and silently no-ops with "Vault secrets are not configured" when either is
--   missing - logged 288 times/24h. No migration has ever created them (unlike
--   the Google Sheets worker, which self-provisions 'project_url' and
--   'publishable_key' in 20261006085053_route_sheets_worker_through_vault.sql).
--   This is the other half of that same gap, not a new design.
--
-- WHAT THIS DOES
--   - processor_board_daily_project_url: copied from the existing 'project_url'
--     Vault secret (same project, no new value to pick). Fails loudly if that
--     secret is missing rather than guessing a URL.
--   - processor_board_daily_cron_secret: a fresh random value, generated once
--     here and never again (idempotent - re-running this migration leaves an
--     existing secret untouched).
--   - Neither secret is logged, returned, or stored anywhere in this repo.
--
-- STILL MANUAL AFTER THIS (unavoidable - Vault and Edge Function secrets are
-- different stores; SQL cannot set the latter), per the original migration's
-- own instructions:
--   1. In the Supabase SQL Editor, as postgres, run:
--        SELECT decrypted_secret FROM vault.decrypted_secrets
--         WHERE name = 'processor_board_daily_cron_secret';
--      Copy the value shown.
--   2. Set it as the Edge Function secret PROCESSOR_DAILY_CRON_SECRET on
--      processor-board-daily (Dashboard > Edge Functions > processor-board-daily
--      > Secrets, or `supabase secrets set PROCESSOR_DAILY_CRON_SECRET=<value>`).
--   3. Deploy processor-board-daily (verify_jwt=false) if not already deployed.
--   Until step 2 matches, the dispatcher will still skip (safe no-op), now for
--   a different reason: a 401 from the function, not a missing Vault secret.
--
-- SAFETY: no table/RLS/index change, no lead data touched, no function body
-- changed. Purely provisions two Vault rows if absent.
--
-- ROLLBACK
--   DELETE FROM vault.secrets WHERE name IN
--     ('processor_board_daily_project_url', 'processor_board_daily_cron_secret');
--   -- The dispatcher goes back to logging the original "not configured" warning.
-- =============================================================================

DO $secrets$
DECLARE
  v_project_url text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'processor_board_daily_project_url'
  ) THEN
    SELECT decrypted_secret INTO v_project_url
      FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;

    IF v_project_url IS NULL THEN
      RAISE EXCEPTION 'Cannot provision processor_board_daily_project_url: Vault secret "project_url" is missing. Apply 20261006085053_route_sheets_worker_through_vault.sql first, or set it manually.';
    END IF;

    PERFORM vault.create_secret(
      v_project_url,
      'processor_board_daily_project_url',
      'Supabase project URL used by the Processor Board daily dispatcher'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'processor_board_daily_cron_secret'
  ) THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'processor_board_daily_cron_secret',
      'Shared secret the Processor Board daily dispatcher sends as x-cron-secret; must match the PROCESSOR_DAILY_CRON_SECRET Edge Function secret on processor-board-daily'
    );
  END IF;
END;
$secrets$;
