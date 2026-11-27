-- =============================================================================
-- Lead tech contacts: read Texted / Called / Not texted and the processor's
-- remark from the tech's line in the processor notes
-- =============================================================================
-- WHY
--   Processors already record the contact state in the tech line itself
--   ("Tech 2: Sam - (305) 555-0123 - texted", "... - called, no answer",
--   "... - not-texted"); 1,883 of 3,399 lines said "texted" when this shipped.
--   The boss's rule: tracking starts when the note says Texted or Called.
--   The rest of the line ("ooa", "far away", "dont do govee",
--   "today 1-3pm for $950 labor") is the processor's own record for this job,
--   so it is stored per tech and given to the AI next to the tech's Quo chat.
--
-- RULES
--   * The note sets the state unless a manual change (set_lead_tech_contact_state)
--     is newer than the note line. Editing the line later makes the note win again.
--   * "not texted" / "not-texted" / "not texted yet" -> not_texted
--     "call" / "called"                             -> called
--     "text" / "texted" / "texed" / "txt" / "msg" / "messaged" / "sms" -> texted
--   * A changed phone number or remark sends the tech back to the AI
--     (verdict_checked_at cleared); a changed phone also clears the verdict.
--   * contacted_at for a note-derived contact is the note's time.
--
-- HARNESS : supabase/tests/201_lead_tech_contacts.sql (extended)
-- ROLLBACK: bottom of this file.
-- =============================================================================

ALTER TABLE public.lead_tech_contacts
  ADD COLUMN IF NOT EXISTS processor_note  text,
  ADD COLUMN IF NOT EXISTS note_at         timestamptz,
  ADD COLUMN IF NOT EXISTS state_source    text,
  ADD COLUMN IF NOT EXISTS state_set_at    timestamptz,
  ADD COLUMN IF NOT EXISTS evidence_source text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_tech_contact_state_source') THEN
    ALTER TABLE public.lead_tech_contacts
      ADD CONSTRAINT lead_tech_contact_state_source CHECK (state_source IS NULL OR state_source IN ('note', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_tech_contact_evidence_source') THEN
    ALTER TABLE public.lead_tech_contacts
      ADD CONSTRAINT lead_tech_contact_evidence_source CHECK (evidence_source IS NULL OR evidence_source IN ('tech_chat', 'processor_note'));
  END IF;
END $$;

-- Contact state written in a tech line's remark, or NULL when it says none.
CREATE OR REPLACE FUNCTION marshmallow_private.tech_note_state(p_remark text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN r ~ '\mnot[ _-]*(yet[ _-]*)?(text|texted|texed|txt|msg|messaged|called|contacted)\M' THEN 'not_texted'
    WHEN r ~ '\mcall(ed)?\M' THEN 'called'
    WHEN r ~ '\m(text|texted|texed|txt|txted|msg|msgd|messaged|sms)\M' THEN 'texted'
  END
  FROM (SELECT lower(coalesce(p_remark, '')) AS r) x
$$;

-- Return type changes (adds remark + note time), so the old signature is dropped first.
DROP FUNCTION IF EXISTS marshmallow_private.parse_lead_techs(uuid);
CREATE FUNCTION marshmallow_private.parse_lead_techs(p_lead_id uuid)
RETURNS TABLE (tech_number integer, name text, phone text, remark text, note_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT ON (p.tech_number) p.tech_number, p.name, p.phone, nullif(p.remark, ''), p.note_at
    FROM (
      SELECT n.id, greatest(n.created_at, n.edited_at) AS note_at,
             (m.parts)[1]::integer AS tech_number,
             btrim(split_part((m.parts)[2], ' - ', 1)) AS name,
             (SELECT btrim(s.seg) FROM unnest(string_to_array((m.parts)[2], ' - ')) WITH ORDINALITY AS s(seg, i)
               WHERE s.i > 1 AND marshmallow_private.tech_phone_key(s.seg) IS NOT NULL
               ORDER BY s.i LIMIT 1) AS phone,
             left((SELECT string_agg(btrim(s.seg), ' - ' ORDER BY s.i)
                     FROM unnest(string_to_array((m.parts)[2], ' - ')) WITH ORDINALITY AS s(seg, i)
                    WHERE s.i > 1 AND marshmallow_private.tech_phone_key(s.seg) IS NULL AND btrim(s.seg) <> ''), 500) AS remark
        FROM public.lead_notes n
        CROSS JOIN LATERAL regexp_split_to_table(n.content, E'\r?\n') AS line
        CROSS JOIN LATERAL (
          SELECT regexp_match(line, '^[ \t]*tech[ \t]*#?[ \t]*([0-9]{1,3})[ \t]*(?::|-|–)?[ \t]*(.*)$', 'i') AS parts
        ) m
       WHERE n.lead_id = p_lead_id AND n.note_type = 'processor' AND m.parts IS NOT NULL
    ) p
   ORDER BY p.tech_number, p.note_at DESC NULLS LAST, p.id DESC
$$;
REVOKE ALL ON FUNCTION marshmallow_private.parse_lead_techs(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.sync_lead_techs(p_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p record; t public.lead_tech_contacts; key text; note_state text;
  new_state text; new_source text; new_set_at timestamptz; new_contacted timestamptz;
  phone_changed boolean; remark_changed boolean;
BEGIN
  IF p_lead_id IS NULL THEN RETURN; END IF;

  FOR p IN SELECT * FROM marshmallow_private.parse_lead_techs(p_lead_id) LOOP
    key := marshmallow_private.tech_phone_key(p.phone);
    note_state := marshmallow_private.tech_note_state(p.remark);
    SELECT * INTO t FROM public.lead_tech_contacts WHERE lead_id = p_lead_id AND tech_number = p.tech_number FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.lead_tech_contacts (lead_id, tech_number, name, phone, phone_key, processor_note, note_at,
        state, state_source, state_set_at, contacted_at, verdict)
      VALUES (p_lead_id, p.tech_number, coalesce(p.name, ''), p.phone, key, p.remark, p.note_at,
        coalesce(note_state, 'not_texted'),
        CASE WHEN note_state IS NOT NULL THEN 'note' END,
        CASE WHEN note_state IS NOT NULL THEN p.note_at END,
        CASE WHEN note_state IN ('texted', 'called') THEN p.note_at END,
        CASE WHEN note_state IN ('texted', 'called') THEN 'pending' END);
      CONTINUE;
    END IF;

    -- The note decides unless a manual change is newer than this note line.
    new_state := t.state; new_source := t.state_source; new_set_at := t.state_set_at; new_contacted := t.contacted_at;
    IF note_state IS NOT NULL
       AND (t.state_source IS DISTINCT FROM 'manual' OR t.state_set_at IS NULL OR t.state_set_at < p.note_at) THEN
      new_source := 'note';
      new_set_at := p.note_at;
      new_state := note_state;
      new_contacted := CASE WHEN note_state = 'not_texted' THEN NULL ELSE coalesce(t.contacted_at, p.note_at) END;
    END IF;

    phone_changed := t.phone_key IS DISTINCT FROM key;
    remark_changed := t.processor_note IS DISTINCT FROM p.remark;

    IF (t.name, t.phone, t.phone_key, t.processor_note, t.note_at, t.state, t.state_source, t.state_set_at, t.contacted_at)
       IS NOT DISTINCT FROM (coalesce(p.name, ''), p.phone, key, p.remark, p.note_at, new_state, new_source, new_set_at, new_contacted) THEN
      CONTINUE;
    END IF;

    UPDATE public.lead_tech_contacts
       SET name = coalesce(p.name, ''), phone = p.phone, phone_key = key,
           processor_note = p.remark, note_at = p.note_at,
           state = new_state, state_source = new_source, state_set_at = new_set_at, contacted_at = new_contacted,
           verdict = CASE WHEN new_state = 'not_texted' THEN NULL
                          WHEN phone_changed OR t.verdict IS NULL THEN 'pending'
                          ELSE t.verdict END,
           verdict_reason = CASE WHEN new_state = 'not_texted' OR phone_changed THEN NULL ELSE t.verdict_reason END,
           evidence_quote = CASE WHEN new_state = 'not_texted' OR phone_changed THEN NULL ELSE t.evidence_quote END,
           evidence_at = CASE WHEN new_state = 'not_texted' OR phone_changed THEN NULL ELSE t.evidence_at END,
           evidence_source = CASE WHEN new_state = 'not_texted' OR phone_changed THEN NULL ELSE t.evidence_source END,
           -- A new number or remark is new information: let the AI read it again.
           verdict_checked_at = CASE WHEN new_state = 'not_texted' OR phone_changed OR remark_changed THEN NULL
                                     ELSE t.verdict_checked_at END,
           updated_at = now()
     WHERE id = t.id;
  END LOOP;

  DELETE FROM public.lead_tech_contacts x
   WHERE x.lead_id = p_lead_id
     AND NOT EXISTS (SELECT 1 FROM marshmallow_private.parse_lead_techs(p_lead_id) q WHERE q.tech_number = x.tech_number);
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.sync_lead_techs(uuid) FROM PUBLIC, anon, authenticated;

-- Note edits change edited_at too; re-sync on it so a re-edited line can win again.
DROP TRIGGER IF EXISTS lead_notes_sync_techs ON public.lead_notes;
CREATE TRIGGER lead_notes_sync_techs
  AFTER INSERT OR DELETE OR UPDATE OF content, note_type, lead_id, edited_at ON public.lead_notes
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.trg_lead_notes_sync_techs();

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
  RAISE WARNING 'tech sync skipped for lead %: %', coalesce(NEW.lead_id, OLD.lead_id), SQLERRM;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.trg_lead_notes_sync_techs() FROM PUBLIC, anon, authenticated;

-- Manual change: marks itself manual and newer than the note line.
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
         state_source = 'manual',
         state_set_at = now(),
         contacted_at = CASE WHEN p_state = 'not_texted' THEN NULL ELSE coalesce(t.contacted_at, now()) END,
         verdict = CASE WHEN p_state = 'not_texted' THEN NULL ELSE coalesce(t.verdict, 'pending') END,
         verdict_reason = CASE WHEN p_state = 'not_texted' THEN NULL ELSE t.verdict_reason END,
         evidence_quote = CASE WHEN p_state = 'not_texted' THEN NULL ELSE t.evidence_quote END,
         evidence_at = CASE WHEN p_state = 'not_texted' THEN NULL ELSE t.evidence_at END,
         evidence_source = CASE WHEN p_state = 'not_texted' THEN NULL ELSE t.evidence_source END,
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

-- Re-read every lead's tech lines with the new rules.
DO $$
DECLARE l uuid;
BEGIN
  FOR l IN SELECT DISTINCT lead_id FROM public.lead_notes WHERE note_type = 'processor' AND content ~* 'tech' LOOP
    PERFORM marshmallow_private.sync_lead_techs(l);
  END LOOP;
END $$;

-- =============================================================================
-- ROLLBACK (re-apply 20261127061449_lead_tech_contacts.sql's functions after)
-- =============================================================================
/*
DROP FUNCTION IF EXISTS marshmallow_private.tech_note_state(text);
ALTER TABLE public.lead_tech_contacts
  DROP COLUMN IF EXISTS processor_note, DROP COLUMN IF EXISTS note_at,
  DROP COLUMN IF EXISTS state_source, DROP COLUMN IF EXISTS state_set_at,
  DROP COLUMN IF EXISTS evidence_source;
*/
