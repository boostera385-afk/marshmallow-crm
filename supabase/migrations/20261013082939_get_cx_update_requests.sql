-- Purpose: temporary, customer-only CX update requests for otherwise hidden jobs.
-- Does not change leads, lead RLS, schedules, status enums, or approval gates.
-- Apply manually. Backend writes are atomic and authorized independently of UI.
begin;

create schema if not exists marshmallow_private;
revoke all on schema marshmallow_private from public, anon;
grant usage on schema marshmallow_private to authenticated;

create table if not exists public.lead_cx_update_requests (
  id uuid primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  recipient_cs uuid references public.profiles(id) on delete set null,
  request_text text not null check (length(btrim(request_text)) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'cs_updated')),
  response_text text check (length(btrim(response_text)) between 1 and 4000),
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  acknowledged_at timestamptz,
  check ((status = 'pending' and response_text is null and completed_at is null and acknowledged_at is null)
      or (status = 'cs_updated' and response_text is not null and completed_at is not null))
);
create unique index if not exists lead_cx_update_one_pending
  on public.lead_cx_update_requests(lead_id) where status = 'pending';
create index if not exists lead_cx_update_recipient_pending
  on public.lead_cx_update_requests(recipient_cs, created_at desc, id) where status = 'pending';
create index if not exists lead_cx_update_open_queue
  on public.lead_cx_update_requests(status, created_at desc, id) where acknowledged_at is null;
create index if not exists lead_cx_update_requester on public.lead_cx_update_requests(requested_by);
-- Full foreign-key indexes cover history rows as well as active queues.
create index if not exists lead_cx_update_lead on public.lead_cx_update_requests(lead_id);
create index if not exists lead_cx_update_recipient on public.lead_cx_update_requests(recipient_cs);
create index if not exists lead_cx_update_completer on public.lead_cx_update_requests(completed_by);
alter table public.lead_cx_update_requests enable row level security;
revoke all on public.lead_cx_update_requests from public, anon, authenticated;
grant select on public.lead_cx_update_requests to authenticated;
drop policy if exists cx_update_recipient_read on public.lead_cx_update_requests;
create policy cx_update_recipient_read on public.lead_cx_update_requests for select to authenticated using (
  (select auth.uid()) is not null and (
    (select public.has_role(auth.uid(), 'admin'::public.app_role))
    or (select public.has_role(auth.uid(), 'processor'::public.app_role))
    or (status = 'pending' and (
      (select public.has_role(auth.uid(), 'cs_admin'::public.app_role))
      or ((select public.has_role(auth.uid(), 'customer_service'::public.app_role)) and recipient_cs = (select auth.uid()))
    ))
  )
);

-- Kept outside the exposed schema. The public invoker wrapper also checks the
-- caller's existing lead SELECT scope before creating a request. No service client.
create or replace function marshmallow_private.cx_update_requests(
  p_action text, p_lead_id uuid, p_request_id uuid, p_text text, p_offset integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  caller_role text;
  lead_row public.leads%rowtype;
  request_row public.lead_cx_update_requests%rowtype;
  recipient uuid;
  rows_json jsonb;
  total bigint;
begin
  -- AuthContext expects exactly one role row. Fail closed on ambiguous roles,
  -- rather than choosing an arbitrary row from the composite-unique table.
  select case when count(*) = 1 then min(role::text) else null end into caller_role
    from public.user_roles where user_id = caller;
  if caller is null or caller_role is null or caller_role not in ('admin','processor','cs_admin','customer_service') then
    raise exception 'CX update access denied' using errcode = '42501';
  end if;
  if p_action not in ('list_pending','list_updated','count','create','complete','acknowledge') or p_action is null then
    raise exception 'Invalid CX update action' using errcode = '22023';
  end if;

  if p_action in ('list_pending','list_updated','count') then
    if p_offset is null or p_offset < 0 then
      raise exception 'Invalid queue page' using errcode = '22023';
    end if;
    if p_action = 'list_updated' and caller_role not in ('admin','processor') then
      raise exception 'Completed requests are restricted to Processor/Admin' using errcode = '42501';
    end if;
    if p_action = 'count' then
      select count(*) into total from public.lead_cx_update_requests r
      where r.acknowledged_at is null and (
        caller_role in ('admin','processor')
        or (r.status = 'pending' and (caller_role = 'cs_admin' or r.recipient_cs = caller))
      );
      return jsonb_build_object('count', total);
    end if;
    select count(*) into total from public.lead_cx_update_requests r
    where r.status = case when p_action = 'list_pending' then 'pending' else 'cs_updated' end
      and r.acknowledged_at is null
      and (caller_role in ('admin','processor','cs_admin') or r.recipient_cs = caller);
    select coalesce(jsonb_agg(q.item order by q.created_at desc, q.id), '[]'::jsonb) into rows_json from (
      select r.created_at, r.id, jsonb_build_object(
        'id', r.id, 'lead_id', r.lead_id, 'requested_by', r.requested_by,
        'requester_name', requester.full_name, 'recipient_cs', r.recipient_cs,
        'recipient_name', cs.full_name, 'request_text', r.request_text, 'status', r.status,
        'response_text', r.response_text, 'completed_at', r.completed_at,
        'completed_by_name', responder.full_name, 'created_at', r.created_at,
        'customer', jsonb_build_object(
          'job_id', l.job_id, 'customer_name', l.customer_name, 'customer_phone', l.customer_phone,
          'customer_landline', l.customer_landline, 'customer_email', l.customer_email,
          'service_type', l.service_type, 'service_details', l.service_details,
          'address', l.address, 'city', l.city, 'state', l.state, 'zip_code', l.zip_code,
          'customer_schedule_requirements', l.customer_schedule_requirements,
          'scheduled_date', l.scheduled_date, 'scheduled_time_start', l.scheduled_time_start,
          'scheduled_time_end', l.scheduled_time_end
        )
      ) item
      from public.lead_cx_update_requests r join public.leads l on l.id = r.lead_id
      left join public.profiles requester on requester.id = r.requested_by
      left join public.profiles cs on cs.id = r.recipient_cs
      left join public.profiles responder on responder.id = r.completed_by
      where r.status = case when p_action = 'list_pending' then 'pending' else 'cs_updated' end
        and r.acknowledged_at is null
        and (caller_role in ('admin','processor','cs_admin') or r.recipient_cs = caller)
      order by r.created_at desc, r.id limit 20 offset p_offset
    ) q;
    return jsonb_build_object('rows', rows_json, 'total', total);
  end if;

  if p_request_id is null then
    raise exception 'Request ID is required' using errcode = '22023';
  end if;
  if p_action = 'create' then
    if caller_role not in ('admin','processor') then
      raise exception 'Only Processor/Admin may request CX updates' using errcode = '42501';
    end if;
    if p_text is null or length(btrim(p_text)) not between 1 and 2000 then
      raise exception 'Describe the required customer update (1–2000 characters)' using errcode = '22023';
    end if;
    select * into lead_row from public.leads where id = p_lead_id for update;
    if not found then raise exception 'Lead unavailable' using errcode = '42501'; end if;
    select * into request_row from public.lead_cx_update_requests where id = p_request_id;
    if found then
      if request_row.requested_by = caller and request_row.lead_id = p_lead_id and request_row.request_text = btrim(p_text) then
        return jsonb_build_object('saved', true, 'id', request_row.id);
      end if;
      raise exception 'Request ID already used' using errcode = '22023';
    end if;
    if exists(select 1 from public.lead_cx_update_requests where lead_id = p_lead_id and status = 'pending') then
      raise exception 'This lead already has a pending CX update request' using errcode = '23505';
    end if;
    -- Assigned CS takes precedence. The creator is used only when unassigned.
    recipient := coalesce(lead_row.assigned_cs, lead_row.created_by);
    if not exists(select 1 from public.user_roles where user_id = recipient
      group by user_id having count(*) = 1 and min(role::text) = 'customer_service') then
      recipient := null; -- CS Admin queue handles jobs without an eligible agent.
    end if;
    insert into public.lead_cx_update_requests(id, lead_id, requested_by, recipient_cs, request_text)
    values (p_request_id, p_lead_id, caller, recipient, btrim(p_text));
    insert into public.notifications(user_id, title, message, lead_id)
      select ur.user_id, 'Get CX Update', 'A customer update has been requested. Open Get CX Update.', null
      from public.user_roles ur where ur.role::text = 'cs_admin' or ur.user_id = recipient;
  else
    select * into request_row from public.lead_cx_update_requests where id = p_request_id for update;
    if not found then raise exception 'Request unavailable' using errcode = '42501'; end if;
    if p_action = 'complete' then
      if caller_role <> 'cs_admin' and (caller_role <> 'customer_service' or request_row.recipient_cs is distinct from caller) then
        raise exception 'Only the assigned CS agent or CS Admin may complete this request' using errcode = '42501';
      end if;
      if p_text is null or length(btrim(p_text)) not between 1 and 4000 then
        raise exception 'Enter the customer update (1–4000 characters)' using errcode = '22023';
      end if;
      if request_row.status <> 'pending' then
        -- Same-actor/same-text retry is safe, but a competing completion is stale.
        if request_row.completed_by = caller and request_row.response_text = btrim(p_text) then
          return jsonb_build_object('saved', true, 'id', p_request_id);
        end if;
        raise exception 'This request was already updated. Refresh the queue.' using errcode = '40001';
      end if;
      update public.lead_cx_update_requests set status = 'cs_updated', response_text = btrim(p_text),
        completed_by = caller, completed_at = now() where id = p_request_id;
      insert into public.notifications(user_id, title, message, lead_id)
        select ur.user_id, 'CS Updated', 'A customer response is ready. Open Get CX Update → CS Updated.', null
        from public.user_roles ur where ur.role::text = 'admin' or ur.user_id = request_row.requested_by;
    else
      if caller_role <> 'admin' and (caller_role <> 'processor' or request_row.requested_by is distinct from caller) then
        raise exception 'Only the requester or Admin may acknowledge this response' using errcode = '42501';
      end if;
      if request_row.status <> 'cs_updated' then
        raise exception 'The customer update is not completed yet' using errcode = '22023';
      end if;
      if request_row.acknowledged_at is not null then return jsonb_build_object('saved', true, 'id', p_request_id); end if;
      update public.lead_cx_update_requests set acknowledged_at = now() where id = p_request_id;
    end if;
  end if;
  insert into public.activity_logs(user_id, user_name, action, target_type, target_id, details)
    select caller, full_name, 'cx_update_' || p_action, 'lead',
      (case when p_action = 'create' then lead_row.id else request_row.lead_id end)::text, 'CX update request ' || p_request_id::text
    from public.profiles where id = caller;
  return jsonb_build_object('saved', true, 'id', p_request_id);
end;
$$;
revoke all on function marshmallow_private.cx_update_requests(text,uuid,uuid,text,integer) from public, anon;
grant execute on function marshmallow_private.cx_update_requests(text,uuid,uuid,text,integer) to authenticated;

create or replace function public.cx_update_requests(
  p_action text, p_lead_id uuid default null, p_request_id uuid default null,
  p_text text default null, p_offset integer default 0
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_action = 'create' and not exists(select 1 from public.leads where id = p_lead_id) then
    raise exception 'Lead outside your access scope' using errcode = '42501';
  end if;
  return marshmallow_private.cx_update_requests(p_action, p_lead_id, p_request_id, p_text, p_offset);
end;
$$;
revoke all on function public.cx_update_requests(text,uuid,uuid,text,integer) from public, anon;
grant execute on function public.cx_update_requests(text,uuid,uuid,text,integer) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'lead_cx_update_requests') then
    alter publication supabase_realtime add table public.lead_cx_update_requests;
  end if;
end $$;
commit;

-- Rollback: first disable the UI/function and retain/export request history.
-- Revoke EXECUTE on public.cx_update_requests(text,uuid,uuid,text,integer) from authenticated;
-- Revoke EXECUTE on marshmallow_private.cx_update_requests(text,uuid,uuid,text,integer) from authenticated;
-- After approved archival only: drop public.cx_update_requests, then the private
-- function, then public.lead_cx_update_requests. Do NOT drop the shared private schema.
-- No lead data/status repair is needed, because this migration never updates leads.
