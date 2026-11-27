-- =============================================================================
-- Lead tech contacts: Not Texted / Texted / Called + AI verdict per tech, per job
-- =============================================================================
-- WHAT
--   * lead_tech_contacts : one row per "Tech N: name - phone - note" line in a
--                          lead's processor notes. The notes stay the source of
--                          truth for WHO the techs are; this table holds what
--                          the processor did (state) and what the AI read back
--                          from the tech's Quo chat (verdict).
--   * set_lead_tech_contact_state(lead, tech_number, state) : Admin / Processor.
--                          Moving a tech to texted/called starts AI tracking
--                          from that moment; back to not_texted stops it.
--   Verdict columns are written only by the `lead-tech-status` Edge Function
--   (service role). AI results are advisory.
--
-- WHO SEES IT
--   Admin and Processor only (tech details are hidden from CS Admin elsewhere,
--   and the boss asked for this status for processors).
--
-- HOW IT STAYS CURRENT
--   A trigger on lead_notes re-reads the lead's processor notes after every
--   insert / edit / delete, so a tech added, renamed, re-numbered or removed in
--   the notes is reflected here. A changed phone number resets the verdict.
--   Existing processor notes are backfilled once.
--
-- HARNESS : supabase/tests/201_lead_tech_contacts.sql
--           (isolated PGlite: node scripts/test-lead-tech-contacts-db.mjs <pglite dir>)
-- ROLLBACK: bottom of this file.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS marshmallow_private;

CREATE TABLE IF NOT EXISTS public.lead_tech_contacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id            uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tech_number        integer NOT NULL,
  name               text NOT NULL DEFAULT '',
  phone              text,
  -- 10 digits, for matching the tech's Quo conversation.
  phone_key          text,
  state              text NOT NULL DEFAULT 'not_texted',
  contacted_at       timestamptz,
  state_set_by       uuid,
  verdict            text,
  verdict_reason     text,
  evidence_quote     text,
  evidence_at        timestamptz,
  last_tech_message_at timestamptz,
  verdict_checked_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_tech_contact_state CHECK (state IN ('not_texted', 'texted', 'called')),
  CONSTRAINT lead_tech_contact_verdict CHECK (verdict IS NULL OR verdict IN ('pending', 'agreed', 'declined', 'unclear', 'no_chat')),
  CONSTRAINT lead_tech_contact_unique UNIQUE (lead_id, tech_number)
);

CREATE INDEX IF NOT EXISTS lead_tech_contacts_phone_key_idx
  ON public.lead_tech_contacts (phone_key) WHERE state <> 'not_texted';

COMMENT ON TABLE public.lead_tech_contacts IS
  'Techs from a lead''s processor notes ("Tech N: ..."), with Not Texted / Texted / Called '
  'and the advisory AI verdict from that tech''s Quo chat for this job.';

ALTER TABLE public.lead_tech_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins and processors read lead techs" ON public.lead_tech_contacts;
CREATE POLICY "Admins and processors read lead techs"
  ON public.lead_tech_contacts FOR SELECT TO authenticated
  USING ((SELECT marshmallow_private.caller_role()) IN ('admin', 'processor'));

REVOKE ALL ON TABLE public.lead_tech_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_tech_contacts TO authenticated;
GRANT ALL ON public.lead_tech_contacts TO service_role;

-- -----------------------------------------------------------------------------
-- Note parsing (mirrors src/lib/lead-techs.ts)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marshmallow_private.tech_phone_key(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN length(d) = 10 THEN d
    WHEN length(d) = 11 AND left(d, 1) = '1' THEN right(d, 10)
  END
  FROM (SELECT regexp_replace(coalesce(p_value, ''), '\D', '', 'g') AS d) x
$$;

-- Techs written in a lead's processor notes; the newest line wins for a repeated number.
CREATE OR REPLACE FUNCTION marshmallow_private.parse_lead_techs(p_lead_id uuid)
RETURNS TABLE (tech_number integer, name text, phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT ON (p.tech_number) p.tech_number, p.name, p.phone
    FROM (
      SELECT n.created_at, n.id,
             (m.parts)[1]::integer AS tech_number,
             btrim(split_part((m.parts)[2], ' - ', 1)) AS name,
             (SELECT btrim(s.seg) FROM unnest(string_to_array((m.parts)[2], ' - ')) WITH ORDINALITY AS s(seg, i)
               WHERE s.i > 1 AND marshmallow_private.tech_phone_key(s.seg) IS NOT NULL
               ORDER BY s.i LIMIT 1) AS phone
        FROM public.lead_notes n
        CROSS JOIN LATERAL regexp_split_to_table(n.content, E'\r?\n') AS line
        CROSS JOIN LATERAL (
          SELECT regexp_match(line, '^[ \t]*tech[ \t]*#?[ \t]*([0-9]{1,3})[ \t]*(?::|-|–)?[ \t]*(.*)$', 'i') AS parts
        ) m
       WHERE n.lead_id = p_lead_id AND n.note_type = 'processor' AND m.parts IS NOT NULL
    ) p
   ORDER BY p.tech_number, p.created_at DESC NULLS LAST, p.id DESC
$$;

REVOKE ALL ON FUNCTION marshmallow_private.parse_lead_techs(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.sync_lead_techs(p_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_lead_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.lead_tech_contacts AS t (lead_id, tech_number, name, phone, phone_key)
  SELECT p_lead_id, tech_number, coalesce(name, ''), phone, marshmallow_private.tech_phone_key(phone)
    FROM marshmallow_private.parse_lead_techs(p_lead_id)
  ON CONFLICT (lead_id, tech_number) DO UPDATE
     SET name = excluded.name,
         phone = excluded.phone,
         phone_key = excluded.phone_key,
         -- A different number is a different chat: the old verdict no longer applies.
         verdict = CASE WHEN t.phone_key IS DISTINCT FROM excluded.phone_key AND t.state <> 'not_texted' THEN 'pending'
                        WHEN t.phone_key IS DISTINCT FROM excluded.phone_key THEN NULL ELSE t.verdict END,
         verdict_reason = CASE WHEN t.phone_key IS DISTINCT FROM excluded.phone_key THEN NULL ELSE t.verdict_reason END,
         evidence_quote = CASE WHEN t.phone_key IS DISTINCT FROM excluded.phone_key THEN NULL ELSE t.evidence_quote END,
         evidence_at = CASE WHEN t.phone_key IS DISTINCT FROM excluded.phone_key THEN NULL ELSE t.evidence_at END,
         verdict_checked_at = CASE WHEN t.phone_key IS DISTINCT FROM excluded.phone_key THEN NULL ELSE t.verdict_checked_at END,
         updated_at = now()
   WHERE (t.name, t.phone, t.phone_key) IS DISTINCT FROM (excluded.name, excluded.phone, excluded.phone_key);

  DELETE FROM public.lead_tech_contacts t
   WHERE t.lead_id = p_lead_id
     AND NOT EXISTS (SELECT 1 FROM marshmallow_private.parse_lead_techs(p_lead_id) p WHERE p.tech_number = t.tech_number);
END $$;

REVOKE ALL ON FUNCTION marshmallow_private.sync_lead_techs(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.trg_lead_notes_sync_techs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.note_type = 'processor' THEN
    PERFORM marshmallow_private.sync_lead_techs(OLD.lead_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.note_type = 'processor'
     AND (TG_OP = 'INSERT' OR OLD.lead_id IS DISTINCT FROM NEW.lead_id OR OLD.note_type IS DISTINCT FROM NEW.note_type) THEN
    PERFORM marshmallow_private.sync_lead_techs(NEW.lead_id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Tech tracking is a follow-up: it must never block saving a processor note.
  RAISE WARNING 'tech sync skipped for lead %: %', coalesce(NEW.lead_id, OLD.lead_id), SQLERRM;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION marshmallow_private.trg_lead_notes_sync_techs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS lead_notes_sync_techs ON public.lead_notes;
CREATE TRIGGER lead_notes_sync_techs
  AFTER INSERT OR DELETE OR UPDATE OF content, note_type, lead_id ON public.lead_notes
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.trg_lead_notes_sync_techs();

-- -----------------------------------------------------------------------------
-- Processor action: Not Texted / Texted / Called
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_lead_tech_contact_state(p_lead_id uuid, p_tech_number integer, p_state text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE uid uuid := auth.uid(); row public.lead_tech_contacts;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF coalesce(marshmallow_private.caller_role(), '') NOT IN ('admin', 'processor') THEN
    RAISE EXCEPTION 'Only Admins and Processors can update tech contact.' USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('not_texted', 'texted', 'called') THEN
    RAISE EXCEPTION 'Unknown tech contact state.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.lead_tech_contacts t
     SET state = p_state,
         state_set_by = uid,
         contacted_at = CASE WHEN p_state = 'not_texted' THEN NULL ELSE coalesce(t.contacted_at, now()) END,
         verdict = CASE WHEN p_state = 'not_texted' THEN NULL ELSE coalesce(t.verdict, 'pending') END,
         verdict_reason = CASE WHEN p_state = 'not_texted' THEN NULL ELSE t.verdict_reason END,
         evidence_quote = CASE WHEN p_state = 'not_texted' THEN NULL ELSE t.evidence_quote END,
         evidence_at = CASE WHEN p_state = 'not_texted' THEN NULL ELSE t.evidence_at END,
         verdict_checked_at = CASE WHEN p_state = 'not_texted' THEN NULL ELSE t.verdict_checked_at END,
         updated_at = now()
   WHERE t.lead_id = p_lead_id AND t.tech_number = p_tech_number
  RETURNING * INTO row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tech % is not in this lead''s processor notes.', p_tech_number USING ERRCODE = 'P0002';
  END IF;
  RETURN to_jsonb(row);
END $$;

REVOKE ALL ON FUNCTION public.set_lead_tech_contact_state(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_tech_contact_state(uuid, integer, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- Realtime + backfill
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                      AND schemaname = 'public' AND tablename = 'lead_tech_contacts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_tech_contacts;
  END IF;
END $$;

DO $$
DECLARE l uuid;
BEGIN
  FOR l IN SELECT DISTINCT lead_id FROM public.lead_notes WHERE note_type = 'processor' AND content ~* 'tech' LOOP
    PERFORM marshmallow_private.sync_lead_techs(l);
  END LOOP;
END $$;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
/*
DROP TRIGGER IF EXISTS lead_notes_sync_techs ON public.lead_notes;
DROP FUNCTION IF EXISTS public.set_lead_tech_contact_state(uuid, integer, text);
DROP FUNCTION IF EXISTS marshmallow_private.trg_lead_notes_sync_techs();
DROP FUNCTION IF EXISTS marshmallow_private.sync_lead_techs(uuid);
DROP FUNCTION IF EXISTS marshmallow_private.parse_lead_techs(uuid);
DROP FUNCTION IF EXISTS marshmallow_private.tech_phone_key(text);
DROP TABLE IF EXISTS public.lead_tech_contacts;
*/
