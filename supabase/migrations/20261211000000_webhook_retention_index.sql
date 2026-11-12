-- Purpose: the measured retention plan scanned and sorted the raw webhook table
-- for every batch. Index only terminal events, in the worker's stable order.
-- LOCAL PREPARATION ONLY. Apply manually, as a standalone statement outside a
-- transaction, during a reviewed rollout. CONCURRENTLY avoids blocking ingestion.
-- Inspect pg_index.indisvalid afterwards; IF NOT EXISTS does not repair an invalid
-- index left by an interrupted build. Review/remove only that invalid index before
-- retrying. No customer data, grants, policies, or ingestion controls change.
-- Rollback (standalone): DROP INDEX CONCURRENTLY IF EXISTS public.quo_webhook_retention_received_id_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS quo_webhook_retention_received_id_idx
  ON public.quo_webhook_events (received_at, id)
  WHERE processing_status IN ('processed', 'ignored');
