-- =============================================================================
-- Migration : 20261231000200_lead_photos_private_bucket.sql
-- Purpose   : Security audit 2026-11-21 follow-up to
--             20261231000100_security_audit_least_privilege.sql.
--
-- DEFECT
--   storage bucket `lead-photos` was public: anyone holding an object URL could
--   download job photos, payment screenshots and cancellation proof without
--   signing in, and those URLs were copied into the Google Sheet.
--
-- WHY THIS IS SAFE
--   * Every stored value is a storage path (verified read-only on production:
--     11,712 lead_photos rows, 6 payment screenshots; 0 full URLs).
--   * The CRM and Donut display/hand off photos through createSignedUrl(s)
--     (src/lib/storage.ts), which works for private buckets via the existing
--     "Authenticated users can read lead-photos" SELECT policy.
--   * The Google Sheets export (src/lib/google-sheets.ts and the
--     google-sheets-sync Edge Function) now writes a photo count instead of
--     links. Links already in the Sheet stop opening.
--
-- ROLLBACK (re-exposes every photo to anyone with a link; not recommended)
/*
UPDATE storage.buckets SET public = true WHERE id = 'lead-photos';
*/
-- =============================================================================

UPDATE storage.buckets SET public = false WHERE id = 'lead-photos' AND public IS DISTINCT FROM false;
