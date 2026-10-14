-- Purpose: allow the requested urgent-lead AI vocabulary plus a tightly bounded
-- two/three-word label when the conversation is genuinely about another topic.
-- This changes only the derived lead_ai_statuses table; it never updates leads.
-- Apply manually after reviewing the paired refresh-urgent-statuses deployment.

ALTER TABLE public.lead_ai_statuses
  DROP CONSTRAINT IF EXISTS lead_ai_status_label;

-- `Cancelled` was valid under the previous enum constraint but is the only
-- legacy label that does not satisfy the new two/three-word contract. Preserve
-- its meaning before validating the replacement constraint. This derived row
-- will be refreshed normally by the classifier later.
UPDATE public.lead_ai_statuses
SET status = 'Need to Cancel'
WHERE status = 'Cancelled';

DO $$
DECLARE
  invalid_labels text;
BEGIN
  SELECT string_agg(format('%L (%s rows)', status, row_count), ', ' ORDER BY status)
    INTO invalid_labels
  FROM (
    SELECT status, count(*) AS row_count
    FROM public.lead_ai_statuses
    WHERE length(status) NOT BETWEEN 3 AND 48
       OR status !~ '^[A-Za-z][A-Za-z/-]*( [A-Za-z][A-Za-z/-]*){1,2}$'
    GROUP BY status
  ) invalid;

  IF invalid_labels IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce lead_ai_status_label; review unexpected derived labels: %', invalid_labels;
  END IF;
END $$;

ALTER TABLE public.lead_ai_statuses
  ADD CONSTRAINT lead_ai_status_label CHECK (
    length(status) BETWEEN 3 AND 48
    AND status ~ '^[A-Za-z][A-Za-z/-]*( [A-Za-z][A-Za-z/-]*){1,2}$'
  );

COMMENT ON COLUMN public.lead_ai_statuses.status IS
  'Preferred operational label or a validated two/three-word AI fallback.';

-- Rollback: redeploy the previous enum-only classifier first. Review/remap any
-- non-legacy labels in lead_ai_statuses, then replace this constraint with the
-- enum CHECK from 20261107000000_ai_urgent_features.sql. Do not delete leads.
