-- Purpose: replace the webhook's multi-request partial save with one transaction.
-- A failed attempt rolls back; a retry of an old unfinished event is not mistaken
-- for a completed duplicate. Event row locks serialize concurrent deliveries.
-- Signature validation and the ingestion-pause check remain in both Edge endpoints.
-- Service-only RPC; no browser grants, lead/status/schedule writes or bulk replay.
-- Apply manually before deploying BOTH webhook functions. Existing raw events are
-- not repaired by this migration. Generated public RPC types need regeneration
-- from the intended schema before rollout (never hand-edit types.ts).
-- Rollback: redeploy the previous webhook functions FIRST, then
-- DROP FUNCTION IF EXISTS public.ingest_quo_message(jsonb);
BEGIN;
CREATE OR REPLACE FUNCTION public.ingest_quo_message(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  m jsonb := p_input->'message'; c jsonb := p_input->'conversation';
  ev_id text := nullif(p_input->>'event_id',''); ev_type text := p_input->>'event_type';
  event_row public.quo_webhook_events%rowtype;
  conv public.quo_conversations%rowtype;
  phone_id uuid; conv_id uuid; lead_id uuid; message_id uuid;
  message_at timestamptz; was_retry boolean := false; is_newer boolean;
BEGIN
  -- Match the production schedule-evidence trigger: PostgREST's service key is
  -- visible either as a verified JWT claim or as the SET ROLE setting.
  IF coalesce(auth.role(),nullif(current_setting('request.jwt.claim.role',true),''),'') <> 'service_role'
     AND current_setting('role',true) <> 'service_role' THEN
    RAISE EXCEPTION 'Service ingestion only' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR jsonb_typeof(c) IS DISTINCT FROM 'object'
     OR nullif(m->>'id','') IS NULL OR nullif(ev_type,'') IS NULL
     OR coalesce(m->>'sender','') NOT IN ('customer','agent')
     OR coalesce(m->>'direction','') NOT IN ('inbound','outbound')
     OR jsonb_typeof(p_input->'raw_payload') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid normalized webhook event' USING ERRCODE='22023';
  END IF;
  message_at := (m->>'createdAt')::timestamptz;
  IF message_at IS NULL THEN RAISE EXCEPTION 'Message time required' USING ERRCODE='22023'; END IF;

  INSERT INTO public.quo_webhook_events(quo_event_id,event_type,quo_message_id,quo_conversation_id,
    quo_phone_number_id,raw_payload,processing_status,signature_verified)
  VALUES(ev_id,ev_type,m->>'id',c->>'id',c->>'phoneNumberId',p_input->'raw_payload','processing',
    coalesce((p_input->>'signature_verified')::boolean,false))
  ON CONFLICT DO NOTHING RETURNING * INTO event_row;
  IF NOT found THEN
    was_retry := true;
    -- Prefer the delivery id, but also respect the message/type uniqueness key.
    IF ev_id IS NOT NULL THEN
      SELECT * INTO event_row FROM public.quo_webhook_events WHERE quo_event_id=ev_id FOR UPDATE;
    END IF;
    IF event_row.id IS NULL THEN
      SELECT * INTO event_row FROM public.quo_webhook_events
       WHERE quo_message_id=m->>'id' AND event_type=ev_type FOR UPDATE;
    END IF;
    IF event_row.id IS NULL THEN RAISE EXCEPTION 'Webhook conflict could not be resolved' USING ERRCODE='40001'; END IF;
    IF event_row.processing_status IN ('processed','ignored') THEN
      RETURN jsonb_build_object('success',true,'ignored',true,'duplicate',true,'event_type',ev_type,'quo_message_id',m->>'id');
    END IF;
  END IF;

  IF nullif(c->>'id','') IS NULL THEN
    SELECT q.conversation_id INTO conv_id FROM public.quo_messages q
     WHERE q.quo_message_id=split_part(m->>'id',':',1)||':call.completed';
    SELECT * INTO conv FROM public.quo_conversations WHERE id=conv_id FOR UPDATE;
    lead_id := conv.linked_lead_id;
  ELSE
    IF nullif(c->>'phoneNumberId','') IS NOT NULL THEN
      INSERT INTO public.quo_phone_numbers AS p(quo_phone_number_id,number,display_number,name,label,active)
      VALUES(c->>'phoneNumberId',coalesce(c->>'phoneNumberDisplay',c->>'phoneNumberId'),
        c->>'phoneNumberDisplay',c->>'phoneNumberName',c->>'phoneNumberName',true)
      ON CONFLICT(quo_phone_number_id) DO UPDATE SET number=excluded.number,display_number=excluded.display_number,
        name=excluded.name,label=excluded.label,active=true
      WHERE (p.number,p.display_number,p.name,p.label,p.active)
        IS DISTINCT FROM (excluded.number,excluded.display_number,excluded.name,excluded.label,true)
      RETURNING id INTO phone_id;
      IF phone_id IS NULL THEN SELECT id INTO phone_id FROM public.quo_phone_numbers WHERE quo_phone_number_id=c->>'phoneNumberId'; END IF;
    END IF;
    -- Serialize different messages for the same conversation, including creation.
    PERFORM pg_advisory_xact_lock(hashtextextended(c->>'id',73119));
    SELECT * INTO conv FROM public.quo_conversations WHERE quo_conversation_id=c->>'id' FOR UPDATE;
    lead_id := conv.linked_lead_id; -- Never replace a saved/manual conversation link.
    IF lead_id IS NULL AND nullif(c->>'customerNumber','') IS NOT NULL THEN
      SELECT id INTO lead_id FROM public.leads WHERE customer_phone=c->>'customerNumber' ORDER BY created_at DESC,id DESC LIMIT 1;
    END IF;
    is_newer := conv.last_message_at IS NULL OR message_at >= conv.last_message_at;
    IF conv.id IS NULL THEN
      INSERT INTO public.quo_conversations(quo_conversation_id,customer_name,customer_number,number_id,linked_lead_id,
        status,current_status,raw_payload,last_message_preview,last_message_time,last_message_at,direction,
        last_customer_message_at,last_agent_message_at)
      VALUES(c->>'id',c->>'customerName',c->>'customerNumber',phone_id,lead_id,'active','open',p_input->'raw_payload',
        p_input->>'preview',message_at,message_at,CASE WHEN m->>'direction'='inbound' THEN 'incoming' ELSE 'outgoing' END,
        CASE WHEN m->>'sender'='customer' THEN message_at END,CASE WHEN m->>'sender'='agent' THEN message_at END)
      RETURNING id INTO conv_id;
    ELSE
      conv_id := conv.id;
      -- A retry of old work must not rewind the inbox or reopen a closed chat.
      IF NOT was_retry OR is_newer THEN
        UPDATE public.quo_conversations SET
          customer_name=c->>'customerName',customer_number=c->>'customerNumber',number_id=phone_id,
          linked_lead_id=lead_id,status='active',current_status='open',raw_payload=p_input->'raw_payload',
          last_message_preview=CASE WHEN is_newer THEN p_input->>'preview' ELSE last_message_preview END,
          last_message_time=CASE WHEN is_newer THEN message_at ELSE last_message_time END,
          last_message_at=CASE WHEN is_newer THEN message_at ELSE last_message_at END,
          direction=CASE WHEN is_newer THEN CASE WHEN m->>'direction'='inbound' THEN 'incoming' ELSE 'outgoing' END ELSE direction END,
          last_customer_message_at=CASE WHEN is_newer AND m->>'sender'='customer' THEN message_at ELSE last_customer_message_at END,
          last_agent_message_at=CASE WHEN is_newer AND m->>'sender'='agent' THEN message_at ELSE last_agent_message_at END
        WHERE id=conv_id;
      END IF;
    END IF;
  END IF;
  IF conv_id IS NULL THEN RAISE EXCEPTION 'Could not determine conversation_id for message' USING ERRCODE='22023'; END IF;
  INSERT INTO public.quo_messages AS q(quo_message_id,conversation_id,sender,direction,recipients,text,media,status,message_time,quo_created_at,raw_payload)
  VALUES(m->>'id',conv_id,m->>'sender',m->>'direction',coalesce(m->'to','[]'::jsonb),m->>'text',
    coalesce(m->'media','[]'::jsonb),m->>'status',message_at,message_at,p_input->'raw_payload')
  ON CONFLICT(quo_message_id) DO UPDATE SET conversation_id=excluded.conversation_id,sender=excluded.sender,
    direction=excluded.direction,recipients=excluded.recipients,text=excluded.text,media=excluded.media,
    status=excluded.status,message_time=excluded.message_time,quo_created_at=excluded.quo_created_at,raw_payload=excluded.raw_payload
  WHERE (q.conversation_id,q.sender,q.direction,q.recipients,q.text,q.media,q.status,q.message_time,q.quo_created_at,q.raw_payload)
    IS DISTINCT FROM (excluded.conversation_id,excluded.sender,excluded.direction,excluded.recipients,excluded.text,
      excluded.media,excluded.status,excluded.message_time,excluded.quo_created_at,excluded.raw_payload)
  RETURNING id INTO message_id;
  IF message_id IS NULL THEN SELECT id INTO message_id FROM public.quo_messages WHERE quo_message_id=m->>'id'; END IF;
  INSERT INTO public.quo_conversation_flags(conversation_id) VALUES(conv_id) ON CONFLICT DO NOTHING;
  UPDATE public.quo_webhook_events SET processing_status='processed',processed_at=now(),error_message=NULL WHERE id=event_row.id;
  RETURN jsonb_build_object('success',true,'conversation_id',conv_id,'message_id',message_id,'linked_lead_id',lead_id);
END $$;
REVOKE ALL ON FUNCTION public.ingest_quo_message(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_quo_message(jsonb) TO service_role;
COMMIT;
