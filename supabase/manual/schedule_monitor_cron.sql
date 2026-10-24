-- MANUAL APPROVAL REQUIRED. Registers a recurring production worker invocation.
-- Do not execute as part of local validation or a schema migration.
-- First install the two workflow migrations, deploy schedule-confirmation-monitor,
-- and provision Vault entries schedule_monitor_project_url and
-- schedule_monitor_cron_secret. The latter MUST equal the Edge Function secret
-- SCHEDULE_MONITOR_CRON_SECRET. Never commit/print the actual secret value.
-- The migration installs mode OFF: this registration does not enable monitoring.
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='schedule-confirmation-monitor') THEN
    PERFORM cron.schedule('schedule-confirmation-monitor','* * * * *',
      'SELECT marshmallow_private.dispatch_schedule_monitor()');
  END IF;
END $$;
-- Rollback: first turn monitor mode OFF using the audited Admin control, then
-- SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='schedule-confirmation-monitor';
-- Retain review/request/notification history. Do not bulk revert saved job tags.
