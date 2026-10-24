-- Purpose: OFF-by-default, shadow-first schedule confirmation monitoring. Only
-- verified server-ingested evidence can reach the guarded tag-only transition.
-- No existing job/data repair, cron registration, secret change or activation.
-- Apply manually AFTER 20261020065810_workflow_resolution_notifications.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS marshmallow_private.schedule_monitor_config (
  id boolean PRIMARY KEY DEFAULT true CHECK(id), mode text NOT NULL DEFAULT 'off' CHECK(mode IN ('off','shadow','automatic')),
  timezone text NOT NULL DEFAULT 'America/New_York', shadow_started_at timestamptz,
  cooldown_until timestamptz, changed_at timestamptz NOT NULL DEFAULT now(),
  usage_date date, daily_checks integer NOT NULL DEFAULT 0
);
INSERT INTO marshmallow_private.schedule_monitor_config(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS marshmallow_private.schedule_monitor_links (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.quo_conversations(id) ON DELETE CASCADE,
  verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL, timezone text NOT NULL
);
CREATE TABLE IF NOT EXISTS marshmallow_private.schedule_monitor_queue (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 1, entered_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(), lease uuid, lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'pending',
  evidence jsonb, result jsonb, checked_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, reviewed_at timestamptz, review_decision text, review_note text
);
CREATE TABLE IF NOT EXISTS marshmallow_private.schedule_monitor_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  generation integer NOT NULL, evidence_id uuid, decision text NOT NULL CHECK(decision IN ('accept','reject')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, reviewed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL, UNIQUE(lead_id,generation)
);
-- Internal-only queues: RLS deliberately has no browser policies. Workers use
-- narrow service-only RPCs, not table access or client-supplied authorization.
ALTER TABLE marshmallow_private.schedule_monitor_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE marshmallow_private.schedule_monitor_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE marshmallow_private.schedule_monitor_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE marshmallow_private.schedule_monitor_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marshmallow_private.schedule_monitor_config,marshmallow_private.schedule_monitor_links,marshmallow_private.schedule_monitor_queue,marshmallow_private.schedule_monitor_reviews FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.schedule_ingestion_paused() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT value='true'::jsonb FROM public.quo_ai_settings WHERE key='quo_webhook_ingestion_paused'),false);
$$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_ingestion_paused() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION marshmallow_private.invalidate_paused_schedule_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE marshmallow_private.schedule_monitor_queue SET generation=generation+1,evidence=NULL,result=NULL,state='pending',lease=NULL,lease_until=NULL,attempts=0,available_at=now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.invalidate_paused_schedule_evidence() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS settings_invalidate_schedule_evidence ON public.quo_ai_settings;
CREATE TRIGGER settings_invalidate_schedule_evidence AFTER INSERT OR UPDATE OF value ON public.quo_ai_settings
  FOR EACH ROW WHEN (NEW.key='quo_webhook_ingestion_paused') EXECUTE FUNCTION marshmallow_private.invalidate_paused_schedule_evidence();

CREATE OR REPLACE FUNCTION marshmallow_private.schedule_eligible(l public.leads) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(l.cs_tag='waiting_schedule_confirmation' AND l.status IN ('urgent_job','need_tech','needs_reschedule','waiting_customer_response','activate_customer','quote_sent_waiting','quote_sent_need_follow_up','post_visit_quote_sent_waiting')
    AND NOT EXISTS(SELECT 1 FROM public.lead_cancellation_requests WHERE lead_id=l.id AND status='pending')
    AND NOT EXISTS(SELECT 1 FROM public.lead_payment_requests WHERE lead_id=l.id AND status='pending')
    AND NOT EXISTS(SELECT 1 FROM public.lead_quote_approval_requests WHERE lead_id=l.id AND status='pending'),false);
$$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_eligible(public.leads) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.capture_schedule_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.cs_tag='waiting_schedule_confirmation' THEN
    INSERT INTO marshmallow_private.schedule_monitor_queue(lead_id) VALUES(NEW.id)
    ON CONFLICT(lead_id) DO UPDATE SET generation=schedule_monitor_queue.generation+1,
      entered_at=CASE WHEN OLD.cs_tag IS DISTINCT FROM NEW.cs_tag THEN now() ELSE schedule_monitor_queue.entered_at END,
      evidence=NULL,result=NULL,state='pending',available_at=now(),attempts=0,
      lease=NULL,lease_until=NULL,reviewed_by=NULL,reviewed_at=NULL,review_decision=NULL,review_note=NULL;
  ELSE
    UPDATE marshmallow_private.schedule_monitor_queue SET generation=generation+1,state='ineligible',evidence=NULL,lease=NULL,lease_until=NULL WHERE lead_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.capture_schedule_job() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS leads_schedule_monitor_queue ON public.leads;
CREATE TRIGGER leads_schedule_monitor_queue AFTER UPDATE OF cs_tag,status,scheduled_date,scheduled_time_start,scheduled_time_end,customer_schedule_requirements ON public.leads
  FOR EACH ROW WHEN (OLD.cs_tag IS DISTINCT FROM NEW.cs_tag OR OLD.status IS DISTINCT FROM NEW.status OR OLD.scheduled_date IS DISTINCT FROM NEW.scheduled_date
    OR OLD.scheduled_time_start IS DISTINCT FROM NEW.scheduled_time_start OR OLD.scheduled_time_end IS DISTINCT FROM NEW.scheduled_time_end
    OR OLD.customer_schedule_requirements IS DISTINCT FROM NEW.customer_schedule_requirements)
  EXECUTE FUNCTION marshmallow_private.capture_schedule_job();

CREATE OR REPLACE FUNCTION marshmallow_private.capture_schedule_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
BEGIN
  -- Current_user is the DEFINER here, so it is NOT evidence of ingestion trust.
  -- The verified service JWT (or service_role SET ROLE in isolated tests) is.
  IF coalesce(claims->>'role',nullif(current_setting('request.jwt.claim.role',true),''),'')<>'service_role'
    AND current_setting('role',true)<>'service_role' THEN RETURN NEW; END IF;
  UPDATE marshmallow_private.schedule_monitor_queue q SET generation=q.generation+1,
    evidence=jsonb_build_object('id',NEW.id,'conversation_id',NEW.conversation_id,
      'text',CASE WHEN NEW.message_time IS NOT NULL AND length(NEW.text)<=2000 THEN NEW.text ELSE '' END,
      'sender',coalesce(NEW.sender,''),'direction',coalesce(NEW.direction,''),'message_time',coalesce(NEW.message_time,now()),'quo_message_id',coalesce(NEW.quo_message_id,'')),
    result=NULL,state='pending',available_at=now()+interval '10 seconds',attempts=0,lease=NULL,lease_until=NULL,
    reviewed_by=NULL,reviewed_at=NULL,review_decision=NULL,review_note=NULL
    FROM marshmallow_private.schedule_monitor_links v,public.leads l
    WHERE q.lead_id=v.lead_id AND l.id=q.lead_id AND l.cs_tag='waiting_schedule_confirmation'
      AND v.conversation_id=NEW.conversation_id AND coalesce(NEW.message_time,now())>=greatest(q.entered_at,v.verified_at)
      AND (q.evidence IS NULL OR NEW.message_time IS NULL OR NEW.message_time>=(q.evidence->>'message_time')::timestamptz);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.capture_schedule_evidence() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS quo_messages_schedule_evidence ON public.quo_messages;
CREATE TRIGGER quo_messages_schedule_evidence AFTER INSERT OR UPDATE OF text,message_time,direction,sender ON public.quo_messages
  FOR EACH ROW EXECUTE FUNCTION marshmallow_private.capture_schedule_evidence();

-- Deterministic authority independent of the AI decision. The initial automatic
-- subset requires the customer's own explicit job/date/24-hour-time confirmation.
-- Free-text-only schedules, bare yes, calls/summaries and inference stay advisory.
CREATE OR REPLACE FUNCTION marshmallow_private.schedule_exact_confirmation(l public.leads,e jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(l.scheduled_date IS NOT NULL AND l.scheduled_time_start IS NOT NULL
   AND e->>'sender'='customer' AND e->>'direction'='inbound'
   AND length(e->>'text') BETWEEN 1 AND 2000
   AND coalesce(e->>'quo_message_id','') NOT LIKE '%:%'
   AND length(coalesce(e->>'quo_message_id',''))>0
   AND (e->>'text') !~* '(call summary|call transcript|cancel|reschedul|\m(not|no|but|unless|except|if|before|after|only|UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT)\M|America/|cannot|can.t|don.t|maybe|tentativ|instead|different|ignore|instruction|system|prompt|assistant)'
   AND (SELECT count(*) FROM regexp_matches(e->>'text','\m[0-9]{4}-[0-9]{2}-[0-9]{2}\M','g'))=1
   AND (SELECT count(*) FROM regexp_matches(e->>'text','\m[0-9]{1,2}:[0-9]{2}\M','g'))=1
   AND (e->>'text') ~* '\m(confirm|confirmed|agree|agreed)\M'
   AND position(' '||trim(regexp_replace(upper(l.job_id),'[^A-Z0-9]+',' ','g'))||' ' IN
       ' '||regexp_replace(upper(e->>'text'),'[^A-Z0-9]+',' ','g')||' ')>0
   AND position(l.scheduled_date::text IN e->>'text')>0
   AND position(to_char(l.scheduled_time_start,'HH24:MI') IN e->>'text')>0,false);
$$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_exact_confirmation(public.leads,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION marshmallow_private.schedule_admin(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a text:=p->>'action'; c marshmallow_private.schedule_monitor_config%rowtype;
  l public.leads%rowtype; conversation public.quo_conversations%rowtype; reason text:=btrim(p->>'reason'); output jsonb;
BEGIN
  IF auth.uid() IS NULL OR marshmallow_private.workflow_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Admin only' USING errcode='42501'; END IF;
  IF a IS NULL OR a NOT IN ('status','configure','link','unlink','retry','review') THEN RAISE EXCEPTION 'Invalid monitor action' USING errcode='22023'; END IF;
  SELECT * INTO c FROM marshmallow_private.schedule_monitor_config WHERE id FOR UPDATE;
  IF a='status' THEN
    SELECT jsonb_build_object('mode',c.mode,'timezone',c.timezone,'changed_at',c.changed_at,'cooldown_until',c.cooldown_until,'shadow_started_at',c.shadow_started_at,
      'daily_checks',CASE WHEN c.usage_date=current_date THEN c.daily_checks ELSE 0 END,'ingestion_paused',marshmallow_private.schedule_ingestion_paused(),
      'total',(SELECT count(*) FROM public.leads WHERE cs_tag='waiting_schedule_confirmation'),
      'accepted',(SELECT count(DISTINCT lead_id) FROM marshmallow_private.schedule_monitor_reviews WHERE reviewed_at>=c.shadow_started_at AND decision='accept'),
      'rejected',(SELECT count(*) FROM marshmallow_private.schedule_monitor_reviews WHERE reviewed_at>=c.shadow_started_at AND decision='reject'),
      'rows',coalesce((SELECT jsonb_agg(item ORDER BY job_id) FROM (
        SELECT job.job_id,jsonb_build_object('lead_id',job.id,'job_id',job.job_id,'status',job.status,
          'scheduled_date',job.scheduled_date,'scheduled_time_start',job.scheduled_time_start,'schedule_requirements',job.customer_schedule_requirements,'timezone',v.timezone,
          'eligible',marshmallow_private.schedule_eligible(job),'conversation_id',v.conversation_id,'verified_at',v.verified_at,
          'state',coalesce(q.state,'not_queued'),'generation',q.generation,'checked_at',q.checked_at,'result',q.result,'review_decision',q.review_decision,
          'evidence',CASE WHEN q.evidence IS NOT NULL THEN jsonb_build_object('text',q.evidence->>'text','message_time',q.evidence->>'message_time','sender',q.evidence->>'sender','direction',q.evidence->>'direction') ELSE NULL END,
          'candidates',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'number_id',x.number_id,'last_message_time',x.last_message_time))
            FROM public.quo_conversations x WHERE regexp_replace(x.customer_number,'[^0-9]','','g') IN
              (regexp_replace(job.customer_phone,'[^0-9]','','g'),'1'||regexp_replace(job.customer_phone,'[^0-9]','','g'))
              AND (x.linked_lead_id IS NULL OR x.linked_lead_id=job.id)), '[]'::jsonb)) item
        FROM public.leads job LEFT JOIN marshmallow_private.schedule_monitor_links v ON v.lead_id=job.id
        LEFT JOIN marshmallow_private.schedule_monitor_queue q ON q.lead_id=job.id WHERE job.cs_tag='waiting_schedule_confirmation'
        ORDER BY job.job_id LIMIT 20 OFFSET coalesce((p->>'offset')::integer,0)
      ) page),'[]'::jsonb)) INTO output;
    RETURN output;
  END IF;
  IF reason IS NULL OR length(reason) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'Enter a reason (10–2000 characters)' USING errcode='22023'; END IF;
  IF a='configure' THEN
    IF p->>'mode' IS DISTINCT FROM 'off' AND c.changed_at IS DISTINCT FROM (p->>'expectedChangedAt')::timestamptz THEN
      RAISE EXCEPTION 'Monitor configuration changed. Refresh and review it before saving.' USING errcode='40001'; END IF;
    IF p->>'mode' IS NULL OR p->>'timezone' IS NULL OR p->>'mode' NOT IN ('off','shadow','automatic') OR p->>'timezone' NOT IN
      ('America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','Pacific/Honolulu','America/Anchorage') THEN
      RAISE EXCEPTION 'Choose a valid mode and schedule timezone' USING errcode='22023'; END IF;
    IF p->>'mode'='automatic' AND (c.mode<>'shadow' OR c.timezone<>p->>'timezone' OR
      (SELECT count(DISTINCT lead_id) FROM marshmallow_private.schedule_monitor_reviews WHERE reviewed_at>=c.shadow_started_at AND decision='accept')<5 OR
      EXISTS(SELECT 1 FROM marshmallow_private.schedule_monitor_reviews WHERE reviewed_at>=c.shadow_started_at AND decision='reject') OR
      EXISTS(SELECT 1 FROM marshmallow_private.schedule_monitor_queue WHERE checked_at>=c.shadow_started_at AND
        result->>'decision'='confirmed' AND review_decision IS NULL)) THEN
      RAISE EXCEPTION 'Automatic mode needs shadow mode, five accepted current examples, no rejected/unreviewed confirmations and unchanged timezone' USING errcode='22023'; END IF;
    UPDATE marshmallow_private.schedule_monitor_config SET mode=p->>'mode',timezone=p->>'timezone',changed_at=clock_timestamp(),
      shadow_started_at=CASE WHEN p->>'mode'='shadow' AND (c.mode<>'shadow' OR c.timezone<>p->>'timezone') THEN now() ELSE shadow_started_at END WHERE id;
  ELSE
    SELECT * INTO l FROM public.leads WHERE id=(p->>'leadId')::uuid FOR UPDATE;
    IF NOT found OR l.cs_tag IS DISTINCT FROM 'waiting_schedule_confirmation' THEN RAISE EXCEPTION 'Waiting job unavailable' USING errcode='22023'; END IF;
    IF a='link' THEN
      SELECT * INTO conversation FROM public.quo_conversations WHERE id=(p->>'conversationId')::uuid;
      IF NOT found OR (conversation.linked_lead_id IS NOT NULL AND conversation.linked_lead_id<>l.id) OR
        NOT coalesce(regexp_replace(conversation.customer_number,'[^0-9]','','g') IN
          (regexp_replace(l.customer_phone,'[^0-9]','','g'),'1'||regexp_replace(l.customer_phone,'[^0-9]','','g')),false) THEN
        RAISE EXCEPTION 'Conversation identity does not match the saved job' USING errcode='22023'; END IF;
      INSERT INTO marshmallow_private.schedule_monitor_links(lead_id,conversation_id,verified_by,reason,timezone) VALUES(l.id,conversation.id,auth.uid(),reason,c.timezone)
        ON CONFLICT(lead_id) DO UPDATE SET conversation_id=excluded.conversation_id,verified_by=excluded.verified_by,verified_at=now(),reason=excluded.reason,timezone=excluded.timezone;
    ELSIF a='unlink' THEN
      DELETE FROM marshmallow_private.schedule_monitor_links WHERE lead_id=l.id;
    ELSIF a='review' THEN
      IF c.mode<>'shadow' OR p->>'decision' NOT IN ('accept','reject') THEN RAISE EXCEPTION 'Review current shadow evidence as accept or reject' USING errcode='22023'; END IF;
      UPDATE marshmallow_private.schedule_monitor_queue SET reviewed_by=auth.uid(),reviewed_at=now(),review_decision=p->>'decision',review_note=reason
        WHERE lead_id=l.id AND result->>'decision'='confirmed' AND checked_at>=c.shadow_started_at
          AND generation=(p->>'generation')::integer;
      IF NOT found THEN RAISE EXCEPTION 'No current shadow confirmation to review' USING errcode='40001'; END IF;
      INSERT INTO marshmallow_private.schedule_monitor_reviews(lead_id,generation,evidence_id,decision,reviewed_by,reason)
        SELECT lead_id,generation,(evidence->>'id')::uuid,p->>'decision',auth.uid(),reason FROM marshmallow_private.schedule_monitor_queue WHERE lead_id=l.id
        ON CONFLICT(lead_id,generation) DO UPDATE SET decision=excluded.decision,reviewed_by=excluded.reviewed_by,reviewed_at=now(),reason=excluded.reason;
    END IF;
    IF a<>'review' THEN
      INSERT INTO marshmallow_private.schedule_monitor_queue(lead_id) VALUES(l.id) ON CONFLICT(lead_id) DO UPDATE SET
        generation=schedule_monitor_queue.generation+1,available_at=now(),state='pending',result=NULL,lease=NULL,lease_until=NULL,attempts=0,
        evidence=CASE WHEN a='retry' THEN schedule_monitor_queue.evidence ELSE NULL END,
        reviewed_by=NULL,reviewed_at=NULL,review_decision=NULL,review_note=NULL;
    END IF;
  END IF;
  INSERT INTO public.activity_logs(user_id,user_name,action,target_type,target_id,details)
    SELECT auth.uid(),coalesce(full_name,'Admin'),'schedule_monitor_'||a,'lead',coalesce(l.id::text,'configuration'),reason FROM public.profiles WHERE id=auth.uid();
  RETURN jsonb_build_object('saved',true);
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.schedule_admin(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION marshmallow_private.schedule_admin(jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.schedule_monitor_admin(p_input jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT marshmallow_private.schedule_admin(p_input); $$;
REVOKE ALL ON FUNCTION public.schedule_monitor_admin(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_monitor_admin(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_schedule_checks() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c marshmallow_private.schedule_monitor_config%rowtype; output jsonb;
BEGIN
  SELECT * INTO c FROM marshmallow_private.schedule_monitor_config WHERE id FOR UPDATE;
  IF c.mode='off' OR marshmallow_private.schedule_ingestion_paused() OR c.cooldown_until>now() OR (c.usage_date=current_date AND c.daily_checks>=100) THEN RETURN jsonb_build_object('mode',c.mode,'timezone',c.timezone,'rows','[]'::jsonb); END IF;
  -- Recovery sweep only adds missing waiting jobs; no external calls and no
  -- historical transcripts are promoted to trusted evidence.
  INSERT INTO marshmallow_private.schedule_monitor_queue(lead_id)
    SELECT id FROM public.leads WHERE cs_tag='waiting_schedule_confirmation' ON CONFLICT DO NOTHING;
  WITH candidates AS (
    SELECT q.lead_id FROM marshmallow_private.schedule_monitor_queue q WHERE q.available_at<=now()
      AND (q.state='pending' OR (q.state='running' AND q.lease_until<now()))
      ORDER BY q.available_at,q.lead_id LIMIT least(5,100-CASE WHEN c.usage_date=current_date THEN c.daily_checks ELSE 0 END) FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE marshmallow_private.schedule_monitor_queue q SET state='running',lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=q.attempts+1
      FROM candidates x WHERE q.lead_id=x.lead_id RETURNING q.*
  ) SELECT jsonb_build_object('mode',c.mode,'timezone',c.timezone,'config_changed_at',c.changed_at,'rows',coalesce(jsonb_agg(jsonb_build_object(
    'lead_id',q.lead_id,'lease',q.lease,'generation',q.generation,'attempts',q.attempts,'evidence',q.evidence,
    'eligible',marshmallow_private.schedule_eligible(l),'verified',v.lead_id IS NOT NULL AND v.timezone=c.timezone,
    'job_id',l.job_id,'status',l.status,'scheduled_date',l.scheduled_date,'scheduled_time_start',l.scheduled_time_start,
    'scheduled_time_end',l.scheduled_time_end,'schedule_requirements',l.customer_schedule_requirements)), '[]'::jsonb)) INTO output
    FROM claimed q JOIN public.leads l ON l.id=q.lead_id LEFT JOIN marshmallow_private.schedule_monitor_links v ON v.lead_id=q.lead_id;
  UPDATE marshmallow_private.schedule_monitor_config SET usage_date=current_date,
    daily_checks=CASE WHEN usage_date=current_date THEN daily_checks ELSE 0 END+jsonb_array_length(output->'rows') WHERE id;
  RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.claim_schedule_checks() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_schedule_checks() TO service_role;

CREATE OR REPLACE FUNCTION public.finish_schedule_check(p_input jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.leads%rowtype; q marshmallow_private.schedule_monitor_queue%rowtype;
  c marshmallow_private.schedule_monitor_config%rowtype; users uuid[]; applied boolean:=false;
  decision text:=p_input->'result'->>'decision';
BEGIN
  SELECT * INTO c FROM marshmallow_private.schedule_monitor_config WHERE id FOR UPDATE;
  SELECT * INTO l FROM public.leads WHERE id=(p_input->>'lead_id')::uuid FOR UPDATE;
  SELECT * INTO q FROM marshmallow_private.schedule_monitor_queue WHERE lead_id=l.id FOR UPDATE;
  IF q.lease IS NULL OR q.lease IS DISTINCT FROM (p_input->>'lease')::uuid OR q.generation<>(p_input->>'generation')::integer OR q.lease_until<now()
    OR c.mode='off' OR marshmallow_private.schedule_ingestion_paused() OR c.mode IS DISTINCT FROM p_input->>'mode' OR c.timezone IS DISTINCT FROM p_input->>'timezone'
    OR c.changed_at IS DISTINCT FROM (p_input->>'config_changed_at')::timestamptz THEN RETURN false; END IF;
  IF decision NOT IN ('confirmed','needs_review','unavailable') OR decision IS NULL THEN RAISE EXCEPTION 'Invalid assessment' USING errcode='22023'; END IF;
  IF decision='confirmed' AND NOT coalesce(marshmallow_private.schedule_eligible(l)
    AND EXISTS(SELECT 1 FROM marshmallow_private.schedule_monitor_links WHERE lead_id=l.id AND conversation_id=(q.evidence->>'conversation_id')::uuid AND timezone=c.timezone)
    AND marshmallow_private.schedule_exact_confirmation(l,q.evidence)
    AND (q.evidence->>'message_time')::timestamptz BETWEEN now()-interval '24 hours' AND now()+interval '5 minutes'
    AND (l.scheduled_date+l.scheduled_time_start)>(now() AT TIME ZONE c.timezone),false) THEN
    decision:='needs_review';
  END IF;
  -- The service RPC is not a generic lead writer. AI output cannot override any
  -- guard; only this exact allowed transition is possible.
  IF decision='confirmed' AND c.mode='automatic' AND marshmallow_private.schedule_eligible(l)
    AND EXISTS(SELECT 1 FROM marshmallow_private.schedule_monitor_links WHERE lead_id=l.id AND conversation_id=(q.evidence->>'conversation_id')::uuid AND timezone=c.timezone)
    AND marshmallow_private.schedule_exact_confirmation(l,q.evidence)
    AND l.scheduled_date>=(now() AT TIME ZONE c.timezone)::date
    AND (l.scheduled_date+l.scheduled_time_start)>(now() AT TIME ZONE c.timezone) THEN
    -- Dynamic UPDATE is the runtime tag transition, never migration-time repair.
    EXECUTE format('UPDATE %I.%I SET cs_tag=$1 WHERE id=$2 AND cs_tag=$3','public','leads')
      USING 'ready_to_schedule',l.id,'waiting_schedule_confirmation';
    applied:=true;
    SELECT array_agg(DISTINCT ur.user_id) INTO users FROM public.user_roles ur WHERE (
      ur.role::text IN ('admin','processor','cs_admin') OR (ur.role::text='customer_service' AND (
        l.created_by=ur.user_id OR l.assigned_cs=ur.user_id OR EXISTS(SELECT 1 FROM public.lead_shares s WHERE s.lead_id=l.id AND s.shared_with_user_id=ur.user_id))))
      AND marshmallow_private.workflow_job_visible_to(ur.user_id,l);
    PERFORM marshmallow_private.workflow_notify(users,'schedule_ready','Schedule confirmed — Ready to Schedule',
      'Job '||l.job_id||' has verified customer confirmation. The agreed schedule is unchanged.',l.id,l.job_id,NULL,NULL,q.generation);
    INSERT INTO public.activity_logs(user_id,user_name,action,target_type,target_id,details)
      VALUES(NULL,'Schedule monitor','schedule_confirmation_tag_applied','lead',l.id::text,
        'Evidence message '||(q.evidence->>'id')||'; generation '||q.generation||'; agreed schedule unchanged');
  END IF;
  UPDATE marshmallow_private.schedule_monitor_queue SET lease=NULL,lease_until=NULL,checked_at=now(),
    result=jsonb_build_object('decision',decision,'reason',left(p_input->'result'->>'reason',500),'evidence_id',q.evidence->>'id','applied',applied),
    state=CASE WHEN decision='unavailable' AND q.attempts<5 THEN 'pending' ELSE 'checked' END,
    available_at=now()+make_interval(secs=>least(3600,60*power(2,least(q.attempts,5)))::integer)
    WHERE lead_id=l.id;
  IF p_input->>'provider_status'='429' THEN
    UPDATE marshmallow_private.schedule_monitor_config SET cooldown_until=now()+interval '15 minutes' WHERE id;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_schedule_check(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_schedule_check(jsonb) TO service_role;

-- Cron may call this private dispatcher only after a separately approved setup.
-- No Edge invocation while OFF, paused, cooling down, out of budget or idle.
CREATE OR REPLACE FUNCTION marshmallow_private.dispatch_schedule_monitor() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c marshmallow_private.schedule_monitor_config%rowtype; base_url text; token text;
BEGIN
  SELECT * INTO c FROM marshmallow_private.schedule_monitor_config WHERE id;
  IF c.mode='off' OR marshmallow_private.schedule_ingestion_paused() OR c.cooldown_until>now()
    OR (c.usage_date=current_date AND c.daily_checks>=100) THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM marshmallow_private.schedule_monitor_queue WHERE available_at<=now()
    AND (state='pending' OR (state='running' AND lease_until<now())))
    AND NOT EXISTS(SELECT 1 FROM public.leads l WHERE cs_tag='waiting_schedule_confirmation'
      AND NOT EXISTS(SELECT 1 FROM marshmallow_private.schedule_monitor_queue WHERE lead_id=l.id)) THEN RETURN; END IF;
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name='schedule_monitor_project_url' LIMIT 1;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='schedule_monitor_cron_secret' LIMIT 1;
  IF base_url IS NULL OR token IS NULL THEN RAISE EXCEPTION 'Schedule monitor dispatcher secrets are not configured'; END IF;
  PERFORM net.http_post(url:=rtrim(base_url,'/')||'/functions/v1/schedule-confirmation-monitor',
    headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',token),body:='{}'::jsonb,timeout_milliseconds:=90000);
END $$;
REVOKE ALL ON FUNCTION marshmallow_private.dispatch_schedule_monitor() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
-- Rollback: set mode off via the authenticated Admin control (audited), disable
-- the separately approved worker cron, revoke service RPCs and public Admin RPC,
-- remove these two new capture triggers only, and retain private evidence/review
-- history. Do not revert valid customer tags in bulk. Review any tag correction
-- individually under normal permissions; schedules/statuses were never changed.
