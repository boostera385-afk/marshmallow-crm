-- =============================================================================
-- Migration: 20261117000000_technician_processing_workflow.sql
-- Purpose: Persist technician conversation assessments and relationship labels
--          while restricting direct access to the intended roles.
-- Defect fixed: Technician reviews had no durable assessment record, and the
--               initial schema left default table grants in place for anon.
--               This unique version also avoids colliding with the remote
--               20261106000000 migration version.
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.technician_workflow_assessments;
--   DROP FUNCTION IF EXISTS public.set_technician_workflow_updated_at();
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.technician_workflow_assessments (
  technician_id UUID PRIMARY KEY REFERENCES public.technicians(id) ON DELETE CASCADE,
  labels TEXT[] NOT NULL DEFAULT '{}'::text[]
    CHECK (labels <@ ARRAY[
      'tech_dont_respond',
      'tech_is_scammer',
      'late_payment',
      'never_responded',
      'high_rates',
      'dont_cooperate',
      'rude',
      'paid_us_before',
      'good_tech'
    ]::text[]),
  ai_recommendations TEXT[] NOT NULL DEFAULT '{}'::text[],
  ai_summary TEXT,
  ai_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  conversations_reviewed INTEGER NOT NULL DEFAULT 0 CHECK (conversations_reviewed >= 0),
  messages_reviewed INTEGER NOT NULL DEFAULT 0 CHECK (messages_reviewed >= 0),
  last_assessed_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.technician_workflow_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin and processor read technician workflow assessments"
  ON public.technician_workflow_assessments;
CREATE POLICY "Admin and processor read technician workflow assessments"
  ON public.technician_workflow_assessments
  FOR SELECT TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'processor'::public.app_role)
  );

-- Writes are performed by the authenticated, role-checked Edge Function using
-- service_role. No direct authenticated INSERT/UPDATE policy is granted.
REVOKE ALL ON TABLE public.technician_workflow_assessments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.technician_workflow_assessments TO authenticated;
GRANT ALL ON public.technician_workflow_assessments TO service_role;

CREATE INDEX IF NOT EXISTS technician_workflow_updated_idx
  ON public.technician_workflow_assessments (updated_at DESC);
CREATE INDEX IF NOT EXISTS technician_workflow_updated_by_idx
  ON public.technician_workflow_assessments (updated_by);

CREATE OR REPLACE FUNCTION public.set_technician_workflow_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_technician_workflow_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS set_technician_workflow_updated_at
  ON public.technician_workflow_assessments;
CREATE TRIGGER set_technician_workflow_updated_at
  BEFORE UPDATE ON public.technician_workflow_assessments
  FOR EACH ROW EXECUTE FUNCTION public.set_technician_workflow_updated_at();
