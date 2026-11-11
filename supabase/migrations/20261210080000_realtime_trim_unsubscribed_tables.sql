-- =============================================================================
-- Migration : 20261210080000_realtime_trim_unsubscribed_tables.sql
-- Purpose   : Stop publishing eight tables to Realtime that no client
--             subscribes to. Realtime keeps every delivered feature; this only
--             removes WAL-decoding work for events nobody listens to.
--
-- THE DEFECT
--   pg_stat_statements on production (read-only, 2026-11-11) shows the
--   Realtime WAL-decoding query (realtime.list_changes polling wal2json) as
--   the single largest CPU consumer: ~1,408 s total / 139k calls since the
--   last stats reset. Its cost scales with the write volume of every table in
--   the supabase_realtime publication times the number of connected clients.
--
--   The publication carried 22 tables. Auditing every realtime subscription
--   in the CRM (src/**, all postgres_changes registrations go through
--   src/lib/realtime.ts or page-level channels), the Donut extension
--   (tmp_extension/quo-crm-extension/**) and Edge Functions
--   (supabase/functions/**) on 2026-11-11 found NO subscriber anywhere for
--   these eight published tables:
--
--     crm_updates                   (CrmUpdates page polls/refetches)
--     lead_operator_assignments
--     lead_photos
--     lead_urgent_review_requests   (UrgentReviewRequests polls every 30 s)
--     quo_number_preferences        (QuoDashboardPage refetches)
--     quo_outbound_messages         (webhook-driven writes; nothing listens)
--     quo_pinned_conversations
--     technician_change_requests    (TechnicianChangeApprovals polls every 30 s)
--
--   Every insert/update/delete on them was decoded and security-checked for
--   each connected client for nothing. quo_outbound_messages and lead_photos
--   in particular take webhook/upload write bursts.
--
-- WHAT KEEPS PUBLISHING (verified subscribed in CRM and/or Donut):
--   leads, technicians, notifications, quo_conversations, quo_messages,
--   lead_quote_approval_requests, lead_payment_requests,
--   lead_cancellation_requests, lead_notes, lead_hold_alerts,
--   lead_cx_update_requests, lead_copy_role_permissions,
--   lead_copy_user_permissions, map_coverage_areas.
--
-- NOTE (pre-existing, not changed here): src/pages/ActivityLogs.tsx and
--   LeadStatusHistoryDialog subscribe to activity_logs, which is NOT in the
--   publication, so those subscriptions have never received events; both
--   surfaces refresh by query as well. Adding activity_logs to the
--   publication would increase load and needs its own decision.
--
-- VERIFYING AFTER APPLYING
--   - SELECT tablename FROM pg_publication_tables
--     WHERE pubname = 'supabase_realtime' ORDER BY 1;
--     must list exactly the 14 tables above.
--   - Live checks: lead status changes still appear across two sessions
--     without refresh; notification bell still fires; Quo chat messages still
--     stream in; quote approval / payment / cancellation request lists still
--     update on change.
--
-- APPLY
--   Paste into the Supabase SQL Editor and run as postgres. Idempotent: each
--   table is dropped only if currently published.
-- =============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_updates',
    'lead_operator_assignments',
    'lead_photos',
    'lead_urgent_review_requests',
    'quo_number_preferences',
    'quo_outbound_messages',
    'quo_pinned_conversations',
    'technician_change_requests'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- ROLLBACK - run manually to publish the eight tables again
-- (restores the exact 22-table publication recorded on 2026-11-11).
--
-- ALTER PUBLICATION supabase_realtime ADD TABLE
--   public.crm_updates,
--   public.lead_operator_assignments,
--   public.lead_photos,
--   public.lead_urgent_review_requests,
--   public.quo_number_preferences,
--   public.quo_outbound_messages,
--   public.quo_pinned_conversations,
--   public.technician_change_requests;
-- =============================================================================
