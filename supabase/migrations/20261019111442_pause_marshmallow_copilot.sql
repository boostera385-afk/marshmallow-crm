-- Purpose: pause all Copilot/AI access pending testing, including Admin and stale
-- clients. Retain role/user grants, budgets and usage history for a reviewed restart.
-- No lead, profile, navigation permission, approval or RLS changes.
BEGIN;
ALTER TABLE public.copilot_config ALTER COLUMN enabled SET DEFAULT false;
WITH paused AS (
  UPDATE public.copilot_config SET enabled=false, ai_enabled=false
  WHERE id AND (enabled OR ai_enabled)
  RETURNING id
)
INSERT INTO public.activity_logs(user_id,user_name,action,target_type,target_id,details)
SELECT NULL,'System migration','copilot_paused','copilot','global',
  '{"enabled":false,"ai_enabled":false,"reason":"Paused pending testing; saved grants retained"}'
FROM paused;

-- A stale Admin tab/direct configure RPC cannot undo the release pause.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.copilot_config'::regclass AND conname='copilot_release_paused') THEN
    ALTER TABLE public.copilot_config ADD CONSTRAINT copilot_release_paused
      CHECK (NOT enabled AND NOT ai_enabled);
  END IF;
END; $$;
COMMIT;

-- Rollback (separate approval AFTER testing):
-- ALTER TABLE public.copilot_config DROP CONSTRAINT IF EXISTS copilot_release_paused;
-- Leave enabled/ai_enabled and the safe default false. Reintroduce the CRM controls
-- and explicitly re-enable reviewed access with the authorized configuration RPC.
-- Redeploy marshmallow-copilot with its release gate enabled only after approval.
-- Do not replay old migrations, delete usage history, or reset any user grants.
